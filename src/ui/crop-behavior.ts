/*
  画像の切り抜きの調整（Discord のアイコンの調整と同じ。ドラッグで位置、スライダー・ホイール・
  ピンチで大きさを合わせて「適用」）。管理画面のメンバーのアバターだけが使う。

  **JavaScript が無くても、画像は今までどおり選んで送れる**（これは上に乗せる補助）。動くのは
  ダイアログ（AdminForm.tsx の CropDialog）とファイル欄（data-crop）が両方あるときだけ。

  - 切り抜いた結果は、新しい画像ファイルとしてファイル欄へ入れ直して送る（サーバーは今までと同じ
    検査で受ける。DB に位置の列は持たない）。丸く表示するのは今までどおり CSS の仕事で、ここで
    切るのは丸に外接する正方形まで。**枠いっぱいに敷いた大きさ（cover）より小さくはできない**
    （余白も、画像の全体を丸に収める動きも持たない。Discord と同じ。動かせるのは位置と拡大だけ）
  - 出力は最大 512px。PNG が大きすぎる（サーバーの上限 1MB に近い）ときは JPEG に落とす
    （透明な画素は白で埋める）
  - 動く画像（GIF）と、このブラウザが開けない画像は調整せず、そのまま送る
  - 選んだ元の画像は、調整をやめたらファイル欄から外す（大きな元画像がそのまま送られない）
  - 画像は blob: の URL で出す（管理画面の CSP だけ img-src に blob: を足している。src/index.tsx）
  - ユーザーの入力をコードへ埋め込まない。CSP は ADMIN_BEHAVIOR 全文の SHA-256 だけを許す
    （この関数も admin-behavior.ts の中に入る）。改行・空白もハッシュに入るので、直したら
    ADMIN_CSP も直す（test/headers.test.ts が突き合わせる）
*/
export const CROP_INIT = `(document) => {
  const dialog = document.querySelector('dialog.crop');
  const input = document.querySelector('input[type=file][data-crop]');
  if (!dialog || !input || typeof dialog.showModal !== 'function' || !window.DataTransfer) return;
  const stage = dialog.querySelector('.crop__stage');
  const image = dialog.querySelector('.crop__image');
  const zoom = dialog.querySelector('.crop__zoom input');
  const apply = dialog.querySelector('[data-crop-apply]');
  const cancel = dialog.querySelector('[data-crop-cancel]');
  const status = dialog.querySelector('[role=status]');
  const current = document.querySelector('[data-crop-current]');
  if (!stage || !image || !zoom || !apply || !cancel || !status) return;

  const OUTPUT = 512;
  const LIMIT = 900000;
  const ZOOM_MAX = 4;
  const STEPS = 1000;
  const KINDS = ['image/png', 'image/jpeg', 'image/webp', 'image/avif'];
  let objectUrl = null;
  let fromInput = false;
  let applied = false;
  let active = false;
  let programmatic = false;
  let type = 'image/png';
  let name = 'avatar';
  let size = 0;
  let natural = { w: 0, h: 0 };
  let scale = 1;
  let cover = 1;
  let most = 1;
  let ox = 0;
  let oy = 0;

  // 枠いっぱいに敷く大きさ（cover。これより小さくしない）と、拡大の上限（most）
  const fit = () => {
    size = stage.clientWidth;
    cover = size / Math.min(natural.w, natural.h);
    most = cover * ZOOM_MAX;
  };
  // 画像の縁が枠の中へ入らない（どの向きも枠より大きい）
  const clamp = () => {
    const x = Math.max(0, (natural.w * scale - size) / 2);
    const y = Math.max(0, (natural.h * scale - size) / 2);
    ox = Math.max(-x, Math.min(x, ox));
    oy = Math.max(-y, Math.min(y, oy));
  };
  const draw = () => {
    clamp();
    const w = natural.w * scale;
    const h = natural.h * scale;
    image.style.width = w + 'px';
    image.style.height = h + 'px';
    image.style.transform = 'translate(' + (size / 2 + ox - w / 2) + 'px,' + (size / 2 + oy - h / 2) + 'px)';
    zoom.value = String(Math.round(STEPS * Math.log(scale / cover) / Math.log(ZOOM_MAX)));
    zoom.setAttribute('aria-valuetext', Math.round(scale / cover * 100) + '%');
  };
  // 大きさは枠の真ん中を軸に変える（位置は大きさに比例して動く）
  const zoomTo = (next) => {
    next = Math.max(cover, Math.min(most, next));
    const k = next / scale;
    ox *= k;
    oy *= k;
    scale = next;
    draw();
  };

  const open = async (src) => {
    image.src = src;
    try {
      await image.decode();
    } catch (error) {
      return false;
    }
    natural = { w: image.naturalWidth, h: image.naturalHeight };
    if (!natural.w || !natural.h) return false;
    applied = false;
    active = true;
    status.textContent = '';
    apply.disabled = false;
    dialog.showModal();
    fit();
    scale = cover;
    ox = 0;
    oy = 0;
    draw();
    return true;
  };

  const sendChange = () => {
    programmatic = true;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    programmatic = false;
  };

  input.addEventListener('change', async (event) => {
    if (programmatic) return;
    const file = input.files && input.files[0];
    if (!file || !KINDS.includes(file.type)) return;
    // 調整が終わるまで、元の（大きな）画像でプレビューを描き直させない
    event.stopPropagation();
    objectUrl = URL.createObjectURL(file);
    type = file.type;
    const dot = file.name.lastIndexOf('.');
    name = (dot > 0 ? file.name.slice(0, dot) : file.name) || 'avatar';
    fromInput = true;
    if (await open(objectUrl)) return;
    // このブラウザが開けない画像は、調整せずそのまま送る
    URL.revokeObjectURL(objectUrl);
    objectUrl = null;
    sendChange();
  });

  if (current) {
    current.hidden = false;
    current.addEventListener('click', async () => {
      const src = current.dataset.cropCurrent || '';
      type = src.toLowerCase().endsWith('.jpg') ? 'image/jpeg' : 'image/png';
      name = 'avatar';
      fromInput = false;
      objectUrl = null;
      await open(src);
    });
  }

  // 指・マウスの動き。1本は位置、2本は大きさ（と位置）
  const pointers = new Map();
  let start = null;
  const middle = (list) => ({
    x: list.reduce((sum, point) => sum + point.x, 0) / list.length,
    y: list.reduce((sum, point) => sum + point.y, 0) / list.length,
  });
  const gap = (list) => (list.length > 1 ? Math.hypot(list[0].x - list[1].x, list[0].y - list[1].y) : 0);
  const begin = () => {
    const list = [...pointers.values()];
    start = list.length ? { ox, oy, scale, mid: middle(list), gap: gap(list) } : null;
  };
  stage.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    stage.setPointerCapture(event.pointerId);
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    begin();
    stage.focus();
  });
  stage.addEventListener('pointermove', (event) => {
    if (!start || !pointers.has(event.pointerId)) return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const list = [...pointers.values()];
    const mid = middle(list);
    const next = start.gap ? Math.max(cover, Math.min(most, start.scale * gap(list) / start.gap)) : start.scale;
    const k = next / start.scale;
    scale = next;
    ox = start.ox * k + (mid.x - start.mid.x);
    oy = start.oy * k + (mid.y - start.mid.y);
    draw();
  });
  const release = (event) => {
    pointers.delete(event.pointerId);
    begin();
  };
  stage.addEventListener('pointerup', release);
  stage.addEventListener('pointercancel', release);
  stage.addEventListener('wheel', (event) => {
    event.preventDefault();
    zoomTo(scale * Math.exp(-event.deltaY * (event.ctrlKey ? 0.01 : 0.0015)));
  }, { passive: false });
  // キーボード: 矢印で位置（Shift で大きく）、+ と - で大きさ
  stage.addEventListener('keydown', (event) => {
    const step = event.shiftKey ? 40 : 8;
    const move = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[event.key];
    if (move) {
      ox += move[0];
      oy += move[1];
      draw();
    } else if (event.key === '+' || event.key === '=') {
      zoomTo(scale * 1.1);
    } else if (event.key === '-') {
      zoomTo(scale / 1.1);
    } else {
      return;
    }
    event.preventDefault();
  });
  zoom.addEventListener('input', () => zoomTo(cover * Math.pow(ZOOM_MAX, Number(zoom.value) / STEPS)));
  window.addEventListener('resize', () => {
    if (!dialog.open) return;
    const before = size;
    fit();
    const k = size / before;
    scale *= k;
    ox *= k;
    oy *= k;
    draw();
  });

  // 枠の中に見えている範囲を、正方形の画像にして書き出す
  const paint = (out, backdrop) => {
    const canvas = document.createElement('canvas');
    canvas.width = out;
    canvas.height = out;
    const context = canvas.getContext('2d');
    if (backdrop) {
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, out, out);
    }
    context.imageSmoothingQuality = 'high';
    const k = out / size;
    const w = natural.w * scale;
    const h = natural.h * scale;
    context.drawImage(image, (size / 2 + ox - w / 2) * k, (size / 2 + oy - h / 2) * k, w * k, h * k);
    return canvas;
  };
  const encode = (canvas, mime, quality) => new Promise((resolve) => canvas.toBlob(resolve, mime, quality));

  apply.addEventListener('click', async () => {
    apply.disabled = true;
    status.textContent = '画像を作っています…';
    // 枠が元の画像の何 px にあたるか（元より細かくは書き出さない）
    const out = Math.max(64, Math.min(OUTPUT, Math.round(size / scale)));
    let blob = null;
    if (type !== 'image/jpeg') blob = await encode(paint(out, false), 'image/png');
    if (!blob || type === 'image/jpeg' || blob.size > LIMIT) {
      blob = null;
      for (const quality of [0.92, 0.82, 0.7, 0.55]) {
        const made = await encode(paint(out, true), 'image/jpeg', quality);
        if (made && made.size <= LIMIT) {
          blob = made;
          break;
        }
      }
    }
    if (!blob) {
      status.textContent = '画像を作れませんでした。別の画像を選んでください';
      apply.disabled = false;
      return;
    }
    const file = new File([blob], name + (blob.type === 'image/png' ? '.png' : '.jpg'), { type: blob.type });
    const transfer = new DataTransfer();
    transfer.items.add(file);
    input.files = transfer.files;
    applied = true;
    // プレビューの描き直し（admin-behavior の change）へ、調整した画像を知らせる
    sendChange();
    dialog.close();
    finish();
  });

  /*
    後片付けは、閉じる手の側で1回だけ同期にやる（close イベントは閉じたあとに遅れて届く。そこで
    やると、直後に選び直した画像の準備まで片付けてしまう）。Esc は cancel、ボタンは自分の
    click で呼ぶ。close は取りこぼしの保険（開き直していれば何もしない）
  */
  const finish = () => {
    if (!active) return;
    active = false;
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = null;
    // 調整をやめたら、選んだ元の画像は送らない
    if (fromInput && !applied) input.value = '';
    image.removeAttribute('src');
    pointers.clear();
    start = null;
    const back = fromInput ? input : current;
    if (back) back.focus();
  };
  cancel.addEventListener('click', () => {
    dialog.close();
    finish();
  });
  dialog.addEventListener('cancel', finish);
  dialog.addEventListener('close', () => {
    if (!dialog.open) finish();
  });
}`
