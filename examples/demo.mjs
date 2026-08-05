// Manual playground — makes real network requests against httpbin.org and
// jsonplaceholder. Not part of `pnpm test` (that suite mocks fetch and never
// touches the network); this is for eyeballing the library end to end against
// its own built output.
//
// Run: pnpm build && node examples/demo.mjs

import air, { isAirError } from '../dist/index.mjs'

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
  console.log(user.name, '—', user.email)
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

await section('parse: "response" — headers on a successful call', async () => {
  const response = await air.get('https://httpbin.org/response-headers?x-demo=air', {
    parse: 'response',
  })
  console.log('x-demo header:', response.headers.get('x-demo'))
})

await section('204 / empty body resolves to null', async () => {
  const result = await air.get('https://httpbin.org/status/204')
  console.log('result:', result)
})

await section('timeout via native AbortSignal — no timeout option needed', async () => {
  try {
    await air.get('https://httpbin.org/delay/3', { signal: AbortSignal.timeout(500) })
  } catch (error) {
    console.log(isAirError(error) ? error.message : error)
  }
})

await section('retry via a plain loop — no retry option needed', async () => {
  const transient = (error) =>
    isAirError(error) && (error.status === undefined || error.status >= 500)

  async function withRetry(fn, attempts = 3) {
    for (let attempt = 1; ; attempt++) {
      try {
        return await fn()
      } catch (error) {
        if (attempt >= attempts || !transient(error)) throw error
        console.log(`  attempt ${attempt} failed, retrying...`)
        await new Promise((resolve) => setTimeout(resolve, 200 * attempt))
      }
    }
  }

  // httpbin picks randomly among the listed codes on each call, so this may
  // succeed on the first attempt or need a retry or two — either is fine.
  // A 200 from this endpoint has an empty body, hence the `null`.
  const result = await withRetry(() => air.get('https://httpbin.org/status/500,200,200'))
  console.log('eventually resolved (empty body on success):', result)
})

console.log('\ndone.')
