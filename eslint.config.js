import js from '@eslint/js'
import { defineConfig, globalIgnores } from 'eslint/config'
import tseslint from 'typescript-eslint'

export default defineConfig(
  globalIgnores(['dist', 'bench/node_modules']),
  js.configs.recommended,
  {
    // Type-aware linting for everything TypeScript. `strict` over `recommended` because a
    // library this small has no excuse for an unnecessary assertion or a floating promise.
    files: ['**/*.ts'],
    extends: [tseslint.configs.strictTypeChecked, tseslint.configs.stylisticTypeChecked],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.json', './tsconfig.node.json', './bench/tsconfig.json'],
        tsconfigRootDir: import.meta.dirname,
      },
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
)
