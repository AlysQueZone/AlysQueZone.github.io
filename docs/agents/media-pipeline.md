# Медиа-пайплайн (новый привет/лот)

Исходники от человека лежат в `privets/` (gitignored). Работать в `/tmp`, бинарники в репо не класть.

- Раскладка бакета `media`: `sounds/*.mp3`, `videos/<slug>.webm|mp4|webp` (тройка на 1 привет; mp4/webp выводятся заменой расширения).
- Тройка из `privets/<name>.mp4` (проверено 2026-09-08):
  `ffmpeg -i in.mp4 -c:v libvpx-vp9 -b:v 0 -crf 32 -c:a libopus out.webm`;
  `ffmpeg -i in.mp4 -c:v libx264 -crf 23 -preset veryfast -c:a aac -movflags +faststart out.mp4`;
  `ffmpeg -i in.mp4 -vframes 1 -q:v 80 out.webp`.
- Звук из чужого webm: `ffmpeg -i in.webm -vn -codec:a libmp3lame -q:a 5 out.mp3` → в `sounds/`.
- Заливка байтов — только скриптом `scripts/storage_upload.py` из корня (MCP/SQL байты не несут; ключ `SUPABASE_SERVICE_ROLE_KEY` в `.env`, ключ держится в окружении): `python3 scripts/storage_upload.py --bucket media --dest sounds/ a.mp3 b.mp3` или `--dir /tmp/out/ --pattern "*.mp3"`; URL `https://<ref>.supabase.co/storage/v1/object/public/media/<path>`.
- Новый лот — миграцией `INSERT INTO public.lots (slug,title,price,video_url)` с NULL-владельцами; хотлинк-мемам `UPDATE ... SET video_url=... WHERE video_url IS NULL`.
