const {
  default: makeWASocket,
  DisconnectReason,
  fetchLatestBaileysVersion,
  useMultiFileAuthState,
  Browsers,
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const { Boom } = require('@hapi/boom');
const { generateSessionId } = require('../utils/sessionId');
const Session = require('../db/sessionModel');
const fs = require('fs');
const path = require('path');

const logger = pino({ level: 'debug' });

async function startPairing(phoneNumber, { onPairingCode } = {}) {
  const sessionId = generateSessionId();
  const tmpDir = path.join('/tmp', sessionId);
  fs.mkdirSync(tmpDir, { recursive: true });

  console.log(`[pair] starting for ${phoneNumber}, sessionId: ${sessionId}`);

  const { state, saveCreds } = await useMultiFileAuthState(tmpDir);
  const { version } = await fetchLatestBaileysVersion();
  console.log(`[pair] Baileys version: ${version}`);

  return new Promise((resolve, reject) => {
    let settled = false;

    const sock = makeWASocket({
      version,
      logger,
      printQRInTerminal: false,
      auth: state,
      browser: Browsers.ubuntu('Chrome'),
      mobile: false,
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;
      console.log(`[pair] connection.update:`, JSON.stringify({ connection, qr: !!qr, lastDisconnect: lastDisconnect?.error?.message }));

      if (connection === 'open') {
        console.log(`[pair] connection open! saving to mongo...`);
        if (!settled) {
          settled = true;
          try {
            const credsRaw = fs.readFileSync(path.join(tmpDir, 'creds.json'), 'utf8');
            const creds = JSON.parse(credsRaw);
            await Session.findOneAndUpdate(
              { sessionId },
              {
                sessionId,
                phoneNumber,
                authState: { creds, keys: {} },
                status: 'active',
                linkedAt: new Date(),
                lastUpdated: new Date(),
              },
              { upsert: true, new: true }
            );
            console.log(`[pair] saved to mongo. sessionId: ${sessionId}`);
            fs.rmSync(tmpDir, { recursive: true, force: true });
            resolve({ sessionId });
          } catch (err) {
            console.error(`[pair] mongo save error:`, err.message);
            reject(err);
          }
        }
      }

      if (connection === 'close') {
        const statusCode = new Boom(lastDisconnect?.error)?.output?.statusCode;
        console.log(`[pair] connection closed, code: ${statusCode}`);
        if (!settled) {
          settled = true;
          fs.rmSync(tmpDir, { recursive: true, force: true });
          reject(new Error(`Connection closed (code: ${statusCode || 'unknown'}). Try again.`));
        }
      }
    });

    setTimeout(async () => {
      try {
        console.log(`[pair] requesting pairing code for ${phoneNumber}...`);
        const code = await sock.requestPairingCode(phoneNumber);
        console.log(`[pair] got code: ${code}`);
        if (onPairingCode) onPairingCode(code);
      } catch (err) {
        console.error(`[pair] requestPairingCode error:`, err.message);
        if (!settled) {
          settled = true;
          fs.rmSync(tmpDir, { recursive: true, force: true });
          reject(err);
        }
      }
    }, 3000);

    setTimeout(() => {
      if (!settled) {
        settled = true;
        try { sock.end(undefined); } catch (_) {}
        fs.rmSync(tmpDir, { recursive: true, force: true });
        reject(new Error('Pairing timed out after 90s. Try again.'));
      }
    }, 90_000);
  });
}

module.exports = { startPairing };
