# Стиль кода, импорты, SQL-гайд

Качество: Prettier 3 (+ prettier-plugin-astro, tailwind-плагин последним) + ESLint 10 flat (`recommended`, без type-aware), `eslint-config-prettier` последним; enforcement — только pre-commit хук (`husky + lint-staged`), без CI; команды `just lint` / `just format`.

Импорты фронта: `@/`-алиас для межпапочных, относительные внутри папки, без `.ts`-расширений; разметка — SSR, где это возможно (островов `client:*` нет); витрина и страница лота — клиентский рендер из БД обычным скриптом (`docs/adr/0002`); frontmatter — типы/пропсы/данные, разметка без логики.

SQL-гайд: русская шапка-комментарий обязательна; RLS deny-by-default (`revoke all` + точечные политики); нейминг plural/`_idx`/`<table>_<действие>_<скоуп>`.

Простые команды для человека (вроде запуска проекта) — в `justfile`.
