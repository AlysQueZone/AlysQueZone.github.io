/**
 * Уведомление «твой лот перекупили».
 *
 * - событие считает модуль живых данных (src/lib/live.ts): перекуп — дифф
 *   владельца каталога, где я был прошлым Владельцем (owner_uid == uid);
 * - текст раскрывает комиссию биржи: «получено N
 *   (комиссия M)» — сервер зачислил цену минус 7%;
 * - уведомление справа-снизу + звук с S3
 *   (`.../media/sounds/outbid.mp3` через `new Audio`)
 *   (звук только после первого взаимодействия — автоплей-политика);
 *   звук играет и при свёрнутой вкладке;
 * - максимум 3 уведомления, старые вытесняются, висят 30с, hover удерживает;
 * - свёрнутая вкладка: события копятся, при возврате показываются окошками
 *   (до 3 свежих), остальное — в истории колокольчика;
 * - колокольчик в шапке: счётчик непрочитанных + панель истории за сессию
 *   (макс 10, у каждой записи кнопка перекупа). Только залогиненным.
 *   Оффлайн-догон: при старте/фокусе/смене сессии история донаполняется
 *   из purchases (сделки, где я был продавцом), поэтому перекуп с закрытой
 *   вкладкой тоже виден; выкупленные обратно лоты из истории исключаются.
 *   Метка просмотра — в localStorage per-uid: открытая панель гасит бейдж
 *   и переживает перезагрузку (непрочитанное между девайсами не синкается).
 *
 * Каналы, снапшот владельцев и живые N — в lib/live.ts: колокол подписан на
 * его события и читает цены из снапшота (docs/adr/0003).
 */

import { fetchOutbidCatchup } from './supabase';
import { live, normalizeNextPrice } from './live';
import { readBuyIntent, updateBuyIntentPrice } from './buy-intent';
import { sellerLine, type OutbidEvent } from './outbid-event';
import { playOutbidSound } from './outbid-sound';
import { makeRebuyButton, rebuyLabel, showOutbidNotice } from './outbid-notices';
import { closeNotices, MAX_NOTICES } from './notice';

const MAX_HISTORY = 10;
const BELL_ID = 'outbid-bell';
const BELL_COUNT_ID = 'outbid-bell-count';
const BELL_PANEL_ID = 'outbid-bell-panel';

/** Один раз за страницу. Повторный вызов — noop. */
export function initOutbidNotice(): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (document.documentElement.dataset.outbidInit === '1') return;
  document.documentElement.dataset.outbidInit = '1';

  let interacted = false;
  let uid: string | null = null;
  const history: OutbidEvent[] = [];
  const missed: OutbidEvent[] = [];
  let unread = 0;

  function seenStorageKey(): string | null {
    return uid === null ? null : `alysque:outbid-seen:${uid}`;
  }

  /** Прочитанное — в localStorage per-uid: переживает перезагрузку.
   *  Без сервера это лучший вариант для варианта А (без таблицы);
   *  между девайсами непрочитанное не синкается — осознанный лимит. */
  function loadSeenAt(): number {
    try {
      const key = seenStorageKey();
      if (!key) return 0;
      const raw = window.localStorage.getItem(key);
      const ts = raw === null ? 0 : Number(raw);
      return Number.isFinite(ts) && ts > 0 ? ts : 0;
    } catch {
      return 0;
    }
  }

  function markSeen(): void {
    try {
      const key = seenStorageKey();
      if (!key) return;
      window.localStorage.setItem(key, String(Date.now()));
    } catch {
      // приватный режим — бейдж просто проживёт до перезагрузки
    }
  }

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
      item.style.borderTop = '3px solid var(--color-milk)';
      item.style.padding = '8px 0';
      item.style.fontSize = '13px';
      item.style.fontWeight = '700';
      const line = document.createElement('div');
      line.textContent = sellerLine(ev);
      item.append(line, makeRebuyButton(ev));
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
    // Геометрию (высота 44px, паддинги) задаёт .btn-arcade — как у соседей
    // в шапке; здесь только кегль глифа (text-base) и якорь для счётчика.
    btn.className = 'btn-arcade btn-arcade-ghost px-3 text-base';
    btn.style.position = 'relative';
    btn.textContent = '🔔';
    const count = document.createElement('span');
    count.id = BELL_COUNT_ID;
    count.style.display = 'none';
    count.style.position = 'absolute';
    count.style.top = '-10px';
    count.style.right = '-10px';
    count.style.background = 'var(--color-stream)';
    count.style.color = 'var(--color-cream)';
    count.style.border = '2px solid var(--color-milk)';
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
      markSeen();
      renderBell();
    });
    document.addEventListener('click', (e) => {
      const t = e.target as HTMLElement | null;
      if (t && !panel.contains(t)) panel.style.display = 'none';
    });
    actions.insertBefore(btn, actions.firstChild);
    bellCount = count;
    bellPanel = panel;
    renderBell();
  }

  /** Колокол — только залогиненным: гостю кнопку и панель не показываем вообще. */
  function removeBell(): void {
    document.getElementById(BELL_ID)?.remove();
    document.getElementById(BELL_PANEL_ID)?.remove();
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

  /** Живые кнопки возврата: текст и staged-цена из снапшота каталога. */
  function refreshRebuyButtons(): void {
    document.querySelectorAll('button[data-rebuy-live]').forEach((node) => {
      if (!(node instanceof HTMLButtonElement)) return;
      const intent = readBuyIntent(node);
      if (!intent) return;
      const next = normalizeNextPrice(live.lot(intent.slug)?.nextPrice);
      if (next === null) return;
      updateBuyIntentPrice(node, next);
      node.textContent = rebuyLabel(next);
    });
  }

  function pushHistory(ev: OutbidEvent): void {
    history.unshift(ev);
    while (history.length > MAX_HISTORY) history.pop();
    unread += 1;
    renderBell();
  }

  function eventKey(ev: OutbidEvent): string {
    return `${ev.slug}|${ev.price}|${ev.by}`;
  }

  /** Оффлайн-догон: сделки, где меня перекупили без открытого канала
   *  (закрыта вкладка). Best effort, дедуп по событию, свежие — первыми.
   *  Непрочитанными считаются только события новее метки просмотра. */
  async function catchUpOffline(): Promise<void> {
    if (uid === null) return;
    try {
      const found = await fetchOutbidCatchup(uid, MAX_HISTORY);
      if (found.length === 0) return;
      const seenAt = loadSeenAt();
      const known = new Set(history.map(eventKey));
      for (const m of missed) known.add(eventKey(m));
      let added = 0;
      for (const ev of found) {
        if (known.has(eventKey(ev))) continue;
        history.push(ev);
        known.add(eventKey(ev));
        if (ev.at > seenAt) added += 1;
      }
      history.sort((a, b) => b.at - a.at);
      while (history.length > MAX_HISTORY) history.pop();
      if (added > 0) {
        unread += added;
        renderBell();
        if (bellPanel && bellPanel.style.display !== 'none') renderPanel();
      }
    } catch {
      // догон — best effort, лайв-канал работает и без него
    }
  }

  function onOutbid(ev: OutbidEvent): void {
    pushHistory(ev);
    playOutbidSound(interacted);
    if (document.hidden) {
      missed.push(ev);
      return;
    }
    showOutbidNotice(ev);
  }

  /** Показ накопленного, пока вкладка спала (свежие, до лимита). */
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    const fresh = missed.splice(0).slice(-MAX_NOTICES);
    for (const ev of fresh) showOutbidNotice(ev);
  });

  // Снапшот живых данных — единственный источник событий колокола:
  // смена uid, перекуп, своя покупка, тик каталога и синк (догон).
  live.subscribe((change) => {
    if (change.kind === 'uid') {
      uid = change.uid;
      syncBellVisibility();
      void catchUpOffline();
      return;
    }
    if (change.kind === 'outbid') {
      onOutbid(change.event);
      return;
    }
    if (change.kind === 'purchase') {
      removeBoughtFromHistory(change.purchase.slug);
      return;
    }
    if (change.kind === 'catalog') {
      if (change.changed.size === 0) return;
      refreshRebuyButtons();
      if (bellPanel && bellPanel.style.display !== 'none') renderPanel();
      return;
    }
    if (change.kind === 'sync') {
      void catchUpOffline();
    }
  });

  /** Купил обратно — записи про этот лот не актуальны: убрать из истории
   *  и закрыть висящие окошки. */
  function removeBoughtFromHistory(id: string): void {
    if (id.length === 0) return;
    const before = history.length;
    for (let i = history.length - 1; i >= 0; i--) {
      if (history[i].slug === id) history.splice(i, 1);
    }
    unread = Math.max(0, unread - (before - history.length));
    renderBell();
    if (bellPanel && bellPanel.style.display !== 'none') renderPanel();
    closeNotices(id);
  }
}
