// Инлайн-видео лота: единственная реализация на SSR-компонент LotVideo и
// клиентский рендер витрины/страницы лота. webp-постер + оверлей «▶ смотреть»;
// клик → инлайн-<video controls autoplay playsinline>. Тройка MemeAlerts:
// webm — канон, mp4/постер выводятся заменой хвоста. При мёртвом URL скрипт
// возвращает постер обратно.

export interface VideoSources {
  webm: string;
  mp4: string;
  poster: string;
}

const WEBM_RE = /\.webm(\?.*)?$/i;
const MP4_RE = /\.mp4(\?.*)?$/i;

/** Источники видео из `video_url` (webm — канон, mp4/постер — заменой хвоста). */
export function videoSources(videoUrl: string | null | undefined): VideoSources {
  const webm = videoUrl ?? '';
  // Будущие свои URL без .webm (напр. .mp4 из Storage) — как есть, без битого постера.
  const isWebm = WEBM_RE.test(webm);
  const isMp4 = MP4_RE.test(webm);
  const mp4 = isWebm ? webm.replace(WEBM_RE, '.mp4$1') : isMp4 ? webm : '';
  const poster = isWebm ? webm.replace(WEBM_RE, '.webp$1') : '';
  return { webm, mp4, poster };
}

/**
 * Пропорция кадра лота (доменное понятие, а не строка Tailwind):
 * `square` — квадрат; `portrait` — «телефонный» кадр карточки витрины
 * (77/136 ≈ 0.566 — kubic_lego.mp4 = 308×544); `natural` — страница лота:
 * рамка принимает фактическую пропорцию постера, видео видно целиком.
 * Классы — литералами, иначе Tailwind не увидит их при сканировании.
 */
export type MediaAspect = 'square' | 'portrait' | 'natural';

export function mediaAspectClass(aspect: MediaAspect): string {
  // `natural` до загрузки постера держит квадрат-плейсхолдер (не схлопываться
  // в нулевую высоту); фактическую пропорцию ставит data-media-adapt ниже.
  return aspect === 'portrait' ? 'aspect-[77/136]' : 'aspect-square';
}

/** Пропорция кадра карточки витрины — одна на карточку и её скелетон. */
export const LOT_CARD_ASPECT: MediaAspect = 'portrait';

/** Кадр страницы лота: по фактической пропорции постера (видео целиком). */
export const LOT_DETAIL_ASPECT: MediaAspect = 'natural';

function isWebmUrl(url: string): boolean {
  return WEBM_RE.test(url);
}

function playInlineVideo(root: HTMLElement): void {
  const webm = root.dataset.videoWebm ?? '';
  const mp4 = root.dataset.videoMp4 ?? '';
  const poster = root.dataset.videoPoster ?? '';
  if (!webm) return;
  const original = root.innerHTML;
  let restored = false;
  const restorePoster = (): void => {
    if (restored) return;
    restored = true;
    root.innerHTML = original;
    delete root.dataset.videoInit;
    initLotVideos(root.parentElement ?? root);
  };
  const video = document.createElement('video');
  video.controls = true;
  video.autoplay = true;
  video.playsInline = true;
  video.setAttribute('playsinline', '');
  video.preload = 'metadata';
  if (poster) video.poster = poster;
  video.className = 'h-full w-full object-cover';
  // Сорсы по расширению канона: webm (+выводной mp4) либо одиночный mp4.
  const sources: { src: string; type: string }[] = [];
  if (isWebmUrl(webm)) {
    sources.push({ src: webm, type: 'video/webm' });
    if (mp4 && mp4 !== webm) sources.push({ src: mp4, type: 'video/mp4' });
  } else if (mp4) {
    sources.push({ src: mp4, type: 'video/mp4' });
  }
  let failed = 0;
  for (const s of sources) {
    const el = document.createElement('source');
    el.src = s.src;
    el.type = s.type;
    // Мёртвый URL: все сорсы битые → остаётся постер.
    el.addEventListener('error', () => {
      failed += 1;
      if (failed >= sources.length) restorePoster();
    });
    video.appendChild(el);
  }
  video.addEventListener('error', restorePoster);
  // Кадр не чистим целиком: оверлеи-слоты (бейдж владельца, метка «Твой») —
  // тоже дети корня, они должны остаться поверх играющего видео. Убираем
  // только постер и кнопку «смотреть».
  root
    .querySelectorAll('[data-lot-video-poster], [data-lot-video-play]')
    .forEach((el) => el.remove());
  root.insertBefore(video, root.firstChild);
}

/**
 * Ориентация кадра по фактической пропорции постера.
 * `wide` — заметно шире квадрата (16:9 и т.п.); `square` — около 1:1;
 * `portrait` — «телефонный», как большинство лотов.
 */
export type MediaOrientation = 'portrait' | 'square' | 'wide';

/** Порог «широкого» кадра: ≥ 1.2 — уже заметно 16:9-подобное. */
const WIDE_RATIO_MIN = 1.2;
/** Ниже этого — портрет; между порогами кадр считаем квадратом. */
const SQUARE_RATIO_MIN = 0.9;

export type OrientationHandler = (
  orientation: MediaOrientation,
  root: HTMLElement,
  img: HTMLImageElement
) => void;

function orientationOf(w: number, h: number): MediaOrientation | null {
  if (!w || !h) return null;
  const ratio = w / h;
  if (ratio >= WIDE_RATIO_MIN) return 'wide';
  if (ratio >= SQUARE_RATIO_MIN) return 'square';
  return 'portrait';
}

/**
 * Подобрать показ кадра по фактической пропорции постера (на лету, когда
 * картинка загрузилась). `natural` (страница лота) — рамка всегда по
 * фактической пропорции и вписывание: видео видно целиком в любой ориентации.
 * Иначе — правила витрины: портрет оставляет базовую «телефонную» рамку с
 * заполнением; широкое берёт рамку по пропорции видео и вписывание (иначе 16:9
 * в 9:16 обрезается до центра); квадрат оставляет базовую рамку с вписыванием.
 * Наружу отдаём ориентацию (`onOrientation`): раскладку карточки (полоса,
 * размытая подложка) решает витрина — это её забота, не общая.
 */
function applyPosterFit(
  root: HTMLElement,
  img: HTMLImageElement,
  onOrientation?: OrientationHandler
): void {
  const orientation = orientationOf(img.naturalWidth, img.naturalHeight);
  if (!orientation) return;
  if (orientation === 'wide' || root.dataset.mediaAdapt === '1') {
    root.style.aspectRatio = `${img.naturalWidth} / ${img.naturalHeight}`;
    root.dataset.mediaFit = 'contain';
  } else {
    root.style.removeProperty('aspect-ratio');
    if (orientation === 'square') root.dataset.mediaFit = 'contain';
    else delete root.dataset.mediaFit;
  }
  onOrientation?.(orientation, root, img);
}

/**
 * Заполнить корень видео данными лота (клиентский рендер).
 * Пустой `videoUrl` — корень прячется. Идущее воспроизведение не трогаем.
 * `onOrientation` (витрина) вызывается, когда известна пропорция постера.
 */
export function fillVideo(
  root: Element | null,
  videoUrl: string | null | undefined,
  onOrientation?: OrientationHandler
): void {
  if (!(root instanceof HTMLElement)) return;
  if (root.querySelector('video')) return;
  const { webm, mp4, poster } = videoSources(videoUrl);
  if (webm) {
    root.dataset.videoWebm = webm;
    root.dataset.videoMp4 = mp4;
    root.dataset.videoPoster = poster;
  } else {
    delete root.dataset.videoWebm;
    delete root.dataset.videoMp4;
    delete root.dataset.videoPoster;
  }
  const img = root.querySelector('[data-lot-video-poster]');
  if (img instanceof HTMLImageElement) {
    // Один слушатель на постер: при смене src пересчитает пропорцию заново.
    if (img.dataset.ratioBound !== '1') {
      img.dataset.ratioBound = '1';
      img.addEventListener('load', () => applyPosterFit(root, img, onOrientation));
    }
    if (poster) {
      if (img.getAttribute('src') !== poster) img.src = poster;
      // Из кэша картинка может быть уже готова — load не придёт.
      if (img.complete && img.naturalWidth > 0) applyPosterFit(root, img, onOrientation);
    } else {
      img.removeAttribute('src');
      root.style.removeProperty('aspect-ratio');
      delete root.dataset.mediaFit;
    }
  }
  root.classList.toggle('hidden', webm.length === 0);
}

/** Навесить клик «смотреть» на корни видео в scope (идемпотентно). */
export function initLotVideos(scope: ParentNode = document): void {
  scope.querySelectorAll('[data-lot-video-root]').forEach((node) => {
    if (!(node instanceof HTMLElement)) return;
    if (node.dataset.videoInit === '1') return;
    if (!node.dataset.videoWebm) return;
    node.dataset.videoInit = '1';
    node.querySelector('[data-lot-video-play]')?.addEventListener('click', () => {
      playInlineVideo(node);
    });
  });
}
