const bcrypt = require('bcryptjs')
const crypto = require('crypto')
const mongoose = require('mongoose')
const { users, adminSessions, save } = require('../data/store')
const { signAdminToken } = require('../utils/jwt')
const User = require('../models/User')
const AdminSession = require('../models/AdminSession')
const { setAdminCookie } = require('../utils/authCookie')

const ADMIN_SESSION_DURATION_MS = 30 * 60 * 1000

function matchesBootstrapSecret(suppliedSecret, configuredSecret) {
  if (!suppliedSecret || !configuredSecret || configuredSecret.length < 32) return false
  const supplied = Buffer.from(String(suppliedSecret))
  const configured = Buffer.from(configuredSecret)
  return supplied.length === configured.length && crypto.timingSafeEqual(supplied, configured)
}

function sanitizeAdmin(user) {
  return {
    id: String(user._id || user.id),
    name: user.name,
    email: user.email,
    role: 'admin',
  }
}

async function login(req, res, next) {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase()
    const password = req.body?.password
    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password are required.' })
    }

    const mongoConnected = mongoose.connection.readyState === 1
    const user = mongoConnected
      ? await User.findOne({ email })
      : users.find((item) => item.email.toLowerCase() === email)
    if (!user || !(await bcrypt.compare(String(password), user.password))) {
      return res.status(401).json({ message: 'Invalid email or password.' })
    }

    const bootstrapEmail = String(process.env.ADMIN_EMAIL || '').trim().toLowerCase()
    if (user.role !== 'admin') {
      if (
        !bootstrapEmail ||
        bootstrapEmail !== email ||
        !matchesBootstrapSecret(req.body?.bootstrapSecret, process.env.ADMIN_BOOTSTRAP_SECRET)
      ) {
        return res.status(403).json({ message: 'This account is not authorized for admin access.' })
      }
      user.role = 'admin'
      if (mongoConnected) await user.save()
      else save()
    }

    const tokenId = crypto.randomUUID()
    const expiresAt = new Date(Date.now() + ADMIN_SESSION_DURATION_MS)
    const userId = String(user._id || user.id)
    if (mongoConnected) {
      await AdminSession.create({ userId, tokenId, expiresAt })
    } else {
      adminSessions.push({
        userId,
        tokenId,
        expiresAt: expiresAt.toISOString(),
        revokedAt: null,
      })
      save()
    }

    setAdminCookie(res, signAdminToken(userId, tokenId))
    return res.json({
      message: 'Admin login successful.',
      expiresAt: expiresAt.toISOString(),
      user: sanitizeAdmin(user),
    })
  } catch (error) {
    return next(error)
  }
}

function getMe(req, res) {
  return res.json({ user: req.user })
}

module.exports = { login, getMe }
