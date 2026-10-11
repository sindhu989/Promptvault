const express = require('express')
const { getActivity } = require('../controllers/activityController')
const { protect } = require('../middleware/auth')

const router = express.Router()

router.use(protect)
router.get('/', getActivity)

module.exports = router
