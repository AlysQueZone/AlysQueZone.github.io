// Палитра живёт в одном месте: хекс разрешён только внутри `@theme` в
// `src/styles/global.css` и в декоративных наборах, которые объявляет
// `MASTER.md` («Декоративные наборы»). Тест читает исходники через
// `import.meta.glob` (витевский `?raw`), поэтому видит и `.astro`, и
// комментарии: линтер из скилла `uipro` их не видел, зато ругался на сами
// токены.
import { describe, expect, it } from 'vitest';

const TOKENS_FILE = '/src/styles/global.css';
const DECORATIVE = new Set(['/src/lib/confetti.ts', '/src/components/GambaModal.astro']);
const HEX = /#[0-9a-fA-F]{3,8}\b/g;

const SOURCES = import.meta.glob(
  ['/src/**/*.css', '/src/**/*.astro', '/src/**/*.ts', '/src/**/*.js', '/src/**/*.mjs'],
  { query: '?raw', import: 'default', eager: true }
) as Record<string, string>;

/** Номера строк внутри блока `@theme` — там токены и определяются. */
function tokenLines(css: string): Set<number> {
  const start = css.search(/@theme\s*\{/);
  if (start === -1) throw new Error(`${TOKENS_FILE}: блок @theme не найден — тест устарел`);

  const open = css.indexOf('{', start);
  const lines = new Set<number>();
  let depth = 0;
  let line = 1;

  for (let i = 0; i < open; i++) {
    if (css[i] === '\n') line++;
  }

  for (let i = open; i < css.length; i++) {
    const char = css[i];
    if (char === '\n') {
      line++;
    } else if (char === '{') {
      depth++;
    } else if (char === '}') {
      if (--depth === 0) break;
    } else if (depth > 0) {
      lines.add(line);
    }
  }

  return lines;
}

describe('палитра', () => {
  it('не выходит за @theme и объявленные декоративные наборы', () => {
    const violations: string[] = [];

    for (const [file, content] of Object.entries(SOURCES)) {
      if (DECORATIVE.has(file)) continue;

      const allowed = file === TOKENS_FILE ? tokenLines(content) : new Set<number>();

      content.split('\n').forEach((text, index) => {
        if (allowed.has(index + 1)) return;
        for (const hex of text.match(HEX) ?? []) {
          violations.push(`${file}:${index + 1} — ${hex}`);
        }
      });
    }

    expect(violations).toEqual([]);
  });
});
