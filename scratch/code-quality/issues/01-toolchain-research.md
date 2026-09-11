Status: resolved
Type: research

## Question

Какой точный набор пакетов и плоского конфита нужен для связки Prettier + ESLint (мягкий минимум) на нашем стеке: Astro 7, TS 5.7, Tailwind 4, supabase-js? Какие плагины (eslint-plugin-astro, @typescript-eslint, prettier-конфиг), какой порядок установки и какие правила оставить включёнными, чтобы было минимум шума для соло-пет-проекта? Учесть отсутствие CI (только pre-commit хуки) и преддеплой-гейт `npm run build` + preview.

## Comments

- Research findings (AFK, не резолвлено): ветка `research/toolchain`, файл `scratch/code-quality/research-toolchain.md` (на той ветке) — ESLint 10 + typescript-eslint + eslint-plugin-astro + eslint-config-prettier, Prettier 3 + prettier-plugin-astro, хуки husky + lint-staged.

## Answer

Принято исследовательское решение: ESLint 10 (flat `eslint.config.js`, `recommended` без type-aware) + Prettier 3 + husky/lint-staged. Ключевые факты: `eslint-plugin-astro@3.1.0` требует ESLint ≥10 (v9 в EOL); prettier-override `parser: astro` обязателен; `prettier-plugin-tailwindcss` строго последним; `astro check` в хук не кладём. Версии перепроверены (`10.10.0` / `3.1.0` / `1.0.0`). Полные черновики конфитов и порядок установки — ветка `research/toolchain`, файл `scratch/code-quality/research-toolchain.md`.
