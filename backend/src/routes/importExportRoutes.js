const express = require('express')
const { importPrompts, exportPromptsForUser } = require('../controllers/importExportController')
const { protect } = require('../middleware/auth')

const router = express.Router()

router.use(protect)
router.post('/import', importPrompts)
router.get('/export', exportPromptsForUser)

module.exports = router
