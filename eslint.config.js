import js from '@eslint/js'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['dist'] },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    // examples/ is plain JS, so it needs the runtime globals TS already
    // knows about for src/ and test/ via lib.dom.d.ts.
    files: ['examples/**'],
    languageOptions: {
      globals: {
        console: 'readonly',
        fetch: 'readonly',
        Response: 'readonly',
        AbortSignal: 'readonly',
        FormData: 'readonly',
        URL: 'readonly',
        setTimeout: 'readonly',
      },
    },
  },
)
