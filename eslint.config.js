import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import eslintPluginAstro from 'eslint-plugin-astro';
import prettier from 'eslint-config-prettier';

export default [
  { ignores: ['dist/**', '.astro/**', 'node_modules/**', 'public/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...eslintPluginAstro.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': 'warn',
      'no-unused-vars': 'off',
      'no-console': 'off',
    },
  },
  prettier,
];
