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
const { protectAdmin } = require('../middleware/adminAuth')

const router = express.Router()

router.get('/', protectAdmin, getAdminDashboard)
router.get('/users', protectAdmin, listUsers)
router.get('/users/:id', protectAdmin, getUserDetails)
router.patch('/users/:id/status', protectAdmin, updateUserStatus)
router.patch('/users/:id/role', protectAdmin, updateUserRole)
router.post('/users/:id/reset-access', protectAdmin, resetUserAccess)
router.delete('/users/:id', protectAdmin, deleteUser)

module.exports = router
