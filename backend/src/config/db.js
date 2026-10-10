const mongoose = require('mongoose')

async function connectDB() {
  const mongoUri = process.env.MONGODB_URI

  if (!mongoUri) {
    console.log('MONGODB_URI not set. Using persistent local JSON storage for development.')
    return
  }

  await mongoose.connect(mongoUri)
  console.log('MongoDB connected successfully.')
}

async function disconnectDB() {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect()
  }
}

module.exports = { connectDB, disconnectDB }
