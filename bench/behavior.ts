// The same request through each library, recorded by a fetch stub. What comes back is what a
// user would see; no claim here is inferred from documentation.

import air, { type AirOptions } from '@imlargo/air'
import ky, { type Options as KyOptions } from 'ky'
import { ofetch, type FetchOptions } from 'ofetch'
import axios, { type AxiosRequestConfig, type CreateAxiosDefaults } from 'axios'
import { LIBS, json, table, type Lib } from './lib.ts'

const BASE = 'https://bench.test/v1'

interface Seen {
  url: string
  headers: Record<string, string>
  body: string | null
}
let last: Seen | undefined
const seen = (): Seen => {
  if (!last) throw new Error('no request was recorded')
  return last
}

function stub(respond: () => Response) {
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

const show = (value: unknown): string => {
  if (value instanceof ReadableStream) return '`ReadableStream`'
  if (value instanceof Blob) return '`Blob`'
  if (typeof value === 'string') return value === '' ? '`""`' : `\`${value}\``
  return `\`${value === undefined ? 'undefined' : JSON.stringify(value)}\``
}

interface Thrown {
  name?: string
  status?: number
  data?: unknown
  response?: { status?: number; data?: unknown }
}

async function attempt(run: () => Promise<unknown>): Promise<string> {
  const timeout = new Promise<string>((resolve) =>
    setTimeout(() => {
      resolve('hangs (>300 ms)')
    }, 300),
  )
  try {
    const value = await Promise.race([run(), timeout])
    return value === 'hangs (>300 ms)' ? value : show(value)
  } catch (error) {
    const e = error as Thrown
    const status = e.status ?? e.response?.status
    const data = e.data ?? e.response?.data
    return `throws \`${e.name ?? 'Error'}\`${status ? ` ${status}` : ''}${data !== undefined ? `, data ${show(data)}` : ''}`
  }
}

interface Extra {
  client?: Record<string, unknown>
  request?: Record<string, unknown>
}
interface Probe {
  get: (path: string, o?: Extra) => Promise<unknown>
  post: (path: string, body: unknown) => Promise<unknown>
  query: string
}

const probes: Record<Lib, Probe> = {
  '@imlargo/air': {
    get: (path, o = {}) =>
      air
        .create({ baseURL: BASE, ...(o.client as AirOptions) })
        .get(path, o.request as AirOptions),
    post: (path, body) => air.create({ baseURL: BASE }).post(path, { body }),
    query: 'query',
  },
  ky: {
    get: (path, o = {}) =>
      ky
        .create({ prefix: BASE, ...(o.client as KyOptions) })
        .get(path.replace(/^\//, ''), o.request as KyOptions)
        .json(),
    post: (path, body) =>
      ky
        .create({ prefix: BASE })
        .post(
          path.replace(/^\//, ''),
          body instanceof FormData ? { body } : { json: body },
        )
        .json(),
    query: 'searchParams',
  },
  ofetch: {
    get: (path, o = {}) =>
      ofetch.create({ baseURL: BASE, ...(o.client as FetchOptions) })(
        path,
        o.request as FetchOptions,
      ),
    post: (path, body) =>
      ofetch.create({ baseURL: BASE })(path, {
        method: 'POST',
        body: body as FetchOptions['body'],
      }),
    query: 'query',
  },
  axios: {
    get: (path, o = {}) =>
      axios
        .create({ baseURL: BASE, adapter: 'fetch', ...(o.client as CreateAxiosDefaults) })
        .get(path, o.request as AxiosRequestConfig)
        .then((r) => r.data as unknown),
    post: (path, body) =>
      axios
        .create({ baseURL: BASE, adapter: 'fetch' })
        .post(path, body)
        .then((r) => r.data as unknown),
    query: 'params',
  },
}

const sse = () =>
  new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: hi\n\n'))
      },
    }),
    { headers: { 'content-type': 'text/event-stream' } },
  )

const search = () => decodeURIComponent(seen().url.split('?')[1] ?? '')

const cases: [string, (probe: Probe) => Promise<unknown>][] = [
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
      stub(sse)
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
      return search()
    },
  ],
  [
    'Query `{ when: Date, nested: { a: 1 } }`',
    async (c) => {
      stub(() => json({}))
      await c.get('/s', {
        request: { [c.query]: { when: new Date(0), nested: { a: 1 } } },
      })
      return search().replace(/Wed.*Time\)/, '<Date.toString()>')
    },
  ],
  [
    '`FormData` body, content type sent',
    async (c) => {
      stub(() => json({}))
      const form = new FormData()
      form.set('a', '1')
      await c.post('/u', form)
      return (seen().headers['content-type'] ?? 'none').replace(
        /boundary=.*/,
        'boundary=…',
      )
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
      const sent = seen().headers.authorization
      return sent === undefined ? 'absent' : `sent ${JSON.stringify(sent)}`
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
      return seen().headers['x-n'] === '2' ? 'supported' : 'not supported'
    },
  ],
]

export async function behavior(): Promise<string> {
  const original = globalThis.fetch
  try {
    const rows: string[][] = []
    for (const [label, run] of cases) {
      const cells: string[] = []
      for (const name of LIBS) cells.push(await attempt(() => run(probes[name])))
      rows.push([label, ...cells.map((c) => c.replace(/\|/g, '\\|'))])
    }
    return table(['Case', ...LIBS.map((l) => `\`${l}\``)], rows)
  } finally {
    globalThis.fetch = original
  }
}
