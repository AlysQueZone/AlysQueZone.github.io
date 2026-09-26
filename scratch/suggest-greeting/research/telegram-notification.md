# Уведомление админа в Telegram: транспорт, секреты, деплой

Research к тикету `01-telegram-transport` (карта `scratch/suggest-greeting/map.md`).

## Вывод коротко

- **Рекомендую DB-нативный путь: `after insert`-триггер на таблице заявок → `security definer`-функция в
  непубличной схеме → `net.http_post` (pg_net) прямо в `api.telegram.org/bot<token>/sendMessage`.** Токен и
  chat_id лежат в Supabase Vault (уже включён в проекте), в git не попадают. Один HTTP POST, ноль новых
  артефактов деплоя: всё уезжает обычной миграцией из `main`.
- **Database Webhook «напрямую» в Telegram не годится**: тело запроса фиксировано (`{type, table, schema,
record, old_record}`), а Telegram ждёт `chat_id` и `text`. Собрать сообщение с id заявки невозможно, а токен
  пришлось бы положить в URL триггера открытым текстом.
- **Edge Function + Database Webhook — рабочий второй вариант**, но добавляет ручной деплой без CI
  (`supabase functions deploy` / MCP), отдельное хранилище секретов и auth-обвязку; выигрывает только если
  логика вырастет за пределы одного POST (ретраи с разбором `retry_after`, форматирование, вторая интеграция).
- **Ретраев нет ни у одного варианта из коробки.** Database Webhooks — это обёртка над pg_net, а pg_net шлёт
  запрос один раз (async, после коммита) и хранит ответ 6 часов. Идемпотентности тоже нет: она либо не нужна
  (одна вставка — одно сообщение), либо делается полем-флагом + cron-бэкстопом (см. §5.3).
- Человеку при настройке: @BotFather `/newbot` → токен; **обязательно** написать боту `/start` (бот не может
  начать переписку первым); `getUpdates` → `chat_id`; оба значения — в Vault, не в git (§4).
- Telegram-лимиты для одного админского чата не проблема: 1 сообщение/сек на чат, ~30/сек суммарно; при
  превышении — 429 с `retry_after`.

## 1. Что именно умеет «Database Webhook»

Database Webhook в Supabase — это не отдельный сервис, а **обёртка над триггером + pg_net** (так и написано в
доках). Из исходника `docker/volumes/db/webhooks.sql` (schema `supabase_functions`) видно всё устройство:

- Создать можно из Dashboard (Database → Webhooks; в отладке фигурирует путь `/database/hooks`) **или из SQL**:

  ```sql
  create trigger "my_webhook" after insert
  on "public"."my_table" for each row
  execute function "supabase_functions"."http_request"(
    'https://example.com', 'POST',
    '{"Content-Type":"application/json"}', '{}', '5000'
  );
  ```

- Аргументы `http_request(url, method, headers, params, timeout_ms)`; `params` — query-параметры URL, тело для
  POST **всегда** формируется из строки:
  `{"old_record":…, "record":…, "type":"INSERT|UPDATE|DELETE", "table":…, "schema":…}`. Кастомизировать тело
  или подставить значение из строки нельзя.
- Вызов асинхронный: `net.http_post` только ставит запрос в очередь, отправка — после коммита транзакции.
- Аудит: каждая сработка пишет строку в `supabase_functions.hooks` (`hook_table_id`, `hook_name`,
  `request_id`); результат — в `net._http_response`.
- **Ретраев нет**: `http_request` делает ровно один вызов и сохраняет `request_id`. Ошибку можно увидеть
  только глазами в `net._http_response` (6 часов).
- Только `GET`/`POST`; таймаут по умолчанию в функции — 1000 мс (в форме Studio — 5000 мс). Для вызова Edge
  Function с холодным стартом 1000 мс мало — задавать явно 5000.
- Локально URL до вашего хоста — `host.docker.internal`, иначе `localhost` указывает на контейнер БД.
- **CLI-команды для вебхуков нет** (в справочнике CLI есть только functions/secrets/db/…): либо Dashboard, либо
  SQL-миграция. Если создать из Dashboard — это обычный триггер, и по правилу проекта его потом придётся
  забирать через `db pull`; чище сразу миграцией.

## 2. pg_net: транспорт под капотом

- `net.http_post(url, body jsonb, params, headers, timeout_milliseconds default 2000)` — асинхронно, **из
  триггеров безопасно** (не держит транзакцию на время сети).
- Запросы ждут в `net.http_request_queue` (unlogged, удаляются после выполнения), ответы — в
  `net._http_response` (unlogged, TTL 6 часов): `status_code`, `content`, `error_msg`, `timed_out`.
- Ограничения: только JSON-POST (нет PUT/PATCH), ~200 запросов/сек, unlogged-таблицы теряются при жёстком
  падении инстанса, дефолтный таймаут 2000 мс. Один POST на заявку — с огромным запасом.
- Ретраев нет by design: README pg_net прямо говорит «в `_http_response` не хватает данных, чтобы повторить
  запрос» и предлагает свою таблицу-трекер + функцию-обёртку для ручных повторов.
- Диагностика: `select * from net._http_response where status_code >= 400 or error_msg is not null order by
created desc;`, перезапуск воркера — `select net.worker_restart();`. Нельзя вешать триггеры на таблицы
  `net.*` (риск бесконечного цикла).

## 3. Сравнение вариантов

| #   | Вариант                                     | Кто триггерит                           | Где секреты                                  | Деплой без CI                                        | Ретраи                                               | Стоимость/лимиты                       | Сложность             |
| --- | ------------------------------------------- | --------------------------------------- | -------------------------------------------- | ---------------------------------------------------- | ---------------------------------------------------- | -------------------------------------- | --------------------- |
| A   | Триггер + pg_net + Vault (**рекомендую**)   | `after insert` на заявках, своя функция | Vault (шифровано, не в git)                  | обычная миграция из `main`                           | нет (опц. cron-бэкстоп)                              | бесплатно (ресурсы БД), 200 rps        | средняя               |
| B   | Database Webhook → Edge Function → Telegram | тот же триггер                          | Edge Function secrets                        | `supabase functions deploy` + `secrets set` (руками) | нет на уровне платформы; можно кодить внутри функции | 500K вызовов/мес на Free, дальше $2/1M | выше средней          |
| C   | Database Webhook → Telegram напрямую        | триггер                                 | токен в URL триггера (плейнтекст в БД и git) | —                                                    | нет                                                  | —                                      | —                     |
| D   | `pg_cron` + pg_net (поллинг, без вебхука)   | cron раз в N минут                      | Vault                                        | миграция (+ включить pg_cron)                        | да, at-least-once с задержкой до минуты              | бесплатно                              | средняя               |
| E   | Queues (pgmq) + консьюмер                   | триггер enqueue                         | у консьюмера (Edge secrets)                  | куча деталей                                         | гарантированная доставка в очередь, но не в Telegram | бесплатно                              | высокая               |
| F   | GitHub Actions cron + `curl`                | расписание                              | repo secrets                                 | требует CI, которого нет                             | best-effort (GH cron)                                | бесплатно                              | низкая, но чужеродная |

### A. Триггер + pg_net + Vault — рекомендация

Поток: клиент делает `insert` в таблицу заявок под RLS → в той же транзакции срабатывает `after insert`
триггер → `security definer`-функция читает `telegram_bot_token` и `telegram_admin_chat_id` из
`vault.decrypted_secrets`, собирает текст и вызывает `net.http_post`. Запрос уходит после коммита.

- **Секреты**: Vault. `supabase_vault` **уже установлен** в проекте (проверено MCP: версия 0.3.1, схема
  `vault`), гранты на `vault.secrets`/`vault.decrypted_secrets`: `postgres` — всё, `service_role` — select,
  `anon`/`authenticated` — ничего. Значит триггерной функции нужен `security definer` (владелец — `postgres`),
  иначе чтение секрета упадёт на правах вставляющего. Функцию держим в непубличной схеме (`private`) с
  `set search_path = ''`, `revoke all … from public` — иначе `security definer` в `public` станет публичным
  RPC-эндпоинтом.
- **Деплой**: миграция `create extension if not exists pg_net with schema extensions` + функция + триггер.
  Ничего не компилируется и не публикуется отдельно; локальный стек включает pg_net, так что поведение
  повторяется.
- **Надёжность**: at-most-once. Если Telegram/сеть моргнули — сообщение потеряно; смотреть
  `net._http_response` и `net.http_request_queue`. Если потеря недопустима — §5.3.
- **Почему не бросать эту логику в клиент**: токен в браузере — прямой запрет тикета; здесь секрет вообще не
  покидает БД.

### B. Edge Function + Database Webhook

Поток: `insert` → Database Webhook `supabase_functions.http_request` → POST на
`https://<ref>.supabase.co/functions/v1/telegram-notify` с payload-ом строки → функция в Deno читает
`TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` из Edge Function secrets и делает `fetch` в Telegram.

- **Секреты**: Edge Function secrets (`supabase secrets set` / Dashboard / MCP секреты не ставит — только
  CLI/Dashboard). Локально — `supabase/functions/.env` (корневой `.gitignore` уже игнорирует `.env` на любом
  уровне; в `supabase/.gitignore` его нет — проверить, что файл не попадёт в индекс).
- **Деплой**: `supabase functions new telegram-notify` → код → `supabase functions deploy telegram-notify
--project-ref <ref>` (CLI сам падает на API-деплой без Docker, есть явный `--use-api`) + `supabase secrets
set`. Альтернативы: редактор функций в Dashboard; MCP-инструмент `deploy_edge_function` (в проекте уже
  подключён MCP с фичей `functions`). Без CI каждый редеплой — ручное действие, код функции может «застыть».
- **Auth**: с 2026 новые `sb_secret_*`-ключи — не JWT; канонический паттерн для служебных вызовов —
  `[functions.telegram-notify] verify_jwt = false` + `withSupabase({ auth: 'secret' })` внутри функции. Ключ в
  заголовке вебхука: если хочется не хардкодить, придётся отказаться от managed-вебхука и делать свой триггер
  с чтением ключа из Vault (то есть половина преимуществ варианта B исчезает).
- **Лимиты**: 256 МБ памяти, wall-clock 150с Free / 400с Paid, CPU 2с, до 100 функций на Free, до 100 секретов
  по 48 КиБ, имена секретов не с `SUPABASE_`.
- **Когда брать**: логика больше одного POST (обработка 429/`retry_after`, богатое форматирование, веер
  уведомлений), или команда хочет писать на TS, а не на SQL.

### C. Database Webhook напрямую в Telegram — мимо

Тело фиксировано записью таблицы, а `sendMessage` требует `chat_id` и `text`. Через `params` можно передать
только статические query-параметры — получится фиксированная строка «новая заявка» без id, по которой админ не
запустит агента. Плюс токен жил бы в URL триггера (`pg_trigger.tgargs`) — в БД и в миграции открытым текстом.
Даже если технически Telegram примет POST с query-параметрами, схема нерелевантна.

### D. pg_cron + pg_net (бэкстоп или самостоятельный вариант)

Раз в N минут выбирать заявки без `notified_at`, слать, помечать. Даёт де-факто ретраи (at-least-once, ценой
возможных дублей и задержки до минуты). `pg_cron` в проекте **не установлен** (доступен 1.6.4): включить через
Dashboard (Integrations → Cron) или `create extension pg_cron` миграцией; джобы из миграции выполнятся от
`postgres` и смогут читать Vault. Лучше как страховка к A, а не как основной путь: поллинг ради одной заявки —
лишнее состояние.

### E. Queues (pgmq)

Очередь гарантирует доставку **до консьюмера**, но консьюмер (Edge Function по крону или внешний воркер) сам
делает POST в Telegram и хранит токен — то есть E = D/B + лишняя сущность. `pgmq` не установлен (доступен
1.5.1; в changelog отмечен breaking change по `delay`). Для одного POST — оверкилл.

### F. GitHub Actions

В проекте нет CI; заводить его ради уведомления — против текущего уклада (и cron у GitHub best-effort). Не
рекомендую.

## 4. Инструкция человеку: бот и chat_id

1. В Telegram открыть **@BotFather** → `/newbot` → задать имя и username (должен заканчиваться на `bot`) →
   получить токен вида `123456:ABC…`. Токен = пароль бота; хранить только в секретах, не в git.
2. Открыть `https://t.me/<bot_username>` и нажать **Start** (отправить `/start`). Иначе Telegram вернёт
   `chat not found` — **бот не может начать переписку первым**: «Bots can't start conversations with users. A
   user must either add them to a group or send them a message first».
3. Проверить токен: `https://api.telegram.org/bot<TOKEN>/getMe` (ответ `"ok":true`).
4. Написать боту любое сообщение и открыть `https://api.telegram.org/bot<TOKEN>/getUpdates` → взять
   `result[].message.chat.id` (для личного чата — число, для группы/супергруппы — отрицательное, `-100…`).
   Если апдейтов много — ориентироваться на последний; `offset` при необходимости отсекает старые.
5. Положить значения в **Vault** (Dashboard → Vault, или из SQL-редактора/MCP):
   ```sql
   select vault.create_secret('<token>', 'telegram_bot_token', 'BotFather token for request notifications');
   select vault.create_secret('<chat_id>', 'telegram_admin_chat_id', 'Admin chat for request notifications');
   ```
   Значения в миграции не писать — они не должны попасть в git и в `supabase_migrations`.
6. Ротация: при утечке — @BotFather `/revoke` (новый токен) → `select vault.update_secret(<id>, '<new>');`
   Либо наоборот: в Dashboard Vault отредактировать значение.

Для варианта B вместо шага 5: `supabase secrets set TELEGRAM_BOT_TOKEN=… TELEGRAM_ADMIN_CHAT_ID=…` (и
`supabase/functions/.env` локально).

## 5. Рекомендуемая схема (вариант A)

### 5.1 Скелет миграции (без секретов)

```sql
-- Telegram-уведомление о новой заявке: pg_net + Vault.
-- Секреты создаются вручную в Vault, в миграции их нет.
create extension if not exists pg_net with schema extensions;

create schema if not exists private;
revoke all on schema private from anon, authenticated;
grant usage on schema private to postgres;

create or replace function private.notify_telegram_new_request()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token text := (select decrypted_secret from vault.decrypted_secrets
                    where name = 'telegram_bot_token');
  v_chat  text := (select decrypted_secret from vault.decrypted_secrets
                    where name = 'telegram_admin_chat_id');
  v_text  text;
begin
  if v_token is null or v_chat is null then
    raise warning 'telegram secrets are not configured';
    return new;
  end if;

  v_text := format('Новая заявка %s от %s: %s', new.public_id, new.sender_nick, new.title);

  begin
    perform net.http_post(
      url := 'https://api.telegram.org/bot' || v_token || '/sendMessage',
      body := jsonb_build_object(
        'chat_id', v_chat,
        'text', left(v_text, 4096),
        'link_preview_options', jsonb_build_object('is_disabled', true)
      ),
      timeout_milliseconds := 5000
    );
  exception when others then
    -- сбой уведомления не должен откатывать заявку пользователя
    raise warning 'telegram notify failed: %', sqlerrm;
  end;

  return new;
end;
$$;

revoke all on function private.notify_telegram_new_request() from public;

create trigger requests_notify_telegram
  after insert on public.requests
  for each row execute function private.notify_telegram_new_request();
```

Имена и поля `new.*` — условные: схема заявок появится в тикете 05. Важно: `security definer` здесь
оправдан (чтение Vault от имени `postgres`), `search_path = ''` + непубличная схема закрывают побочные
эффекты.

### 5.2 Локальная разработка

- pg_net есть в локальном стеке; миграция создаст триггер и локально. Чтобы тестовые вставки **не** летели
  админу, в локальном Vault секретов просто нет — функция сработает как no-op c `warning`. Для сквозной
  проверки — отдельный тестовый бот и `vault.create_secret` в локальной БД.
- Проверка результата в обоих контурах: `select * from net._http_response order by created desc limit 5;`
  (локально — Studio/SQL, в проде — Dashboard/MCP).

### 5.3 Ретраи и идемпотентность (если решим усилить)

Дефолт — at-most-once. Если потеря сообщения неприемлема, добавить в таблицу заявок `notified_at timestamptz`
и `notify_request_id bigint`, проставляемые триггером, плюс cron-джобу: раз в 1–5 минут повторно слать те
заявки, где `notified_at is null or notify_request_id` отсутствует/с ошибкой в `net._http_response`. Перед
отправкой — атомарный «клейм» (`update … set notified_at = now() where id = … and notified_at is null
returning …`), чтобы вебхук и cron не отправили дубль. Это осознанный шаг «at-most-once → at-least-once»;
в спеку его можно не тащить, пока не решим, что потеря недопустима.

## 6. Риски

- **Утечка токена**: в обоих вариантах токен уходит в URL `api.telegram.org` (так устроен Bot API) и
  оказывается в памяти/логах запроса. В A он на короткое время виден в `net.http_request_queue` (unlogged,
  чистится после отправки; схема `net` не отдаётся через Data API), в B — только в окружении функции. Через
  браузер токен не проходит ни в одном из вариантов. Ротация — @BotFather `/revoke`.
- **Спам уведомлений**: дубликаты заявок (клиент дважды нажал) → два сообщения; анти-спам и дедуп ссылок —
  отдельный сюжет карты (Not yet specified). Ручных повторов не будет, пока не включим §5.3.
- **Потеря уведомления**: нет ретраев; жёсткое падение инстанса может съесть unlogged-очередь; Free-проект
  засыпает после недели неактивности (для живого сайта не актуально). Лечение — §5.3.
- **Telegram-лимиты**: на один чат >1 сообщения/сек не слать; 429 приходит с `retry_after` — в A разобрать
  его некому, но при одной заявке на заявку это нереально. Формат: текст 1–4096 символов, длинные ссылки/NSFW
  не разворачивать (`link_preview_options`).
- **Падение триггера ломает insert**: обернуть вызов в `exception`/null-проверку (в скелете есть), иначе
  ошибка уведомления откатит заявку пользователя.

## 7. Что уходит в спеку

- Транспорт (вариант A) и почему; альтернатива B зафиксирована с условием пересмотра.
- Состав миграции: `pg_net` в `extensions`, схема `private`, `security definer` функция с `search_path=''`,
  `after insert` триггер на таблице заявок, защита от сбоя уведомления (не откатывать заявку).
- Секреты: имена `telegram_bot_token`, `telegram_admin_chat_id`, место — Vault, в гит не попадают; runbook
  настройки/ротации (§4).
- Семантика доставки: at-most-once, async после коммита, диагностика через `net._http_response`; решение о
  cron-бэкстопе — отдельным пунктом (по умолчанию нет).
- Формат сообщения: человекочитаемый id заявки, название/ссылка, комментарий, ник отправителя; лимит 4096.
- Требование к человеку: один раз нажать `/start` у бота.
- Локальный dev: без секретов в локальном Vault уведомления не уходят; для E2E — тестовый бот.

## Что не удалось проверить

- Ничего не запускал вживую: ни вставки с триггером, ни реального `net.http_post`, ни отправки в Telegram,
  ни деплоя Edge Function. Только документация, исходники и каталог прод-проекта (через MCP: расширения и
  гранты).
- Формулировки «ретраев нет» в доках Database Webhooks нет; вывод сделан из исходника
  `supabase_functions.http_request` (один `net.http_post`) и README pg_net («данных для повтора не хватает»).
  Вторичные гайды (Hookdeck) упоминают ретраи 429/503 по `retry-after` — в первичных источниках этого не
  нашёл, в расчёт не брал.
- Не проверял, как `supabase db pull`/pg-delta переносит триггер на `supabase_functions.http_request` — при
  варианте A этот вопрос не встаёт (свой триггер в `public`, который диффится штатно).
- Тариф проекта не проверял; при Free важно помнить про паузу проекта после недели простоя.

## Sources

- Supabase Docs — Database Webhooks: https://supabase.com/docs/guides/database/webhooks
- Supabase — исходник `supabase_functions.http_request` и `hooks`:
  https://github.com/supabase/supabase/blob/master/docker/volumes/db/webhooks.sql
- Supabase Docs — pg_net: https://supabase.com/docs/guides/database/extensions/pg_net
- pg_net README — «Retrying failed requests»: https://github.com/supabase/pg_net#retrying-failed-requests
- Supabase Docs — Webhook debugging guide (лимиты, 6 часов, 200 запросов):
  https://supabase.com/docs/guides/troubleshooting/webhook-debugging-guide-M8sk47
- Supabase Docs — Vault: https://supabase.com/docs/guides/database/vault
- Supabase — исходник расширения `supabase_vault`: https://github.com/supabase/vault/blob/master/sql/supabase_vault--0.3.0.sql
- Supabase Docs — Migrating to publishable and secret API keys (паттерн «секрет в Vault + pg_net»):
  https://supabase.com/docs/guides/getting-started/migrating-to-new-api-keys
- Supabase Docs — Edge Functions, секреты: https://supabase.com/docs/guides/functions/secrets
- Supabase Docs — Function configuration (`verify_jwt`): https://supabase.com/docs/guides/functions/function-configuration
- Supabase Docs — Securing Edge Functions (`withSupabase`): https://supabase.com/docs/guides/functions/auth
- Supabase Docs — Authorization headers: https://supabase.com/docs/guides/functions/auth-headers
- Supabase Docs — Edge Functions limits: https://supabase.com/docs/guides/functions/limits
- Supabase Docs — Edge Functions quickstart (деплой, `--use-api`): https://supabase.com/docs/guides/functions/quickstart
- Supabase CLI Reference — `functions deploy`, `secrets set`:
  https://supabase.com/docs/reference/cli/supabase-functions-deploy, https://supabase.com/docs/reference/cli/supabase-secrets-set
- Supabase Docs — Cron (pg_cron): https://supabase.com/docs/guides/cron, https://supabase.com/docs/guides/cron/quickstart
- Supabase Docs — Queues (pgmq): https://supabase.com/docs/guides/queues, https://supabase.com/docs/guides/queues/quickstart
- Supabase Pricing (Edge Functions: 500K на Free): https://supabase.com/pricing
- Supabase Changelog (пауза Free-проектов, pgmq 1.5.1, отказ от `app.settings.jwt_secret` → Vault):
  https://supabase.com/changelog
- Telegram Bot API — Making requests, getUpdates, sendMessage, ResponseParameters:
  https://core.telegram.org/bots/api
- Telegram FAQ — лимиты и создание бота: https://core.telegram.org/bots/faq
- Telegram — Bots (не могут начинать переписку): https://core.telegram.org/bots
- Telegram Tutorial — получение токена у @BotFather: https://core.telegram.org/bots/tutorial
- Проект (проверено через Supabase MCP): Postgres 17.6; `supabase_vault` 0.3.1 установлен; `pg_net` 0.20.4 и
  `pg_cron` 1.6.4 доступны, но не установлены; гранты на `vault.decrypted_secrets` — `postgres` (всё),
  `service_role` (select), у `anon`/`authenticated` нет.
