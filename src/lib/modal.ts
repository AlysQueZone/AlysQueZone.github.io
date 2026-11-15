/**
 * Цикл окна поверх нативного `<dialog>`: открытие/закрытие, возврат фокуса,
 * кнопки `data-modal-close` и клик-вне.
 *
 * Решение — docs/adr/0008. Top layer, инертность фона, Escape/back-жест,
 * удержание фокуса и возврат фокуса — браузер. Модуль владеет только тем,
 * чего `<dialog>` не даёт: контракт `data-modal-close`, явным opener'ом
 * (Safari не фокусирует кнопку кликом, поэтому нативный возврат туда не
 * попадёт), клик-вне для браузеров без `closedby`, guard'ом Escape на два
 * открытых окна и хуками поверхности.
 *
 * Контракт разметки:
 * - корень — `<dialog class="modal-dialog" closedby="any">`;
 * - кнопки закрытия (крестик, «не» и т.п.) носят `data-modal-close`;
 * - клик по бэкдропу закрывает окно.
 */

export interface ModalHooks {
  /** После показа и переноса фокуса — дозаполнить содержимое/состояние. */
  onOpen?: () => void;
  /** После снятия с экрана — погасить своё состояние. */
  onClose?: () => void;
}

export interface ModalHandle {
  /** Показать окно; повторный вызов открытого — noop. `opener` — куда вернуть фокус. */
  open(opener?: HTMLElement | null): void;
  /** Скрыть окно; повторный вызов закрытого — noop. */
  close(): void;
}

/** Поддержка `closedby`: в Safari её нет, там клик-вне обслуживает фолбэк. */
const supportsClosedBy =
  typeof HTMLDialogElement !== 'undefined' && 'closedBy' in HTMLDialogElement.prototype;

/** Все окна модальные: `:modal` точнее `[open]` и совпадает с showModal(). */
const OPEN_MODAL = 'dialog:modal';

/** Открыто ли хоть одно окно: поверхности со своим Escape (колокол) уступают клавишу. */
export function hasOpenModal(): boolean {
  return typeof document !== 'undefined' && document.querySelector(OPEN_MODAL) !== null;
}

if (typeof document !== 'undefined') {
  // Одно окно закрывает сам браузер. С двумя Chrome шлёт close request обоим,
  // если нижнее открыли без user activation (например, возврат из логина):
  // Escape принадлежит верхнему, поэтому гасим default и закрываем только его.
  document.addEventListener(
    'keydown',
    (e) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      if (document.querySelectorAll(OPEN_MODAL).length < 2) return;
      const active = document.activeElement;
      const top = active instanceof Element ? active.closest(OPEN_MODAL) : null;
      if (!(top instanceof HTMLDialogElement)) return;
      e.preventDefault();
      top.close();
    },
    true
  );
}

/** Точка вне прямоугольника окна: бэкдроп и паддинг карточки — не «внутри». */
function isOutside(dialog: HTMLDialogElement, event: PointerEvent): boolean {
  const rect = dialog.getBoundingClientRect();
  return (
    event.clientX < rect.left ||
    event.clientX > rect.right ||
    event.clientY < rect.top ||
    event.clientY > rect.bottom
  );
}

/**
 * Завести цикл окна. null-корень (компонента нет на странице) — null:
 * вызывающий код работает через `?.`.
 */
export function createModal(root: Element | null, hooks: ModalHooks = {}): ModalHandle | null {
  if (typeof HTMLDialogElement === 'undefined' || !(root instanceof HTMLDialogElement)) {
    return null;
  }
  const dialog = root;
  /** Открывали ли окно: `onClose` должен сработать ровно один раз. */
  let openedByUs = false;
  /** Куда вернуть фокус: явный opener или активный элемент в момент открытия. */
  let back: HTMLElement | null = null;

  function settleClosed(): void {
    // Поздний `close` после переоткрытия: окно уже снова открыто — не трогаем.
    if (dialog.open || !openedByUs) return;
    openedByUs = false;
    // Явный opener перекрывает нативный возврат: Safari не фокусирует кнопку
    // кликом, поэтому нативный возврат ушёл бы в body.
    back?.focus();
    back = null;
    hooks.onClose?.();
  }

  function close(): void {
    if (!dialog.open) return;
    dialog.close();
    settleClosed();
  }

  function openWindow(opener: HTMLElement | null = null): void {
    if (dialog.open) return;
    // Открыватель — до showModal: фокус уже уедет в окно.
    back =
      opener ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    // `returnValue` не используется (форм нет), но между открытиями он не должен течь.
    dialog.returnValue = '';
    dialog.showModal();
    openedByUs = true;
    hooks.onOpen?.();
  }

  const handle: ModalHandle = { open: openWindow, close };

  // Кнопки закрытия — контракт поверхности; клик по бэкдропу обслуживает
  // нативный `closedby` или фолбэк ниже.
  dialog.addEventListener('click', (e) => {
    const target = e.target as HTMLElement | null;
    if (target?.closest?.('[data-modal-close]')) handle.close();
  });

  // Safari не умеет `closedby`: закрываем по нажатию и отпусканию вне окна,
  // а не по `click` — цель клика по бэкдропу и паддингу тоже сам `<dialog>`.
  // Оба события обязательны: выделение текста, начатое внутри и отпущенное
  // на бэкдропе, окно не закрывает.
  if (!supportsClosedBy) {
    let pressedOutside = false;
    dialog.addEventListener('pointerdown', (e) => {
      pressedOutside = e.button === 0 && isOutside(dialog, e);
    });
    dialog.addEventListener('pointerup', (e) => {
      if (pressedOutside && e.button === 0 && isOutside(dialog, e)) handle.close();
      pressedOutside = false;
    });
    dialog.addEventListener('pointercancel', () => {
      pressedOutside = false;
    });
  }

  // Нативный Escape/back-жест и `closedby` закрывают окно мимо `close()`:
  // хук снимает состояние и здесь. Поздний `close` после переоткрытия
  // отсекает `settleClosed()`.
  dialog.addEventListener('close', settleClosed);

  return handle;
}
