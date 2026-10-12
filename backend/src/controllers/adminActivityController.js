const mongoose = require('mongoose')
const { activities, users } = require('../data/store')
const Activity = require('../models/Activity')
const User = require('../models/User')

const PAGE_SIZE = 25
const MAX_PAGE = 10000
const ENTITY_TYPES = new Set(['prompt', 'collection', 'import', 'auth'])

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function parseDate(value) {
  if (!value) return null
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined
  const date = new Date(`${value}T00:00:00.000Z`)
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) return undefined
  return date
}

function parseFilters(query) {
  const page = Number.parseInt(query.page || '1', 10)
  const search = String(query.search || '').trim().slice(0, 100)
  const entityType = String(query.entityType || '')
  const action = String(query.action || '').trim().slice(0, 60)
  const from = parseDate(String(query.from || ''))
  const to = parseDate(String(query.to || ''))

  if (!Number.isInteger(page) || page < 1 || page > MAX_PAGE) return { error: 'Page number is invalid.' }
  if (entityType && !ENTITY_TYPES.has(entityType)) return { error: 'Activity type filter is invalid.' }
  if (from === undefined || to === undefined) return { error: 'Date filters must use valid YYYY-MM-DD values.' }
  if (from && to && from > to) return { error: 'The start date must not be after the end date.' }
  return { page, search, entityType, action, from, to }
}

function activityWindow(from, to) {
  const createdAt = {}
  if (from) createdAt.$gte = from
  if (to) {
    const exclusiveEnd = new Date(to)
    exclusiveEnd.setUTCDate(exclusiveEnd.getUTCDate() + 1)
    createdAt.$lt = exclusiveEnd
  }
  return Object.keys(createdAt).length ? createdAt : null
}

function matchesActivity(entry, search, entityType, action, from, to, searchableUserIds) {
  if (entityType && entry.entityType !== entityType) return false
  if (action && entry.action !== action) return false
  const createdAt = new Date(entry.createdAt)
  if (from && createdAt < from) return false
  if (to) {
    const exclusiveEnd = new Date(to)
    exclusiveEnd.setUTCDate(exclusiveEnd.getUTCDate() + 1)
    if (createdAt >= exclusiveEnd) return false
  }
  if (!search) return true
  const normalized = search.toLowerCase()
  return [entry.action, entry.entityType, entry.entityTitle, entry.details]
    .some((value) => String(value || '').toLowerCase().includes(normalized)) ||
    searchableUserIds.has(String(entry.userId))
}

function safeActivity(entry, user) {
  return {
    id: String(entry._id || entry.id),
    action: entry.action,
    entityType: entry.entityType,
    entityTitle: entry.entityTitle || '',
    details: entry.details || '',
    createdAt: entry.createdAt,
    user: user
      ? { name: user.name, email: user.email }
      : null,
  }
}

async function listAdminActivity(req, res, next) {
  try {
    const filters = parseFilters(req.query)
    if (filters.error) return res.status(400).json({ message: filters.error })
    const { page, search, entityType, action, from, to } = filters
    const skip = (page - 1) * PAGE_SIZE

    if (mongoose.connection.readyState === 1) {
      const conditions = []
      if (entityType) conditions.push({ entityType })
      if (action) conditions.push({ action })
      const dateFilter = activityWindow(from, to)
      if (dateFilter) conditions.push({ createdAt: dateFilter })
      const filter = conditions.length ? { $and: conditions } : {}
      const joinAccount = {
        $lookup: {
          from: User.collection.name,
          let: { activityUserId: '$userId' },
          pipeline: [
            { $match: { $expr: { $eq: [{ $toString: '$_id' }, '$$activityUserId'] } } },
            { $project: { name: 1, email: 1 } },
          ],
          as: 'account',
        },
      }
      const searchMatch = search
        ? {
            $match: {
              $or: [
                { action: new RegExp(escapeRegex(search), 'i') },
                { entityType: new RegExp(escapeRegex(search), 'i') },
                { entityTitle: new RegExp(escapeRegex(search), 'i') },
                { details: new RegExp(escapeRegex(search), 'i') },
                { 'account.name': new RegExp(escapeRegex(search), 'i') },
                { 'account.email': new RegExp(escapeRegex(search), 'i') },
              ],
            },
          }
        : null
      const basePipeline = [{ $match: filter }]
      const recordsPipeline = searchMatch
        ? [...basePipeline, joinAccount, { $unwind: { path: '$account', preserveNullAndEmptyArrays: true } }, searchMatch]
        : basePipeline
      const [countRows, records] = await Promise.all([
        Activity.aggregate([...recordsPipeline, { $count: 'total' }]),
        Activity.aggregate([
          ...recordsPipeline,
          { $sort: { createdAt: -1, _id: -1 } },
          { $skip: skip },
          { $limit: PAGE_SIZE },
          ...(!searchMatch ? [joinAccount, { $unwind: { path: '$account', preserveNullAndEmptyArrays: true } }] : []),
          { $project: { userId: 1, action: 1, entityType: 1, entityTitle: 1, details: 1, createdAt: 1, account: 1 } },
        ]),
      ])
      const total = countRows[0]?.total || 0
      return res.json({
        activity: records.map((entry) => safeActivity(entry, entry.account)),
        pagination: { page, pageSize: PAGE_SIZE, total, pages: Math.ceil(total / PAGE_SIZE) },
      })
    }

    const searchableUserIds = new Set(
      search
        ? users.filter((user) =>
            [user.name, user.email].some((value) => String(value || '').toLowerCase().includes(search.toLowerCase())),
          ).map((user) => user.id)
        : [],
    )
    const results = activities
      .filter((entry) => matchesActivity(entry, search, entityType, action, from, to, searchableUserIds))
      .sort((first, second) => new Date(second.createdAt) - new Date(first.createdAt))
    const total = results.length
    const pageEntries = results.slice(skip, skip + PAGE_SIZE)
    const userMap = new Map(users.map((user) => [user.id, user]))
    return res.json({
      activity: pageEntries.map((entry) => safeActivity(entry, userMap.get(entry.userId))),
      pagination: { page, pageSize: PAGE_SIZE, total, pages: Math.ceil(total / PAGE_SIZE) },
    })
  } catch (error) {
    return next(error)
  }
}

module.exports = { listAdminActivity }
