const {
  default: makeWASocket,
  DisconnectReason,
  fetchLatestBaileysVersion,
  useMultiFileAuthState,
  Browsers,
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const { Boom } = require('@hapi/boom');
const { useMongoAuthState } = require('../db/mongoAuthState');
const { generateSessionId } = require('../utils/sessionId');
const fs = require('fs');
const path = require('path');

const logger = pino({ level: 'silent' });

async function startPairing(phoneNumber, { onPairingCode } = {}) {
  const sessionId = generateSessionId();

  // Use a temp folder for auth state during pairing only
  const tmpDir = path.join('/tmp', sessionId);
  fs.mkdirSync(tmpDir, { recursive: true });

  const { state, saveCreds } = await useMultiFileAuthState(tmpDir);
  const { version } = await fetchLatestBaileysVersion();

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
      const { connection, lastDisconnect } = update;

      if (connection === 'open') {
        if (!settled) {
          settled = true;
          try {
            // Save to Mongo after successful link
            const { useMongoAuthState: mongo } = require('../db/mongoAuthState');
            const mongoState = await mongo(sessionId, phoneNumber);
            await mongoState.saveCreds();

            // Copy file-based auth into Mongo
            const Session = require('../db/sessionModel');
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

            // Cleanup tmp
            fs.rmSync(tmpDir, { recursive: true, force: true });
            resolve({ sessionId });
          } catch (err) {
            reject(err);
          }
        }
      }

      if (connection === 'close') {
        const statusCode = new Boom(lastDisconnect?.error)?.output?.statusCode;
        if (!settled) {
          settled = true;
          fs.rmSync(tmpDir, { recursive: true, force: true });
          reject(new Error(`Connection closed (code: ${statusCode || 'unknown'}). Try again.`));
        }
      }
    });

    // Request pairing code after socket is ready
    setTimeout(async () => {
      try {
        const code = await sock.requestPairingCode(phoneNumber);
        if (onPairingCode) onPairingCode(code);
      } catch (err) {
        if (!settled) {
          settled = true;
          fs.rmSync(tmpDir, { recursive: true, force: true });
          reject(err);
        }
      }
    }, 3000);

    // 90s timeout
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
