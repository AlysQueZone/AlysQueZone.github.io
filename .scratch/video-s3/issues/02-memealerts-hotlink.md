# Хотлинк видео с MemeAlerts: что можно и как достать URL

Type: research
Status: open
Blocked by: none

## Question

Можно ли для 9 старых мем-лотов хотлинкать файлы MemeAlerts (`https://cdns.memealerts.com/p/.../alert_orig.webm`, страница `https://memealerts.com/alysque`, публичного API нет — нужен токен стримера): стабильность прямых URL, CORS/hotlink-защита, форматы (webm/mp4), есть ли постер/превью, поведение в `<video>` (стриминг, range-запросы), как человеку вручную достать URL для каждого мема без токена (curl страницы, devtools), что делать если URL протухает. Учесть: 0₽, открытие из РФ, бинарники не коммитить, звук из webm раньше добывали через `ffmpeg -i in.webm -vn -codec:a libmp3lame -q:a 5 out.mp3`. Итог — факты + пошаговая инструкция ручного съёма URL для тикета маппинга, без самого маппинга.

## Comments

- Research готов (ветка `research/memealerts-hotlink`): `.scratch/video-s3/research/02-memealerts-hotlink.md` — хотлинк без Referer-защиты и с `Access-Control-Allow-Origin: *`, Range/`206` работает, в каталоге мема лежат `alert_orig.webm` (VP9+Opus) + `alert_orig.mp4` (H.264, Safari-фолбэк) + `alert_orig.webp` (анимированный, на постер); съём URL человеком — ПКМ по видео на `memealerts.com/alysque` либо DevTools (Network-фильтр `cdns` / `<video src>`); тикет остаётся open до приёмки спеки, сам маппинг 9 лотов — в тикете 05.
