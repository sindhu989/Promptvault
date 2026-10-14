const express = require('express')
const { getPublicCollection } = require('../controllers/collectionController')
const { getPublicPrompt, listFeaturedPublicPrompts } = require('../controllers/promptController')

const router = express.Router()

router.get('/prompts/featured', listFeaturedPublicPrompts)
router.get('/prompts/:shareId', getPublicPrompt)
router.get('/collections/:shareId', getPublicCollection)

module.exports = router
