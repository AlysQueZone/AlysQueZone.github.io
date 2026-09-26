-- Принятие/отказ заявок на привет (спека scratch/suggest-greeting/spec.md,
-- тикет 10). Агент по номеру заявки собирает лот: скачивает видео, готовит
-- медиа-тройку и карточку, публикует её на витрине и связывает с заявкой.
-- Лоту добавляется денормализованное авторство (suggested_by_uid/_login),
-- чтобы подробности лота показывали «Привет добавил: <ник>», не читая чужие
-- заявки (RLS «только свои»); вью цен получает автора привета.
-- Статусы меняет только service_role через RPC; награду за принятие начисляет
-- отдельный тикет (11) — здесь её нет.
-- Вью со сменой состава колонок — только DROP + CREATE (docs/agents/supabase.md).
-- Применить: мёрж в main применит сам; руками на прод НЕ накатывать.

-- 1. Авторство привета на лоте: снимок из заявки в момент принятия.
--    Подпись на карточке — публична. Таблица public.lots читается anon/
--    authenticated, поэтому uid на ней виден так же, как owner_uid, а вью
--    отдаёт только login.
alter table public.lots add column if not exists suggested_by_uid uuid null;
alter table public.lots add column if not exists suggested_by_login text null;

-- 2. Вью цен: зеркало таблицы + автор привета. Формула next_price и остальные
--    колонки — как в 20260910090100; добавлена только suggested_by_login
--    (uid остаётся на таблице: служебные выплаты тикета 11 читают его оттуда).
--    ВАЖНО: только DROP + CREATE (CREATE OR REPLACE падает 42P16 на смене состава).
drop view if exists public.lots_with_next_price;
create view public.lots_with_next_price as
select
  l.slug,
  l.title,
  l.video_url,
  l.price,
  l.owner_login,
  l.owner_uid,
  l.purchase_count,
  l.updated_at,
  l.suggested_by_login,
  least(
    case
      when coalesce(l.purchase_count, 0) < 15
        then greatest(ceil(l.price * 1.1)::bigint, l.price + 1)
      else l.price + 1
    end,
    1000000000
  ) as next_price
from public.lots as l;

alter view public.lots_with_next_price set (security_invoker = true);

revoke all on public.lots_with_next_price from anon, authenticated;
grant select on public.lots_with_next_price to anon, authenticated;
-- DROP VIEW теряет грант service_role из 20260924120000_explicit_grants.sql:
-- выдаём его здесь явно, иначе новая вью останется без гранта для сервиса.
grant select on public.lots_with_next_price to service_role;

-- 3. Принятие: заявка -> status 'accepted', связь с лотом, автор на лоте.
--    RPC только для service_role (вызывает служебный скрипт приёма).
--    Принять можно только открытую заявку ('new'): повторное принятие
--    решённой — ошибка, а не молчаливая перезапись чужого решения
--    (docs/agents/submissions.md). p_author_login — канон ника из реестра
--    ников, который передаёт агент; не null — переопределяет снимок
--    author_login из заявки, null — оставляем снимок (US-24).
--    Награда не начисляется — её добавит тикет 11.
create or replace function public.accept_submission(
  p_submission_id bigint,
  p_lot_id bigint,
  p_author_login text default null
)
returns void language plpgsql
security definer set search_path = ''
as $$
declare
  v_uid uuid;
  v_login text;
  v_status text;
  v_author_login text;
begin
  select s.author_uid, s.author_login, s.status into v_uid, v_login, v_status
    from public.submissions as s
    where s.id = p_submission_id
    for update;
  if not found then
    raise exception 'submission % not found', p_submission_id;
  end if;
  if v_status <> 'new' then
    raise exception 'submission % is not new (status=%)',
      p_submission_id, v_status;
  end if;

  if not exists (select 1 from public.lots as l where l.id = p_lot_id) then
    raise exception 'lot % not found', p_lot_id;
  end if;

  -- Канон ника из реестра важнее снимка: пустой/пробельный канон игнорируем.
  v_author_login := coalesce(nullif(btrim(p_author_login), ''), v_login);

  update public.lots as l
    set suggested_by_uid = v_uid,
        suggested_by_login = v_author_login
    where l.id = p_lot_id;

  update public.submissions as s
    set status = 'accepted',
        lot_id = p_lot_id,
        decided_at = now()
    where s.id = p_submission_id and s.status = 'new';
  if not found then
    raise exception 'submission % is not new (status changed mid-call)',
      p_submission_id;
  end if;
end;
$$;
revoke all on function public.accept_submission(bigint, bigint, text)
  from public, anon, authenticated;
grant execute on function public.accept_submission(bigint, bigint, text) to service_role;

-- 4. Отказ/дубликат: разрешены только эти два статуса, без выплат.
--    Решать можно только открытую заявку ('new'): отклонять принятую нельзя
--    (лот уже на витрине), повторный отказ по решённой — ошибка. Идемпотентным
--    повторный вызов делает клиент (docs/agents/submissions.md), сервер строгий.
create or replace function public.reject_submission(
  p_submission_id bigint,
  p_status text
)
returns void language plpgsql
security definer set search_path = ''
as $$
declare
  v_status text;
begin
  if p_status is null or p_status not in ('rejected', 'duplicate') then
    raise exception 'invalid reject status: % (allowed: rejected, duplicate)', p_status;
  end if;

  select s.status into v_status
    from public.submissions as s
    where s.id = p_submission_id
    for update;
  if not found then
    raise exception 'submission % not found', p_submission_id;
  end if;
  if v_status <> 'new' then
    raise exception 'submission % is not new (status=%)',
      p_submission_id, v_status;
  end if;

  update public.submissions as s
    set status = p_status,
        decided_at = now()
    where s.id = p_submission_id and s.status = 'new';
  if not found then
    raise exception 'submission % is not new (status changed mid-call)',
      p_submission_id;
  end if;
end;
$$;
revoke all on function public.reject_submission(bigint, text)
  from public, anon, authenticated;
grant execute on function public.reject_submission(bigint, text) to service_role;
