# Медиа-пайплайн (новый привет/лот)

Исходники от человека лежат в `privets/` (gitignored). Работать в `/tmp`, бинарники в репо не класть.

- Раскладка бакета `media`: `sounds/*.mp3`, `videos/<slug>.webm|mp4|webp` (тройка на 1 привет; mp4/webp выводятся заменой расширения).
- Тройка из `privets/<name>.mp4` (проверено 2026-09-08):
  `ffmpeg -i in.mp4 -c:v libvpx-vp9 -b:v 0 -crf 32 -c:a libopus out.webm`;
  `ffmpeg -i in.mp4 -c:v libx264 -crf 23 -preset veryfast -c:a aac -movflags +faststart out.mp4`;
  `ffmpeg -i in.mp4 -vframes 1 -q:v 80 out.webp`.
- Звук из чужого webm: `ffmpeg -i in.webm -vn -codec:a libmp3lame -q:a 5 out.mp3` → в `sounds/`.
- Заливка байтов — только скриптом `scripts/storage_upload.py` из корня (MCP/SQL байты не несут; ключ `SUPABASE_SERVICE_ROLE_KEY` в `.env`, ключ держится в окружении): `python3 scripts/storage_upload.py --bucket media --dest sounds/ a.mp3 b.mp3` или `--dir /tmp/out/ --pattern "*.mp3"`; URL `https://<ref>.supabase.co/storage/v1/object/public/media/<path>`.

## Лот (карточка)

Контент лотов живёт в `content/lots.toml` (источник правды), **не** в миграциях — миграции только схема. Порядок:

1. Своё видео → тройка выше → `storage_upload.py --dest videos/` (URL `.../media/videos/<slug>.webm`); хотлинк-мем → просто готовый URL.
2. Добавить `[[lots]]` в манифест: `slug`, `title`, `price` (стартовая), `video_url`. Ник в `title` — по реестру ников (`docs/agents/chatters.md`): писать канон, при резолве дописать алиас.
3. `just lots-seed` — пересобрать локальный `supabase/seed.sql`; `just lots-sync` — upsert в прод (существующим лотам `price`/владелец не трогаются, это runtime-состояние триггеров).
4. `lots-sync` уже опубликовал лот — сайт читает каталог из БД в рантайме, лот виден без деплоя. Деплой нужен только для изменений кода.
