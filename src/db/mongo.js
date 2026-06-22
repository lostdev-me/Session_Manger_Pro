const mongoose = require('mongoose');

let isConnected = false;

async function connectMongo() {
  if (isConnected) return mongoose.connection;

  const uri = process.env.MONGO_URI;
  if (!uri) {
    throw new Error('MONGO_URI is missing from environment variables.');
  }

  mongoose.set('strictQuery', true);

  await mongoose.connect(uri, {
    serverSelectionTimeoutMS: 15000,
  });

  isConnected = true;
  console.log('[mongo] connected');

  mongoose.connection.on('disconnected', () => {
    isConnected = false;
    console.warn('[mongo] disconnected');
  });

  mongoose.connection.on('error', (err) => {
    console.error('[mongo] connection error:', err.message);
  });

  return mongoose.connection;
}

module.exports = { connectMongo };
