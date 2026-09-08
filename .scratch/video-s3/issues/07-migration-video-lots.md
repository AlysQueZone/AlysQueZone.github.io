# [Стройка] Миграция: видеополя, снос ЛУКа, бакет

Type: task
Status: resolved
Blocked by: none

## Question

Написать и локально проверить `supabase/migrations/<ts>_video_lots.sql` по §1 спеки
(`.scratch/video-s3/spec.md`): колонки `video_url`/`rarity`/`meme_text`, backfill из
`data/lots.json`, обнуление сид-владельцев с guard `NOT EXISTS (purchases)`, удаление
`luk-legend`, `DROP COLUMN is_locked`, триггер без `v_locked`, `insert into storage.buckets`
для `media`. RLS и storage-политики не трогать. Только файл миграции + `db diff`-проверка
синтаксиса; НЕ применять к проду (применится мержем — Deploy to production).
Skills: `supabase`, `supabase-postgres-best-practices`.

## Comments

- Приёмка: anon-select новых колонок; покупка живого лота проходит; `grep is_locked` пуст вне истории.
- Сделано: `supabase/migrations/20260908114843_video_lots.sql` (колонки video_url/rarity/meme_text, backfill 19 слагов из data/lots.json без luk-legend, обнуление сид-владельцев с guard NOT EXISTS purchases, delete luk-legend, drop is_locked, enforce_purchase_rules() без v_locked, bucket media); проверено локально в эфемерном postgres:18 — два прогона чисты, покупка 250→275 проходит, check отбивает 'epic', anon-select ок.
