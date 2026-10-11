const assert = require('node:assert/strict')
const { spawn } = require('node:child_process')
const fs = require('node:fs')
const net = require('node:net')
const path = require('node:path')
const { setTimeout: delay } = require('node:timers/promises')
const { after, before, test } = require('node:test')
const { randomUUID } = require('node:crypto')

const backendDirectory = path.resolve(__dirname, '..')
const runtimeDirectory = path.join(
  backendDirectory,
  `.test-runtime-${process.pid}-${randomUUID()}`,
)
const serverOutput = []
let server
let baseUrl

async function findFreePort() {
  const listener = net.createServer()
  await new Promise((resolve, reject) => {
    listener.once('error', reject)
    listener.listen(0, '127.0.0.1', resolve)
  })
  const { port } = listener.address()
  await new Promise((resolve, reject) => {
    listener.close((error) => error ? reject(error) : resolve())
  })
  return port
}

async function request(method, route, body, token) {
  const headers = {}
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (token) headers.Authorization = `Bearer ${token}`

  const response = await fetch(`${baseUrl}${route}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const data = await response.json()
  return { response, data }
}

before(async () => {
  fs.mkdirSync(runtimeDirectory, { recursive: true })
  fs.cpSync(path.join(backendDirectory, 'src'), path.join(runtimeDirectory, 'src'), {
    recursive: true,
  })

  const port = await findFreePort()
  baseUrl = `http://127.0.0.1:${port}`
  server = spawn(process.execPath, ['src/server.js'], {
    cwd: runtimeDirectory,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      MONGODB_URI: '',
      JWT_SECRET: `isolated-test-secret-${randomUUID()}`,
      PORT: String(port),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  server.stdout.on('data', (chunk) => serverOutput.push(chunk.toString()))
  server.stderr.on('data', (chunk) => serverOutput.push(chunk.toString()))

  const deadline = Date.now() + 10000
  while (Date.now() < deadline) {
    if (server.exitCode !== null) {
      throw new Error(`Test API exited before starting:\n${serverOutput.join('')}`)
    }
    try {
      const response = await fetch(`${baseUrl}/api/health`)
      if (response.ok) return
    } catch {}
    await delay(100)
  }

  throw new Error(`Test API did not start:\n${serverOutput.join('')}`)
})

after(async () => {
  if (server && server.exitCode === null) {
    const stopped = new Promise((resolve) => server.once('exit', resolve))
    server.kill('SIGTERM')
    await Promise.race([stopped, delay(5000)])
    if (server.exitCode === null) server.kill()
  }
  fs.rmSync(runtimeDirectory, { recursive: true, force: true })
})

test('auth, profile, collection membership, and public sharing work with isolated storage', async () => {
  const health = await request('GET', '/api/health')
  assert.equal(health.response.status, 200)
  assert.equal(health.data.mode, 'local-file')

  const unique = randomUUID()
  const email = `promptvault-test-${unique}@example.test`
  const registered = await request('POST', '/api/auth/register', {
    name: 'Test User',
    email,
    password: 'test-password-123',
  })
  assert.equal(registered.response.status, 201)
  assert.equal(registered.data.user.email, email)
  assert.equal('password' in registered.data.user, false)
  const token = registered.data.token

  const duplicate = await request('POST', '/api/auth/register', {
    name: 'Test User',
    email,
    password: 'test-password-123',
  })
  assert.equal(duplicate.response.status, 409)

  const invalidLogin = await request('POST', '/api/auth/login', {
    email,
    password: 'incorrect-password',
  })
  assert.equal(invalidLogin.response.status, 401)

  const unauthenticatedProfile = await request('GET', '/api/auth/me')
  assert.equal(unauthenticatedProfile.response.status, 401)

  const profile = await request('PUT', '/api/auth/me', { name: 'Updated User' }, token)
  assert.equal(profile.response.status, 200)
  assert.equal(profile.data.user.name, 'Updated User')
  assert.equal('password' in profile.data.user, false)

  const blankProfile = await request('PUT', '/api/auth/me', { name: '  ' }, token)
  assert.equal(blankProfile.response.status, 400)

  const createdPrompt = await request('POST', '/api/prompts', {
    title: 'Share test prompt',
    description: 'A safe public test prompt.',
    content: 'Explain {{topic}} simply.',
    category: 'Testing',
    tags: ['test'],
  }, token)
  assert.equal(createdPrompt.response.status, 201)
  const prompt = createdPrompt.data.prompt

  const madePublic = await request(
    'PUT',
    `/api/prompts/${prompt.id}/sharing`,
    { isPublic: true },
    token,
  )
  assert.equal(madePublic.response.status, 200)
  const publicPrompt = await request(
    'GET',
    `/api/public/prompts/${madePublic.data.prompt.shareId}`,
  )
  assert.equal(publicPrompt.response.status, 200)
  assert.deepEqual(Object.keys(publicPrompt.data.prompt).sort(), [
    'category',
    'content',
    'description',
    'tags',
    'title',
  ])

  const createdCollection = await request('POST', '/api/collections', {
    name: 'Test collection',
    description: 'A safe public test collection.',
    isPublic: true,
  }, token)
  assert.equal(createdCollection.response.status, 201)
  const collection = createdCollection.data.collection

  const addedPrompt = await request(
    'POST',
    `/api/collections/${collection.id}/prompts/${prompt.id}`,
    {},
    token,
  )
  assert.equal(addedPrompt.response.status, 200)

  const publicCollection = await request(
    'GET',
    `/api/public/collections/${collection.shareId}`,
  )
  assert.equal(publicCollection.response.status, 200)
  assert.equal(publicCollection.data.prompts.length, 1)
  assert.equal(publicCollection.data.prompts[0].content, 'Explain {{topic}} simply.')
  assert.equal('userId' in publicCollection.data.collection, false)
  assert.equal('shareId' in publicCollection.data.collection, false)

  const secondUser = await request('POST', '/api/auth/register', {
    name: 'Other User',
    email: `promptvault-other-${unique}@example.test`,
    password: 'test-password-123',
  })
  assert.equal(secondUser.response.status, 201)

  const otherUserCollectionAccess = await request(
    'GET',
    `/api/collections/${collection.id}/prompts`,
    undefined,
    secondUser.data.token,
  )
  assert.equal(otherUserCollectionAccess.response.status, 404)
})
