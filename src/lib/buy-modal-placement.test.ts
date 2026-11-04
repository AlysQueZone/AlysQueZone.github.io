/**
 * Модалка покупки монтируется ровно один раз — в BaseLayout.
 *
 * Кнопку возврата из колокола видно на любой странице, поэтому второй
 * экземпляр или модалка только на отдельной странице ломают покупку:
 * делегированный клик по `data-buy-intent` живёт в единственном BuyModal.
 */
import { describe, expect, it } from 'vitest';

const SOURCES = import.meta.glob('/src/**/*.astro', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const LAYOUT = '/src/layouts/BaseLayout.astro';

describe('размещение BuyModal', () => {
  it('монтируется ровно один раз — в BaseLayout', () => {
    for (const [path, source] of Object.entries(SOURCES)) {
      const count = source.match(/<BuyModal\b/g)?.length ?? 0;
      expect(count, `${path}: <BuyModal разрешён только в ${LAYOUT}`).toBe(path === LAYOUT ? 1 : 0);
    }
  });
});
