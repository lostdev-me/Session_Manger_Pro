const baileys = require('@whiskeysockets/baileys');
const { proto } = baileys;

let initAuthCreds = baileys.initAuthCreds;
let BufferJSON = baileys.BufferJSON;

if (!initAuthCreds || !BufferJSON) {
  const authUtils = require('@whiskeysockets/baileys/lib/Utils/auth-utils');
  initAuthCreds = initAuthCreds || authUtils.initAuthCreds;
  BufferJSON = BufferJSON || authUtils.BufferJSON;
}

if (!initAuthCreds || !BufferJSON) {
  throw new Error('[mongoAuthState] Could not locate initAuthCreds/BufferJSON in @whiskeysockets/baileys.');
}

const Session = require('./sessionModel');

async function useMongoAuthState(sessionId, phoneNumber) {
  let doc = await Session.findOne({ sessionId });

  let creds;
  let keys = {};

  if (doc && doc.authState) {
    const parsed = JSON.parse(JSON.stringify(doc.authState), BufferJSON.reviver);
    creds = parsed.creds || initAuthCreds();
    keys = parsed.keys || {};
  } else {
    creds = initAuthCreds();
    doc = await Session.create({
      sessionId,
      phoneNumber,
      authState: JSON.parse(JSON.stringify({ creds, keys }, BufferJSON.replacer)),
      status: 'pending',
    });
  }

  const writeState = async () => {
    const serialized = JSON.parse(JSON.stringify({ creds, keys }, BufferJSON.replacer));
    await Session.updateOne(
      { sessionId },
      { $set: { authState: serialized, lastUpdated: new Date() } },
      { upsert: true }
    );
  };

  return {
    state: {
      creds,
      keys: {
        get: async (type, ids) => {
          const data = {};
          for (const id of ids) {
            let value = keys[type]?.[id];
            if (value) {
              if (type === 'app-state-sync-key') {
                value = proto.Message.AppStateSyncKeyData.fromObject(value);
              }
              data[id] = value;
            }
          }
          return data;
        },
        set: async (data) => {
          for (const category in data) {
            keys[category] = keys[category] || {};
            Object.assign(keys[category], data[category]);
          }
          await writeState();
        },
      },
    },
    saveCreds: writeState,
    markActive: async () => {
      await Session.updateOne({ sessionId }, { $set: { status: 'active' } });
    },
  };
}

module.exports = { useMongoAuthState };
