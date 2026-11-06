/**
 * Числа и строки «Правил биржи» — единственный модуль показа.
 *
 * Источник истины — SQL: здесь только display-mirror, рантайм-конфига нет.
 * Меняешь механику — правь SQL, этот файл и `docs/agents/economy.md`.
 * Указатели: комиссия — `public.commission_rate()`, роялти —
 * `public.royalty_rate()` (условие первых перекупов — `apply_purchase`),
 * бонус заявки — `public.pay_submission_reward()`, ежедневный вход —
 * `public.claim_daily()` (ставки из `daily_entry_boost`), гамба —
 * `public.spin_gamba` (`c_stake` / `c_daily_limit`), старт — `seed_opening`.
 *
 * Рост цены здесь — только текст показа (`growthLine`); формула и вычисление
 * живут в `public.next_lot_price`, клиентской формулы нет (docs/adr/0007).
 */

export const COMMISSION_RATE = 0.07;

export const ROYALTY_RATE = 0.03;

/** Сколько первых перекупов платят роялти (зеркало условия в apply_purchase). */
export const ROYALTY_PURCHASES = 3;

/** Разовый бонус за принятый привет — зеркало public.pay_submission_reward(). */
export const SUBMISSION_BONUS = 500;

/** Стартовый баланс счёта — зеркало seed_opening. */
export const START_BALANCE = 1000;

/** Награды ежедневного входа по дням цикла — зеркало claim_daily(). */
export const DAILY_REWARDS = [200, 200, 250, 150, 200, 250, 500] as const;

/** Фиксированная ставка Гамбы — зеркало c_stake в spin_gamba. */
export const GAMBA_STAKE = 100;

/** Дневной лимит спинов — зеркало c_daily_limit в spin_gamba. */
export const GAMBA_DAILY_LIMIT = 20;

/** Только для текста показа: формула роста — public.next_lot_price (ADR-0007). */
export const GROWTH_STEP_PCT = 10;

/** Сколько первых покупок роста — только для текста показа (ADR-0007). */
export const GROWTH_PURCHASES = 15;

export function commissionFor(pricePaid: number): number {
  if (!Number.isFinite(pricePaid) || pricePaid <= 0) return 0;
  return Math.max(1, Math.ceil(pricePaid * COMMISSION_RATE));
}

/** Проценты комиссии для показа: комиссия, роялти автору и остаток, что сгорает. */
export interface CommissionSplit {
  commissionPct: number;
  burnPct: number;
  royaltyPct: number;
}

/**
 * Единственный источник показа сплита комиссии (7% = 4% сгорает + 3% автору).
 * Роялти-ветка срабатывает, только если у привета есть автор (принят по
 * заявке): у лотов без автора сгорает вся комиссия.
 */
export function commissionSplit(): CommissionSplit {
  const commissionPct = Math.round(COMMISSION_RATE * 100);
  const royaltyPct = Math.round(ROYALTY_RATE * 100);
  return { commissionPct, burnPct: commissionPct - royaltyPct, royaltyPct };
}

/** Полная строка комиссии для окна «Правила биржи». */
export function commissionLine(): string {
  const { commissionPct, burnPct, royaltyPct } = commissionSplit();
  return (
    `Платит продавец из выручки (округление вверх, минимум 1): ${commissionPct}%. ` +
    `${burnPct}% сгорает, ${royaltyPct}% уходит автору привета, принятого по заявке, ` +
    `за первые ${ROYALTY_PURCHASES} перекупа; у лотов без автора сгорает вся комиссия. ` +
    `Покупатель платит ровно цену кнопки — без сюрпризов.`
  );
}

/** Строка награды за принятый привет — зеркало public.pay_submission_reward(). */
export function rewardLine(): string {
  const { royaltyPct } = commissionSplit();
  return `+${SUBMISSION_BONUS} сразу и ${royaltyPct}% с первых ${ROYALTY_PURCHASES} перекупов`;
}

/** Строка роста цены — только текст, без вычислений (docs/adr/0007). */
export function growthLine(): string {
  return `Первые ${GROWTH_PURCHASES} покупок — +${GROWTH_STEP_PCT}% (вверх, минимум +1), дальше +1`;
}

/** Полная строка ежедневного цикла для окна «Правила биржи». */
export function dailyCycleLine(): string {
  const [first, second, third, ...rest] = DAILY_REWARDS;
  return (
    `Дни 1–3: ${first} / ${second} / ${third}. ` +
    `Дальше: ${rest.join(' / ')} (7-й день), затем цикл заново. ${startBalanceLine()}.`
  );
}

/** Компактная строка ежедневного входа для бегущей строки. */
export function dailyShortLine(): string {
  return `вход ${DAILY_REWARDS.slice(0, 3).join(' / ')}…`;
}

/** Строка ставки и лимита Гамбы для окна и витрины. */
export function gambaLine(): string {
  return `ставка ${GAMBA_STAKE} · ${GAMBA_DAILY_LIMIT} спинов в день`;
}

/** Стартовый баланс для показа. */
export function startBalanceLine(): string {
  return `Старт — ${START_BALANCE}`;
}
