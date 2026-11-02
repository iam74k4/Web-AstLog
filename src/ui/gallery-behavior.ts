/*
  作品ページだけのショーケース。HTML は全画像の縦ギャラリーとして完結させ、
  初期化できたときだけ1枚表示にする。プレビューの sandbox と印刷では全画像を見せる。
  ユーザーの入力をコードへ埋め込まない。CSP は下の全文の SHA-256 だけを許す。
*/
export const isGalleryPage = (path: string) => /\/(?:apps|works)\/item\/[^/]+$/.test(path)

export const GALLERY_BEHAVIOR = `(() => {
  document.querySelectorAll('[data-showcase]').forEach(root => {
    const slides = [...root.querySelectorAll('.gallery__item')];
    const thumbs = [...root.querySelectorAll('.gallery__thumb')];
    const controls = root.querySelector('.gallery__controls');
    const count = root.querySelector('[data-gallery-count]');
    const status = root.querySelector('[data-gallery-status]');
    if (slides.length < 2 || slides.length !== thumbs.length || !controls) return;
    let current = 0;
    const select = (index, announce = true) => {
      current = (index + slides.length) % slides.length;
      slides.forEach((slide, i) => {
        const active = i === current;
        slide.dataset.active = String(active);
        slide.inert = !active;
        if (!active) slide.querySelectorAll('video').forEach(video => video.pause());
        thumbs[i].setAttribute('aria-pressed', String(active));
      });
      const image = slides[current].querySelector('img');
      if (image) image.loading = 'eager';
      count.textContent = String(current + 1).padStart(2, '0') + ' / ' + String(slides.length).padStart(2, '0');
      if (announce) status.textContent = (current + 1) + ' / ' + slides.length + '：' + slides[current].querySelector('.gallery__description').textContent;
    };
    thumbs.forEach((thumb, index) => {
      thumb.addEventListener('click', () => select(index));
      thumb.addEventListener('keydown', event => {
        const target = event.key === 'ArrowRight' ? index + 1 : event.key === 'ArrowLeft' ? index - 1 : event.key === 'Home' ? 0 : event.key === 'End' ? slides.length - 1 : null;
        if (target === null) return;
        event.preventDefault();
        select(target);
        thumbs[current].focus({preventScroll: true});
      });
    });
    root.querySelector('[data-gallery-prev]').addEventListener('click', () => select(current - 1));
    root.querySelector('[data-gallery-next]').addEventListener('click', () => select(current + 1));
    select(0, false);
    root.classList.add('shots--showcase');
    controls.hidden = false;
    // 印刷では隠していた画像・動画の説明も支援技術から読めるようにする。
    addEventListener('beforeprint', () => slides.forEach(slide => { slide.inert = false; }));
    addEventListener('afterprint', () => select(current, false));
  });
})();`

export const GALLERY_CSP = 'sha256-QmGghep38jR04g1mC/T9K1x/Uqh7N2pDD1OCuFXZpSY='
