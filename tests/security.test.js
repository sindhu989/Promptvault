const assert = require('node:assert/strict')
const bcrypt = require('../backend/node_modules/bcryptjs')
const fs = require('node:fs')
const mongoose = require('../backend/node_modules/mongoose')
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

test('health check reports MongoDB outages as unavailable', async () => {
  const previousMongoUri = process.env.MONGODB_URI
  const previousReadyState = mongoose.connection.readyState
  process.env.MONGODB_URI = 'mongodb://health-check.invalid/promptvault'
  mongoose.connection.readyState = 0

  try {
    const response = await fetch(`${baseUrl}/api/health`)
    assert.equal(response.status, 503)
    assert.deepEqual(await response.json(), {
      status: 'error',
      message: 'PromptVault database is unavailable.',
      mode: 'disconnected',
    })

    const publicApiResponse = await fetch(`${baseUrl}/api/public/prompts/featured`)
    assert.equal(publicApiResponse.status, 503)
    assert.deepEqual(await publicApiResponse.json(), {
      message: 'PromptVault database is unavailable.',
    })
  } finally {
    mongoose.connection.readyState = previousReadyState
    if (previousMongoUri === undefined) {
      delete process.env.MONGODB_URI
    } else {
      process.env.MONGODB_URI = previousMongoUri
    }
  }
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

test('admin collection management is protected, sanitized, and leaves prompts on deletion', async () => {
  const owner = {
    id: 'security-collection-owner',
    name: 'Collection Owner',
    email: 'collection-owner@example.test',
    role: 'user',
  }
  const admin = {
    id: 'security-collection-admin',
    name: 'Collection Admin',
    email: 'collection-admin@example.test',
    role: 'admin',
    authVersion: 0,
  }
  const prompt = {
    id: 'security-collection-prompt',
    userId: owner.id,
    title: 'Collection member prompt',
    content: 'Private prompt body',
    category: 'Testing',
    isPublic: false,
    archived: false,
    updatedAt: new Date().toISOString(),
  }
  const collection = {
    id: 'security-managed-collection',
    userId: owner.id,
    name: 'Managed [collection]',
    description: 'A collection to manage',
    promptIds: [prompt.id],
    isPublic: true,
    shareId: 'security-managed-collection-share',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
  const sessionId = 'security-collection-admin-session'
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
  prompts.push(prompt)
  collections.push(collection)
  adminSessions.push(adminSession)
  fs.mkdirSync = () => {}
  fs.writeFileSync = () => {}
  fs.renameSync = () => {}

  try {
    const unauthorized = await fetch(`${baseUrl}/api/admin/dashboard/collections`)
    assert.equal(unauthorized.status, 401)
    const cookie = `${adminCookieName}=${signAdminToken(admin.id, sessionId, 0)}`
    const listResponse = await fetch(
      `${baseUrl}/api/admin/dashboard/collections?visibility=public&search=%5Bcollection%5D`,
      { headers: { Cookie: cookie } },
    )
    assert.equal(listResponse.status, 200)
    const listBody = await listResponse.json()
    assert.deepEqual(listBody.collections.map((item) => item.id), [collection.id])
    assert.equal(listBody.collections[0].shareId, undefined)

    const detailResponse = await fetch(
      `${baseUrl}/api/admin/dashboard/collections/${collection.id}`,
      { headers: { Cookie: cookie } },
    )
    const detailBody = await detailResponse.json()
    assert.equal(detailResponse.status, 200)
    assert.equal(detailBody.prompts[0].content, undefined)
    assert.equal(detailBody.prompts[0].title, prompt.title)

    const updatedResponse = await fetch(`${baseUrl}/api/admin/dashboard/collections/${collection.id}`, {
      method: 'PATCH',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Reviewed collection', isPublic: false }),
    })
    assert.equal(updatedResponse.status, 200)
    assert.equal((await updatedResponse.json()).collection.isPublic, false)
    assert.equal(collection.shareId, undefined)
    assert.equal((await fetch(`${baseUrl}/api/public/collections/security-managed-collection-share`)).status, 404)

    const deleteResponse = await fetch(`${baseUrl}/api/admin/dashboard/collections/${collection.id}`, {
      method: 'DELETE',
      headers: { Cookie: cookie },
    })
    assert.equal(deleteResponse.status, 200)
    assert.equal(collections.includes(collection), false)
    assert.equal(prompts.includes(prompt), true)
  } finally {
    fs.mkdirSync = originalFsMethods.mkdirSync
    fs.writeFileSync = originalFsMethods.writeFileSync
    fs.renameSync = originalFsMethods.renameSync
    for (const [list, items] of [
      [users, [owner, admin]],
      [prompts, [prompt]],
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

test('admin activity log is protected, searchable, filterable, and paginated', async () => {
  const account = {
    id: 'security-audit-user',
    name: 'Audit Searchable User',
    email: 'audit-searchable@example.test',
    password: 'never-return-this',
    role: 'user',
  }
  const admin = {
    id: 'security-audit-admin',
    name: 'Audit Admin',
    email: 'audit-admin@example.test',
    role: 'admin',
    authVersion: 0,
  }
  const event = {
    id: 'security-audit-event',
    userId: account.id,
    action: 'prompt.updated',
    entityType: 'prompt',
    entityId: 'unneeded-id',
    entityTitle: 'Audit test prompt',
    details: 'Updated for audit testing',
    createdAt: '2026-10-10T12:30:00.000Z',
  }
  const sessionId = 'security-audit-admin-session'
  const adminSession = {
    tokenId: sessionId,
    userId: admin.id,
    revokedAt: null,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  }
  users.push(account, admin)
  activities.push(event)
  adminSessions.push(adminSession)

  try {
    const unauthorized = await fetch(`${baseUrl}/api/admin/dashboard/activity`)
    assert.equal(unauthorized.status, 401)

    const cookie = `${adminCookieName}=${signAdminToken(admin.id, sessionId, 0)}`
    const response = await fetch(
      `${baseUrl}/api/admin/dashboard/activity?search=audit-searchable&entityType=prompt&action=prompt.updated&from=2026-10-10&to=2026-10-10`,
      { headers: { Cookie: cookie } },
    )
    assert.equal(response.status, 200)
    const body = await response.json()
    assert.equal(body.pagination.total, 1)
    assert.equal(body.activity[0].id, event.id)
    assert.equal(body.activity[0].user.name, account.name)
    assert.equal(body.activity[0].user.password, undefined)
    assert.equal(body.activity[0].user.id, undefined)
    assert.equal(body.activity[0].entityId, undefined)

    const invalidDateResponse = await fetch(
      `${baseUrl}/api/admin/dashboard/activity?from=2026-02-30`,
      { headers: { Cookie: cookie } },
    )
    assert.equal(invalidDateResponse.status, 400)

    const invalidWindowResponse = await fetch(
      `${baseUrl}/api/admin/dashboard/activity?from=2026-10-11&to=2026-10-10`,
      { headers: { Cookie: cookie } },
    )
    assert.equal(invalidWindowResponse.status, 400)
  } finally {
    for (const [list, items] of [
      [users, [account, admin]],
      [activities, [event]],
      [adminSessions, [adminSession]],
    ]) {
      for (const item of items) {
        const index = list.indexOf(item)
        if (index >= 0) list.splice(index, 1)
      }
    }
  }
})

test('first admin bootstrap uses backend environment settings without a browser secret', async () => {
  const bootstrapAdmin = {
    id: 'security-bootstrap-admin',
    name: 'Bootstrap Admin',
    email: 'bootstrap-admin@example.test',
    password: await bcrypt.hash('Correct Horse Battery12!', 10),
    role: 'user',
    authVersion: 0,
  }
  const previousEnvironment = {
    email: process.env.ADMIN_EMAIL,
    secret: process.env.ADMIN_BOOTSTRAP_SECRET,
  }
  const originalFsMethods = {
    mkdirSync: fs.mkdirSync,
    writeFileSync: fs.writeFileSync,
    renameSync: fs.renameSync,
  }
  users.push(bootstrapAdmin)
  process.env.ADMIN_EMAIL = bootstrapAdmin.email
  process.env.ADMIN_BOOTSTRAP_SECRET = 'a-private-test-bootstrap-secret-value'
  fs.mkdirSync = () => {}
  fs.writeFileSync = () => {}
  fs.renameSync = () => {}

  try {
    const response = await fetch(`${baseUrl}/api/admin/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: bootstrapAdmin.email, password: 'Correct Horse Battery12!' }),
    })
    const body = await response.json()
    assert.equal(response.status, 200)
    assert.equal(bootstrapAdmin.role, 'admin')
    assert.equal(body.user.role, 'admin')
    assert.match(response.headers.get('set-cookie'), /HttpOnly/i)
  } finally {
    fs.mkdirSync = originalFsMethods.mkdirSync
    fs.writeFileSync = originalFsMethods.writeFileSync
    fs.renameSync = originalFsMethods.renameSync
    if (previousEnvironment.email === undefined) delete process.env.ADMIN_EMAIL
    else process.env.ADMIN_EMAIL = previousEnvironment.email
    if (previousEnvironment.secret === undefined) delete process.env.ADMIN_BOOTSTRAP_SECRET
    else process.env.ADMIN_BOOTSTRAP_SECRET = previousEnvironment.secret
    const index = users.indexOf(bootstrapAdmin)
    if (index >= 0) users.splice(index, 1)
    const sessions = adminSessions.filter((session) => session.userId === bootstrapAdmin.id)
    for (const session of sessions) {
      const sessionIndex = adminSessions.indexOf(session)
      if (sessionIndex >= 0) adminSessions.splice(sessionIndex, 1)
    }
  }
})

test('featured public prompt directory only returns approved shared featured prompts', async () => {
  const featuredPrompt = {
    id: 'security-public-featured-prompt',
    userId: 'directory-owner',
    title: 'Featured public prompt',
    description: 'A searchable description',
    content: 'Write about public libraries',
    category: 'Writing',
    tags: ['community'],
    isPublic: true,
    featured: true,
    moderationStatus: 'approved',
    archived: false,
    shareId: 'public-featured-share-id',
    versionHistory: [{ content: 'private prior version' }],
    testRuns: [{ output: 'private saved output' }],
    updatedAt: new Date().toISOString(),
  }
  const pendingPrompt = {
    ...featuredPrompt,
    id: 'security-public-featured-pending',
    title: 'Pending featured prompt',
    moderationStatus: 'pending',
    shareId: 'pending-featured-share-id',
  }
  const privatePrompt = {
    ...featuredPrompt,
    id: 'security-private-featured-prompt',
    title: 'Private featured prompt',
    isPublic: false,
    shareId: undefined,
  }
  const unfeaturedPrompt = {
    ...featuredPrompt,
    id: 'security-public-unfeatured-prompt',
    title: 'Public unfeatured prompt',
    featured: false,
    shareId: 'public-unfeatured-share-id',
  }
  const archivedPrompt = {
    ...featuredPrompt,
    id: 'security-public-archived-prompt',
    title: 'Archived featured prompt',
    archived: true,
    shareId: 'public-archived-share-id',
  }
  const fixtures = [featuredPrompt, pendingPrompt, privatePrompt, unfeaturedPrompt, archivedPrompt]
  prompts.push(...fixtures)

  try {
    const response = await fetch(`${baseUrl}/api/public/prompts/featured?search=public%20libraries&category=Writing`)
    assert.equal(response.status, 200)
    const body = await response.json()
    assert.equal(body.pagination.total, 1)
    assert.deepEqual(body.prompts.map((prompt) => prompt.title), ['Featured public prompt'])
    assert.deepEqual(body.categories, ['Writing'])
    assert.equal(body.prompts[0].shareId, undefined)
    assert.equal(body.prompts[0].versionHistory, undefined)
    assert.equal(body.prompts[0].testRuns, undefined)

    const invalidPageResponse = await fetch(`${baseUrl}/api/public/prompts/featured?page=0`)
    assert.equal(invalidPageResponse.status, 400)
  } finally {
    for (const fixture of fixtures) {
      const index = prompts.indexOf(fixture)
      if (index >= 0) prompts.splice(index, 1)
    }
  }
})
