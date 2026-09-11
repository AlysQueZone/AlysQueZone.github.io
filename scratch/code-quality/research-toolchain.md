# Research: тулчейн Prettier + ESLint (мягкий минимум) для AlysQueZone

Дата: 2026-09-11. Стек репо: Astro 7 (`astro ^7.2.9`), TS `^5.7.3`, Tailwind 4 (`tailwindcss ^4.3.3` + `@tailwindcss/vite`), `supabase-js ^2.115.0`, `"type": "module"`, Node 26. Enforcement — только pre-commit хуки, без CI (решение карты `scratch/code-quality/map.md`).

## Вывод коротко

- ESLint **10** (flat config `eslint.config.js`), не 9: `eslint-plugin-astro@3.1.0` требует `eslint >= 10` по peerDeps, а ветка ESLint 9 в EOL с 2026-08-06.
- TS-линт через мета-пакет `typescript-eslint` (не отдельные `@typescript-eslint/*`), только `recommended` без type-aware правил (без `projectService` / `tsconfig.eslint.json`) — мягко и быстро.
- Prettier 3 + `prettier-plugin-astro@1.0.0` (stable; бывшая 0.14.x, beta 1.0 в авг 2026) + опционально `prettier-plugin-tailwindcss` последним в списке.
- Хуки: `husky@9` + `lint-staged@17`, конфиг lint-staged в `package.json`. `pre-commit framework` (Python) не нужен — лишний рантайм для соло-проекта на npm.
- Для `supabase-js` отдельных плагинов не нужно. `eslint-plugin-jsx-a11y` не ставим (нужен только для `jsx-a11y-*` конфигов astro-плагина; вне мягкого минимума).
- Гейт остаётся `npm run build` + preview; `astro check` в хук не кладём (медленно, шумит).

## Точные версии (npm registry на 2026-09-11, `npm view`)

| Пакет | Версия | Роль |
|---|---|---|
| `eslint` | `10.10.0` → ставить `^10.10.0` | ядро, flat config |
| `@eslint/js` | `10.0.1` → `^10.0.1` | `js.configs.recommended` |
| `globals` | `17.12.0` → `^17.12.0` | `browser`/`node` globals для flat config |
| `typescript-eslint` | `8.70.0` → `^8.70.0` | TS-плагин+парсер (рекомендовано вместо `@typescript-eslint/parser` отдельно) |
| `eslint-plugin-astro` | `3.1.0` → `^3.1.0` (peer: `eslint >=10`, `typescript-eslint >=8.61.0`) | парсер `.astro` + `configs.recommended` |
| `eslint-config-prettier` | `10.1.8` → `^10.1.8` | гасит конфликтующие стилистические правила, всегда последним |
| `prettier` | `3.9.6` → `^3.9.6` | форматтер |
| `prettier-plugin-astro` | `1.0.0` → `^1.0.0` (peer: `prettier ^3.5.3`) | парсер `.astro` для Prettier |
| `prettier-plugin-tailwindcss` | `0.8.1` → `^0.8.1` (опционально) | сортировка классов, строго последним плагином |
| `husky` | `9.1.7` → `^9.1.7` | менеджер хуков (`npx husky init`, скрипт `prepare`) |
| `lint-staged` | `17.5.1` → `^17.5.1` | линт только staged-файлов |

TS-совместимость: `typescript-eslint@8.70.0` peer — `typescript >=4.8.4 <6.1.0`, наш `^5.7.3` покрыт.

## Порядок установки

```bash
# 1. ESLint ядро + TS + Astro (dev)
npm i -D eslint@^10.10.0 @eslint/js@^10.0.1 globals@^17.12.0 \
  typescript-eslint@^8.70.0 eslint-plugin-astro@^3.1.0 \
  eslint-config-prettier@^10.1.8

# 2. Prettier
npm i -D prettier@^3.9.6 prettier-plugin-astro@^1.0.0
# Tailwind-сортировка — опционально, но рекомендовано докой Astro:
npm i -D prettier-plugin-tailwindcss@^0.8.1

# 3. Хуки (после того как конфиги лежат в репо)
npm i -D husky@^9.1.7 lint-staged@^17.5.1
npx husky init
```

`husky init` сам допишет `"prepare": "husky"` в `scripts` и создаст `.husky/pre-commit`. Дальше хук правим руками (см. ниже).

## Конфиги (проверенные черновики, не применять в этом тикете)

### `eslint.config.js` (ESM; репо уже `"type": "module"`)

```js
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import eslintPluginAstro from 'eslint-plugin-astro';
import prettier from 'eslint-config-prettier';

export default [
  { ignores: ['dist/**', '.astro/**', 'node_modules/**', 'public/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended, // без type-checked: мягко, без projectService
  ...eslintPluginAstro.configs.recommended,
  {
    rules: {
      // мягкий минимум: шум → warn, бюрократии нет
      '@typescript-eslint/no-unused-vars': 'warn',
      'no-unused-vars': 'off', // гасится в пользу TS-версии
      'no-console': 'off', // соло-пет-проект, логи в гамбе/дебаге ок
    },
  },
  prettier, // последним: выключает стилистические правила в пользу Prettier
];
```

Что сознательно НЕ включаем: `tseslint.configs.recommendedTypeChecked` / `strict` (требуют `projectService`, замедляют, шумят), `astro/jsx-a11y-*` (тянет `eslint-plugin-jsx-a11y`), `astro/all` (по доке — только для тестов плагина, меняется в minor), `no-explicit-any` как error (нет в `recommended`, не добавляем).

### `.prettierrc.mjs`

```js
/** @type {import('prettier').Config} */
export default {
  semi: true,
  singleQuote: true,
  trailingComma: 'es5',
  printWidth: 100,
  plugins: [
    'prettier-plugin-astro',
    'prettier-plugin-tailwindcss', // обязан быть последним
  ],
  overrides: [
    { files: '*.astro', options: { parser: 'astro' } },
  ],
};
```

Порядок плагинов — требование доки Astro + tailwind-плагина: `prettier-plugin-tailwindcss` последний, иначе сортировка классов в `.astro` не срабатывает. `overrides` с `parser: 'astro'` обязателен, иначе `No parser could be inferred for file ... .astro`. Tailwind v4 отдельный `tailwindStylesheet` не требует (авто-детект CSS-импорта); если сортировка не сработает — проверить наличие `src/styles/global.css` в графе импорта.

`.prettierignore`: `dist`, `.astro`, `node_modules`, `public/*.mp3` при необходимости.

### Хуки: `package.json` + `.husky/pre-commit`

```json
{
  "scripts": {
    "prepare": "husky",
    "lint": "eslint .",
    "lint:fix": "eslint . --fix",
    "format": "prettier --write .",
    "format:check": "prettier --check ."
  },
  "lint-staged": {
    "*.{js,mjs,cjs,ts,mts,cts,astro}": ["eslint --fix", "prettier --write"],
    "*.{json,md,css}": ["prettier --write"]
  }
}
```

`.husky/pre-commit`:
```sh
npx lint-staged
```

Без `astro check` в хуке (оставляем его преддеплой-гейту `npm run build` + preview). Без `commitlint`/`commit-msg` хука (бюрократия вне карты).

## Ключевые решения для implement-тикета

1. ESLint 10, не 9 (peerDeps `eslint-plugin-astro@3.1.0` + EOL v9).
2. Без type-aware линтa на первом проходе; `tsconfig.json` (`extends: astro/tsconfigs/strict`) не трогаем, `tsconfig.eslint.json` не создаём.
3. `eslint-config-prettier` строго последним элементом массива.
4. Tailwind-плагин для Prettier — опциональный, но рекомендованный; если даёт шум — выкинуть первым (формат `.astro` от него не зависит).
5. Edge-функции Deno: в скоуп lint-staged не включать (`supabase/functions/**` — отдельный вопрос, см. map.md «Not yet specified»).
6. `justfile`: добавить `lint` / `format` шорткаты при внедрении (требование карты — куда фиксировать итог).

## Источники (первичные)

- Astro docs «Editor setup» (ESLint + Prettier, порядок `prettier-plugin-tailwindcss` последним, `overrides` parser `astro`): https://docs.astro.build/en/editor-setup/
- `eslint-plugin-astro` User Guide (flat config, `configs.recommended`, TS-установка через `typescript-eslint`, a11y требует `eslint-plugin-jsx-a11y`): https://github.com/ota-meshi/eslint-plugin-astro/blob/main/docs/user-guide.md
- `prettier-plugin-astro` README (установка, `overrides`, `astroAllowShorthand`/`astroSkipFrontmatter`): https://github.com/withastro/prettier-plugin-astro
- Husky get-started/how-to (`npx husky init`, `"prepare": "husky"`, `.husky/pre-commit`): https://github.com/typicode/husky/blob/main/docs/get-started.md
- Версии и peerDeps — `npm view` 2026-09-11: eslint 10.10.0 / eslint-plugin-astro 3.1.0 (peer `eslint >=10`, `typescript-eslint >=8.61.0`) / typescript-eslint 8.70.0 (peer `eslint ^8.57||^9||^10`, `typescript >=4.8.4 <6.1.0`) / prettier 3.9.6 / prettier-plugin-astro 1.0.0 (peer `prettier ^3.5.3`) / eslint-config-prettier 10.1.8 / lint-staged 17.5.1 / husky 9.1.7 / @eslint/js 10.0.1 / globals 17.12.0 / prettier-plugin-tailwindcss 0.8.1
- ESLint version support (v9 EOL 2026-08-06, v10 current): https://eslint.org/version-support/
- Tailwind+Astro конфиг-конфликт (оба плагина + `overrides`, tailwind последним): withastro/docs#10877, withastro/astro#15762
