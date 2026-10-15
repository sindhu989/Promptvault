const bcrypt = require('bcryptjs')

const DUMMY_PASSWORD_HASH = '$2b$10$wfckywfXzHfKj7NHh2XX7.XbTTaLFcLJg0sxCMQPdYSGcOSp.krLG'

async function verifyPassword(password, passwordHash) {
  const matches = await bcrypt.compare(password, passwordHash || DUMMY_PASSWORD_HASH)
  return Boolean(passwordHash) && matches
}

module.exports = { verifyPassword }
