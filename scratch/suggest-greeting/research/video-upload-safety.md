# Безопасный приём видео от чатерсов (Supabase Storage)

Research к тикету `02-video-upload-safety` (карта `scratch/suggest-greeting/map.md`).

## Вывод коротко

- **Рекомендация для v1 — загрузки нет, только ссылка** (вариант c). Приложение не принимает байты, к Storage не добавляется ни бакета, ни политик, ни скрипта очистки. Инвариант «заливка только `service_role`-скриптом» сохраняется; исходник агент всё равно добывает и проверяет локально при принятии, как сейчас в медиа-пайплайне.
- **Если файлы нужны — вариант (a): отдельный приватный бакет `submissions` + прямая загрузка авторизованным клиентом по RLS «только своя папка»** (`<uid>/...`). Signed upload URL не обязателен: при обычной загрузке RLS проверяется на самой загрузке, а у signed URL право проверяется только при выдаче токена. Никогда не принимать файлы в публичный `media` — неотсортированный контент станет публичным навсегда.
- **Главный факт: `allowed_mime_types` и `file_size_limit` — не защита от злоумышленника, а гашение честных ошибок.** MIME в Storage — это объявленный клиентом `Content-Type`, magic bytes Storage не проверяет вообще (проверено по исходникам storage-api). Реальную проверку содержимого делает только человек/агент на этапе принятия (`ffprobe` + глазами), поэтому до принятия файл должен лежать в приватном бакете.
- Signed upload URL устроен безопасно: выдача требует авторизации и проходит RLS INSERT **на выдаче**; токен привязан к точному пути, скоупу upload и живёт 2 часа (по документации SDK); украденный токен даёт загрузку только в этот путь. Replay/чужой путь — закрыты.
- Лимиты и деньги (free): глобальный максимум файла 50 МБ, 1 ГБ хранилища, 5 ГБ egress (+5 ГБ cached); 40 файлов по 25 МБ = всё хранилище. Удалять можно только через Storage API: SQL-`DELETE` из `storage.objects` оставляет байты в S3 и продолжает тарифицироваться.

## 1. Что реально проверяет Storage (а что нет)

### 1.1 Метаданные отдельно, байты отдельно

`storage.objects` — только метаданные; сами файлы лежат в S3-совместимом бэкенде. Документация прямо предписывает считать таблицы схемы `storage` read-only и ходить только через API:

> «Deleting the metadata doesn't remove the object in the underlying storage provider. This results in your object being inaccessible, but you'll still be billed for it.»

Отсюда следствие для очистки: удалять файлы заявок можно **только Storage API** (SDK/HTTP с `service_role`), а не SQL-запросом по `storage.objects`.

Схема `buckets`: `file_size_limit`, `allowed_mime_types`, `public`, `owner_id`; `objects`: `bucket_id`, `name` (path), `metadata`, `version`, `owner_id`.

### 1.2 `allowed_mime_types` проверяет объявленный Content-Type

Валидатор из исходников storage-api (`src/storage/validators/mime-type.ts`) парсит переданную строку MIME по RFC 9110 и сравнивает со списком бакета (поддерживает wildcard `video/*`). Подставляется туда:

- для бинарного тела — заголовок `Content-Type` запроса;
- для `multipart/form-data` — поле `contentType` формы, иначе MIME части (`formData.mimetype`).

Никакого чтения байтов нет: в storage-api (коммит `7a0dd891`, v1.11.2) нет ни сниффинга magic bytes, ни зависимости `file-type`. То есть при `allowed_mime_types = ['video/mp4','video/webm']` клиент может прислать **любой** файл, объявив `Content-Type: video/mp4` — валидатор пропустит.

Почему на клиента нельзя положиться и «честно»: браузерный `Blob.type` выводится из расширения файла, а не из содержимого; MDN прямо предупреждает: «Developers are advised not to rely on this property as a sole validation scheme», «a PNG image file renamed to .txt would give text/plain». Атакующий с curl/скриптом задаёт MIME руками.

**Вывод:** `allowed_mime_types` — UX-гейт и защита от случайного `.zip`; безопасность на нём строить нельзя.

### 1.3 `file_size_limit` — смягчение, а не граница

Эффективный лимит — минимум из глобального и бакетного (`getStandardMaxFileSizeLimit` в `src/storage/uploader.ts`). Как применяется:

- бинарное тело с известным `Content-Length` > лимита — отклоняется до загрузки в бэкенд;
- `multipart/form-data` — поток обрезается `@fastify/multipart` (`limits.fileSize`), после загрузки `file.truncated` → ошибка `EntityTooLarge`, временно загруженный объект удаляется обработчиком.

Но в том же коде для бинарного тела **без** `Content-Length` (chunked) нет счётчика байт — тело уходит в бэкенд потоком, и явной проверки «не больше лимита» в стандартном пути не видно. Это чтение кода, не живой тест; возможно, hosted-платформа режет такие запросы раньше. Практический вывод: `file_size_limit` (как и глобальный лимит) — не анти-абьюз-граница, а страховка от честных ошибок; квоту хранилища обход возможен, бэкап — мониторинг и очистка.

Для справки: глобальный максимум размера файла на Free — 50 МБ, на Pro — до 500 ГБ; бакетный лимит не может быть больше глобального. В проекте `media` уже ограничен `26214400` (25 МБ) и списком MIME (`20260908163500_media_bucket_limits.sql`).

### 1.4 Проверка содержимого: клиент vs сервер

- **Клиент.** Прочитать первые байты (`file.slice(0, N).arrayBuffer()`) и сверить с сигнатурами можно только для UX — атакующий обходит.
- **Сервер без Edge Function.** У Postgres (RLS-политика, триггер) нет доступа к байтам объекта: в `storage.objects` только метаданные. Storage собственный контент не сниффит. Значит, серверной проверки «это правда видео» без Edge Function не существует.
- **Реальная проверка.** `ffprobe` (длительность, кодеки, валидный ли контейнер) + человеческий просмотр на этапе принятия — и только после этого перенос в публичный `media`. Это совпадает с HITL-гейтом карты и текущим медиа-пайплайном.

## 2. Signed upload URL: поток, срок, границы доверия

### 2.1 Поток (по исходникам storage-api и supabase-js)

1. `supabase.storage.from(bucket).createSignedUploadUrl(path, { upsert })` шлёт `POST /object/upload/sign/<bucket>/<path>` (заголовок `authorization` обязателен по схеме роута). Сервер вызывает `signUploadObjectUrl` → `uploader.canUpload` (в коде комментарий: «check if user has INSERT permissions») → `db.testPermission(...)` под JWT пользователя → **RLS INSERT** (а для `upsert: true` ещё SELECT/UPDATE). Затем выписывает JWT `{ owner, url: '<bucket>/<path>', upsert, scope: 'upload', exp }`.
2. Ответ: `{ signedUrl, token, path }`.
3. `supabase.storage.from(bucket).uploadToSignedUrl(path, token, file)` шлёт `PUT /object/upload/sign/<bucket>/<path>?token=...`. Сервер проверяет подпись, скоуп, точное совпадение пути и срок (`verifyObjectSignature`), после чего грузит объект **как superuser** — RLS повторно не проверяется, право уже проверено на шаге 1. Объект получает `owner_id` из `sub`.

Минимум кода:

```js
// выдача токена (клиент с сессией чатерса)
const { data, error } = await supabase.storage
  .from('submissions')
  .createSignedUploadUrl(`${uid}/${requestId}/video.webm`); // uid из сессии
// data: { signedUrl, token, path }

// загрузка
await supabase.storage.from('submissions').uploadToSignedUrl(data.path, data.token, file);
```

### 2.2 Срок жизни

JSDoc supabase-js: «Signed upload URLs can be used to upload files to the bucket without further authentication. **They are valid for 2 hours**.» Параметра срока в SDK нет (только `path` и `{ upsert }`). В self-hosted дефолт конфига `UPLOAD_SIGNED_URL_EXPIRATION_TIME` — 60 секунд; на hosted, по документации SDK, 2 часа (живьём не проверял). Для нашей формы 2 часа — не проблема: токен выдаётся и используется сразу; если чатерс закроет вкладку, повторит отправку.

### 2.3 Что мешает злоумышленнику

- **Чужой путь/бакет.** Токен подписан на конкретный `url` и сверяется побайтово — переиспользовать на другой объект нельзя.
- **Чтение/листинг.** Скоуп только upload; скачивание таким токеном не сделать.
- **Неавторизованная выдача.** `authorization` обязателен, а реальный гейт — RLS: политику пишем `TO authenticated` (anon-ключ тоже проходит с заголовком, но RLS его отсечёт; в проекте anon-вход и так выключен).
- **Самозахват чужих папок.** Политика `(storage.foldername(name))[1] = auth.uid()::text` не даёт выписать токен на чужой путь.
- **Остаточные риски.** Токен — bearer-credential в URL: утёк (логи, скриншот) → можно грузить в тот же путь до истечения срока. Любой авторизованный чатерс может выписать себе сколько угодно токенов — **серверного rate limit на это нет** (Storage документированного лимита на загрузки не имеет); от массовых заливок защищают только квота, очистка и app-логика. И, как в §1.2, MIME можно подделать — это не решается токеном.

### 2.4 Важный вывод: для нашей формы signed URL не обязателен

Если у клиента есть сессия и RLS INSERT-политика на свою папку, работает и обычный `storage.from('submissions').upload(path, file)` — документы называют INSERT-политику «единственно необходимой для загрузки». Signed upload URL нужен, когда право на загрузку выдаёт **сервер** (например, Edge Function проверил заявку и лимиты), или когда файл грузит не владелец JWT. Для «чатерс сам заполняет форму» проще прямой `upload()`; signed URL — вариант, если позже захочется серверный гейт без проксирования файла через функцию.

## 3. RLS-политики на `storage.objects` для «только своя папка»

Сейчас на `storage.objects` политик нет — поэтому клиентские загрузки невозможны в принципе (только `service_role`). Шаблоны (из официальных docs access-control):

```sql
-- писать только в свою папку <uid>/...
create policy "submissions: insert own folder"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'submissions'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
);

-- читать только своё (нужно в т.ч. для возврата строки при INSERT, см. ниже)
create policy "submissions: select own objects"
on storage.objects for select to authenticated
using (
  bucket_id = 'submissions'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
);

-- опционально: удалять своё (если решим дать чатерсу отмену)
create policy "submissions: delete own objects"
on storage.objects for delete to authenticated
using ( bucket_id = 'submissions' and owner_id = (select auth.uid()::text) );
```

Грабли, подтверждённые документацией и скиллом:

- **RETURNING требует SELECT.** Storage API делает `INSERT ... RETURNING *`; без SELECT-политики на тот же путь загрузка может упасть 403 «new row violates row-level security policy», даже когда INSERT-политика корректна. Поэтому SELECT «своё» — практически обязателен.
- **Upsert требует INSERT + SELECT + UPDATE.** При `{ upsert: true }` (и в `upload()`, и в `createSignedUploadUrl`) нужна ещё UPDATE-политика. Нам upsert не нужен: каждый файл — новый путь, перезапись запрещаем.
- **`TO authenticated` без предиката владения — дыра (BOLA).** Роль проверяется отдельно от владения; всегда добавлять `(select auth.uid()) = ...`.
- **`auth.role()` устарел** — использовать `TO authenticated`, не `auth.role() = 'authenticated'`.
- **`owner_id` — text**, `auth.uid()` — uuid: сравнивать через `auth.uid()::text` или `auth.jwt()->>'sub'`.

Бакет заводится миграцией — в проекте уже есть такой паттерн (`20260908114843_video_lots.sql`, `20260908163500_media_bucket_limits.sql`):

```sql
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('submissions', 'submissions', false, 26214400,
        array['video/webm', 'video/mp4', 'image/webp'])
on conflict (id) do nothing;
-- + политики выше
```

Хранилище — приватное (`public = false`): скачивание только по RLS или signed download URL.

## 4. Приватный бакет → принятие → `media` → очистка

- **Выдача админу/агенту.** `createSignedUrl(path, expiresInSeconds)` даёт временную ссылку на скачивание; право на её выдачу определяет SELECT-политика (для человека-админа) или `service_role` (для скрипта агента). Документация: единственные способы скачать из приватного бакета — `download` с JWT пользователя или `createSignedUrl`.
- **Перенос принятого.** Уже привычный пайплайн: скачать исходник (service-ключом) → `ffmpeg` в тройку `videos/<slug>.webm|mp4|webp` → `scripts/storage_upload.py --bucket media --dest videos/` → удалить объект из `submissions` через Storage API. То есть в публичный `media` попадает только провёренный человеком контент.
- **Очистка отклонённого.** Скриптом `service_role` через Storage API (`DELETE /storage/v1/object/<bucket>/<path>`); SQL-`DELETE` по `storage.objects` запрещён как практика — байты останутся в S3 и будут тарифицироваться. В репо скрипта удаления пока **нет** — при варианте (a) его придётся добавить. Политику сроков (сразу при отклонении / автосвип старше N дней) надо зафиксировать в спеке — сейчас она в `Not yet specified` карты.
- **TUS.** Для файлов больше 6 МБ документация рекомендует resumable upload (TUS) «for better reliability»; стандартный upload тоже держит до 5 ГБ. На 25 МБ это опционально: TUS добавляет шаг выдачи `x-signature` (в примерах — через Edge Function), поэтому для v1 не нужен; вернуться, если увидим сбои на мобильных сетях.

## 5. Вариант (b): загрузка через Edge Function

Схема: функция с `service_role` проверяет заявку/квоту, затем либо сама заливает файл, либо выдаёт клиенту signed upload URL.

- **Плюс:** единственное место, где можно серверно проверить «заявка существует», «не дубль», «квота на чатерса», и только затем дать право на загрузку; RLS-политики на Storage не нужны вовсе.
- **Минусы:** новый рантайм (у проекта пока нет Edge Functions), деплой и секреты (`service_role` в функции), файл проходит через функцию (буферизация в памяти), холодные старты. Ограничения hosted: память 256 МБ, CPU 2 с на запрос, wall clock 150 с (Free) / 400 с, размер бандла 20 МБ (5 МБ при серверной сборке); документированного лимита размера тела запроса в актуальных лимитах нет — 25 МБ в памяти функции помещаются. Free-план даёт 500 000 вызовов/мес — по объёму нам хватит с запасом.
- **Оценка:** для v1 избыточно. Гейт «одна заявка — один файл» и так можно держать в приложении; серверная строгость понадобится только при реальном злоупотреблении, тогда функция — запасной вариант. (Триггеры на `storage.objects` не вариант: схема `storage` закрыта для создания функций/таблиц с 2025-04-21.)

## 6. Лимиты и стоимость (free vs pro)

| Параметр                   | Free                        | Pro                                                                  |
| -------------------------- | --------------------------- | -------------------------------------------------------------------- |
| Макс. размер файла (глоб.) | 50 МБ                       | 500 ГБ                                                               |
| Хранилище                  | 1 ГБ                        | 100 ГБ, далее $0.0213/ГБ                                             |
| Egress                     | 5 ГБ + 5 ГБ cached          | 250 ГБ + 250 ГБ cached, далее $0.09/ГБ (uncached), $0.03/ГБ (cached) |
| Edge Functions             | 500 тыс. вызовов/мес        | 2 млн, далее $2/млн                                                  |
| Пауза проекта              | после 1 недели неактивности | нет                                                                  |

Практически: 40 файлов по 25 МБ забивают бесплатное хранилище; приватный бакет egress не тратит, пока никто не скачивает (скачивание агентом — тоже трафик, но небольшой). Публичный `media` остаётся главным потребителем egress (видео смотрят покупатели).

## 7. Альтернатива «только ссылка»: валидация и риски

Проект уже живёт с хотлинками: в `content/lots.toml` часть `video_url` — прямые `https://cdns.memealerts.com/...`, часть — свой `media`. То есть «готовая ссылка» — принятый в проекте формат, и принимать её в заявке естественно.

Что делать с URL:

- **Разбирать как URL, а не строку**: `new URL(input)` (WHATWG), хранить нормализованный вид: lower-case host, убрать fragment и трекинг-параметры (`si`, `igsh`, `utm_*`).
- **Allowlist хостов** (OWASP для ссылок от пользователя: «Match the host against an allowlist»): например `clips.twitch.tv`, `twitch.tv`, `youtube.com`/`youtu.be`, `streamable.com`, `medal.tv`, `vk.com`/`vkvideo.ru` плюс уже используемый `cdns.memealerts.com`. Схема — только `https`. Хост не из списка — вежливый отказ.
- **Парсеры не расходятся.** Если URL валидируется и в JS (форма), и в Python (скрипт/агент), правило должно быть одно, а неоднозначное (`http://example.com\@evil.com` — разные ответы у WHATWG и `urllib`) — отклоняться (OWASP).
- **Приложение не ходит по ссылке само.** Серверных фетчей нет → SSRF в проде отсутствует. Скачивает агент **локально** при принятии (yt-dlp/ffmpeg, по списку поддерживаемых сайтов), а не «curl по любому URL».
- **Риски ссылок:** мёртвая/приватная ссылка или удалённое видео (агент обнаруживает при принятии и сообщает человеку); хотлинк живёт, пока жив чужой хост (для принятых лотов это уже существующий риск проекта); права и NSFW — человеческий гейт; для собственного видео пайплайн скачивает и переносит в `media`, снимая зависимость от хоста.

## 8. Сравнение вариантов

| Вариант                                                             | Что добавляется                                                | Кто авторизует                           | Плюсы                                                                                     | Риски/цена                                                                          | Сложность |
| ------------------------------------------------------------------- | -------------------------------------------------------------- | ---------------------------------------- | ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | --------- |
| **(a) прямая загрузка в приватный `submissions`, RLS «своя папка»** | бакет + 2–3 политики + скрипт очистки; клиентский код загрузки | RLS `TO authenticated` + папка = uid     | файл есть сразу, место предсказуемо, публичный `media` не трогаем                         | квота 1 ГБ можно забить; MIME/размер не защита; нужна очистка; новый код в браузере | средняя   |
| **(a2) то же + signed upload URL**                                  | то же + выдача токенов                                         | RLS на выдаче токена                     | удобно, если право выдаёт сервер; файл не идёт через функцию                              | то же + токен-credential; 2 ч жизни; для нашей формы избыточно                      | средняя   |
| **(b) Edge Function**                                               | функция + секреты + деплой                                     | функция (service_role)                   | серверный гейт: заявка/квота/дубли; Storage-политики не нужны                             | новый рантайм; файл через функцию; 256 МБ/2 с CPU; сложнее отлаживать               | высокая   |
| **(c) только ссылка (v1)**                                          | ничего в Storage; валидация URL в форме и спеке                | приложение (формат) + человек (принятие) | zero-риск для Storage и квоты; сохраняет инварианты и текущий медиа-пайплайн; меньше кода | нельзя прислать своё видео файлом; внешние риски хотлинков (мёртвые ссылки)         | низкая    |

## 9. Что попадает в схему и спеку

**Если v1 = (c), только ссылка:**

- В таблицу заявок (тикет 05) — поля ссылки: нормализованный `url`, при желании `url_original`, тип источника (пока один — `link`). Storage не трогаем.
- В спеку: правило валидации (https, allowlist хостов, лимит длины), текст ошибки для «не тот хост», и явное «в v1 файлы не принимаем».
- Анти-спам/дубликаты и судьба ссылок-отказов остаются в `Not yet specified` — их проще закрывать без файлов.

**Если решим (a):**

- Миграция: приватный бакет `submissions` (`file_size_limit = 26214400`, `allowed_mime_types = ['video/webm','video/mp4','image/webp']`) + RLS-политики INSERT/SELECT «своя папка» (шаблон §3). Upsert не разрешаем.
- Скрипт очистки/удаления через Storage API (`service_role`) — новый. Правило хранения отклонённых и сроки — в спеку.
- Спек: 25 МБ, MIME и размер — «гашение ошибок, не безопасность»; один файл на заявку — прикладной контроль; проверка контента — `ffprobe` + человек при принятии; перенос в `media` — существующим пайплайном.
- В `Not yet specified` карты уйдёт меньше тумана, чем кажется: «судьба отклонённых файлов» станет обязательным пунктом.

## Что не удалось проверить

- Ничего не запускал на живом проекте: RLS-политики, фактический 403/RETURNING, срок жизни токена на hosted (2 ч — из документации SDK), обход бакетного лимита chunked-запросом — только чтение кода и документации.
- Исходники storage-api читал на коммите `7a0dd891` (v1.11.2); hosted-сборка может отличаться.
- Rate limit для Storage на hosted в документации не описан; фактических значений нет.
- Текущий план проекта (Free/Pro) и занятое хранилище не проверял — расчёт по публичному прайсу.

## Sources

- Supabase Docs — Storage Access Control (RLS-примеры, INSERT для загрузки): https://supabase.com/docs/guides/storage/security/access-control
- Supabase Docs — Storage Schema (read-only, «deleting metadata doesn't remove the object»): https://supabase.com/docs/guides/storage/schema/design
- Supabase Docs — Ownership (`owner_id`, `service_key` не ставит владельца): https://supabase.com/docs/guides/storage/security/ownership
- Supabase Docs — Creating Buckets (`file_size_limit`, `allowed_mime_types`; SQL-insert бакета): https://supabase.com/docs/guides/storage/buckets/creating-buckets
- Supabase Docs — File Limits (глобальный лимит, Free 50 МБ): https://supabase.com/docs/guides/storage/uploads/file-limits
- Supabase Docs — Standard Uploads (лимиты, content-type, upsert): https://supabase.com/docs/guides/storage/uploads/standard-uploads
- Supabase Docs — Edge Functions Limits (256 МБ, 2 с CPU, 150/400 с): https://supabase.com/docs/guides/functions/limits
- Troubleshooting — 403 «new row violates row-level security policy» и RETURNING/SELECT: https://supabase.com/docs/guides/troubleshooting/storage-error-403-forbidden-new-row-violates-row-level-security-policy-on-upload-a94384 (снипет из Context7)
- supabase-js — `StorageFileApi.ts` (`createSignedUploadUrl`: «valid for 2 hours», RLS insert; `uploadToSignedUrl`: RLS не нужен): https://github.com/supabase/supabase-js/blob/master/packages/core/storage-js/src/packages/StorageFileApi.ts
- storage-api — `src/http/routes/object/getSignedUploadURL.ts`, `uploadSignedObject.ts` (поток выдачи/приёма токена): https://github.com/supabase/storage-api
- storage-api — `src/storage/object.ts` (`signUploadObjectUrl` → `canUpload`; `verifyObjectSignature` — привязка к пути/скоупу/сроку): https://github.com/supabase/storage-api/blob/master/src/storage/object.ts
- storage-api — `src/storage/uploader.ts` (`fileUploadFromRequest`: size/MIME-валидация, усечение multipart): https://github.com/supabase/storage-api/blob/master/src/storage/uploader.ts
- storage-api — `src/storage/validators/mime-type.ts` (сравнение объявленного Content-Type, без magic bytes): https://github.com/supabase/storage-api/blob/master/src/storage/validators/mime-type.ts
- storage-api — `src/config.ts` (`UPLOAD_SIGNED_URL_EXPIRATION_TIME`, self-hosted дефолт 60 с): https://github.com/supabase/storage-api/blob/master/src/config.ts
- Supabase Blog — Storage: 500 ГБ, дешёвый cached egress, квоты Free: https://supabase.com/blog/storage-500gb-uploads-cheaper-egress-pricing
- Supabase — changelog (скан на breaking changes по Storage; ограничение DDL в схеме `storage` с 2025-04-21): https://supabase.com/changelog
- MDN — `Blob.type` (MIME из расширения, не полагаться на него): https://developer.mozilla.org/en-US/docs/Web/API/Blob/type
- OWASP — SSRF Prevention Cheat Sheet (allowlist хостов, разногласия парсеров): https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html
- yt-dlp — список поддерживаемых сайтов (для локального скачивания агентом): https://github.com/yt-dlp/yt-dlp/blob/master/supportedsites.md
- Локально: `supabase/migrations/20260908114843_video_lots.sql`, `20260908163500_media_bucket_limits.sql`; `content/lots.toml` (хотлинки `video_url`); `docs/agents/media-pipeline.md`; `scripts/storage_upload.py`
