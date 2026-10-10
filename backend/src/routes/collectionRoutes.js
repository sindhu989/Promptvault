const express = require('express')
const {
  listCollections,
  createCollection,
  updateCollection,
  deleteCollection,
  addPrompt,
  removePrompt,
  getCollectionPrompts,
} = require('../controllers/collectionController')
const { protect } = require('../middleware/auth')

const router = express.Router()

router.use(protect)
router.get('/', listCollections)
router.post('/', createCollection)
router.get('/:id/prompts', getCollectionPrompts)
router.post('/:id/prompts/:promptId', addPrompt)
router.delete('/:id/prompts/:promptId', removePrompt)
router.put('/:id', updateCollection)
router.delete('/:id', deleteCollection)

module.exports = router
