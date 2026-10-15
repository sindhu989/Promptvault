const mongoose = require('mongoose')
const crypto = require('crypto')
const { prompts, save } = require('../data/store')
const Prompt = require('../models/Prompt')
const { extractVariables, renderPrompt } = require('../services/promptTester')
const { recordActivity } = require('../services/activityLog')

const PROMPT_LIMITS = {
  title: 160,
  description: 1000,
  content: 50000,
  category: 80,
  tags: 20,
  tag: 40,
}

function isMongoConnected() {
  return mongoose.connection.readyState === 1
}

function normalizePrompt(prompt) {
  const plain = prompt.toObject ? prompt.toObject() : prompt
  return {
    ...plain,
    id: plain.id || String(plain._id || prompt.id),
    userId: plain.userId || String(plain.userId || prompt.userId),
  }
}

function promptFields(prompt) {
  return {
    title: prompt.title,
    description: prompt.description || '',
    content: prompt.content,
    category: prompt.category,
    tags: [...(prompt.tags || [])],
  }
}

function createVersion(prompt, version, creatorId, changeNotes = '') {
  return {
    version,
    ...promptFields(prompt),
    changeNotes,
    creatorId,
    createdAt: new Date(),
  }
}

function ensureVersionHistory(prompt, creatorId) {
  if (!prompt.versionHistory?.length) {
    prompt.versionHistory = [createVersion(prompt, 1, creatorId, 'Initial version')]
  }
}

function cleanUpdate(body) {
  const update = {}
  for (const field of ['title', 'description', 'content', 'category']) {
    if (body[field] !== undefined) {
      if (typeof body[field] !== 'string') {
        return { error: `${field} must be text.` }
      }
      update[field] = body[field].trim()
    }
  }
  if (body.tags !== undefined) {
    if (!Array.isArray(body.tags) || body.tags.some((tag) => typeof tag !== 'string')) {
      return { error: 'Tags must be a list of text values.' }
    }
    update.tags = body.tags.map((tag) => tag.trim()).filter(Boolean)
  }
  for (const field of ['title', 'content', 'category']) {
    if (update[field] !== undefined && !update[field]) {
      return { error: `${field[0].toUpperCase()}${field.slice(1)} is required.` }
    }
  }
  for (const field of ['title', 'description', 'content', 'category']) {
    if (update[field]?.length > PROMPT_LIMITS[field]) {
      return { error: `${field[0].toUpperCase()}${field.slice(1)} cannot exceed ${PROMPT_LIMITS[field]} characters.` }
    }
  }
  if (update.tags?.length > PROMPT_LIMITS.tags) {
    return { error: `No more than ${PROMPT_LIMITS.tags} tags are allowed.` }
  }
  if (update.tags?.some((tag) => tag.length > PROMPT_LIMITS.tag)) {
    return { error: `Tags must be ${PROMPT_LIMITS.tag} characters or fewer.` }
  }
  return update
}

function hasContentChanges(prompt, update) {
  const current = promptFields(prompt)
  return Object.entries(update).some(([key, value]) =>
    key === 'tags'
      ? JSON.stringify(current.tags) !== JSON.stringify(value)
      : current[key] !== value,
  )
}

function appendVersion(prompt, creatorId, changeNotes) {
  ensureVersionHistory(prompt, creatorId)
  const latestVersion = prompt.versionHistory[prompt.versionHistory.length - 1].version
  prompt.versionHistory.push(
    createVersion(
      prompt,
      latestVersion + 1,
      creatorId,
      String(changeNotes || '').trim().slice(0, 300),
    ),
  )
}

async function findOwnedPrompt(id, userId) {
  if (isMongoConnected()) {
    return Prompt.findOne({ _id: id, userId })
  }
  return prompts.find((prompt) => prompt.id === id && prompt.userId === userId)
}

async function listPrompts(req, res) {
  if (isMongoConnected()) {
    const userPrompts = await Prompt.find({ userId: req.user.id }).sort({ updatedAt: -1 })
    return res.json({ prompts: userPrompts.map(normalizePrompt) })
  }

  const userPrompts = prompts
    .filter((prompt) => prompt.userId === req.user.id)
    .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))

  return res.json({ prompts: userPrompts })
}

async function recordPromptCopy(req, res) {
  const prompt = await findOwnedPrompt(req.params.id, req.user.id)
  if (!prompt || prompt.archived) {
    return res.status(404).json({ message: 'Prompt not found.' })
  }

  await recordActivity({
    userId: req.user.id,
    action: 'prompt.copied',
    entityType: 'prompt',
    entityId: prompt.id || prompt._id,
    entityTitle: prompt.title,
  })
  return res.json({ message: 'Prompt copy recorded.' })
}

async function createPrompt(req, res) {
  const { title, description, content, category, tags, favorite } = req.body || {}

  if (typeof title !== 'string' || !title.trim() ||
      typeof content !== 'string' || !content.trim() ||
      typeof category !== 'string' || !category.trim()) {
    return res.status(400).json({
      message: 'Title, content, and category are required.',
    })
  }
  if (description !== undefined && typeof description !== 'string') {
    return res.status(400).json({ message: 'Description must be text.' })
  }
  if (tags !== undefined && (!Array.isArray(tags) || tags.some((tag) => typeof tag !== 'string'))) {
    return res.status(400).json({ message: 'Tags must be a list of text values.' })
  }
  if (favorite !== undefined && typeof favorite !== 'boolean') {
    return res.status(400).json({ message: 'Favorite must be true or false.' })
  }

  const promptPayload = {
    userId: req.user.id,
    title: String(title).trim(),
    description: String(description || '').trim(),
    content: String(content).trim(),
    category: String(category).trim(),
    tags: Array.isArray(tags) ? tags.map((tag) => String(tag).trim()).filter(Boolean) : [],
    favorite: Boolean(favorite),
  }
  const validation = cleanUpdate(promptPayload)
  if (validation.error) return res.status(400).json({ message: validation.error })
  promptPayload.versionHistory = [
    createVersion(promptPayload, 1, req.user.id, 'Initial version'),
  ]

  if (isMongoConnected()) {
    const newPrompt = await Prompt.create(promptPayload)
    await recordActivity({
      userId: req.user.id,
      action: 'prompt.created',
      entityType: 'prompt',
      entityId: newPrompt.id,
      entityTitle: newPrompt.title,
    })
    return res.status(201).json({
      message: 'Prompt created successfully.',
      prompt: normalizePrompt(newPrompt),
    })
  }

  const newPrompt = {
    id: `prompt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    ...promptPayload,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }

  prompts.unshift(newPrompt)
  save()
  await recordActivity({
    userId: req.user.id,
    action: 'prompt.created',
    entityType: 'prompt',
    entityId: newPrompt.id,
    entityTitle: newPrompt.title,
  })
  return res.status(201).json({ message: 'Prompt created successfully.', prompt: newPrompt })
}

async function updatePrompt(req, res) {
  const prompt = await findOwnedPrompt(req.params.id, req.user.id)
  if (!prompt) {
    return res.status(404).json({ message: 'Prompt not found.' })
  }

  const body = req.body || {}
  const update = cleanUpdate(body)
  if (update.error) return res.status(400).json({ message: update.error })
  if (body.favorite !== undefined && typeof body.favorite !== 'boolean') {
    return res.status(400).json({ message: 'Favorite must be true or false.' })
  }
  if (body.isPublic !== undefined && typeof body.isPublic !== 'boolean') {
    return res.status(400).json({ message: 'Sharing visibility must be true or false.' })
  }
  if (body.changeNotes !== undefined &&
      (typeof body.changeNotes !== 'string' || body.changeNotes.length > 300)) {
    return res.status(400).json({ message: 'Change notes must be text of at most 300 characters.' })
  }
  ensureVersionHistory(prompt, req.user.id)
  const contentChanged = hasContentChanges(prompt, update)
  Object.assign(prompt, update)
  if (body.favorite !== undefined) prompt.favorite = Boolean(body.favorite)
  if (body.isPublic !== undefined && Boolean(body.isPublic) !== Boolean(prompt.isPublic)) {
    prompt.isPublic = Boolean(body.isPublic)
    prompt.shareId = prompt.isPublic ? crypto.randomUUID() : undefined
    prompt.moderationStatus = prompt.isPublic ? 'pending' : 'approved'
    prompt.moderationReason = ''
    prompt.moderatedBy = ''
    prompt.moderatedAt = null
  }

  if (contentChanged) {
    appendVersion(prompt, req.user.id, body.changeNotes)
    if (prompt.isPublic) {
      prompt.moderationStatus = 'pending'
      prompt.moderationReason = ''
      prompt.moderatedBy = ''
      prompt.moderatedAt = null
    }
  }

  prompt.updatedAt = new Date()
  if (isMongoConnected()) {
    await prompt.save()
    await recordActivity({
      userId: req.user.id,
      action: body.favorite !== undefined
        ? body.favorite ? 'prompt.favorite_added' : 'prompt.favorite_removed'
        : 'prompt.updated',
      entityType: 'prompt',
      entityId: prompt.id,
      entityTitle: prompt.title,
    })
    return res.json({
      message: 'Prompt updated successfully.',
      prompt: normalizePrompt(prompt),
    })
  }

  prompt.updatedAt = prompt.updatedAt.toISOString()
  save()
  await recordActivity({
    userId: req.user.id,
    action: body.favorite !== undefined
      ? body.favorite ? 'prompt.favorite_added' : 'prompt.favorite_removed'
      : 'prompt.updated',
    entityType: 'prompt',
    entityId: prompt.id,
    entityTitle: prompt.title,
  })
  return res.json({ message: 'Prompt updated successfully.', prompt })
}

async function getPublicPrompt(req, res) {
  const prompt = isMongoConnected()
    ? await Prompt.findOne({
        shareId: req.params.shareId,
        isPublic: true,
        archived: { $ne: true },
        $or: [{ moderationStatus: 'approved' }, { moderationStatus: { $exists: false } }],
      })
    : prompts.find(
        (item) =>
          item.shareId === req.params.shareId &&
          item.isPublic &&
          !item.archived &&
          (!item.moderationStatus || item.moderationStatus === 'approved'),
      )

  if (!prompt) {
    return res.status(404).json({ message: 'Shared prompt not found.' })
  }

  return res.json({
    prompt: {
      title: prompt.title,
      description: prompt.description || '',
      content: prompt.content,
      category: prompt.category,
      tags: prompt.tags || [],
    },
  })
}

async function listFeaturedPublicPrompts(req, res) {
  const page = Number.parseInt(req.query.page || '1', 10)
  const pageSize = 24
  const search = String(req.query.search || '').trim().slice(0, 100)
  const category = String(req.query.category || '').trim().slice(0, 80)
  if (!Number.isInteger(page) || page < 1 || page > 10000) {
    return res.status(400).json({ message: 'Page number is invalid.' })
  }

  if (isMongoConnected()) {
    const conditions = [
      { isPublic: true },
      { featured: true },
      { archived: { $ne: true } },
      { $or: [{ moderationStatus: 'approved' }, { moderationStatus: { $exists: false } }] },
    ]
    if (category) conditions.push({ category })
    if (search) {
      const safeSearch = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const pattern = new RegExp(safeSearch, 'i')
      conditions.push({ $or: [{ title: pattern }, { description: pattern }, { content: pattern }, { category: pattern }, { tags: pattern }] })
    }
    const filter = { $and: conditions }
    const [total, featuredPrompts, categories] = await Promise.all([
      Prompt.countDocuments(filter),
      Prompt.find(filter).sort({ updatedAt: -1, _id: -1 }).skip((page - 1) * pageSize).limit(pageSize)
        .select('-_id title description content category tags updatedAt').lean(),
      Prompt.distinct('category', {
        isPublic: true,
        featured: true,
        archived: { $ne: true },
        $or: [{ moderationStatus: 'approved' }, { moderationStatus: { $exists: false } }],
      }),
    ])
    return res.json({
      prompts: featuredPrompts,
      categories: categories.sort((first, second) => first.localeCompare(second)),
      pagination: { page, pageSize, total, pages: Math.ceil(total / pageSize) },
    })
  }

  const publiclyAvailable = prompts.filter((prompt) =>
    prompt.isPublic &&
    prompt.featured &&
    !prompt.archived &&
    (!prompt.moderationStatus || prompt.moderationStatus === 'approved'),
  )
  const availableCategories = [...new Set(publiclyAvailable.map((prompt) => prompt.category))]
    .sort((first, second) => first.localeCompare(second))
  const normalizedSearch = search.toLowerCase()
  const matchingPrompts = publiclyAvailable.filter((prompt) => {
    if (category && prompt.category !== category) return false
    if (!normalizedSearch) return true
    return [prompt.title, prompt.description, prompt.content, prompt.category, ...(prompt.tags || [])]
      .some((value) => String(value || '').toLowerCase().includes(normalizedSearch))
  }).sort((first, second) => new Date(second.updatedAt) - new Date(first.updatedAt))
  const total = matchingPrompts.length
  const start = (page - 1) * pageSize
  const publicPromptFields = (prompt) => ({
    title: prompt.title,
    description: prompt.description || '',
    content: prompt.content,
    category: prompt.category,
    tags: prompt.tags || [],
    updatedAt: prompt.updatedAt,
  })
  return res.json({
    prompts: matchingPrompts.slice(start, start + pageSize).map(publicPromptFields),
    categories: availableCategories,
    pagination: { page, pageSize, total, pages: Math.ceil(total / pageSize) },
  })
}

async function setPromptVisibility(req, res) {
  const prompt = await findOwnedPrompt(req.params.id, req.user.id)
  if (!prompt) {
    return res.status(404).json({ message: 'Prompt not found.' })
  }

  const isPublic = Boolean(req.body?.isPublic)
  const visibilityChanged = isPublic !== Boolean(prompt.isPublic)
  if (visibilityChanged) {
    prompt.isPublic = isPublic
    prompt.shareId = isPublic ? crypto.randomUUID() : undefined
    prompt.moderationStatus = isPublic ? 'pending' : 'approved'
    prompt.moderationReason = ''
    prompt.moderatedBy = ''
    prompt.moderatedAt = null
  }
  prompt.updatedAt = new Date()

  if (isMongoConnected()) {
    await prompt.save()
  } else {
    prompt.updatedAt = prompt.updatedAt.toISOString()
    save()
  }

  if (visibilityChanged) {
    await recordActivity({
      userId: req.user.id,
      action: isPublic ? 'prompt.sharing_enabled' : 'prompt.sharing_disabled',
      entityType: 'prompt',
      entityId: prompt.id,
      entityTitle: prompt.title,
    })
  }
  return res.json({
    message: isPublic ? 'Prompt sharing enabled.' : 'Prompt sharing disabled.',
    prompt: normalizePrompt(prompt),
  })
}

async function getPromptVersions(req, res) {
  const prompt = await findOwnedPrompt(req.params.id, req.user.id)
  if (!prompt) {
    return res.status(404).json({ message: 'Prompt not found.' })
  }

  ensureVersionHistory(prompt, req.user.id)
  if (isMongoConnected()) {
    await prompt.save()
  } else {
    save()
  }

  const versions = [...prompt.versionHistory]
    .map((version) => version.toObject ? version.toObject() : version)
    .sort((first, second) => second.version - first.version)
  return res.json({ versions })
}

async function restorePromptVersion(req, res) {
  const versionNumber = Number(req.params.version)
  if (!Number.isInteger(versionNumber) || versionNumber < 1) {
    return res.status(400).json({ message: 'A valid version number is required.' })
  }

  const prompt = await findOwnedPrompt(req.params.id, req.user.id)
  if (!prompt) {
    return res.status(404).json({ message: 'Prompt not found.' })
  }

  ensureVersionHistory(prompt, req.user.id)
  const selectedVersion = prompt.versionHistory.find(
    (version) => version.version === versionNumber,
  )
  if (!selectedVersion) {
    return res.status(404).json({ message: 'Prompt version not found.' })
  }

  prompt.title = selectedVersion.title
  prompt.description = selectedVersion.description
  prompt.content = selectedVersion.content
  prompt.category = selectedVersion.category
  prompt.tags = [...selectedVersion.tags]
  appendVersion(prompt, req.user.id, `Restored from version ${versionNumber}`)
  prompt.updatedAt = new Date()

  if (isMongoConnected()) {
    await prompt.save()
    await recordActivity({
      userId: req.user.id,
      action: 'prompt.version_restored',
      entityType: 'prompt',
      entityId: prompt.id,
      entityTitle: prompt.title,
      details: `Version ${versionNumber}`,
    })
    return res.json({
      message: `Version ${versionNumber} restored as a new version.`,
      prompt: normalizePrompt(prompt),
    })
  }

  prompt.updatedAt = prompt.updatedAt.toISOString()
  save()
  await recordActivity({
    userId: req.user.id,
    action: 'prompt.version_restored',
    entityType: 'prompt',
    entityId: prompt.id,
    entityTitle: prompt.title,
    details: `Version ${versionNumber}`,
  })
  return res.json({
    message: `Version ${versionNumber} restored as a new version.`,
    prompt,
  })
}

async function duplicatePrompt(req, res) {
  const source = await findOwnedPrompt(req.params.id, req.user.id)
  if (!source) {
    return res.status(404).json({ message: 'Prompt not found.' })
  }

  const duplicatePayload = {
    userId: req.user.id,
    title: `${source.title} (copy)`,
    description: source.description || '',
    content: source.content,
    category: source.category,
    tags: [...(source.tags || [])],
    favorite: false,
    archived: false,
  }
  duplicatePayload.versionHistory = [
    createVersion(duplicatePayload, 1, req.user.id, `Copied from "${source.title}"`),
  ]

  if (isMongoConnected()) {
    const duplicate = await Prompt.create(duplicatePayload)
    await recordActivity({
      userId: req.user.id,
      action: 'prompt.duplicated',
      entityType: 'prompt',
      entityId: duplicate.id,
      entityTitle: duplicate.title,
      details: `Copied from ${source.title}`,
    })
    return res.status(201).json({
      message: 'Prompt duplicated successfully.',
      prompt: normalizePrompt(duplicate),
    })
  }

  const duplicate = {
    id: `prompt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    ...duplicatePayload,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
  prompts.unshift(duplicate)
  save()
  await recordActivity({
    userId: req.user.id,
    action: 'prompt.duplicated',
    entityType: 'prompt',
    entityId: duplicate.id,
    entityTitle: duplicate.title,
    details: `Copied from ${source.title}`,
  })
  return res.status(201).json({
    message: 'Prompt duplicated successfully.',
    prompt: duplicate,
  })
}

async function setPromptArchived(req, res, archived) {
  const prompt = await findOwnedPrompt(req.params.id, req.user.id)
  if (!prompt) {
    return res.status(404).json({ message: 'Prompt not found.' })
  }

  prompt.archived = archived
  prompt.updatedAt = new Date()

  if (isMongoConnected()) {
    await prompt.save()
    await recordActivity({
      userId: req.user.id,
      action: archived ? 'prompt.archived' : 'prompt.restored',
      entityType: 'prompt',
      entityId: prompt.id,
      entityTitle: prompt.title,
    })
    return res.json({
      message: archived ? 'Prompt archived.' : 'Prompt restored.',
      prompt: normalizePrompt(prompt),
    })
  }

  prompt.updatedAt = prompt.updatedAt.toISOString()
  save()
  await recordActivity({
    userId: req.user.id,
    action: archived ? 'prompt.archived' : 'prompt.restored',
    entityType: 'prompt',
    entityId: prompt.id,
    entityTitle: prompt.title,
  })
  return res.json({
    message: archived ? 'Prompt archived.' : 'Prompt restored.',
    prompt,
  })
}

function archivePrompt(req, res) {
  return setPromptArchived(req, res, true)
}

function restoreArchivedPrompt(req, res) {
  return setPromptArchived(req, res, false)
}

async function testPrompt(req, res) {
  const prompt = await findOwnedPrompt(req.params.id, req.user.id)
  if (!prompt) {
    return res.status(404).json({ message: 'Prompt not found.' })
  }

  const variables = req.body?.variables
  if (!variables || typeof variables !== 'object' || Array.isArray(variables)) {
    return res.status(400).json({ message: 'Variables must be provided as an object.' })
  }

  const availableVariables = extractVariables(prompt.content)
  const unknownVariables = Object.keys(variables).filter(
    (key) => !availableVariables.includes(key),
  )
  if (unknownVariables.length) {
    return res.status(400).json({
      message: `Unknown prompt variable(s): ${unknownVariables.join(', ')}.`,
    })
  }

  try {
    return res.json(renderPrompt(prompt.content, variables))
  } catch (error) {
    return res.status(400).json({ message: error.message })
  }
}

async function savePromptTestResult(req, res) {
  const prompt = await findOwnedPrompt(req.params.id, req.user.id)
  if (!prompt) {
    return res.status(404).json({ message: 'Prompt not found.' })
  }

  const { variables } = req.body || {}
  if (!variables || typeof variables !== 'object' || Array.isArray(variables)) {
    return res.status(400).json({ message: 'Variables must be provided as an object.' })
  }

  const availableVariables = extractVariables(prompt.content)
  const unknownVariables = Object.keys(variables).filter(
    (key) => !availableVariables.includes(key),
  )
  if (unknownVariables.length) {
    return res.status(400).json({
      message: `Unknown prompt variable(s): ${unknownVariables.join(', ')}.`,
    })
  }

  let result
  try {
    result = { ...renderPrompt(prompt.content, variables), createdAt: new Date() }
  } catch (error) {
    return res.status(400).json({ message: error.message })
  }

  if (isMongoConnected()) {
    prompt.testRuns.push(result)
    await prompt.save()
    await recordActivity({
      userId: req.user.id,
      action: 'prompt.test_saved',
      entityType: 'prompt',
      entityId: prompt.id,
      entityTitle: prompt.title,
    })
    return res.status(201).json({
      message: 'Test result saved successfully.',
      testRun: prompt.testRuns[prompt.testRuns.length - 1],
    })
  }

  if (!Array.isArray(prompt.testRuns)) prompt.testRuns = []
  prompt.testRuns.push({ ...result, createdAt: result.createdAt.toISOString() })
  save()
  await recordActivity({
    userId: req.user.id,
    action: 'prompt.test_saved',
    entityType: 'prompt',
    entityId: prompt.id,
    entityTitle: prompt.title,
  })
  return res.status(201).json({
    message: 'Test result saved successfully.',
    testRun: prompt.testRuns[prompt.testRuns.length - 1],
  })
}

async function listPromptTestResults(req, res) {
  const prompt = await findOwnedPrompt(req.params.id, req.user.id)
  if (!prompt) {
    return res.status(404).json({ message: 'Prompt not found.' })
  }

  const testRuns = [...(prompt.testRuns || [])]
    .map((run) => run.toObject ? run.toObject() : run)
    .sort((first, second) => new Date(second.createdAt) - new Date(first.createdAt))
  return res.json({ testRuns })
}

async function deletePrompt(req, res) {
  if (isMongoConnected()) {
    const prompt = await Prompt.findOneAndDelete({
      _id: req.params.id,
      userId: req.user.id,
    })
    if (!prompt) {
      return res.status(404).json({ message: 'Prompt not found.' })
    }
    await recordActivity({
      userId: req.user.id,
      action: 'prompt.deleted',
      entityType: 'prompt',
      entityId: prompt.id,
      entityTitle: prompt.title,
    })
    return res.json({
      message: 'Prompt deleted successfully.',
      prompt: normalizePrompt(prompt),
    })
  }

  const index = prompts.findIndex(
    (prompt) => prompt.id === req.params.id && prompt.userId === req.user.id,
  )
  if (index === -1) {
    return res.status(404).json({ message: 'Prompt not found.' })
  }

  const [deletedPrompt] = prompts.splice(index, 1)
  save()
  await recordActivity({
    userId: req.user.id,
    action: 'prompt.deleted',
    entityType: 'prompt',
    entityId: deletedPrompt.id,
    entityTitle: deletedPrompt.title,
  })
  return res.json({ message: 'Prompt deleted successfully.', prompt: deletedPrompt })
}

module.exports = {
  listPrompts,
  recordPromptCopy,
  createPrompt,
  updatePrompt,
  getPublicPrompt,
  listFeaturedPublicPrompts,
  setPromptVisibility,
  getPromptVersions,
  restorePromptVersion,
  duplicatePrompt,
  archivePrompt,
  restoreArchivedPrompt,
  testPrompt,
  savePromptTestResult,
  listPromptTestResults,
  deletePrompt,
}
