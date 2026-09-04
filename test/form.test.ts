import { describe, expect, it } from 'vitest'
import air from '../src/index.js'
import { toFormData } from '../src/form.js'
import { mockFetch } from './mock.js'

describe('toFormData', () => {
  it('stringifies primitives and drops nullish values', () => {
    const form = toFormData({
      name: 'Ada',
      age: 36,
      admin: true,
      nick: null,
      bio: undefined,
    })
    expect([...form.entries()]).toEqual([
      ['name', 'Ada'],
      ['age', '36'],
      ['admin', 'true'],
    ])
  })

  it('appends the key once per array item', () => {
    const form = toFormData({ tags: ['a', null, 'b'] })
    expect(form.getAll('tags')).toEqual(['a', 'b'])
  })

  it('keeps a File name and sends a Blob as blob', () => {
    const form = toFormData({
      avatar: new File(['x'], 'me.png', { type: 'image/png' }),
      raw: new Blob(['y']),
    })
    expect((form.get('avatar') as File).name).toBe('me.png')
    expect((form.get('raw') as File).name).toBe('blob')
  })

  it('rejects a nested object at compile time', () => {
    // @ts-expect-error multipart has no convention for nested objects
    toFormData({ profile: { name: 'Ada' } })
  })

  it('is sent as multipart with the runtime boundary', async () => {
    const requests = mockFetch()
    await air.post('https://api.test/upload', { body: toFormData({ name: 'Ada' }) })
    expect(requests[0]!.headers.get('content-type')).toMatch(
      /^multipart\/form-data; boundary=/,
    )
    await expect(requests[0]!.formData().then((f) => f.get('name'))).resolves.toBe('Ada')
  })
})
