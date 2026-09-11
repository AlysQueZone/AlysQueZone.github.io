## Destination

В репо внедрён тулчейн качества кода (Prettier + мягкий ESLint + pre-commit хуки, без CI) и зафиксированы гайды (TS-стайлгайн, архитектура фронта, SQL-гайд); существующий код приведён в соответствие.

## Notes

- Домен: pet-проект AlysQueZone, соло. Стек: Astro 7 + TS + Tailwind 4 + Supabase (миграции применяются очередью при мерже в main, edge на Deno).
- Standing preferences (решено при чартинге, не перерешать): форматтер — Prettier; строгость — мягкий минимум (форматтер + базовый линт на ошибки, без бюрократии); enforcement — только локальные хуки, без CI; скоуп включает TS-стайлгайд, архитектуру фронта, SQL-гайд.
- Skills каждой сессии: grilling + domain-modeling для HITL-тикетов; research для AFK-тикета. Глоссарий — CONTEXT.md (чатерс/стример/привет/лот/пивкойн/гамба, не ломать термины в гайдах).
- Wayfinder override: эта карта INCLUDES execution — финальный task-тикет внедряет тулчейн в репо, а не только решает.

## Decisions so far

<!-- the index: one line per closed ticket, enough to judge relevance, then zoom the link for the detail the ticket holds -->

- [Исследование тулчейна](issues/01-toolchain-research.md): ESLint 10 flat + Prettier 3 + husky/lint-staged, только recommended, без type-aware и без astro check в хуке.
- [Гайд фронта](issues/02-frontend-guide.md): `@/` межпапочно + extensionless, распил outbid-notice.ts, SSR-first и frontmatter-конвенции компонентов.
- [SQL-гайд](issues/03-sql-guide.md): обязательная русская шапка миграции, RLS deny-by-default, фиксированный нейминг (plural/idx/policy).
- [Внедрение тулчейна](issues/04-implement-toolchain.md): Prettier 3 + ESLint 10 + husky/lint-staged внедрены, код приведён, гейты зелёные.

## Not yet specified

- Объём правок существующего кода при применении (что автофиксится, что правится руками, где нужны подавления).
- Куда фиксировать итог: AGENTS.md (краткие решения), justfile (команды lint/format), README (если нужно человеку).
- Deno fmt для edge-функций отдельно или единый Prettier — решить по ходу SQL/архитектурных тикетов.
- Будущий CI-гейт (GitHub Actions) — заведомо за пределами этой карты, вернуться отдельной effort'ой.

## Out of scope

- CI-enforcement (GitHub Actions): при чартинге выбран вариант «только хуки» — CI не делаем в этой карте.
- Строгий линт (no-explicit-any и т.п. как обязательные): при чартинге выбрана мягкая строгость.
- Переезд на Biome / Deno fmt как основной форматтер: при чартинге выбран Prettier.
