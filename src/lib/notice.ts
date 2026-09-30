/**
 * Всплывающие уведомления: один модуль вместо трёх копий (решение —
 * решение — docs/adr/0005).
 *
 * Два места показа — у них разная механика, общие кишки здесь:
 * - угол (`showCornerNotice`): стек до `MAX_NOTICES`, старые вытесняются,
 *   авто-скрытие, hover удерживает — перекупы и принятые заявки;
 * - одиночное (`showSpotNotice`): плашка снизу или окно по центру с медиа,
 *   тон рамки — покупка.
 *
 * Стек, таймеры, вытеснение, крестик, видео, Escape и клик-вне — реализация;
 * вызывающий говорит только «что показать». Ники и заголовки лотов —
 * пользовательский текст: только textContent, никакого innerHTML.
 */

/** Максимум окошек в углу: старые вытесняются новыми. */
export const MAX_NOTICES = 3;

const CORNER_ID = 'notice-corner';
const CORNER_TTL_MS = 30000;
const LEAVE_TTL_MS = 3000;
const SPOT_ID = 'notice-spot';
const SPOT_TTL_MS = 2600;
const SPOT_VIDEO_TTL_MS = 30000;
const SPOT_BASE =
  'card-pixel fixed bottom-16 left-1/2 z-50 max-w-[calc(100vw-2rem)] -translate-x-1/2 px-8 py-4 text-center text-xl font-black break-words';

export interface CornerNotice {
  text: string;
  /** Жирная шапка окошка (например, «▶ Твой лот перекупили!»). */
  header?: string;
  /** Кнопка-действие (перекуп): клик по ней закрывает окошко. */
  action?: HTMLElement;
  /** Крестик закрытия. */
  closable?: boolean;
  /** Ключ группы: `closeNotices(key)` гасит окошки этого ключа. */
  key?: string;
}

export interface SpotNotice {
  text: string;
  /** Тон рамки: ok — pivko, bad — melon. */
  tone: 'ok' | 'bad';
  /** Картинка-эмоут в текстовом варианте (clap). */
  image?: { src: string; alt: string };
  /** Видео-вариант: окно по центру, автоплей, 'ended' закрывает. */
  video?: { src: string; onError?: () => void };
  /** Клик-вне закрывает (Escape закрывает всегда) — видео-вариант. */
  dismissOnOutside?: boolean;
}

/** Живые окошки угла: порядок = порядок появления; closeNotices — по ключу. */
const cornerNotices: { key?: string; box: HTMLElement; close: () => void }[] = [];

function ensureCorner(): HTMLElement {
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

/** Общий крестик закрытия: тач-таргет 44px, как у прочих кнопок в UI. */
function closeButton(): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.setAttribute('aria-label', 'Закрыть');
  btn.className = 'btn-arcade btn-arcade-ghost min-w-11 shrink-0 px-3 py-1 text-sm';
  btn.textContent = '✕';
  return btn;
}

/** Окошко в углу: card-pixel, авто-скрытие с hover-hold, вытеснение старших. */
export function showCornerNotice(options: CornerNotice): void {
  if (typeof document === 'undefined') return;
  const corner = ensureCorner();
  const box = document.createElement('div');
  let timer = 0;
  /** Когда окошко само закроется: hover снимает таймер, но помнит остаток. */
  let deadline = 0;
  let closed = false;
  const entry = { key: options.key, box, close };
  function close(): void {
    if (closed) return;
    closed = true;
    window.clearTimeout(timer);
    box.remove();
    const at = cornerNotices.indexOf(entry);
    if (at >= 0) cornerNotices.splice(at, 1);
  }
  const arm = (ms: number): void => {
    window.clearTimeout(timer);
    deadline = Date.now() + ms;
    timer = window.setTimeout(close, ms);
  };

  box.className = 'card-pixel';
  box.style.padding = '10px 12px';
  box.style.fontSize = '14px';
  if (options.header) {
    const head = document.createElement('b');
    head.className = 'font-display';
    head.style.display = 'block';
    head.style.fontSize = '10px';
    head.style.textTransform = 'uppercase';
    head.style.marginBottom = '4px';
    head.textContent = options.header;
    box.appendChild(head);
  }
  const text = document.createElement('span');
  // Только textContent: ники и заголовки лотов — пользовательский текст.
  text.textContent = options.text;
  box.appendChild(text);
  if (options.action) box.append(document.createElement('br'), options.action);
  if (options.closable) {
    const cross = closeButton();
    cross.classList.add('mt-2');
    cross.addEventListener('click', close);
    box.append(document.createElement('br'), cross);
  }
  corner.appendChild(box);
  cornerNotices.push(entry);
  // Вытеснение — через close(): реестр не копит снятые окошки.
  while (cornerNotices.length > MAX_NOTICES) cornerNotices[0]?.close();

  box.addEventListener('mouseenter', () => window.clearTimeout(timer));
  box.addEventListener('mouseleave', () => {
    // Продолжаем с остатка, но не меньше грейса после ухода мыши.
    arm(Math.max(deadline - Date.now(), LEAVE_TTL_MS));
  });
  // Кнопка-действие (перекуп) закрывает окошко; сама кнопка работает дальше
  // (делегированный обработчик покупки слушает документ).
  options.action?.addEventListener('click', () => window.setTimeout(close, 0));
  arm(CORNER_TTL_MS);
}

/** Погасить окошки угла по ключу (например, лот выкупили обратно). */
export function closeNotices(key: string): void {
  for (const entry of [...cornerNotices]) {
    if (entry.key === key) entry.close();
  }
}

let spotClose: (() => void) | null = null;

function ensureSpot(): HTMLElement {
  let spot = document.getElementById(SPOT_ID);
  if (spot instanceof HTMLElement) return spot;
  spot = document.createElement('div');
  spot.id = SPOT_ID;
  spot.setAttribute('role', 'status');
  document.body.appendChild(spot);
  return spot;
}

/** Escape закрывает окошко всегда, клик-вне — если просили; отписка возвращается. */
function attachDismiss(spot: HTMLElement, close: () => void, outside: boolean): () => void {
  const onClick = (e: Event): void => {
    const target = e.target;
    if (target instanceof Node && spot.contains(target)) return;
    close();
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') close();
  };
  if (outside) document.addEventListener('click', onClick);
  document.addEventListener('keydown', onKey);
  return () => {
    document.removeEventListener('click', onClick);
    document.removeEventListener('keydown', onKey);
  };
}

/** Одиночная плашка: снизу текстовая, по центру — с видео. */
export function showSpotNotice(options: SpotNotice): void {
  if (typeof document === 'undefined') return;
  spotClose?.();
  const spot = ensureSpot();
  spot.className = SPOT_BASE;
  spot.replaceChildren();

  const text = document.createElement('span');
  text.textContent = options.text;

  let videoEl: HTMLVideoElement | null = null;
  let detachDismiss: (() => void) | null = null;
  let timer = 0;
  let closed = false;
  const close = (): void => {
    if (closed) return;
    closed = true;
    window.clearTimeout(timer);
    detachDismiss?.();
    if (videoEl) {
      try {
        videoEl.pause();
      } catch {
        // видео уже остановлено — не мешаем закрытию
      }
    }
    spot.classList.add('hidden');
    if (spotClose === close) spotClose = null;
  };
  spotClose = close;

  if (options.video) {
    // Видео-вариант: большое окно строго по центру. Окно остаётся `fixed` —
    // иначе центрирование ломается.
    spot.classList.remove('bottom-16');
    spot.classList.add(
      'max-w-lg',
      'flex-col',
      'items-start',
      'gap-2',
      'text-lg',
      'top-1/2',
      '-translate-y-1/2'
    );
    const row = document.createElement('div');
    row.className = 'flex w-full items-start justify-between gap-2';
    const cross = closeButton();
    cross.addEventListener('click', close);
    row.append(text, cross);
    spot.appendChild(row);
    const video = document.createElement('video');
    video.src = options.video.src;
    video.controls = true;
    video.autoplay = true;
    video.playsInline = true;
    video.setAttribute('playsinline', '');
    video.preload = 'auto';
    video.className = 'mt-1 w-full border-2 border-milk';
    spot.appendChild(video);
    const onError = (): void => options.video?.onError?.();
    try {
      const p = video.play();
      if (p && typeof p.catch === 'function') p.catch(() => onError());
    } catch {
      onError();
    }
    video.addEventListener('error', onError);
    video.addEventListener('ended', close);
    videoEl = video;
  } else {
    spot.classList.add('bottom-16');
    spot.appendChild(text);
    if (options.image) {
      const img = document.createElement('img');
      img.src = options.image.src;
      img.alt = options.image.alt;
      img.width = 28;
      img.height = 28;
      img.loading = 'eager';
      img.className = 'ml-2 inline h-7 w-7 object-contain';
      spot.appendChild(img);
      spot.classList.add('flex', 'items-center');
    }
  }

  detachDismiss = attachDismiss(spot, close, options.dismissOnOutside === true);
  spot.classList.add(options.tone === 'ok' ? 'border-pivko' : 'border-melon');
  spot.classList.remove('hidden');
  // С видео окно живёт до конца видео ('ended'), 30с — страховка.
  const ttl = videoEl ? SPOT_VIDEO_TTL_MS : SPOT_TTL_MS;
  timer = window.setTimeout(close, ttl);
}
