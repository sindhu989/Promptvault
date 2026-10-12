const mongoose = require('mongoose')

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true },
    password: { type: String, required: true },
    authVersion: { type: Number, default: 0 },
    role: { type: String, enum: ['user', 'admin'], default: 'user' },
    status: { type: String, enum: ['active', 'deactivated', 'suspended'], default: 'active' },
    theme: { type: String, enum: ['light', 'dark'], default: 'light' },
    passwordResetToken: { type: String, default: undefined },
    passwordResetExpires: { type: Date, default: undefined },
  },
  { timestamps: true },
)

userSchema.index({ status: 1, role: 1, createdAt: -1 })

module.exports = mongoose.model('User', userSchema)
