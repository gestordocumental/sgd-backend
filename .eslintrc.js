// @ts-check
'use strict';

/** @type {import('eslint').Linter.Config} */
module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
  },
  plugins: [
    '@typescript-eslint',
    'security',
  ],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:security/recommended-legacy',
  ],
  rules: {
    // ── Security rules (SAST-lite) ───────────────────────────────────────
    'security/detect-non-literal-require':   'error',
    'security/detect-object-injection':      'warn',
    'security/detect-possible-timing-attacks': 'error',
    'security/detect-unsafe-regex':          'error',
    'security/detect-child-process':         'error',
    'security/detect-eval-with-expression':  'error',
    'no-eval':                               'error',
    'no-new-func':                           'error',

    // ── Type safety ──────────────────────────────────────────────────────
    '@typescript-eslint/no-explicit-any':    'warn',
    '@typescript-eslint/no-unused-vars':     ['warn', { argsIgnorePattern: '^_' }],

    // ── NestJS patterns — allow decorators and constructor injection ──────
    '@typescript-eslint/no-empty-function':  'off',
    '@typescript-eslint/no-empty-interface': 'off',
  },
  ignorePatterns: [
    '**/node_modules/**',
    '**/dist/**',
    '**/coverage/**',
    '**/*.js',        // compiled JS — lint TypeScript sources only
    '**/*.d.ts',
    '**/migrations/**',
  ],
};
