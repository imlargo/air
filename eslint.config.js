import js from '@eslint/js'
import { defineConfig, globalIgnores } from 'eslint/config'
import tseslint from 'typescript-eslint'

export default defineConfig(
  globalIgnores(['dist']),
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    // examples/ and scripts/ are plain JS, so they need the runtime globals TS
    // already knows about for src/ and test/ via lib.dom.d.ts.
    files: ['examples/**', 'scripts/**'],
    languageOptions: {
      globals: {
        // Hand-maintained rather than pulling in the `globals` package: a devDependency for
        // a lint config is still a devDependency. These are the platform globals TypeScript
        // already knows about for src/ and test/ through lib.dom.d.ts. Alphabetical, so
        // adding one is obvious.
        AbortController: 'readonly',
        AbortSignal: 'readonly',
        FormData: 'readonly',
        Headers: 'readonly',
        ReadableStream: 'readonly',
        Request: 'readonly',
        Response: 'readonly',
        TextDecoderStream: 'readonly',
        TextEncoder: 'readonly',
        TransformStream: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
        console: 'readonly',
        fetch: 'readonly',
        process: 'readonly',
        setTimeout: 'readonly',
      },
    },
  },
)
