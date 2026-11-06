/**
 * Тесты плана сетки Карточек Лота: add/remove/keep и состояние заметки —
 * без DOM и live.
 *
 * Шов — чистый `lot-grid` (docs/adr/0009): поверхность владеет узлами и
 * порядком вставки, план отвечает только за состав сетки. Расхождение главной
 * (`painted/refill` не добирал новые карточки) зафиксировано отдельным тестом.
 */
import { describe, expect, it } from 'vitest';
import { gridNote, planGrid } from './lot-grid';
import type { LotState } from './live-store';

function lot(slug: string, price = 100, overrides: Partial<LotState> = {}): LotState {
  return {
    slug,
    title: `Привет ${slug}`,
    video_url: null,
    price,
    nextPrice: price + 10,
    owner_login: null,
    owner_uid: null,
    suggested_by_login: null,
    ...overrides,
  };
}

describe('planGrid', () => {
  it('пустая сетка: все состояния — в add, в порядке показа', () => {
    const states = [lot('b'), lot('a')];
    expect(planGrid([], states)).toEqual({ remove: [], keep: [], add: states });
  });

  it('следующий набор пуст: все карточки снимаются', () => {
    expect(planGrid(['a', 'b'], [])).toEqual({ remove: ['a', 'b'], keep: [], add: [] });
  });

  it('общий набор: keep в порядке DOM, без add/remove', () => {
    expect(planGrid(['b', 'a'], [lot('a'), lot('b')])).toEqual({
      remove: [],
      keep: ['b', 'a'],
      add: [],
    });
  });

  it('новый slug: add в порядке следующего набора', () => {
    const plan = planGrid(['a'], [lot('c'), lot('a'), lot('b')]);
    expect(plan.remove).toEqual([]);
    expect(plan.keep).toEqual(['a']);
    expect(plan.add.map((st) => st.slug)).toEqual(['c', 'b']);
  });

  it('дубли slug в следующем наборе схлопываются по первому вхождению', () => {
    const plan = planGrid([], [lot('a', 100), lot('a', 200)]);
    expect(plan.add).toHaveLength(1);
    expect(plan.add[0]?.price).toBe(100);
  });

  it('нечисловая цена: состояние отбрасывается, остальные остаются', () => {
    const plan = planGrid([], [lot('bad', Number.NaN), lot('ok', 200)]);
    expect(plan.add.map((st) => st.slug)).toEqual(['ok']);
  });

  it('карточка без валидной цены в следующем наборе снимается', () => {
    const plan = planGrid(['bad'], [lot('bad', Number.NaN)]);
    expect(plan.remove).toEqual(['bad']);
    expect(plan.add).toEqual([]);
  });

  // Расхождение главной: текущий painted/refill не обрабатывал add.
  it('удалённая карточка: [a,b,c,d] → [a,b,c] даёт remove d', () => {
    expect(planGrid(['a', 'b', 'c', 'd'], [lot('a'), lot('b'), lot('c')])).toEqual({
      remove: ['d'],
      keep: ['a', 'b', 'c'],
      add: [],
    });
  });

  it('добор главной: [a,b,c] → [a,b,c,e] даёт add e', () => {
    const plan = planGrid(['a', 'b', 'c'], [lot('a'), lot('b'), lot('c'), lot('e')]);
    expect(plan.remove).toEqual([]);
    expect(plan.keep).toEqual(['a', 'b', 'c']);
    expect(plan.add.map((st) => st.slug)).toEqual(['e']);
  });
});

describe('gridNote', () => {
  it('ответа БД ещё не было — loading', () => {
    expect(gridNote(false, true, 0)).toBe('loading');
    expect(gridNote(false, false, 3)).toBe('loading');
  });

  it('пусто после успешного ответа — empty', () => {
    expect(gridNote(true, true, 0)).toBe('empty');
  });

  it('пусто после отказа БД — failed', () => {
    expect(gridNote(true, false, 0)).toBe('failed');
  });

  it('карточки есть — ok, даже если свежий ответ БД упал', () => {
    expect(gridNote(true, true, 2)).toBe('ok');
    expect(gridNote(true, false, 2)).toBe('ok');
  });
});
