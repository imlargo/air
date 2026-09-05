// Two response sizes: a typical small record, and a page of records where parsing dominates.

const user = (id) => ({
  id,
  name: `User ${id}`,
  email: `user${id}@example.com`,
  tags: ['a', 'b'],
  active: id % 2 === 0,
})

export const PAYLOADS = {
  small: JSON.stringify(user(1)),
  large: JSON.stringify(Array.from({ length: 300 }, (_, i) => user(i))),
}

export const PATHS = { small: '/users/1', large: '/users' }
