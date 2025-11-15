import js from '@eslint/js';
import globals from 'globals';
import lit from 'eslint-plugin-lit';

const browserFiles = [
    '*.js',
    'components/**/*.js',
    'js/**/*.js',
    'service-worker.js'
];

const litRecommended = lit.configs['flat/recommended'];

export default [
    {
        ignores: [
            'auth-proxy/**',
            'node_modules/**',
            'test-results/**',
            'tests/fixtures/**'
        ]
    },
    js.configs.recommended,
    {
        ...litRecommended,
        files: ['components/**/*.js']
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
                google: 'readonly'
            }
        },
        rules: {
            'no-unused-vars': [
                'warn',
                {
                    argsIgnorePattern: '^_',
                    varsIgnorePattern: '^_'
                }
            ],
            'no-console': 'off'
        }
    },
    {
        files: ['service-worker.js'],
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'module',
            globals: {
                ...globals.serviceworker,
                ...globals.es2021,
                WorkerGlobalScope: 'readonly'
            }
        }
    },
    {
        files: ['tests/**/*.js'],
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'module',
            globals: {
                ...globals.node,
                ...globals.mocha
            }
        },
        rules: {
            'no-unused-vars': [
                'warn',
                {
                    argsIgnorePattern: '^_',
                    varsIgnorePattern: '^_'
                }
            ],
            'no-console': 'off'
        }
    },
    {
        files: ['tests/template-test.js', 'tests/test-sw.js'],
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'module',
            globals: {
                ...globals.browser,
                ...globals.es2021
            }
        }
    }
];
