/**
 * Публичный Storage-бакет media (карта video-s3).
 *
 * UI-звуки (`sounds/*.mp3`) + место под свои видео (`videos/`).
 * URL абсолютные, без Astro ${base} — по §3 спеки.
 */
export const S3_MEDIA_BASE =
  'https://wsunalldyhuwfhlzwpyp.supabase.co/storage/v1/object/public/media';

/** Публичный URL UI-звука из бакета media. */
export function s3Sound(file: string): string {
  return `${S3_MEDIA_BASE}/sounds/${file}`;
}
