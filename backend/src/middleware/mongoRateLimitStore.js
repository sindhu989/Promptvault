const mongoose = require('mongoose')

class MongoRateLimitStore {
  constructor({ getCollection = () => mongoose.connection.db.collection('api_rate_limits') } = {}) {
    this.getCollection = getCollection
    this.windowMs = 0
    this.collection = null
    this.indexReady = null
  }

  init(options) {
    this.windowMs = options.windowMs
  }

  async ensureCollection() {
    if (!this.indexReady) {
      this.indexReady = Promise.resolve().then(() => {
        this.collection = this.getCollection()
        return this.collection.createIndex(
          { resetTime: 1 },
          { expireAfterSeconds: 0 },
        )
      })
    }
    await this.indexReady
  }

  async increment(key) {
    await this.ensureCollection()
    const now = new Date()
    const resetTime = new Date(now.getTime() + this.windowMs)
    const update = [
      {
        $set: {
          totalHits: {
            $cond: [
              { $gt: [{ $ifNull: ['$resetTime', new Date(0)] }, now] },
              { $add: [{ $ifNull: ['$totalHits', 0] }, 1] },
              1,
            ],
          },
          resetTime: {
            $cond: [
              { $gt: [{ $ifNull: ['$resetTime', new Date(0)] }, now] },
              '$resetTime',
              resetTime,
            ],
          },
        },
      },
    ]

    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const result = await this.collection.findOneAndUpdate(
          { _id: key },
          update,
          { upsert: attempt === 0, returnDocument: 'after' },
        )
        const record = result?.value || result
        if (record) {
          return {
            totalHits: record.totalHits,
            resetTime: record.resetTime,
          }
        }
      } catch (error) {
        if (error.code !== 11000 || attempt === 2) throw error
      }
    }

    throw new Error('Could not update the shared API rate-limit counter.')
  }

  async decrement(key) {
    await this.ensureCollection()
    await this.collection.updateOne(
      { _id: key, totalHits: { $gt: 0 } },
      { $inc: { totalHits: -1 } },
    )
  }

  async resetKey(key) {
    await this.ensureCollection()
    await this.collection.deleteOne({ _id: key })
  }
}

module.exports = { MongoRateLimitStore }
