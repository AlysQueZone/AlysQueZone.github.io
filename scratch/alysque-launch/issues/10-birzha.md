Status: resolved
Blocked by: 08

## Task

Биржа `src/pages/lots/index.astro` + `LotCard` + `BuyModal` + confetti + «Мои приветы»: сетка всех 11 лотов из `data/lots.json` (бейдж редкости, моно-цены пивным золотом), фейк-покупка по спеке (модалка → баланс минус в `localStorage` → confetti → лот в «Мои приветы» → запись в историю локально → тост; не хватает → «пойжем жоско»; ЛУК disabled). Тянет `wallet.ts` из 08.

## Acceptance

- `npm run build` проходит; покупка меняет баланс и инвентарь, переживает reload (localStorage).
- ЛУК купить нельзя.

## Done

- `src/components/BuyModal.astro` — общий компонент покупки (переиспользует тикет 11):
  модалка «Потратить N Пивкойнов?», делегированный клиентский скрипт
  (кнопки через `data-buy-lot/*`), confetti, тосты в тоне канала,
  событие `alysque:bought`, рендер секции «Мои приветы».
- `src/lib/confetti.ts` — лёгкое confetti без зависимостей (~30 строк).
- `src/lib/wallet.ts` — дополнен без ломки API 08: `HISTORY_KEY`,
  `PurchaseRecord`, `owns()`, `getLocalHistory()` / `appendHistory()`
  («ты → владелец», карточка клеит поверх базовой истории).
- `src/components/LotCard.astro` — бейдж редкости, моно-цена пивным золотом,
  владелец, мем-строка, «Купить» → модалка; ЛУК — disabled «НЕ ПРОДАЕТСЯ».
- `src/pages/lots/index.astro` — сетка всех 11 лотов + «Мои приветы».
- `npm run build` проходит; `dist/lots/index.html`: 10 кнопок купить,
  ЛУК disabled, модалка/тост/каталог на месте, бандл покупки подключён.
  Логика wallet.ts прогнана в node: баланс 1000→750, инвентарь и история
  живут в localStorage, нехватка средств отклоняется.
