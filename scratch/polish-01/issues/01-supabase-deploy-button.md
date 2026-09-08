# Кнопка Deploy to production в Supabase: включать ли

Type: research
Status: resolved
Blocked by: none

## Question

В дашборде Supabase есть кнопка «Deploy to production: Apply changes to your production database when you merge into your configured production GitHub branch». Человек спрашивает: стоит ли её включить? Будет ли она применять миграции, если они не были применены вручную (CLI `db push` / SQL Editor)? Что именно она делает под капотом (какая ветка считается production, что триггерит apply, что будет с дрейфом схемы и сидом реальных лотов), какие риски для нашего флоу (миграции правим руками, сид уже применён через Editor, бюджета 0₽, всё — статика без своего сервера)? Итог — решение включать/не включать + чеклист безопасного состояния.

## Comments

- 2026-09-07: research-субсессия отработала, вердикт — ВКЛЮЧАТЬ после чеклиста (да, неприменённые миграции применит сама; сид-миграция `seed_real_lots` применится как миграция, проверить идемпотентность; главный риск — дрейф от ручных правок через Editor). Полные факты + чеклист: `scratch/polish-01/research/01-supabase-deploy-button.md`. Тикет не закрыт — решение за ведущей сессией.
- 2026-09-07 (resolution): решение зафиксировано — ВКЛЮЧАТЬ после чеклиста, закрыто ведущей сессией.

## Answer

Да, кнопка применяет неприменённые вручную миграции сама — в этом её смысл. При push/merge в настроенную GitHub production-ветку (обычно `main`) Supabase прогоняет workflow Clone → Pull → Health → Configure → Migrate → Seed → Deploy и применяет только новые миграции из `supabase/migrations` + функции/бакеты из `config.toml`; API/Auth/seed-файлы игнорируются. Production со стороны Supabase — всегда базовый проект, со стороны GitHub — ветка в настройках интеграции.
Решение: ВКЛЮЧАТЬ (бесплатно, нашему флоу статики без сервера подходит), но только после чеклиста: (1) `db pull`/`db diff` — убрать дрейф от ручных правок через Editor, закоммитить; (2) проверить `20260907110628_seed_real_lots.sql` на идемпотентность (это миграция, не seed — применится); (3) подключить GitHub-интеграцию, Working directory `.`, production-ветка `main`, включить тумблер; (4) включить required status check в GitHub; (5) тестовый мерж мелкой миграции; (6) дальше схему менять только миграциями, правки из дашборда сразу забирать через `db pull`. Источники: `supabase.com/docs/guides/deployment/branching/github-integration`, `.../branching`, `.../going-into-prod`, `.../branching/troubleshooting`. Полные факты — `scratch/polish-01/research/01-supabase-deploy-button.md`.
