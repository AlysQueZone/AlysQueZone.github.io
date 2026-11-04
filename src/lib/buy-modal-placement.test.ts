// Покупка Лота живёт в общем макете, а не на отдельных страницах: кнопку
// возврата из колокола видно везде (шапка — BaseLayout), значит и модалка
// должна открываться везде. Регрессия: /deals/ остался без BuyModal, и клик
// по «Забрать» из уведомления молчал. Второй экземпляр запрещён — id модалки
// и делегированный клик должны остаться в одном месте.
import { describe, expect, it } from 'vitest';

const SOURCES = import.meta.glob(['/src/layouts/*.astro', '/src/pages/**/*.astro'], {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const LAYOUT = '/src/layouts/BaseLayout.astro';

describe('размещение BuyModal', () => {
  it('единственный экземпляр — в BaseLayout', () => {
    for (const [path, source] of Object.entries(SOURCES)) {
      const count = source.match(/<BuyModal\s*\/>/g)?.length ?? 0;
      expect(count, `${path}: <BuyModal /> должен быть только в ${LAYOUT}`).toBe(
        path === LAYOUT ? 1 : 0
      );
    }
  });

  it('BaseLayout импортирует компонент, который рендерит', () => {
    expect(SOURCES[LAYOUT]).toContain("import BuyModal from '@/components/BuyModal.astro'");
  });
});
