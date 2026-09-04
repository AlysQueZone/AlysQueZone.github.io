Status: resolved
Blocked by: 08

## Task

Карточка привета `src/pages/lots/[id].astro` (`getStaticPaths` по `data/lots.json`): владелец, история перепродаж, мем-строка, кнопка «купить» с той же модалкой/покупкой что в 10 (общий компонент/либа, без копипасты логики). `404.astro` тоже здесь.

## Acceptance

- `npm run build` проходит, все 11 роутов пререндерены, несуществующий id → 404.

## Done

- `src/pages/lots/[id].astro`: `getStaticPaths` по `lots.ts`, бейдж редкости, владелец, цена, мем-строка, история (базовая + локальная из `wallet.getLocalHistory`, живое обновление по `alysque:bought`), кнопка «купить» с теми же `data-buy-lot/*` + общий `BuyModal` без копипасты логики, ЛУК — disabled «НЕ ПРОДАЕТСЯ».
- `src/pages/404.astro`: «404. ПРИВЕТ НЕ НАЙДЕН» в тоне канала, ссылки на биржу/главную.
- `npm run build` проходит: 14 страниц, все 11 `dist/lots/*/index.html` + `dist/404.html`, несуществующий id роута не имеет.
