// The same request through each library, recorded by a fetch stub. What comes back is what a
// user would see; no claim here is inferred from documentation.

import air from '@imlargo/air'
import ky from 'ky'
import { ofetch } from 'ofetch'
import axios from 'axios'
import { LIBS, json, table } from './lib.mjs'

const BASE = 'https://bench.test/v1'

let last
function stub(respond) {
  globalThis.fetch = async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init)
    last = {
      url: request.url,
      headers: Object.fromEntries(request.headers),
      body: request.body ? await request.text() : null,
    }
    return respond()
  }
}

const show = (value) => {
  if (value instanceof ReadableStream) return '`ReadableStream`'
  if (value instanceof Blob) return '`Blob`'
  if (typeof value === 'string') return value === '' ? '`""`' : `\`${value}\``
  return `\`${JSON.stringify(value) ?? String(value)}\``
}

async function attempt(run) {
  const timeout = new Promise((resolve) =>
    setTimeout(() => resolve('hangs (>300 ms)'), 300),
  )
  try {
    const value = await Promise.race([run(), timeout])
    return typeof value === 'string' && value.startsWith('hangs') ? value : show(value)
  } catch (error) {
    const status = error.status ?? error.response?.status
    const data = error.data ?? error.response?.data
    return `throws \`${error.name}\`${status ? ` ${status}` : ''}${data !== undefined ? `, data ${show(data)}` : ''}`
  }
}

const clients = {
  '@imlargo/air': {
    get: (path, o = {}) =>
      air.create({ baseURL: BASE, ...o.client }).get(path, o.request),
    post: (path, body) => air.create({ baseURL: BASE }).post(path, { body }),
    query: 'query',
  },
  ky: {
    get: (path, o = {}) =>
      ky
        .create({ prefix: BASE, ...o.client })
        .get(path.replace(/^\//, ''), o.request)
        .json(),
    post: (path, body) =>
      ky
        .create({ prefix: BASE })
        .post(path.replace(/^\//, ''), {
          [body instanceof FormData ? 'body' : 'json']: body,
        })
        .json(),
    query: 'searchParams',
  },
  ofetch: {
    get: (path, o = {}) => ofetch.create({ baseURL: BASE, ...o.client })(path, o.request),
    post: (path, body) =>
      ofetch.create({ baseURL: BASE })(path, { method: 'POST', body }),
    query: 'query',
  },
  axios: {
    get: (path, o = {}) =>
      axios
        .create({ baseURL: BASE, adapter: 'fetch', ...o.client })
        .get(path, o.request)
        .then((r) => r.data),
    post: (path, body) =>
      axios
        .create({ baseURL: BASE, adapter: 'fetch' })
        .post(path, body)
        .then((r) => r.data),
    query: 'params',
  },
}

const cases = [
  [
    '`204 No Content`',
    (c) => {
      stub(() => new Response(null, { status: 204 }))
      return c.get('/x')
    },
  ],
  [
    '`200`, empty body, JSON content type',
    (c) => {
      stub(() => new Response('', { headers: { 'content-type': 'application/json' } }))
      return c.get('/x')
    },
  ],
  [
    '`404` with a JSON body',
    (c) => {
      stub(() => json({ error: 'nope' }, { status: 404 }))
      return c.get('/x')
    },
  ],
  [
    '`text/event-stream` that never closes',
    (c) => {
      stub(
        () =>
          new Response(
            new ReadableStream({
              start(ctrl) {
                ctrl.enqueue(new TextEncoder().encode('data: hi\n\n'))
              },
            }),
            { headers: { 'content-type': 'text/event-stream' } },
          ),
      )
      return c.get('/events')
    },
  ],
  [
    'Query `{ tags: [a, b], n: null, u: undefined }`',
    async (c) => {
      stub(() => json({}))
      await c.get('/s', {
        request: { [c.query]: { tags: ['a', 'b'], n: null, u: undefined } },
      })
      return decodeURIComponent(last.url.split('?')[1] ?? '')
    },
  ],
  [
    'Query `{ when: Date, nested: { a: 1 } }`',
    async (c) => {
      stub(() => json({}))
      await c.get('/s', {
        request: { [c.query]: { when: new Date(0), nested: { a: 1 } } },
      })
      return decodeURIComponent(last.url.split('?')[1] ?? '').replace(
        /Wed.*Time\)/,
        '<Date.toString()>',
      )
    },
  ],
  [
    '`FormData` body, content type sent',
    async (c) => {
      stub(() => json({}))
      const form = new FormData()
      form.set('a', '1')
      await c.post('/u', form)
      return (last.headers['content-type'] ?? 'none').replace(/boundary=.*/, 'boundary=…')
    },
  ],
  [
    'Remove a client header with `null`',
    async (c) => {
      stub(() => json({}))
      await c.get('/x', {
        client: { headers: { Authorization: 'Bearer t' } },
        request: { headers: { Authorization: null } },
      })
      return last.headers.authorization === undefined
        ? 'absent'
        : `sent ${JSON.stringify(last.headers.authorization)}`
    },
  ],
  [
    'Header from a function, per request',
    async (c) => {
      stub(() => json({}))
      let n = 0
      const client = { headers: () => ({ 'X-N': String(++n) }) }
      await c.get('/x', { client })
      await c.get('/x', { client })
      return last.headers['x-n'] === '2' ? 'supported' : 'not supported'
    },
  ],
]

export async function behavior() {
  const original = globalThis.fetch
  try {
    const rows = []
    for (const [label, run] of cases) {
      const cells = []
      for (const name of LIBS) cells.push(await attempt(() => run(clients[name])))
      rows.push([label, ...cells.map((c) => c.replace(/\|/g, '\\|'))])
    }
    return table(['Case', ...LIBS.map((l) => `\`${l}\``)], rows)
  } finally {
    globalThis.fetch = original
  }
}
