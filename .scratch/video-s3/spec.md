# Спека: видео-приветы + Supabase Storage (карта video-s3)

Все решения приняты на карте `.scratch/video-s3/map.md` (6/6 тикетов закрыты). Здесь — только стройка.

## Цель

Мем-приветы — инлайн-видео (старые 9 лотов — хотлинк MemeAlerts, будущие — наш Storage);
UI-звуки — публичный бакет `media`; `data/lots.json` удалён, каталог живёт в БД.

## 1. БД: одна миграция

Файл `supabase/migrations/<ts>_video_lots.sql`. Всё идемпотентно к живым данным
(Deploy to production применит сама при мерже в `main`):

- `alter table public.lots add column video_url text null`;
- `add column rarity text not null default 'common' check (rarity in ('common','rare','legendary'))`
  (дефолт — чтобы пройти на живых строках; после backfill дефолт можно снять);
- `add column meme_text text null`;
- Backfill `rarity`/`meme_text` по слагу из `data/lots.json` (читать файл до его удаления в §5;
  20 строк, вкл. `luk-legend` — его строка удаляется следующим шагом, backfill для него не нужен);
- Обнулить сид-владельцев только у лотов без живых покупок:
  `update public.lots set owner_uid=null, owner_twitch_id=null, owner_login=null
   where not exists (select 1 from public.purchases where lot_id = lots.id)`;
- Снос ЛУКа: `delete from public.lots where slug = 'luk-legend'`;
  `alter table public.lots drop column is_locked`;
  переписать `enforce_purchase_rules()` без `v_locked` (убрать select `is_locked` и exception
  `is not for sale`; пауза per-(user,lot), кап 10/10мин, цена +10% — без изменений);
- Бакет: `insert into storage.buckets (id, name, public) values ('media','media',true)
  on conflict (id) do nothing`
  (`file_size_limit`/mime — по документации creating-buckets; RLS не меняем:
  `lots_select_public` покрывает новые колонки; storage-политики не нужны —
  заливка идёт через Dashboard и обходит RLS).
- Проверка: `video_url`/`rarity`/`meme_text` читаются anon'ом; покупка живого лота проходит;
  `is_locked` нигде не упоминается (`grep is_locked` пуст, кроме истории миграций).

## 2. S3: заливка 6 UI-звуков (человек, Dashboard)

Бакет `media` уже создан миграцией §1. Залить drag&drop в `sounds/` (пути 1:1):
`clap.mp3`, `gamba-bg.mp3`, `gamba-win1k.mp3`, `gamba-win100k.mp3`, `m4-scum.mp3`, `outbid.mp3`
(9 мем-звуков `m1..r2` НЕ заливать — аудио заменено видео).
Приёмка: каждый открывается публичным URL
`https://<ref>.supabase.co/storage/v1/object/public/media/sounds/<file>.mp3` (ref — из MCP `get_project_url`).

## 3. Фронт: видео вместо аудио/постера

- Новый компонент видео V2 (прототип `.scratch/video-s3/prototype/inline-video.html`):
  webp-постер + оверлей «▶ смотреть»; клик → инлайн-`<video controls autoplay playsinline>`
  (`<source>` webm из `video_url` + mp4 заменой хвоста `alert_orig.webm`→`alert_orig.mp4`;
  постер — заменой на `.webp`). Один компонент на `LotCard.astro` и `lots/[id].astro`.
  При мёртвом URL остаётся постер.
- `fetchSharedLots` селектит `slug,title,rarity,meme_text,video_url,price,owner_login,owner_uid,updated_at`;
  `SharedLotState` расширить теми же полями. Владелец NULL — бейдж скрыт, кнопка покупки активна.
- История на `[id]`: только shared-хвост из `purchases` (статика `lot.history` удалена);
  пустое состояние — «Пока никто не забирал — стань первым» (старый текст упоминал ЛУК — удалить).
- `BuyModal`: при покупке играет видео лота со звуком (вместо `new Audio(entry.audio)`);
  лоты без `video_url` — clap как раньше. `data-lot-audio` → `data-lot-video`
  (кнопки `LotCard`/`[id]`, перекуп-кнопка в `outbid-notice.ts`: `resolveAudio` → `resolveVideo` из DOM).
- Звуковые URL на S3 (абсолютные, без `${base}`): `GambaModal` (4 файла), `outbid-notice.ts`
  (`soundUrl()`), `BuyModal` (clap-фолбэк).
- Удалить из интерфейса `Lot`: `audio`, `poster`, `forSale`, `clipUrl`; `meme` → `meme_text`
  (опционально, по чтению из shared). `emotes.ts`-маппинг по slug не трогать.
  Комментарий в `supabase.ts` («статика каталога из lots.json») переписать: каталог — из БД.
- SSG: `getStaticPaths` и топ-4 на главной читают слаги из БД на билде через
  `PUBLIC_SUPABASE_*`; без env билд падает явно (статического фолбэка больше нет).

## 4. Маппинг 9 лотов: миграция

`UPDATE`-миграция `video_url` по таблице `.scratch/video-s3/meme-mapping.md`
(9 URL, все проверены 2026-09-08: webm `206`, mp4/webp `200`):
`update public.lots set video_url = '<url>' where slug = '<lot>' and video_url is null;`
Повторный прогон безопасен (`... is null`).

## 5. Чистка

Удалить: `data/lots.json`, `public/sounds/*`, `public/memes/*`; `src/lib/lots.ts` — только
DB-типы/селекты (без импорта JSON). `grep` контроль: `sounds/`, `memes/`, `lots.json`,
`is_locked`, `clipUrl`, `data-lot-audio` — пусто вне истории миграций/`.scratch`.

## Порядок релиза (один релиз)

Миграция §1 → заливка §2 → фронт §3 → маппинг §4 → чистка §5 →
`npm run build` + открыть/покликать (правило AGENTS.md) → мерж в `main` (миграции применятся сами).

## Приёмка

Карточка показывает постер и играет видео со звуком по клику; покупка играет видео лота;
лоты без владельца покупаются (первый покупатель — первый владелец); история пуста до первой
покупки; `lots.json`/`sounds`/`memes` отсутствуют в сборке; ЛУК нигде не упоминается (код, UI, тексты).
