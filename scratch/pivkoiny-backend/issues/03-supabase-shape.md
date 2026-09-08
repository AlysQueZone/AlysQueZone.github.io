Status: resolved
Type: research
Blocked by: 01, 02

## Question

Как выдуманное из тикетов 01–02 реализуется на supabase без своего сервера? Баланс на Supabase Auth UID (решено), стартовые 1000, ежедневный вход, ставка/спин гамбы, списание/начисление при покупке/перекупе, актуальная цена для кнопки перекупа.

Раскопать: таблицы (балансы vs ledger/appends), где считать исход спина (RPC/Edge Function vs триггер), RLS на каждую exposed-таблицу, защита от двойных трат и подкрутки шансов, как отдать цену (select + Realtime), порядок миграций. Учесть правило репо: схему только миграциями, мёрж в main сам применяет миграции, бэкенд-логика на supabase, не в клиенте.

Ассет: ветка `research/supabase-shape`, набросок схемы/политик/порядка миграций + ссылки на доки.

## Comments

- 2026-09-08: факты в ветке `research/supabase-shape`, файл
  `scratch/pivkoiny-backend/research/supabase-shape.md` (набросок, не применять).
  Суть: ledger append-only = истина + `profiles.balance` кэш (старт 1000 триггером
  на auth.users); спин — RPC `spin_gamba` (RNG+дебет/кредит в одной транзакции,
  идемпотентность unique-ключом), не триггер/Edge; покупка — расширить текущие
  BEFORE/AFTER-триггеры проверкой баланса и ledger-записями; RLS+гранты на каждую
  таблицу (`TO anon/authenticated`, SELECT-своё, записи денег клиенту нет);
  цена — `lots_with_next_price.next_price` + Realtime; миграции: profiles →
  ledger → spins/RPC → daily/RPC → purchase-money → price-feed, каждая с тестом.

## Answer

Принято как основание для спеки и тикета цены перекупа. Проверено: набросок следует правилам репо (`TO anon/authenticated` вместо `auth.role()`, `SECURITY DEFINER` с `SET search_path`, `REVOKE` лишних грантов, `service_role` не в браузере, схема только миграциями, realtime-публикация), согласуется с живым бэком (`lots`/`purchases`, `enforce_purchase_rules`/`apply_purchase` — расширяются, не переписываются). Решения, зафиксированные здесь: ledger append-only — истина, `profiles.balance` — серверный кэш с инвариантом `balance = SUM(amount)`; спин — RPC, не триггер и не Edge Function (атомарность в одной транзакции, без cold start); покупка — дебет/кредит в существующих триггерах (перекуп остаётся перераспределением, sink'а нет); цена и баланс — свежий select + Realtime-подписка, `data-lot-price` с рендера больше не авторитет; гости видят только публичное (lots/колесо), деньги — `TO authenticated`. Порядок миграций: profiles → ledger → spins/RPC → daily/RPC → purchase-money → price-feed, каждая с RLS-тестом; перед мёржем — `supabase test db`, advisors, симуляция RTP. Детали, SQL-набросок и 7 первичных источников — в ветке `research/supabase-shape`. Открытое (не здесь): поведение гостей/офлайна, миграция старых localStorage-балансов — туман карты.
