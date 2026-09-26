-- Метка «уведомление о принятии показано» (спека scratch/suggest-greeting/spec.md,
-- тикет 12). Клиент при заходе показывает всплывашку по своим принятым заявкам
-- и сразу гасит её server-side: notified_at = now() только для своих
-- (author_uid = auth.uid()) и только для status = 'accepted'. Чужие и
-- неподходящие id молча игнорируются — подтверждать чужие строки нечего.
-- Метка серверная, поэтому повтор не всплывает ни при перезагрузке, ни на
-- другом устройстве; если RPC не прошёл (офлайн) — уведомление вернётся
-- в следующий заход. localStorage не используется.
-- Применить: мёрж в main применит сам; руками на прод НЕ накатывать.

-- Пометить заявки как «уведомление показано», вернуть число помеченных.
-- security definer: RLS таблицы запрещает клиенту update — его делает функция
-- от имени владельца, но строго в пределах auth.uid() и только для accepted.
create or replace function public.mark_submissions_notified(p_ids bigint[])
returns integer language plpgsql
security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_count integer := 0;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;
  if p_ids is null or array_length(p_ids, 1) is null then
    return 0;
  end if;

  update public.submissions as s
    set notified_at = now()
    where s.id = any (p_ids)
      and s.author_uid = v_uid
      and s.status = 'accepted'
      and s.notified_at is null;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.mark_submissions_notified(bigint[])
  from public, anon, authenticated;
grant execute on function public.mark_submissions_notified(bigint[]) to authenticated;