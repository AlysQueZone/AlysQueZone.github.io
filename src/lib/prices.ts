/**
 * Комиссия биржи — display-mirror серверной формулы (тикет 01, ставка одним
 * числом в public.commission_rate(), review-fix US-17): ceil(7%), минимум 1,
 * платит продавец из выручки. Только для показа «получено N − комиссия»
 * в уведомлениях и правилах, деньги считает только БД.
 * Секретов здесь нет: чистая функция без доступа к хранилищу.
 *
 * Живой каталог и прайс-фид живут в lib/lots.ts (fetchLotCatalog):
 * этот модуль — только математика показа комиссии.
 */

export const COMMISSION_RATE = 0.07;

/**
 * Ставка роялти — display-mirror серверной public.royalty_rate() (тикет 11):
 * 3% цены сделки автору привета за первые ROYALTY_PURCHASES перекупов,
 * из комиссии биржи (7% = 4% сгорает + 3% автору). Только для показа.
 */
export const ROYALTY_RATE = 0.03;

/** Сколько первых перекупов платят роялти (зеркало условия в apply_purchase). */
export const ROYALTY_PURCHASES = 3;

/** Разовый бонус за принятый привет — зеркало public.pay_submission_reward(). */
export const SUBMISSION_BONUS = 500;

export function commissionFor(pricePaid: number): number {
  if (!Number.isFinite(pricePaid) || pricePaid <= 0) return 0;
  return Math.max(1, Math.ceil(pricePaid * COMMISSION_RATE));
}
