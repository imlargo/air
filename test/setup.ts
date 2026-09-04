import { afterEach, vi } from 'vitest'

// Every test that stubs the global fetch gets it restored, so a stub cannot leak into the
// next file's assertions.
afterEach(() => {
  vi.unstubAllGlobals()
})
