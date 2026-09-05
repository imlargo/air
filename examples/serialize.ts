// Serializing what the options do not take by themselves.
//
// `query` accepts primitives only and `body` sends a plain object as JSON, on purpose. When the
// endpoint wants bracket-notation params or a multipart form, `toQueryParams` and `toFormData`
// state the convention and produce a value the options already accept.
//
// Run: node examples/serialize.ts

import { strict as assert } from 'node:assert'
import air from '@imlargo/air'
import { toFormData } from '@imlargo/air/form'
import { toQueryParams } from '@imlargo/air/query'
import { readBody, serve } from './_server.ts'

interface Echo {
  url: string
  contentType: string | null
  body: string
}

const server = await serve(async (req, res) => {
  const body = await readBody(req)
  res.writeHead(200, { 'content-type': 'application/json' })
  res.end(
    JSON.stringify({
      url: req.url ?? '',
      contentType: req.headers['content-type'] ?? null,
      body,
    } satisfies Echo),
  )
})

// --- the recipe -------------------------------------------------------------------------

const api = air.create({ baseURL: server.url })

const search = await api.get<Echo>('/search', {
  query: toQueryParams({
    filter: { since: new Date(0), tags: ['a', 'b'] },
    page: 2,
    draft: null,
  }),
})

const upload = await api.post<Echo>('/upload', {
  body: toFormData({
    title: 'Report',
    tags: ['q3', 'final'],
    file: new File(['%PDF'], 'q3.pdf'),
  }),
})

// --- what it proves ---------------------------------------------------------------------

assert.ok(search && upload)
assert.equal(
  decodeURIComponent(search.url),
  '/search?filter[since]=1970-01-01T00:00:00.000Z&filter[tags]=a&filter[tags]=b&page=2',
  'nested objects, dates and arrays serialized; null dropped',
)
assert.match(
  upload.contentType ?? '',
  /^multipart\/form-data; boundary=/,
  'the runtime set the boundary',
)
assert.ok(upload.body.includes('name="tags"'), 'repeated fields arrived')
assert.ok(upload.body.includes('filename="q3.pdf"'), 'the file kept its name')

console.log('serialize: ok, bracket params and a multipart form from plain records')
await server.close()
