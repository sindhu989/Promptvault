const crypto = require('crypto')
const mongoose = require('mongoose')
const { collections, prompts, users, save } = require('../data/store')
const Collection = require('../models/Collection')
const Prompt = require('../models/Prompt')
const User = require('../models/User')
const { recordActivity } = require('../services/activityLog')

const PAGE_SIZE = 25
const MAX_PAGE = 10000

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function parseFilters(query) {
  const page = Number.parseInt(query.page || '1', 10)
  const search = String(query.search || '').trim().slice(0, 100)
  const visibility = String(query.visibility || '')
  if (!Number.isInteger(page) || page < 1 || page > MAX_PAGE) return { error: 'Page number is invalid.' }
  if (visibility && !['public', 'private'].includes(visibility)) {
    return { error: 'Visibility filter must be public or private.' }
  }
  return { page, search, visibility }
}

function safeCollection(collection, owner) {
  return {
    id: String(collection._id || collection.id),
    name: collection.name,
    description: collection.description || '',
    isPublic: Boolean(collection.isPublic),
    promptCount: Array.isArray(collection.promptIds) ? collection.promptIds.length : 0,
    owner: owner
      ? { id: String(owner._id || owner.id), name: owner.name, email: owner.email }
      : null,
    createdAt: collection.createdAt,
    updatedAt: collection.updatedAt,
  }
}

function matchesSearch(collection, search) {
  if (!search) return true
  const normalized = search.toLowerCase()
  return [collection.name, collection.description]
    .some((value) => String(value || '').toLowerCase().includes(normalized))
}

async function listCollections(req, res, next) {
  try {
    const filters = parseFilters(req.query)
    if (filters.error) return res.status(400).json({ message: filters.error })
    const { page, search, visibility } = filters
    const skip = (page - 1) * PAGE_SIZE

    if (mongoose.connection.readyState === 1) {
      const conditions = []
      if (visibility) conditions.push({ isPublic: visibility === 'public' })
      if (search) {
        const safeSearch = new RegExp(escapeRegex(search), 'i')
        conditions.push({ $or: [{ name: safeSearch }, { description: safeSearch }] })
      }
      const filter = conditions.length ? { $and: conditions } : {}
      const [total, pageCollections] = await Promise.all([
        Collection.countDocuments(filter),
        Collection.find(filter).sort({ updatedAt: -1, _id: -1 }).skip(skip).limit(PAGE_SIZE).lean(),
      ])
      const owners = await User.find({ _id: { $in: [...new Set(pageCollections.map((item) => item.userId))] } })
        .select('name email').lean()
      const ownerMap = new Map(owners.map((owner) => [String(owner._id), owner]))
      return res.json({
        collections: pageCollections.map((item) => safeCollection(item, ownerMap.get(item.userId))),
        pagination: { page, pageSize: PAGE_SIZE, total, pages: Math.ceil(total / PAGE_SIZE) },
      })
    }

    let results = collections.filter((item) => matchesSearch(item, search))
    if (visibility) results = results.filter((item) => Boolean(item.isPublic) === (visibility === 'public'))
    results.sort((first, second) => new Date(second.updatedAt) - new Date(first.updatedAt))
    const total = results.length
    const ownerMap = new Map(users.map((owner) => [owner.id, owner]))
    return res.json({
      collections: results.slice(skip, skip + PAGE_SIZE)
        .map((item) => safeCollection(item, ownerMap.get(item.userId))),
      pagination: { page, pageSize: PAGE_SIZE, total, pages: Math.ceil(total / PAGE_SIZE) },
    })
  } catch (error) {
    return next(error)
  }
}

async function findCollection(id) {
  if (mongoose.connection.readyState === 1) {
    if (!mongoose.isValidObjectId(id)) return null
    return Collection.findById(id)
  }
  return collections.find((item) => item.id === id) || null
}

async function getCollectionDetails(req, res, next) {
  try {
    const collection = await findCollection(req.params.id)
    if (!collection) return res.status(404).json({ message: 'Collection not found.' })
    const mongoConnected = mongoose.connection.readyState === 1
    const promptIds = Array.isArray(collection.promptIds) ? collection.promptIds : []
    const [owner, collectionPrompts] = mongoConnected
      ? await Promise.all([
          User.findById(collection.userId).select('name email').lean(),
          Prompt.find({
            _id: {
              $in: promptIds.filter((id) => mongoose.isValidObjectId(id))
                .map((id) => new mongoose.Types.ObjectId(id)),
            },
          }).select('title category isPublic archived moderationStatus updatedAt').lean(),
        ])
      : [
          users.find((item) => item.id === collection.userId),
          prompts.filter((prompt) => promptIds.includes(prompt.id))
            .map(({ id, title, category, isPublic, archived, moderationStatus, updatedAt }) => ({
              id, title, category, isPublic, archived, moderationStatus, updatedAt,
            })),
        ]
    return res.json({
      collection: safeCollection(collection, owner),
      prompts: collectionPrompts.map((prompt) => ({
        id: String(prompt._id || prompt.id),
        title: prompt.title,
        category: prompt.category,
        isPublic: Boolean(prompt.isPublic),
        archived: Boolean(prompt.archived),
        moderationStatus: prompt.moderationStatus || 'approved',
        updatedAt: prompt.updatedAt,
      })),
    })
  } catch (error) {
    return next(error)
  }
}

function validateUpdate(body) {
  const update = {}
  if (body.name !== undefined) {
    update.name = String(body.name).trim()
    if (!update.name || update.name.length > 80) return { error: 'Name must be between 1 and 80 characters.' }
  }
  if (body.description !== undefined) {
    update.description = String(body.description).trim()
    if (update.description.length > 240) return { error: 'Description must be 240 characters or fewer.' }
  }
  if (body.isPublic !== undefined) {
    if (typeof body.isPublic !== 'boolean') return { error: 'Visibility must be a boolean value.' }
    update.isPublic = body.isPublic
  }
  if (!Object.keys(update).length) return { error: 'Provide a collection field to update.' }
  return { update }
}

async function updateCollection(req, res, next) {
  try {
    const result = validateUpdate(req.body || {})
    if (result.error) return res.status(400).json({ message: result.error })
    const collection = await findCollection(req.params.id)
    if (!collection) return res.status(404).json({ message: 'Collection not found.' })
    const previousVisibility = Boolean(collection.isPublic)
    Object.assign(collection, result.update)
    if (result.update.isPublic !== undefined && result.update.isPublic !== previousVisibility) {
      collection.shareId = result.update.isPublic ? crypto.randomUUID() : undefined
    }
    collection.updatedAt = new Date()
    if (mongoose.connection.readyState === 1) await collection.save()
    else {
      collection.updatedAt = collection.updatedAt.toISOString()
      save()
    }
    await recordActivity({
      userId: collection.userId,
      action: 'collection.admin_updated',
      entityType: 'collection',
      entityId: collection.id || String(collection._id),
      entityTitle: collection.name,
      details: `Updated by administrator ${req.user.id}`,
    })
    return res.json({ message: 'Collection updated.', collection: safeCollection(collection) })
  } catch (error) {
    return next(error)
  }
}

async function deleteCollection(req, res, next) {
  try {
    let collection
    if (mongoose.connection.readyState === 1) {
      if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ message: 'Collection not found.' })
      collection = await Collection.findByIdAndDelete(req.params.id)
    } else {
      const index = collections.findIndex((item) => item.id === req.params.id)
      if (index >= 0) [collection] = collections.splice(index, 1)
      if (collection) save()
    }
    if (!collection) return res.status(404).json({ message: 'Collection not found.' })
    await recordActivity({
      userId: collection.userId,
      action: 'collection.admin_deleted',
      entityType: 'collection',
      entityId: String(collection._id || collection.id),
      entityTitle: collection.name,
      details: `Deleted by administrator ${req.user.id}`,
    })
    return res.json({ message: 'Collection deleted.' })
  } catch (error) {
    return next(error)
  }
}

module.exports = { listCollections, getCollectionDetails, updateCollection, deleteCollection }
