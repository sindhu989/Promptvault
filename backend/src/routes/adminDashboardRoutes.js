const express = require('express')
const { getAdminDashboard } = require('../controllers/adminDashboardController')
const {
  listUsers,
  getUserDetails,
  updateUserStatus,
  updateUserRole,
  resetUserAccess,
  deleteUser,
} = require('../controllers/adminUsersController')
const {
  listPrompts,
  getPromptDetails,
  updatePrompt,
  moderatePrompt,
  updatePromptFlag,
  deletePrompt,
} = require('../controllers/adminPromptsController')
const {
  listCollections,
  getCollectionDetails,
  updateCollection,
  deleteCollection,
} = require('../controllers/adminCollectionsController')
const { protectAdmin } = require('../middleware/adminAuth')

const router = express.Router()

router.get('/', protectAdmin, getAdminDashboard)
router.get('/users', protectAdmin, listUsers)
router.get('/users/:id', protectAdmin, getUserDetails)
router.patch('/users/:id/status', protectAdmin, updateUserStatus)
router.patch('/users/:id/role', protectAdmin, updateUserRole)
router.post('/users/:id/reset-access', protectAdmin, resetUserAccess)
router.delete('/users/:id', protectAdmin, deleteUser)
router.get('/prompts', protectAdmin, listPrompts)
router.get('/prompts/:id', protectAdmin, getPromptDetails)
router.patch('/prompts/:id', protectAdmin, updatePrompt)
router.patch('/prompts/:id/moderation', protectAdmin, moderatePrompt)
router.patch('/prompts/:id/flags/:flag', protectAdmin, updatePromptFlag)
router.delete('/prompts/:id', protectAdmin, deletePrompt)
router.get('/collections', protectAdmin, listCollections)
router.get('/collections/:id', protectAdmin, getCollectionDetails)
router.patch('/collections/:id', protectAdmin, updateCollection)
router.delete('/collections/:id', protectAdmin, deleteCollection)

module.exports = router
