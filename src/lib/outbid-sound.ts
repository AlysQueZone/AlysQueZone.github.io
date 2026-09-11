/**
 * Звук уведомления «лот перекупили».
 *
 * Выделено из outbid-notice.ts (карта code-quality, распил монолита).
 * Звук только после первого взаимодействия — автоплей-политика;
 * играет и при свёрнутой вкладке.
 */

import { s3Sound } from './media';

export function outbidSoundUrl(): string {
  return s3Sound('outbid.mp3');
}

export function playOutbidSound(interacted: boolean): void {
  if (!interacted) return;
  try {
    const p = new Audio(outbidSoundUrl()).play();
    if (p && typeof p.catch === 'function') p.catch(() => {});
  } catch {
    // без звука — уведомление всё равно показано
  }
}
