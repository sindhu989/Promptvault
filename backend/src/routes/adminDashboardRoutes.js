const express = require('express')
const { getAdminDashboard } = require('../controllers/adminDashboardController')
const { protectAdmin } = require('../middleware/adminAuth')

const router = express.Router()

router.get('/', protectAdmin, getAdminDashboard)

module.exports = router
