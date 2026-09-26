/**
 * Уведомление «твоя заявка принята» (спека scratch/suggest-greeting/spec.md,
 * тикет 12).
 *
 * При загрузке залогиненный Чатерс получает всплывашку по своим принятым
 * заявкам с пустой серверной меткой notified_at. Метку сразу ставит RPC
 * mark_submissions_notified (security definer, только свои accepted; миграция
 * 20260926170000_submission_notified.sql), поэтому повтор не всплывает ни при
 * перезагрузке, ни на другом устройстве, ни в другой вкладке. Если RPC не
 * прошёл (офлайн) — notified_at остался пустым, и окошко вернётся в следующий
 * заход; localStorage для этого не используем.
 *
 * Гость в БД не ходит вообще: сначала uid из сессии, и только для своего —
 * один select под RLS («вижу только свои»). Окошки живут в общем углу
 * уведомлений (ensureCorner из outbid-notices.ts): тот же card-pixel-стиль и
 * стек, что у перекупов, — колокольчик и его окна не задеваем.
 */

import { getSessionUid, getSupabase, isSupabaseConfigured, withAuthRetry } from './supabase';
import { MAX_NOTICES, ensureCorner } from './outbid-notices';

const NOTICE_TTL_MS = 30000;
const LEAVE_TTL_MS = 3000;

/** Окошко одной принятой заявки: card-pixel, крестик, авто-скрытие с hover-hold. */
function showNotice(corner: HTMLElement, id: number): void {
  const box = document.createElement('div');
  box.className = 'card-pixel';
  box.style.padding = '10px 12px';
  box.style.fontSize = '14px';
  const text = document.createElement('span');
  // Только textContent: номер серверный, но innerHTML здесь ни к чему.
  text.textContent = `🎉 Твоя заявка #${id} принята — привет на бирже!`;
  const cross = document.createElement('button');
  cross.type = 'button';
  cross.setAttribute('aria-label', 'Закрыть');
  cross.className = 'btn-arcade btn-arcade-ghost mt-2 px-3 py-1 text-sm';
  cross.textContent = '✕';
  cross.addEventListener('click', () => box.remove());
  box.append(text, document.createElement('br'), cross);
  corner.appendChild(box);
  while (corner.children.length > MAX_NOTICES) corner.firstChild?.remove();
  let timer = window.setTimeout(() => box.remove(), NOTICE_TTL_MS);
  box.addEventListener('mouseenter', () => window.clearTimeout(timer));
  box.addEventListener('mouseleave', () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => box.remove(), LEAVE_TTL_MS);
  });
}

async function run(): Promise<void> {
  if (!isSupabaseConfigured()) return;
  if (typeof navigator !== 'undefined' && !navigator.onLine) return;
  // Сессия из хранилища, без сетевого запроса: гость отсекается здесь же.
  const uid = await getSessionUid();
  if (!uid) return;
  const sb = getSupabase();
  if (!sb) return;
  try {
    const { data, error } = await withAuthRetry(() =>
      sb
        .from('submissions')
        .select('id')
        .eq('status', 'accepted')
        .is('notified_at', null)
        .order('decided_at', { ascending: true })
        .order('id', { ascending: true })
        .limit(MAX_NOTICES)
    );
    if (error || !Array.isArray(data)) return;
    const ids = (data as unknown as Record<string, unknown>[])
      .map((row) => Number(row['id']))
      .filter((id) => Number.isFinite(id) && id > 0);
    if (ids.length === 0) return;

    const corner = ensureCorner();
    for (const id of ids) showNotice(corner, id);
    // Показ состоялся — сразу гасим серверной меткой. Не прошло (офлайн) —
    // метка пуста, окошко честно вернётся в следующий заход.
    await withAuthRetry(() => sb.rpc('mark_submissions_notified', { p_ids: ids }));
  } catch {
    // Сбой чтения/метки — тишина: ничего не показываем и не помечаем.
  }
}

/** Один раз за страницу. Повторный вызов — noop. */
export function initSubmissionNotice(): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (document.documentElement.dataset.submissionNoticeInit === '1') return;
  document.documentElement.dataset.submissionNoticeInit = '1';
  void run();
}
