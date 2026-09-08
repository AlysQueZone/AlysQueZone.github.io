# Бакет и переезд UI-звуков в Supabase Storage

Type: research
Status: resolved
Blocked by: none

## Question

Как устроить наш S3 для UI-звуков (clap.mp3, gamba-bg/win1k/win100k, m4-scum, outbid и остальные из `public/sounds/`): имя публичного бакета, папки (`sounds/` + резерв под свои видео), RLS/политики публичного чтения, лимиты бесплатного тарифа, чем заливать (dashboard / CLI / SQL), как ссылаться из статики Astro (полный URL vs base-путь), кеширование/CDN, версионирование при замене файла. Учесть: статика на GitHub Pages, Deploy to production вкл (бакеты — через `config.toml`/миграции), 0₽, открытие из РФ, схема только миграциями. Итог — факты + рекомендованная раскладка путей, без исполнения заливки.

## Comments

- Research готов: `scratch/video-s3/research/01-s3-sounds-bucket.md` (ветка `research/s3-sounds-bucket`).
  Рекомендация: публичный бакет `media`, пути `sounds/<file>.mp3` 1:1 (15 файлов, ~1.08 МБ), резерв `videos/`; создание бакета — SQL-миграцией (`insert into storage.buckets`), чтение публичное без RLS, версионирование новым путём (не upsert). Тикет не закрыт — закрывает ведущая сессия.

## Answer

Решение: один публичный бакет `media`, пути `sounds/<file>.mp3` 1:1 (15 файлов `public/sounds/`, ~1.08 МБ суммарно), резерв-префикс `videos/` под свои видео. Бакет создавать SQL-миграцией (`insert into storage.buckets`, т.к. `config.toml` действует только локально, а Deploy to production применяет миграции); публичное чтение без RLS-политик, запись — политиками на `storage.objects` (INSERT, +SELECT+UPDATE для upsert). Из статики Astro ссылаться полным абсолютным URL `https://<ref>.supabase.co/storage/v1/object/public/media/<path>` (не `${base}`); байты заливать через Dashboard/SDK/S3-API, не миграцией. Free-квоты хватает с запасом (1 ГБ / 5+5 ГБ egress / 50 МБ на файл; наши ~1.08 МБ — ~0.1%). Версионирования нет — новая версия файла = новый путь (не upsert поверх из-за stale CDN). Полные факты с источниками — `scratch/video-s3/research/01-s3-sounds-bucket.md`. Принято ведущей сессией 2026-09-08; разблокирует тикеты модели данных и пайплайна своих видео.
