const {
  default: makeWASocket,
  DisconnectReason,
  fetchLatestBaileysVersion,
  Browsers,
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const { Boom } = require('@hapi/boom');
const { useMongoAuthState } = require('../db/mongoAuthState');
const { generateSessionId } = require('../utils/sessionId');

const logger = pino({ level: 'silent' });

async function startPairing(phoneNumber, { onPairingCode, onQrFallback } = {}) {
  const sessionId = generateSessionId();
  const { state, saveCreds, markActive } = await useMongoAuthState(sessionId, phoneNumber);
  const { version } = await fetchLatestBaileysVersion();

  return new Promise((resolve, reject) => {
    let settled = false;
    let codeRequested = false;

    const sock = makeWASocket({
      version,
      logger,
      printQRInTerminal: false,
      auth: state,
      browser: Browsers.baileys('Desktop'),
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr && onQrFallback) onQrFallback(qr);

      if (connection === 'open') {
        await markActive();
        if (!settled) {
          settled = true;
          resolve({ sessionId });
        }
      }

      if (connection === 'close') {
        const statusCode = new Boom(lastDisconnect?.error)?.output?.statusCode;
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

        if (!settled) {
          settled = true;
          reject(
            new Error(
              `Pairing failed before completion (code: ${statusCode || 'unknown'}). ` +
                (shouldReconnect ? 'You can retry.' : 'Session was logged out — start over.')
            )
          );
        }
      }
    });

    if (!sock.authState?.creds?.registered) {
      setTimeout(async () => {
        try {
          if (codeRequested) return;
          codeRequested = true;
          const code = await sock.requestPairingCode(phoneNumber.replace(/[^0-9]/g, ''));
          if (onPairingCode) onPairingCode(code);
        } catch (err) {
          if (!settled) {
            settled = true;
            reject(err);
          }
        }
      }, 1500);
    }

    setTimeout(() => {
      if (!settled) {
        settled = true;
        try { sock.end(undefined); } catch (_) {}
        reject(new Error('Pairing timed out after 90s. Please try again.'));
      }
    }, 90_000);
  });
}

module.exports = { startPairing };
