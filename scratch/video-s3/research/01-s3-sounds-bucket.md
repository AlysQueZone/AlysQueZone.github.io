# Research: бакет и переезд UI-звуков в Supabase Storage

Тикет: `scratch/video-s3/issues/01-s3-sounds-bucket.md`. Только факты, без исполнения заливки.

## 1. Инвентарь `public/sounds/` (15 файлов, ~1.08 МБ суммарно)

| Файл | Размер | Где используется |
|---|---|---|
| `clap.mp3` | 24 808 | `BuyModal.astro` (`data-clap-sound`), фолбэк для лотов без своего звука |
| `gamba-bg.mp3` | 100 486 | `GambaModal.astro` (`data-bg`, фон крутки) |
| `gamba-win1k.mp3` | 21 603 | `GambaModal.astro` (`data-win1k`) |
| `gamba-win100k.mp3` | 124 275 | `GambaModal.astro` (`data-win100k`) |
| `m4-scum.mp3` | 85 251 | `GambaModal.astro` (`data-lose`) — в `data/lots.json` НЕ используется |
| `outbid.mp3` | 46 073 | `src/lib/outbid-notice.ts` (`soundUrl()`) |
| `m1-nyachos.mp3` | 142 947 | `data/lots.json` → `lot-meme-nyachos` |
| `m2-optom.mp3` | 86 499 | `data/lots.json` → `lot-meme-optom` |
| `m3-mass.mp3` | 85 563 | `data/lots.json` → `lot-meme-mass` |
| `n1-repeat.mp3` | 71 139 | `data/lots.json` → `lot-meme-repeat` |
| `n2-remolol.mp3` | 31 707 | `data/lots.json` → `lot-meme-remolol` |
| `n3-salat.mp3` | 59 139 | `data/lots.json` → `lot-meme-salat` |
| `n4-quevizar.mp3` | 40 443 | `data/lots.json` → `lot-meme-quevizar` |
| `r1-myth.mp3` | 104 619 | `data/lots.json` → `lot-meme-myth` |
| `r2-evilzeg.mp3` | 57 675 | `data/lots.json` → `lot-meme-evilzeg` |

Все текущие ссылки строятся как `${base}sounds/<file>.mp3`, где `base = import.meta.env.BASE_URL` (`astro.config.mjs`: `base: '/'`).
В `lots.json` пути хранятся без base (`sounds/m1-nyachos.mp3`), base подставляется при рендере (`LotCard.astro`, кнопки `data-lot-audio`).

## 2. Рекомендованная раскладка

- Один публичный бакет **`media`** (решение карты: один публичный бакет на звуки + резерв под свои видео).
- Пути плоские, имена 1:1 для тривиального ремаппинга: `sounds/clap.mp3`, …, `sounds/r2-evilzeg.mp3`.
- Резерв под свои видео: префикс **`videos/`** (пустой до тикета своих видео; формат/поле — не здесь).
- Ограничения бакета при создании: `file_size_limit` ~50 МБ (покрывает mp3 и будущие webm/mp4; 50 МБ — потолок free-тарифа на файл),
  `allowed_mime_types` `['audio/*', 'video/*']`.

## 3. Ключевые факты (с источниками)

1. Публичный бакет читается без RLS: «public bucket effectively bypasses access controls for retrieving and serving files» — отдельная SELECT-политика для чтения не нужна. Источник: `https://supabase.com/docs/guides/storage/buckets/fundamentals` (раздел Access model → Public buckets).
2. Запись всегда под контролем RLS на `storage.objects`: по умолчанию аплоад без политик запрещён; для заливки нужен INSERT, для перезаписи через upsert — INSERT + SELECT + UPDATE. Источник: `https://supabase.com/docs/guides/storage/security/access-control`.
3. Бакет создаётся миграцией через SQL, а не `config.toml`: `insert into storage.buckets (id, name, public) values ('media', 'media', true);` — секция `[storage.buckets.*]` в `config.toml` действует только на локальный стек, а Deploy to production применяет именно миграции. Источник: `https://supabase.com/docs/guides/storage/buckets/creating-buckets` (подразделы SQL / Restricting uploads).
4. Публичный URL имеет фиксированный вид `https://<project_ref>.supabase.co/storage/v1/object/public/<bucket>/<path>` (или `getPublicUrl()` из SDK) — из статики Astro ссылаться полным абсолютным URL, а не `${base}`. Источник: `https://supabase.com/docs/guides/storage/serving/downloads` (раздел Public buckets).
5. Чем заливать: байты файлов — Dashboard (drag&drop), JS SDK `storage.from().upload()`, S3-совместимый API или curl; SQL-миграцией заливаются только бакет и политики, но не сами байты (бинарники не коммитить — standing preference карты). Источники: creating-buckets + `https://supabase.com/docs/guides/storage/uploads` (Standard Uploads, cURL-пример).
6. Free-тариф (проверено по `https://supabase.com/pricing` и `https://supabase.com/docs/guides/storage/serving/bandwidth`): 1 ГБ file storage, 5 ГБ uncached egress + 5 ГБ cached egress в месяц, макс. 50 МБ на файл, базовый CDN; наши ~1.08 МБ — ~0.1% квоты хранения, десятки тысяч проигрываний/мес укладываются в egress.
7. CDN кеширует все объекты Storage; у публичных бакетов высокий cache HIT ratio (авторизация не проверяется, второй пользователь в регионе получает HIT). Источник: `https://supabase.com/docs/guides/storage/cdn` (разделы Example, Public vs private buckets).
8. Версионирования объектов нет; перезапись (upsert) даёт рассинхрон CDN («CDN will take some time to propagate… stale content»), официально рекомендовано заливать новую версию новым путём, а не перезаписывать. Источник: `https://supabase.com/docs/guides/storage/uploads` (раздел Overwriting files). Вывод: `sounds/clap.v2.mp3` (или `sounds/v2/…`), не upsert поверх.
9. Per-объектный `cacheControl` при аплоаде задаёт заголовок `Cache-Control` (дефолт 3600 c) — длинные значения уместны именно при версионировании новым путём. Источник: JS Storage API docs (`upload` → `cacheControl`), смежно с uploads-guide.
10. РФ/статика: новых доменов не появляется — тот же `*.supabase.co`, что уже используют DB/Auth/Realtime; воспроизведение через `new Audio(url)` кросс-доменно работает без CORS (CORS нужен был бы только для WebAudio-`fetch`, а щелчки гамбы синтезируются, файлы не фетчатся). Проектное ограничение: free-проекты засыпают после 7 дней без активности (реактивация из дашборда) — см. pricing.
11. Что НЕ трогать сейчас: удаление `public/sounds/` и правки `GambaModal`/`BuyModal`/`outbid-notice.ts`/`lots.json` — порядок деплоя (миграция → заливка → правка фронта → маппинг URL) решает отдельный тикет карты; здешний итог — только раскладка выше.
