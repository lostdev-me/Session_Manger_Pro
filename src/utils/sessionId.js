const crypto = require('crypto');

function generateSessionId() {
  const random = crypto.randomBytes(16).toString('base64url');
  return `DEADX~${random}`;
}

module.exports = { generateSessionId };
