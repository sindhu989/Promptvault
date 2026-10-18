const assert = require('node:assert/strict')
const { after, before, test } = require('node:test')
const app = require('../backend/src/app')

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

test('API rate limit blocks excessive requests while keeping health checks available', async () => {
  let limitedResponse
  for (let request = 0; request < 301; request += 1) {
    const response = await fetch(`${baseUrl}/api/no-such-route`)
    if (response.status === 429) limitedResponse = response
  }
  assert.ok(limitedResponse)
  assert.deepEqual(await limitedResponse.json(), {
    message: 'Too many requests. Please try again later.',
  })

  const healthResponse = await fetch(`${baseUrl}/api/health`)
  assert.equal(healthResponse.status, 200)
})
