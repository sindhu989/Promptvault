const mongoose = require('mongoose')

const promptVersionSchema = new mongoose.Schema(
  {
    version: { type: Number, required: true },
    title: { type: String, required: true },
    description: { type: String, default: '' },
    content: { type: String, required: true },
    category: { type: String, required: true },
    tags: [{ type: String }],
    changeNotes: { type: String, default: '' },
    creatorId: { type: String, required: true },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: false },
)

const promptTestRunSchema = new mongoose.Schema(
  {
    variables: { type: Map, of: String, default: {} },
    renderedPrompt: { type: String, required: true },
    output: { type: String, required: true },
    provider: { type: String, default: 'mock' },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: true },
)

const promptSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    description: { type: String, default: '' },
    content: { type: String, required: true },
    category: { type: String, required: true },
    tags: [{ type: String }],
    favorite: { type: Boolean, default: false },
    archived: { type: Boolean, default: false },
    isPublic: { type: Boolean, default: false },
    moderationStatus: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'approved' },
    moderationReason: { type: String, default: '' },
    moderatedBy: { type: String, default: '' },
    moderatedAt: { type: Date, default: null },
    featured: { type: Boolean, default: false },
    shareId: { type: String, default: undefined },
    userId: { type: String, required: true },
    versionHistory: { type: [promptVersionSchema], default: [] },
    testRuns: { type: [promptTestRunSchema], default: [] },
  },
  { timestamps: true },
)

promptSchema.index(
  { shareId: 1 },
  { unique: true, sparse: true },
)
promptSchema.index({ userId: 1, updatedAt: -1 })
promptSchema.index({ moderationStatus: 1, isPublic: 1, updatedAt: -1 })

module.exports = mongoose.model('Prompt', promptSchema)
