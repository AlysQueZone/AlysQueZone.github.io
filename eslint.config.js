import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import eslintPluginAstro from 'eslint-plugin-astro';
import prettier from 'eslint-config-prettier';

export default [
  {
    ignores: ['dist/**', '.astro/**', 'node_modules/**', 'public/**', '.opencode/**', '.agents/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...eslintPluginAstro.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': 'warn',
      'no-unused-vars': 'off',
      'no-console': 'off',
      // TDZ-гард (кейс GambaModal 2026-09-11: use-before-const убивал
      // скрипт в dev, а прод-бандл const→var молча прятал): tsc .astro-скрипты
      // не проверяет, это правило — единственный committed-шов.
      'no-use-before-define': ['error', { variables: true, functions: false, classes: true }],
    },
  },
  prettier,
];
