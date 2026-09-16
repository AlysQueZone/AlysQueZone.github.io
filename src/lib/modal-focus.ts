/**
 * Фокус-менеджмент диалогов: вход, ловушка Tab, возврат на триггер.
 *
 * Разметка даёт `role="dialog"` + `aria-modal`, Escape обрабатывает каждая
 * модалка сама — здесь только фокус, которого иначе не хватает: без него
 * клавиатура уезжает на фон под оверлеем, а после закрытия фокус теряется.
 *
 * Проверка — ручная: Tab не покидает открытый диалог (Shift+Tab с первого
 * элемента уходит на последний), Escape/клик по фону возвращают фокус на
 * кнопку-триггер. Отдельного тест-раннера в проекте нет.
 */

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const openers = new WeakMap<HTMLElement, HTMLElement | null>();

function visible(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (el) => el.getClientRects().length > 0
  );
}

/** Открывает диалог для клавиатуры: фокус внутрь, Tab зациклится. */
export function trapFocus(modal: HTMLElement, opener: HTMLElement | null = null): void {
  if (modal.dataset.focusTrap === 'on') return;
  modal.dataset.focusTrap = 'on';
  openers.set(modal, opener ?? (document.activeElement as HTMLElement | null));
  (visible(modal)[0] ?? modal).focus();
}

/** Снимает ловушку и возвращает фокус на триггер. Идемпотентно. */
export function releaseFocus(modal: HTMLElement): void {
  if (modal.dataset.focusTrap !== 'on') return;
  modal.removeAttribute('data-focus-trap');
  openers.get(modal)?.focus();
  openers.delete(modal);
}

if (typeof document !== 'undefined') {
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    const modal = document.querySelector<HTMLElement>('[data-focus-trap="on"]');
    if (!modal) return;
    const items = visible(modal);
    if (items.length === 0) {
      e.preventDefault();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  });
}
