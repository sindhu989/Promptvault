const mongoose = require('mongoose')
const { verifyToken } = require('../utils/jwt')
const { userCookieName } = require('../utils/authCookie')
const { users } = require('../data/store')
const User = require('../models/User')

async function protect(req, res, next) {
  try {
    const token = req.cookies?.[userCookieName]

    if (!token) {
      return res.status(401).json({ message: 'Authentication required.' })
    }

    const decoded = verifyToken(token)
    if (
      decoded.scope ||
      decoded.aud !== 'promptvault-user' ||
      typeof decoded.id !== 'string'
    ) {
      return res.status(401).json({ message: 'Invalid or expired token.' })
    }

    if (mongoose.connection.readyState === 1) {
      const user = await User.findById(decoded.id).lean()
      if (!user || (decoded.version || 0) !== (user.authVersion || 0)) {
        return res.status(401).json({ message: 'User not found.' })
      }

      req.user = {
        id: String(user._id),
        name: user.name,
        email: user.email,
        role: user.role === 'admin' ? 'admin' : 'user',
        theme: user.theme === 'dark' ? 'dark' : 'light',
      }
      return next()
    }

    const user = users.find((item) => item.id === decoded.id)
    if (!user || (decoded.version || 0) !== (user.authVersion || 0)) {
      return res.status(401).json({ message: 'User not found.' })
    }

    req.user = {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role === 'admin' ? 'admin' : 'user',
      theme: user.theme === 'dark' ? 'dark' : 'light',
    }
    return next()
  } catch (error) {
    if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
      return res.status(401).json({ message: 'Invalid or expired session.' })
    }
    return next(error)
  }
}

module.exports = { protect }
