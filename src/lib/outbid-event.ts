/**
 * Событие «лот перекупили»: факт сделки, полностью разрешённый в месте
 * создания (outbid-notice.ts читает строку Realtime spokes — slug, title,
 * video, by, price — и кладёт готовое событие сюда).
 *
 * Никаких чтений DOM здесь нет: название/видео из каталога (fetchLotCatalog),
 * а не из отрисованных карточек — переименование data-атрибутов
 * больше не ломает уведомления молча.
 */

import { commissionFor } from './prices';

export interface OutbidEvent {
  slug: string;
  title: string;
  by: string;
  price: number;
  at: number;
  video: string | null;
}

/**
 * Строка продавца с раскрытой комиссией (ребаланс, тикет 05): сервер зачислил
 * цену минус 7% (display-mirror формулы тикета 01 из prices.ts), показываем
 * «получено N − комиссия», а не голую цену сделки.
 */
export function sellerLine(ev: OutbidEvent): string {
  const fee = commissionFor(ev.price);
  const net = ev.price - fee;
  return `${ev.by} забрал «${ev.title}» за ${ev.price} 🍺 — получено ${net} (комиссия ${fee})`;
}
