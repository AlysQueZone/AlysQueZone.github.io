// Эмоуты канала: alysqueCLAP для звука покупки без видео (BuyModal) и гамбы,
// alysqueWAUW — вывеска лота в hero.
// Привязка «эмоут карточки лота» удалена: все лоты теперь видео-мемы.
// Токены в заголовках лотов (напр. o7) рисуются 7TV-эмоутом канала.

/** Нативные эмоуты Twitch канала: хотлинк с static-cdn.jtvnw.net (dark/3.0). */
const twitch = (id: string, variant = 'dark'): string =>
  `https://static-cdn.jtvnw.net/emoticons/v2/${id}/default/${variant}/3.0`;

export const ALYSQUE_CLAP_DARK = twitch('emotesv2_1075070639054e5d8cacb8a0ef4872d7');

/** alysqueWAUW (ID сверен по агрегатору эмоутов канала). */
export const ALYSQUE_WAUW = twitch('305551534');

/** alysqueTHINK — «привет не найден» на 404 (ID сверен там же). */
export const ALYSQUE_THINK = twitch('emotesv2_f5b1c81e684c476794b32d1efbc9b603');

const cdn = (id: string): string => `https://cdn.7tv.app/emote/${id}/2x.webp`;

/** 7TV-эмоут GAMBA канала (ID проверен 2026-09-09 через 7TV API сета):
 *  кнопка «гамба на пивкойны» в шапке и спин в GambaModal. */
export const GAMBA_EMOTE_URL = cdn('01FJT4HEXG000FZHS49NWQT5DZ');

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

/** Отрисовать заголовок лота в DOM (клиентский рендер витрины и страницы лота). */
function renderTitleEmotes(title: string): DocumentFragment {
  const frag = document.createDocumentFragment();
  for (const segment of splitTitleEmotes(title)) {
    if (segment.type === 'emote') {
      const img = document.createElement('img');
      img.src = segment.src;
      img.alt = segment.name;
      img.title = segment.name;
      img.loading = 'lazy';
      img.className = 'inline-block h-[1.1em] w-auto align-[-0.15em]';
      frag.appendChild(img);
    } else {
      frag.appendChild(document.createTextNode(segment.value));
    }
  }
  return frag;
}

/** Поставить заголовок лота в контейнер (замена содержимого). */
export function setTitleEmotes(el: Element | null, title: string): void {
  if (!el) return;
  el.replaceChildren(renderTitleEmotes(title));
}
