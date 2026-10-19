const assert = require('node:assert/strict')
const bcrypt = require('../backend/node_modules/bcryptjs')
const fs = require('node:fs')
const mongoose = require('../backend/node_modules/mongoose')
const { after, before, test } = require('node:test')
const app = require('../backend/src/app')
const { activities, adminSessions, collections, prompts, users } = require('../backend/src/data/store')
const Prompt = require('../backend/src/models/Prompt')
const User = require('../backend/src/models/User')
const { sendPasswordResetEmail } = require('../backend/src/services/passwordResetEmail')
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
  assert.match(response.headers.get('content-security-policy'), /frame-ancestors 'none'/)
  assert.equal(response.headers.get('x-frame-options'), 'DENY')
  assert.equal(
    response.headers.get('permissions-policy'),
    'camera=(), geolocation=(), microphone=(), payment=(), usb=()',
  )
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer')
  assert.equal(response.headers.get('cache-control'), 'no-store')
})

test('EmailJS delivery errors expose provider diagnostics without logging secrets', async () => {
  const environment = {
    EMAILJS_SERVICE_ID: process.env.EMAILJS_SERVICE_ID,
    EMAILJS_TEMPLATE_ID: process.env.EMAILJS_TEMPLATE_ID,
    EMAILJS_PUBLIC_KEY: process.env.EMAILJS_PUBLIC_KEY,
    EMAILJS_PRIVATE_KEY: process.env.EMAILJS_PRIVATE_KEY,
  }
  const originalFetch = global.fetch
  const email = 'recipient@example.test'
  const otp = '123456'
  const privateKey = 'private-test-key'
  process.env.EMAILJS_SERVICE_ID = 'service-test'
  process.env.EMAILJS_TEMPLATE_ID = 'template-test'
  process.env.EMAILJS_PUBLIC_KEY = 'public-test-key'
  process.env.EMAILJS_PRIVATE_KEY = privateKey
  global.fetch = async () => ({
    ok: false,
    status: 403,
    text: async () => `Unauthorized ${privateKey} ${email} ${otp}`,
  })

  try {
    await assert.rejects(
      sendPasswordResetEmail(email, 'Test User', otp),
      (error) => {
        assert.match(error.message, /HTTP 403/)
        assert.match(error.message, /Unauthorized/)
        assert.doesNotMatch(error.message, new RegExp(privateKey))
        assert.doesNotMatch(error.message, new RegExp(email))
        assert.doesNotMatch(error.message, new RegExp(otp))
        return true
      },
    )
  } finally {
    global.fetch = originalFetch
    for (const [key, value] of Object.entries(environment)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
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

  const exportResponse = await fetch(`${baseUrl}/api/export`)
  assert.equal(exportResponse.status, 401)

  const importResponse = await fetch(`${baseUrl}/api/import`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  })
  assert.equal(importResponse.status, 401)

  const unknownApiResponse = await fetch(`${baseUrl}/api/no-such-route`)
  assert.equal(unknownApiResponse.status, 404)
  assert.deepEqual(await unknownApiResponse.json(), { message: 'API route not found.' })
})

test('user login issues an HTTP-only cookie without returning its token', async () => {
  const user = {
    id: 'security-test-user',
    name: 'Security Test',
    email: 'security-test@example.com',
    password: await bcrypt.hash('Correct Horse Battery12!', 10),
    passwordResetToken: 'hashed-one-time-reset-token',
    passwordResetExpires: new Date(Date.now() + 60_000).toISOString(),
    authVersion: 0,
    role: 'user',
    status: 'active',
    theme: 'light',
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
    assert.equal(loginBody.user.password, undefined)
    assert.equal(loginBody.user.passwordResetToken, undefined)
    assert.equal(loginBody.user.passwordResetExpires, undefined)
    assert.equal(loginBody.user.authVersion, undefined)
    assert.equal(loginResponse.headers.get('cache-control'), 'no-store')
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

test('user login returns the same credential error for unknown users and wrong passwords', async () => {
  const user = {
    id: 'security-login-error-user',
    name: 'Login Error Test',
    email: 'login-error@example.com',
    password: await bcrypt.hash('Correct Horse Battery12!', 10),
    role: 'user',
    status: 'active',
    authVersion: 0,
  }
  const suspendedUser = {
    ...user,
    id: 'security-login-suspended-user',
    email: 'login-suspended@example.com',
    status: 'suspended',
  }
  users.push(user, suspendedUser)

  try {
    const responses = await Promise.all([
      fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: user.email, password: 'Wrong Password 123!' }),
      }),
      fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'missing-login@example.com', password: 'Wrong Password 123!' }),
      }),
      fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: suspendedUser.email, password: 'Correct Horse Battery12!' }),
      }),
    ])

    assert.deepEqual(responses.map((response) => response.status), [401, 401, 401])
    assert.deepEqual(await Promise.all(responses.map((response) => response.json())), [
      { message: 'Invalid email or password.' },
      { message: 'Invalid email or password.' },
      { message: 'Invalid email or password.' },
    ])

    const oversizedPasswordResponse = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: user.email, password: 'x'.repeat(73) }),
    })
    assert.equal(oversizedPasswordResponse.status, 400)
  } finally {
    users.splice(users.indexOf(user), 1)
    users.splice(users.indexOf(suspendedUser), 1)
  }
})

test('admin login does not reveal existing non-admin or inactive accounts', async () => {
  const regularUser = {
    id: 'security-admin-login-user',
    name: 'Regular Account',
    email: 'admin-login-user@example.com',
    password: await bcrypt.hash('Correct Horse Battery12!', 10),
    role: 'user',
    status: 'active',
    authVersion: 0,
  }
  const suspendedUser = {
    ...regularUser,
    id: 'security-admin-login-suspended-user',
    email: 'admin-login-suspended@example.com',
    status: 'suspended',
  }
  const previousBootstrapEmail = process.env.ADMIN_EMAIL
  const previousBootstrapSecret = process.env.ADMIN_BOOTSTRAP_SECRET
  delete process.env.ADMIN_EMAIL
  delete process.env.ADMIN_BOOTSTRAP_SECRET
  users.push(regularUser, suspendedUser)

  try {
    const responses = await Promise.all([
      fetch(`${baseUrl}/api/admin/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: regularUser.email, password: 'Correct Horse Battery12!' }),
      }),
      fetch(`${baseUrl}/api/admin/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: suspendedUser.email, password: 'Correct Horse Battery12!' }),
      }),
      fetch(`${baseUrl}/api/admin/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'missing-admin@example.com', password: 'Wrong Password 123!' }),
      }),
    ])
    assert.deepEqual(responses.map((response) => response.status), [401, 401, 401])
    assert.deepEqual(await Promise.all(responses.map((response) => response.json())), [
      { message: 'Invalid email or password.' },
      { message: 'Invalid email or password.' },
      { message: 'Invalid email or password.' },
    ])
    assert.equal(regularUser.role, 'user')
  } finally {
    users.splice(users.indexOf(regularUser), 1)
    users.splice(users.indexOf(suspendedUser), 1)
    if (previousBootstrapEmail === undefined) delete process.env.ADMIN_EMAIL
    else process.env.ADMIN_EMAIL = previousBootstrapEmail
    if (previousBootstrapSecret === undefined) delete process.env.ADMIN_BOOTSTRAP_SECRET
    else process.env.ADMIN_BOOTSTRAP_SECRET = previousBootstrapSecret
  }
})

test('prompt create and update reject malformed or oversized fields', async () => {
  const owner = {
    id: 'security-prompt-validation-user',
    name: 'Prompt Validation',
    email: 'prompt-validation@example.com',
    role: 'user',
    status: 'active',
    authVersion: 0,
  }
  const prompt = {
    id: 'security-prompt-validation-existing',
    userId: owner.id,
    title: 'Valid title',
    description: '',
    content: 'Valid prompt',
    category: 'Writing',
    tags: [],
    favorite: false,
    archived: false,
    isPublic: false,
    versionHistory: [],
  }
  const originalFsMethods = {
    mkdirSync: fs.mkdirSync,
    writeFileSync: fs.writeFileSync,
    renameSync: fs.renameSync,
  }
  const activitySnapshot = [...activities]
  users.push(owner)
  prompts.push(prompt)
  fs.mkdirSync = () => {}
  fs.writeFileSync = () => {}
  fs.renameSync = () => {}
  let createdPromptId
  const cookie = `${userCookieName}=${signToken(owner.id, 0)}`
  const send = (route, method, body) =>
    fetch(`${baseUrl}${route}`, {
      method,
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

  try {
    const malformedTitleResponse = await send('/api/prompts', 'POST', {
      title: { value: 'Not text' },
      content: 'Valid prompt',
      category: 'Writing',
    })
    assert.equal(malformedTitleResponse.status, 400)

    const longTitleResponse = await send('/api/prompts', 'POST', {
      title: 'x'.repeat(161),
      content: 'Valid prompt',
      category: 'Writing',
    })
    assert.equal(longTitleResponse.status, 400)

    const tooManyTagsResponse = await send('/api/prompts', 'POST', {
      title: 'Valid title',
      content: 'Valid prompt',
      category: 'Writing',
      tags: Array.from({ length: 21 }, (_, index) => `tag-${index}`),
    })
    assert.equal(tooManyTagsResponse.status, 400)

    const validCreateResponse = await send('/api/prompts', 'POST', {
      title: 'Created title',
      description: 'A valid prompt description',
      content: 'A valid prompt',
      category: 'Writing',
      tags: ['writing', 'assistant'],
    })
    assert.equal(validCreateResponse.status, 201)
    const createdPrompt = (await validCreateResponse.json()).prompt
    createdPromptId = createdPrompt.id
    assert.equal(createdPrompt.title, 'Created title')
    assert.deepEqual(createdPrompt.tags, ['writing', 'assistant'])

    const badUpdateResponse = await send(`/api/prompts/${prompt.id}`, 'PUT', {
      content: 5,
    })
    assert.equal(badUpdateResponse.status, 400)

    const longContentResponse = await send(`/api/prompts/${prompt.id}`, 'PUT', {
      content: 'x'.repeat(50001),
    })
    assert.equal(longContentResponse.status, 400)

    const goodUpdateResponse = await send(`/api/prompts/${prompt.id}`, 'PUT', {
      title: 'Updated title',
    })
    assert.equal(goodUpdateResponse.status, 200)
    assert.equal(prompt.title, 'Updated title')

    const invalidSchemaPrompt = new Prompt({
      userId: owner.id,
      title: 'Schema validation',
      content: 'Valid prompt',
      category: 'Writing',
      tags: Array.from({ length: 21 }, (_, index) => `tag-${index}`),
    })
    await assert.rejects(invalidSchemaPrompt.validate(), /No more than 20 tags/)
  } finally {
    fs.mkdirSync = originalFsMethods.mkdirSync
    fs.writeFileSync = originalFsMethods.writeFileSync
    fs.renameSync = originalFsMethods.renameSync
    for (const [list, items] of [
      [users, [owner]],
      [prompts, [prompt, ...prompts.filter((item) => item.id === createdPromptId)]],
    ]) {
      for (const item of items) {
        const index = list.indexOf(item)
        if (index >= 0) list.splice(index, 1)
      }
    }
    activities.splice(0, activities.length, ...activitySnapshot)
  }
})

test('password reset OTPs are emailed, hashed, expire, and can only be consumed once', async () => {
  const user = {
    id: 'security-reset-token-user',
    name: 'Reset Token Test',
    email: `security-reset-otp-${Date.now()}@example.test`,
    password: await bcrypt.hash('Original Password 123!', 10),
    authVersion: 0,
    role: 'user',
    status: 'active',
  }
  const previousEnvironment = {
    emailJsServiceId: process.env.EMAILJS_SERVICE_ID,
    emailJsTemplateId: process.env.EMAILJS_TEMPLATE_ID,
    emailJsPublicKey: process.env.EMAILJS_PUBLIC_KEY,
    emailJsPrivateKey: process.env.EMAILJS_PRIVATE_KEY,
  }
  const previousReadyState = mongoose.connection.readyState
  const originalFetch = global.fetch
  const originalFsMethods = {
    mkdirSync: fs.mkdirSync,
    writeFileSync: fs.writeFileSync,
    renameSync: fs.renameSync,
  }
  let emailPayload
  users.push(user)
  process.env.EMAILJS_SERVICE_ID = 'test-emailjs-service'
  process.env.EMAILJS_TEMPLATE_ID = 'test-emailjs-template'
  process.env.EMAILJS_PUBLIC_KEY = 'test-emailjs-public-key'
  process.env.EMAILJS_PRIVATE_KEY = 'test-emailjs-private-key'
  mongoose.connection.readyState = 0
  fs.mkdirSync = () => {}
  fs.writeFileSync = () => {}
  fs.renameSync = () => {}
  global.fetch = async (url, options) => {
    assert.equal(url, 'https://api.emailjs.com/api/v1.0/email/send')
    emailPayload = JSON.parse(options.body)
    return { ok: true }
  }

  try {
    const requestResponse = await originalFetch(`${baseUrl}/api/auth/forgot-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: user.email }),
    })
    assert.equal(requestResponse.status, 200)
    assert.equal(emailPayload.service_id, 'test-emailjs-service')
    assert.equal(emailPayload.template_id, 'test-emailjs-template')
    assert.equal(emailPayload.user_id, 'test-emailjs-public-key')
    assert.equal(emailPayload.accessToken, 'test-emailjs-private-key')
    assert.equal(emailPayload.template_params.to_email, user.email)
    assert.equal(emailPayload.template_params.validity, '15 minutes')
    const otp = emailPayload.template_params.otp
    assert.match(otp, /^\d{6}$/)
    assert.match(user.passwordResetOtpHash, /^[a-f0-9]{64}$/)
    assert.notEqual(user.passwordResetOtpHash, otp)
    assert.ok(new Date(user.passwordResetExpires).getTime() - Date.now() <= 15 * 60 * 1000)

    const requests = ['First New Password 123!', 'Second New Password 123!'].map((newPassword) =>
      originalFetch(`${baseUrl}/api/auth/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: user.email, otp, newPassword }),
      }),
    )
    const responses = await Promise.all(requests)
    assert.deepEqual(responses.map((response) => response.status).sort(), [200, 400])
    assert.equal(user.authVersion, 1)
    assert.equal(user.passwordResetOtpHash, undefined)
    assert.equal(user.passwordResetOtpAttempts, 0)
    assert.equal(user.passwordResetExpires, undefined)

    const replayResponse = await originalFetch(`${baseUrl}/api/auth/reset-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: user.email, otp, newPassword: 'Third New Password 123!' }),
    })
    assert.equal(replayResponse.status, 400)
  } finally {
    global.fetch = originalFetch
    fs.mkdirSync = originalFsMethods.mkdirSync
    fs.writeFileSync = originalFsMethods.writeFileSync
    fs.renameSync = originalFsMethods.renameSync
    mongoose.connection.readyState = previousReadyState
    for (const [key, value] of [
      ['EMAILJS_SERVICE_ID', previousEnvironment.emailJsServiceId],
      ['EMAILJS_TEMPLATE_ID', previousEnvironment.emailJsTemplateId],
      ['EMAILJS_PUBLIC_KEY', previousEnvironment.emailJsPublicKey],
      ['EMAILJS_PRIVATE_KEY', previousEnvironment.emailJsPrivateKey],
    ]) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    const index = users.indexOf(user)
    if (index >= 0) users.splice(index, 1)
  }
})

test('password reset requests persist hashed OTPs through MongoDB model updates', async () => {
  const user = {
    _id: 'security-mongo-reset-user',
    name: 'Mongo Reset Test',
    email: 'mongo-reset@example.com',
  }
  const previousEnvironment = {
    mongoUri: process.env.MONGODB_URI,
    emailJsServiceId: process.env.EMAILJS_SERVICE_ID,
    emailJsTemplateId: process.env.EMAILJS_TEMPLATE_ID,
    emailJsPublicKey: process.env.EMAILJS_PUBLIC_KEY,
    emailJsPrivateKey: process.env.EMAILJS_PRIVATE_KEY,
  }
  const previousReadyState = mongoose.connection.readyState
  const originalFindOne = User.findOne
  const originalUpdateOne = User.updateOne
  const originalFindOneAndUpdate = User.findOneAndUpdate
  const originalFetch = global.fetch
  let emailPayload
  let storedOtpHash
  const updates = []

  process.env.MONGODB_URI = 'mongodb://unit-test.invalid/promptvault'
  process.env.EMAILJS_SERVICE_ID = 'test-emailjs-service'
  process.env.EMAILJS_TEMPLATE_ID = 'test-emailjs-template'
  process.env.EMAILJS_PUBLIC_KEY = 'test-emailjs-public-key'
  process.env.EMAILJS_PRIVATE_KEY = 'test-emailjs-private-key'
  mongoose.connection.readyState = 1
  User.findOne = () => ({
    select: () => ({ lean: async () => ({ ...user, passwordResetOtpHash: storedOtpHash }) }),
    lean: async () => ({ ...user }),
  })
  User.updateOne = async (filter, update) => {
    updates.push({ filter, update })
    storedOtpHash = update.$set.passwordResetOtpHash
    return { matchedCount: 1 }
  }
  let consumeFilter
  let consumeUpdate
  User.findOneAndUpdate = (filter, update) => {
    consumeFilter = filter
    consumeUpdate = update
    return { lean: async () => ({ _id: user._id }) }
  }
  global.fetch = async (url, options) => {
    assert.equal(url, 'https://api.emailjs.com/api/v1.0/email/send')
    emailPayload = JSON.parse(options.body)
    return { ok: true }
  }

  try {
    const response = await originalFetch(`${baseUrl}/api/auth/forgot-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: user.email }),
    })
    assert.equal(response.status, 200)
    assert.equal(updates.length, 1)
    assert.deepEqual(updates[0].filter, { _id: user._id })
    const storedHash = updates[0].update.$set.passwordResetOtpHash
    assert.match(storedHash, /^[a-f0-9]{64}$/)
    assert.equal(updates[0].update.$set.passwordResetOtpAttempts, 0)
    assert.ok(updates[0].update.$set.passwordResetExpires instanceof Date)
    const otp = emailPayload.template_params.otp
    assert.notEqual(storedHash, otp)

    const resetResponse = await originalFetch(`${baseUrl}/api/auth/reset-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: user.email,
        otp,
        newPassword: 'Mongo Reset Password 123!',
      }),
    })
    assert.equal(resetResponse.status, 200)
    assert.equal(consumeFilter._id, user._id)
    assert.equal(consumeFilter.passwordResetOtpHash, storedHash)
    assert.equal(consumeFilter.passwordResetOtpAttempts.$lt, 5)
    assert.equal(consumeUpdate.$unset.passwordResetOtpHash, 1)
    assert.equal(consumeUpdate.$unset.passwordResetExpires, 1)
    assert.equal(consumeUpdate.$inc.authVersion, 1)
  } finally {
    User.findOne = originalFindOne
    User.updateOne = originalUpdateOne
    User.findOneAndUpdate = originalFindOneAndUpdate
    global.fetch = originalFetch
    mongoose.connection.readyState = previousReadyState
    for (const [key, value] of [
      ['MONGODB_URI', previousEnvironment.mongoUri],
      ['EMAILJS_SERVICE_ID', previousEnvironment.emailJsServiceId],
      ['EMAILJS_TEMPLATE_ID', previousEnvironment.emailJsTemplateId],
      ['EMAILJS_PUBLIC_KEY', previousEnvironment.emailJsPublicKey],
      ['EMAILJS_PRIVATE_KEY', previousEnvironment.emailJsPrivateKey],
    ]) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
})

test('password reset OTP rejects codes after five incorrect attempts', async () => {
  const user = {
    id: `security-reset-attempts-${Date.now()}`,
    name: 'Reset Attempt Test',
    email: `security-reset-attempts-${Date.now()}@example.test`,
    password: await bcrypt.hash('Original Password 123!', 10),
    passwordResetOtpHash: 'unused',
    passwordResetOtpAttempts: 0,
    passwordResetExpires: new Date(Date.now() + 60_000).toISOString(),
    authVersion: 0,
    role: 'user',
    status: 'active',
  }
  const previousReadyState = mongoose.connection.readyState
  const originalFsMethods = {
    mkdirSync: fs.mkdirSync,
    writeFileSync: fs.writeFileSync,
    renameSync: fs.renameSync,
  }
  users.push(user)
  mongoose.connection.readyState = 0
  fs.mkdirSync = () => {}
  fs.writeFileSync = () => {}
  fs.renameSync = () => {}

  try {
    const attempts = await Promise.all(
      Array.from({ length: 5 }, () =>
        fetch(`${baseUrl}/api/auth/reset-password`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: user.email,
            otp: '000000',
            newPassword: 'New Password Secure 123!',
          }),
        }),
      ),
    )
    assert.ok(attempts.every((response) => response.status === 400))
    assert.equal(user.passwordResetOtpAttempts, 5)

    const correctCodeResponse = await fetch(`${baseUrl}/api/auth/reset-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: user.email,
        otp: '123456',
        newPassword: 'New Password Secure 123!',
      }),
    })
    assert.equal(correctCodeResponse.status, 400)
    assert.equal(user.authVersion, 0)
  } finally {
    fs.mkdirSync = originalFsMethods.mkdirSync
    fs.writeFileSync = originalFsMethods.writeFileSync
    fs.renameSync = originalFsMethods.renameSync
    mongoose.connection.readyState = previousReadyState
    const index = users.indexOf(user)
    if (index >= 0) users.splice(index, 1)
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
