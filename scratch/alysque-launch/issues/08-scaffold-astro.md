Status: resolved

## Task

Scaffold Astro-проекта по спеке (`../spec.md`, разделы «Стек и деплой», тикет 03): `astro.config.mjs` (`site`, `base: '/<repo>/'`, tailwind-vite-плагин), `package.json` (scripts dev/build/preview/deploy через gh-pages), `src/styles/global.css` (бренд-токены `@theme`: `#0E0E10`/`#18181B`/`#9146FF`/`#FF9E2C`/`#FF4D6D`/`#F5C518` + пипетка 2–3 цветов с баннера из тикета 02), `src/lib/lots.ts` + `wallet.ts` (типы по схеме 04, localStorage-баланс 1000), `data/lots.json` (11 лотов из спеки), `src/layouts/BaseLayout.astro`, `public/` (favicon/og, бинарники не коммитить — только хотлинки Twitch-CDN из 02).

## Acceptance

- `npm install && npm run build` проходит, `dist/` собирается.
- `data/lots.json` валиден против схемы (11 записей, у ЛУКа price 9999).
- Ничего лишнего: страниц пока нет (они в 09–11).

## Done

- Scaffold готов: `package.json` (astro ^7.2.9, typescript ^5, tailwindcss ^4.3.3, @tailwindcss/vite ^4.3.x, gh-pages ^6.3.0; scripts dev/build/preview/deploy), `astro.config.mjs` (site + base `/AlysQueZone/`, tailwind-vite-плагин), `tsconfig.json` (extends astro strict), `src/styles/global.css` (`@import "tailwindcss"` + `@theme`: void `#0E0E10`, panel `#18181B`, milk `#FFFFFF`, mist `#EFEFF1`, stream `#9146FF`, ember `#FF9E2C`, melon `#FF4D6D`, pivko `#F5C518` + rind `#3ECF6E` из бренд-листа 02; пипетка с баннера невозможна — Twitch рендерится JS, hex не снять, взято из тикета 02 как есть).
- `src/lib/lots.ts` (Lot/HistoryEntry/Rarity по схеме 04 + `forSale` флаг для ЛУКа, getLot/getLotIds), `src/lib/wallet.ts` (ключи `pivkoiny_balance`/`pivkoiny_inventory`, старт 1000, get/canAfford/spend/addToInventory/getInventory, SSR-safe через hasStorage).
- `data/lots.json`: 11 лотов из спеки, у `luk-legend` price 9999, rarity legendary, forSale false.
- `src/layouts/BaseLayout.astro` (тёмный фон, шапка с балансом из wallet.ts), `public/favicon.svg` (заглушка; бинарники Twitch не коммитились, только хотлинки потом).
- `.gitignore`: добавлены `node_modules/`, `dist/`, `.astro/`.
- Проверка: `npm install && npm run build` — проходит (0 pages, они в 09–11; варнинг Missing pages directory ожидаем). `dist/` собирается (favicon.svg). lots.json валиден: 11 записей, id уникальны, ЛУК 9999.
- Тестов в проекте нет (не предусмотрены спекой) — зафиксировано.
- Страницы 09–11 не делались.
