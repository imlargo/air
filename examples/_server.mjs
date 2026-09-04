// A throwaway HTTP server, shared by every example so each one runs on its own with real
// `fetch` and no third party involved. It is not part of any recipe — in each file the
// recipe is everything below the `serve()` call, and that part is what you copy.
//
// This is also why the examples double as the integration lane: they exercise the built
// `dist/` against a real socket, which is where every bug this project has shipped was
// hiding. The vitest suite in `test/` mocks `fetch`, and a mock agrees with whatever you assume.

import http from 'node:http'

export async function serve(handler) {
  const server = http.createServer(handler)
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))

  return {
    url: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  }
}

// Reads a request body to a string. Node's `req` is a stream and every example that
// inspects an upload needs this, so it lives here rather than four times over.
export async function readBody(req) {
  let body = ''
  for await (const chunk of req) body += chunk
  return body
}

export function json(res, data, status = 200) {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(data))
}
