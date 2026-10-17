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
const PASSWORD_RESET_OTP_TTL_MS = 15 * 60 * 1000
const PASSWORD_RESET_OTP_MAX_ATTEMPTS = 5

function hashPasswordResetOtp(userId, otp) {
  const secret = process.env.JWT_SECRET || (
    process.env.NODE_ENV === 'production' ? '' : 'dev-secret'
  )
  if (!secret) throw new Error('JWT_SECRET must be configured in production.')
  return crypto
    .createHmac('sha256', secret)
    .update(`${userId}:${otp}`)
    .digest('hex')
}

function isSameHash(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false
  const leftBuffer = Buffer.from(left, 'hex')
  const rightBuffer = Buffer.from(right, 'hex')
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer)
}

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
    return res.status(401).json({ message: 'Invalid email or password.' })
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
    return res.json({ message: 'If an account exists, a password reset code will be sent.' })
  }

  const otp = crypto.randomInt(100000, 1000000).toString()
  const otpHash = hashPasswordResetOtp(user._id || user.id, otp)
  const expiresAt = new Date(Date.now() + PASSWORD_RESET_OTP_TTL_MS)
  user.passwordResetOtpHash = otpHash
  user.passwordResetOtpAttempts = 0
  user.passwordResetExpires = expiresAt

  if (isMongoConnected()) {
    await User.updateOne(
      { _id: user._id },
      {
        $set: {
          passwordResetOtpHash: otpHash,
          passwordResetOtpAttempts: 0,
          passwordResetExpires: expiresAt,
        },
        $unset: { passwordResetToken: 1 },
      },
    )
  } else {
    user.passwordResetToken = undefined
    user.passwordResetExpires = expiresAt.toISOString()
    save()
  }

  try {
    await sendPasswordResetEmail(user.email, user.name, otp)
  } catch (error) {
    user.passwordResetOtpHash = undefined
    user.passwordResetOtpAttempts = 0
    user.passwordResetToken = undefined
    user.passwordResetExpires = undefined
    if (isMongoConnected()) {
      await User.updateOne(
        { _id: user._id, passwordResetOtpHash: otpHash },
        {
          $unset: {
            passwordResetOtpHash: 1,
            passwordResetExpires: 1,
            passwordResetToken: 1,
          },
          $set: { passwordResetOtpAttempts: 0 },
        },
      )
    } else {
      save()
    }
    console.error('Could not send password reset email:', error.message)
    return res.json({ message: 'If an account exists, a password reset code will be sent.' })
  }

  return res.json({ message: 'If an account exists, a password reset code will be sent.' })
}

async function resetPassword(req, res) {
  const email = String(req.body?.email || '').trim().toLowerCase()
  const otp = req.body?.otp
  const newPassword = req.body?.newPassword
  if (
    !email ||
    typeof otp !== 'string' ||
    !/^\d{6}$/.test(otp) ||
    typeof newPassword !== 'string' ||
    !newPassword
  ) {
    return res.status(400).json({ message: 'Email, six-digit reset code, and new password are required.' })
  }
  const passwordError = getPasswordError(newPassword, 'New password')
  if (passwordError) return res.status(400).json({ message: passwordError })

  const mongoConnected = isMongoConnected()
  let user
  if (mongoConnected) {
    const candidate = await User.findOne({
      email,
      passwordResetExpires: { $gt: new Date() },
      passwordResetOtpAttempts: { $lt: PASSWORD_RESET_OTP_MAX_ATTEMPTS },
    }).select('_id passwordResetOtpHash').lean()
    if (!candidate) {
      return res.status(400).json({ message: 'This reset code is invalid or has expired.' })
    }

    const otpHash = hashPasswordResetOtp(candidate._id, otp)
    if (!isSameHash(candidate.passwordResetOtpHash, otpHash)) {
      await User.updateOne(
        {
          _id: candidate._id,
          passwordResetExpires: { $gt: new Date() },
          passwordResetOtpAttempts: { $lt: PASSWORD_RESET_OTP_MAX_ATTEMPTS },
        },
        { $inc: { passwordResetOtpAttempts: 1 } },
      )
      return res.status(400).json({ message: 'This reset code is invalid or has expired.' })
    }

    const passwordHash = await bcrypt.hash(newPassword, 10)
    user = await User.findOneAndUpdate(
      {
        _id: candidate._id,
        passwordResetOtpHash: candidate.passwordResetOtpHash,
        passwordResetExpires: { $gt: new Date() },
        passwordResetOtpAttempts: { $lt: PASSWORD_RESET_OTP_MAX_ATTEMPTS },
      },
      {
        $set: { password: passwordHash, passwordResetOtpAttempts: 0 },
        $unset: {
          passwordResetOtpHash: 1,
          passwordResetExpires: 1,
          passwordResetToken: 1,
        },
        $inc: { authVersion: 1 },
      },
      { new: true, runValidators: true },
    ).lean()
  } else {
    const candidate = users.find((item) =>
      item.email.toLowerCase() === email &&
      item.passwordResetOtpHash &&
      new Date(item.passwordResetExpires) > new Date() &&
      (item.passwordResetOtpAttempts || 0) < PASSWORD_RESET_OTP_MAX_ATTEMPTS,
    )
    if (!candidate) {
      return res.status(400).json({ message: 'This reset code is invalid or has expired.' })
    }

    const candidateOtpHash = candidate.passwordResetOtpHash
    const otpHash = hashPasswordResetOtp(candidate.id, otp)
    if (!isSameHash(candidateOtpHash, otpHash)) {
      candidate.passwordResetOtpAttempts = (candidate.passwordResetOtpAttempts || 0) + 1
      save()
      return res.status(400).json({ message: 'This reset code is invalid or has expired.' })
    }

    const passwordHash = await bcrypt.hash(newPassword, 10)
    user = users.find((item) =>
      item.id === candidate.id &&
      item.passwordResetOtpHash === candidateOtpHash &&
      new Date(item.passwordResetExpires) > new Date() &&
      (item.passwordResetOtpAttempts || 0) < PASSWORD_RESET_OTP_MAX_ATTEMPTS,
    )
    if (user) {
      user.password = passwordHash
      user.authVersion = (user.authVersion || 0) + 1
      user.passwordResetOtpHash = undefined
      user.passwordResetOtpAttempts = 0
      user.passwordResetExpires = undefined
    }
  }

  if (!user) {
    return res.status(400).json({ message: 'This reset code is invalid or has expired.' })
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
