import js from '@eslint/js';
import globals from 'globals';
import lit from 'eslint-plugin-lit';
import compat from 'eslint-plugin-compat';
import importPlugin from 'eslint-plugin-import';

const browserFiles = ['*.js', 'components/**/*.js', 'js/**/*.js', 'service-worker.js'];

const litRecommended = lit.configs['flat/recommended'];

export default [
  {
    ignores: ['node_modules/**', 'test-results/**', 'tests/fixtures/**'],
  },
  js.configs.recommended,
  {
    ...litRecommended,
    files: ['components/**/*.js'],
    rules: {
      ...litRecommended.rules,
      'lit/attribute-names': 'error',
      'lit/no-native-attributes': 'error',
    },
  },
  {
    files: browserFiles,
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.es2021,
        WorkerGlobalScope: 'readonly',
        chrome: 'readonly',
        google: 'readonly',
      },
    },
    plugins: {
      compat,
      import: importPlugin,
    },
    rules: {
      'no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
        },
      ],
      'no-console': 'off',
      'compat/compat': 'error',
      'import/first': 'error',
      'import/no-duplicates': 'error',
      'import/newline-after-import': 'error',
      'import/no-unresolved': [
        'error',
        {
          ignore: ['^lit', '^/js/'],
        },
      ],
      'import/no-cycle': 'warn',
    },
  },
  {
    files: ['service-worker.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.serviceworker,
        ...globals.es2021,
        WorkerGlobalScope: 'readonly',
      },
    },
  },
  {
    files: ['tests/**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.mocha,
        indexedDB: 'readonly',
      },
    },
    rules: {
      'no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
        },
      ],
      'no-console': 'off',
    },
  },
  {
    files: ['tests/template-test.js', 'tests/test-sw.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.es2021,
      },
    },
  },
  {
    files: ['auth-proxy/**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.node,
        ...globals.serviceworker,
      },
    },
    rules: {
      'no-console': 'off',
      'compat/compat': 'off',
      'no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
        },
      ],
    },
  },
];
