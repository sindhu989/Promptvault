const express = require('express')
const { importPrompts, exportPromptsForUser } = require('../controllers/importExportController')
const { protect } = require('../middleware/auth')

const router = express.Router()

router.post('/import', protect, importPrompts)
router.get('/export', protect, exportPromptsForUser)

module.exports = router
