Status: open
Type: task
Blocked by:

## Question

Что именно в клиенте сегодня трогает экономику и должно переехать на бэк? Без решений — только инвентаризация, чтобы следующие тикеты решали на фактах.

Пройти: `src/lib/wallet.ts` (getBalance/canAfford/spend/earn, START_BALANCE), `src/components/GambaModal.astro` (взвешенный исход, earn на выигрыше), `src/layouts/BaseLayout.astro` (показ баланса), `src/lib/outbid-notice.ts` (клиентский `Math.ceil(price*1.1)` для кнопки перекупа), `src/lib/supabase.ts` (`buyLotShared`, триггер считает цену). Зафиксировать полный список точек чтения/записи баланса и цены.

Ассет: ответ-список «файл:строка — что делает — что переезжает» прямо в тикете.
