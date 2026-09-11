// @ts-check
import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import svelte from 'eslint-plugin-svelte';
import globals from 'globals';
import ts from 'typescript-eslint';

/**
 * Repo-wide lint. Beyond the usual TS/Svelte hygiene, a few rules encode ADRs so
 * a future contributor cannot "fix" a deliberate decision by accident:
 *
 * - ADR-0001: no tenant concept. `tenantId`/`tenant_id` identifiers are denied.
 * - ADR-0008: no interactive transactions. `withTransaction` is denied everywhere.
 * - ADR-0002/0013: the bridge never imports @pressline/render or any image codec.
 */
export default ts.config(
  {
    ignores: [
      '**/node_modules/',
      '**/dist/',
      '**/build/',
      '**/.svelte-kit/',
      '**/.wrangler/',
      '**/.vercel/',
      '**/.astro/',
      '**/coverage/',
      'pnpm-lock.yaml',
    ],
  },
  js.configs.recommended,
  ...ts.configs.recommended,
  ...svelte.configs.recommended,
  prettier,
  ...svelte.configs.prettier,
  {
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': 'error',
      'no-console': ['error', { allow: ['warn', 'error'] }],

      // ADR-0001: single-operator, never multi-tenant.
      'id-denylist': ['error', 'tenantId', 'tenant_id', 'tenant', 'tenants'],

      // ADR-0008: D1 has no interactive transactions; every write is a batch.
      'no-restricted-syntax': [
        'error',
        {
          selector: "MemberExpression[property.name='withTransaction']",
          message: 'ADR-0008: no interactive transactions. Use Db.batch.',
        },
        {
          selector: "CallExpression[callee.name='withTransaction']",
          message: 'ADR-0008: no interactive transactions. Use Db.batch.',
        },
      ],
    },
  },
  {
    // ADR-0002 / ADR-0003: Pressline validates headers only and stores no bytes;
    // the render helper and image codecs are for Engines.
    files: ['apps/pressline/**/*.{ts,js,svelte}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: '@pressline/render', message: 'ADR-0002: the bridge never renders.' },
            { name: 'sharp', message: 'ADR-0002: the bridge never decodes pixels.' },
          ],
          patterns: [
            {
              group: ['@jsquash/*', '@resvg/*', 'jimp', 'pngjs'],
              message: 'ADR-0002: the bridge never decodes pixels.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['**/*.svelte', '**/*.svelte.ts', '**/*.svelte.js'],
    languageOptions: {
      parserOptions: {
        parser: ts.parser,
        extraFileExtensions: ['.svelte'],
      },
    },
  },
  {
    files: ['scripts/**/*.mjs', 'apps/*/scripts/**/*.ts'],
    rules: { 'no-console': 'off' },
  },
);
