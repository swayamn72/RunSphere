import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/build/**', '**/node_modules/**', '.expo/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }]
    }
  },
  /**
   * Node scripts (data imports, seeding, CI checks, scratch experiments) run
   * in Node, not the app, so they get Node's globals. Listed here rather than
   * pulled from the `globals` package to keep the toolchain as it is.
   */
  {
    files: ['**/*.mjs', 'scratch/**/*.js'],
    languageOptions: {
      globals: {
        console: 'readonly',
        process: 'readonly',
        Buffer: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
        fetch: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly'
      }
    }
  },
  /**
   * Metro resolver shims are CommonJS by necessity.
   *
   * Metro reads them through its own `resolveRequest` hook rather than the
   * bundler's ESM graph, so `module.exports` is the only export form it
   * honours here — which the default ESM globals would flag as undefined.
   */
  {
    files: [
      'apps/mobile/src/shims/**/*.js',
      '**/*.cjs',
      // Expo/Metro/Babel load these config files with `require` in Node.
      '**/metro.config.js',
      '**/babel.config.js'
    ],
    languageOptions: {
      sourceType: 'commonjs',
      globals: { module: 'writable', require: 'readonly', __dirname: 'readonly' }
    },
    rules: { '@typescript-eslint/no-require-imports': 'off' }
  }
);
