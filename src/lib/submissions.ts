/**
 * Заявки на привет: клиентский шов к public.submissions (тикет 08).
 *
 * Путь записи — прямой INSERT под RLS (паттерн покупок): клиент шлёт только
 * пользовательские поля (title/video_url/comment), а автора, статус, связи и
 * нормализацию ссылки считает BEFORE-триггер enforce_submission_rules
 * (supabase/migrations/20260926130000_submissions.sql). Здесь — клиентская
 * проверка «для UX» и маппинг ошибок сервера на дружелюбные тексты; источник
 * истины — сервер, обход браузера ничего не даёт.
 */
import { getSupabase } from './supabase';

/**
 * Хосты, которые принимает сервер (allowlist из research/video-upload-safety.md
 * §7). Зеркало списка c_hosts в enforce_submission_rules — правим парой.
 */
export const SUBMISSION_ALLOWED_HOSTS = [
  'clips.twitch.tv',
  'twitch.tv',
  'www.twitch.tv',
  'youtube.com',
  'www.youtube.com',
  'youtu.be',
  'streamable.com',
  'www.streamable.com',
  'medal.tv',
  'www.medal.tv',
  'vk.com',
  'vkvideo.ru',
  'cdns.memealerts.com',
] as const;

export const SUBMISSION_TITLE_MAX = 80;
export const SUBMISSION_COMMENT_MAX = 500;
export const SUBMISSION_URL_MAX = 2048;
export const SUBMISSION_OPEN_LIMIT = 10;

export type SubmissionErrorKind =
  | 'unauthenticated'
  | 'session-expired'
  | 'empty-url'
  | 'empty-title'
  | 'scheme'
  | 'host'
  | 'title-too-long'
  | 'comment-too-long'
  | 'url-too-long'
  | 'limit'
  | 'offline'
  | 'write-error';

/** Тексты для показа (тон сайта; финальная вычитка — за владельцем). */
const ERROR_TEXT: Record<SubmissionErrorKind, string> = {
  // Вход уводит полным редиректом — поля не сохраняются, поэтому честно и коротко.
  unauthenticated: 'Сначала войди через Twitch — вход нужен для награды и авторства.',
  'session-expired': 'Сессия истекла — войди через Twitch заново.',
  'empty-url': 'Нужна ссылка на видео — без неё админу нечего смотреть.',
  'empty-title': 'Придумай название — по нему админ поймёт, о чём привет.',
  scheme: 'Ссылка должна начинаться с https://.',
  host: 'Ссылка не с той площадки. Принимаем Twitch clip, YouTube, streamable, medal.tv, VK и MemeAlerts.',
  'title-too-long': `Название слишком длинное — до ${SUBMISSION_TITLE_MAX} символов.`,
  'comment-too-long': `Комментарий слишком длинный — до ${SUBMISSION_COMMENT_MAX} символов.`,
  'url-too-long': `Ссылка слишком длинная — до ${SUBMISSION_URL_MAX} символов.`,
  limit: `У тебя уже ${SUBMISSION_OPEN_LIMIT} открытых заявок — админ не успевает. Дождись решения по одной из них и предложи снова.`,
  offline: 'Не получилось отправить — проверь связь и попробуй ещё раз.',
  'write-error': 'Что-то пошло не так. Попробуй ещё раз.',
};

export function submissionErrorText(kind: SubmissionErrorKind): string {
  return ERROR_TEXT[kind];
}

/** Проверка ссылки для UX (не источник истины): пусто / не https / чужой хост. */
export type SubmissionUrlCheck =
  { ok: true; url: string } | { ok: false; kind: 'empty-url' | 'scheme' | 'host' };

export function checkSubmissionUrl(raw: string): SubmissionUrlCheck {
  const value = raw.trim();
  if (!value) return { ok: false, kind: 'empty-url' };
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { ok: false, kind: 'scheme' };
  }
  if (url.protocol !== 'https:') return { ok: false, kind: 'scheme' };
  // userinfo (логин@) и нестандартный порт сервер тоже отклоняет.
  if (url.username || url.password) return { ok: false, kind: 'host' };
  if (url.port && url.port !== '443') return { ok: false, kind: 'host' };
  const host = url.hostname.toLowerCase();
  if (!(SUBMISSION_ALLOWED_HOSTS as readonly string[]).includes(host)) {
    return { ok: false, kind: 'host' };
  }
  return { ok: true, url: value };
}

/** Пользовательский ввод формы (сырые значения полей). */
export interface SubmissionInput {
  title: string;
  video_url: string;
  comment: string;
}

const charLength = (value: string): number => [...value].length;

/**
 * Клиентская проверка формы: ошибка или null. Сервер проверяет то же самое
 * заново — здесь только чтобы не гонять заведомо плохую заявку.
 */
export function validateSubmissionInput(input: SubmissionInput): SubmissionErrorKind | null {
  if (!input.video_url.trim()) return 'empty-url';
  if (!input.title.trim()) return 'empty-title';
  const url = checkSubmissionUrl(input.video_url);
  if (!url.ok) return url.kind;
  if (charLength(input.title.trim()) > SUBMISSION_TITLE_MAX) return 'title-too-long';
  if (charLength(input.video_url.trim()) > SUBMISSION_URL_MAX) return 'url-too-long';
  if (charLength(input.comment.trim()) > SUBMISSION_COMMENT_MAX) return 'comment-too-long';
  return null;
}

/** Итог отправки: номер заявки сервера либо дружелюбный вид ошибки. */
export type SubmitResult =
  { status: 'ok'; id: number } | { status: 'error'; kind: SubmissionErrorKind };

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'object' && err !== null && 'message' in err) {
    return String((err as { message: unknown }).message);
  }
  return String(err);
}

/** Маппинг ошибок триггера/сети на виды (тексты — ERROR_TEXT). */
function mapSubmissionError(err: unknown): SubmissionErrorKind {
  const raw = errorMessage(err);
  const low = raw.toLowerCase();
  if (low.includes('not authenticated')) return 'unauthenticated';
  // Истёкшая сессия/снятые гранты: RLS, JWT и permission denied → перелогин.
  if (
    low.includes('permission denied') ||
    low.includes('row-level security') ||
    low.includes('jwt')
  ) {
    return 'session-expired';
  }
  if (low.includes('video url required')) return 'empty-url';
  if (low.includes('title required')) return 'empty-title';
  if (low.includes('must be https')) return 'scheme';
  if (low.includes('host not allowed')) return 'host';
  if (low.includes('title too long')) return 'title-too-long';
  if (low.includes('comment too long')) return 'comment-too-long';
  if (low.includes('video url too long')) return 'url-too-long';
  if (low.includes('too many open submissions')) return 'limit';
  if (
    low.includes('failed to fetch') ||
    low.includes('networkerror') ||
    low.includes('network error') ||
    low.includes('load failed') ||
    low.includes('offline') ||
    err instanceof TypeError
  ) {
    return 'offline';
  }
  return 'write-error';
}

/**
 * Отправить заявку: INSERT только пользовательских полей, автора/статус/связи
 * ставит сервер. Успех — номер из ответа сервера (.select('id') — под RLS «свои»).
 */
export async function submitSubmission(input: SubmissionInput): Promise<SubmitResult> {
  const sb = getSupabase();
  if (!sb) return { status: 'error', kind: 'offline' };
  const { data: sessionData } = await sb.auth.getSession();
  if (!sessionData.session?.user.id) return { status: 'error', kind: 'unauthenticated' };
  const comment = input.comment.trim();
  try {
    const { data, error } = await sb
      .from('submissions')
      .insert({
        title: input.title.trim(),
        video_url: input.video_url.trim(),
        comment: comment || null,
      })
      .select('id')
      .single();
    if (error) return { status: 'error', kind: mapSubmissionError(error) };
    const id = Number((data as { id: unknown }).id);
    if (!Number.isFinite(id)) return { status: 'error', kind: 'write-error' };
    return { status: 'ok', id };
  } catch (err) {
    return { status: 'error', kind: mapSubmissionError(err) };
  }
}
