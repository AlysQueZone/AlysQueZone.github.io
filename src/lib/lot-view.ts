/**
 * Представление Лота: один набор слотов на витрину, страницу Лота и главную.
 *
 * Решение — docs/adr/0009.
 *
 * Контракт: поверхность даёт корень и `LotState`, модуль заполняет все
 * стандартные слоты, какие есть в корне, в одном порядке:
 * - `[data-lot-link]` — ссылка на страницу Лота (`lotUrl`);
 * - `[data-lot-title]` — заголовок с эмоутами (`lib/emotes.ts`);
 * - `[data-lot-price]` — отдельная строка цены: только раскладка K1 на профиле;
 * - `[data-lot-video-root]` — видео; ориентация кадра — на кадр
 *   (`data-media-orientation`, для CSS), подложка квадрата — карточкам;
 * - `[data-owner-badge]` / `[data-free-badge]` / `[data-mine-badge]` — бейджи;
 *   владелец с uid — ссылка на профиль (`profileHref`), без uid — текст;
 * - `[data-buy-intent]` — кнопка покупки (`lib/buy-intent.ts`).
 * Свои поля поверхность правит сама: title документа и автор привета —
 * страница Лота, сортировка и reconcile — витрина.
 */
import { setTitleEmotes } from './emotes';
import { fillVideo, initLotVideos, type MediaOrientation } from './lot-video';
import { buyAvailability, formatStaged, writeBuyIntent, type BuyIntent } from './buy-intent';
import { profileHref } from './profile';
import type { LotState } from './live-store-model';

/** Адрес страницы Лота — один на все поверхности (`?id=` — slug). */
export function lotUrl(slug: string): string {
  return `${import.meta.env.BASE_URL}lot/?id=${encodeURIComponent(slug)}`;
}

/** «Мой ли Лот»: единственное правило владения, флаг не хранится в состоянии. */
export function isMine(st: LotState, uid: string | null): boolean {
  return uid !== null && st.owner_uid === uid;
}

/** Бейдж владельца: видимый текст, адрес профиля и доступное имя ссылки. */
export interface OwnerBadgeView {
  /** «👑 nick»; пусто — владельца нет, бейдж скрыт («свободен» на месте). */
  text: string;
  /** Адрес профиля владельца; null — бейдж остаётся текстом («Биржа», нет uid). */
  href: string | null;
  /** Ник для `aria-label` ссылки (корона — не имя); null — бейдж не ссылка. */
  label: string | null;
}

/**
 * Владелец Лота — ссылка на профиль только по `owner_uid` (uid — идентичность,
 * логин — подпись). Нет uid («Биржа», старый лот) — текст без `href`; лот
 * свободен — бейджа нет. Одно правило на Карточку Лота и страницу Лота.
 */
export function ownerBadgeView(st: LotState): OwnerBadgeView {
  const login = typeof st.owner_login === 'string' ? st.owner_login.trim() : '';
  if (login.length === 0) return { text: '', href: null, label: null };
  const href = profileHref(st.owner_uid);
  return { text: `👑 ${login}`, href, label: href === null ? null : login };
}

export interface LotViewOptions {
  /** Баланс — зеркало серверного гейта: не хватает — кнопка гаснет. */
  balance?: number | null;
  /** uid текущей сессии: «Твой» и «Твой привет» считаются при отрисовке. */
  uid?: string | null;
  /**
   * Надпись погашенной кнопки своего Лота. По умолчанию «Твой привет»;
   * профиль говорит «Твой лот» (раскладка K1, docs/adr/0009).
   */
  mineLabel?: string;
}

/** Надпись и доступность кнопки покупки — одно правило на все поверхности. */
export interface BuyButtonView {
  text: string;
  disabled: boolean;
  /** Погашена: свой Лот или не хватает баланса — общий opacity. */
  muted: boolean;
}

/**
 * Надпись и доступность кнопки покупки по намерению Лота. Отдельно от DOM:
 * правка формы тут меняет все экраны, а тест держит слова и состояния
 * (`fillBuyButton` только переносит результат на кнопку).
 *
 * Исключения: свой Лот — `mineLabel` (по умолчанию «Твой привет»; цены нет,
 * покупка невозможна), не хватает баланса — «Не хватает · N 🍺», N неизвестна —
 * «…» (намерение несёт `price: null`, сервер посчитает сам).
 */
export function buyButtonView(
  intent: BuyIntent,
  opts: { balance?: number | null; mine?: boolean; mineLabel?: string } = {}
): BuyButtonView {
  const availability = buyAvailability(intent, opts.balance ?? null);
  const mine = opts.mine ?? false;
  // Свой лот купить нельзя (перекуп у себя бессмыслен) — кнопка гаснет.
  // N неизвестна — не гасим по балансу: сравнить не с чем, решает сервер.
  const off = mine || availability === 'short';
  return {
    text: mine
      ? (opts.mineLabel ?? 'Твой привет')
      : availability === 'short'
        ? `Не хватает · ${formatStaged(intent.price)} 🍺`
        : `▶ Забрать за ${formatStaged(intent.price)} 🍺`,
    disabled: off,
    muted: off,
  };
}

/**
 * Нарисовать Лот в корне: какие слоты есть — те и заполняются (пустая
 * мини-разметка получит только своё). Вызов идемпотентен: живое видео
 * `fillVideo` не трогает, заголовок и бейджи перезаписываются.
 */
export function fillLot(root: Element | null, st: LotState, opts: LotViewOptions = {}): void {
  if (!(root instanceof HTMLElement)) return;
  // Флаг считается один раз на отрисовку: uid — часть представления, а не
  // поле снапшота.
  const mine = isMine(st, opts.uid ?? null);

  const link = root.querySelector('[data-lot-link]');
  if (link instanceof HTMLAnchorElement) link.href = lotUrl(st.slug);

  setTitleEmotes(root.querySelector('[data-lot-title]'), st.title);

  // Отдельная строка цены — только у раскладки K1 на профиле (docs/adr/0009):
  // у витрины и страницы Лота цена остаётся в кнопке.
  const price = root.querySelector('[data-lot-price]');
  if (price instanceof HTMLElement) price.textContent = `${formatStaged(st.nextPrice)} 🍺`;

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

  fillOwnerBadges(root, st, mine);
  fillBuyButton(
    root.querySelector('[data-buy-intent]'),
    st,
    opts.balance ?? null,
    mine,
    opts.mineLabel
  );
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
 * data-mine-badge). Владелец — тёмный бейдж с короной: с uid это ссылка на
 * профиль (доступное имя — ник), без uid — текст; у свободного Лота показан
 * светлый «свободен», «Твой» — по селектору isMine. Отдельной строки с
 * владельцем нет: как на витрине, так и в подробностях.
 */
function fillOwnerBadges(root: ParentNode | null, st: LotState, mine: boolean): void {
  if (!root) return;
  const view = ownerBadgeView(st);
  const owner = root.querySelector('[data-owner-badge]');
  if (owner instanceof HTMLElement) {
    owner.textContent = view.text;
    owner.classList.toggle('hidden', view.text.length === 0);
    if (owner instanceof HTMLAnchorElement) {
      // Ссылка — настоящий href, а не обработчик: клавиатура и контекстное
      // меню работают штатно. Нет uid — атрибуты снимаются: `a` без href и
      // aria-label читается как текст и из Tab выпадает.
      if (view.href === null) {
        owner.removeAttribute('href');
        owner.removeAttribute('aria-label');
      } else {
        owner.href = view.href;
        owner.setAttribute('aria-label', view.label ?? view.text);
      }
    }
  }
  const free = root.querySelector('[data-free-badge]');
  if (free instanceof HTMLElement) free.classList.toggle('hidden', view.text.length > 0);
  const mineBadge = root.querySelector('[data-mine-badge]');
  if (mineBadge instanceof HTMLElement) mineBadge.classList.toggle('hidden', !mine);
}

/**
 * Заполнить кнопку покупки данными Лота — намерение через lib/buy-intent.ts
 * (`data-buy-intent`), надпись и доступность — из `buyButtonView`.
 * `mineLabel` — своя надпись своего Лота (профиль: «Твой лот»).
 */
function fillBuyButton(
  btn: Element | null,
  st: LotState,
  balance: number | null = null,
  mine = false,
  mineLabel?: string
): void {
  if (!(btn instanceof HTMLButtonElement)) return;
  const intent: BuyIntent = {
    slug: st.slug,
    title: st.title,
    price: st.nextPrice,
    owner: st.owner_login ?? '—',
    video: st.video_url,
  };
  writeBuyIntent(btn, intent);
  const view = buyButtonView(intent, { balance, mine, mineLabel });
  btn.disabled = view.disabled;
  btn.textContent = view.text;
  btn.classList.toggle('opacity-50', view.muted);
}
