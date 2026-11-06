/**
 * Баланс и Церемония: последнее раскрытое значение, свежесть и удержание.
 *
 * Контракт: владелец помнит uid, к которому относится значение; дедуп чтения
 * привязан к uid — ответ прежней сессии не подхватывается. Церемония копит
 * значения до release, а смена uid удержанное не раскрывает. Коалесцинг
 * перечитываний — у фасада; здесь только своя дорожка чтения.
 * Решение — docs/adr/0003.
 */

import type { LiveChange, LiveReaders } from './live-store-model';

export interface BalanceOwnerDeps {
  readBalance: LiveReaders['readBalance'];
  emit(change: LiveChange): void;
}

export interface BalanceOwner {
  value(): number | null;
  /** Был ли ответ по балансу для текущего uid (для честного прочерка без мигания). */
  known(): boolean;
  /** Последнее чтение удалось; false — на экране последнее хорошее. */
  fresh(): boolean;
  /** Серверное значение от гамбы/ежедневного входа — обычным путём (с удержанием). */
  report(value: number): void;
  /** Чтение с дедупом: явная свежесть и тики делят одну дорожку на uid. */
  refresh(uid: string): Promise<number | null>;
  /** Придержать баланс под церемонию; возвращает идемпотентный release. */
  defer(): () => void;
  /** Сменить сессию: чужое значение уходит, удержанное не раскрывается. */
  applyUid(next: string | null): void;
}

export function createBalanceOwner(deps: BalanceOwnerDeps): BalanceOwner {
  let uidValue: string | null = null;
  let balanceValue: number | null = null;
  let balanceTried = false;
  let balanceFresh = false;
  /** Церемония придержала баланс: копим последнее раскрываемое значение. */
  let balanceHeld = false;
  let heldBalance: number | null = null;
  let inFlight: Promise<number | null> | null = null;
  let inFlightUid: string | null = null;

  /** Баланс пришёл (или не пришёл): null не затирает последнее хорошее. */
  function applyBalance(value: number | null): void {
    // Церемония придержала баланс (гамба): копим последнее раскрываемое
    // значение, снапшот и события — до release (см. defer).
    if (balanceHeld) {
      if (value !== null) heldBalance = value;
      return;
    }
    const first = !balanceTried;
    balanceTried = true;
    balanceFresh = value !== null;
    if (value === null) {
      // Первый ответ «пусто/отказ» — честный прочерк; дальше последнее
      // хорошее просто остаётся на экране.
      if (first) deps.emit({ kind: 'balance', balance: null, fresh: false });
      return;
    }
    const changed = value !== balanceValue;
    balanceValue = value;
    if (first || changed) deps.emit({ kind: 'balance', balance: value, fresh: true });
  }

  /**
   * Конец церемонии: раскрыть последнее удержанное значение обычным путём.
   * Идемпотентно — повторный release (закрытие окна после конца крутки) no-op.
   */
  function releaseBalance(): void {
    if (!balanceHeld) return;
    balanceHeld = false;
    const value = heldBalance;
    heldBalance = null;
    if (value !== null) applyBalance(value);
  }

  function refresh(uid: string): Promise<number | null> {
    if (inFlight && inFlightUid === uid) return inFlight;
    const run = (async (): Promise<number | null> => {
      let value: number | null;
      try {
        value = await deps.readBalance(uid);
      } catch {
        value = null;
      }
      if (uid !== uidValue) return null; // uid сменился — значение чужое
      applyBalance(value);
      return value;
    })();
    inFlight = run;
    inFlightUid = uid;
    void run.finally(() => {
      if (inFlight === run) {
        inFlight = null;
        inFlightUid = null;
      }
    });
    return run;
  }

  return {
    value: () => balanceValue,
    known: () => balanceTried,
    fresh: () => balanceFresh,

    report(value) {
      if (!Number.isFinite(value) || value < 0) return;
      applyBalance(value);
    },

    refresh,

    defer() {
      // Повторный defer подряд (не должен случаться) не теряет уже накопленное.
      if (!balanceHeld) {
        balanceHeld = true;
        heldBalance = null;
      }
      return releaseBalance;
    },

    applyUid(next) {
      if (next === uidValue) return;
      uidValue = next;
      if (balanceValue !== null) {
        balanceValue = null;
        deps.emit({ kind: 'balance', balance: null, fresh: false });
      }
      balanceTried = false;
      balanceFresh = false;
      // Значение прежнего uid не раскроется под церемонией нового.
      heldBalance = null;
    },
  };
}
