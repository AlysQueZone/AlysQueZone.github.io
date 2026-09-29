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
 * `square` — страница лота; `portrait` — «телефонный» кадр карточки витрины
 * (77/136 ≈ 0.566 — kubic_lego.mp4 = 308×544). Классы — литералами, иначе
 * Tailwind не увидит их при сканировании.
 */
export type MediaAspect = 'square' | 'portrait';

export function mediaAspectClass(aspect: MediaAspect): string {
  return aspect === 'portrait' ? 'aspect-[77/136]' : 'aspect-square';
}

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
 * Подобрать показ кадра по фактической пропорции постера (на лету, когда
 * картинка загрузилась). Портрет — родная «телефонная» рамка карточки с
 * заполнением; широкая/квадратная картинка (16:9 и пр.) — рамка по её
 * пропорции и вписывание целиком: в 9:16 такие обрезаются до центра.
 */
function applyPosterFit(root: HTMLElement, img: HTMLImageElement): void {
  const { naturalWidth: w, naturalHeight: h } = img;
  if (!w || !h) return;
  if (w >= h) {
    root.style.aspectRatio = `${w} / ${h}`;
    root.dataset.mediaFit = 'contain';
  } else {
    root.style.removeProperty('aspect-ratio');
    delete root.dataset.mediaFit;
  }
}

/**
 * Заполнить корень видео данными лота (клиентский рендер).
 * Пустой `videoUrl` — корень прячется. Идущее воспроизведение не трогаем.
 */
export function fillVideo(root: Element | null, videoUrl: string | null | undefined): void {
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
      img.addEventListener('load', () => applyPosterFit(root, img));
    }
    if (poster) {
      if (img.getAttribute('src') !== poster) img.src = poster;
      // Из кэша картинка может быть уже готова — load не придёт.
      if (img.complete && img.naturalWidth > 0) applyPosterFit(root, img);
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
