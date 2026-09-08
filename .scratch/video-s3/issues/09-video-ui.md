# [Стройка] Видео-UI: карточки, страница лота, каталог из БД

Type: task
Status: open (ready-for-agent)
Blocked by: 07

## Question

Фронт по §3 спеки (без покупки/перекупа — это тикет 10): V2-компонент
(прототип `.scratch/video-s3/prototype/inline-video.html`) в `LotCard.astro` и `lots/[id].astro`;
`fetchSharedLots` + `SharedLotState` с новыми полями; владелец NULL; история только из `purchases`
+ новый пустой текст; SSG/`getStaticPaths`/топ-4 из БД на билде; чистка интерфейса `Lot`
(`-audio/-poster/-forSale/-clipUrl`, `meme`→`meme_text`); комментарий в `supabase.ts`.
`emotes.ts` не трогать. Заблокировано колонками в БД (07). Локально: `npm run build` + покликать.

## Comments

- Приёмка: постер→видео по клику; нет владельца — нет бейджа, покупка активна; билд без env падает явно.
