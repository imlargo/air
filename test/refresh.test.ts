import { describe, expect, it, vi } from 'vitest'
import air, { isAirError } from '../src/index.js'
import type { Fetch } from '../src/index.js'
import { refresh } from '../src/refresh.js'
import { json, mockFetch } from './mock.js'

const U = 'https://api.test/a'

/** A transport that accepts one bearer token and answers 401 to any other. */
function guarded(accepted: () => string) {
  const calls: RequestInit[] = []
  const send = vi.fn(async (_url: string, init: RequestInit) => {
    calls.push(init)
    const token = new Headers(init.headers).get('authorization')
    return token === `Bearer ${accepted()}`
      ? json({ ok: true })
      : new Response(null, { status: 401 })
  })
  return { send, calls }
}

describe('refresh', () => {
  it('refreshes once and retries with the new headers', async () => {
    const { send, calls } = guarded(() => 'new')
    const renew = vi.fn(() => ({ Authorization: 'Bearer new' }))
    const api = air.create({
      headers: { Authorization: 'Bearer old' },
      fetch: refresh({ headers: renew, fetch: send }),
    })

    await expect(api.get(U)).resolves.toEqual({ ok: true })
    expect(renew).toHaveBeenCalledTimes(1)
    expect(calls).toHaveLength(2)
    expect(new Headers(calls[1]!.headers).get('authorization')).toBe('Bearer new')
  })

  it('shares one refresh across a burst of concurrent failures', async () => {
    const { send, calls } = guarded(() => 'new')
    const renew = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 5))
      return { Authorization: 'Bearer new' }
    })
    const api = air.create({
      headers: { Authorization: 'Bearer old' },
      fetch: refresh({ headers: renew, fetch: send }),
    })

    const results = await Promise.all([
      api.get(U),
      api.get(U),
      api.get(U),
      api.get(U),
      api.get(U),
    ])
    expect(results).toHaveLength(5)
    expect(renew).toHaveBeenCalledTimes(1)
    expect(calls).toHaveLength(10)
  })

  it('refreshes again on a later failure', async () => {
    let accepted = 'one'
    const { send } = guarded(() => accepted)
    let token = 'old'
    const renew = vi.fn(() => ({ Authorization: `Bearer ${(token = accepted)}` }))
    const api = air.create({
      headers: () => ({ Authorization: `Bearer ${token}` }),
      fetch: refresh({ headers: renew, fetch: send }),
    })

    await api.get(U)
    accepted = 'two'
    await api.get(U)
    expect(renew).toHaveBeenCalledTimes(2)
  })

  it('retries once and never loops when the credential is still rejected', async () => {
    const { send, calls } = guarded(() => 'never')
    const renew = vi.fn(() => ({ Authorization: 'Bearer still-bad' }))
    const api = air.create({ fetch: refresh({ headers: renew, fetch: send }) })

    const error: unknown = await api.get(U).catch((e: unknown) => e)
    expect(isAirError(error) && error.status).toBe(401)
    expect(renew).toHaveBeenCalledTimes(1)
    expect(calls).toHaveLength(2)
  })

  it('leaves every other status alone', async () => {
    const renew = vi.fn(() => ({}))
    for (const code of [200, 403, 500]) {
      const send = vi.fn(async () => new Response(null, { status: code }))
      const response = await refresh({ headers: renew, fetch: send })(U, {})
      expect(response.status).toBe(code)
    }
    expect(renew).not.toHaveBeenCalled()
  })

  it('honours a custom status list', async () => {
    let calls = 0
    const send = vi.fn(async () =>
      ++calls === 1 ? new Response(null, { status: 419 }) : json({}),
    )
    const renew = vi.fn(() => ({}))
    await refresh({ headers: renew, statuses: [419], fetch: send })(U, {})
    expect(renew).toHaveBeenCalledTimes(1)
  })

  it('does not retry a ReadableStream body', async () => {
    const { send, calls } = guarded(() => 'new')
    const renew = vi.fn(() => ({ Authorization: 'Bearer new' }))
    const response = await refresh({ headers: renew, fetch: send })(U, {
      method: 'POST',
      body: new ReadableStream(),
    })
    expect(response.status).toBe(401)
    expect(renew).not.toHaveBeenCalled()
    expect(calls).toHaveLength(1)
  })

  it('surfaces a failing refresh as the request error', async () => {
    const { send } = guarded(() => 'new')
    const boom = new Error('refresh endpoint down')
    const api = air.create({
      fetch: refresh({ headers: () => Promise.reject(boom), fetch: send }),
    })

    const error: unknown = await api.get(U).catch((e: unknown) => e)
    expect(isAirError(error) && error.cause).toBe(boom)
    expect(isAirError(error) && error.status).toBeUndefined()
  })

  it('cancels the rejected body and keeps method, body and signal on the retry', async () => {
    let rejected: Response | undefined
    const controller = new AbortController()
    const calls: RequestInit[] = []
    const send = vi.fn(async (_url: string, init: RequestInit) => {
      calls.push(init)
      return calls.length === 1
        ? (rejected = json({ error: 'expired' }, { status: 401 }))
        : json({})
    })
    await refresh({ headers: () => ({ Authorization: 'Bearer new' }), fetch: send })(U, {
      method: 'POST',
      body: '{"a":1}',
      signal: controller.signal,
      headers: { 'X-Client': 'air' },
    })

    expect(rejected?.bodyUsed).toBe(true)
    expect(calls[1]).toMatchObject({
      method: 'POST',
      body: '{"a":1}',
      signal: controller.signal,
    })
    const headers = new Headers(calls[1]!.headers)
    expect(headers.get('x-client')).toBe('air')
    expect(headers.get('authorization')).toBe('Bearer new')
  })

  it('hands the renewal function the unwrapped fetch, so a 401 from the renewal endpoint cannot deadlock', async () => {
    // The renewal endpoint itself answers 401. Sent through the wrapped client this would wait
    // for the refresh it is part of; sent through the fetch handed to `headers`, it is just a
    // response the renewal function gets to look at.
    const send = vi.fn(async (url: string, init: RequestInit) => {
      if (url.endsWith('/renew')) return new Response(null, { status: 401 })
      const token = new Headers(init.headers).get('authorization')
      return token === 'Bearer new'
        ? json({ ok: true })
        : new Response(null, { status: 401 })
    })
    const renew = vi.fn(async (fetch: Fetch) => {
      const answer = await fetch('https://api.test/renew', {})
      return { Authorization: answer.status === 401 ? 'Bearer new' : 'Bearer other' }
    })
    const api = air.create({ fetch: refresh({ headers: renew, fetch: send }) })

    await expect(api.get(U)).resolves.toEqual({ ok: true })
    expect(renew).toHaveBeenCalledTimes(1)
    expect(renew.mock.calls[0]![0]).toBe(send)
  })

  it('uses the global fetch when none is given', async () => {
    let attempts = 0
    mockFetch(() =>
      ++attempts === 1 ? new Response(null, { status: 401 }) : json({ ok: 1 }),
    )
    await expect(
      air.get(U, { fetch: refresh({ headers: () => ({ Authorization: 'Bearer x' }) }) }),
    ).resolves.toEqual({ ok: 1 })
    expect(attempts).toBe(2)
  })
})
