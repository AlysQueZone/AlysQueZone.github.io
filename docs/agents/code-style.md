# Стиль кода, импорты, SQL-гайд

Качество: Prettier 3 (+ prettier-plugin-astro, tailwind-плагин последним) + ESLint 10 flat (`recommended`, без type-aware), `eslint-config-prettier` последним; тесты ядра — vitest без DOM (`src/**/*.test.ts`); enforcement — только pre-commit хук (husky: `lint-staged` + `tsc --noEmit` + тесты), без CI; все гейты разом — `just check` (типы, линт, тесты, формат), по отдельности — `just lint` / `just format` / `just test`.

Импорты фронта: `@/`-алиас для межпапочных, относительные внутри папки, без `.ts`-расширений; разметка — SSR, где это возможно (островов `client:*` нет); витрина и страница лота — клиентский рендер из БД обычным скриптом (`docs/adr/0002`); frontmatter — типы/пропсы/данные, разметка без логики.

SQL-гайд: русская шапка-комментарий обязательна; RLS deny-by-default (`revoke all` + точечные политики); нейминг plural/`_idx`/`<table>_<действие>_<скоуп>`.

Простые команды для человека (вроде запуска проекта) — в `justfile`.
