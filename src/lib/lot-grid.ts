/**
 * План набора сетки Карточек Лота: чистая арифметика без DOM и live.
 *
 * Решение — docs/adr/0009: поверхности владеют узлами (создание, вставка,
 * сортировка), модуль отвечает только на вопрос «что оставить, снять и
 * добавить». Режим размещения — дело поверхности: витрина вставляет `add`
 * по цене, главная — в порядке своей выборки. Поэтому `mode` здесь нет.
 *
 * Тесты — src/lib/lot-grid.test.ts.
 */
import type { LotState } from './live';

export interface GridPlan {
  /** Slug, которых нет в следующем наборе: карточки снять. */
  remove: string[];
  /** Slug, которые остаются: карточки перезаполнить свежим состоянием. */
  keep: string[];
  /** Новые состояния в порядке показа: карточки создать и вставить. */
  add: LotState[];
}

/**
 * План набора: `current` — slug в порядке DOM, `next` — состояния в порядке
 * показа.
 *
 * Состояния с нечисловой ценой отбрасываются — без цены им нет места в
 * порядке витрины. Дубли slug в `next` схлопываются по первому вхождению:
 * один Лот — одна карточка. `keep` идёт в порядке DOM, чтобы уже показанные
 * карточки не переезжали.
 */
export function planGrid(current: readonly string[], next: readonly LotState[]): GridPlan {
  const seen = new Set<string>();
  const valid = next.filter((st) => {
    if (!Number.isFinite(st.price) || seen.has(st.slug)) return false;
    seen.add(st.slug);
    return true;
  });
  const nextSlugs = new Set(valid.map((st) => st.slug));
  const currentSlugs = new Set(current);
  return {
    remove: current.filter((slug) => !nextSlugs.has(slug)),
    keep: current.filter((slug) => nextSlugs.has(slug)),
    add: valid.filter((st) => !currentSlugs.has(st.slug)),
  };
}

/** Состояние заметки сетки: текст выбирает поверхность. */
export type GridNote = 'loading' | 'ok' | 'empty' | 'failed';

/**
 * Заметка сетки по трём фактам: ответ БД уже был (`known`), он успешен (`ok`)
 * и сколько карточек показано (`count`). Пока карточки есть, сбой свежего
 * ответа не перекрывает последнее хорошее — `ok`, заметка молчит.
 */
export function gridNote(known: boolean, ok: boolean, count: number): GridNote {
  if (!known) return 'loading';
  if (count > 0) return 'ok';
  return ok ? 'empty' : 'failed';
}
