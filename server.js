require('dotenv').config();
const path = require('path');
const express = require('express');
const { connectMongo } = require('./src/db/mongo');
const { startPairing } = require('./src/pairing/pairCode');
const Session = require('./src/db/sessionModel');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;

// Frontend polls this after entering pairing code — returns sessionId once linked
app.get('/session-status', async (req, res) => {
  const phone = (req.query.phone || '').replace(/[^0-9]/g, '');
  if (!phone) return res.status(400).json({ error: 'phone required' });

  const doc = await Session.findOne({ phoneNumber: phone, status: 'active' })
    .sort({ linkedAt: -1 })
    .lean();

  if (!doc) return res.json({ status: 'pending' });
  return res.json({ sessionId: doc.sessionId, status: 'active' });
});

app.post('/pair', async (req, res) => {
  const phoneNumber = (req.body?.phoneNumber || '').replace(/[^0-9]/g, '');

  if (!/^\d{8,15}$/.test(phoneNumber)) {
    return res.status(400).json({ error: 'Invalid phone number. Use country code, digits only.' });
  }

  let codeSent = false;

  try {
    startPairing(phoneNumber, {
      onPairingCode: (code) => {
        codeSent = true;
        res.json({ pairingCode: code, message: 'Enter this in WhatsApp > Linked Devices.' });
      },
    })
      .then(({ sessionId }) => {
        console.log(`[pair] success for ${phoneNumber}: ${sessionId}`);
      })
      .catch((err) => {
        console.error(`[pair] failed for ${phoneNumber}:`, err.message);
      });

    setTimeout(() => {
      if (!codeSent && !res.headersSent) {
        res.status(504).json({ error: 'Timed out waiting for pairing code.' });
      }
    }, 20_000);
  } catch (err) {
    if (!res.headersSent) {
      res.status(500).json({ error: err.message });
    }
  }
});

async function main() {
  await connectMongo();
  app.listen(PORT, () => console.log(`[server] listening on ${PORT}`));
}

main();
