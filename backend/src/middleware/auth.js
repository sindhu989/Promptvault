const mongoose = require('mongoose')
const { verifyToken } = require('../utils/jwt')
const { users } = require('../data/store')
const User = require('../models/User')

async function protect(req, res, next) {
  try {
    const authHeader = req.headers.authorization || ''
    const token = authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : null

    if (!token) {
      return res.status(401).json({ message: 'Authentication required.' })
    }

    const decoded = verifyToken(token)

    if (mongoose.connection.readyState === 1) {
      const user = await User.findById(decoded.id).lean()
      if (!user) {
        return res.status(401).json({ message: 'User not found.' })
      }

      req.user = {
        id: String(user._id),
        name: user.name,
        email: user.email,
        theme: user.theme === 'dark' ? 'dark' : 'light',
      }
      return next()
    }

    const user = users.find((item) => item.id === decoded.id)
    if (!user) {
      return res.status(401).json({ message: 'User not found.' })
    }

    req.user = {
      id: user.id,
      name: user.name,
      email: user.email,
      theme: user.theme === 'dark' ? 'dark' : 'light',
    }
    return next()
  } catch (error) {
    return res.status(401).json({ message: 'Invalid or expired token.' })
  }
}

module.exports = { protect }
