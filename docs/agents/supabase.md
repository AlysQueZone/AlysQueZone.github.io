# Supabase: схема, RLS, миграции, отладка

Backend-логика — на Supabase, не в клиентском коде; skill `supabase` — на схему/RLS/миграции/отладку.

MCP `supabase` (`opencode.json`) — на все операции: схема, миграции, данные, логи, edge functions.

Deploy to production ВКЛ: мерж в `main` сам применяет миграции. Схему менять только миграциями; правки из дашборда забирать через `db pull`.

Вью со сменой состава/порядка колонок — только через `DROP VIEW + CREATE`: `CREATE OR REPLACE` падает 42P16 и блокирует очередь (кейс 2026-09-10).

`public.lots` — это контент: правится `content/lots.toml` + `scripts/lots_sync.py` (`just lots-sync`), не миграциями. Локальный сид — `supabase/seed.sql` (генерится `just lots-seed`).

## Гранты (Supabase с 30.10.2026)

С 30.10.2026 новые таблицы/вью/последовательности в `public` **не** получают гранты автоматически (default privileges отключены). Миграция, создающая объект, обязана выдать гранты в той же миграции — иначе Data API вернёт `42501 permission denied`, клиентские insert упадут на sequence, а скрипты на `service_role` не увидят таблицу.

Шаблон для новой таблицы (права роли — по минимуму, но `service_role` и sequence — всегда):

```sql
revoke all on public.t from anon, authenticated;
grant select on public.t to anon;                                 -- по минимуму роли
grant select, insert, update, delete on public.t to authenticated; -- по минимуму роли
grant select, insert, update, delete on public.t to service_role;  -- всегда
grant usage, select on sequence public.t_id_seq                   -- если identity
  to anon, authenticated, service_role;

alter table public.t enable row level security;
-- + create policy ...
```

`auto_expose_new_tables = false` в `supabase/config.toml` — локальный dev повторяет облако, пропуск гранта падает сразу. Существующие объекты гранты сохраняют; явные гранты для них — `20260924120000_explicit_grants.sql`.
