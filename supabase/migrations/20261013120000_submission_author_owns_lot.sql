-- Автор принятой заявки — первый владелец лота (решение — docs/adr/0010).
-- Лот из заявки рождается уже с владельцем-автором: он виден на витрине как
-- «👑 <ник>» (не «свободен»), сразу попадает в «Мои приветы», свой лот забрать
-- нельзя, а первая продажа делает его продавцом — выручку минус комиссию
-- получает он. Лоты админа (сид/`content/lots.toml` без заявки) остаются
-- ничейными: `suggested_by_uid` там пуст, отдельного признака «авторский лот»
-- не заводим — этот RPC к ним не применяется.
--
-- Механику покупки не трогаем: apply_purchase уже платит продавцу и берёт
-- комиссию, когда owner не NULL, поэтому первая продажа авторского лота —
-- обычный перекуп. Награду (pay_submission_reward: +500 и 3% с первых трёх
-- перекупов) тоже не меняем — владение добавляется поверх, а роялти на первой
-- продаже не платится само собой (purchase_count ещё 0, условие 1..3).
--
-- owner_twitch_id не пишем: в RPC его взять неоткуда (в заявке только uid),
-- а клиент эту колонку не читает — владельца показывает owner_login.
-- Применить: мёрж в main применит сам; руками на прод НЕ накатывать.

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

  -- Авторство — навсегда (подпись «Привет добавил»); владение — стартовое:
  -- первый перекуп перепишет owner_*, а suggested_by_* останется.
  -- Аккаунт автора удалён (author_uid null) — владельца-призрака не пишем:
  -- лот остаётся «свободным», как админский; подпись автора берём из снимка.
  update public.lots as l
    set suggested_by_uid = v_uid,
        suggested_by_login = v_author_login,
        owner_uid = case when v_uid is null then l.owner_uid else v_uid end,
        owner_login = case when v_uid is null then l.owner_login else v_author_login end
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
