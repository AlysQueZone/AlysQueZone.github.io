/**
 * Событие «лот перекупили» + чистые помощники чтения факта из DOM.
 *
 * Выделено из outbid-notice.ts (карта code-quality, распил монолита):
 * здесь только тип события и функции без состояния подписок.
 */

import { commissionFor } from './prices';

export interface OutbidEvent {
  slug: string;
  title: string;
  by: string;
  price: number;
  at: number;
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

function readCatalogTitle(slug: string): string | null {
  try {
    const tag = document.querySelector('[data-lots-catalog]');
    if (!tag?.textContent) return null;
    const parsed: unknown = JSON.parse(tag.textContent);
    if (!Array.isArray(parsed)) return null;
    for (const row of parsed as Record<string, unknown>[]) {
      if (row['id'] === slug && typeof row['title'] === 'string') return row['title'];
    }
  } catch {
    // каталога нет — fallback ниже
  }
  return null;
}

export function resolveTitle(slug: string): string {
  const card = document.querySelector(`[data-lot-card="${CSS.escape(slug)}"]`);
  const heading = card?.querySelector('h3');
  const fromCard = heading?.textContent?.trim();
  if (fromCard) return fromCard;
  return readCatalogTitle(slug) ?? slug;
}

/** Видео лота из уже отрисованной кнопки «Купить» (модалка играет его вместо хлопков). */
export function resolveVideo(slug: string): string | null {
  try {
    const btn = document.querySelector(`[data-buy-lot="${CSS.escape(slug)}"]`);
    const src = btn instanceof HTMLElement ? btn.dataset.lotVideo : undefined;
    return src && src.length > 0 ? src : null;
  } catch {
    return null;
  }
}
