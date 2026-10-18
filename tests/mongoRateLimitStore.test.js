const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const { test } = require('node:test')
const { MongoRateLimitStore } = require('../backend/src/middleware/mongoRateLimitStore')

test('Mongo rate-limit store shares counters and expires each IP window', async () => {
  const records = new Map()
  const indexes = []
  const updates = []
  const counterKeys = []
  const collection = {
    createIndex: async (...args) => indexes.push(args),
    findOneAndUpdate: async ({ _id }, update, options) => {
      counterKeys.push(_id)
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
  const secret = 'test-rate-limit-secret'
  const rawIp = '203.0.113.10'
  const hashedIp = crypto.createHmac('sha256', secret).update(`api:${rawIp}`).digest('hex')
  let collectionRequests = 0
  const getCollection = () => {
    collectionRequests += 1
    return collection
  }
  const firstInstance = new MongoRateLimitStore({ getCollection, secret })
  const secondInstance = new MongoRateLimitStore({ getCollection, secret })

  firstInstance.init({ windowMs: 900_000 })
  secondInstance.init({ windowMs: 900_000 })
  assert.equal(collectionRequests, 0)

  const firstHit = await firstInstance.increment(rawIp)
  const secondHit = await secondInstance.increment(rawIp)
  assert.equal(firstHit.totalHits, 1)
  assert.equal(secondHit.totalHits, 2)
  assert.deepEqual(counterKeys, [hashedIp, hashedIp])
  assert.equal(counterKeys.includes(rawIp), false)
  assert.equal(collectionRequests, 2)
  assert.deepEqual(indexes[0], [
    { resetTime: 1 },
    { expireAfterSeconds: 0 },
  ])
  assert.equal(updates[0].options.upsert, true)
  assert.ok(updates[0].update[0].$set.totalHits.$cond)

  records.get(hashedIp).resetTime = new Date(Date.now() - 1)
  const nextWindowHit = await firstInstance.increment(rawIp)
  assert.equal(nextWindowHit.totalHits, 1)

  await firstInstance.decrement(rawIp)
  assert.equal(records.get(hashedIp).totalHits, 0)
  await firstInstance.resetKey(rawIp)
  assert.equal(records.has(hashedIp), false)
})

test('Mongo rate-limit store isolates counters by namespace', async () => {
  const keys = []
  const store = new MongoRateLimitStore({
    secret: 'test-rate-limit-secret',
    namespace: 'admin-login',
    getCollection: () => ({
      createIndex: async () => {},
      findOneAndUpdate: async ({ _id }) => {
        keys.push(_id)
        return { totalHits: 1, resetTime: new Date(Date.now() + 900_000) }
      },
    }),
  })
  store.init({ windowMs: 900_000 })

  await store.increment('203.0.113.10')

  assert.equal(
    keys[0],
    crypto.createHmac('sha256', 'test-rate-limit-secret')
      .update('admin-login:203.0.113.10')
      .digest('hex'),
  )
})

test('Mongo rate-limit store requires a secret before storing client identifiers', async () => {
  const store = new MongoRateLimitStore({
    secret: '',
    getCollection: () => ({
      createIndex: async () => {},
    }),
  })
  store.init({ windowMs: 900_000 })

  await assert.rejects(store.increment('203.0.113.10'), /JWT_SECRET must be configured/)
})
