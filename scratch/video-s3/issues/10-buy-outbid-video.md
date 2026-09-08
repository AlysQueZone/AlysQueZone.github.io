# [Стройка] Покупка и перекуп на видео + звуки с S3

Type: task
Status: resolved
Blocked by: 08, 09

## Question

По §3 спеки: `BuyModal` играет видео лота со звуком при покупке (clap — только лотам без
`video_url`); `data-lot-audio` → `data-lot-video` везде (`LotCard`, `[id]`, перекуп-кнопка);
`outbid-notice.ts`: `resolveAudio` → `resolveVideo`; абсолютные S3-URL в `GambaModal` (4 файла),
`soundUrl()`, clap-фолбэке (без `${base}`). Заблокировано заливкой звуков (08) и видео-UI (09).
Локально: `npm run build` + покликать покупку.

## Comments

- Приёмка: покупка играет видео; перекуп-алерт с видео; все звуки грузятся с S3-URL.
- 2026-09-08: готово — BuyModal играет video лота (clap с S3 как фолбэк), data-lot-video везде, resolveVideo, 6 S3-URL абсолютные, build зелёный (23 стр.).
