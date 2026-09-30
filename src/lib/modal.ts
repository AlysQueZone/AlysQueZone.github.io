/**
 * Цикл окна-диалога: открытие/закрытие, Escape, клик-вне, ловушка фокуса.
 *
 * Кандидат D архитектурного ревью (решение — docs/adr/0008): раньше цикл был
 * скопирован в четырёх компонентах (BuyModal, GambaModal, RulesModal, окно
 * ежедневного входа) — классы `hidden`/`flex`, Escape, клик по затемнению и
 * фокус держались каждый сам; расхождения в мелочах никто не ловил.
 *
 * Контракт разметки:
 * - корень окна — переданный элемент (role=dialog / aria-modal модуль ставит
 *   сам, если их нет);
 * - кнопки закрытия (крестик, «не» и т.п.) носят `data-modal-close`;
 * - клик по самому корню (затемнению вокруг карточки) закрывает окно.
 *
 * Открытые окна живут стеком: Escape, Tab и клик-вне обслуживают верхнее;
 * при закрытии фокус возвращается открывателю. Так автоматическое окно
 * ежедневного входа может всплыть поверх открытой покупки и не отбирать
 * у неё управление. Специфика (заполнить содержимое, погасить таймеры) —
 * в hooks: `onOpen` после показа и фокуса, `onClose` после снятия.
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

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

interface Entry {
  root: HTMLElement;
  close: () => void;
}

/** Открытые окна в порядке открытия: верхнее владеет Escape и фокусом. */
const stack: Entry[] = [];
/** Открыватель каждого окна — куда вернуть фокус при закрытии. */
const openers = new WeakMap<HTMLElement, HTMLElement | null>();

function visibleItems(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (el) => el.getClientRects().length > 0
  );
}

function topEntry(): Entry | null {
  return stack.length > 0 ? (stack[stack.length - 1] ?? null) : null;
}

function show(root: HTMLElement): void {
  root.classList.remove('hidden');
  root.classList.add('flex');
  if (!root.hasAttribute('role')) root.setAttribute('role', 'dialog');
  if (!root.hasAttribute('aria-modal')) root.setAttribute('aria-modal', 'true');
  // Пустое окно (только разметка) всё равно должно принимать фокус.
  if (!root.hasAttribute('tabindex')) root.tabIndex = -1;
}

function hide(root: HTMLElement): void {
  root.classList.add('hidden');
  root.classList.remove('flex');
}

if (typeof document !== 'undefined') {
  // Клавиатура — верхнему окну: нижнее не трогаем (одно нажатие не гасит всё).
  document.addEventListener('keydown', (e) => {
    const top = topEntry();
    if (!top) return;
    if (e.key === 'Escape') {
      top.close();
      return;
    }
    // Tab не покидает окно: с первого элемента Shift+Tab уходит на последний.
    if (e.key !== 'Tab') return;
    const items = visibleItems(top.root);
    if (items.length === 0) {
      e.preventDefault();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last?.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first?.focus();
    }
  });
}

/**
 * Завести цикл окна. null-корень (компонента нет на странице) — null:
 * вызывающий код работает через `?.`, как раньше с `if (!modal)`.
 */
export function createModal(root: Element | null, hooks: ModalHooks = {}): ModalHandle | null {
  if (!(root instanceof HTMLElement)) return null;
  const el = root;
  let open = false;

  function close(): void {
    if (!open) return;
    open = false;
    const index = stack.findIndex((e) => e.root === el);
    if (index >= 0) stack.splice(index, 1);
    hide(el);
    const back = openers.get(el) ?? null;
    openers.delete(el);
    back?.focus();
    hooks.onClose?.();
  }

  function openWindow(opener: HTMLElement | null = null): void {
    if (open) return;
    open = true;
    stack.push({ root: el, close });
    // Открыватель — до переноса фокуса: activeElement ещё указывает на триггер.
    openers.set(el, opener ?? (document.activeElement as HTMLElement | null));
    show(el);
    (visibleItems(el)[0] ?? el).focus();
    hooks.onOpen?.();
  }

  const handle: ModalHandle = { open: openWindow, close };

  // Клик-вне (по самому корню) и кнопки `data-modal-close` — забота модуля;
  // слушатель на корне, а не на document: клик, которым окно открыли, уже
  // не попадёт в него (путь события посчитан до появления окна в DOM).
  // Обслуживаем только верхнее окно — контракт «клик — верхнему», а не
  // случайная доступность нижнего оверлея под разметкой.
  el.addEventListener('click', (e) => {
    if (topEntry()?.root !== el) return;
    const target = e.target as HTMLElement | null;
    if (target === el || target?.closest?.('[data-modal-close]')) handle.close();
  });

  return handle;
}
