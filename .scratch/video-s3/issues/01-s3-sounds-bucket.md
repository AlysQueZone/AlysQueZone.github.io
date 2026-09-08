# Бакет и переезд UI-звуков в Supabase Storage

Type: research
Status: open
Blocked by: none

## Question

Как устроить наш S3 для UI-звуков (clap.mp3, gamba-bg/win1k/win100k, m4-scum, outbid и остальные из `public/sounds/`): имя публичного бакета, папки (`sounds/` + резерв под свои видео), RLS/политики публичного чтения, лимиты бесплатного тарифа, чем заливать (dashboard / CLI / SQL), как ссылаться из статики Astro (полный URL vs base-путь), кеширование/CDN, версионирование при замене файла. Учесть: статика на GitHub Pages, Deploy to production вкл (бакеты — через `config.toml`/миграции), 0₽, открытие из РФ, схема только миграциями. Итог — факты + рекомендованная раскладка путей, без исполнения заливки.

## Comments

- Research готов: `.scratch/video-s3/research/01-s3-sounds-bucket.md` (ветка `research/s3-sounds-bucket`).
  Рекомендация: публичный бакет `media`, пути `sounds/<file>.mp3` 1:1 (15 файлов, ~1.08 МБ), резерв `videos/`; создание бакета — SQL-миграцией (`insert into storage.buckets`), чтение публичное без RLS, версионирование новым путём (не upsert). Тикет не закрыт — закрывает ведущая сессия.
