/**
 * Окошки «твой лот перекупили» (правый нижний угол).
 *
 * Адаптер поверхности колокола к общему модулю уведомлений (lib/notice.ts):
 * собирает строку с раскрытой комиссией и кнопку возврата, показ — стек
 * showCornerNotice (максимум 3 окошка, старые вытесняются, hover удерживает).
 * Состояние подписок и история — в outbid-notice.ts, сюда прилетают готовое
 * событие и карта живых цен.
 */

import { sellerLine, type OutbidEvent } from './outbid-event';
import { formatStaged, writeBuyIntent } from './buy-intent';
import { showCornerNotice } from './notice';

/** Живая N из каталога БД (src/lib/lots.ts): slug → следующая цена. */
export type LivePrices = Map<string, number>;

/** Подпись кнопки возврата: живая N или честный «…» (одна на создание и live-правку). */
export function rebuyLabel(price: number | null): string {
  return `▶ Забрать за ${formatStaged(price)} 🍺`;
}

/** Кнопка перекупа в стиле сайта (как «Купить» на карточках: bg-stream).
 *  N — из подписки на БД; пока прайс не приехал или вью отсутствует — честный
 *  «…» (намерение несёт price: null), а не уплаченная цена как N (сервер при
 *  записи всё равно подтвердит настоящую). */
export function makeRebuyButton(ev: OutbidEvent, liveNext: LivePrices): HTMLButtonElement {
  const next = liveNext.get(ev.slug) ?? null;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = rebuyLabel(next);
  // Аркадная кнопка стиля C (классы из global.css) + отступ от текста.
  btn.className = 'btn-arcade btn-arcade-primary';
  btn.style.marginTop = '8px';
  btn.style.padding = '8px 16px';
  btn.style.fontSize = '14px';
  // Намерение — один слот (lib/buy-intent.ts), не пять атрибутов вразнобой.
  writeBuyIntent(btn, {
    slug: ev.slug,
    title: ev.title,
    price: next,
    owner: ev.by,
    video: ev.video,
  });
  // Живая кнопка: refreshPrices() правит текст и staged-цену по подписке.
  btn.dataset.rebuyLive = '1';
  return btn;
}

/** Показать окошко перекупа: шапка + строка продавца + кнопка возврата.
 *  Ключ — slug: выкуп обратно гасит окошки этого лота (closeNotices). */
export function showOutbidNotice(ev: OutbidEvent, liveNext: LivePrices): void {
  showCornerNotice({
    header: '▶ Твой лот перекупили!',
    // Факт уплаченной цены сервера + раскрытая комиссия продавца (тикет 05);
    // живая N — на кнопке возврата.
    text: sellerLine(ev),
    action: makeRebuyButton(ev, liveNext),
    key: ev.slug,
  });
}
