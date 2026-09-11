Status: resolved
Type: task
Blocked by: 01, 02, 03

## Question

Внедрить решённое: установить Prettier + мягкий ESLint, настроить pre-commit хуки (только локально, без CI), добавить команды в justfile, прогнать форматтер/линтер по репо и зафиксировать решения в AGENTS.md. Объём ручных правок и подавлений уточняется по итогам тикетов 01–03.

## Answer

Внедрено и проверено: Prettier 3 + ESLint 10 flat (recommended, `eslint-config-prettier` последним) + husky/lint-staged (`npx lint-staged` в pre-commit); скрипты `lint/lint:fix/format/format:check`, `just lint`/`just format`; импорты `@/` межпапочно + extensionless; `outbid-notice.ts` 512→357 строк (+`outbid-event/sound/notices`); 3 мёртвых присваивания (`no-useless-assignment`) починены; `tsc/eslint/prettier --check/build` зелёные, главная в preview рендерится. Legacy-прототипы и chat-JSON исключены из Prettier (`.prettierignore`), их переформатирование откачено. Решения зафиксированы в AGENTS.md.
