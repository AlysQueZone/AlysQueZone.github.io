-- Telegram-уведомление о новой заявке (спека scratch/suggest-greeting/spec.md,
-- тикет 09; решения — тикеты 01 и 06).
-- Путь: after insert на public.submissions -> security definer функция в
-- непубличной схеме private -> net.http_post (pg_net) в
-- api.telegram.org/bot<token>/sendMessage. Токен бота и chat_id функция читает
-- из Supabase Vault, в git они не попадают; runbook настройки и ротации —
-- docs/agents/telegram-notify.md.
-- Доставка at-most-once, без ретраев: pg_net ставит один запрос после коммита,
-- ответ живёт 6 часов в net._http_response. Сбой уведомления не откатывает
-- заявку: тело функции обёрнуто в exception; без секретов — тихий no-op.
-- Применить: мёрж в main применит сам; руками на прод НЕ накатывать.

-- 0. pg_net: транспорт под триггером (в проекте доступен, но не установлен).
-- Расширение само создаёт схему net и вызывается как net.http_post.
create extension if not exists pg_net with schema extensions;

-- 1. Непубличная схема для секреточитающей функции: через Data API не видна,
-- из клиента не вызывается.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to postgres;

-- 2. AFTER INSERT: собрать сообщение и поставить POST в очередь pg_net.
-- security definer — иначе чтение vault.decrypted_secrets упадёт на правах
-- вставляющего чатерса; set search_path = '' — защита от подмены объектов.
create or replace function private.notify_submission_telegram()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token text;
  v_chat text;
  v_text text;
begin
  v_token := (select decrypted_secret from vault.decrypted_secrets
                where name = 'telegram_bot_token' limit 1);
  -- Канонично — telegram_admin_chat_id (research/решения); telegram_chat_id — алиас.
  v_chat := coalesce(
    (select decrypted_secret from vault.decrypted_secrets
       where name = 'telegram_admin_chat_id' limit 1),
    (select decrypted_secret from vault.decrypted_secrets
       where name = 'telegram_chat_id' limit 1));

  -- Локально/не настроено: уведомление тихо молчит, заявка сохраняется.
  if v_token is null or v_chat is null then
    raise warning 'telegram notify: secrets are not configured';
    return new;
  end if;

  -- Формат из тикета 06; #id первым — админ пересылает номер агенту.
  v_text := format('🍺 Заявка #%s', new.id)
    || E'\n' || format('Название: %s', new.title)
    || E'\n' || format('От: @%s', new.author_login)
    || E'\n' || format('Ссылка: %s', new.video_url);
  -- Комментарий — строкой, только если он есть.
  if new.comment is not null and btrim(new.comment) <> '' then
    v_text := v_text || E'\n' || '💬 ' || new.comment;
  end if;

  perform net.http_post(
    url := 'https://api.telegram.org/bot' || v_token || '/sendMessage',
    body := jsonb_build_object(
      'chat_id', v_chat,
      'text', left(v_text, 4096),  -- лимит Telegram
      'link_preview_options', jsonb_build_object('is_disabled', true)
    ),
    timeout_milliseconds := 5000
  );

  return new;
exception when others then
  -- Сбой отправки не должен откатывать заявку пользователя.
  raise warning 'telegram notify failed: %', sqlerrm;
  return new;
end;
$$;

-- Функция не RPC: через Data API недоступна.
revoke execute on function private.notify_submission_telegram()
  from public, anon, authenticated;

create trigger trg_submissions_notify_telegram
  after insert on public.submissions
  for each row execute function private.notify_submission_telegram();
