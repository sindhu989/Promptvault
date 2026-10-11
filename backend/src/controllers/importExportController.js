const crypto = require('crypto')
const mongoose = require('mongoose')
const { collections: localCollections, prompts: localPrompts, save } = require('../data/store')
const Collection = require('../models/Collection')
const Prompt = require('../models/Prompt')
const { exportPrompts, parseImport, validateRecords } = require('../services/promptImportExport')

function isMongoConnected() {
  return mongoose.connection.readyState === 1
}

function toPlain(record) {
  return record?.toObject ? record.toObject() : record
}

function idOf(record) {
  const plain = toPlain(record)
  return String(plain.id || plain._id)
}

function importedVersions(prompt, userId) {
  const history = prompt.versionHistory.slice(0, 100)
  if (!history.length) {
    return [{
      version: 1,
      title: prompt.title,
      description: prompt.description,
      content: prompt.content,
      category: prompt.category,
      tags: prompt.tags,
      changeNotes: 'Imported prompt',
      creatorId: userId,
      createdAt: new Date(),
    }]
  }

  return history.map((version, index) => ({
    version: Number.isInteger(version?.version) && version.version > 0 ? version.version : index + 1,
    title: typeof version?.title === 'string' && version.title.trim()
      ? version.title.trim().slice(0, 160)
      : prompt.title,
    description: typeof version?.description === 'string' ? version.description.slice(0, 1000) : '',
    content: typeof version?.content === 'string' && version.content.trim()
      ? version.content.slice(0, 50000)
      : prompt.content,
    category: typeof version?.category === 'string' && version.category.trim()
      ? version.category.slice(0, 80)
      : prompt.category,
    tags: Array.isArray(version?.tags)
      ? version.tags
        .filter((tag) => typeof tag === 'string')
        .map((tag) => tag.slice(0, 40))
        .slice(0, 20)
      : [],
    changeNotes: typeof version?.changeNotes === 'string' ? version.changeNotes.slice(0, 300) : '',
    creatorId: userId,
    createdAt: version?.createdAt && !Number.isNaN(Date.parse(version.createdAt))
      ? new Date(version.createdAt)
      : new Date(),
  }))
}

function importedTestRuns(prompt) {
  return prompt.testRuns
    .filter((run) =>
      run &&
      typeof run === 'object' &&
      typeof run.renderedPrompt === 'string' &&
      typeof run.output === 'string' &&
      run.renderedPrompt.trim() &&
      run.output.trim(),
    )
    .slice(0, 100)
    .map((run) => ({
      variables: run.variables && typeof run.variables === 'object' && !Array.isArray(run.variables)
        ? Object.fromEntries(
            Object.entries(run.variables)
              .filter(([key, value]) =>
                /^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(key) &&
                (typeof value === 'string' || typeof value === 'number'),
              )
              .slice(0, 50)
              .map(([key, value]) => [key, String(value).slice(0, 1000)]),
          )
        : {},
      renderedPrompt: run.renderedPrompt.slice(0, 50000),
      output: run.output.slice(0, 50000),
      provider: 'mock',
      createdAt: run.createdAt && !Number.isNaN(Date.parse(run.createdAt))
        ? new Date(run.createdAt)
        : new Date(),
    }))
}

async function importPrompts(req, res) {
  let records
  let collectionRecords
  try {
    const { prompts: sourcePrompts, collections: sourceCollections } = parseImport(
      req.body?.content,
      req.body?.format,
      req.body?.filename,
    )
    const validated = validateRecords(
      sourcePrompts,
      sourceCollections,
    )
    records = validated.prompts
    collectionRecords = validated.collections
  } catch (error) {
    return res.status(400).json({ message: error.message })
  }

  const useMongo = isMongoConnected()
  const idMap = new Map()
  const promptPayloads = records.map((record) => {
    const promptId = useMongo
      ? new mongoose.Types.ObjectId()
      : `prompt-${Date.now()}-${crypto.randomBytes(8).toString('hex')}`
    if (record.sourceId) idMap.set(record.sourceId, String(promptId))
    return {
      ...(useMongo ? { _id: promptId } : { id: String(promptId) }),
      userId: req.user.id,
      title: record.title,
      description: record.description,
      content: record.content,
      category: record.category,
      tags: record.tags,
      favorite: record.favorite,
      archived: record.archived,
      isPublic: false,
      versionHistory: importedVersions(record, req.user.id),
      testRuns: importedTestRuns(record),
    }
  })

  const collectionPayloads = collectionRecords.map((record) => ({
    name: record.name,
    description: record.description,
    promptIds: [...new Set(record.sourcePromptIds.map((id) => idMap.get(id)))],
    isPublic: false,
    userId: req.user.id,
  }))

  let importedPromptCount
  let importedCollectionCount
  if (useMongo) {
    const session = await mongoose.startSession()
    try {
      await session.withTransaction(async () => {
        await Prompt.insertMany(promptPayloads, { session })
        if (collectionPayloads.length) {
          await Collection.insertMany(collectionPayloads, { session })
        }
      })
    } finally {
      await session.endSession()
    }
    importedPromptCount = promptPayloads.length
    importedCollectionCount = collectionPayloads.length
  } else {
    const createdAt = new Date().toISOString()
    localPrompts.unshift(
      ...promptPayloads.map((prompt) => ({
        ...prompt,
        createdAt,
        updatedAt: createdAt,
        versionHistory: prompt.versionHistory.map((version) => ({
          ...version,
          createdAt: version.createdAt.toISOString(),
        })),
        testRuns: prompt.testRuns.map((run) => ({
          ...run,
          createdAt: run.createdAt.toISOString(),
        })),
      })),
    )
    localCollections.unshift(
      ...collectionPayloads.map((collection) => ({
        id: `collection-${Date.now()}-${crypto.randomBytes(6).toString('hex')}`,
        ...collection,
        createdAt,
        updatedAt: createdAt,
      })),
    )
    save()
    importedPromptCount = promptPayloads.length
    importedCollectionCount = collectionPayloads.length
  }

  return res.status(201).json({
    message: `Imported ${importedPromptCount} prompt${importedPromptCount === 1 ? '' : 's'} and ${importedCollectionCount} collection${importedCollectionCount === 1 ? '' : 's'}. Imported prompts and collections are private.`,
    importedPromptCount,
    importedCollectionCount,
  })
}

async function exportPromptsForUser(req, res) {
  const useMongo = isMongoConnected()
  let prompts
  let collections
  if (useMongo) {
    const [promptRecords, collectionRecords] = await Promise.all([
      Prompt.find({ userId: req.user.id }).sort({ createdAt: 1 }),
      Collection.find({ userId: req.user.id }).sort({ createdAt: 1 }),
    ])
    prompts = promptRecords.map((prompt) => ({
      ...toPlain(prompt),
      id: idOf(prompt),
    }))
    collections = collectionRecords.map((collection) => ({
      ...toPlain(collection),
      id: idOf(collection),
    }))
  } else {
    prompts = localPrompts.filter((prompt) => prompt.userId === req.user.id)
    collections = localCollections.filter((collection) => collection.userId === req.user.id)
  }

  try {
    const result = exportPrompts(prompts, collections, req.query.format || 'json')
    res.set('Content-Type', result.contentType)
    res.set(
      'Content-Disposition',
      `attachment; filename="promptvault-export-${new Date().toISOString().slice(0, 10)}.${result.extension}"`,
    )
    return res.send(result.body)
  } catch (error) {
    return res.status(400).json({ message: error.message })
  }
}

module.exports = { importPrompts, exportPromptsForUser }
