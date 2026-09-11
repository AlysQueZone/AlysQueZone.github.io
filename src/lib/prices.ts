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

export function commissionFor(pricePaid: number): number {
  if (!Number.isFinite(pricePaid) || pricePaid <= 0) return 0;
  return Math.max(1, Math.ceil(pricePaid * COMMISSION_RATE));
}
