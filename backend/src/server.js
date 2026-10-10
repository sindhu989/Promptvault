const app = require('./app')
const { connectDB, disconnectDB } = require('./config/db')

const PORT = process.env.PORT || 5000

async function startServer() {
  if (process.env.NODE_ENV === 'production') {
    if (!process.env.MONGODB_URI) {
      throw new Error('MONGODB_URI is required in production to persist application data.')
    }
    if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
      throw new Error('JWT_SECRET must contain at least 32 characters in production.')
    }
  }

  await connectDB()

  const server = app.listen(PORT, () => {
    console.log(`PromptVault API listening on http://localhost:${PORT}`)
  })

  let shuttingDown = false
  async function shutdown() {
    if (shuttingDown) return
    shuttingDown = true
    server.close(async () => {
      await disconnectDB()
      process.exit(0)
    })
  }

  process.once('SIGINT', shutdown)
  process.once('SIGTERM', shutdown)
  process.once('SIGUSR2', shutdown)
}

startServer().catch((error) => {
  console.error('PromptVault could not start:', error)
  process.exit(1)
})
