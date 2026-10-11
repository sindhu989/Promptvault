const jwt = require('jsonwebtoken')

function getSecret() {
  const secret = process.env.JWT_SECRET
  if (secret) return secret
  if (process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET must be configured in production.')
  }
  return 'dev-secret'
}

function signToken(userId) {
  return jwt.sign({ id: userId }, getSecret(), {
    expiresIn: '7d',
  })
}

function signAdminToken(userId, sessionId) {
  return jwt.sign({ id: userId, scope: 'admin', jti: sessionId }, getSecret(), {
    expiresIn: '30m',
    audience: 'promptvault-admin',
  })
}

function verifyToken(token) {
  return jwt.verify(token, getSecret())
}

module.exports = { signToken, signAdminToken, verifyToken }
