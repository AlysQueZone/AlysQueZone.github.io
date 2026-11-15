/**
 * Разметка окон: контракт нативного `<dialog>` (docs/adr/0008).
 *
 * Роль и `aria-modal` даёт сам `<dialog>`, имя — `aria-labelledby`/`aria-label`,
 * клик-вне — `closedby="any"`; без этого окно теряет доступное имя или
 * закрытие по бэкдропу. Скан сырой: DOM в тестах нет, а класс `modal-dialog`
 * обязан быть у каждого окна — на нём ширина, прокрутка и затемнение.
 */
import { describe, expect, it } from 'vitest';

const SOURCES = import.meta.glob('/src/**/*.astro', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

/** Только теги с атрибутами: `<dialog>` в комментариях — не разметка окна. */
const DIALOG = /<dialog\s[^>]*>/g;

describe('разметка окон на `<dialog>`', () => {
  it('каждое окно называет себя, закрывается по бэкдропу и не дублирует роль', () => {
    for (const [path, source] of Object.entries(SOURCES)) {
      const tags = source.match(DIALOG) ?? [];
      for (const tag of tags) {
        expect(tag, `${path}: id`).toMatch(/\bid="/);
        expect(tag, `${path}: имя`).toMatch(/\baria-(?:labelledby|label)=/);
        expect(tag, `${path}: клик-вне`).toMatch(/\bclosedby="any"/);
        expect(tag, `${path}: класс`).toMatch(/\bclass="[^"]*\bmodal-dialog\b/);
        expect(tag, `${path}: роль ставит браузер`).not.toMatch(/\brole="dialog"/);
        expect(tag, `${path}: aria-modal ставит браузер`).not.toMatch(/\baria-modal/);
      }
      if (tags.length > 0) {
        expect(source, `${path}: кнопка закрытия`).toContain('data-modal-close');
      }
    }
  });

  it('все четыре окна на месте', () => {
    const ids = Object.values(SOURCES)
      .flatMap((source) => source.match(DIALOG) ?? [])
      .map((tag) => tag.match(/\bid="([^"]+)"/)?.[1])
      .filter(Boolean);
    expect(new Set(ids)).toEqual(
      new Set(['buy-modal', 'gamba-modal', 'rules-modal', 'daily-modal'])
    );
  });
});
