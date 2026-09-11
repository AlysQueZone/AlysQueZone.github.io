# Модель видео-лота и переезд lots.json в БД

Type: grilling
Status: resolved

## Answer

Решено гриллингом с человеком 2026-09-08 (2 раунда). Модель видео-лота:

- Видео — одно поле `video_url TEXT NULL` (webm вида `.../alert_orig.webm`); mp4 (Safari) и webp (постер) выводятся заменой хвоста URL, отдельных колонок и `video_source` нет.
- В БД едут: `rarity TEXT NOT NULL CHECK (common/rare/legendary)`, `meme_text TEXT NULL` (описание под карточкой).
- Владельцев на старте НЕТ: все `owner_uid/owner_twitch_id/owner_login` = NULL (сид-ники не привязаны к twitch-аккаунтам); первый покупатель — первый владелец. Backstory-история из `lots.json` НЕ переносится (без владельцев она бессмысленна), колонки `initial_history` не нужно; история = только живые `purchases`. Миграция обнуляет владельцев только у лотов без живых покупок (`WHERE NOT EXISTS`), живые цены/владельцы неприкосновенны.
- ЛУК снесён полностью: `DELETE luk-legend`, `DROP COLUMN is_locked`, вырезать LUK-ветку триггера `enforce_purchase_rules`, UI-ветку «НЕ ПРОДАЕТСЯ», термин из `CONTEXT.md` (уже вырезан). Поле `forSale` умирает (все лоты продаются), мёртвое `clipUrl` удалить, `audio`/`poster` удалить, `meme` → `meme_text`. Тир «легенда» в глоссарии остаётся (механизм на будущее, лотов пока нет).
- RLS не меняем (`lots_select_public` покрывает новые колонки; клиент их править не может). Маппинг видео — `UPDATE`-миграциями с `WHERE video_url IS NULL`.
- Контракт фронта (для спеки): `data-lot-audio` → `data-lot-video` (кнопки, BuyModal celebrate, outbid-алерт читает из DOM как сейчас); `fetchSharedLots` селектит новые колонки; витрина умеет рисовать владельца NULL; `emotes.ts`-маппинг по slug не трогаем. `CONTEXT.md`: Мем-лот → «Лот с видео; при покупке играет своё видео», термин ЛУК удалён.
- Разблокирует тикеты прототипа, ручного маппинга и пайплайна своих видео.
  Blocked by: 01, 02

## Question

Человек решил: видео ЗАМЕНЯЕТ аудио+постер, источник правды — БД (`data/lots.json` больше не нужен). Какая колонка в `public.lots` (имя `video_url`? + `video_source`: `memealerts`|`supabase`? нужен ли `poster_url` как фолбэк?), что станет с полями `audio`/`poster`/`meme`/`clipUrl` в интерфейсе `Lot` (`src/lib/lots.ts`), где живут rarity/history/forSale при переезде (в БД или часть остаётся статикой), как мигрировать сид (`seed_real_lots` + новые колонки, ON CONFLICT не затирает живых владельцев/цен), RLS на новые колонки, что с глоссарием «Мем-лот» в `CONTEXT.md` (звук+постер → видео; обновить inline при решении). Решить гриллингом с человеком (grilling + domain-modeling). Заблокировано фактами Storage (01) и MemeAlerts (02): без них схему не фиксируем.
