import { describe, expect, it, vi } from 'vitest'
import air, { isAirError } from '../src/index.js'
import { retry } from '../src/retry.js'
import { json, mockFetch } from './mock.js'

type Answer = () => Response | Error

/** A transport that answers each attempt from a script and records the attempts. */
function scripted(...answers: Answer[]) {
  const calls: { url: string; init: RequestInit }[] = []
  const send = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init })
    const answer = answers[Math.min(calls.length, answers.length) - 1]!()
    if (answer instanceof Error) throw answer
    return answer
  })
  return { send, calls }
}

const status = (code: number, headers?: Record<string, string>) => () =>
  new Response(null, { status: code, headers })
const ok = () => json({ ok: true })
const fast = { delay: () => 0 }
const U = 'https://api.test/a'

describe('retry', () => {
  it('retries a transient status until a request succeeds', async () => {
    const { send, calls } = scripted(status(503), status(502), ok)
    const response = await retry({ ...fast, fetch: send })(U, { method: 'GET' })
    expect(response.status).toBe(200)
    expect(calls).toHaveLength(3)
  })

  it('returns the last response when attempts run out, so air throws with its status', async () => {
    const { send, calls } = scripted(status(503))
    const api = air.create({ fetch: retry({ attempts: 2, ...fast, fetch: send }) })
    const error: unknown = await api.get(U).catch((e: unknown) => e)
    expect(isAirError(error) && error.status).toBe(503)
    expect(calls).toHaveLength(2)
  })

  it('does not retry a method that is not idempotent unless told to', async () => {
    const first = scripted(status(503), ok)
    await retry({ ...fast, fetch: first.send })(U, { method: 'POST' })
    expect(first.calls).toHaveLength(1)

    const second = scripted(status(503), ok)
    await retry({ ...fast, methods: ['POST'], fetch: second.send })(U, { method: 'POST' })
    expect(second.calls).toHaveLength(2)
  })

  it('does not retry a status outside the list', async () => {
    const { send, calls } = scripted(status(404), ok)
    const response = await retry({ ...fast, fetch: send })(U, {})
    expect(response.status).toBe(404)
    expect(calls).toHaveLength(1)
  })

  it('retries a network failure', async () => {
    const { send, calls } = scripted(() => new TypeError('fetch failed'), ok)
    const response = await retry({ ...fast, fetch: send })(U, {})
    expect(response.status).toBe(200)
    expect(calls).toHaveLength(2)
  })

  it('never retries once the signal has fired, whatever the error is called', async () => {
    const controller = new AbortController()
    const { send, calls } = scripted(() => {
      controller.abort()
      return new TypeError('looks transient')
    }, ok)
    await expect(
      retry({ ...fast, fetch: send })(U, { signal: controller.signal }),
    ).rejects.toThrow('looks transient')
    expect(calls).toHaveLength(1)
  })

  it('never retries a ReadableStream body', async () => {
    const { send, calls } = scripted(status(503), ok)
    const body = new ReadableStream()
    const response = await retry({ ...fast, methods: ['POST'], fetch: send })(U, {
      method: 'POST',
      body,
    })
    expect(response.status).toBe(503)
    expect(calls).toHaveLength(1)
  })

  it('lets Retry-After win over delay, in seconds or as a date', async () => {
    const delay = vi.fn(() => 0)
    await retry({ delay, fetch: scripted(status(429, { 'retry-after': '0' }), ok).send })(
      U,
      {},
    )
    await retry({
      delay,
      fetch: scripted(status(503, { 'retry-after': new Date().toUTCString() }), ok).send,
    })(U, {})
    expect(delay).not.toHaveBeenCalled()

    await retry({
      delay,
      fetch: scripted(status(503, { 'retry-after': 'soon' }), ok).send,
    })(U, {})
    expect(delay).toHaveBeenCalledWith(1)
  })

  it('waits a jittered exponential delay by default', async () => {
    vi.useFakeTimers()
    try {
      vi.spyOn(Math, 'random').mockReturnValue(0.5)
      const { send, calls } = scripted(status(503), status(503), ok)
      const pending = retry({ fetch: send })(U, {})

      await vi.advanceTimersByTimeAsync(99) // half of the 200 ms ceiling is 100 ms
      expect(calls).toHaveLength(1)
      await vi.advanceTimersByTimeAsync(1)
      expect(calls).toHaveLength(2)
      await vi.advanceTimersByTimeAsync(199) // then half of 400 ms
      expect(calls).toHaveLength(2)
      await vi.advanceTimersByTimeAsync(1)
      expect(calls).toHaveLength(3)
      await expect(pending).resolves.toHaveProperty('status', 200)
    } finally {
      vi.useRealTimers()
      vi.restoreAllMocks()
    }
  })

  it('passes attempt numbers to delay, starting at 1', async () => {
    const delay = vi.fn(() => 0)
    await retry({ delay, fetch: scripted(status(503), status(503), ok).send })(U, {})
    expect(delay.mock.calls).toEqual([[1], [2]])
  })

  it('ends the wait early when the signal fires', async () => {
    const controller = new AbortController()
    const reason = new Error('cancelled')
    const { send, calls } = scripted(status(503), ok)
    const pending = retry({ delay: () => 10_000, fetch: send })(U, {
      signal: controller.signal,
    })
    await vi.waitFor(() => {
      expect(calls).toHaveLength(1)
    })
    controller.abort(reason)
    await expect(pending).rejects.toBe(reason)
  })

  it('cancels the body of a response it retries', async () => {
    let first: Response | undefined
    const { send } = scripted(() => (first = json({}, { status: 503 })), ok)
    await retry({ ...fast, fetch: send })(U, {})
    expect(first?.bodyUsed).toBe(true)
  })

  it('uses the global fetch when none is given', async () => {
    let attempts = 0
    mockFetch(() =>
      ++attempts === 1 ? new Response(null, { status: 503 }) : json({ ok: 1 }),
    )
    await expect(air.get(U, { fetch: retry(fast) })).resolves.toEqual({ ok: 1 })
    expect(attempts).toBe(2)
  })
})
