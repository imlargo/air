import { describe, expect, it, afterEach, vi } from 'vitest'
import air, { AirError, isRetryable, retry } from '../src/index.js'
import { json, mockFetch, stall } from './mock.js'

afterEach(() => vi.unstubAllGlobals())

describe('retry', () => {
  it('retries until the call succeeds', async () => {
    let calls = 0
    const requests = mockFetch(() => {
      calls++
      return calls < 3 ? json({}, { status: 503 }) : json({ ok: true })
    })

    const data = await retry(() => air.get('https://api.test/a'))

    expect(data).toEqual({ ok: true })
    expect(requests).toHaveLength(3)
  })

  it('gives up after the attempt limit', async () => {
    const requests = mockFetch(() => json({}, { status: 503 }))

    await expect(
      retry(() => air.get('https://api.test/a'), { attempts: 2 }),
    ).rejects.toBeInstanceOf(AirError)
    expect(requests).toHaveLength(2)
  })

  it('does not retry client errors', async () => {
    const requests = mockFetch(() => json({}, { status: 404 }))

    await expect(retry(() => air.get('https://api.test/a'))).rejects.toBeInstanceOf(
      AirError,
    )
    expect(requests).toHaveLength(1)
  })

  it('does not retry after an abort', async () => {
    const requests = mockFetch(stall)
    const controller = new AbortController()

    const pending = retry(() =>
      air.get('https://api.test/a', { signal: controller.signal }),
    )
    controller.abort()

    await expect(pending).rejects.toBeInstanceOf(AirError)
    expect(requests).toHaveLength(1)
  })

  it('retries timeouts when each attempt builds its own signal', async () => {
    const requests = mockFetch(stall)

    await expect(
      retry(() => air.get('https://api.test/a', { signal: AbortSignal.timeout(10) }), {
        attempts: 2,
      }),
    ).rejects.toThrow(/timed out/)
    expect(requests).toHaveLength(2)
  })

  it('passes the attempt number to the callback', async () => {
    mockFetch(() => json({}, { status: 503 }))
    const seen: number[] = []

    await expect(
      retry(
        (attempt) => {
          seen.push(attempt)
          return air.get('https://api.test/a')
        },
        { attempts: 3 },
      ),
    ).rejects.toBeInstanceOf(AirError)
    expect(seen).toEqual([1, 2, 3])
  })

  it('asks the delay function for each wait', async () => {
    mockFetch(() => json({}, { status: 503 }))
    const waits: number[] = []

    await expect(
      retry(() => air.get('https://api.test/a'), {
        attempts: 3,
        delay: (attempt) => {
          waits.push(attempt)
          return 0
        },
      }),
    ).rejects.toBeInstanceOf(AirError)
    expect(waits).toEqual([1, 2])
  })

  it('takes a custom predicate', async () => {
    const requests = mockFetch(() => json({}, { status: 404 }))

    await expect(
      retry(() => air.get('https://api.test/a'), {
        attempts: 2,
        when: () => true,
      }),
    ).rejects.toBeInstanceOf(AirError)
    expect(requests).toHaveLength(2)
  })

  it('works with any promise, not just air calls', async () => {
    let calls = 0
    const data = await retry(
      async () => {
        calls++
        if (calls < 2) throw new Error('boom')
        return 'done'
      },
      { when: () => true },
    )

    expect(data).toBe('done')
    expect(calls).toBe(2)
  })
})

describe('isRetryable', () => {
  it('accepts transient failures', async () => {
    mockFetch(() => json({}, { status: 503 }))
    expect(isRetryable(await air.get('https://api.test/a').catch((e) => e))).toBe(true)
  })

  it('rejects client errors', async () => {
    mockFetch(() => json({}, { status: 404 }))
    expect(isRetryable(await air.get('https://api.test/a').catch((e) => e))).toBe(false)
  })

  it('rejects aborts', async () => {
    mockFetch(stall)
    const controller = new AbortController()
    const pending = air.get('https://api.test/a', { signal: controller.signal })
    controller.abort()
    expect(isRetryable(await pending.catch((e) => e))).toBe(false)
  })

  it('rejects anything that is not an AirError', () => {
    expect(isRetryable(new Error('boom'))).toBe(false)
  })
})
