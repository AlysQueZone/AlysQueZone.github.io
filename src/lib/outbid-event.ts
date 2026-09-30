/**
 * Событие «лот перекупили»: факт сделки, полностью разрешённый в месте
 * создания — снапшот живых данных считает его из диффа владельцев каталога
 * (src/lib/live.ts), колокол только показывает.
 *
 * Никаких чтений DOM здесь нет: название/видео из каталога, а не из
 * отрисованных карточек — переименование data-атрибутов больше не ломает
 * уведомления молча.
 */

import { commissionFor } from './prices';
import type { LiveOutbid } from './live-store';

/** Событие перекупа — форма из ядра живых данных (один источник). */
export type OutbidEvent = LiveOutbid;

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
