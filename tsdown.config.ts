import { defineConfig } from 'tsdown'

// One entry per public import path. The utilities import only types from the client, so each
// file is self-contained and the root entry does not grow.
export default defineConfig({
  entry: {
    index: 'src/index.ts',
    retry: 'src/retry.ts',
    refresh: 'src/refresh.ts',
    progress: 'src/progress.ts',
    form: 'src/form.ts',
    query: 'src/query.ts',
  },
  format: ['esm'],
  dts: true,
  clean: true,
})
