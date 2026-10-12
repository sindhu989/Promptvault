const mongoose = require('mongoose')
const { users, prompts, collections, activities, adminSessions, save } = require('../data/store')
const User = require('../models/User')
const Prompt = require('../models/Prompt')
const Collection = require('../models/Collection')
const Activity = require('../models/Activity')
const AdminSession = require('../models/AdminSession')
const { recordActivity } = require('../services/activityLog')

const PAGE_SIZE = 25
const MAX_PAGE = 10000
const USER_STATUSES = new Set(['active', 'deactivated', 'suspended'])
const USER_ROLES = new Set(['user', 'admin'])

function safeUser(user, promptCount = 0) {
  const id = String(user._id || user.id)
  return {
    id,
    name: user.name,
    email: user.email,
    role: user.role === 'admin' ? 'admin' : 'user',
    status: USER_STATUSES.has(user.status) ? user.status : 'active',
    theme: user.theme === 'dark' ? 'dark' : 'light',
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    promptCount,
  }
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function parseFilters(query) {
  const page = Number.parseInt(query.page || '1', 10)
  const search = String(query.search || '').trim().slice(0, 100)
  const status = String(query.status || '')
  const role = String(query.role || '')
  if (!Number.isInteger(page) || page < 1 || page > MAX_PAGE) {
    return { error: 'Page number is invalid.' }
  }
  if (status && !USER_STATUSES.has(status)) return { error: 'User status filter is invalid.' }
  if (role && !USER_ROLES.has(role)) return { error: 'User role filter is invalid.' }
  return { page, search, status, role }
}

function matchesSearch(user, search) {
  if (!search) return true
  const normalized = search.toLowerCase()
  return user.name.toLowerCase().includes(normalized) || user.email.toLowerCase().includes(normalized)
}

async function listUsers(req, res, next) {
  try {
    const filters = parseFilters(req.query)
    if (filters.error) return res.status(400).json({ message: filters.error })
    const { page, search, status, role } = filters
    const skip = (page - 1) * PAGE_SIZE

    if (mongoose.connection.readyState === 1) {
      const conditions = []
      if (status === 'active') conditions.push({ $or: [{ status: 'active' }, { status: { $exists: false } }] })
      else if (status) conditions.push({ status })
      if (role === 'user') conditions.push({ $or: [{ role: 'user' }, { role: { $exists: false } }] })
      else if (role) conditions.push({ role })
      if (search) {
        const safeSearch = new RegExp(escapeRegex(search), 'i')
        conditions.push({ $or: [{ name: safeSearch }, { email: safeSearch }] })
      }
      const filter = conditions.length ? { $and: conditions } : {}
      const [total, pageUsers] = await Promise.all([
        User.countDocuments(filter),
        User.find(filter)
          .sort({ createdAt: -1, _id: -1 })
          .skip(skip)
          .limit(PAGE_SIZE)
          .select('-password -passwordResetToken -passwordResetExpires')
          .lean(),
      ])
      const promptCounts = await Prompt.aggregate([
        { $match: { userId: { $in: pageUsers.map((user) => String(user._id)) } } },
        { $group: { _id: '$userId', count: { $sum: 1 } } },
      ])
      const counts = new Map(promptCounts.map((entry) => [entry._id, entry.count]))
      return res.json({
        users: pageUsers.map((user) => safeUser(user, counts.get(String(user._id)) || 0)),
        pagination: { page, pageSize: PAGE_SIZE, total, pages: Math.ceil(total / PAGE_SIZE) },
      })
    }

    let results = users.filter((user) => matchesSearch(user, search))
    if (status) results = results.filter((user) => (USER_STATUSES.has(user.status) ? user.status : 'active') === status)
    if (role) results = results.filter((user) => (user.role === 'admin' ? 'admin' : 'user') === role)
    results.sort((first, second) => new Date(second.createdAt) - new Date(first.createdAt))
    const total = results.length
    const pageUsers = results.slice(skip, skip + PAGE_SIZE)
    const promptCounts = new Map()
    for (const prompt of prompts) {
      promptCounts.set(prompt.userId, (promptCounts.get(prompt.userId) || 0) + 1)
    }
    return res.json({
      users: pageUsers.map((user) => safeUser(user, promptCounts.get(user.id) || 0)),
      pagination: { page, pageSize: PAGE_SIZE, total, pages: Math.ceil(total / PAGE_SIZE) },
    })
  } catch (error) {
    return next(error)
  }
}

async function getUserDetails(req, res, next) {
  try {
    let user
    let userPrompts
    let userActivity
    if (mongoose.connection.readyState === 1) {
      if (!mongoose.isValidObjectId(req.params.id)) {
        return res.status(404).json({ message: 'User not found.' })
      }
      user = await User.findById(req.params.id)
        .select('-password -passwordResetToken -passwordResetExpires')
        .lean()
      if (!user) return res.status(404).json({ message: 'User not found.' })
      const userId = String(user._id)
      let promptCount
      ;[userPrompts, userActivity, promptCount] = await Promise.all([
        Prompt.find({ userId }).sort({ updatedAt: -1 }).limit(50).select('title category isPublic archived createdAt updatedAt').lean(),
        Activity.find({ userId }).sort({ createdAt: -1 }).limit(50).select('action entityType entityTitle details createdAt').lean(),
        Prompt.countDocuments({ userId }),
      ])
      user = safeUser(user, promptCount)
    } else {
      user = users.find((item) => item.id === req.params.id)
      if (!user) return res.status(404).json({ message: 'User not found.' })
      userPrompts = prompts
        .filter((prompt) => prompt.userId === user.id)
        .sort((first, second) => new Date(second.updatedAt) - new Date(first.updatedAt))
        .slice(0, 50)
        .map(({ id, title, category, isPublic, archived, createdAt, updatedAt }) => ({
          id, title, category, isPublic: Boolean(isPublic), archived: Boolean(archived), createdAt, updatedAt,
        }))
      userActivity = activities
        .filter((entry) => entry.userId === user.id)
        .sort((first, second) => new Date(second.createdAt) - new Date(first.createdAt))
        .slice(0, 50)
        .map(({ action, entityType, entityTitle, details, createdAt }) => ({
          action, entityType, entityTitle, details, createdAt,
        }))
      user = safeUser(user, userPrompts.length)
    }

    return res.json({ user, prompts: userPrompts, activity: userActivity })
  } catch (error) {
    return next(error)
  }
}

async function countOtherAdmins(userId, activeOnly = false) {
  if (mongoose.connection.readyState === 1) {
    const filter = { role: 'admin', _id: { $ne: userId } }
    if (activeOnly) filter.$or = [{ status: 'active' }, { status: { $exists: false } }]
    return User.countDocuments(filter)
  }
  return users.filter(
    (user) =>
      user.id !== userId &&
      user.role === 'admin' &&
      (!activeOnly || !user.status || user.status === 'active'),
  ).length
}

function isInvalidMongoUserId(id) {
  return mongoose.connection.readyState === 1 && !mongoose.isValidObjectId(id)
}

async function updateUserStatus(req, res, next) {
  try {
    const status = req.body?.status
    if (!USER_STATUSES.has(status)) {
      return res.status(400).json({ message: 'Status must be active, deactivated, or suspended.' })
    }
    if (req.params.id === req.user.id && status !== 'active') {
      return res.status(400).json({ message: 'You cannot deactivate or suspend your own admin account.' })
    }
    if (isInvalidMongoUserId(req.params.id)) return res.status(404).json({ message: 'User not found.' })

    const mongoConnected = mongoose.connection.readyState === 1
    const user = mongoConnected
      ? await User.findById(req.params.id)
      : users.find((item) => item.id === req.params.id)
    if (!user) return res.status(404).json({ message: 'User not found.' })
    if (
      user.role === 'admin' &&
      (user.status || 'active') === 'active' &&
      status !== 'active' &&
      (await countOtherAdmins(req.params.id, true)) === 0
    ) {
      return res.status(409).json({ message: 'The last active admin cannot be suspended or deactivated.' })
    }

    const previousStatus = USER_STATUSES.has(user.status) ? user.status : 'active'
    if (previousStatus === status) {
      return res.json({ message: 'User status is already set.', user: safeUser(user) })
    }
    user.status = status
    if (status !== 'active') user.authVersion = (user.authVersion || 0) + 1
    if (mongoConnected) {
      await user.save()
      if (status !== 'active') await AdminSession.deleteMany({ userId: user._id })
    } else {
      if (status !== 'active') {
        for (const session of adminSessions) {
          if (session.userId === user.id) session.revokedAt = new Date().toISOString()
        }
      }
      save()
    }
    await recordActivity({
      userId: req.user.id,
      action: 'admin.user_status_changed',
      entityType: 'auth',
      entityId: req.params.id,
      entityTitle: user.email,
      details: `Status changed from ${previousStatus} to ${status}.`,
    })
    return res.json({ message: 'User status updated.', user: safeUser(user) })
  } catch (error) {
    return next(error)
  }
}

async function updateUserRole(req, res, next) {
  try {
    const role = req.body?.role
    if (!USER_ROLES.has(role)) return res.status(400).json({ message: 'Role must be user or admin.' })
    if (req.params.id === req.user.id && role !== 'admin') {
      return res.status(400).json({ message: 'You cannot remove your own admin role.' })
    }
    if (isInvalidMongoUserId(req.params.id)) return res.status(404).json({ message: 'User not found.' })

    const mongoConnected = mongoose.connection.readyState === 1
    const user = mongoConnected
      ? await User.findById(req.params.id)
      : users.find((item) => item.id === req.params.id)
    if (!user) return res.status(404).json({ message: 'User not found.' })
    if (user.role === 'admin' && role === 'user' && (user.status || 'active') === 'active') {
      if ((await countOtherAdmins(req.params.id)) === 0) {
        return res.status(409).json({ message: 'The last active admin cannot be demoted.' })
      }
    }

    const previousRole = user.role === 'admin' ? 'admin' : 'user'
    if (previousRole === role) {
      return res.json({ message: 'User role is already set.', user: safeUser(user) })
    }
    user.role = role
    user.authVersion = (user.authVersion || 0) + 1
    if (mongoConnected) {
      await user.save()
      if (role !== 'admin') await AdminSession.deleteMany({ userId: user._id })
    } else {
      if (role !== 'admin') {
        for (const session of adminSessions) {
          if (session.userId === user.id) session.revokedAt = new Date().toISOString()
        }
      }
      save()
    }
    await recordActivity({
      userId: req.user.id,
      action: 'admin.user_role_changed',
      entityType: 'auth',
      entityId: req.params.id,
      entityTitle: user.email,
      details: `Role changed from ${previousRole} to ${role}.`,
    })
    return res.json({ message: 'User role updated.', user: safeUser(user) })
  } catch (error) {
    return next(error)
  }
}

async function resetUserAccess(req, res, next) {
  try {
    if (req.params.id === req.user.id) {
      return res.status(400).json({ message: 'You cannot reset access for your current admin account.' })
    }
    if (isInvalidMongoUserId(req.params.id)) return res.status(404).json({ message: 'User not found.' })
    const mongoConnected = mongoose.connection.readyState === 1
    const user = mongoConnected
      ? await User.findById(req.params.id)
      : users.find((item) => item.id === req.params.id)
    if (!user) return res.status(404).json({ message: 'User not found.' })

    user.authVersion = (user.authVersion || 0) + 1
    if (mongoConnected) {
      await user.save()
      await AdminSession.deleteMany({ userId: user._id })
    } else {
      for (const session of adminSessions) {
        if (session.userId === user.id) session.revokedAt = new Date().toISOString()
      }
      save()
    }
    await recordActivity({
      userId: req.user.id,
      action: 'admin.user_access_reset',
      entityType: 'auth',
      entityId: req.params.id,
      entityTitle: user.email,
      details: 'All existing user sessions were invalidated.',
    })
    return res.json({ message: 'All sessions for this user have been invalidated.' })
  } catch (error) {
    return next(error)
  }
}

async function deleteUser(req, res, next) {
  try {
    if (req.params.id === req.user.id) {
      return res.status(400).json({ message: 'You cannot delete your current admin account.' })
    }
    if (isInvalidMongoUserId(req.params.id)) return res.status(404).json({ message: 'User not found.' })
    const mongoConnected = mongoose.connection.readyState === 1
    const user = mongoConnected
      ? await User.findById(req.params.id).lean()
      : users.find((item) => item.id === req.params.id)
    if (!user) return res.status(404).json({ message: 'User not found.' })
    if (user.role === 'admin' && (await countOtherAdmins(req.params.id)) === 0) {
      return res.status(409).json({ message: 'The last admin account cannot be deleted.' })
    }

    if (mongoConnected) {
      const session = await mongoose.startSession()
      try {
        await session.withTransaction(async () => {
          const userId = String(user._id)
          await Prompt.deleteMany({ userId }, { session })
          await Collection.deleteMany({ userId }, { session })
          await Activity.deleteMany({ userId }, { session })
          await AdminSession.deleteMany({ userId }, { session })
          await User.deleteOne({ _id: user._id }, { session })
        })
      } finally {
        await session.endSession()
      }
    } else {
      for (let index = users.length - 1; index >= 0; index -= 1) {
        if (users[index].id === user.id) users.splice(index, 1)
      }
      for (const records of [prompts, collections, activities]) {
        for (let index = records.length - 1; index >= 0; index -= 1) {
          if (records[index].userId === user.id) records.splice(index, 1)
        }
      }
      for (let index = adminSessions.length - 1; index >= 0; index -= 1) {
        if (adminSessions[index].userId === user.id) adminSessions.splice(index, 1)
      }
      save()
    }

    await recordActivity({
      userId: req.user.id,
      action: 'admin.user_deleted',
      entityType: 'auth',
      entityId: req.params.id,
      entityTitle: user.email,
      details: 'User account and owned data were deleted.',
    })
    return res.json({ message: 'User and their PromptVault data were deleted.' })
  } catch (error) {
    return next(error)
  }
}

module.exports = {
  listUsers,
  getUserDetails,
  updateUserStatus,
  updateUserRole,
  resetUserAccess,
  deleteUser,
}
