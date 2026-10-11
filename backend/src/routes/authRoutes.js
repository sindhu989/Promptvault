const express = require('express')
const { rateLimit } = require('express-rate-limit')
const {
  register,
  login,
  getMe,
  updateProfile,
  updatePreferences,
  changePassword,
  requestPasswordReset,
  resetPassword,
} = require('../controllers/authController')
const { protect } = require('../middleware/auth')

const router = express.Router()
const passwordResetRequestLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { message: 'Too many reset requests. Please try again later.' },
})
const passwordResetLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { message: 'Too many reset attempts. Please try again later.' },
})

router.post('/register', register)
router.post('/login', login)
router.post('/forgot-password', passwordResetRequestLimit, requestPasswordReset)
router.post('/reset-password', passwordResetLimit, resetPassword)
router.get('/me', protect, getMe)
router.put('/me', protect, updateProfile)
router.put('/preferences', protect, updatePreferences)
router.put('/password', protect, changePassword)

module.exports = router
