# 10: Включить Deploy to production (чеклист, человек)

Status: ready-for-human
Blocked by: none

## What to do

Решение: `scratch/polish-01/issues/01-supabase-deploy-button.md`, ресёрч: `scratch/polish-01/research/01-supabase-deploy-button.md`. Только дашборд + git, кода нет.

1. `supabase db pull` (или `db diff`) — убедиться, что схема продакшена = `supabase/migrations`; закоммитить результат.
2. Проверить идемпотентность `supabase/migrations/20260907110628_seed_real_lots.sql` (повторный apply не дублирует лоты).
3. Supabase Dashboard → Project Settings → Integrations → GitHub: подключить репо, Working directory `.`, production-ветка `main`, ВКЛ **Deploy to production**.
4. GitHub repo settings → required status check от Supabase-интеграции.
5. Тестовый мерж мелкой миграции → workflow зелёный.

## Done when

- [ ] Тумблер ВКЛ, required check стоит, тестовый мерж применился сам.
- [ ] Правило дальше: схему только миграциями; правки из дашборда — сразу через `db pull`.
