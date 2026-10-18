const express = require('express')
const { rateLimit } = require('express-rate-limit')
const { MongoRateLimitStore } = require('../middleware/mongoRateLimitStore')
const {
  register,
  login,
  logout,
  getMe,
  updateProfile,
  updatePreferences,
  changePassword,
  requestPasswordReset,
  resetPassword,
} = require('../controllers/authController')
const { protect } = require('../middleware/auth')

const router = express.Router()
function createAuthRateLimitStore(namespace) {
  return process.env.MONGODB_URI
    ? new MongoRateLimitStore({ namespace })
    : undefined
}

const authAttemptLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  store: createAuthRateLimitStore('user-login'),
  message: { message: 'Too many authentication attempts. Please try again later.' },
})
const registrationLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  store: createAuthRateLimitStore('user-registration'),
  message: { message: 'Too many registration attempts. Please try again later.' },
})
const passwordResetRequestLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  store: createAuthRateLimitStore('password-reset-request'),
  message: { message: 'Too many reset requests. Please try again later.' },
})
const passwordResetLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  store: createAuthRateLimitStore('password-reset-submit'),
  message: { message: 'Too many reset attempts. Please try again later.' },
})

router.post('/register', registrationLimit, register)
router.post('/login', authAttemptLimit, login)
router.post('/logout', logout)
router.post('/forgot-password', passwordResetRequestLimit, requestPasswordReset)
router.post('/reset-password', passwordResetLimit, resetPassword)
router.get('/me', protect, getMe)
router.put('/me', protect, updateProfile)
router.put('/preferences', protect, updatePreferences)
router.put('/password', protect, changePassword)

module.exports = router
