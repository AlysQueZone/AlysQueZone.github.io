/**
 * Компактная карточка профиля (K1) — раскладка той же Карточки Лота, а не
 * второе представление (docs/adr/0009).
 *
 * Тест держит контракт слотов: кадр, бейджи и клик «смотреть» приходят общими
 * компонентами, а ссылку, заголовок, цену и кнопку заполняет тот же `fillLot`.
 * Своя разметка кадра или второй набор слотов — форк, который должен упасть
 * здесь, а не разъехаться на экране.
 */
import { describe, expect, it } from 'vitest';

const SOURCES = import.meta.glob('/src/**/*.astro', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const COMPACT = '/src/components/LotCardCompact.astro';
const SKELETON = '/src/components/LotCardCompactSkeleton.astro';

describe('LotCardCompact', () => {
  it('объявляет стандартные слоты представления Лота', () => {
    const source = SOURCES[COMPACT];
    expect(source, `${COMPACT} должен существовать`).toBeDefined();
    for (const slot of [
      'data-lot-card',
      'data-lot-link',
      'data-lot-title',
      'data-lot-price',
      'data-buy-intent',
    ]) {
      expect(source, `${COMPACT}: нет слота ${slot}`).toContain(slot);
    }
  });

  it('берёт кадр и бейджи общими компонентами, а не своей разметкой', () => {
    const source = SOURCES[COMPACT];
    expect(source).toContain("from './LotVideo.astro'");
    expect(source).toContain("from './LotBadges.astro'");
    expect(source).toContain('<LotVideo');
    expect(source).toContain('<LotBadges');
    // Кадр и постер рисует LotVideo: второй <img>/<video> здесь — форк.
    expect(source).not.toMatch(/<(img|video)\b/);
  });

  it('без строки владельца: на профиле все приветы принадлежат хозяину', () => {
    expect(SOURCES[COMPACT]).not.toContain('data-owner-line');
  });

  it('скелетон повторяет раскладку K1: кадр 77:136 и место под кнопку', () => {
    const source = SOURCES[SKELETON];
    expect(source, `${SKELETON} должен существовать`).toBeDefined();
    expect(source).toContain('data-lot-skeleton');
    expect(source).toContain('data-lot-compact');
    expect(source).toContain('mediaAspectClass');
    expect(source).toContain('LOT_CARD_ASPECT');
    expect(source).toContain('aria-hidden="true"');
  });
});
