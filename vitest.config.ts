import { defineConfig } from 'vitest/config';

// Тесты ядра живых данных (кандидат B ревью, этап 1): реестр каналов гоняется
// с fake-транспортом — без DOM и сети. Импорты в тестах относительные (внутри
// src/lib), по правилу code-style — алиас @/ здесь не нужен.
//
// css: true — иначе vitest подменяет CSS пустой строкой и тест палитры
// (`design-tokens.test.ts`) не видит блок `@theme`.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    css: true,
  },
});
