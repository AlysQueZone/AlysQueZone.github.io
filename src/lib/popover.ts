/**
 * Геометрия поповера, привязанного к кнопке-якорю.
 *
 * Чистая функция без DOM: якорь, ширина панели и вьюпорт на входе — координаты
 * `fixed`-панели и потолок высоты на выходе. Панель раскрыта под якорем от его
 * левого края (растёт вправо); левый край держится в полях вьюпорта, высота
 * режется под свободное место. Ширину на узком экране режет CSS поверхности
 * (`max-width` из `POPOVER_MARGIN`), сюда приходит уже ужатая (`offsetWidth`).
 *
 * Владеет только числами: разметка, открытие и Escape — у поверхности
 * (`src/lib/outbid-notice.ts`).
 */

/** Прямоугольник якоря — подмножество `DOMRect`. */
export interface AnchorRect {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface PanelSize {
  /** Ширина панели после CSS: `max-width` на узком экране уже сработал. */
  width: number;
}

export interface ViewportSize {
  width: number;
  height: number;
}

export interface PanelPlacement {
  left: number;
  top: number;
  maxHeight: number;
}

/** Отступ от кнопки до панели. */
export const POPOVER_GAP = 8;
/** Поля от краёв вьюпорта. */
export const POPOVER_MARGIN = 12;
/** Потолок высоты — прежняя доля экрана у панели колокола. */
export const POPOVER_MAX_HEIGHT_RATIO = 0.6;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function placePanel(
  anchor: AnchorRect,
  panel: PanelSize,
  viewport: ViewportSize
): PanelPlacement {
  const width = Math.min(panel.width, Math.max(0, viewport.width - POPOVER_MARGIN * 2));
  const left = clamp(anchor.left, POPOVER_MARGIN, viewport.width - width - POPOVER_MARGIN);
  const top = anchor.bottom + POPOVER_GAP;
  const room = viewport.height - top - POPOVER_MARGIN;
  const maxHeight = Math.min(viewport.height * POPOVER_MAX_HEIGHT_RATIO, room);
  return {
    left: Math.round(left),
    top: Math.round(top),
    // Панель может упереться в низ экрана — тогда высоту режет место, а не доля.
    maxHeight: Math.max(0, Math.round(maxHeight)),
  };
}
