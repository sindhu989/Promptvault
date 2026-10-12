const mongoose = require('mongoose')
const { users, prompts, collections, activities } = require('../data/store')
const User = require('../models/User')
const Prompt = require('../models/Prompt')
const Collection = require('../models/Collection')
const Activity = require('../models/Activity')

const RECENT_ACTIVITY_LIMIT = 12
const ACTIVE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000

function isRecentlyActive(activity, since) {
  return new Date(activity.createdAt) >= since
}

async function getAdminDashboard(req, res, next) {
  try {
    const since = new Date(Date.now() - ACTIVE_WINDOW_MS)
    if (mongoose.connection.readyState === 1) {
      const [totalUsers, newUsers, promptStats, totalCollections, activeUsers, copyCount, recentActivity] =
        await Promise.all([
          User.countDocuments(),
          User.countDocuments({ createdAt: { $gte: since } }),
          Prompt.aggregate([
            {
              $group: {
                _id: null,
                total: { $sum: 1 },
                public: { $sum: { $cond: ['$isPublic', 1, 0] } },
                savedTests: { $sum: { $size: { $ifNull: ['$testRuns', []] } } },
              },
            },
          ]),
          Collection.countDocuments(),
          Activity.distinct('userId', { createdAt: { $gte: since } }),
          Activity.countDocuments({ action: 'prompt.copied' }),
          Activity.find()
            .sort({ createdAt: -1 })
            .limit(RECENT_ACTIVITY_LIMIT)
            .select('userId action entityType entityTitle createdAt')
            .lean(),
        ])

      const promptTotals = promptStats[0] || { total: 0, public: 0, savedTests: 0 }
      return res.json({
        generatedAt: new Date().toISOString(),
        activeWindowDays: 30,
        stats: {
          totalUsers,
          activeUsers: activeUsers.length,
          newUsers,
          totalPrompts: promptTotals.total,
          publicPrompts: promptTotals.public,
          privatePrompts: promptTotals.total - promptTotals.public,
          totalCollections,
          savedTests: promptTotals.savedTests,
          recordedCopies: copyCount,
        },
        recentActivity: recentActivity.map((entry) => ({
          id: String(entry._id),
          userId: entry.userId,
          action: entry.action,
          entityType: entry.entityType,
          entityTitle: entry.entityTitle,
          createdAt: entry.createdAt,
        })),
      })
    }

    const promptStats = prompts.reduce(
      (total, prompt) => {
        total.total += 1
        if (prompt.isPublic) total.public += 1
        total.savedTests += Array.isArray(prompt.testRuns) ? prompt.testRuns.length : 0
        return total
      },
      { total: 0, public: 0, savedTests: 0 },
    )
    const recentActivities = [...activities]
      .sort((first, second) => new Date(second.createdAt) - new Date(first.createdAt))
      .slice(0, RECENT_ACTIVITY_LIMIT)
    return res.json({
      generatedAt: new Date().toISOString(),
      activeWindowDays: 30,
      stats: {
        totalUsers: users.length,
        activeUsers: new Set(
          activities.filter((entry) => isRecentlyActive(entry, since)).map((entry) => entry.userId),
        ).size,
        newUsers: users.filter((user) => user.createdAt && new Date(user.createdAt) >= since).length,
        totalPrompts: promptStats.total,
        publicPrompts: promptStats.public,
        privatePrompts: promptStats.total - promptStats.public,
        totalCollections: collections.length,
        savedTests: promptStats.savedTests,
        recordedCopies: activities.filter((entry) => entry.action === 'prompt.copied').length,
      },
      recentActivity: recentActivities.map((entry) => ({
        id: entry.id,
        userId: entry.userId,
        action: entry.action,
        entityType: entry.entityType,
        entityTitle: entry.entityTitle,
        createdAt: entry.createdAt,
      })),
    })
  } catch (error) {
    return next(error)
  }
}

module.exports = { getAdminDashboard }
