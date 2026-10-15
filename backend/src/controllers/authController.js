const bcrypt = require('bcryptjs')
const crypto = require('crypto')
const mongoose = require('mongoose')
const { users, save } = require('../data/store')
const { signToken } = require('../utils/jwt')
const { verifyPassword } = require('../utils/passwordVerification')
const User = require('../models/User')
const { sendPasswordResetEmail } = require('../services/passwordResetEmail')
const { setUserCookie, clearUserCookie } = require('../utils/authCookie')

const MIN_PASSWORD_LENGTH = 12
const MAX_PASSWORD_BYTES = 72

function getPasswordError(password, label = 'Password') {
  const value = String(password)
  if (value.length < MIN_PASSWORD_LENGTH) {
    return `${label} must be at least ${MIN_PASSWORD_LENGTH} characters long.`
  }
  if (Buffer.byteLength(value, 'utf8') > MAX_PASSWORD_BYTES) {
    return `${label} cannot be longer than ${MAX_PASSWORD_BYTES} UTF-8 bytes.`
  }
  return null
}

function sanitizeUser(user) {
  if (!user) return null
  const safeUser = user.toObject ? user.toObject() : user
  return {
    id: safeUser.id || String(safeUser._id || user.id),
    name: safeUser.name,
    email: safeUser.email,
    role: safeUser.role === 'admin' ? 'admin' : 'user',
    status: safeUser.status,
    theme: safeUser.theme === 'dark' ? 'dark' : 'light',
    ...(safeUser.createdAt !== undefined && { createdAt: safeUser.createdAt }),
    ...(safeUser.updatedAt !== undefined && { updatedAt: safeUser.updatedAt }),
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

  const passwordError = getPasswordError(password)
  if (passwordError) return res.status(400).json({ message: passwordError })

  const normalizedEmail = String(email).trim().toLowerCase()
  if (normalizedEmail.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
    return res.status(400).json({ message: 'Enter a valid email address.' })
  }
  const normalizedName = String(name).trim()
  if (!normalizedName || normalizedName.length > 80) {
    return res.status(400).json({ message: 'Name must be between 1 and 80 characters.' })
  }

  if (isMongoConnected()) {
    const passwordHash = await bcrypt.hash(String(password), 10)
    let newUser
    try {
      newUser = await User.create({
        name: normalizedName,
        email: normalizedEmail,
        password: passwordHash,
      })
    } catch (error) {
      if (error.code === 11000) {
        return res.status(409).json({ message: 'A user with this email already exists.' })
      }
      throw error
    }

    const safeUser = sanitizeUser(newUser)
    setUserCookie(res, signToken(String(newUser._id), newUser.authVersion))
    return res.status(201).json({
      message: 'User registered successfully.',
      user: safeUser,
    })
  }

  const existingUser = users.find((user) => user.email.toLowerCase() === normalizedEmail)
  if (existingUser) {
    return res.status(409).json({ message: 'A user with this email already exists.' })
  }

  const passwordHash = await bcrypt.hash(String(password), 10)
  const newUser = {
    id: `user-${crypto.randomUUID()}`,
    name: normalizedName,
    email: normalizedEmail,
    password: passwordHash,
    role: 'user',
    status: 'active',
    authVersion: 0,
    createdAt: new Date().toISOString(),
  }

  users.push(newUser)
  save()

  setUserCookie(res, signToken(newUser.id, newUser.authVersion))
  return res.status(201).json({
    message: 'User registered successfully.',
    user: sanitizeUser(newUser),
  })
}

async function login(req, res) {
  const { email, password } = req.body || {}

  if (
    typeof email !== 'string' ||
    !email.trim() ||
    email.length > 254 ||
    typeof password !== 'string' ||
    !password ||
    Buffer.byteLength(password, 'utf8') > MAX_PASSWORD_BYTES
  ) {
    return res.status(400).json({ message: 'Email and password are required.' })
  }

  const user = await findUserByEmail(email)
  if (!(await verifyPassword(password, user?.password))) {
    return res.status(401).json({ message: 'Invalid email or password.' })
  }
  if (user.status === 'suspended' || user.status === 'deactivated') {
    return res.status(403).json({ message: 'This account is not active.' })
  }

  const userId = String(user._id || user.id)
  setUserCookie(res, signToken(userId, user.authVersion))
  return res.json({
    message: 'Login successful.',
    user: sanitizeUser(user),
  })
}

function getMe(req, res) {
  return res.json({ user: req.user })
}

function logout(req, res) {
  clearUserCookie(res)
  return res.json({ message: 'Session ended.' })
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

async function updatePreferences(req, res) {
  const { theme } = req.body || {}
  if (!['light', 'dark'].includes(theme)) {
    return res.status(400).json({ message: 'Theme must be light or dark.' })
  }

  const user = isMongoConnected()
    ? await User.findById(req.user.id)
    : users.find((item) => item.id === req.user.id)
  if (!user) return res.status(404).json({ message: 'User not found.' })

  user.theme = theme
  if (isMongoConnected()) {
    await user.save()
  } else {
    save()
  }
  return res.json({ message: 'Preferences updated.', user: sanitizeUser(user) })
}

async function changePassword(req, res) {
  const { currentPassword, newPassword } = req.body || {}
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ message: 'Current and new passwords are required.' })
  }
  const passwordError = getPasswordError(newPassword, 'New password')
  if (passwordError) return res.status(400).json({ message: passwordError })
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
  user.authVersion = (user.authVersion || 0) + 1
  if (isMongoConnected()) {
    await user.save()
  } else {
    save()
  }

  clearUserCookie(res)
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
    return res.json({ message: 'If an account exists, a password reset link will be sent.' })
  }

  return res.json({ message: 'If an account exists, a password reset link will be sent.' })
}

async function resetPassword(req, res) {
  const token = req.body?.token
  const newPassword = req.body?.newPassword
  if (
    typeof token !== 'string' ||
    !/^[a-f0-9]{64}$/i.test(token) ||
    typeof newPassword !== 'string' ||
    !newPassword
  ) {
    return res.status(400).json({ message: 'Reset token and new password are required.' })
  }
  const passwordError = getPasswordError(newPassword, 'New password')
  if (passwordError) return res.status(400).json({ message: passwordError })

  const tokenHash = crypto.createHash('sha256').update(token).digest('hex')
  const mongoConnected = isMongoConnected()
  let user
  if (mongoConnected) {
    const resetTokenOwner = await User.findOne({
        passwordResetToken: tokenHash,
        passwordResetExpires: { $gt: new Date() },
      }).select('_id').lean()
    if (!resetTokenOwner) {
      return res.status(400).json({ message: 'This password reset link is invalid or has expired.' })
    }

    const passwordHash = await bcrypt.hash(newPassword, 10)
    user = await User.findOneAndUpdate(
      {
        _id: resetTokenOwner._id,
        passwordResetToken: tokenHash,
        passwordResetExpires: { $gt: new Date() },
      },
      {
        $set: { password: passwordHash },
        $unset: { passwordResetToken: 1, passwordResetExpires: 1 },
        $inc: { authVersion: 1 },
      },
      { new: true, runValidators: true },
    ).lean()
  } else {
    const tokenIsValid = (item) =>
      item.passwordResetToken === tokenHash &&
      new Date(item.passwordResetExpires) > new Date()
    const resetTokenOwner = users.find(tokenIsValid)
    if (!resetTokenOwner) {
      return res.status(400).json({ message: 'This password reset link is invalid or has expired.' })
    }

    const passwordHash = await bcrypt.hash(newPassword, 10)
    user = users.find((item) => item.id === resetTokenOwner.id && tokenIsValid(item))
    if (user) {
      user.password = passwordHash
      user.authVersion = (user.authVersion || 0) + 1
      user.passwordResetToken = undefined
      user.passwordResetExpires = undefined
    }
  }

  if (!user) {
    return res.status(400).json({ message: 'This password reset link is invalid or has expired.' })
  }

  if (!mongoConnected) save()

  clearUserCookie(res)
  return res.json({ message: 'Password reset successfully. You can now log in.' })
}

module.exports = {
  register,
  login,
  logout,
  getMe,
  updateProfile,
  updatePreferences,
  changePassword,
  requestPasswordReset,
  resetPassword,
}
