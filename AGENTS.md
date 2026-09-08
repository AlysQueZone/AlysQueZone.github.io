# О проекте

Это шуточный проект для зрителей twitch-канала <https://www.twitch.tv/alysque>
Называется AlysQueZone
Основная идея это платформа для "продаже приветов".
Стример здоровается с участикам чата(чатерсами), его привет это ценность.
Поэтому чатерсы перепродают приветы на сайте.

## Реализация

- Добавляй в AGENTS.md полезные ссылки, информацию и инструкции(краткие) по тому где и какая информация(связанная с twitch каналом) доступна для проекта.
  Также добавляй кратко, важную информацию о реализации проекта(которая пригодится AI который его делает).
- Делай коммиты сам когда надо
- В README.md должна быть простая инструкция(без лишних подробностей) для меня, что это и как этим пользоваться.
- Перед публикацией (deploy) всегда сначала локально: `npm run build` + открыть и покликать (preview/double-click), проверять только потом деплоить.

## Twitch-источники

- Канал: <https://www.twitch.tv/alysque> (ID `224473232`, ник `aLySQuE`). Цвет чата `#FF00BC`, аватар/баннер — `static-cdn.jtvnw.net` (хотлинк можно, бинарники не коммитить).
- TG с анонсами/мемами: <https://t.me/alysque> (читать через `https://t.me/s/alysque`).
- 7TV-сет канала (895 эмоутов): `GET https://7tv.io/v3/users/twitch/224473232` (поле `emote_set.emotes`); картинки `https://cdn.7tv.app/emote/<id>/2x.webp` (хотлинк ок).
- Нативный эмоут alysqueCLAP (gif): `https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_1075070639054e5d8cacb8a0ef4872d7/default/light|dark/3.0` (хотлинк ок).
- Все эмоуты разом: `https://emotes.adamcy.pl/v1/channel/alysque/emotes/all`.
- Архив чата VOD: `TwitchDownloaderCLI chatdownload --id <VOD_ID>` либо анонимный Twitch GQL `VideoCommentsByOffsetOrCursor` (хеш `b70a3591...adf6a`, пагинация через `contentOffsetSeconds`); VOD ID — число из `twitch.tv/videos/<id>`, живут 14–60 дней, качать только чат (`chat.json`).
- Мемы канала: страница <https://memealerts.com/alysque> публичного API не имеет (нужен токен стримера); прямые файлы `https://cdns.memealerts.com/p/.../alert_orig.webm` качаются curl, звук — `ffmpeg -i in.webm -vn -codec:a libmp3lame -q:a 5 out.mp3`.
- Пасты/тон чата: <https://twitchpaste.ru/channels/alysque>. Стата: <https://twitchtracker.com/alysque>.

## Supabase

- Предпочитаем реализовывать backend логику на supabase, вместо клиенского кода.
- MCP `supabase` настроен в `opencode.json` (project scope) и обязателен к использованию для всех операций с Supabase: схема, миграции, данные, логи, edge functions.
- Deploy to production ВКЛ: мерж в `main` сам применяет миграции. Схему менять только миграциями; правки из дашборда забирать через `db pull`.

## Видео и звуки (пайплайн, карта video-s3)

- Бакет `media` (публичный, создаётся SQL-миграцией `insert into storage.buckets`): `sounds/*.mp3` — UI/гамба-звуки; `videos/<slug>.webm|mp4|webp` — свои видео (тройка на 1 привет; mp4/webp выводятся заменой расширения `video_url`).
- Новое видео из `privets/<name>.mp4` (там H.264+AAC, вертикаль ~290x500): `ffmpeg -i in.mp4 -c:v libvpx-vp9 -b:v 0 -crf 32 -c:a libopus out.webm`; `ffmpeg -i in.mp4 -c:v libx264 -crf 23 -preset veryfast -c:a aac -movflags +faststart out.mp4`; `ffmpeg -i in.mp4 -vframes 1 -q:v 80 out.webp`. Бинарники в репо не класть, работать в `/tmp`.
- Заливка байтов — Dashboard/SDK/S3-API (не миграцией); публичный URL `https://<ref>.supabase.co/storage/v1/object/public/media/<path>`.
- Новый лот — миграцией: `INSERT INTO public.lots (slug,title,price,rarity,meme_text,video_url)` (владельцы NULL — первый покупатель первый владелец); хотлинк-мемам `UPDATE ... SET video_url=... WHERE video_url IS NULL` (цен/владельцев не трогать). Звук из чужого webm: скачать curl, `ffmpeg -i in.webm -vn -codec:a libmp3lame -q:a 5 out.mp3`, залить в `sounds/`.
- Звуки (гамба/UI) живут только в нашем S3; хотлинк `cdns.memealerts.com` — только видео мем-лотов. `public/sounds|memes` удаляем тем же релизом, когда фронт переключён на новые источники.

## Другое

- В директории privets(gitignored) лежат оригиналы аудио/видео приветов. Туда их добавляет человек, для последующего использования на сайте.

## Agent skills

### Issue tracker

Issues live as local markdown files under `.scratch/`. See `docs/agents/issue-tracker.md`.

### Triage labels

Default five canonical triage labels (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context layout: one `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.
