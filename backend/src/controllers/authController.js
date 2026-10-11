const bcrypt = require('bcryptjs')
const crypto = require('crypto')
const mongoose = require('mongoose')
const { users, save } = require('../data/store')
const { signToken } = require('../utils/jwt')
const User = require('../models/User')
const { sendPasswordResetEmail } = require('../services/passwordResetEmail')

function sanitizeUser(user) {
  if (!user) return null
  const { password, _id, ...safeUser } = user.toObject ? user.toObject() : user
  return {
    ...safeUser,
    id: safeUser.id || String(_id || safeUser._id || user.id),
  }
}

function isMongoConnected() {
  return mongoose.connection.readyState === 1
}

async function findUserByEmail(email) {
  const normalizedEmail = String(email).trim().toLowerCase()

  if (isMongoConnected()) {
    return User.findOne({ email: normalizedEmail }).lean()
  }

  return users.find((user) => user.email.toLowerCase() === normalizedEmail)
}

async function register(req, res) {
  const { name, email, password } = req.body || {}

  if (!name || !email || !password) {
    return res.status(400).json({ message: 'Name, email, and password are required.' })
  }

  if (String(password).length < 6) {
    return res.status(400).json({ message: 'Password must be at least 6 characters long.' })
  }

  const normalizedEmail = String(email).trim().toLowerCase()

  if (isMongoConnected()) {
    const existingUser = await User.findOne({ email: normalizedEmail })
    if (existingUser) {
      return res.status(409).json({ message: 'A user with this email already exists.' })
    }

    const passwordHash = await bcrypt.hash(String(password), 10)
    const newUser = await User.create({
      name: String(name).trim(),
      email: normalizedEmail,
      password: passwordHash,
    })

    const safeUser = sanitizeUser(newUser)
    return res.status(201).json({
      message: 'User registered successfully.',
      token: signToken(String(newUser._id)),
      user: safeUser,
    })
  }

  const existingUser = users.find((user) => user.email.toLowerCase() === normalizedEmail)
  if (existingUser) {
    return res.status(409).json({ message: 'A user with this email already exists.' })
  }

  const passwordHash = await bcrypt.hash(String(password), 10)
  const newUser = {
    id: `user-${Date.now()}`,
    name: String(name).trim(),
    email: normalizedEmail,
    password: passwordHash,
    createdAt: new Date().toISOString(),
  }

  users.push(newUser)
  save()

  return res.status(201).json({
    message: 'User registered successfully.',
    token: signToken(newUser.id),
    user: sanitizeUser(newUser),
  })
}

async function login(req, res) {
  const { email, password } = req.body || {}

  if (!email || !password) {
    return res.status(400).json({ message: 'Email and password are required.' })
  }

  const user = await findUserByEmail(email)
  if (!user) {
    return res.status(401).json({ message: 'Invalid email or password.' })
  }

  const isMatch = await bcrypt.compare(String(password), user.password)
  if (!isMatch) {
    return res.status(401).json({ message: 'Invalid email or password.' })
  }

  const userId = String(user._id || user.id)
  return res.json({
    message: 'Login successful.',
    token: signToken(userId),
    user: sanitizeUser(user),
  })
}

function getMe(req, res) {
  return res.json({ user: req.user })
}

async function updateProfile(req, res) {
  const name = String(req.body?.name || '').trim()
  if (!name) {
    return res.status(400).json({ message: 'Name is required.' })
  }
  if (name.length > 80) {
    return res.status(400).json({ message: 'Name cannot be longer than 80 characters.' })
  }

  if (isMongoConnected()) {
    const user = await User.findById(req.user.id)
    if (!user) return res.status(404).json({ message: 'User not found.' })
    user.name = name
    await user.save()
    return res.json({ message: 'Profile updated.', user: sanitizeUser(user) })
  }

  const user = users.find((item) => item.id === req.user.id)
  if (!user) return res.status(404).json({ message: 'User not found.' })
  user.name = name
  save()
  return res.json({ message: 'Profile updated.', user: sanitizeUser(user) })
}

async function changePassword(req, res) {
  const { currentPassword, newPassword } = req.body || {}
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ message: 'Current and new passwords are required.' })
  }
  if (String(newPassword).length < 6) {
    return res.status(400).json({ message: 'New password must be at least 6 characters long.' })
  }
  if (String(currentPassword) === String(newPassword)) {
    return res.status(400).json({ message: 'New password must be different from the current password.' })
  }

  const user = isMongoConnected()
    ? await User.findById(req.user.id)
    : users.find((item) => item.id === req.user.id)
  if (!user) return res.status(404).json({ message: 'User not found.' })

  const passwordMatches = await bcrypt.compare(String(currentPassword), user.password)
  if (!passwordMatches) {
    return res.status(401).json({ message: 'Current password is incorrect.' })
  }

  user.password = await bcrypt.hash(String(newPassword), 10)
  if (isMongoConnected()) {
    await user.save()
  } else {
    save()
  }

  return res.json({ message: 'Password changed successfully.' })
}

async function requestPasswordReset(req, res) {
  const email = String(req.body?.email || '').trim().toLowerCase()
  if (!email) {
    return res.status(400).json({ message: 'Email is required.' })
  }

  const user = await findUserByEmail(email)
  if (!user) {
    return res.json({ message: 'If an account exists, a password reset link will be sent.' })
  }

  const rawToken = crypto.randomBytes(32).toString('hex')
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex')
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000)
  user.passwordResetToken = tokenHash
  user.passwordResetExpires = expiresAt

  if (isMongoConnected()) {
    await user.save()
  } else {
    user.passwordResetExpires = expiresAt.toISOString()
    save()
  }

  const appUrl =
    process.env.APP_URL ||
    process.env.RENDER_EXTERNAL_URL ||
    (process.env.NODE_ENV === 'production' ? '' : 'http://localhost:4173')

  try {
    if (!appUrl) throw new Error('APP_URL is required to send password reset links.')
    const resetUrl = new URL('/', appUrl)
    if (process.env.NODE_ENV === 'production' && resetUrl.protocol !== 'https:') {
      throw new Error('APP_URL must use HTTPS in production.')
    }
    resetUrl.searchParams.set('resetToken', rawToken)
    await sendPasswordResetEmail(user.email, user.name, resetUrl.toString())
  } catch (error) {
    user.passwordResetToken = undefined
    user.passwordResetExpires = undefined
    if (isMongoConnected()) {
      await user.save()
    } else {
      save()
    }
    console.error('Could not send password reset email:', error.message)
    return res.status(503).json({
      message: 'Password reset email could not be sent. Please try again later.',
    })
  }

  return res.json({ message: 'If an account exists, a password reset link will be sent.' })
}

async function resetPassword(req, res) {
  const token = String(req.body?.token || '')
  const newPassword = String(req.body?.newPassword || '')
  if (!token || !newPassword) {
    return res.status(400).json({ message: 'Reset token and new password are required.' })
  }
  if (newPassword.length < 6) {
    return res.status(400).json({ message: 'New password must be at least 6 characters long.' })
  }

  const tokenHash = crypto.createHash('sha256').update(token).digest('hex')
  const now = new Date()
  const user = isMongoConnected()
    ? await User.findOne({
        passwordResetToken: tokenHash,
        passwordResetExpires: { $gt: now },
      })
    : users.find(
        (item) =>
          item.passwordResetToken === tokenHash &&
          new Date(item.passwordResetExpires) > now,
      )

  if (!user) {
    return res.status(400).json({ message: 'This password reset link is invalid or has expired.' })
  }

  user.password = await bcrypt.hash(newPassword, 10)
  user.passwordResetToken = undefined
  user.passwordResetExpires = undefined
  if (isMongoConnected()) {
    await user.save()
  } else {
    save()
  }

  return res.json({ message: 'Password reset successfully. You can now log in.' })
}

module.exports = {
  register,
  login,
  getMe,
  updateProfile,
  changePassword,
  requestPasswordReset,
  resetPassword,
}
