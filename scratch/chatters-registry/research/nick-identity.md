# Идентичность ника и способ скачать чат VOD

Research к тикету `01-nick-identity-and-chat-source` (карта `scratch/chatters-registry/map.md`).

## Вывод коротко

- **`nick` (канон в реестре) — поле `user` / `display_name`**: это «красивое» написание с нужным регистром.
- **Ключ дедупа — `login` в нижнем регистре** (поле `login` / `commenter.name`). Именно по нему идемпотентно
  находим чатерса и обновляем `nick`, не веря написанию как идентичности.
- **По-настоящему неизменяемый ключ — числовой user id** (`commenter._id` в JSON TwitchDownloader). `login`
  меняется при переименовании (раз в 60 дней), поэтому «стабильный» он лишь условно.
- Оба задокументированных способа скачивания на 2026 рабочие, но GQL-способ хрупкий (integrity-check,
  ротация хеша, лимит на IP). Рекомендуется `TwitchDownloaderCLI`.

## 1. Identity key: `user` vs `login`

Twitch различает два поля:

| Поле                        | Смысл                                    | Меняется?                                                                                |
| --------------------------- | ---------------------------------------- | ---------------------------------------------------------------------------------------- |
| `login` (username)          | логин, URL канала, ключ в OAuth/EventSub | да, раз в 60 дней; старый логин Twitch держит ≥180 дней                                  |
| `display_name` / `user`     | отображаемое написание (регистр)         | да, **без кулдауна**; для legacy-аккаунтов может быть локализованным (не только регистр) |
| user id (`_id` / `user-id`) | числовой идентификатор                   | нет, неизменяем                                                                          |

Правила (официальный help Twitch):

- «Your display name is a change in capitalization from your username.» — display name по текущему правилу
  это тот же логин, но с выбранным регистром.
- «Unlike usernames, display names can be changed at any time.» / «Display name changes can be made without
  cooldown. Localized display name changes can be made once every 60 days. Username changes can be made once
  every 60 days.»
- Смена username меняет логин; «Display names do not change when you change your username» (FAQ — противоречит
  правилу «регистр от логина», исторически локализованные display-name остались у части аккаунтов).

Следствия для реестра:

1. Написание `nick` **нельзя** использовать как идентичность: display name меняют свободно, и в общем случае
   он может вообще не быть case-вариантом логина (см. пример `降霊灯` / `koureitou` ниже).
2. `login` пригоден как ключ дедупа в рамках одного канала, но **не immutable**: при переименовании логин
   меняется. Единственный полностью стабильный ключ — числовой user id.
3. Если в JSON есть user id — дедупить лучше по нему, а `login` хранить как алиас. В компактном же дампе
   (см. §2) user id нет, поэтому там ключ — `login.lower()`.

## 2. Локальные доказательства (VOD `2864275043`)

Дамп из истории git: `git show 17e26a6d60fc2a4d1c6f648cf657b9c3205a206a:.scratch/alysque-launch/research/chat-2864275043.json`
(только чтение, в репо не трогаем). Формат — **собственный компакт**, не нативный JSON TwitchDownloader:

```json
{
  "videoID": "2864275043",
  "count": 3662,
  "truncated": false,
  "messages": [{ "t": 10, "user": "starsun26", "login": "starsun26", "text": "shto" }]
}
```

Замеры по 3662 сообщениям (все 4 поля присутствуют у всех сообщений):

- уникальных `user` (case-sensitive) — **175**, уникальных `login` — **175**;
- `user.lower() == login` для **всех** сообщений, все `login` уже в нижнем регистре;
- **ни один `login` не встречается с двумя разными `user`** и наоборот (биекция 1:1 в этом VOD);
- 2055 сообщений, где `user != login` — это ровно разница в регистре (напр. `ShidouQuE` / `shidouque`);
- покрытие всего VOD: `t` от 10 до 12859 с.

Вывод по этому VOD: дедуп по `login` (он же `user.lower()`) даёт 175 ключей и не склеивает разных людей.
Но это свойство конкретного дампа, а не контракт: в нативном JSON TwitchDownloader встречается
`display_name: "降霊灯"` при `name: "koureitou"` — то есть **`user` не обязан быть case-вариантом `login`**.
Скрипт не должен утверждать `user.lower() == login`.

## 3. Актуальность способов скачивания (2026)

### 3a. `TwitchDownloaderCLI chatdownload` — работает, рекомендуется

- Проект живой: последний релиз **1.56.5 от 2026-07-20**.
- Команда из `docs/agents/twitch-sources.md` корректна; в README CLI это `-u/--id` (обязательный) и
  `-o/--output` (расширение `.json`/`.html`/`.txt`).
- Внутри (master, `TwitchDownloaderCore/ChatDownloader.cs`) шлёт в `https://gql.twitch.tv/gql` тот же
  `VideoCommentsByOffsetOrCursor` с хешем `b70a3591ff0f4e0313d126c6a1502d79a1c02baebb288227c582044aa76adf6a`
  и своим web Client-Id `kd1unb4b3q4t58fwlpcbzcbnm76a8fp`.
- Известные ограничения: rate limiting на IP (лечится меньшим числом соединений: 4–10, «Received too many
  null comment lists. Try reducing your download threads»); на перегрузке Twitch отдаёт HTML вместо JSON
  (`'<' is an invalid start of a value`); для VOD с режимом «только для подписчиков» чат не тянется.

Ожидаемая форма нативного `chat.json` (проверено на официальном примере TwitchDownloader):

```
FileInfo{Version,CreatedAt,UpdatedAt}
streamer{name,id}
video{title,description,id,created_at,start,end,length,viewCount,game,chapters}
comments[]{
  _id, created_at, channel_id, content_type, content_id, content_offset_seconds,
  commenter{ display_name, _id, name, bio, created_at, updated_at, logo },
  message{ body, bits_spent, fragments[], user_badges[], user_color, emoticons[] }
}
embeddedData
```

Скрипту из него нужны: `comments[].commenter.display_name` → `nick`, `comments[].commenter.name` → ключ,
`comments[].commenter._id` → стабильный id (если решим дедупить по нему), `comments[].content_offset_seconds`
и `video.id`/`streamer.id` → атрибуция источника.

### 3b. Анонимный GQL `VideoCommentsByOffsetOrCursor` — работает, но хрупко

- Хеш `b70a3591ff0f4e0313d126c6a1502d79a1c02baebb288227c582044aa76adf6a` актуален: его же использует
  TwitchDownloader master (2026) и он значился неизменным в списке хешей chat-downloader (нояб. 2025).
- Требуется публичный web Client-Id (напр. `kimne78kx3ncx6brgo4mv6wki5h1ko`); логин не нужен.
- **Пагинация по `cursor` упирается в integrity-check Kasada** (с мая 2023): ответ `failed integrity check`.
  Рабочий обход — идти по `contentOffsetSeconds`, а не по `cursor`, и дедупить по id сообщения.
  Именно так сделан локальный дамп (`chat-2864275043.json`): пагинация по offset с дедупом по id.
- Хеш persisted query Twitch периодически меняет → `PersistedQueryNotFound`; в нояб. 2025 Twitch разом
  сменил хеши `StreamMetadata`/`VideoMetadata`, `VideoCommentsByOffsetOrCursor` тогда устоял, но это риск.
- Агрессивный rate limit на один IP (порядка >10k сообщений), возможен HTML/`429`/пустые `edges`.
- Subscriber-only VOD анонимно отдаёт **пустые `edges`** (не ошибку).

### Форма ответа GQL (для парсинга)

```
data.video.comments.edges[].node{
  id, contentOffsetSeconds, createdAt,
  commenter{ id, displayName, name, ... },
  message{ body, fragments[], userColor, ... }
}
data.video.comments.pageInfo{ hasNextPage, endCursor }
```

Локальный компакт `[{t,user,login,text}]` — производный от этого (t = `contentOffsetSeconds`,
user = `commenter.displayName`, login = `commenter.name`), а не самостоятельный формат.

## Что не удалось проверить

- Не запускал `TwitchDownloaderCLI` и не делал живой анонимный GQL-запрос: нет бинарника/сетевого прогона.
  Актуальность подтверждена по коду и релизам, а не по факту сегодняшнего скачивания.
- Точный текст help-страницы Twitch «About Display Names» не открылся (JS-рендер); формулировки взяты из
  поисковой выдачи по официальной странице help.twitch.tv.
- Не проверял, отдаёт ли GQL сейчас хеш без изменений на новом VOD — только что он совпадает с master
  TwitchDownloader и с состоянием на нояб. 2025.

## Sources

- Twitch Help — About Display Names: https://help.twitch.tv/s/article/display-names-on-twitch
- Twitch Help — Account Settings: https://help.twitch.tv/s/article/twitch-account-settings
- Twitch Help — Username Rename and Recycling Policies: https://help.twitch.tv/s/article/username-rename-and-recycling-policies
- Twitch Dev Docs — Get Users (login / display_name / id): https://dev.twitch.tv/docs/api/reference/#get-users
- Twitch Dev Docs — IRC (tag `display-name`): https://dev.twitch.tv/docs/chat/irc/
- TwitchDownloader — README / CLI: https://github.com/lay295/TwitchDownloader/blob/master/TwitchDownloaderCLI/README.md
- TwitchDownloader — releases (1.56.5, 2026-07-20): https://github.com/lay295/TwitchDownloader/releases
- TwitchDownloader — пример JSON: https://github.com/lay295/TwitchDownloader/files/13495494/ExampleMoonMoonJsonFile.json
- TwitchDownloader — `ChatDownloader.cs` (хеш и Client-Id): https://github.com/lay295/TwitchDownloader/blob/master/TwitchDownloaderCore/ChatDownloader.cs
- TwitchDownloader — Issue #704 (integrity check на cursor): https://github.com/lay295/TwitchDownloader/issues/704
- chat-downloader — Issue #283 (ротация хешей GQL, нояб. 2025): https://github.com/xenova/chat-downloader/issues/283
- GQL `VideoCommentsByOffsetOrCursor`, требования и лимиты (2026): https://dev.to/devil_scrapes/twitch-chat-scraper-export-any-vods-full-chat-replay-for-1051k-1jea
- Локальный дамп: `17e26a6:.scratch/alysque-launch/research/chat-2864275043.json`,
  заметка `17e26a6:.scratch/alysque-launch/research/chatters.md`
