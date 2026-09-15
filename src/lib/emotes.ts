// Эмоуты канала: alysqueCLAP для звука покупки без видео (BuyModal) и гамбы.
// Привязка «эмоут карточки лота» удалена: все лоты теперь видео-мемы.
// Токены в заголовках лотов (напр. o7) рисуются 7TV-эмоутом канала.

export const ALYSQUE_CLAP_LIGHT =
  'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_1075070639054e5d8cacb8a0ef4872d7/default/light/3.0';
export const ALYSQUE_CLAP_DARK =
  'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_1075070639054e5d8cacb8a0ef4872d7/default/dark/3.0';

const cdn = (id: string): string => `https://cdn.7tv.app/emote/${id}/2x.webp`;

/** Токен заголовка → 7TV-эмоут канала (ID сверен 2026-09-15 по сету alysque). */
const TITLE_EMOTES: Record<string, { src: string; name: string }> = {
  o7: { src: cdn('01KD6VPC2JC6Q7RCT4S6D6ZTWQ'), name: 'o7' },
};

export type TitleSegment =
  { type: 'text'; value: string } | { type: 'emote'; src: string; name: string };

/** Заголовок лота на текст и эмоуты: слова-токены заменяются картинкой. */
export function splitTitleEmotes(title: string): TitleSegment[] {
  const segments: TitleSegment[] = [];
  for (const part of title.split(/(\s+)/)) {
    if (!part) continue;
    const emote = TITLE_EMOTES[part.toLowerCase()];
    segments.push(emote ? { type: 'emote', ...emote } : { type: 'text', value: part });
  }
  return segments;
}
