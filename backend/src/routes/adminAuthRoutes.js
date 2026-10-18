const express = require('express')
const { rateLimit } = require('express-rate-limit')
const { MongoRateLimitStore } = require('../middleware/mongoRateLimitStore')
const { login, getMe } = require('../controllers/adminAuthController')
const { protectAdmin, revokeAdminSession } = require('../middleware/adminAuth')

const router = express.Router()
const adminLoginLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  store: process.env.MONGODB_URI
    ? new MongoRateLimitStore({ namespace: 'admin-login' })
    : undefined,
  message: { message: 'Too many admin login attempts. Please try again later.' },
})

router.post('/login', adminLoginLimit, login)
router.get('/me', protectAdmin, getMe)
router.post('/logout', protectAdmin, revokeAdminSession)

module.exports = router
