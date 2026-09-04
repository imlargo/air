// Shared test server for the examples. Not a recipe: in each example, the recipe is everything
// below the `serve()` call.

import http from 'node:http'

export async function serve(handler) {
  const server = http.createServer(handler)
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))

  return {
    url: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  }
}

export async function readBody(req) {
  let body = ''
  for await (const chunk of req) body += chunk
  return body
}

export function json(res, data, status = 200) {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(data))
}
