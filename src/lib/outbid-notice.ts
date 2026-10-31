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
import { POPOVER_MARGIN, placePanel } from './popover';
import { hasOpenModal } from './modal';

const MAX_HISTORY = 10;
const BELL_ID = 'outbid-bell';
const BELL_COUNT_ID = 'outbid-bell-count';
const BELL_PANEL_ID = 'outbid-bell-panel';
const BELL_TITLE = 'Перекупы твоих лотов';

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

  /** Прочитанное — в localStorage per-uid: переживает перезагрузку;
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

  let bellButton: HTMLElement | null = null;
  let bellCount: HTMLElement | null = null;
  let bellPanel: HTMLElement | null = null;
  let bellOpen = false;
  let layoutWatcher: ResizeObserver | null = null;

  function isOpen(): boolean {
    return bellOpen;
  }

  /** Пока панель открыта, следим за шапкой: кнопка входа меняет ширину
   *  (гость ↔ ник), чип баланса может перенести строки — колокол едет,
   *  а окно resize про это молчит. */
  function startHeaderWatch(): void {
    if (layoutWatcher || typeof ResizeObserver === 'undefined') return;
    const cluster = bellButton?.parentElement ?? null;
    const header = bellButton?.closest('header') ?? null;
    if (!cluster && !header) return;
    layoutWatcher = new ResizeObserver(() => {
      if (isOpen()) anchorPanel();
    });
    if (cluster) layoutWatcher.observe(cluster);
    if (header) layoutWatcher.observe(header);
  }

  function stopHeaderWatch(): void {
    layoutWatcher?.disconnect();
    layoutWatcher = null;
  }

  /** Координаты панели от кнопки. Панель — `fixed` в body: шапка со sticky
   *  и backdrop-blur не годится в родители (ломает fixed-потомков и режет
   *  z-index, тот же подводный камень — DailyLogin.astro). Прямоугольник
   *  читаем при каждом открытии: на узком экране шапка переносится. */
  function anchorPanel(): void {
    if (!bellPanel || !bellButton) return;
    const placement = placePanel(bellButton.getBoundingClientRect(), bellPanel.offsetWidth, {
      width: window.innerWidth,
      height: window.innerHeight,
    });
    bellPanel.style.left = `${placement.left}px`;
    bellPanel.style.top = `${placement.top}px`;
    bellPanel.style.maxHeight = `${placement.maxHeight}px`;
  }

  /** Открытие/закрытие — одно место: видимость, aria и координаты вместе. */
  function setOpen(open: boolean): void {
    if (!bellPanel || bellOpen === open) return;
    bellOpen = open;
    bellButton?.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (!open) {
      bellPanel.style.display = 'none';
      stopHeaderWatch();
      return;
    }
    renderPanel();
    bellPanel.style.display = 'block';
    anchorPanel();
    startHeaderWatch();
    unread = 0;
    markSeen();
    renderBell();
  }

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
    head.textContent = `▶ ${BELL_TITLE}`;
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
    btn.title = BELL_TITLE;
    btn.setAttribute('aria-expanded', 'false');
    btn.setAttribute('aria-controls', BELL_PANEL_ID);
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
    // Панель — карточка стиля C (фон/рамка/тень из .card-pixel); координаты
    // при открытии считает placePanel от кнопки, здесь только геометрия.
    // Ширину на узком экране режет max-width из тех же полей, что у placePanel.
    panel.className = 'card-pixel';
    panel.style.display = 'none';
    panel.style.position = 'fixed';
    panel.style.top = '0';
    panel.style.left = '0';
    panel.style.zIndex = '60';
    panel.style.width = '320px';
    panel.style.maxWidth = `calc(100vw - ${POPOVER_MARGIN * 2}px)`;
    panel.style.overflowY = 'auto';
    panel.style.padding = '12px 14px';
    document.body.appendChild(panel);
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      setOpen(!isOpen());
    });
    document.addEventListener('click', (e) => {
      const t = e.target as HTMLElement | null;
      if (!t || !isOpen() || bellPanel?.contains(t)) return;
      setOpen(false);
    });
    actions.insertBefore(btn, actions.firstChild);
    bellButton = btn;
    bellCount = count;
    bellPanel = panel;
    renderBell();
  }

  /** Колокол — только залогиненным: гостю кнопку и панель не показываем вообще. */
  function removeBell(): void {
    stopHeaderWatch();
    document.getElementById(BELL_ID)?.remove();
    document.getElementById(BELL_PANEL_ID)?.remove();
    bellButton = null;
    bellCount = null;
    bellPanel = null;
    bellOpen = false;
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

  /**
   * Добавить перекуп в колокол; `false` — тот же уже показан. Одно событие
   * может прийти из двух диффов (окно витрины и «Мои приветы») почти
   * одновременно; окно времени не блокирует настоящий повтор позже.
   */
  function pushHistory(ev: OutbidEvent): boolean {
    const key = eventKey(ev);
    const duplicate = history.some(
      (entry) => eventKey(entry) === key && Math.abs(entry.at - ev.at) < 5000
    );
    if (duplicate) return false;
    history.unshift(ev);
    while (history.length > MAX_HISTORY) history.pop();
    unread += 1;
    renderBell();
    return true;
  }

  function eventKey(ev: OutbidEvent): string {
    return `${ev.slug}|${ev.price}|${ev.by}`;
  }

  /** Оффлайн-догон: сделки, где меня перекупили без открытого канала
   *  (закрыта вкладка). Best effort, дедуп по событию, свежие — первыми.
   *  Метка просмотра уходит флором в запрос: уже виденное не возвращается,
   *  поэтому непрочитанные — ровно пришедшие новее метки. */
  async function catchUpOffline(): Promise<void> {
    if (uid === null) return;
    try {
      const seenAt = loadSeenAt();
      const found = await fetchOutbidCatchup(uid, MAX_HISTORY, seenAt);
      if (found.length === 0) return;
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
        if (isOpen()) renderPanel();
      }
    } catch {
      // догон — best effort, лайв-канал работает и без него
    }
  }

  function onOutbid(ev: OutbidEvent): void {
    if (!pushHistory(ev)) return;
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

  // Escape — свой, как у всплывающих уведомлений (docs/adr/0005): окна-диалоги
  // обслуживает стек modal.ts. Слушаем в capture: стек висит на bubble и снимает
  // верхнее окно раньше — иначе hasOpenModal() к нашей очереди уже пуст, и одно
  // нажатие закрыло бы и окно, и панель. Фокус из панели возвращаем на колокол.
  document.addEventListener(
    'keydown',
    (e) => {
      if (e.key !== 'Escape' || !isOpen() || hasOpenModal()) return;
      const inside = bellPanel !== null && bellPanel.contains(document.activeElement);
      setOpen(false);
      if (inside) bellButton?.focus();
    },
    { capture: true }
  );

  // Шапка переносится и меняет ширину — координаты пересчитываем, пока открыта.
  window.addEventListener('resize', () => {
    if (isOpen()) anchorPanel();
  });

  // Колокол живёт на всех страницах, а полного каталога больше нет: «Мои
  // приветы» — его источник перекупов и на главной/лоте (docs/adr/0012).
  live.trackMyLots();

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
      if (isOpen()) renderPanel();
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
    if (isOpen()) renderPanel();
    closeNotices(id);
  }
}
