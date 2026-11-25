/**
 * Событие «лот перекупили»: факт сделки, полностью разрешённый в месте
 * создания — снапшот живых данных считает его из диффа владельцев каталога
 * (src/lib/live.ts), колокол только показывает.
 *
 * Никаких чтений DOM здесь нет: название/видео из каталога, а не из
 * отрисованных карточек — переименование data-атрибутов больше не ломает
 * уведомления молча.
 */

import { commissionFor } from './rules';
import type { LiveOutbid } from './live';

/** Событие перекупа — форма из ядра живых данных (один источник). */
export type OutbidEvent = LiveOutbid;

/**
 * Части строки продавца: ник отдельно, чтобы панель Колокольчика сделала из
 * него ссылку на профиль, не собирая предложение через `innerHTML`.
 */
export interface SellerLineParts {
  /** Ник покупателя — тут может стоять ссылка. */
  by: string;
  /** Хвост предложения: « забрал … — получено … (комиссия …)». */
  rest: string;
}

/**
 * Строка продавца с раскрытой комиссией: сервер зачислил
 * цену минус 7% (display-mirror формулы из rules.ts), показываем
 * «получено N − комиссия», а не голую цену сделки.
 */
export function sellerLineParts(ev: OutbidEvent): SellerLineParts {
  const fee = commissionFor(ev.price);
  const net = ev.price - fee;
  return {
    by: ev.by,
    rest: ` забрал «${ev.title}» за ${ev.price} 🍺 — получено ${net} (комиссия ${fee})`,
  };
}

/** Та же строка одной строкой: Всплывающие уведомления не строят DOM сами. */
export function sellerLine(ev: OutbidEvent): string {
  const parts = sellerLineParts(ev);
  return `${parts.by}${parts.rest}`;
}
