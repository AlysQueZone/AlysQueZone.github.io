/**
 * Уведомление «твоя заявка принята».
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
 * уведомлений (showCornerNotice из lib/notice.ts): тот же card-pixel-стиль
 * и стек, что у перекупов, — колокольчик и его окна не задеваем.
 */

import { getSupabase, withAuthRetry } from './supabase';
import { MAX_NOTICES, showCornerNotice } from './notice';

async function run(): Promise<void> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return;
  const sb = getSupabase();
  if (!sb) return;
  // Сессия из хранилища, без сетевого запроса: гость отсекается здесь же.
  const { data: sessionData } = await sb.auth.getSession();
  const uid = sessionData.session?.user.id ?? null;
  if (!uid) return;
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

    for (const id of ids) {
      showCornerNotice({
        // Только textContent: номер серверный, но innerHTML здесь ни к чему.
        text: `🎉 Твоя заявка #${id} принята — привет на бирже!`,
        closable: true,
      });
    }
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
