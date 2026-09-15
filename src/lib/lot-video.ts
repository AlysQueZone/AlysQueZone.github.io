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

/** Источники видео из `video_url` (webm — канон, mp4/постер — заменой хвоста). */
export function videoSources(videoUrl: string | null | undefined): VideoSources {
  const webm = videoUrl ?? '';
  // Будущие свои URL без .webm (напр. .mp4 из Storage) — как есть, без битого постера.
  const isWebm = /\.webm(\?.*)?$/i.test(webm);
  const isMp4 = /\.mp4(\?.*)?$/i.test(webm);
  const mp4 = isWebm ? webm.replace(/\.webm(\?.*)?$/i, '.mp4$1') : isMp4 ? webm : '';
  const poster = isWebm ? webm.replace(/\.webm(\?.*)?$/i, '.webp$1') : '';
  return { webm, mp4, poster };
}

function isWebmUrl(url: string): boolean {
  return /\.webm(\?.*)?$/i.test(url);
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
  root.innerHTML = '';
  root.appendChild(video);
}

/**
 * Заполнить корень видео данными лота (клиентский рендер).
 * Пустой `videoUrl` — корень прячется. Идущее воспроизведение не трогаем.
 */
export function fillVideo(
  root: Element | null,
  videoUrl: string | null | undefined,
  title: string
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
  root.dataset.videoTitle = title;
  const img = root.querySelector('[data-lot-video-poster]');
  if (img instanceof HTMLImageElement) {
    if (poster) img.src = poster;
    else img.removeAttribute('src');
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
