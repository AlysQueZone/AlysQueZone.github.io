# Модель видео-лота и переезд lots.json в БД

Type: grilling
Status: open
Blocked by: 01, 02

## Question

Человек решил: видео ЗАМЕНЯЕТ аудио+постер, источник правды — БД (`data/lots.json` больше не нужен). Какая колонка в `public.lots` (имя `video_url`? + `video_source`: `memealerts`|`supabase`? нужен ли `poster_url` как фолбэк?), что станет с полями `audio`/`poster`/`meme`/`clipUrl` в интерфейсе `Lot` (`src/lib/lots.ts`), где живут rarity/history/forSale при переезде (в БД или часть остаётся статикой), как мигрировать сид (`seed_real_lots` + новые колонки, ON CONFLICT не затирает живых владельцев/цен), RLS на новые колонки, что с глоссарием «Мем-лот» в `CONTEXT.md` (звук+постер → видео; обновить inline при решении). Решить гриллингом с человеком (grilling + domain-modeling). Заблокировано фактами Storage (01) и MemeAlerts (02): без них схему не фиксируем.
