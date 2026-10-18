const assert = require('node:assert/strict')
const { test } = require('node:test')
const { MongoRateLimitStore } = require('../backend/src/middleware/mongoRateLimitStore')

test('Mongo rate-limit store shares counters and expires each IP window', async () => {
  const records = new Map()
  const indexes = []
  const updates = []
  const collection = {
    createIndex: async (...args) => indexes.push(args),
    findOneAndUpdate: async ({ _id }, update, options) => {
      updates.push({ update, options })
      const now = new Date()
      const current = records.get(_id)
      const isCurrentWindow = current && current.resetTime > now
      const record = {
        _id,
        totalHits: isCurrentWindow ? current.totalHits + 1 : 1,
        resetTime: isCurrentWindow
          ? current.resetTime
          : update[0].$set.resetTime.$cond[2],
      }
      records.set(_id, record)
      return record
    },
    updateOne: async ({ _id }, update) => {
      const record = records.get(_id)
      if (record && record.totalHits > 0) record.totalHits += update.$inc.totalHits
    },
    deleteOne: async ({ _id }) => records.delete(_id),
  }
  let collectionRequests = 0
  const getCollection = () => {
    collectionRequests += 1
    return collection
  }
  const firstInstance = new MongoRateLimitStore({ getCollection })
  const secondInstance = new MongoRateLimitStore({ getCollection })

  firstInstance.init({ windowMs: 900_000 })
  secondInstance.init({ windowMs: 900_000 })
  assert.equal(collectionRequests, 0)

  const firstHit = await firstInstance.increment('203.0.113.10')
  const secondHit = await secondInstance.increment('203.0.113.10')
  assert.equal(firstHit.totalHits, 1)
  assert.equal(secondHit.totalHits, 2)
  assert.equal(collectionRequests, 2)
  assert.deepEqual(indexes[0], [
    { resetTime: 1 },
    { expireAfterSeconds: 0 },
  ])
  assert.equal(updates[0].options.upsert, true)
  assert.ok(updates[0].update[0].$set.totalHits.$cond)

  records.get('203.0.113.10').resetTime = new Date(Date.now() - 1)
  const nextWindowHit = await firstInstance.increment('203.0.113.10')
  assert.equal(nextWindowHit.totalHits, 1)

  await firstInstance.decrement('203.0.113.10')
  assert.equal(records.get('203.0.113.10').totalHits, 0)
  await firstInstance.resetKey('203.0.113.10')
  assert.equal(records.has('203.0.113.10'), false)
})
