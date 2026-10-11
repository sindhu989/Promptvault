const mongoose = require('mongoose')

const activitySchema = new mongoose.Schema(
  {
    userId: { type: String, required: true },
    action: { type: String, required: true, maxlength: 60 },
    entityType: { type: String, required: true, enum: ['prompt', 'collection', 'import'] },
    entityId: { type: String, default: '' },
    entityTitle: { type: String, required: true, maxlength: 160 },
    details: { type: String, default: '', maxlength: 200 },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
)

activitySchema.index({ userId: 1, createdAt: -1 })

module.exports = mongoose.model('Activity', activitySchema)
