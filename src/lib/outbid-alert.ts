/**
 * Алерт «твой лот перекупили» (polish-01/09, решение 06).
 *
 * Поведение 1-в-1 с throwaway-прототипом
 * `.scratch/polish-01/prototype/outbid-alert.html`:
 * - триггер — Realtime-смена Владельца лота, где я был прошлым Владельцем
 *   («мои» = текущий Владелец, owner_uid == uid сессии);
 * - уведомление справа-снизу + звук `/sounds/outbid.mp3` через `new Audio`
 *   (звук только после первого взаимодействия — автоплей-политика);
 * - максимум 3 уведомления, старые вытесняются, автоскрытие через 8с;
 * - свёрнутая вкладка — без звука, только счётчик пропущенных,
 *   сброс при возврате. Только залогиненным, только онлайн.
 *
 * Свой Realtime-канал на таблицу лотов (`subscribeSharedLots` не трогаем,
 * отсюда только `getSessionUid`/`getSupabase`).
 */

import { getSessionUid, getSupabase, fetchSharedLots } from './supabase.ts';

const MAX_NOTICES = 3;
const NOTICE_TTL_MS = 8000;
const CORNER_ID = 'outbid-corner';
const BADGE_ID = 'outbid-missed';

function soundUrl(): string {
  const base = (import.meta.env.BASE_URL as string | undefined) ?? '/';
  return `${base}sounds/outbid.mp3`;
}

function readCatalogTitle(slug: string): string | null {
  try {
    const tag = document.querySelector('[data-lots-catalog]');
    if (!tag?.textContent) return null;
    const parsed: unknown = JSON.parse(tag.textContent);
    if (!Array.isArray(parsed)) return null;
    for (const row of parsed as Record<string, unknown>[]) {
      if (row['id'] === slug && typeof row['title'] === 'string') return row['title'];
    }
  } catch {
    // каталога нет — fallback ниже
  }
  return null;
}

function resolveTitle(slug: string): string {
  const card = document.querySelector(`[data-lot-card="${CSS.escape(slug)}"]`);
  const heading = card?.querySelector('h3');
  const fromCard = heading?.textContent?.trim();
  if (fromCard) return fromCard;
  return readCatalogTitle(slug) ?? slug;
}

function ensureCorner(): HTMLElement {
  let corner = document.getElementById(CORNER_ID);
  if (corner instanceof HTMLElement) return corner;
  corner = document.createElement('div');
  corner.id = CORNER_ID;
  corner.setAttribute('aria-live', 'polite');
  corner.style.position = 'fixed';
  corner.style.right = '12px';
  corner.style.bottom = '12px';
  corner.style.display = 'flex';
  corner.style.flexDirection = 'column';
  corner.style.gap = '8px';
  corner.style.maxWidth = '320px';
  corner.style.zIndex = '60';
  document.body.appendChild(corner);
  return corner;
}

function ensureBadge(): HTMLElement {
  let badge = document.getElementById(BADGE_ID);
  if (badge instanceof HTMLElement) return badge;
  badge = document.createElement('div');
  badge.id = BADGE_ID;
  badge.style.display = 'none';
  badge.style.position = 'fixed';
  badge.style.right = '12px';
  badge.style.bottom = '12px';
  badge.style.zIndex = '60';
  badge.style.background = '#a855f7';
  badge.style.color = '#fff';
  badge.style.borderRadius = '999px';
  badge.style.padding = '2px 10px';
  badge.style.fontSize = '12px';
  badge.style.fontWeight = '700';
  document.body.appendChild(badge);
  return badge;
}

/** Один раз за страницу. Повторный вызов — noop. */
export function initOutbidAlert(): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (document.documentElement.dataset.outbidInit === '1') return;
  document.documentElement.dataset.outbidInit = '1';

  const corner = ensureCorner();
  const badge = ensureBadge();
  let missed = 0;
  let interacted = false;
  let uid: string | null = null;
  const mine = new Set<string>();

  const unlock = (): void => {
    interacted = true;
  };
  window.addEventListener('pointerdown', unlock, { once: true });
  window.addEventListener('keydown', unlock, { once: true });

  const renderBadge = (): void => {
    if (missed <= 0) {
      badge.style.display = 'none';
      return;
    }
    badge.style.display = 'block';
    badge.textContent = `Перекупили: ${missed}`;
  };

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      missed = 0;
      renderBadge();
      void refreshMine();
    }
  });

  function showNotice(opts: { slug: string; by: string; price: number }): void {
    const { slug, by, price } = opts;
    if (document.hidden) {
      missed += 1;
      renderBadge();
      return;
    }
    const title = resolveTitle(slug);
    const next = Math.ceil(price * 1.1);
    const box = document.createElement('div');
    box.style.border = '2px solid #a855f7';
    box.style.borderRadius = '12px';
    box.style.background = '#faf5ff';
    box.style.color = '#111';
    box.style.padding = '10px 12px';
    box.style.boxShadow = '0 4px 16px rgba(0, 0, 0, 0.2)';
    const head = document.createElement('b');
    head.style.display = 'block';
    head.style.marginBottom = '4px';
    head.textContent = 'Твой лот перекупили!';
    const text = document.createElement('span');
    text.textContent = `${by} забрал «${title}» за ${price} 🍺 — забрать за ${next} 🍺?`;
    // Кнопка-перекуп: модалку открывает существующий делегированный
    // обработчик BuyModal по data-buy-lot/* — BuyModal править не надо.
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = `Забрать за ${next} 🍺`;
    btn.style.marginTop = '6px';
    btn.style.cursor = 'pointer';
    btn.dataset.buyLot = slug;
    btn.dataset.lotTitle = title;
    btn.dataset.lotPrice = String(next);
    btn.addEventListener('click', () => {
      window.setTimeout(() => box.remove(), 0);
    });
    box.append(head, text, document.createElement('br'), btn);
    corner.appendChild(box);
    while (corner.children.length > MAX_NOTICES) corner.firstChild?.remove();
    if (interacted) {
      try {
        const p = new Audio(soundUrl()).play();
        if (p && typeof p.catch === 'function') p.catch(() => {});
      } catch {
        // без звука — уведомление всё равно показано
      }
    }
    window.setTimeout(() => box.remove(), NOTICE_TTL_MS);
  }

  async function refreshMine(): Promise<void> {
    try {
      const [nextUid, states] = await Promise.all([getSessionUid(), fetchSharedLots()]);
      uid = nextUid;
      mine.clear();
      if (uid !== null) {
        for (const [slug, s] of states) {
          if (s.owner_uid !== null && s.owner_uid === uid) mine.add(slug);
        }
      }
    } catch {
      // слепок не собрался — канал всё равно заведём, триггер по old/new
    }
  }

  interface LotRow {
    slug?: unknown;
    price?: unknown;
    owner_login?: unknown;
    owner_uid?: unknown;
  }

  function handleRow(next: LotRow, prev: LotRow | null): void {
    if (uid === null) return;
    if (typeof navigator !== 'undefined' && !navigator.onLine) return;
    if (typeof next.slug !== 'string') return;
    const prevOwner = prev && typeof prev.owner_uid === 'string' ? prev.owner_uid : null;
    const wasMine = prevOwner !== null ? prevOwner === uid : mine.has(next.slug);
    const nextOwner = typeof next.owner_uid === 'string' ? next.owner_uid : null;
    if (wasMine && nextOwner !== null && nextOwner !== uid) {
      mine.delete(next.slug);
      const price = Number(next.price);
      if (!Number.isFinite(price)) return;
      const by =
        typeof next.owner_login === 'string' && next.owner_login.length > 0
          ? next.owner_login
          : 'Чатерс';
      showNotice({ slug: next.slug, by, price });
    } else if (nextOwner === uid) {
      mine.add(next.slug);
    } else if (nextOwner !== null && nextOwner !== uid) {
      mine.delete(next.slug);
    }
  }

  let subscribed = false;

  function ensureSubscribed(): void {
    if (subscribed || uid === null) return;
    const sb = getSupabase();
    if (!sb) return;
    try {
      sb
        .channel('alysque:outbid')
        .on(
          'postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'lots' },
          (payload: { new?: LotRow; old?: LotRow }) => {
            handleRow(payload.new ?? {}, payload.old ?? null);
          },
        )
        .subscribe();
      subscribed = true;
    } catch {
      // Realtime недоступен — тихий noop, попробуем снова при смене сессии
    }
  }

  void (async () => {
    await refreshMine();
    ensureSubscribed();
    getSupabase()?.auth.onAuthStateChange(() => {
      void refreshMine().then(() => ensureSubscribed());
    });
  })();
}
