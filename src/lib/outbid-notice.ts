/**
 * Уведомление «твой лот перекупили» (polish-01/09, решение 06 + правки 2026-09-07).
 *
 * - триггер — Realtime-смена Владельца лота, где я был прошлым Владельцем
 *   («мои» = текущий Владелец, owner_uid == uid сессии);
 * - уведомление справа-снизу + звук с S3
 *   (`.../media/sounds/outbid.mp3` через `new Audio`)
 *   (звук только после первого взаимодействия — автоплей-политика);
 *   звук играет и при свёрнутой вкладке;
 * - максимум 3 уведомления, старые вытесняются, висят 20с, hover удерживает;
 * - свёрнутая вкладка: события копятся, при возврате показываются окошками
 *   (до 3 свежих), остальное — в истории колокольчика;
 * - колокольчик в шапке: счётчик непрочитанных + панель истории за сессию
 *   (макс 10, у каждой записи кнопка перекупа). Только залогиненным.
 *
 * Свой Realtime-канал на таблицу лотов (`subscribeSharedLots` не трогаем,
 * отсюда только `getSessionUid`/`getSupabase`).
 */

import { getSessionUid, getSupabase, fetchSharedLots, subscribeSharedLots } from './supabase.ts';
import { fetchLotPrices } from './prices.ts';
import { s3Sound } from './media.ts';

const MAX_NOTICES = 3;
const NOTICE_TTL_MS = 20000;
const LEAVE_TTL_MS = 3000;
const MAX_HISTORY = 10;
const CORNER_ID = 'outbid-corner';
const BELL_ID = 'outbid-bell';
const BELL_COUNT_ID = 'outbid-bell-count';
const BELL_PANEL_ID = 'outbid-bell-panel';

interface OutbidEvent {
  slug: string;
  title: string;
  by: string;
  price: number;
  at: number;
}

function soundUrl(): string {
  return s3Sound('outbid.mp3');
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

/** Видео лота из уже отрисованной кнопки «Купить» (модалка играет его вместо хлопков). */
function resolveVideo(slug: string): string | null {
  try {
    const btn = document.querySelector(
      `[data-buy-lot="${CSS.escape(slug)}"]`,
    );
    const src =
      btn instanceof HTMLElement ? (btn as HTMLElement).dataset.lotVideo : undefined;
    return src && src.length > 0 ? src : null;
  } catch {
    return null;
  }
}

/** Живая N из прайс-фида БД (src/lib/prices.ts): slug → следующая цена.
 *  Формулы в клиенте нет — карту наполняет refreshPrices() по подписке. */
const liveNext = new Map<string, number>();

/** Кнопка перекупа в стиле сайта (как «Купить» на карточках: bg-stream).
 *  N — из подписки на БД; пока прайс не приехал — факт уплаченной цены
 *  (сервер при записи всё равно подтвердит настоящую). */
function makeRebuyButton(ev: OutbidEvent): HTMLButtonElement {
  const next = liveNext.get(ev.slug) ?? ev.price;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = `Забрать за ${next} 🍺`;
  btn.style.marginTop = '8px';
  btn.style.cursor = 'pointer';
  btn.style.border = 'none';
  btn.style.borderRadius = '12px';
  btn.style.background = '#c2187b';
  btn.style.color = '#fff';
  btn.style.fontWeight = '800';
  btn.style.padding = '8px 16px';
  btn.style.fontSize = '14px';
  btn.dataset.buyLot = ev.slug;
  btn.dataset.lotTitle = ev.title;
  btn.dataset.lotPrice = String(next);
  btn.dataset.lotOwner = ev.by;
  // Живая кнопка: refreshPrices() правит текст и staged-цену по подписке.
  btn.dataset.rebuyLive = '1';
  const video = resolveVideo(ev.slug);
  if (video) btn.dataset.lotVideo = video;
  return btn;
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

/** Один раз за страницу. Повторный вызов — noop. */
export function initOutbidNotice(): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (document.documentElement.dataset.outbidInit === '1') return;
  document.documentElement.dataset.outbidInit = '1';

  const corner = ensureCorner();
  let interacted = false;
  let uid: string | null = null;
  const mine = new Set<string>();
  const history: OutbidEvent[] = [];
  const missed: OutbidEvent[] = [];
  let unread = 0;

  let bellBtn: HTMLElement | null = null;
  let bellCount: HTMLElement | null = null;
  let bellPanel: HTMLElement | null = null;

  const unlock = (): void => {
    interacted = true;
  };
  window.addEventListener('pointerdown', unlock, { once: true });
  window.addEventListener('keydown', unlock, { once: true });

  function renderBell(): void {
    if (!bellCount) return;
    if (unread <= 0) {
      bellCount.style.display = 'none';
      return;
    }
    bellCount.style.display = 'inline-block';
    bellCount.textContent = String(unread);
  }

  function renderPanel(): void {
    if (!bellPanel) return;
    bellPanel.innerHTML = '';
    const head = document.createElement('div');
    head.style.fontWeight = '800';
    head.style.marginBottom = '8px';
    head.textContent = 'Перекупы твоих лотов';
    bellPanel.appendChild(head);
    if (history.length === 0) {
      const empty = document.createElement('div');
      empty.style.fontSize = '13px';
      empty.style.opacity = '0.7';
      empty.textContent = 'Пока тихо — твои лоты никто не перекупал.';
      bellPanel.appendChild(empty);
      return;
    }
    for (const ev of history) {
      const item = document.createElement('div');
      item.style.borderTop = '1px solid rgba(0,0,0,0.1)';
      item.style.padding = '8px 0';
      item.style.fontSize = '13px';
      const line = document.createElement('div');
      line.textContent = `${ev.by} забрал «${ev.title}» за ${ev.price} 🍺`;
      item.append(line, makeRebuyButton(ev));
      bellPanel.appendChild(item);
    }
  }

  function ensureBell(): void {
    if (document.getElementById(BELL_ID)) return;
    const actions =
      document.getElementById('topbar-right') ??
      document.querySelector('[data-wallet-balance]')?.closest('div')?.parentElement ??
      null;
    if (!actions) return;
    const btn = document.createElement('button');
    btn.id = BELL_ID;
    btn.type = 'button';
    btn.title = 'Перекупы твоих лотов';
    btn.style.position = 'relative';
    btn.style.cursor = 'pointer';
    btn.style.borderRadius = '999px';
    btn.style.border = '1px solid rgba(138,109,0,0.5)';
    btn.style.background = '#fff6bf';
    btn.style.color = '#422006';
    btn.style.fontSize = '16px';
    btn.style.padding = '4px 12px';
    btn.textContent = '🔔';
    const count = document.createElement('span');
    count.id = BELL_COUNT_ID;
    count.style.display = 'none';
    count.style.position = 'absolute';
    count.style.top = '-6px';
    count.style.right = '-6px';
    count.style.background = '#c2187b';
    count.style.color = '#fff';
    count.style.borderRadius = '999px';
    count.style.fontSize = '11px';
    count.style.fontWeight = '800';
    count.style.padding = '0 6px';
    btn.appendChild(count);
    const panel = document.createElement('div');
    panel.id = BELL_PANEL_ID;
    panel.style.display = 'none';
    panel.style.position = 'fixed';
    panel.style.top = '64px';
    panel.style.right = '12px';
    panel.style.zIndex = '60';
    panel.style.width = '320px';
    panel.style.maxWidth = 'calc(100vw - 24px)';
    panel.style.maxHeight = '60vh';
    panel.style.overflowY = 'auto';
    panel.style.border = '2px solid rgba(21,128,61,0.4)';
    panel.style.borderRadius = '12px';
    panel.style.background = '#ffe6ac';
    panel.style.color = '#111';
    panel.style.padding = '12px 14px';
    panel.style.boxShadow = '0 4px 16px rgba(0,0,0,0.2)';
    document.body.appendChild(panel);
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const open = panel.style.display !== 'none';
      if (open) {
        panel.style.display = 'none';
        return;
      }
      renderPanel();
      panel.style.display = 'block';
      unread = 0;
      renderBell();
    });
    document.addEventListener('click', (e) => {
      const t = e.target as HTMLElement | null;
      if (t && !panel.contains(t)) panel.style.display = 'none';
    });
    actions.insertBefore(btn, actions.firstChild);
    bellBtn = btn;
    bellCount = count;
    bellPanel = panel;
    void bellBtn;
    renderBell();
  }

  /** Живые кнопки возврата: текст и staged-цена из прайс-фида БД. */
  function refreshRebuyButtons(): void {
    document.querySelectorAll('button[data-rebuy-live]').forEach((node) => {
      if (!(node instanceof HTMLButtonElement)) return;
      const slug = node.dataset.buyLot;
      if (!slug) return;
      const next = liveNext.get(slug);
      if (next === undefined) return;
      node.textContent = `Забрать за ${next} 🍺`;
      node.dataset.lotPrice = String(next);
    });
  }

  /** Перечитать N из БД и освежить живые кнопки (+ открытую панель колокола). */
  async function refreshPrices(): Promise<void> {
    try {
      const map = await fetchLotPrices();
      liveNext.clear();
      for (const [slug, p] of map) liveNext.set(slug, p.nextPrice);
      refreshRebuyButtons();
      if (bellPanel && bellPanel.style.display !== 'none') renderPanel();
    } catch {
      // прайс — best effort, факт цены в уведомлении уже показан
    }
  }

  function playSound(): void {
    if (!interacted) return;
    try {
      const p = new Audio(soundUrl()).play();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch {
      // без звука — уведомление всё равно показано
    }
  }

  function pushHistory(ev: OutbidEvent): void {
    history.unshift(ev);
    while (history.length > MAX_HISTORY) history.pop();
    unread += 1;
    renderBell();
  }

  function showNotice(ev: OutbidEvent): void {
    const box = document.createElement('div');
    box.dataset.outbidSlug = ev.slug;
    box.style.border = '2px solid rgba(21,128,61,0.4)';
    box.style.borderRadius = '12px';
    box.style.background = '#ffe6ac';
    box.style.color = '#422006';
    box.style.padding = '10px 12px';
    box.style.boxShadow = '0 4px 16px rgba(0, 0, 0, 0.2)';
    const head = document.createElement('b');
    head.style.display = 'block';
    head.style.marginBottom = '4px';
    head.textContent = 'Твой лот перекупили!';
    const text = document.createElement('span');
    // Факт уплаченной цены сервера; живая N — на кнопке возврата ниже.
    text.textContent = `${ev.by} забрал «${ev.title}» за ${ev.price} 🍺`;
    const btn = makeRebuyButton(ev);
    btn.addEventListener('click', () => {
      window.setTimeout(() => box.remove(), 0);
    });
    box.append(head, text, document.createElement('br'), btn);
    corner.appendChild(box);
    while (corner.children.length > MAX_NOTICES) corner.firstChild?.remove();
    let timer = window.setTimeout(() => box.remove(), NOTICE_TTL_MS);
    box.addEventListener('mouseenter', () => {
      window.clearTimeout(timer);
    });
    box.addEventListener('mouseleave', () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => box.remove(), LEAVE_TTL_MS);
    });
  }

  function onOutbid(ev: OutbidEvent): void {
    pushHistory(ev);
    playSound();
    if (document.hidden) {
      missed.push(ev);
      return;
    }
    showNotice(ev);
  }

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      // показать накопленное, пока вкладка спала (свежие, до лимита)
      const fresh = missed.splice(0).slice(-MAX_NOTICES);
      for (const ev of fresh) showNotice(ev);
      void refreshMine();
      void refreshPrices();
    }
  });

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
      onOutbid({
        slug: next.slug,
        title: resolveTitle(next.slug),
        by,
        price,
        at: Date.now(),
      });
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
    ensureBell();
    ensureSubscribed();
    // Живая N кнопок возврата: перечитываем прайс-фид по каждому тику лотов.
    void refreshPrices();
    subscribeSharedLots(() => {
      void refreshPrices();
    });
    getSupabase()?.auth.onAuthStateChange(() => {
      void refreshMine().then(() => ensureSubscribed());
    });
    // Купил обратно — записи про этот лот не актуальны: убрать из истории
    // и закрыть висящие окошки.
    window.addEventListener('alysque:bought', (e) => {
      const id = (e as CustomEvent<{ id?: unknown }>).detail?.id;
      if (typeof id !== 'string' || id.length === 0) return;
      const before = history.length;
      for (let i = history.length - 1; i >= 0; i--) {
        if (history[i].slug === id) history.splice(i, 1);
      }
      unread = Math.max(0, unread - (before - history.length));
      renderBell();
      if (bellPanel && bellPanel.style.display !== 'none') renderPanel();
      corner
        .querySelectorAll('[data-outbid-slug]')
        .forEach((box) => {
          if (box instanceof HTMLElement && box.dataset.outbidSlug === id) box.remove();
        });
    });
  })();
}
