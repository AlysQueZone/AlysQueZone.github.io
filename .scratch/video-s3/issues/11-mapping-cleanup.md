# [Стройка] Маппинг-миграция + удаление статики

Type: task
Status: open (ready-for-agent)
Blocked by: 07, 09

## Question

По §4–5 спеки: `UPDATE`-миграция 9 `video_url` из `.scratch/video-s3/meme-mapping.md`
(с `where video_url is null`); удалить `data/lots.json`, `public/sounds/*`, `public/memes/*`;
`src/lib/lots.ts` — без импорта JSON. Заблокировано колонками (07) и уходом фронта со статики (09).
Контроль: `grep` по `sounds/`, `memes/`, `lots.json`, `is_locked`, `clipUrl`, `data-lot-audio` пуст
вне миграций/`.scratch`. Skills: `supabase`, `supabase-postgres-best-practices`.

## Comments

- Приёмка: миграция идемпотентна; статики нет в сборке; билд зелёный.
