/**
 * Уведомление «твой лот перекупили» (polish-01/09, решение 06 + правки 2026-09-07).
 *
 * - триггер — Realtime-смена Владельца лота, где я был прошлым Владельцем
 *   («мои» = текущий Владелец, owner_uid == uid сессии);
 * - текст раскрывает комиссию биржи (ребаланс, тикет 05): «получено N
 *   (комиссия M)» — сервер зачислил цену минус 7%;
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
 * Свой Realtime-канал на таблицу лотов (плюс общий тик через subscribeLots
 * из lib/lots.ts для живых цен кнопок возврата).
 */

import { getSessionUid, getSupabase } from './supabase';
import { fetchLotCatalog, subscribeLots } from './lots';
import { sellerLine, type OutbidEvent } from './outbid-event';
import { playOutbidSound } from './outbid-sound';
import { MAX_NOTICES, ensureCorner, makeRebuyButton, showNotice } from './outbid-notices';

const MAX_HISTORY = 10;
const BELL_ID = 'outbid-bell';
const BELL_COUNT_ID = 'outbid-bell-count';
const BELL_PANEL_ID = 'outbid-bell-panel';

/** Живая N из каталога БД (src/lib/lots.ts): slug → следующая цена.
 *  Формулы в клиенте нет — карту наполняет refreshPrices() по подписке. */
const liveNext = new Map<string, number>();
/** Названия лотов из того же каталога — событие резолвится без чтения DOM. */
const liveTitles = new Map<string, string>();

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
    head.className = 'font-display';
    head.style.fontSize = '10px';
    head.style.textTransform = 'uppercase';
    head.style.marginBottom = '8px';
    head.textContent = '▶ Перекупы твоих лотов';
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
      item.style.borderTop = '3px solid #422006';
      item.style.padding = '8px 0';
      item.style.fontSize = '13px';
      item.style.fontWeight = '700';
      const line = document.createElement('div');
      line.textContent = sellerLine(ev);
      item.append(line, makeRebuyButton(ev, liveNext));
      bellPanel.appendChild(item);
    }
  }

  function ensureBell(): void {
    if (uid === null) return;
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
    // Колокол стиля C: аркадная кнопка-призрак + счётчик-пиксель.
    btn.className = 'btn-arcade btn-arcade-ghost';
    btn.style.position = 'relative';
    btn.style.fontSize = '16px';
    btn.style.padding = '4px 12px';
    btn.textContent = '🔔';
    const count = document.createElement('span');
    count.id = BELL_COUNT_ID;
    count.style.display = 'none';
    count.style.position = 'absolute';
    count.style.top = '-10px';
    count.style.right = '-10px';
    count.style.background = '#c2187b';
    count.style.color = '#fff';
    count.style.border = '2px solid #422006';
    count.style.fontSize = '11px';
    count.style.fontWeight = '900';
    count.style.padding = '0 6px';
    btn.appendChild(count);
    const panel = document.createElement('div');
    panel.id = BELL_PANEL_ID;
    // Панель — карточка стиля C (фон/рамка/тень из .card-pixel),
    // позиционирование прежнее.
    panel.className = 'card-pixel';
    panel.style.display = 'none';
    panel.style.position = 'fixed';
    panel.style.top = '64px';
    panel.style.right = '12px';
    panel.style.zIndex = '60';
    panel.style.width = '320px';
    panel.style.maxWidth = 'calc(100vw - 24px)';
    panel.style.maxHeight = '60vh';
    panel.style.overflowY = 'auto';
    panel.style.padding = '12px 14px';
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

  /** Колокол — только залогиненным: гостю кнопку и панель не показываем вообще. */
  function removeBell(): void {
    document.getElementById(BELL_ID)?.remove();
    document.getElementById(BELL_PANEL_ID)?.remove();
    bellBtn = null;
    bellCount = null;
    bellPanel = null;
  }

  function syncBellVisibility(): void {
    if (uid === null) {
      // Чужую историю перекупов после выхода не светим следующему за экраном.
      history.length = 0;
      missed.length = 0;
      unread = 0;
      removeBell();
      return;
    }
    ensureBell();
  }

  /** Живые кнопки возврата: текст и staged-цена из прайс-фида БД. */
  function refreshRebuyButtons(): void {
    document.querySelectorAll('button[data-rebuy-live]').forEach((node) => {
      if (!(node instanceof HTMLButtonElement)) return;
      const slug = node.dataset.buyLot;
      if (!slug) return;
      const next = liveNext.get(slug);
      if (next === undefined) return;
      node.textContent = `▶ Забрать за ${next} 🍺`;
      node.dataset.lotPrice = String(next);
    });
  }

  /** Перечитать каталог из БД и освежить живые кнопки (+ открытую панель колокола). */
  async function refreshPrices(): Promise<void> {
    try {
      const catalog = await fetchLotCatalog(null);
      liveNext.clear();
      liveTitles.clear();
      for (const [slug, st] of catalog) {
        // null (вью отсутствует) — в карту не кладём: показ даст «…», не враньё на шаг.
        if (typeof st.nextPrice === 'number' && Number.isFinite(st.nextPrice) && st.nextPrice > 0) {
          liveNext.set(slug, st.nextPrice);
        }
        liveTitles.set(slug, st.title);
      }
      refreshRebuyButtons();
      if (bellPanel && bellPanel.style.display !== 'none') renderPanel();
    } catch {
      // прайс — best effort, факт цены в уведомлении уже показан
    }
  }

  function pushHistory(ev: OutbidEvent): void {
    history.unshift(ev);
    while (history.length > MAX_HISTORY) history.pop();
    unread += 1;
    renderBell();
  }

  function onOutbid(ev: OutbidEvent): void {
    pushHistory(ev);
    playOutbidSound(interacted);
    if (document.hidden) {
      missed.push(ev);
      return;
    }
    showNotice(corner, ev, liveNext);
  }

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      // показать накопленное, пока вкладка спала (свежие, до лимита)
      const fresh = missed.splice(0).slice(-MAX_NOTICES);
      for (const ev of fresh) showNotice(corner, ev, liveNext);
      void refreshMine();
      void refreshPrices();
    }
  });

  async function refreshMine(): Promise<void> {
    try {
      const nextUid = await getSessionUid();
      uid = nextUid;
      mine.clear();
      if (uid !== null) {
        const catalog = await fetchLotCatalog(uid);
        for (const [slug, st] of catalog) {
          if (st.mine) mine.add(slug);
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
    video_url?: unknown;
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
      const video =
        typeof next.video_url === 'string' && next.video_url.length > 0 ? next.video_url : null;
      onOutbid({
        slug: next.slug,
        title: liveTitles.get(next.slug) ?? next.slug,
        by,
        price,
        at: Date.now(),
        video,
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
      sb.channel('alysque:outbid')
        .on(
          'postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'lots' },
          (payload: { new?: LotRow; old?: LotRow }) => {
            handleRow(payload.new ?? {}, payload.old ?? null);
          }
        )
        .subscribe();
      subscribed = true;
    } catch {
      // Realtime недоступен — тихий noop, попробуем снова при смене сессии
    }
  }

  void (async () => {
    await refreshMine();
    syncBellVisibility();
    ensureSubscribed();
    // Живая N кнопок возврата: перечитываем каталог по каждому тику лотов.
    void refreshPrices();
    subscribeLots(() => {
      void refreshPrices();
    });
    getSupabase()?.auth.onAuthStateChange(() => {
      void refreshMine().then(() => {
        syncBellVisibility();
        ensureSubscribed();
      });
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
      corner.querySelectorAll('[data-outbid-slug]').forEach((box) => {
        if (box instanceof HTMLElement && box.dataset.outbidSlug === id) box.remove();
      });
    });
  })();
}
