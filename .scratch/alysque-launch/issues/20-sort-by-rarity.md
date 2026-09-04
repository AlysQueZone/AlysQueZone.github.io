Status: resolved

## Task

Лоты отсортировать по редкости (решение человека): легендарный ЛУК первым как витрина, затем rare по убыванию цены, затем common (внутри группы — по убыванию цены).

## Scope (строго)

Централизованно в `src/lib/lots.ts` (сортировка при загрузке, чтобы лендинг-топ, биржа и порядок роутов были консистентны). Страницы/компоненты не перестраивать. НЕ трогать: конфиги, `astro.config.mjs`, стили, звуки, `data/lots.json` (порядок в файле не менять — сортировка в коде), чужие тикеты.

## Acceptance

- `npm run build` проходит; в `dist/lots/index.html` первым идет ЛУК, дальше rare (1200/800/700/600), потом common по убыванию.

## Done

Сортировка централизована в `src/lib/lots.ts` (копия `[...rawLots].sort`: legendary → rare → common, внутри группы цена по убыванию). `data/lots.json` не менялся. `npm run build` — 17 страниц OK. Порядок в `dist/lots/index.html`: luk-legend, lot-meme-nyachos (1200), lot-gedo-flat (800), lot-meme-mass (800), lot-meme-optom (700), lot-vandal-privet (600), дальше common 400/350/300/300/250/200/150/100.
