/**
 * Окошки «твой лот перекупили» (правый нижний угол).
 *
 * Адаптер поверхности колокола к общему модулю уведомлений (lib/notice.ts):
 * собирает строку с раскрытой комиссией и кнопку возврата, показ — стек
 * showCornerNotice (максимум 3 окошка, старые вытесняются, hover удерживает).
 * Состояние, история и живые цены — в outbid-notice.ts и снапшоте lib/live.ts,
 * сюда прилетает готовое событие.
 */

import { sellerLine, type OutbidEvent } from './outbid-event';
import { live } from './live';
import { formatStaged, writeBuyIntent } from './buy-intent';
import { showCornerNotice } from './notice';

/** Живая N кнопки возврата из снапшота; неизвестна — null (честный «…»). */
function liveNext(slug: string): number | null {
  const next = live.lot(slug)?.nextPrice ?? null;
  return next !== null && Number.isFinite(next) && next > 0 ? next : null;
}

/** Подпись кнопки возврата: живая N или честный «…» (одна на создание и live-правку). */
export function rebuyLabel(price: number | null): string {
  return `▶ Забрать за ${formatStaged(price)} 🍺`;
}

/** Кнопка перекупа в стиле сайта (как «Купить» на карточках: bg-stream).
 *  N — из снапшота живых данных; пока прайс не приехал или вью отсутствует —
 *  честный «…» (намерение несёт price: null), а не уплаченная цена как N
 *  (сервер при записи всё равно подтвердит настоящую). */
export function makeRebuyButton(ev: OutbidEvent): HTMLButtonElement {
  const next = liveNext(ev.slug);
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
  // Живая кнопка: колокол правит текст и staged-цену по событию каталога.
  btn.dataset.rebuyLive = '1';
  return btn;
}

/** Показать окошко перекупа: шапка + строка продавца + кнопка возврата.
 *  Ключ — slug: выкуп обратно гасит окошки этого лота (closeNotices). */
export function showOutbidNotice(ev: OutbidEvent): void {
  showCornerNotice({
    header: '▶ Твой лот перекупили!',
    // Факт уплаченной цены сервера + раскрытая комиссия продавца (тикет 05);
    // живая N — на кнопке возврата.
    text: sellerLine(ev),
    action: makeRebuyButton(ev),
    key: ev.slug,
  });
}
