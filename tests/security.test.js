const assert = require('node:assert/strict')
const bcrypt = require('../backend/node_modules/bcryptjs')
const fs = require('node:fs')
const { after, before, test } = require('node:test')
const app = require('../backend/src/app')
const { activities, adminSessions, collections, prompts, users } = require('../backend/src/data/store')
const {
  adminCookieName,
  setAdminCookie,
  setUserCookie,
  userCookieName,
} = require('../backend/src/utils/authCookie')
const { signAdminToken, signToken } = require('../backend/src/utils/jwt')

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

test('admin prompt management is protected and hides unapproved public prompts', async () => {
  const owner = {
    id: 'security-prompt-owner',
    name: 'Prompt Owner',
    email: 'prompt-owner@example.test',
    role: 'user',
  }
  const admin = {
    id: 'security-prompt-admin',
    name: 'Prompt Admin',
    email: 'prompt-admin@example.test',
    role: 'admin',
    authVersion: 0,
  }
  const prompt = {
    id: 'security-prompt-pending',
    userId: owner.id,
    title: 'Moderation [regression] prompt',
    description: '',
    content: 'Private test content',
    category: 'Testing',
    tags: ['moderation'],
    isPublic: true,
    shareId: 'security-prompt-share',
    moderationStatus: 'pending',
    archived: false,
    testRuns: [{ output: 'private test output' }],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
  const privatePrompt = {
    id: 'security-prompt-private',
    userId: owner.id,
    title: 'Private sharing regression prompt',
    description: '',
    content: 'Private content',
    category: 'Testing',
    tags: [],
    isPublic: false,
    archived: false,
    versionHistory: [],
    testRuns: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
  const collection = {
    id: 'security-prompt-collection',
    userId: owner.id,
    name: 'Public collection',
    description: '',
    promptIds: [prompt.id],
    isPublic: true,
    shareId: 'security-collection-share',
  }
  const sessionId = 'security-prompt-admin-session'
  const activitySnapshot = [...activities]
  const originalFsMethods = {
    mkdirSync: fs.mkdirSync,
    writeFileSync: fs.writeFileSync,
    renameSync: fs.renameSync,
  }
  const adminSession = {
    tokenId: sessionId,
    userId: admin.id,
    revokedAt: null,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  }
  users.push(owner, admin)
  prompts.push(prompt, privatePrompt)
  collections.push(collection)
  adminSessions.push(adminSession)
  fs.mkdirSync = () => {}
  fs.writeFileSync = () => {}
  fs.renameSync = () => {}

  try {
    const unauthorized = await fetch(`${baseUrl}/api/admin/dashboard/prompts`)
    assert.equal(unauthorized.status, 401)

    const cookie = `${adminCookieName}=${signAdminToken(admin.id, sessionId, 0)}`
    const listResponse = await fetch(
      `${baseUrl}/api/admin/dashboard/prompts?moderationStatus=pending&search=%5Bregression%5D`,
      { headers: { Cookie: cookie } },
    )
    assert.equal(listResponse.status, 200)
    const listBody = await listResponse.json()
    assert.deepEqual(listBody.prompts.map((item) => item.id), [prompt.id])
    assert.equal(listBody.prompts[0].testRuns, undefined)

    const detailResponse = await fetch(
      `${baseUrl}/api/admin/dashboard/prompts/${prompt.id}`,
      { headers: { Cookie: cookie } },
    )
    assert.equal((await detailResponse.json()).prompt.testRuns, undefined)
    assert.equal((await fetch(`${baseUrl}/api/public/prompts/${prompt.shareId}`)).status, 404)
    const pendingCollectionResponse = await fetch(`${baseUrl}/api/public/collections/${collection.shareId}`)
    assert.deepEqual((await pendingCollectionResponse.json()).prompts, [])

    prompt.moderationStatus = 'approved'
    assert.equal((await fetch(`${baseUrl}/api/public/prompts/${prompt.shareId}`)).status, 200)
    const approvedCollectionResponse = await fetch(`${baseUrl}/api/public/collections/${collection.shareId}`)
    assert.equal((await approvedCollectionResponse.json()).prompts.length, 1)

    const userCookie = `${userCookieName}=${signToken(owner.id, 0)}`
    const sharingResponse = await fetch(`${baseUrl}/api/prompts/${privatePrompt.id}/sharing`, {
      method: 'PUT',
      headers: { Cookie: userCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ isPublic: true }),
    })
    assert.equal(sharingResponse.status, 200)
    assert.equal((await sharingResponse.json()).prompt.moderationStatus, 'pending')
    const directUpdateResponse = await fetch(`${baseUrl}/api/prompts/${privatePrompt.id}`, {
      method: 'PUT',
      headers: { Cookie: userCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ isPublic: false }),
    })
    assert.equal(directUpdateResponse.status, 200)
    const reShareResponse = await fetch(`${baseUrl}/api/prompts/${privatePrompt.id}`, {
      method: 'PUT',
      headers: { Cookie: userCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ isPublic: true }),
    })
    assert.equal(reShareResponse.status, 200)
    assert.equal((await reShareResponse.json()).prompt.moderationStatus, 'pending')
  } finally {
    fs.mkdirSync = originalFsMethods.mkdirSync
    fs.writeFileSync = originalFsMethods.writeFileSync
    fs.renameSync = originalFsMethods.renameSync
    for (const [list, items] of [
      [users, [owner, admin]],
      [prompts, [prompt, privatePrompt]],
      [collections, [collection]],
      [adminSessions, [adminSession]],
    ]) {
      for (const item of items) {
        const index = list.indexOf(item)
        if (index >= 0) list.splice(index, 1)
      }
    }
    activities.splice(0, activities.length, ...activitySnapshot)
  }
})
