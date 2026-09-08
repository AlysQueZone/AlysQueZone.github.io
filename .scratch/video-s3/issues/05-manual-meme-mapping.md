# Ручной маппинг 9 мем-лотов на файлы MemeAlerts

Type: task
Status: resolved

## Answer

Человек вернул маппинг 2026-09-08 — все 9 webm URL в `.scratch/video-s3/meme-mapping.md`. Агент проверил: каждый webm — `206 video/webm`, производные mp4 (`200 video/mp4`) и webp (`200 image/webp`) существуют. Маппинг идёт в UPDATE-миграцию (`video_url`, `WHERE video_url IS NULL`) при имплементации. Тикет закрыт приёмкой.
Blocked by: 02

## Question

Человек вручную подбирает видео с MemeAlerts для существующих карточек (m1-nyachos, m2-optom, m3-mass, n1-repeat, n2-remolol, n3-salat, n4-quevizar, r1-myth, r2-evilzeg). Агент готовит таблицу-чеклист (лот → текущий audio/poster → поле под URL MemeAlerts → статус проверки), человек заполняет URL по инструкции из тикета хотлинка и возвращает заполненный маппинг. Ничего не качаем и не коммитим, только таблица + критерии приёмки URL (открывается из РФ, играет в `<video>`, звук есть). Заблокировано инструкцией съёма URL (02).

## Comments

- 2026-09-08: таблица-чеклист готова — `.scratch/video-s3/meme-mapping.md` (9 лотов, заполнять только webm, mp4/webp выводятся). Ждём заполненный маппинг от человека; тикет закроется приёмкой.
