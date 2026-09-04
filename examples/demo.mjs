// Manual check against real third-party endpoints. Not run by `pnpm examples`.
//
// Run: pnpm demo

import air, { isAirError } from '../dist/index.mjs'
import { retry } from '../dist/retry.mjs'

async function section(title, fn) {
  console.log(`\n--- ${title} ---`)
  try {
    await fn()
  } catch (error) {
    console.log('unexpected throw:', error)
  }
}

await section('GET, auto-parsed as JSON', async () => {
  const todo = await air.get('https://jsonplaceholder.typicode.com/todos/1')
  console.log(todo)
})

await section('a URL instance works as the request target too', async () => {
  const target = new URL('/todos/2', 'https://jsonplaceholder.typicode.com')
  const todo = await air.get(target)
  console.log(todo)
})

await section('query serialization', async () => {
  const posts = await air.get('https://jsonplaceholder.typicode.com/posts', {
    query: { userId: 1, _limit: 2 },
  })
  console.log(
    `${posts.length} post(s):`,
    posts.map((p) => p.title),
  )
})

await section('a client with baseURL + default headers', async () => {
  const api = air.create({
    baseURL: 'https://jsonplaceholder.typicode.com',
    headers: { 'X-Demo': 'air' },
  })
  const user = await api.get('/users/1')
  console.log(user.name, '<' + user.email + '>')
})

await section('a header function survives a token rotation', async () => {
  let token = 'first-token'
  const api = air.create({
    baseURL: 'https://httpbin.org',
    headers: () => ({ Authorization: `Bearer ${token}` }),
  })

  const before = await api.get('/headers')
  token = 'rotated-token' // e.g. a refresh happened somewhere else in the app
  const after = await api.get('/headers')

  console.log('before rotation:', before.headers.Authorization)
  console.log('after rotation:', after.headers.Authorization)
})

await section('POST with a JSON body (auto content-type)', async () => {
  const echoed = await air.post('https://httpbin.org/post', {
    body: { name: 'Ada', role: 'engineer' },
  })
  console.log('server saw json:', echoed.json)
  console.log('server saw content-type:', echoed.headers['Content-Type'])
})

await section('POST with FormData (runtime sets the multipart boundary)', async () => {
  const form = new FormData()
  form.set('name', 'Ada')
  form.set('role', 'engineer')

  const echoed = await air.post('https://httpbin.org/post', { body: form })
  console.log('server saw form:', echoed.form)
  console.log('server saw content-type:', echoed.headers['Content-Type'])
})

await section('non-2xx throws an AirError', async () => {
  try {
    await air.get('https://httpbin.org/status/404')
  } catch (error) {
    if (isAirError(error)) {
      console.log('status:', error.status, '| message:', error.message)
    } else {
      throw error
    }
  }
})

await section('air.raw: the body and the response on a successful call', async () => {
  const { data, response } = await air.raw.get(
    'https://httpbin.org/response-headers?x-demo=air',
  )
  console.log('x-demo header:', response.headers.get('x-demo'), '| body:', data)
})

await section('204 / empty body resolves to null', async () => {
  const result = await air.get('https://httpbin.org/status/204')
  console.log('result:', result)
})

await section('timeout via native AbortSignal, no timeout option needed', async () => {
  try {
    await air.get('https://httpbin.org/delay/3', { signal: AbortSignal.timeout(500) })
  } catch (error) {
    console.log(isAirError(error) ? error.message : error)
  }
})

await section('retry via the retry utility, applied to a client', async () => {
  const flaky = air.create({
    fetch: retry({ attempts: 3, delay: (attempt) => 200 * attempt }),
  })
  // httpbin picks one of the listed codes at random; a 200 from it has an empty body.
  const result = await flaky.get('https://httpbin.org/status/500,200,200')
  console.log('eventually resolved (empty body on success):', result)
})

console.log('\ndone.')
