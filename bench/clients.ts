// One client per library, configured as alike as their APIs allow. `matched` turns off what
// only some libraries do by default (ky's retry and timeout, ofetch's retry), so a second table
// compares the same work; `defaults` is what a user gets out of the box.

import air from '@imlargo/air'
import ky from 'ky'
import { ofetch } from 'ofetch'
import axios from 'axios'

export type Config = 'defaults' | 'matched'
export type Transport = 'stub' | 'server'
export type ClientFn = () => Promise<unknown>

export function clients(options: {
  origin: string
  path: string
  config: Config
  transport: Transport
}): Record<string, ClientFn> {
  const { origin, path, config, transport } = options
  const matched = config === 'matched'
  const headers = { 'X-Client': 'bench' }
  const map: Record<string, ClientFn> = {
    'fetch + response.json()': async () =>
      (await fetch(`${origin}${path}`)).json() as unknown,
    '@imlargo/air': (() => {
      const c = air.create({ baseURL: origin, headers })
      return () => c.get(path)
    })(),
    ky: (() => {
      const c = ky.create({
        prefix: origin,
        headers,
        ...(matched ? { retry: 0, timeout: false as const } : {}),
      })
      return () => c.get(path.replace(/^\//, '')).json()
    })(),
    ofetch: (() => {
      const c = ofetch.create({
        baseURL: origin,
        headers,
        ...(matched ? { retry: 0 } : {}),
      })
      return () => c(path)
    })(),
    'axios (fetch adapter)': (() => {
      const c = axios.create({ baseURL: origin, headers, adapter: 'fetch' })
      return () => c.get(path)
    })(),
  }
  if (transport === 'server') {
    map['axios (http adapter)'] = (() => {
      const c = axios.create({ baseURL: origin, headers })
      return () => c.get(path)
    })()
  }
  return map
}

export const clientNames = (transport: Transport): string[] =>
  Object.keys(clients({ origin: 'https://x', path: '/', config: 'defaults', transport }))
