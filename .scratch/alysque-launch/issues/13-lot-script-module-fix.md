Status: resolved

## Task

Баг из приемки тикета 12: инлайн-`<script>` на страницах лотов (`src/pages/lots/[id].astro`) содержит `import` вне модуля → SyntaxError в консоли, не работает живое обновление локальной истории после покупки (сама покупка работает). Починить минимумом: либо `type="module"`, либо вынос в `src/lib/*.ts` с импортом как модуль — как принято в кодбазе (смотреть как подключен скрипт покупки из 10). Поведение после фикса: покупка с карточки дописывает историю и меняет владельца на «ты» без reload.

## Acceptance

- `npm run build` проходит; в `dist/lots/<id>/index.html` нет немодульного `import`; в headless-браузере (если доступен) или ручной проверкой скрипта — SyntaxError ушел.
- Деплоить НЕ надо (деплой — отдельно после всех фиксов).

## Done

Убран `define:vars` (он форсил инлайн-скрипт без бандлинга → `import` вне модуля и SyntaxError).
`lot.id`/`lot.owner` теперь едут через `data-lot-history`/`data-lot-id`/`data-lot-owner` на секции истории,
скрипт — обычный `<script>` с `import` из `../../lib/wallet.ts`, как `BuyModal` из тикета 10 (Astro бандлит в `type="module"`).
Селектор владельца уточнён до `b[data-lot-owner]` (на странице несколько `data-lot-owner`).
Проверка: `npm run build` OK, во всех 11 `dist/lots/*/index.html` только `<script type="module" src=...>`, инлайн-`import` нет.
