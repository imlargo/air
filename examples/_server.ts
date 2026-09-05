// Shared test server for the examples. Not a recipe: in each example, the recipe is everything
// below the `serve()` call.

import http from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'

export type Handler = (req: IncomingMessage, res: ServerResponse) => void | Promise<void>

export async function serve(handler: Handler) {
  const server = http.createServer((req, res) => {
    // http ignores the return value. A rejected handler becomes an unhandled rejection, which
    // is how an example fails: on its own assertion, with a non-zero exit.
    const outcome = handler(req, res)
    if (outcome) {
      outcome.catch((error: unknown) => {
        throw error
      })
    }
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string')
    throw new Error('server has no TCP address')

  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error)
          else resolve()
        })
      }),
  }
}

export async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of req as AsyncIterable<Buffer>) chunks.push(chunk)
  return Buffer.concat(chunks).toString()
}

export function json(res: ServerResponse, data: unknown, status = 200): void {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(data))
}
