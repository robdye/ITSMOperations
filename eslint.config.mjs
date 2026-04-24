import js from '@eslint/js';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';

export default [
  js.configs.recommended,
  {
    files: ['**/*.ts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: { project: false },
      globals: {
        console: 'readonly',
        process: 'readonly',
        setTimeout: 'readonly',
        setInterval: 'readonly',
        clearTimeout: 'readonly',
        clearInterval: 'readonly',
        Buffer: 'readonly',
        __dirname: 'readonly',
        Map: 'readonly',
        Set: 'readonly',
        Promise: 'readonly',
        URL: 'readonly',
        Date: 'readonly',
        Error: 'readonly',
        Omit: 'readonly',
        Record: 'readonly',
        Partial: 'readonly',
        NodeJS: 'readonly',
      },
    },
    plugins: { '@typescript-eslint': tsPlugin },
    rules: {
      ...tsPlugin.configs.recommended.rules,
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
      'no-console': 'off',
    },
  },
  {
    ignores: ['**/node_modules/**', '**/dist/**', '**/build/**', '**/assets/**', '**/*.mjs', '**/*.js'],
  },
];
