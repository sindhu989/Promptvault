const { listActivity } = require('../services/activityLog')

async function getActivity(req, res) {
  const activity = await listActivity(req.user.id)
  return res.json({ activity })
}

module.exports = { getActivity }
