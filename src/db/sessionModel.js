const mongoose = require('mongoose');

const sessionSchema = new mongoose.Schema(
  {
    sessionId: { type: String, required: true, unique: true, index: true },
    phoneNumber: { type: String, required: true },
    authState: { type: mongoose.Schema.Types.Mixed, required: true },
    status: { type: String, enum: ['pending', 'active', 'revoked'], default: 'pending' },
    linkedAt: { type: Date, default: Date.now },
    lastUpdated: { type: Date, default: Date.now },
  },
  { collection: 'sessions' }
);

module.exports = mongoose.model('Session', sessionSchema);
