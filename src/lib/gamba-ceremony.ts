/**
 * Церемония Гамбы: чистое ядро стадий, эффектов и колеса.
 *
 * Владеет стадиями `idle/requesting/spinning/revealed/aborted`, терминальными
 * переходами (раскрытие придержанного баланса ровно один раз), колесом
 * (`WHEEL_PATTERN`, сегменты, выбор сегмента исхода) и стадией → Пул звуков.
 * Не владеет canvas, rAF, Audio, таймерами, сетью и разметкой — это адаптер
 * `GambaModal`.
 *
 * `miss` — legacy-исход старых записей: новых таких спинов сервер не выдаёт
 * (таблица I), но колесо его не знает, поэтому сегмент выбирается случайный,
 * а Пул звуков получает `lose`.
 *
 * Часы инъектируются (`now`): ядро только метит `spunAt`/`endedAt`; длительность
 * крутки ведёт адаптер.
 *
 * Тесты — src/lib/gamba-ceremony.test.ts.
 */
import type { GambaOutcome } from './gamba';
import type { SoundPool } from './gamba-sounds';

export type GambaStage = 'idle' | 'requesting' | 'spinning' | 'revealed' | 'aborted';

/** Длительность церемонии крутки; сервер отвечает раньше, колесо докручивается. */
export const SPIN_MS = 4200;

export interface GambaCeremonyState {
  stage: GambaStage;
  /** Исход, присланный сервером; null — ещё не пришёл. */
  outcome: GambaOutcome | null;
  /** Момент старта крутки; null — колесо не крутится. */
  spunAt: number | null;
  /** Момент терминальной стадии; null — церемония ещё идёт. */
  endedAt: number | null;
}

export type GambaCeremonyEffect =
  | { type: 'holdBalance' }
  | { type: 'releaseBalance' }
  | { type: 'animate'; outcome: GambaOutcome }
  | { type: 'reveal'; outcome: GambaOutcome }
  | { type: 'playPool'; pool: SoundPool };

export type GambaCeremonyEvent =
  | { type: 'start' }
  | { type: 'result'; outcome: GambaOutcome }
  | { type: 'finish' }
  | { type: 'abort' }
  | { type: 'reset' };

export interface GambaCeremony {
  state(): GambaCeremonyState;
  dispatch(event: GambaCeremonyEvent): GambaCeremonyEffect[];
}

/** Стадия исхода → Пул звуков; неизвестный (и legacy `miss`) — проигрыш. */
export function outcomePool(outcome: string): SoundPool {
  switch (outcome) {
    case 'small':
    case 'big':
      return 'win';
    case 'jackpot':
      return 'jackpot';
    case 'return':
    case 'miss':
      return 'lose';
    default:
      return 'lose';
  }
}

type WheelChar = 'R' | 'S' | 'B' | 'J';

/** Цвет сегмента: токен палитры или локальный hex декоративного набора. */
export type SegmentColor = { token: string } | { hex: string };

export interface WheelSegment {
  label: string;
  outcome: GambaOutcome;
  color: SegmentColor;
}

// 12 сегментов — визуальная аппроксимация таблицы I
// (9 возвратов / 1 мелкий / 1 крупный / 1 джекпот ≈ веса 75/17/7/1 —
// возврат ровно 75% как в паспорте; мелочь занижена, джекпот визуально
// завышен 8% vs 1%: сегмент меньше не сделать, честные шансы только
// в плакате/правилах); точные веса живут в БД и плакате, исход решает
// сервер — колесо лишь докручивается до сегмента присланного типа.
// R/B — локальные цвета колеса (DESIGN.md, декоративный набор), S/J — токены.
export const SEGMENT_SPECS: Record<WheelChar, WheelSegment> = {
  R: { label: 'возврат', outcome: 'return', color: { hex: '#FFD93C' } },
  S: { label: '+50', outcome: 'small', color: { token: '--color-ember' } },
  B: { label: '+150', outcome: 'big', color: { hex: '#FF5A3C' } },
  J: { label: 'x10', outcome: 'jackpot', color: { token: '--color-blush' } },
};

export const WHEEL_PATTERN = 'RSRRBRRJRRRR';

const WHEEL_LENGTH = 12;
const WHEEL_COUNTS: Record<WheelChar, number> = { R: 9, S: 1, B: 1, J: 1 };
const WHEEL_CHARS = Object.keys(SEGMENT_SPECS) as WheelChar[];

/**
 * Валидатор `WHEEL_PATTERN`: длина 12, алфавит RBSJ, счёт 9/1/1/1. Числа —
 * визуальная аппроксимация, не шансы; при рассинхроне падаем громко.
 */
export function assertWheelPattern(pattern: string): void {
  if (pattern.length !== WHEEL_LENGTH || /[^RBSJ]/.test(pattern)) {
    throw new Error(`bad WHEEL_PATTERN (len=${pattern.length}, alphabet=RBSJ)`);
  }
  const counts: Record<WheelChar, number> = { R: 0, S: 0, B: 0, J: 0 };
  for (const ch of pattern) counts[ch as WheelChar] += 1;
  if (WHEEL_CHARS.some((ch) => counts[ch] !== WHEEL_COUNTS[ch])) {
    throw new Error(
      `bad WHEEL_PATTERN counts (R/S/B/J=${counts.R}/${counts.S}/${counts.B}/${counts.J})`
    );
  }
}

/** Сегменты колеса из паттерна; паттерн проходит тот же валидатор. */
function wheelSegments(pattern: string): WheelSegment[] {
  assertWheelPattern(pattern);
  return [...pattern].map((ch) => SEGMENT_SPECS[ch as WheelChar]);
}

/** Колесо сборки: валидация паттерна — на загрузке модуля, не в компоненте. */
export const SEGMENTS: readonly WheelSegment[] = wheelSegments(WHEEL_PATTERN);

function randomIndex(length: number, random: () => number): number {
  const index = Math.floor(random() * length);
  return Number.isFinite(index) ? Math.min(Math.max(index, 0), length - 1) : 0;
}

/**
 * Индекс целевого сегмента: среди сегментов исхода; исхода на колесе нет
 * (legacy `miss`) — случайный сегмент. `random` инъектируется в тестах.
 */
export function targetSegment(outcome: GambaOutcome, random: () => number = Math.random): number {
  const candidates: number[] = [];
  for (const [index, segment] of SEGMENTS.entries()) {
    if (segment.outcome === outcome) candidates.push(index);
  }
  const pool = candidates.length > 0 ? candidates : SEGMENTS.map((_, index) => index);
  return pool[randomIndex(pool.length, random)];
}

/** Редьюсер церемонии; rAF, звук и сеть исполняет адаптер по эффектам. */
export function createGambaCeremony({ now }: { now: () => number }): GambaCeremony {
  let current: GambaCeremonyState = {
    stage: 'idle',
    outcome: null,
    spunAt: null,
    endedAt: null,
  };
  /** Инвариант баланса: hold на старте, release ровно один раз на терминале. */
  let balanceHeld = false;

  function release(): GambaCeremonyEffect[] {
    if (!balanceHeld) return [];
    balanceHeld = false;
    return [{ type: 'releaseBalance' }];
  }

  function dispatch(event: GambaCeremonyEvent): GambaCeremonyEffect[] {
    switch (event.type) {
      case 'start': {
        // Активную церемонию не начинаем заново: второй hold — двойной захват.
        // `aborted` — окно закрыли до старта: поздний RPC не оживляет церемонию.
        if (current.stage !== 'idle' && current.stage !== 'revealed') return [];
        current = { stage: 'requesting', outcome: null, spunAt: null, endedAt: null };
        if (balanceHeld) return [];
        balanceHeld = true;
        return [{ type: 'holdBalance' }];
      }

      case 'result': {
        // Поздний ответ после закрытия Окна не крутит колесо в пустоту.
        if (current.stage !== 'requesting') return [];
        current = {
          stage: 'spinning',
          outcome: event.outcome,
          spunAt: now(),
          endedAt: null,
        };
        return [{ type: 'animate', outcome: event.outcome }];
      }

      case 'finish': {
        if (current.stage !== 'spinning' || current.outcome === null) return [];
        const outcome = current.outcome;
        current = { ...current, stage: 'revealed', endedAt: now() };
        return [
          { type: 'reveal', outcome },
          { type: 'playPool', pool: outcomePool(outcome) },
          ...release(),
        ];
      }

      case 'abort': {
        // Терминал не переписываем: закрытие после исхода ничего не раскрывает.
        if (current.stage === 'revealed' || current.stage === 'aborted') return [];
        // Abort из idle ловит гонку «закрыли, пока шла сессия/предгейт»:
        // поздний start после него не начнёт церемонию в закрытом окне.
        current = { ...current, stage: 'aborted', endedAt: now() };
        return release();
      }

      case 'reset': {
        if (current.stage === 'idle') return [];
        current = { stage: 'idle', outcome: null, spunAt: null, endedAt: null };
        // Сброс без abort не должен терять придержанный баланс.
        return release();
      }
    }
  }

  return {
    state: () => ({ ...current }),
    dispatch,
  };
}
