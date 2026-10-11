const crypto = require('crypto')
const mongoose = require('mongoose')
const { collections, prompts, save } = require('../data/store')
const Collection = require('../models/Collection')
const Prompt = require('../models/Prompt')
const { recordActivity } = require('../services/activityLog')

function isMongoConnected() {
  return mongoose.connection.readyState === 1
}

function normalizeCollection(collection) {
  const plain = collection.toObject ? collection.toObject() : collection
  return {
    ...plain,
    id: plain.id || String(plain._id || collection.id),
    promptCount: (plain.promptIds || []).length,
  }
}

async function findOwnedCollection(id, userId) {
  if (isMongoConnected()) return Collection.findOne({ _id: id, userId })
  return collections.find((collection) => collection.id === id && collection.userId === userId)
}

async function listCollections(req, res) {
  if (isMongoConnected()) {
    const items = await Collection.find({ userId: req.user.id }).sort({ updatedAt: -1 })
    return res.json({ collections: items.map(normalizeCollection) })
  }
  return res.json({
    collections: collections
      .filter((collection) => collection.userId === req.user.id)
      .map(normalizeCollection),
  })
}

async function createCollection(req, res) {
  const { name, description, isPublic } = req.body || {}
  const trimmedName = String(name || '').trim()
  if (!trimmedName) return res.status(400).json({ message: 'Collection name is required.' })

  const collectionData = {
    name: trimmedName,
    description: String(description || '').trim(),
    promptIds: [],
    isPublic: Boolean(isPublic),
    shareId: isPublic ? crypto.randomUUID() : undefined,
    userId: req.user.id,
  }

  if (isMongoConnected()) {
    const collection = await Collection.create(collectionData)
    await recordActivity({
      userId: req.user.id,
      action: 'collection.created',
      entityType: 'collection',
      entityId: collection.id,
      entityTitle: collection.name,
    })
    return res.status(201).json({
      message: 'Collection created.',
      collection: normalizeCollection(collection),
    })
  }

  const collection = {
    id: `collection-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`,
    ...collectionData,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
  collections.unshift(collection)
  save()
  await recordActivity({
    userId: req.user.id,
    action: 'collection.created',
    entityType: 'collection',
    entityId: collection.id,
    entityTitle: collection.name,
  })
  return res.status(201).json({ message: 'Collection created.', collection: normalizeCollection(collection) })
}

async function updateCollection(req, res) {
  const collection = await findOwnedCollection(req.params.id, req.user.id)
  if (!collection) return res.status(404).json({ message: 'Collection not found.' })

  const { name, description, isPublic } = req.body || {}
  if (name !== undefined) {
    const trimmedName = String(name).trim()
    if (!trimmedName) return res.status(400).json({ message: 'Collection name cannot be empty.' })
    collection.name = trimmedName
  }
  if (description !== undefined) collection.description = String(description).trim()
  if (isPublic !== undefined && Boolean(isPublic) !== collection.isPublic) {
    collection.isPublic = Boolean(isPublic)
    collection.shareId = collection.isPublic ? crypto.randomUUID() : undefined
  }
  collection.updatedAt = new Date()

  if (isMongoConnected()) {
    await collection.save()
  } else {
    collection.updatedAt = collection.updatedAt.toISOString()
    save()
  }

  await recordActivity({
    userId: req.user.id,
    action: 'collection.updated',
    entityType: 'collection',
    entityId: collection.id || String(collection._id),
    entityTitle: collection.name,
  })
  return res.json({ message: 'Collection updated.', collection: normalizeCollection(collection) })
}

async function deleteCollection(req, res) {
  if (isMongoConnected()) {
    const collection = await Collection.findOneAndDelete({ _id: req.params.id, userId: req.user.id })
    if (!collection) return res.status(404).json({ message: 'Collection not found.' })
    await recordActivity({
      userId: req.user.id,
      action: 'collection.deleted',
      entityType: 'collection',
      entityId: collection.id,
      entityTitle: collection.name,
    })
    return res.json({ message: 'Collection deleted.' })
  }

  const index = collections.findIndex(
    (collection) => collection.id === req.params.id && collection.userId === req.user.id,
  )
  if (index === -1) return res.status(404).json({ message: 'Collection not found.' })
  const [deletedCollection] = collections.splice(index, 1)
  save()
  await recordActivity({
    userId: req.user.id,
    action: 'collection.deleted',
    entityType: 'collection',
    entityId: deletedCollection.id,
    entityTitle: deletedCollection.name,
  })
  return res.json({ message: 'Collection deleted.' })
}

async function addPrompt(req, res) {
  const collection = await findOwnedCollection(req.params.id, req.user.id)
  if (!collection) return res.status(404).json({ message: 'Collection not found.' })

  const prompt = isMongoConnected()
    ? await Prompt.findOne({ _id: req.params.promptId, userId: req.user.id })
    : prompts.find((item) => item.id === req.params.promptId && item.userId === req.user.id)
  if (!prompt) return res.status(404).json({ message: 'Prompt not found.' })

  const wasAdded = !collection.promptIds.includes(String(req.params.promptId))
  if (wasAdded) {
    collection.promptIds.push(String(req.params.promptId))
  }
  collection.updatedAt = new Date()

  if (isMongoConnected()) {
    await collection.save()
  } else {
    collection.updatedAt = collection.updatedAt.toISOString()
    save()
  }
  if (wasAdded) {
    await recordActivity({
      userId: req.user.id,
      action: 'collection.prompt_added',
      entityType: 'collection',
      entityId: collection.id || String(collection._id),
      entityTitle: collection.name,
      details: prompt.title,
    })
  }
  return res.json({ message: 'Prompt added to collection.', collection: normalizeCollection(collection) })
}

async function removePrompt(req, res) {
  const collection = await findOwnedCollection(req.params.id, req.user.id)
  if (!collection) return res.status(404).json({ message: 'Collection not found.' })

  const wasRemoved = collection.promptIds.includes(String(req.params.promptId))
  collection.promptIds = collection.promptIds.filter((id) => String(id) !== req.params.promptId)
  collection.updatedAt = new Date()
  if (isMongoConnected()) {
    await collection.save()
  } else {
    collection.updatedAt = collection.updatedAt.toISOString()
    save()
  }
  if (wasRemoved) {
    const prompt = isMongoConnected()
      ? await Prompt.findOne({ _id: req.params.promptId, userId: req.user.id }).select('title').lean()
      : prompts.find((item) => item.id === req.params.promptId && item.userId === req.user.id)
    await recordActivity({
      userId: req.user.id,
      action: 'collection.prompt_removed',
      entityType: 'collection',
      entityId: collection.id || String(collection._id),
      entityTitle: collection.name,
      details: prompt?.title || 'Prompt',
    })
  }
  return res.json({ message: 'Prompt removed from collection.', collection: normalizeCollection(collection) })
}

async function getCollectionPrompts(req, res) {
  const collection = await findOwnedCollection(req.params.id, req.user.id)
  if (!collection) return res.status(404).json({ message: 'Collection not found.' })

  const items = isMongoConnected()
    ? await Prompt.find({
        _id: {
          $in: collection.promptIds
            .filter((id) => mongoose.Types.ObjectId.isValid(id))
            .map((id) => new mongoose.Types.ObjectId(id)),
        },
        userId: req.user.id,
      })
    : prompts.filter(
        (prompt) =>
          collection.promptIds.includes(prompt.id) && prompt.userId === req.user.id,
      )
  return res.json({
    collection: normalizeCollection(collection),
    prompts: items.map((prompt) => {
    const plain = prompt.toObject ? prompt.toObject() : prompt
    return { ...plain, id: plain.id || String(plain._id || prompt.id) }
    }),
  })
}

async function getPublicCollection(req, res) {
  const collection = isMongoConnected()
    ? await Collection.findOne({ shareId: req.params.shareId, isPublic: true })
    : collections.find(
        (item) => item.shareId === req.params.shareId && item.isPublic,
      )
  if (!collection) return res.status(404).json({ message: 'Shared collection not found.' })

  const items = isMongoConnected()
    ? await Prompt.find({
        _id: {
          $in: collection.promptIds
            .filter((id) => mongoose.Types.ObjectId.isValid(id))
            .map((id) => new mongoose.Types.ObjectId(id)),
        },
        isPublic: true,
        archived: { $ne: true },
      })
    : prompts.filter(
        (prompt) =>
          collection.promptIds.includes(prompt.id) &&
          prompt.isPublic &&
          !prompt.archived,
      )

  return res.json({
    collection: {
      name: collection.name,
      description: collection.description,
    },
    prompts: items.map((prompt) => ({
      title: prompt.title,
      description: prompt.description || '',
      content: prompt.content,
      category: prompt.category,
      tags: prompt.tags || [],
    })),
  })
}

module.exports = {
  listCollections,
  createCollection,
  updateCollection,
  deleteCollection,
  addPrompt,
  removePrompt,
  getCollectionPrompts,
  getPublicCollection,
}
