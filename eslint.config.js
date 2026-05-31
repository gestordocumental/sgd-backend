// @ts-check
'use strict';

const tsPlugin = require('@typescript-eslint/eslint-plugin');
const tsParser = require('@typescript-eslint/parser');
const security = require('eslint-plugin-security');
const js       = require('@eslint/js');

/** @type {import('eslint').Linter.Config[]} */
module.exports = [
  // ── Global ignores ────────────────────────────────────────────────────────
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/coverage/**',
      '**/*.js',
      '**/*.d.ts',
      '**/migrations/**',
    ],
  },

  // ── Base recommended sets ─────────────────────────────────────────────────
  js.configs.recommended,
  ...tsPlugin.configs['flat/recommended'],
  security.configs.recommended,

  // ── Project-specific rules & parser options ───────────────────────────────
  {
    files: ['services/*/src/**/*.ts', 'packages/common/src/**/*.ts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType:  'module',
      },
    },
    rules: {
      // ── Security rules (SAST-lite) ───────────────────────────────────────
      'security/detect-non-literal-require':     'error',
      'security/detect-object-injection':        'warn',
      'security/detect-possible-timing-attacks': 'error',
      'security/detect-unsafe-regex':            'error',
      'security/detect-child-process':           'error',
      'security/detect-eval-with-expression':    'error',
      'no-eval':                                 'error',
      'no-new-func':                             'error',

      // ── Type safety ──────────────────────────────────────────────────────
      '@typescript-eslint/no-explicit-any':      'warn',
      '@typescript-eslint/no-unused-vars':       ['warn', { argsIgnorePattern: '^_' }],

      // ── NestJS patterns ──────────────────────────────────────────────────
      '@typescript-eslint/no-empty-function':    'off',
      '@typescript-eslint/no-empty-interface':   'off',
    },
  },
];
