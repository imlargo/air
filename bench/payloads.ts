// Two response sizes: a typical small record, and a page of records where parsing dominates.

const user = (id: number) => ({
  id,
  name: `User ${id}`,
  email: `user${id}@example.com`,
  tags: ['a', 'b'],
  active: id % 2 === 0,
})

export type Payload = 'small' | 'large'

export const PAYLOADS: Record<Payload, string> = {
  small: JSON.stringify(user(1)),
  large: JSON.stringify(Array.from({ length: 300 }, (_, i) => user(i))),
}

export const PATHS: Record<Payload, string> = { small: '/users/1', large: '/users' }
