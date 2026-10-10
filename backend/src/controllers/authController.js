const bcrypt = require('bcryptjs')
const mongoose = require('mongoose')
const { users, save } = require('../data/store')
const { signToken } = require('../utils/jwt')
const User = require('../models/User')

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

module.exports = { register, login, getMe }
