import { describe, expect, it } from 'vitest';
import { placePanel, POPOVER_GAP, POPOVER_MARGIN } from './popover';

const viewport = { width: 1280, height: 800 };

function anchor(
  overrides: Partial<{ top: number; right: number; bottom: number; left: number }> = {}
) {
  return { top: 20, right: 1000, bottom: 64, left: 900, ...overrides };
}

describe('placePanel', () => {
  it('раскрывает панель под кнопкой от её левого края', () => {
    const placement = placePanel(anchor(), 320, viewport);
    expect(placement.left).toBe(900);
    expect(placement.top).toBe(64 + POPOVER_GAP);
    expect(placement.maxHeight).toBe(800 * 0.6);
  });

  it('сдвигает влево, когда панель не влезает справа', () => {
    const placement = placePanel(anchor({ left: 1100, right: 1150 }), 320, viewport);
    expect(placement.left).toBe(1280 - 320 - POPOVER_MARGIN);
  });

  it('на узком экране не вылезает за левое поле', () => {
    const narrow = { width: 300, height: 800 };
    // Ширину 276px (300 − поля) уже дал CSS max-width.
    const placement = placePanel(
      anchor({ right: 290, left: 240 }),
      300 - POPOVER_MARGIN * 2,
      narrow
    );
    expect(placement.left).toBe(POPOVER_MARGIN);
  });

  it('страхует по левому полю, даже если ширина пришла неужатой', () => {
    const placement = placePanel(anchor({ right: 290, left: 240 }), 320, {
      width: 300,
      height: 800,
    });
    expect(placement.left).toBe(POPOVER_MARGIN);
  });

  it('урезает высоту под свободное место, если экран низкий', () => {
    const low = { width: 1280, height: 200 };
    const placement = placePanel(anchor(), 320, low);
    expect(placement.top).toBe(64 + POPOVER_GAP);
    expect(placement.maxHeight).toBe(200 - (64 + POPOVER_GAP) - POPOVER_MARGIN);
  });

  it('не отдаёт отрицательную высоту, когда места под кнопкой нет', () => {
    const placement = placePanel(anchor(), 320, { width: 1280, height: 80 });
    expect(placement.maxHeight).toBe(0);
  });
});
