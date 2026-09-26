# Telegram-уведомления о заявках: настройка и ротация

Новая заявка в `public.submissions` уходит админу в Telegram: `after insert`-триггер `trg_submissions_notify_telegram` → `private.notify_submission_telegram()` (`security definer`) → `net.http_post` (pg_net) в `api.telegram.org/bot<token>/sendMessage`. Токен бота и chat_id функция читает из Supabase Vault, в git они не попадают. Код — миграция `supabase/migrations/20260926140000_submission_telegram.sql`; от человека нужны только секреты.

**Человеческий шаг: агент его выполнить не может** — нет доступа к Telegram-аккаунту владельца и к Vault-секретам. Пока шаг не сделан, уведомления тихо не отправляются; заявки при этом сохраняются.

## Настройка (один раз)

1. В Telegram открыть **@BotFather** → `/newbot` → задать имя и username (username заканчивается на `bot`) → получить токен вида `123456:ABC…`. Токен — пароль бота; в git и в чат его не выкладывать.
2. Открыть `https://t.me/<bot_username>` и нажать **Start** (отправить `/start`). Без этого Telegram ответит `chat not found`: бот не может начать переписку первым.
3. Проверить токен: `https://api.telegram.org/bot<TOKEN>/getMe` → `"ok":true`.
4. Написать боту любое сообщение и открыть `https://api.telegram.org/bot<TOKEN>/getUpdates` → взять `result[].message.chat.id` (личный чат — число; группа/супергруппа — отрицательное, `-100…`). Ориентироваться на последний апдейт; при лишних — отсечь `offset`.
5. Положить оба секрета в **Vault**: Dashboard → Vault → New secret (имя `telegram_bot_token`, затем `telegram_admin_chat_id`). Либо из SQL-редактора:

   ```sql
   select vault.create_secret('<token>', 'telegram_bot_token', 'BotFather token for submission notifications');
   select vault.create_secret('<chat_id>', 'telegram_admin_chat_id', 'Admin chat for submission notifications');
   ```

   Значения в миграцию и репозиторий не писать. Имена фиксированы: функция читает ровно `telegram_bot_token` и `telegram_admin_chat_id`, алиасов нет. Скопированные из BotFather/`getUpdates` значения обрезайте от пробелов и переводов строк: лишний `\n` в токене или chat_id → Telegram ответит `400 Bad Request`, а ретраев нет — сообщение потеряно без следов.

## Проверка живьём

После секретов отправить заявку с витрины вошедшим через Twitch. Админу должно прийти сообщение формата (решение тикета 06):

```
🍺 Заявка #<id>
Название: <title>
От: @<author_login>
Ссылка: <video_url>
💬 <comment>
```

Комментарий — строкой только если он есть; превью ссылки отключено. Доставка видна в `net._http_response`:

```sql
select * from net._http_response order by created desc limit 5;
-- ошибки: where status_code >= 400 or error_msg is not null
```

Успех — `status_code = 200` и `content` с `"ok":true`. Если таблица пуста, а сообщения нет — возможно, лёг воркер pg_net: тогда запрос из очереди не отправляется и сообщение теряется молча. Перезапустить и дождаться готовности:

```sql
select net.worker_restart();
select net.wait_until_running();
```

## Ротация токена

1. @BotFather → `/revoke` (или `/token`) → новый токен.
2. Обновить секрет:

   ```sql
   select vault.update_secret(
     (select id from vault.secrets where name = 'telegram_bot_token'),
     '<new_token>');
   ```

   Либо отредактировать значение в Dashboard → Vault. chat_id при этом не меняется.

3. Проверить новый токен: `https://api.telegram.org/bot<NEW_TOKEN>/getMe` → `"ok":true`. Иначе следующий POST молча вернёт ошибку Telegram.

## Оговорки

- **At-most-once, без ретраев.** pg_net ставит один POST после коммита заявки; если Telegram или сеть моргнут, сообщение теряется — повторных попыток нет by design.
- Ответ хранится 6 часов в `net._http_response`, затем исчезает; `net.http_request_queue` — unlogged.
- **Сбой уведомления не откатывает заявку**, а без секретов функция тихо ничего не делает (только `warning` в логах Postgres) — так локальная разработка не шлёт сообщений.
- Текст ограничен 4096 символами (лимит Telegram), ссылка не разворачивается.
