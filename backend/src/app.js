const express = require('express')
const cors = require('cors')
const dotenv = require('dotenv')
const fs = require('fs')
const mongoose = require('mongoose')
const path = require('path')
const authRoutes = require('./routes/authRoutes')
const promptRoutes = require('./routes/promptRoutes')
const collectionRoutes = require('./routes/collectionRoutes')
const publicRoutes = require('./routes/publicRoutes')
const importExportRoutes = require('./routes/importExportRoutes')

dotenv.config()

const app = express()
if (process.env.NODE_ENV === 'production') app.set('trust proxy', 1)
const frontendBuildPath = path.resolve(__dirname, '../../frontend/dist')
const frontendIndexPath = path.join(frontendBuildPath, 'index.html')

app.use(cors())
app.use(express.json({ limit: '1mb' }))

app.get('/', (req, res) => {
  if (fs.existsSync(frontendIndexPath)) {
    return res.sendFile(frontendIndexPath)
  }

  res.json({
    name: 'PromptVault API',
    status: 'ok',
    message: 'Use /api/health or /api/auth to access the API.',
  })
})

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    message: 'PromptVault API is running.',
    mode:
      process.env.MONGODB_URI
        ? mongoose.connection.readyState === 1
          ? 'mongodb'
          : 'disconnected'
        : 'local-file',
  })
})

app.use('/api/auth', authRoutes)
app.use('/api/public', publicRoutes)
app.use('/api/prompts', promptRoutes)
app.use('/api/collections', collectionRoutes)
app.use('/api', importExportRoutes)

app.use(express.static(frontendBuildPath))

app.use((req, res, next) => {
  if (req.method !== 'GET') return next()
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ message: 'API route not found.' })
  }
  if (!fs.existsSync(frontendIndexPath)) return next()
  return res.sendFile(frontendIndexPath)
})

app.use((req, res) => {
  res.status(404).json({ message: 'Route not found.' })
})

app.use((err, req, res, next) => {
  console.error(err)
  res.status(500).json({ message: err.message || 'Something went wrong on the server.' })
})

module.exports = app
