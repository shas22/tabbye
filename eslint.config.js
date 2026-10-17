import { defineConfig } from 'eslint/config';
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import hooks from 'eslint-plugin-react-hooks';
import a11y from 'eslint-plugin-jsx-a11y';
import globals from 'globals';

export default defineConfig(
  {
    ignores: [
      'node_modules/**',
      '.wxt/**',
      '.output/**',
      'test-results/**',
      'playwright-report/**',
    ],
  },
  js.configs.recommended,
  tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: { '@typescript-eslint/no-deprecated': 'error' },
  },
  // Plain JavaScript files are outside the TypeScript project.
  { files: ['**/*.{js,mjs}'], extends: [tseslint.configs.disableTypeChecked] },
  // Test doubles implement async interfaces without awaiting anything.
  {
    files: ['tests/**', 'scripts/**'],
    rules: { '@typescript-eslint/require-await': 'off' },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/domain/validation.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "ImportDeclaration[source.value='zod']",
          message:
            'Import from domain/validation so schemas use the extension-safe Zod configuration.',
        },
      ],
    },
  },
  {
    files: ['src/**/*.tsx'],
    plugins: { 'react-hooks': hooks, 'jsx-a11y': a11y },
    rules: {
      ...hooks.configs.recommended.rules,
      ...a11y.configs.recommended.rules,
    },
  },
  {
    files: ['src/domain/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            'react*',
            'wxt*',
            '#*',
            '**/application/**',
            '**/platform/**',
            '**/ui/**',
            '**/entrypoints/**',
          ],
        },
      ],
      'no-restricted-globals': ['error', 'chrome', 'browser'],
    },
  },
  {
    files: ['src/application/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            'react*',
            'wxt*',
            '#*',
            '**/platform/**',
            '**/ui/**',
            '**/entrypoints/**',
          ],
        },
      ],
    },
  },
  {
    files: ['src/ui/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            '**/platform/**',
            '**/application/service',
            '**/entrypoints/**',
          ],
        },
      ],
    },
  },
);
