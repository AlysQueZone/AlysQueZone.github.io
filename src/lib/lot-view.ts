/**
 * Представление Лота: один набор слотов на витрину, страницу Лота и главную.
 *
 * Кандидат E архитектурного ревью (решение — docs/adr/0009): заполнение было
 * ручной последовательностью в трёх местах — `fillCard` на витрине,
 * `fillDetail` на странице, ручной miniCard на главной; контракт слотов,
 * ориентация кадра и ссылка на лот жили в коде страниц.
 *
 * Контракт: поверхность даёт корень и `LotState`, модуль заполняет все
 * стандартные слоты, какие есть в корне, в одном порядке:
 * - `[data-lot-link]` — ссылка на страницу Лота (`lotUrl`);
 * - `[data-lot-title]` — заголовок с эмоутами (`lib/emotes.ts`);
 * - `[data-lot-video-root]` — видео; ориентация кадра — на кадр
 *   (`data-media-orientation`, для CSS), подложка квадрата — карточкам;
 * - `[data-owner-badge]` / `[data-free-badge]` / `[data-mine-badge]` — бейджи;
 * - `[data-buy-intent]` — кнопка покупки (`lib/buy-intent.ts`).
 * Свои поля поверхность правит сама: title документа и автор привета —
 * страница Лота, сортировка и reconcile — витрина.
 */
import { setTitleEmotes } from './emotes';
import { fillVideo, initLotVideos, type MediaOrientation } from './lot-video';
import { buyAvailability, formatStaged, writeBuyIntent } from './buy-intent';
import type { LotState } from './lots';

/** Адрес страницы Лота — один на все поверхности (`?id=` — slug). */
export function lotUrl(slug: string): string {
  return `${import.meta.env.BASE_URL}lot/?id=${encodeURIComponent(slug)}`;
}

export interface LotViewOptions {
  /** Баланс — зеркало серверного гейта: не хватает — кнопка гаснет. */
  balance?: number | null;
}

/**
 * Нарисовать Лот в корне: какие слоты есть — те и заполняются (пустая
 * мини-разметка получит только своё). Вызов идемпотентен: живое видео
 * `fillVideo` не трогает, заголовок и бейджи перезаписываются.
 */
export function fillLot(root: Element | null, st: LotState, opts: LotViewOptions = {}): void {
  if (!(root instanceof HTMLElement)) return;

  const link = root.querySelector('[data-lot-link]');
  if (link instanceof HTMLAnchorElement) link.href = lotUrl(st.slug);

  setTitleEmotes(root.querySelector('[data-lot-title]'), st.title);

  const media = root.querySelector<HTMLElement>('[data-lot-video-root]');
  if (media) {
    if (st.video_url) {
      // Пропорцию постера сообщает lot-video после загрузки картинки.
      fillVideo(media, st.video_url, (orientation, frame, poster) =>
        applyFrameLayout(frame, poster, orientation)
      );
    } else {
      fillVideo(media, null);
      clearFrameLayout(media);
    }
  }

  fillOwnerBadges(root, st);
  fillBuyButton(root.querySelector('[data-buy-intent]'), st, opts.balance ?? null);
  // «Смотреть» — часть представления: поверхность не помнит второй шаг
  // (initLotVideos идемпотентен и не трогает уже навешенный клик).
  initLotVideos(root);
}

/**
 * Раскладка кадра по ориентации постера: сама ориентация — на кадре (её
 * читают CSS витрины и страницы Лота), размытая подложка квадрата — только
 * карточкам. Страница Лота (`data-media-adapt`) вписывает видео целиком без
 * подложки; полосу во всю строку витрина рисует CSS-ом (`:has`).
 */
function applyFrameLayout(
  frame: HTMLElement,
  poster: HTMLImageElement,
  orientation: MediaOrientation
): void {
  frame.dataset.mediaOrientation = orientation;
  const cardFrame = !frame.hasAttribute('data-media-adapt');
  if (orientation === 'square' && cardFrame) {
    applySquareBlur(frame, poster.currentSrc || poster.src);
  } else {
    removeSquareBlur(frame);
  }
}

/** Кадр без видео: раскладка прежнего видео не должна переживать данные. */
function clearFrameLayout(frame: HTMLElement): void {
  delete frame.dataset.mediaOrientation;
  removeSquareBlur(frame);
}

/** Размытая копия постера под вписанным квадратом — подложка карточки. */
function applySquareBlur(frame: HTMLElement, src: string): void {
  const existing = frame.querySelector('.sq-bg');
  if (existing instanceof HTMLElement) {
    existing.style.backgroundImage = `url('${src}')`;
    return;
  }
  const bg = document.createElement('div');
  bg.className = 'sq-bg';
  bg.style.backgroundImage = `url('${src}')`;
  frame.insertBefore(bg, frame.firstChild);
}

function removeSquareBlur(frame: HTMLElement): void {
  frame.querySelector('.sq-bg')?.remove();
}

/**
 * Заполнить бейджи владельца над кадром — один контракт разметки на карточку
 * витрины и страницу Лота (`LotBadges`: data-owner-badge / data-free-badge /
 * data-mine-badge). Владелец — тёмный бейдж с короной, у свободного Лота
 * показан светлый «свободен»; «Твой» — по флагу mine. Отдельной строки с
 * владельцем нет: как на витрине, так и в подробностях.
 */
function fillOwnerBadges(root: ParentNode | null, st: LotState): void {
  if (!root) return;
  const owned = Boolean(st.owner_login);
  const owner = root.querySelector('[data-owner-badge]');
  if (owner instanceof HTMLElement) {
    owner.textContent = owned ? `👑 ${st.owner_login}` : '';
    owner.classList.toggle('hidden', !owned);
  }
  const free = root.querySelector('[data-free-badge]');
  if (free instanceof HTMLElement) free.classList.toggle('hidden', owned);
  const mine = root.querySelector('[data-mine-badge]');
  if (mine instanceof HTMLElement) mine.classList.toggle('hidden', !st.mine);
}

/**
 * Заполнить кнопку покупки данными Лота — намерение через lib/buy-intent.ts
 * (`data-buy-intent`), правило «не хватает» — оттуда же (buyAvailability).
 * Одно место на витрину, страницу Лота и главную: правка формы тут меняет
 * все экраны. `balance` — зеркало серверного гейта: N известна и баланс
 * меньше — кнопка гаснет с честной надписью, но цена в ней остаётся
 * («Не хватает · N 🍺»). Исключения: свой Лот — «Твой привет» (цены нет,
 * покупка невозможна), N неизвестна — «…» (намерение несёт price: null,
 * сервер посчитает сам).
 */
function fillBuyButton(btn: Element | null, st: LotState, balance: number | null = null): void {
  if (!(btn instanceof HTMLButtonElement)) return;
  const intent = {
    slug: st.slug,
    title: st.title,
    price: st.nextPrice,
    owner: st.owner_login ?? '—',
    video: st.video_url,
  };
  writeBuyIntent(btn, intent);
  // Свой лот купить нельзя (перекуп у себя бессмыслен) — кнопка гаснет.
  // N неизвестна — не гасим по балансу: сравнить не с чем, решает сервер.
  const availability = buyAvailability(intent, balance);
  const off = st.mine || availability === 'short';
  btn.disabled = off;
  btn.textContent = st.mine
    ? 'Твой привет'
    : availability === 'short'
      ? `Не хватает · ${formatStaged(st.nextPrice)} 🍺`
      : `▶ Забрать за ${formatStaged(st.nextPrice)} 🍺`;
  btn.classList.toggle('opacity-50', off);
}
