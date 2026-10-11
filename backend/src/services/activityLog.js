const crypto = require('crypto')
const mongoose = require('mongoose')
const { activities, save } = require('../data/store')
const Activity = require('../models/Activity')

const MAX_ACTIVITY_RECORDS = 500

async function recordActivity({ userId, action, entityType, entityId = '', entityTitle, details = '' }) {
  const entry = {
    userId: String(userId),
    action,
    entityType,
    entityId: String(entityId || ''),
    entityTitle: String(entityTitle || '').slice(0, 160),
    details: String(details || '').slice(0, 200),
  }

  if (mongoose.connection.readyState === 1) {
    await Activity.create(entry)
    const olderEntries = await Activity.find({ userId: entry.userId })
      .sort({ createdAt: -1 })
      .skip(MAX_ACTIVITY_RECORDS)
      .limit(MAX_ACTIVITY_RECORDS)
      .select('_id')
      .lean()
    if (olderEntries.length) {
      await Activity.deleteMany({ _id: { $in: olderEntries.map((item) => item._id) } })
    }
    return
  }

  activities.unshift({
    id: `activity-${Date.now()}-${crypto.randomBytes(6).toString('hex')}`,
    ...entry,
    createdAt: new Date().toISOString(),
  })
  const userEntries = activities.filter((item) => item.userId === entry.userId)
  for (const staleEntry of userEntries.slice(MAX_ACTIVITY_RECORDS)) {
    const staleIndex = activities.indexOf(staleEntry)
    if (staleIndex >= 0) activities.splice(staleIndex, 1)
  }
  save()
}

async function listActivity(userId) {
  if (mongoose.connection.readyState === 1) {
    const records = await Activity.find({ userId })
      .sort({ createdAt: -1 })
      .limit(100)
      .lean()
    return records.map((record) => ({
      ...record,
      id: String(record._id),
    }))
  }

  return activities
    .filter((item) => item.userId === userId)
    .sort((first, second) => new Date(second.createdAt) - new Date(first.createdAt))
    .slice(0, 100)
}

module.exports = { listActivity, recordActivity }
