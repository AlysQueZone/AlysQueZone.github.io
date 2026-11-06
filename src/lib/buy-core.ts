/**
 * Покупка: чистый редьюсер фаз и ошибок.
 *
 * Владеет решениями Окна покупки: фаза кнопки, переходы по событиям
 * `intent / refreshed / busy / pause / tick / result / close`, вид ошибки и
 * остаток Паузы. Не владеет DOM, текстами, таймерами, сетью, сессией и
 * `pending-buy` — это адаптер `BuyModal`.
 *
 * Намерение остаётся за `buy-intent` (docs/adr/0004), живые данные приходят
 * через `live` (docs/adr/0003). Часы инъектируются (`now`): `tick` и `pause`
 * считают Паузу от них, тесты дают fake clock. `state.pauseLeft` — секунды,
 * не дедлайн.
 *
 * Тесты — src/lib/buy-core.test.ts.
 */
import type { BuyIntent } from './buy-intent';
import { errorText, isNoAuthError, isOfflineError } from './errors';

export type BuyPhase = 'idle' | 'guest' | 'pause' | 'limit' | 'busy' | 'confirm';

export interface BuyState {
  phase: BuyPhase;
  intent: BuyIntent | null;
  balance: number | null;
  /** Остаток Паузы в секундах; 0 — кнопка свободна. */
  pauseLeft: number;
}

export type BuyErrorKind =
  | 'cooldown'
  | 'rate-limit'
  | 'own-lot'
  | 'insufficient-funds'
  | 'unauthenticated'
  | 'missing-lot'
  | 'price-cap'
  | 'offline'
  | 'write-error';

export interface BuyErrorInfo {
  kind: BuyErrorKind;
  /** Для паузы — сколько секунд ждать (парсится из текста триггера). */
  retryAfterSec?: number;
  raw: string;
}

/**
 * Итог перекупа: успех с фактически уплаченной серверной ценой
 * либо блокировка с видом и сырым текстом сервера (raw — для отладки,
 * показ пользуется kind).
 */
export type BuyResult =
  | { status: 'ok'; paid: number; buyer: string }
  | { status: 'blocked'; kind: BuyErrorKind; retryAfterSec?: number; raw: string };

export type BuyEffect =
  | { type: 'celebrate'; paid: number }
  | { type: 'close' }
  | { type: 'pauseTimer'; seconds: number }
  | { type: 'limit' }
  | { type: 'notice'; kind: BuyErrorKind }
  | { type: 'refreshPrice'; slug: string };

export type BuyEvent =
  | { type: 'intent'; intent: BuyIntent; guest: boolean }
  | { type: 'refreshed'; balance?: number | null; price?: number | null; owner?: string }
  /** Транзит на время `buyLot`: ставит адаптер, снимает `result`. */
  | { type: 'busy' }
  /** Вход в Паузу без ответа сети — проекция из истории перепродаж. */
  | { type: 'pause'; seconds: number }
  | { type: 'tick' }
  | { type: 'result'; result: BuyResult }
  | { type: 'close' };

/** Запасная Пауза, если текст триггера не распарсился (в миграции — 30с). */
const BUY_COOLDOWN_FALLBACK_SEC = 30;

function parseCooldownSec(msg: string): number {
  const hms = msg.match(/(\d+):(\d{2}):(\d{2})/);
  if (hms) {
    const sec = Number(hms[1]) * 3600 + Number(hms[2]) * 60 + Number(hms[3]);
    if (Number.isFinite(sec) && sec > 0 && sec <= 3600) return sec;
  }
  const sec = msg.match(/(\d+)\s*(?:s|sec|сек)/i);
  if (sec) {
    const n = Number(sec[1]);
    if (Number.isFinite(n) && n > 0 && n <= 3600) return n;
  }
  return BUY_COOLDOWN_FALLBACK_SEC;
}

/**
 * Матчится по коду/сообщению триггера: cooldown / rate limit /
 * not authenticated (см. enforce_purchase_rules в миграциях).
 */
export function mapBuyError(err: unknown): BuyErrorInfo {
  const raw = errorText(err);
  const low = raw.toLowerCase();
  if (low.includes('cooldown')) {
    return { kind: 'cooldown', retryAfterSec: parseCooldownSec(raw), raw };
  }
  if (low.includes('rate limit') || low.includes('max ') || low.includes('too many')) {
    return { kind: 'rate-limit', raw };
  }
  if (low.includes('already yours')) {
    return { kind: 'own-lot', raw };
  }
  if (isNoAuthError(err)) {
    return { kind: 'unauthenticated', raw };
  }
  if (low.includes('not found')) {
    return { kind: 'missing-lot', raw };
  }
  if (low.includes('price cap')) {
    return { kind: 'price-cap', raw };
  }
  // Деньги покупки — серверный гейт (BEFORE-триггер):
  // счёта нет или баланса не хватило на серверную цену.
  if (low.includes('insufficient funds') || low.includes('insufficient_funds')) {
    return { kind: 'insufficient-funds', raw };
  }
  if (isOfflineError(err)) {
    return { kind: 'offline', raw };
  }
  return { kind: 'write-error', raw };
}

/**
 * Остаток Паузы после покупки: ceil(пауза − прошедшие секунды), не меньше
 * нуля. `boughtAt`/`now` — epoch ms; битая дата — 0 («Паузы нет»).
 */
export function pauseRemainingSec(
  boughtAt: number,
  now: number,
  pauseSec: number = BUY_COOLDOWN_FALLBACK_SEC
): number {
  if (!Number.isFinite(boughtAt) || !Number.isFinite(now)) return 0;
  return Math.max(0, Math.ceil(pauseSec - (now - boughtAt) / 1000));
}

export interface BuyCore {
  state(): BuyState;
  dispatch(event: BuyEvent): BuyEffect[];
}

/** Редьюсер фаз Окна покупки; таймеры, сеть и отрисовка — у адаптера. */
export function createBuyCore({ now }: { now: () => number }): BuyCore {
  let current: BuyState = { phase: 'idle', intent: null, balance: null, pauseLeft: 0 };
  /** Внутренний дедлайн Паузы; наружу отдаём только секунды. */
  let pauseDeadline = 0;

  const snapshot = (): BuyState => ({
    ...current,
    intent: current.intent ? { ...current.intent } : null,
  });

  const setPause = (seconds: number): void => {
    const left = Math.max(1, Math.ceil(seconds));
    current = { ...current, phase: 'pause', pauseLeft: left };
    pauseDeadline = now() + left * 1000;
  };

  const idle = (): void => {
    pauseDeadline = 0;
  };

  function dispatch(event: BuyEvent): BuyEffect[] {
    switch (event.type) {
      case 'intent':
        current = {
          ...current,
          phase: event.guest ? 'guest' : 'confirm',
          intent: { ...event.intent },
          pauseLeft: 0,
        };
        idle();
        return [];

      case 'refreshed': {
        const next: BuyState = { ...current };
        if ('balance' in event) next.balance = event.balance ?? null;
        if (current.intent) {
          const intent = { ...current.intent };
          if ('price' in event) intent.price = event.price ?? null;
          if (typeof event.owner === 'string') intent.owner = event.owner;
          next.intent = intent;
        }
        current = next;
        return [];
      }

      case 'busy':
        if (!current.intent) return [];
        current = { ...current, phase: 'busy', pauseLeft: 0 };
        idle();
        return [];

      case 'pause':
        if (!current.intent || !(event.seconds > 0)) return [];
        setPause(event.seconds);
        return [{ type: 'pauseTimer', seconds: current.pauseLeft }];

      case 'tick': {
        if (current.phase !== 'pause') return [];
        const left = Math.max(0, Math.ceil((pauseDeadline - now()) / 1000));
        current = { ...current, phase: left > 0 ? 'pause' : 'confirm', pauseLeft: left };
        if (left > 0) return [];
        idle();
        const slug = current.intent?.slug;
        return slug ? [{ type: 'refreshPrice', slug }] : [];
      }

      case 'result': {
        const result = event.result;
        idle();
        if (result.status === 'ok') {
          current = { ...current, phase: 'idle', pauseLeft: 0 };
          return [{ type: 'celebrate', paid: result.paid }, { type: 'close' }];
        }
        switch (result.kind) {
          case 'cooldown':
            setPause(result.retryAfterSec ?? BUY_COOLDOWN_FALLBACK_SEC);
            return [{ type: 'pauseTimer', seconds: current.pauseLeft }];
          case 'rate-limit':
            current = { ...current, phase: 'limit', pauseLeft: 0 };
            return [{ type: 'limit' }];
          case 'insufficient-funds':
            current = { ...current, phase: 'idle', pauseLeft: 0 };
            return [{ type: 'close' }, { type: 'notice', kind: result.kind }];
          case 'unauthenticated':
            current = { ...current, phase: 'guest', pauseLeft: 0 };
            return [];
          default:
            current = { ...current, phase: 'confirm', pauseLeft: 0 };
            return [{ type: 'notice', kind: result.kind }];
        }
      }

      case 'close':
        current = { phase: 'idle', intent: null, balance: current.balance, pauseLeft: 0 };
        idle();
        return [];
    }
  }

  return { state: snapshot, dispatch };
}
