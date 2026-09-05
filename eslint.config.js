import js from '@eslint/js'
import { defineConfig, globalIgnores } from 'eslint/config'
import tseslint from 'typescript-eslint'

export default defineConfig(
  globalIgnores(['dist']),
  js.configs.recommended,
  {
    // Type-aware linting for everything TypeScript. `strict` over `recommended` because a
    // library this small has no excuse for an unnecessary assertion or a floating promise.
    files: ['**/*.ts'],
    extends: [tseslint.configs.strictTypeChecked, tseslint.configs.stylisticTypeChecked],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      // `${response.status}` in an error message is the intended use of a template.
      '@typescript-eslint/restrict-template-expressions': [
        'error',
        { allowNumber: true },
      ],
    },
  },
  {
    // Tests index into arrays of recorded requests under noUncheckedIndexedAccess, and
    // `requests[0]!` is the honest spelling of "this test sent exactly one request". A fetch
    // double is `async` because the `Fetch` type returns a promise, whether or not it awaits.
    files: ['test/**'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/require-await': 'off',
    },
  },
  {
    // examples/ and scripts/ are plain JS, so they need the runtime globals TypeScript
    // already knows about for src/ and test/ via lib.dom.d.ts. Hand-maintained rather
    // than pulling in the `globals` package: a devDependency for a lint config is still a
    // devDependency. Alphabetical, so adding one is obvious.
    files: ['examples/**', 'scripts/**', 'bench/**'],
    languageOptions: {
      globals: {
        AbortController: 'readonly',
        AbortSignal: 'readonly',
        Blob: 'readonly',
        Buffer: 'readonly',
        File: 'readonly',
        FormData: 'readonly',
        Headers: 'readonly',
        ReadableStream: 'readonly',
        Request: 'readonly',
        Response: 'readonly',
        TextDecoderStream: 'readonly',
        TextDecoder: 'readonly',
        TextEncoder: 'readonly',
        TransformStream: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
        console: 'readonly',
        fetch: 'readonly',
        performance: 'readonly',
        process: 'readonly',
        setTimeout: 'readonly',
      },
    },
  },
)
