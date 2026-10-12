const mongoose = require('mongoose')
const { prompts, users, collections, save } = require('../data/store')
const Prompt = require('../models/Prompt')
const User = require('../models/User')
const Collection = require('../models/Collection')
const { recordActivity } = require('../services/activityLog')

const PAGE_SIZE = 25
const MAX_PAGE = 10000
const MODERATION_STATUSES = new Set(['pending', 'approved', 'rejected'])
const PROMPT_FIELDS = ['title', 'description', 'content', 'category', 'tags']

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function parseFilters(query) {
  const page = Number.parseInt(query.page || '1', 10)
  const search = String(query.search || '').trim().slice(0, 100)
  const moderationStatus = String(query.moderationStatus || '')
  const archived = String(query.archived || '')
  const featured = String(query.featured || '')
  if (!Number.isInteger(page) || page < 1 || page > MAX_PAGE) return { error: 'Page number is invalid.' }
  if (moderationStatus && !MODERATION_STATUSES.has(moderationStatus)) {
    return { error: 'Moderation status filter is invalid.' }
  }
  if (archived && archived !== 'true' && archived !== 'false') return { error: 'Archive filter is invalid.' }
  if (featured && featured !== 'true' && featured !== 'false') return { error: 'Featured filter is invalid.' }
  return { page, search, moderationStatus, archived, featured }
}

function moderationState(prompt) {
  return MODERATION_STATUSES.has(prompt.moderationStatus) ? prompt.moderationStatus : 'approved'
}

function safePrompt(prompt, owner) {
  return {
    id: String(prompt._id || prompt.id),
    title: prompt.title,
    description: prompt.description || '',
    content: prompt.content,
    category: prompt.category,
    tags: prompt.tags || [],
    isPublic: Boolean(prompt.isPublic),
    archived: Boolean(prompt.archived),
    featured: Boolean(prompt.featured),
    moderationStatus: moderationState(prompt),
    moderationReason: prompt.moderationReason || '',
    moderatedAt: prompt.moderatedAt || null,
    owner: owner ? { id: String(owner._id || owner.id), name: owner.name, email: owner.email } : null,
    createdAt: prompt.createdAt,
    updatedAt: prompt.updatedAt,
    versionCount: Array.isArray(prompt.versionHistory) ? prompt.versionHistory.length : 0,
  }
}

function matchesFilters(prompt, search, moderationStatus, archived, featured) {
  const promptStatus = moderationState(prompt)
  if (moderationStatus && promptStatus !== moderationStatus) return false
  if (archived && Boolean(prompt.archived) !== (archived === 'true')) return false
  if (featured && Boolean(prompt.featured) !== (featured === 'true')) return false
  if (!search) return true
  const value = search.toLowerCase()
  return [prompt.title, prompt.content, prompt.category, ...(prompt.tags || [])]
    .some((field) => String(field || '').toLowerCase().includes(value))
}

async function listPrompts(req, res, next) {
  try {
    const filters = parseFilters(req.query)
    if (filters.error) return res.status(400).json({ message: filters.error })
    const { page, search, moderationStatus, archived, featured } = filters
    const skip = (page - 1) * PAGE_SIZE

    if (mongoose.connection.readyState === 1) {
      const conditions = []
      if (moderationStatus === 'approved') conditions.push({ $or: [{ moderationStatus: 'approved' }, { moderationStatus: { $exists: false } }] })
      else if (moderationStatus) conditions.push({ moderationStatus })
      if (archived) conditions.push({ archived: archived === 'true' })
      if (featured) conditions.push({ featured: featured === 'true' })
      if (search) {
        const safeSearch = new RegExp(escapeRegex(search), 'i')
        conditions.push({ $or: [{ title: safeSearch }, { content: safeSearch }, { category: safeSearch }, { tags: safeSearch }] })
      }
      const filter = conditions.length ? { $and: conditions } : {}
      const [total, pagePrompts] = await Promise.all([
        Prompt.countDocuments(filter),
        Prompt.find(filter).sort({ updatedAt: -1, _id: -1 }).skip(skip).limit(PAGE_SIZE)
          .select('-testRuns -versionHistory.content')
          .lean(),
      ])
      const ownerIds = [...new Set(pagePrompts.map((prompt) => prompt.userId))]
      const owners = await User.find({ _id: { $in: ownerIds } }).select('name email').lean()
      const ownerMap = new Map(owners.map((owner) => [String(owner._id), owner]))
      return res.json({
        prompts: pagePrompts.map((prompt) => safePrompt(prompt, ownerMap.get(prompt.userId))),
        pagination: { page, pageSize: PAGE_SIZE, total, pages: Math.ceil(total / PAGE_SIZE) },
      })
    }

    let results = prompts.filter((prompt) => matchesFilters(prompt, search, moderationStatus, archived, featured))
    results.sort((first, second) => new Date(second.updatedAt) - new Date(first.updatedAt))
    const total = results.length
    const pagePrompts = results.slice(skip, skip + PAGE_SIZE)
    const ownerMap = new Map(users.map((user) => [user.id, user]))
    return res.json({
      prompts: pagePrompts.map((prompt) => safePrompt(prompt, ownerMap.get(prompt.userId))),
      pagination: { page, pageSize: PAGE_SIZE, total, pages: Math.ceil(total / PAGE_SIZE) },
    })
  } catch (error) {
    return next(error)
  }
}

async function findPrompt(id) {
  if (mongoose.connection.readyState === 1) {
    if (!mongoose.isValidObjectId(id)) return null
    return Prompt.findById(id)
  }
  return prompts.find((prompt) => prompt.id === id) || null
}

async function getPromptDetails(req, res, next) {
  try {
    const prompt = await findPrompt(req.params.id)
    if (!prompt) return res.status(404).json({ message: 'Prompt not found.' })
    const owner = mongoose.connection.readyState === 1
      ? await User.findById(prompt.userId).select('name email').lean()
      : users.find((user) => user.id === prompt.userId)
    return res.json({ prompt: safePrompt(prompt, owner) })
  } catch (error) {
    return next(error)
  }
}

function getUpdate(body) {
  const update = {}
  for (const field of PROMPT_FIELDS) {
    if (body[field] !== undefined) {
      update[field] = field === 'tags' && Array.isArray(body[field])
        ? [...new Set(body[field].map((tag) => String(tag).trim()).filter(Boolean))].slice(0, 30)
        : String(body[field]).trim()
    }
  }
  if (update.title !== undefined && (!update.title || update.title.length > 120)) return { error: 'Title must be between 1 and 120 characters.' }
  if (update.description !== undefined && update.description.length > 500) return { error: 'Description must be 500 characters or fewer.' }
  if (update.content !== undefined && (!update.content || update.content.length > 20000)) return { error: 'Content must be between 1 and 20000 characters.' }
  if (update.category !== undefined && (!update.category || update.category.length > 80)) return { error: 'Category must be between 1 and 80 characters.' }
  if (body.tags !== undefined && !Array.isArray(body.tags)) return { error: 'Tags must be an array.' }
  return { update }
}

function appendAdminVersion(prompt, adminId, update) {
  const changed = Object.entries(update).some(([key, value]) => key === 'tags'
    ? JSON.stringify(prompt.tags || []) !== JSON.stringify(value)
    : prompt[key] !== value)
  if (!changed) return false
  if (!prompt.versionHistory?.length) {
    prompt.versionHistory = [{
      version: 1,
      title: prompt.title,
      description: prompt.description || '',
      content: prompt.content,
      category: prompt.category,
      tags: prompt.tags || [],
      changeNotes: 'Initial version',
      creatorId: prompt.userId,
      createdAt: new Date(),
    }]
  }
  Object.assign(prompt, update)
  const lastVersion = prompt.versionHistory[prompt.versionHistory.length - 1].version
  prompt.versionHistory.push({
    version: lastVersion + 1,
    title: prompt.title,
    description: prompt.description || '',
    content: prompt.content,
    category: prompt.category,
    tags: prompt.tags || [],
    changeNotes: 'Edited by an administrator',
    creatorId: adminId,
    createdAt: new Date(),
  })
  if (prompt.isPublic) {
    prompt.moderationStatus = 'pending'
    prompt.moderationReason = ''
    prompt.moderatedBy = ''
    prompt.moderatedAt = null
  }
  return true
}

async function updatePrompt(req, res, next) {
  try {
    const prompt = await findPrompt(req.params.id)
    if (!prompt) return res.status(404).json({ message: 'Prompt not found.' })
    const result = getUpdate(req.body || {})
    if (result.error) return res.status(400).json({ message: result.error })
    const changed = appendAdminVersion(prompt, req.user.id, result.update)
    prompt.updatedAt = new Date()
    if (mongoose.connection.readyState === 1) await prompt.save()
    else {
      prompt.updatedAt = prompt.updatedAt.toISOString()
      save()
    }
    if (changed) {
      await recordActivity({
        userId: prompt.userId,
        action: 'prompt.admin_edited',
        entityType: 'prompt',
        entityId: prompt.id,
        entityTitle: prompt.title,
        details: `Edited by administrator ${req.user.id}`,
      })
    }
    return res.json({ message: 'Prompt updated.', prompt: safePrompt(prompt) })
  } catch (error) {
    return next(error)
  }
}

async function moderatePrompt(req, res, next) {
  try {
    const status = req.body?.status
    if (!['approved', 'rejected'].includes(status)) {
      return res.status(400).json({ message: 'Status must be approved or rejected.' })
    }
    const reason = String(req.body?.reason || '').trim().slice(0, 500)
    if (status === 'rejected' && !reason) return res.status(400).json({ message: 'A reason is required when rejecting a prompt.' })
    const prompt = await findPrompt(req.params.id)
    if (!prompt) return res.status(404).json({ message: 'Prompt not found.' })
    if (!prompt.isPublic) return res.status(400).json({ message: 'Only shared prompts can be moderated.' })
    prompt.moderationStatus = status
    prompt.moderationReason = status === 'rejected' ? reason : ''
    prompt.moderatedBy = req.user.id
    prompt.moderatedAt = new Date()
    prompt.updatedAt = new Date()
    if (mongoose.connection.readyState === 1) await prompt.save()
    else {
      prompt.updatedAt = prompt.updatedAt.toISOString()
      prompt.moderatedAt = prompt.moderatedAt.toISOString()
      save()
    }
    await recordActivity({
      userId: prompt.userId,
      action: `prompt.admin_${status}`,
      entityType: 'prompt',
      entityId: prompt.id,
      entityTitle: prompt.title,
      details: status === 'rejected' ? reason : `Reviewed by administrator ${req.user.id}`,
    })
    return res.json({ message: `Prompt ${status}.`, prompt: safePrompt(prompt) })
  } catch (error) {
    return next(error)
  }
}

async function updatePromptFlag(req, res, next) {
  try {
    const { flag } = req.params
    if (!['archived', 'featured'].includes(flag) || typeof req.body?.value !== 'boolean') {
      return res.status(400).json({ message: 'A valid prompt flag and boolean value are required.' })
    }
    const prompt = await findPrompt(req.params.id)
    if (!prompt) return res.status(404).json({ message: 'Prompt not found.' })
    prompt[flag] = req.body.value
    prompt.updatedAt = new Date()
    if (mongoose.connection.readyState === 1) await prompt.save()
    else {
      prompt.updatedAt = prompt.updatedAt.toISOString()
      save()
    }
    await recordActivity({
      userId: prompt.userId,
      action: `prompt.admin_${flag}_${req.body.value ? 'enabled' : 'disabled'}`,
      entityType: 'prompt',
      entityId: prompt.id,
      entityTitle: prompt.title,
      details: `Changed by administrator ${req.user.id}`,
    })
    return res.json({ message: `Prompt ${flag} status updated.`, prompt: safePrompt(prompt) })
  } catch (error) {
    return next(error)
  }
}

async function deletePrompt(req, res, next) {
  try {
    let prompt
    if (mongoose.connection.readyState === 1) {
      prompt = await Prompt.findByIdAndDelete(req.params.id)
      if (!prompt) return res.status(404).json({ message: 'Prompt not found.' })
      await Collection.updateMany({ promptIds: String(prompt._id) }, { $pull: { promptIds: String(prompt._id) } })
    } else {
      const index = prompts.findIndex((item) => item.id === req.params.id)
      if (index === -1) return res.status(404).json({ message: 'Prompt not found.' })
      ;[prompt] = prompts.splice(index, 1)
      for (const collection of collections) {
        collection.promptIds = (collection.promptIds || []).filter((id) => id !== prompt.id)
      }
      save()
    }
    await recordActivity({
      userId: prompt.userId,
      action: 'prompt.admin_deleted',
      entityType: 'prompt',
      entityId: String(prompt._id || prompt.id),
      entityTitle: prompt.title,
      details: `Deleted by administrator ${req.user.id}`,
    })
    return res.json({ message: 'Prompt deleted.' })
  } catch (error) {
    return next(error)
  }
}

module.exports = {
  listPrompts,
  getPromptDetails,
  updatePrompt,
  moderatePrompt,
  updatePromptFlag,
  deletePrompt,
}
