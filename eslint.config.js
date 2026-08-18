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
        console: 'readonly',
        process: 'readonly',
        fetch: 'readonly',
        Request: 'readonly',
        Response: 'readonly',
        ReadableStream: 'readonly',
        AbortSignal: 'readonly',
        FormData: 'readonly',
        URL: 'readonly',
        setTimeout: 'readonly',
      },
    },
  },
)
