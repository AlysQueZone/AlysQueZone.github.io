# О проекте

Это шуточный проект для зрителей twitch-канала <https://www.twitch.tv/alysque>
Называется AlysQueZone
Основная идея это платформа для "продаже приветов".
Стример здоровается с участикам чата(чатерсами), его привет это ценность.
Поэтому чатерсы перепродают приветы на сайте.

## Реализация

- Добавляй в AGENTS.md полезные ссылки, информацию и инструкции(краткие) по тому где и какая информация(связанная с twitch каналом) доступна для проекта.
- Делай коммиты сам когда надо
- В README.md должна быть простая инструкция(без лишних подробностей) для меня, что это и как этим пользоваться.
- Перед публикацией (deploy) всегда сначала локально: `npm run build` + открыть и покликать (preview/double-click), проверять только потом деплоить.

## Twitch-источники (кратко)

- Канал: <https://www.twitch.tv/alysque> (ID `224473232`, ник `aLySQuE`). Цвет чата `#FF00BC`, аватар/баннер — `static-cdn.jtvnw.net` (хотлинк можно, бинарники не коммитить).
- TG с анонсами/мемами: <https://t.me/alysque> (читать через `https://t.me/s/alysque`).
- 7TV-сет канала (895 эмоутов): `GET https://7tv.io/v3/users/twitch/224473232` (поле `emote_set.emotes`); картинки `https://cdn.7tv.app/emote/<id>/2x.webp` (хотлинк ок).
- Нативный эмоут alysqueCLAP (gif): `https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_1075070639054e5d8cacb8a0ef4872d7/default/light|dark/3.0` (хотлинк ок).
- Все эмоуты разом: `https://emotes.adamcy.pl/v1/channel/alysque/emotes/all`.
- Архив чата VOD: `TwitchDownloaderCLI chatdownload --id <VOD_ID>` либо анонимный Twitch GQL `VideoCommentsByOffsetOrCursor` (хеш `b70a3591...adf6a`, пагинация через `contentOffsetSeconds`); VOD ID — число из `twitch.tv/videos/<id>`, живут 14–60 дней, качать только чат (`chat.json`).
- Мемы канала: страница <https://memealerts.com/alysque> публичного API не имеет (нужен токен стримера); прямые файлы `https://cdns.memealerts.com/p/.../alert_orig.webm` качаются curl, звук — `ffmpeg -i in.webm -vn -codec:a libmp3lame -q:a 5 out.mp3`.
- Пасты/тон чата: <https://twitchpaste.ru/channels/alysque>. Стата: <https://twitchtracker.com/alysque>.

## Agent skills

### Issue tracker

Issues live as local markdown files under `.scratch/`. See `docs/agents/issue-tracker.md`.

### Triage labels

Default five canonical triage labels (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context layout: one `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.
