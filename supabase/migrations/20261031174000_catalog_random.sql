-- Главная читает случайные приветы выборкой, а не всем каталогом (docs/adr/0012):
-- вью-обёртка над `lots_with_next_price` в случайном порядке, клиент берёт
-- первые N строк. Порядок нужен только для выбора; дальше окно обновляется
-- точечно по slug, как на витрине.
--
-- Гранты — в этой же миграции (Supabase с 30.10.2026 не выдаёт их автоматически);
-- RLS не меняется: security_invoker прозрачно пропускает политики `lots`.
-- Применить: мёрж в main применит сам; руками на прод НЕ накатывать.

create view public.random_lots as
select
  slug,
  title,
  video_url,
  price,
  owner_login,
  owner_uid,
  purchase_count,
  updated_at,
  suggested_by_login,
  next_price
from public.lots_with_next_price
order by random();

alter view public.random_lots set (security_invoker = true);

revoke all on public.random_lots from anon, authenticated;
grant select on public.random_lots to anon, authenticated;
grant select on public.random_lots to service_role;
