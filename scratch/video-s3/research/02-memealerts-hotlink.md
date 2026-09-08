# Research: хотлинк видео с MemeAlerts

Тикет: `scratch/video-s3/issues/02-memealerts-hotlink.md`. Только факты + пошаговая инструкция ручного съёма URL для тикета маппинга (05). Самого маппинга здесь нет.

Маппить предстоит 9 мем-лотов из `data/lots.json`: `lot-meme-nyachos` (m1), `lot-meme-optom` (m2), `lot-meme-mass` (m3), `lot-meme-repeat` (n1), `lot-meme-remolol` (n2), `lot-meme-salat` (n3), `lot-meme-quevizar` (n4), `lot-meme-myth` (r1), `lot-meme-evilzeg` (r2). Сейчас у каждого `audio: sounds/*.mp3` + `poster: memes/*.jpg`; после переезда поле видео заменит связку аудио+постер.

Проверено 2026-09-08 живыми запросами (только `curl -I` и Range-первые-байты, бинарники в репо не клались, временные файлы только в `/tmp` и удалены).

## 1. Ключевые факты (с источниками)

1. Шаблон прямого URL: `https://cdns.memealerts.com/p/<packId>/<fileId>/alert_orig.webm` — примеры живых URL взяты из комментариев и debug-константы стороннего опенсорс-проекта `potapello/videoalerts` (`main.js`, `views/obs-screen.html`, коммит `9ffbb3d`). Источник: поиск по репозиторию `https://github.com/potapello/videoalerts`.
2. Хотлинк разрешён, защиты по Referer нет: `GET` с чужими `Referer: https://alysquezone.example/` и `Origin` отдаёт `206`, контент целиком. Токена в URL нет. Источник: собственный `curl` к `cdns.memealerts.com` (заголовки ниже в §3).
3. CORS открыт: ranged-`GET` с `Origin` возвращает `access-control-allow-origin: *` (+ `access-control-expose-headers: Content-Range`), в `Vary` есть `Origin`. Для самого `<video>` CORS вообще не нужен (media грузится без CORS); CORS пригодится только для canvas/fetch. Источник: собственный `curl`.
4. Стриминг/перемотка работают: `accept-ranges: bytes`, ответ на `Range: bytes=0-0` — `206` с `Content-Range: bytes 0-0/135132`. `<video>` будет играть прогрессивно и мотать без докачки всего файла. Источник: собственный `curl`.
5. Формат `alert_orig.webm` — VP9 видео + Opus аудио (проверено `ffprobe`; тестовый файл 170×170, квадратный мем). Звук из webm добывается рецептом из AGENTS.md: `ffmpeg -i in.webm -vn -codec:a libmp3lame -q:a 5 out.mp3` (Opus→mp3, `ffmpeg`/`ffprobe` есть локально). Источник: собственный `ffprobe` + AGENTS.md.
6. В том же каталоге лежат готовые варианты (проверены `HEAD`, все `200`): `alert_orig.mp4` (`video/mp4`, `ftyp isom/avc1` — H.264, фолбэк для Safari, где webm/VP9 может не играть), `alert.webm` (альтернативный енкод), `alert_orig.webp` (`image/webp`, RIFF+VP8X+AN — анимированный webp 7.5 КБ, годится на `poster`/превью). `alert_preview.webm`, `preview.jpg`, `poster.jpg` — `404`, таких имён нет. Источник: собственный `curl`.
7. Стабильность: URL эпохи 2023 года до сих пор отдаёт `200`; оба проверенных файла живы (Last-Modified обоих — июль 2025, т.е. контент пережил как минимум миграцию хранилища). SLA нет: ID в пути непрозрачные — стример может удалить/перезалить мем, и URL сменится. Источник: собственный `curl` + комменты `potapello/videoalerts`.
8. Открытие из РФ: `memealerts.com` и `cdns.memealerts.com` 2026-09-08 отвечают напрямую, без VPN (проверено из этого окружения). Геоблока не наблюдалось. Источник: собственный `curl`.
9. Публичного API каталога нет (нужен токен стримера — см. AGENTS.md; `developers`-страница требует заявку на `support@memealerts.com`). Но страница канала `https://memealerts.com/alysque` — SPA (SSR-шелл всего 3373 Б), каталог стикеров виден анонимно в браузере (поисковики индексируют имена/цены стикеров страниц каналов). Эндпоинт поиска `POST https://memealerts.com/api/sticker/streamer-area/search` публичный (без кук возвращает JSON, не `401`), отдаёт поля `name` + `alertUrl`, но требует `streamerId` в теле — а резолв имени в ID (`POST user/find/streamer`) требует авторизации (`401` без токена, проверено). Вывод: человек снимает URL/ID через браузер (DevTools), а не через голый curl. Источники: `find.js` проекта `https://memealerts-url-finder.netlify.app/`, бандл `https://memealerts.com/index-*.js` (константы `HOST_API`, `sticker/streamer-area/search`, `user/find/streamer`), собственные `curl`-пробы.
10. Автоплей со звуком в карточке не взлетит: muted-автоплей разрешён всегда, autoplay со звуком — только после жеста/MEI (Chrome) — значит инлайн-видео либо `muted+playsinline+autoplay` с кнопкой unmute, либо click-to-play; детали — за тикетом прототипа (04). Источники: `https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Autoplay`, `https://developer.chrome.com/blog/autoplay`.

## 2. Пошаговая инструкция ручного съёма URL (для тикета 05, без токена)

Способ А — самый простой (подтверждён README `potapello/videoalerts`: «можно получить на сайте https://memealerts.com/, нажав ПКМ на открытом видео и скопировав прямую ссылку»):

1. Открыть `https://memealerts.com/alysque` в десктопном Chrome/Firefox (залогиниваться НЕ нужно).
2. Найти мем из списка (имена соответствуют мемам канала; сверить с названием/звуком лота).
3. Открыть/кликнуть мем, чтобы видео заиграло → ПКМ по видео → «Копировать адрес видео» → получается `https://cdns.memealerts.com/p/.../alert_orig.webm`.
4. Вставить URL в новую вкладку — видео должно открыться/заиграть напрямую (проверка, что это файл, а не страница).
5. Производные получать заменой хвоста: `alert_orig.mp4` (Safari-фолбэк), `alert_orig.webp` (постер). Каждый проверить открытием в новой вкладке (`200`, нужный content-type видно в DevTools → Network).
6. Записать в таблицу маппинга (тикет 05): lot-id → webm-URL (+ mp4-URL, webp-URL).

Способ Б — через DevTools (если ПКМ перехвачено плеером):

1. `F12` → вкладка Network → фильтр `cdns` (или `media`).
2. Перезагрузить страницу / покликать мемы → в списке появятся запросы к `cdns.memealerts.com` → ПКМ → Copy URL (это и есть `alertUrl`).
3. Альтернатива: вкладка Elements → найти `<video src="https://cdns.memealerts.com/...">` → скопировать `src`.
4. Заодно в Network видны тела API-ответов (`name`, `alertUrl`) и `streamerId` канала (24-hex) — пригодится, если позже захочется полуавтоматизировать добор через `sticker/streamer-area/search`.

Способ В — через API без токена (для продвинутых, по коду `find.js` из `memealerts-url-finder`):

1. Взять `streamerId` alysque из DevTools (см. шаг 4 способа Б).
2. `POST https://memealerts.com/api/sticker/streamer-area/search`, JSON-тело `{"pageSize":50,"skip":0,"searchQuery":"<кусок названия>","streamerId":"<id>"}` → в ответе элементы с `name` и `alertUrl`.

## 3. Сырые заголовки (приложение)

`HEAD alert_orig.webm` (без Referer, 2026-09-08): `HTTP/2 200`, `server: nginx`, `content-type: video/webm`, `content-length: 135132`, `etag`, `last-modified: Fri, 18 Jul 2025 10:23:41 GMT`, `cache-control: max-age=1036800` (12 суток edge-кэша), `accept-ranges: bytes`, `x-cdn-edge-cache: HIT`.

`GET Range 0-0` с чужими `Referer`+`Origin`: `HTTP/2 206`, `content-length: 1`, `content-range: bytes 0-0/135132`, `access-control-allow-origin: *`, `access-control-expose-headers: Content-Range`.

## 4. Что делать, если URL протух

1. Симптом: `<video>` пустое / в Network `404` (или `403`, если вдруг включат защиту) на `cdns.memealerts.com`.
2. Повторить способ А/Б для этого мема: если мем жив на странице канала — взять новый URL и обновить маппинг (поле в БД должно быть правимым без деплоя — требование к тикету модели 03).
3. Если мема больше нет на странице (стример удалил) — лот остаётся, но с фолбэком: постер-заглушка / hide-карточки / копия к себе как план Б — выбор зафиксирован в `map.md` «Not yet specified», решение принимает человек на тикете 03/05.
4. Профилактика: при маппинге сразу сохранять все три варианта (webm+mp4+webp) — переживёт точечную порчу одного енкода; периодически (вручную, раз в пару месяцев) открывать все 9 URL и проверять `200`.
