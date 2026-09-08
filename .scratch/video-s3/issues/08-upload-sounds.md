# [Стройка] Заливка 6 UI-звуков в S3

Type: task
Status: resolved
Blocked by: 07

## Question

Человек заливает через Dashboard в бакет `media` (создан миграцией 07) папку `sounds/` 1:1
по §2 спеки: `clap.mp3`, `gamba-bg.mp3`, `gamba-win1k.mp3`, `gamba-win100k.mp3`, `m4-scum.mp3`,
`outbid.mp3` из `public/sounds/`. Мем-звуки `m1..r2` НЕ заливать (заменены видео).
В MCP заливки байтов нет — только Dashboard/SDK. Заблокировано созданием бакета (07).

## Comments

- Приёмка: 6 публичных URL `.../media/sounds/<file>.mp3` открываются (ref — MCP `get_project_url`).
- Залито скриптом `scripts/storage_upload.py` (SERVICE_ROLE, upsert) 2026-09-08: 6/6 URL отдают `206`, бакет `media` создан идемпотентным insert'ом (мерж 07 сделает no-op).
