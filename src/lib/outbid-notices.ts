/**
 * DOM окошек «твой лот перекупили» (правый нижний угол).
 *
 * Выделено из outbid-notice.ts (карта code-quality, распил монолита):
 * максимум 3 окошка, старые вытесняются, висят 20с, hover удерживает.
 * Состояние подписок и история — в outbid-notice.ts, сюда прилетают
 * готовое событие и карта живых цен.
 */

import { resolveVideo, sellerLine, type OutbidEvent } from './outbid-event';

export const MAX_NOTICES = 3;
const NOTICE_TTL_MS = 20000;
const LEAVE_TTL_MS = 3000;
const CORNER_ID = 'outbid-corner';

/** Живая N из прайс-фида БД (src/lib/prices.ts): slug → следующая цена. */
export type LivePrices = Map<string, number>;

/** Кнопка перекупа в стиле сайта (как «Купить» на карточках: bg-stream).
 *  N — из подписки на БД; пока прайс не приехал или вью отсутствует — честный
 *  «…» вместо факта уплаченной цены как N (сервер при записи всё равно
 *  подтвердит настоящую). */
export function makeRebuyButton(ev: OutbidEvent, liveNext: LivePrices): HTMLButtonElement {
  const next = liveNext.get(ev.slug);
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = next !== undefined ? `▶ Забрать за ${next} 🍺` : '▶ Забрать за … 🍺';
  // Аркадная кнопка стиля C (классы из global.css) + отступ от текста.
  btn.className = 'btn-arcade btn-arcade-primary';
  btn.style.marginTop = '8px';
  btn.style.padding = '8px 16px';
  btn.style.fontSize = '14px';
  btn.dataset.buyLot = ev.slug;
  btn.dataset.lotTitle = ev.title;
  // Staged — живая N, иначе текущая уплаченная (сервер пересчитает настоящую).
  btn.dataset.lotPrice = String(next ?? ev.price);
  btn.dataset.lotOwner = ev.by;
  // Живая кнопка: refreshPrices() правит текст и staged-цену по подписке.
  btn.dataset.rebuyLive = '1';
  const video = resolveVideo(ev.slug);
  if (video) btn.dataset.lotVideo = video;
  return btn;
}

export function ensureCorner(): HTMLElement {
  let corner = document.getElementById(CORNER_ID);
  if (corner instanceof HTMLElement) return corner;
  corner = document.createElement('div');
  corner.id = CORNER_ID;
  corner.setAttribute('aria-live', 'polite');
  corner.style.position = 'fixed';
  corner.style.right = '12px';
  corner.style.bottom = '12px';
  corner.style.display = 'flex';
  corner.style.flexDirection = 'column';
  corner.style.gap = '8px';
  corner.style.maxWidth = '320px';
  corner.style.zIndex = '60';
  document.body.appendChild(corner);
  return corner;
}

export function showNotice(corner: HTMLElement, ev: OutbidEvent, liveNext: LivePrices): void {
  const box = document.createElement('div');
  box.dataset.outbidSlug = ev.slug;
  // Окошко — карточка стиля C (фон/рамка/тень из .card-pixel),
  // раскладка прежняя.
  box.className = 'card-pixel';
  box.style.padding = '10px 12px';
  box.style.fontSize = '14px';
  const head = document.createElement('b');
  head.className = 'font-display';
  head.style.display = 'block';
  head.style.fontSize = '10px';
  head.style.textTransform = 'uppercase';
  head.style.marginBottom = '4px';
  head.textContent = '▶ Твой лот перекупили!';
  const text = document.createElement('span');
  // Факт уплаченной цены сервера + раскрытая комиссия продавца (тикет 05);
  // живая N — на кнопке возврата ниже.
  text.textContent = sellerLine(ev);
  const btn = makeRebuyButton(ev, liveNext);
  btn.addEventListener('click', () => {
    window.setTimeout(() => box.remove(), 0);
  });
  box.append(head, text, document.createElement('br'), btn);
  corner.appendChild(box);
  while (corner.children.length > MAX_NOTICES) corner.firstChild?.remove();
  let timer = window.setTimeout(() => box.remove(), NOTICE_TTL_MS);
  box.addEventListener('mouseenter', () => {
    window.clearTimeout(timer);
  });
  box.addEventListener('mouseleave', () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => box.remove(), LEAVE_TTL_MS);
  });
}
