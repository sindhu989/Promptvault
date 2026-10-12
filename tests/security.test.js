const assert = require('node:assert/strict')
const bcrypt = require('../backend/node_modules/bcryptjs')
const { after, before, test } = require('node:test')
const app = require('../backend/src/app')
const { users } = require('../backend/src/data/store')
const {
  adminCookieName,
  setAdminCookie,
  setUserCookie,
  userCookieName,
} = require('../backend/src/utils/authCookie')

let server
let baseUrl

before(async () => {
  server = app.listen(0)
  await new Promise((resolve) => server.once('listening', resolve))
  baseUrl = `http://127.0.0.1:${server.address().port}`
})

after(async () => {
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()))
  })
})

test('auth cookies are HttpOnly, strict same-site, and scoped to API routes', () => {
  const cookies = []
  const response = {
    cookie: (name, value, options) => cookies.push({ name, value, options }),
  }

  setUserCookie(response, 'user-session')
  setAdminCookie(response, 'admin-session')

  assert.equal(cookies[0].name, userCookieName)
  assert.equal(cookies[0].value, 'user-session')
  assert.equal(cookies[0].options.httpOnly, true)
  assert.equal(cookies[0].options.sameSite, 'strict')
  assert.equal(cookies[0].options.path, '/api')
  assert.equal(cookies[1].name, adminCookieName)
  assert.equal(cookies[1].options.maxAge, 30 * 60 * 1000)
})

test('security headers are enabled for the API', async () => {
  const response = await fetch(`${baseUrl}/api/health`)
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff')
  assert.ok(response.headers.get('content-security-policy'))
})

test('protected routes reject requests without a session cookie', async () => {
  const response = await fetch(`${baseUrl}/api/auth/me`, {
    headers: { Authorization: 'Bearer not-a-cookie-session' },
  })
  assert.equal(response.status, 401)

  const adminResponse = await fetch(`${baseUrl}/api/admin/dashboard`)
  assert.equal(adminResponse.status, 401)
})

test('user login issues an HTTP-only cookie without returning its token', async () => {
  const user = {
    id: 'security-test-user',
    name: 'Security Test',
    email: 'security-test@example.com',
    password: await bcrypt.hash('Correct Horse Battery12!', 10),
    authVersion: 0,
    role: 'user',
  }
  users.push(user)

  try {
    const loginResponse = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: user.email, password: 'Correct Horse Battery12!' }),
    })
    const loginBody = await loginResponse.json()
    const setCookie = loginResponse.headers.get('set-cookie')
    assert.equal(loginResponse.status, 200)
    assert.equal(loginBody.token, undefined)
    assert.match(setCookie, /HttpOnly/i)
    assert.match(setCookie, /SameSite=Strict/i)
    assert.match(setCookie, /Path=\/api/i)

    const cookie = setCookie.split(';', 1)[0]
    const sessionResponse = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Cookie: cookie },
    })
    assert.equal(sessionResponse.status, 200)
    assert.equal((await sessionResponse.json()).user.id, user.id)

    user.authVersion += 1
    const revokedResponse = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Cookie: cookie },
    })
    assert.equal(revokedResponse.status, 401)
  } finally {
    users.splice(users.indexOf(user), 1)
  }
})

test('untrusted browser origins are rejected', async () => {
  const response = await fetch(`${baseUrl}/api/health`, {
    headers: { Origin: 'https://untrusted.example' },
  })
  assert.equal(response.status, 403)
})

test('malformed JSON receives a client error without leaking server details', async () => {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{',
  })
  assert.equal(response.status, 400)
  assert.deepEqual(await response.json(), { message: 'Request body contains invalid JSON.' })
})
