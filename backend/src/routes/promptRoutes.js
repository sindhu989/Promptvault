const express = require('express')
const {
  listPrompts,
  recordPromptCopy,
  createPrompt,
  updatePrompt,
  setPromptVisibility,
  getPromptVersions,
  restorePromptVersion,
  duplicatePrompt,
  archivePrompt,
  restoreArchivedPrompt,
  testPrompt,
  savePromptTestResult,
  listPromptTestResults,
  deletePrompt,
} = require('../controllers/promptController')
const { protect } = require('../middleware/auth')

const router = express.Router()

router.use(protect)
router.get('/', listPrompts)
router.post('/', createPrompt)
router.post('/:id/copy', recordPromptCopy)
router.get('/:id/versions', getPromptVersions)
router.post('/:id/versions/:version/restore', restorePromptVersion)
router.post('/:id/duplicate', duplicatePrompt)
router.post('/:id/archive', archivePrompt)
router.post('/:id/restore', restoreArchivedPrompt)
router.put('/:id/sharing', setPromptVisibility)
router.post('/:id/test', testPrompt)
router.post('/:id/test-results', savePromptTestResult)
router.get('/:id/test-results', listPromptTestResults)
router.put('/:id', updatePrompt)
router.delete('/:id', deletePrompt)

module.exports = router
