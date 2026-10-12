const mongoose = require('mongoose')
const crypto = require('crypto')
const { prompts, save } = require('../data/store')
const Prompt = require('../models/Prompt')
const { extractVariables, renderPrompt } = require('../services/promptTester')
const { recordActivity } = require('../services/activityLog')

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
  if (body.title !== undefined) update.title = String(body.title).trim()
  if (body.description !== undefined) update.description = String(body.description).trim()
  if (body.content !== undefined) update.content = String(body.content).trim()
  if (body.category !== undefined) update.category = String(body.category).trim()
  if (Array.isArray(body.tags)) {
    update.tags = body.tags.map((tag) => String(tag).trim()).filter(Boolean)
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

  if (!title || !content || !category) {
    return res.status(400).json({
      message: 'Title, content, and category are required.',
    })
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
  ensureVersionHistory(prompt, req.user.id)
  const contentChanged = hasContentChanges(prompt, update)
  Object.assign(prompt, update)
  if (body.favorite !== undefined) prompt.favorite = Boolean(body.favorite)
  if (body.isPublic !== undefined && Boolean(body.isPublic) !== Boolean(prompt.isPublic)) {
    prompt.isPublic = Boolean(body.isPublic)
    prompt.shareId = prompt.isPublic ? crypto.randomUUID() : undefined
  }

  if (contentChanged) {
    appendVersion(prompt, req.user.id, body.changeNotes)
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
      })
    : prompts.find(
        (item) =>
          item.shareId === req.params.shareId &&
          item.isPublic &&
          !item.archived,
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
