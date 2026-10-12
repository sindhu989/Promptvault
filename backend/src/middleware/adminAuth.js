const mongoose = require('mongoose')
const { verifyToken } = require('../utils/jwt')
const { adminCookieName, clearAdminCookie } = require('../utils/authCookie')
const { users, adminSessions, save } = require('../data/store')
const User = require('../models/User')
const AdminSession = require('../models/AdminSession')

async function protectAdmin(req, res, next) {
  const token = req.cookies?.[adminCookieName]
  if (!token) return res.status(401).json({ message: 'Admin authentication required.' })

  let decoded
  try {
    decoded = verifyToken(token)
  } catch {
    return res.status(401).json({ message: 'Admin session is invalid or expired.' })
  }

  if (decoded.scope !== 'admin' || !decoded.jti || decoded.aud !== 'promptvault-admin') {
    return res.status(401).json({ message: 'Admin session is invalid or expired.' })
  }

  try {
    if (mongoose.connection.readyState === 1) {
      const [user, session] = await Promise.all([
        User.findById(decoded.id).lean(),
        AdminSession.findOne({
          tokenId: decoded.jti,
          userId: decoded.id,
          revokedAt: null,
          expiresAt: { $gt: new Date() },
        }).lean(),
      ])
      if (
        !user ||
        user.role !== 'admin' ||
        user.status === 'suspended' ||
        user.status === 'deactivated' ||
        (decoded.version || 0) !== (user.authVersion || 0) ||
        !session
      ) {
        return res.status(401).json({ message: 'Admin session is invalid or expired.' })
      }
      req.user = { id: String(user._id), name: user.name, email: user.email, role: user.role }
      req.adminSession = { tokenId: session.tokenId }
      return next()
    }

    const user = users.find((item) => item.id === decoded.id)
    const session = adminSessions.find(
      (item) =>
        item.tokenId === decoded.jti &&
        item.userId === decoded.id &&
        !item.revokedAt &&
        new Date(item.expiresAt) > new Date(),
    )
    if (
      !user ||
      user.role !== 'admin' ||
      user.status === 'suspended' ||
      user.status === 'deactivated' ||
      (decoded.version || 0) !== (user.authVersion || 0) ||
      !session
    ) {
      return res.status(401).json({ message: 'Admin session is invalid or expired.' })
    }

    req.user = { id: user.id, name: user.name, email: user.email, role: user.role }
    req.adminSession = session
    return next()
  } catch (error) {
    return next(error)
  }
}

async function revokeAdminSession(req, res, next) {
  try {
    if (mongoose.connection.readyState === 1) {
      await AdminSession.updateOne(
        { tokenId: req.adminSession.tokenId, userId: req.user.id, revokedAt: null },
        { $set: { revokedAt: new Date() } },
      )
    } else {
      req.adminSession.revokedAt = new Date().toISOString()
      save()
    }
    clearAdminCookie(res)
    return res.json({ message: 'Admin session ended.' })
  } catch (error) {
    return next(error)
  }
}

module.exports = { protectAdmin, revokeAdminSession }
