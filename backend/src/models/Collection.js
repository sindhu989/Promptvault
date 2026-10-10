const mongoose = require('mongoose')

const collectionSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    description: { type: String, default: '', maxlength: 240 },
    promptIds: [{ type: String }],
    isPublic: { type: Boolean, default: false },
    shareId: { type: String, default: undefined },
    userId: { type: String, required: true, index: true },
  },
  { timestamps: true },
)

collectionSchema.index(
  { shareId: 1 },
  { unique: true, sparse: true },
)

module.exports = mongoose.model('Collection', collectionSchema)
