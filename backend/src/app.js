const express = require('express')
const cors = require('cors')
const cookieParser = require('cookie-parser')
const { rateLimit } = require('express-rate-limit')
const dotenv = require('dotenv')
dotenv.config()

const fs = require('fs')
const helmet = require('helmet')
const mongoose = require('mongoose')
const path = require('path')
const { MongoRateLimitStore } = require('./middleware/mongoRateLimitStore')
const authRoutes = require('./routes/authRoutes')
const promptRoutes = require('./routes/promptRoutes')
const collectionRoutes = require('./routes/collectionRoutes')
const publicRoutes = require('./routes/publicRoutes')
const importExportRoutes = require('./routes/importExportRoutes')
const activityRoutes = require('./routes/activityRoutes')
const adminAuthRoutes = require('./routes/adminAuthRoutes')
const adminDashboardRoutes = require('./routes/adminDashboardRoutes')

const app = express()
if (process.env.NODE_ENV === 'production') app.set('trust proxy', 1)
const apiRateLimitStore = process.env.MONGODB_URI
  ? new MongoRateLimitStore()
  : undefined
const frontendBuildPath = path.resolve(__dirname, '../../frontend/dist')
const frontendIndexPath = path.join(frontendBuildPath, 'index.html')
const allowedOrigins = new Set([
  'http://localhost:4173',
  'http://127.0.0.1:4173',
  process.env.APP_URL,
  process.env.RENDER_EXTERNAL_URL,
  ...(process.env.CORS_ORIGINS || '').split(',').map((origin) => origin.trim()),
].filter(Boolean).map((origin) => {
  try {
    return new URL(origin).origin
  } catch {
    throw new Error(`Invalid origin configured for CORS: ${origin}`)
  }
}))

app.use(helmet({
  xFrameOptions: { action: 'deny' },
  contentSecurityPolicy: {
    directives: {
      ...helmet.contentSecurityPolicy.getDefaultDirectives(),
      'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      'font-src': ["'self'", 'data:', 'https://fonts.gstatic.com'],
      'connect-src': ["'self'", ...allowedOrigins],
      'frame-ancestors': ["'none'"],
    },
  },
}))
app.use('/api', (req, res, next) => {
  res.set('Cache-Control', 'no-store')
  return next()
})
app.use(cors({
  origin: (origin, callback) => callback(null, !origin || allowedOrigins.has(origin)),
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
}))
app.use((req, res, next) => {
  const origin = req.get('origin')
  if (origin && !allowedOrigins.has(origin)) {
    return res.status(403).json({ message: 'Request origin is not allowed.' })
  }
  return next()
})
app.use(cookieParser())
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
  const databaseConnected = mongoose.connection.readyState === 1
  const mode = process.env.MONGODB_URI
    ? databaseConnected
      ? 'mongodb'
      : 'disconnected'
    : 'local-file'

  res.status(mode === 'disconnected' ? 503 : 200).json({
    status: mode === 'disconnected' ? 'error' : 'ok',
    message: mode === 'disconnected'
      ? 'PromptVault database is unavailable.'
      : 'PromptVault API is running.',
    mode,
  })
})

app.use('/api', (req, res, next) => {
  if (process.env.MONGODB_URI && mongoose.connection.readyState !== 1) {
    return res.status(503).json({
      message: 'PromptVault database is unavailable.',
    })
  }
  return next()
})

app.use('/api', rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  store: apiRateLimitStore,
  message: { message: 'Too many requests. Please try again later.' },
}))

app.use('/api/auth', authRoutes)
app.use('/api/admin/auth', adminAuthRoutes)
app.use('/api/admin/dashboard', adminDashboardRoutes)
app.use('/api/public', publicRoutes)
app.use('/api/prompts', promptRoutes)
app.use('/api/collections', collectionRoutes)
app.use('/api/activity', activityRoutes)
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
  if (res.headersSent) return next(err)
  const status = Number.isInteger(err.status) && err.status >= 400 && err.status < 500
    ? err.status
    : 500
  if (status >= 500) console.error(err)
  const message =
    err.type === 'entity.parse.failed'
      ? 'Request body contains invalid JSON.'
      : status === 413
        ? 'Request body is too large.'
        : 'Something went wrong on the server.'
  return res.status(status).json({ message })
})

module.exports = app
