/*
  表紙の天体画や軌道図のまわりで、文字が読めるか（WCAG 1.4.3）を実際にブラウザで測る。

  軌道図が出るのはサイトの並びの最初と最後——入口（左に大見出しの列、右に作品の
  軌道図、底に件数の帯）と、締めの Contact（同じ星系を上に置く。字は誘いの
  1文とメールと GitHub の手）。測る画面と字の一覧は下の SCREENS。

  軌道の線とブラックホールの光は字のそばを通る。線は細くても、濃さや置き方を間違えれば
  字の後ろが明るくなる——前の入口の月では、リード文が明るい縁に載って **1.00:1**、
  つまりその字は背景と同じ明るさで、完全に消えていた。軌道図の真ん中に名前を
  置いていたころは、名前を横切る白い線で 3.08:1 まで寄った。いまは軌道図の中に字を
  置かない。

  これは vitest では捕まらない。あちらは workerd の中で動くので版面を持たず、
  CSS の文字列は読めても「実際に何色の上に何色が乗るか」は分からない。
  check-fit.mjs と同じ理由でブラウザが要る。

  測り方に1つ落とし穴がある。**合成後の画面をそのまま読んではいけない。**
  文字のグリフそのものが写っているので、それを「背景」として数えると
  どの組も 1.00:1 になり（文字の色 vs 文字の色）、検査は意味を失う。
  だから字を visibility: hidden にした「地だけ」を撮り、文字が実際に乗る
  行ボックス（Range.getClientRects）の下を読む。

  面を持つもの（塗りの押し手「一覧で見る →」）は、字の色だけを抜いて面を残す——面ごと
  隠すと、実際と違う地で測ることになる。

  動きは止めて測る（reducedMotion）。入口の字は浮かび上がって出てくるので、
  止めないと、動いている途中の姿を測ることがある。そのうえで軌道図の継続する動き
  （天体が回り、粒が落ち、星が流れ、ブラックホールの光が揺らぐ。名前が orbit- で始まる
  animation）だけは、途中の姿を最後に別に測る——止めて測るだけでは、変わる光や
  粒・星が字の後ろに掛かる瞬間が見えない。途中の姿では、まだ出ていない字
  （透明・薄くなっている数）は測らない。

  画素は、撮った PNG を別の空のページ（about:blank）へ戻して canvas から読む。Node 側に
  画像を展開する道具を増やさずに済む。測るページへは戻さない——サイトの CSP
  （img-src 'self'）は data: の画像を読ませず、CSP を外して測ると、本物の CSP が
  止めるもの（別オリジンの絵・書体）まで描いた姿で緑になる。

    npm run check:contrast
*/

import { readFile } from 'node:fs/promises'
import process from 'node:process'
import { chromium } from 'playwright'
import { devServer, scratchState } from './lib/dev-server.mjs'
import { keysOf } from './lib/theme.mjs'
import { DESIGN_SIZES, SHORT_WIDE } from './lib/viewports.mjs'

/*
  設計サイズ3つ（scripts/lib/viewports.mjs。check:fit と同じ電話・板・机）に、
  背の低い窓（SHORT_WIDE）を足して幅の順に並べる。電話と板は指で測る（touch。
  check:fit と同じ）。指では押す手が --tap の 44px になり、字の座る位置が動く——
  細いポインタの姿だけを測ると、実物の電話の位置を一度も測らないことになる。
*/
const VIEWPORTS = [...DESIGN_SIZES, SHORT_WIDE]
  .map(({ width, height, touch }) => ({ width, height, touch: Boolean(touch) }))
  .sort((a, b) => a.width - b.width)

// newPage に渡す形（touch は hasTouch へ）。CSP はサイトのまま（上の「画素は」）
const pageOptions = ({ width, height, touch }) => ({
  viewport: { width, height },
  hasTouch: touch,
})

/*
  軌道図が出るページ。サイトの並びの最初（入口）と最後（Contact）の2つだけ——
  /all にも個人ページにも出さない。

  panel はその画面の節。targets は測る字（selector は panel の中で探す）で、
  required の無いものは出ていないサイトでは測らない（札は職種のある1人のサイトだけ、
  件数は作品のあるサイトだけ）。

  hide と ink は「地だけ」を撮るときに字を消すやり方。hide は丸ごと隠す
  （visibility）、ink は字の色だけを抜いて面を残す（color: transparent）。
  塗りの押し手は、面ごと隠すと実際と違う地で測ることになるので ink で抜く。

  minPixels は、軌道図が「出ている」と言える画素数の下限（lines は軌道の線の芯と星屑、bodies は
  天体の光、art はブラックホール、nebula は星雲、stars は星空の星。下の ORBIT_MIN_DELTA）。motion は動きの途中の
  姿を測るか——入口も締めも動き続けるもの（星屑と天体が
  軌道ごと回り、粒が落ち、星が流れ、ブラックホールの光が揺らぎ、星雲が漂い、星が瞬く）。
*/
/*
  画素数の下限（SCREENS の minPixels）。seed で測ったいちばん少ない姿（どれも
  390x844 指）の約半分——入口の軌道の線と星屑 6715・天体 227・ブラックホール 1871・星雲 99257・
  星空の星 169、締めの軌道の線と星屑 6744・天体 227・ブラックホール 1871・星雲 103661・星空の星
  268 画素（締めの星系は入口と同じ大きさ。ブラックホールは影が小さく、光の絵が淡く広がる。
  星空の星は細かく、字の後ろで消すぶん少ない。星雲は画面の端まで広がるが、電話の幅では
  図のまわりに収まる）。「描かれていない」を止める数で、1割の目減りを止める数ではない
  （下の ORBIT_MIN_DELTA）
*/
const LINES_HERO = 3300
const BODIES_HERO = 65
const ART_HERO = 930
const NEBULA_HERO = 49000
const STARS_HERO = 80
const LINES_CONTACT = 3300
const BODIES_CONTACT = 65
const ART_CONTACT = 930
const NEBULA_CONTACT = 51000
const STARS_CONTACT = 130

const SCREENS = [
  {
    name: '入口',
    path: '/',
    panel: 'main > .hero',
    targets: [
      { selector: '.hero__copy h1', name: '大見出し', required: true },
      { selector: '.hero__lead', name: 'リード文', required: true },
      { selector: '.eyebrow', name: '職種と所在地の札' },
      { selector: '.cta', name: '一覧への押し手' },
      { selector: '.tally dt', name: '件数の見出し' },
      { selector: ':is(.tally__num, .tally__year)', name: '件数' },
    ],
    hide: 'main > .hero :is(h1, .eyebrow, .hero__lead, .tally dt, .tally dd)',
    ink: 'main > .hero :is(.cta, .cta *)',
    minPixels: {
      lines: LINES_HERO,
      bodies: BODIES_HERO,
      art: ART_HERO,
      nebula: NEBULA_HERO,
      stars: STARS_HERO,
    },
    motion: true,
  },
  {
    name: '締め',
    path: '/contact',
    panel: 'main > .orbital',
    // ブラックホール版は Contact の見出しも見せる。ほかの天体は従来の読み上げ用見出し。
    targets: [
      { selector: '.contact__title', name: 'Contact の見出し' },
      { selector: '.contact__lead', name: 'リード文', required: true },
      { selector: '.contact__address', name: 'メールのアドレス', required: true },
      { selector: '.contact__go', name: '「メールを送る」', required: true },
      { selector: '.contact__sub', name: 'GitHub', required: true },
    ],
    // どれも面を持たないので丸ごと隠す
    hide: 'main > .orbital :is(.contact__title, .contact__lead, .contact__address, .contact__go, .contact__sub)',
    ink: null,
    minPixels: {
      lines: LINES_CONTACT,
      bodies: BODIES_CONTACT,
      art: ART_CONTACT,
      nebula: NEBULA_CONTACT,
      stars: STARS_CONTACT,
    },
    motion: true,
  },
]

/*
  軌道図が地からどれだけ離れて見えるかの下限（描いた画素の明るさが、それを消した
  絵の同じ画素からどれだけ動いたかの中央値、0〜255）。画素数の下限は画面ごと
  （SCREENS の minPixels）。

  明るさそのものではなく差で見るのは、地の色に下限を縛らせないため。明るさで
  見ると、地を少し明るくしただけで線が「明るく」なったことになる。

  軌道の線の芯と天体の光（SVG）と、ブラックホールと、星雲は別々に消して測る。まとめて
  消すと、ブラックホールや星雲だけで下限を越えてしまい、線が描かれなくなっても通る（光の
  縁と雲は線の何倍もの画素を持つ）。

  下限は実測（成功行の「いちばん少ない」の行。天体の中央値は 31——外へ溶ける光なので、縁の
  くっきりした点だったころの 60 の半分ほど）から引いて
  ある——見栄えを縛るのではなく、「描かれていない」「ほぼ見えない」を止めるための
  数だから（地の明るさが 12 なので、明るさ 30 は差で 18）。軌道の線と星屑・星雲・星空の星は
  もともと淡い芯と細かい点と雲なので、下限を別に置く（ORBIT_TRACE_MIN_DELTA / NEBULA_MIN_DELTA /
  STARS_MIN_DELTA。実測の中央値の最小 6.9・14.5・9.0 の約半分）。星雲を軌道の後ろで明るくすると
  「軌道の線と星屑」が下がる——星屑と線を濃くする（--stardust-ink・--orbit-ink）か、明るい
  塊を軌道の帯の外へ寄せる（orbits.ts の nebulaMap）。外の軌道ほど淡くする量（--orbit-outer）も
  同じく下げる——外の軌道は長く、画素の多くを持つ
*/
const ORBIT_MIN_DELTA = 18
const ORBIT_TRACE_MIN_DELTA = 4
const NEBULA_MIN_DELTA = 4
const STARS_MIN_DELTA = 4

/*
  継続する動き（public/app.css の「動き続ける」）のどこで止めて測るか。呼吸の10%と42%、
  最初の流れ星の3%（頭が見え、尾が流れている所）の3コマ。実際の CSS の周期と遅れから時刻を
  組む（motionFrames）。粒・Flow・星の瞬きも同じ時刻へ送り、変わる地の上で字を読む。
  at は周期の割合。selector の無い周期は :root、指定のある周期はその要素から読む。
*/
const MOTION_FRAMES = [
  { of: 'breathe', at: 0.1 },
  { of: 'breathe', at: 0.42 },
  { of: 'meteor', selector: '.cosmos__meteor', at: 0.03 },
]

// MOTION_FRAMES を、ページの CSS の実周期から時刻（ms）に開く
const motionFrames = (frames) => {
  const root = getComputedStyle(document.documentElement)
  const ms = (style, name) => {
    const value = style.getPropertyValue(name).trim()
    if (!/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:ms|s)$/.test(value)) {
      throw new Error(`動きの時刻を読めない: ${name} が「${value}」（ms または s が必要）`)
    }
    const time = Number.parseFloat(value) * (value.endsWith('ms') ? 1 : 1000)
    if (!Number.isFinite(time)) throw new Error(`動きの時刻が非有限: ${name} が「${value}」`)
    return time
  }
  return frames.map(({ of, at, selector }) => {
    if (!Number.isFinite(at) || at <= 0 || at >= 1) {
      throw new Error(`動きの途中の割合が不正: ${of} の ${at}`)
    }
    const element = selector ? document.querySelector(selector) : document.documentElement
    if (!element) throw new Error(`動きの周期を持つ要素が無い: ${selector}`)
    const style = selector ? getComputedStyle(element) : root
    const duration = ms(style, selector ? '--dur' : `--${of}-dur`)
    if (duration <= 0) throw new Error(`動きの周期は正の値が必要: ${of} の ${duration}ms`)
    const delay = selector ? ms(style, '--delay') : 0
    // 負の遅れで途中から始まる流れ星は、指定した位相へ来る次の正の時刻を選ぶ
    const cycle = Math.max(0, Math.ceil(-delay / duration))
    const time = Math.round(delay + duration * (cycle + at))
    if (!Number.isFinite(time) || time <= 0) {
      throw new Error(`動きの途中の時刻が不正: ${of} の ${time}ms`)
    }
    return time
  })
}

// 軌道図の animation を頭から止め、ほかの動き（字の浮かび上がり）は終わらせる。止まる時刻を返す
const holdOrbits = () => {
  // 初期化の待ちを外し、全装飾を同じ時刻へ送る。補助のキューもこの印が消えたら終了する。
  document.documentElement.removeAttribute('data-motion-staged')
  /*
    まず掛け直す。有限の件数の動きは、読み込みが遅いとここへ来る前に終わり、
    getAnimations() に出てこないことがある。いったん外して戻せば頭から送れる。
    getAnimations() はスタイルを確定させるので、外した姿と戻した姿を1回ずつ通る
  */
  const off = document.createElement('style')
  off.textContent =
    ':is(.system, .orbits), :is(.system, .orbits) *, .tally *, .tally__num::after { animation: none !important }'
  document.head.append(off)
  document.getAnimations()
  off.remove()

  /*
    止まる時刻は、名前が orbit- で始まる animation のいちばん遅い終わり。動き続けるもの
    （orbit-swirl / orbit-breathe ほか）は終わらないので Infinity になる——そのときは
    どの時刻のコマも動きの途中。ほかの動き（字の浮かび上がり）は終わらせる。終わらない
    動きは finish() できない（投げる）ので止めるだけ
  */
  let end = 0
  for (const animation of document.getAnimations()) {
    const timing = animation.effect.getComputedTiming()
    if (animation.animationName?.startsWith('orbit-')) {
      animation.pause()
      end = Math.max(end, timing.endTime)
    } else if (Number.isFinite(timing.endTime)) {
      animation.finish()
    } else {
      animation.pause()
    }
  }
  return end
}

const seekOrbits = (at) => {
  if (!Number.isFinite(at) || at <= 0) throw new Error(`動きを送る時刻が不正: ${at}ms`)
  for (const animation of document.getAnimations()) {
    if (animation.animationName?.startsWith('orbit-')) animation.currentTime = at
  }
}

/*
  アクセントを差し替えて、文字の行ボックスと色を集める。
  check-fit.mjs と同じで、保存の経路（D1 とログイン）は通さない——
  測りたいのは版面であって、設定の保存経路ではない。

  まだ出ていない字（組まれていない・色が透明・自分か祖先が薄くなっている）は測らない。入口の動きの
  途中では、件数は数え上げのあいだ字を透明にする——出ていない字の「読めなさ」を数えても
  意味が無い。
*/
const collect = ([accent, screen]) => {
  document.body.dataset.accent = accent

  const panel = document.querySelector(screen.panel)
  if (!panel) return null

  /*
    子孫の文字ノードを全部たどる。見出しとリード文は句読点で切った塊
    （<span class="phrase">）に入っているので、直下の子だけを見ると1行も
    拾えない
  */
  /*
    字の行ボックスは、切っている祖先（overflow が visible でない箱）の中に絞る。
    切られた字は、字のノードの箱が見えている幅より長く、切られた先の——字の描かれていない——
    地まで数えてしまう
  */
  const clipOf = (node) => {
    let clip = { left: -Infinity, top: -Infinity, right: Infinity, bottom: Infinity }
    for (let up = node.parentElement; up && up !== panel; up = up.parentElement) {
      const style = getComputedStyle(up)
      if (style.overflowX === 'visible' && style.overflowY === 'visible') continue
      const box = up.getBoundingClientRect()
      clip = {
        left: Math.max(clip.left, box.left),
        top: Math.max(clip.top, box.top),
        right: Math.min(clip.right, box.right),
        bottom: Math.min(clip.bottom, box.bottom),
      }
    }
    return clip
  }

  const lines = (element) => {
    const found = []
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const range = document.createRange()
      range.selectNodeContents(node)
      const clip = clipOf(node)
      for (const box of range.getClientRects()) {
        const left = Math.max(box.left, clip.left)
        const top = Math.max(box.top, clip.top)
        const right = Math.min(box.right, clip.right)
        const bottom = Math.min(box.bottom, clip.bottom)
        if (right <= left || bottom <= top) continue
        found.push([Math.round(left), Math.round(top), Math.round(right), Math.round(bottom)])
      }
    }
    return found
  }

  const shown = (element) => {
    // 組まれていない字（display: none）は、そもそも画面に無い
    if (element.getClientRects().length === 0) return false
    if (/rgba\(.*,\s*0\)$/.test(getComputedStyle(element).color)) return false
    for (let up = element; up; up = up.parentElement) {
      if (Number.parseFloat(getComputedStyle(up).opacity) < 1) return false
    }
    return true
  }

  const read = (element, name) => {
    const style = getComputedStyle(element)
    const size = Number.parseFloat(style.fontSize)
    const weight = Number.parseInt(style.fontWeight, 10) || 400
    // WCAG 1.4.3 の「大きい文字」: 18pt(24px)、太字なら 14pt(18.66px)
    const large = size >= 24 || (size >= 18.66 && weight >= 700)
    return { name, color: style.color, need: large ? 3 : 4.5, lines: lines(element) }
  }

  /*
    required のものが見つからなければ、行ボックス0件として返す（呼ぶ側が
    「0件」で落とす）。黙って飛ばすと、見出しの class を変えた日にその字だけ
    測られなくなり、しかも緑のまま通る
  */
  return screen.targets.flatMap((target) => {
    const found = [...panel.querySelectorAll(target.selector)].filter(shown)
    if (found.length === 0) {
      return target.required
        ? [{ name: target.name, color: 'rgb(0, 0, 0)', need: 0, lines: [] }]
        : []
    }
    return found.map((node) => read(node, target.name))
  })
}

// 軌道図を消した絵と比べ、軌道図が描いた画素と、地からの離れ（明るさの差）を返す
/*
  書体と絵がそろうのを待つ。ブラックホールの光の絵は decoding="async" なので、読み込み（load）の
  あとでも描かれる前のコマがある——そのコマを撮ると、影の黒い円だけの姿を測る。解き終えた
  あとも、描かれるのは次のコマなので、2コマ待つ（待たないと、最初の1枚だけ絵が抜けた）
*/
const settled = () =>
  Promise.all([
    document.fonts.ready,
    ...[...document.images].map((image) => image.decode().catch(() => undefined)),
    ...[...document.querySelectorAll('.cosmos__nebula')].map(async (node) => {
      const src = getComputedStyle(node).backgroundImage.match(/^url\(["']?(.+?)["']?\)$/)?.[1]
      if (!src) throw new Error('星雲の背景画像がありません')
      const image = new Image()
      image.src = src
      await image.decode()
    }),
  ])
    .then(
      () =>
        new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(() => done(true)))),
    )
    .then(() => true)

const drawnBy = ([shownUrl, hiddenUrl]) => {
  const load = (src) =>
    new Promise((ok, ng) => {
      const image = new Image()
      image.onload = () => ok(image)
      image.onerror = () => ng(new Error('撮った絵をページへ戻せなかった'))
      image.src = src
    })

  return Promise.all([load(shownUrl), load(hiddenUrl)]).then(([shown, hidden]) => {
    const read = (image) => {
      const canvas = document.createElement('canvas')
      canvas.width = image.width
      canvas.height = image.height
      const paper = canvas.getContext('2d', { willReadFrequently: true })
      paper.drawImage(image, 0, 0)
      return paper.getImageData(0, 0, canvas.width, canvas.height).data
    }
    const a = read(shown)
    const b = read(hidden)
    const lit = []
    for (let at = 0; at < a.length; at += 4) {
      const moved = Math.max(
        Math.abs(a[at] - b[at]),
        Math.abs(a[at + 1] - b[at + 1]),
        Math.abs(a[at + 2] - b[at + 2]),
      )
      // 2/255 未満は地との差として見えない
      if (moved >= 2) {
        const shownLuma = 0.2126 * a[at] + 0.7152 * a[at + 1] + 0.0722 * a[at + 2]
        const hiddenLuma = 0.2126 * b[at] + 0.7152 * b[at + 1] + 0.0722 * b[at + 2]
        lit.push(Math.abs(shownLuma - hiddenLuma))
      }
    }
    if (lit.length === 0) return { pixels: 0, median: 0 }
    lit.sort((x, y) => x - y)
    return { pixels: lit.length, median: lit[Math.floor(lit.length / 2)] }
  })
}

// 撮った「地だけ」の絵をページへ戻し、行ボックスの下の画素を読む
const worstIn = ([dataUrl, targets]) => {
  const relative = (channel) => {
    const value = channel / 255
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  }
  const luminance = (r, g, b) => 0.2126 * relative(r) + 0.7152 * relative(g) + 0.0722 * relative(b)

  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onerror = () => reject(new Error('撮った絵をページへ戻せなかった'))
    image.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = image.width
      canvas.height = image.height
      const paper = canvas.getContext('2d', { willReadFrequently: true })
      paper.drawImage(image, 0, 0)

      const results = []
      for (const target of targets) {
        const [r, g, b] = target.color.match(/\d+/g).map(Number)
        const ink = luminance(r, g, b)
        let worst = Number.POSITIVE_INFINITY
        let below = 0
        let total = 0

        for (const [left, top, right, bottom] of target.lines) {
          const x = Math.max(0, left)
          const y = Math.max(0, top)
          const width = Math.min(right, canvas.width) - x
          const height = Math.min(bottom, canvas.height) - y
          if (width <= 0 || height <= 0) continue

          const pixels = paper.getImageData(x, y, width, height).data
          for (let at = 0; at < pixels.length; at += 4) {
            const paperLum = luminance(pixels[at], pixels[at + 1], pixels[at + 2])
            const high = Math.max(ink, paperLum)
            const low = Math.min(ink, paperLum)
            const ratio = (high + 0.05) / (low + 0.05)
            if (ratio < worst) worst = ratio
            if (ratio < target.need) below += 1
            total += 1
          }
        }
        results.push({ name: target.name, need: target.need, worst, below, total })
      }
      resolve(results)
    }
    image.src = dataUrl
  })
}

async function main() {
  // CI と同じ公開内容を使い捨て D1 へ入れる。手元のローカル D1 は触らない。
  const state = process.env.CONTRAST_BASE
    ? null
    : await scratchState('contrast', [
        await readFile(new URL('../seed.sql', import.meta.url), 'utf8'),
      ])
  let server
  try {
    server = await devServer(
      process.env.CONTRAST_BASE,
      Number(process.env.CONTRAST_PORT ?? 8789),
      state?.dir,
    )
  } catch (error) {
    await state?.cleanup()
    throw error
  }
  const { base, stop } = server

  const accents = keysOf('ACCENTS')
  const browser = await chromium.launch()
  // 撮った絵を読む空のページ（about:blank。サイトの CSP を持たない。上の「画素は」）
  const decoder = await browser.newPage()
  const failures = []
  let checked = 0
  let tightest = { ratio: Number.POSITIVE_INFINITY, where: '' }
  /*
    いちばん薄かった軌道図は画面ごと・描いたものごと（線と点・ブラックホール・星雲）に
    持つ。混ぜると、片方の画面の目減りがもう片方に隠れる
  */
  const LABELS = {
    lines: '軌道の線と星屑',
    bodies: '天体',
    art: '天体画',
    nebula: '星雲',
    stars: '星空の星',
  }
  const dimmest = new Map(
    SCREENS.flatMap((screen) =>
      Object.keys(LABELS).map((part) => [
        `${screen.name}:${part}`,
        { median: Number.POSITIVE_INFINITY, pixels: Number.POSITIVE_INFINITY, where: '' },
      ]),
    ),
  )

  // アクセントを一巡りして、字の下の地を読む。止まった姿も途中の姿もこれを通る
  const sweep = async (page, where, screen) => {
    for (const accent of accents) {
      const targets = await page.evaluate(collect, [accent, screen])
      await page.evaluate(settled)
      if (!targets) {
        failures.push(
          `${accent} ${where} — ${screen.name}のパネル（${screen.panel}）が見つからない`,
        )
        continue
      }

      // 地だけを撮る。グリフを背景として数えないための肝
      const strip = (on) =>
        page.evaluate(
          ([hide, ink, on]) => {
            for (const node of hide ? document.querySelectorAll(hide) : []) {
              node.style.visibility = on ? 'hidden' : ''
            }
            for (const node of ink ? document.querySelectorAll(ink) : []) {
              node.style.color = on ? 'transparent' : ''
            }
          },
          [screen.hide, screen.ink, on],
        )
      await strip(true)
      const shot = (await page.screenshot({ type: 'png' })).toString('base64')
      await strip(false)

      const found = await decoder.evaluate(worstIn, [`data:image/png;base64,${shot}`, targets])
      checked += 1

      for (const one of found) {
        if (one.total === 0) {
          failures.push(`${accent} ${where} — ${one.name}の行ボックスが0件`)
          continue
        }
        if (one.worst < tightest.ratio) {
          tightest = { ratio: one.worst, where: `${accent} ${where} の${one.name}` }
        }
        if (one.below > 0) {
          const share = ((one.below / one.total) * 100).toFixed(1)
          failures.push(
            `${accent} ${where} — ${one.name}が最小 ${one.worst.toFixed(2)}:1（要 ${one.need}:1）。面積の ${share}% が足りない`,
          )
        }
      }
    }
  }

  // 画面ごとの姿の数。止まった姿1つ + 動く画面なら途中の姿
  const poses = (screen) => 1 + (screen.motion ? MOTION_FRAMES.length : 0)
  const grid = VIEWPORTS.length * accents.length
  console.log(
    `表紙のまわりで文字が読めるか — ${VIEWPORTS.length}ビューポート × ${accents.length}アクセント × (${SCREENS.map((screen) => `${screen.name} ${poses(screen)}姿`).join(' + ')}) = ${grid * SCREENS.reduce((sum, screen) => sum + poses(screen), 0)}通り（止まった姿 + 動きの途中 ${MOTION_FRAMES.length}コマ）`,
  )

  try {
    for (const viewport of VIEWPORTS) {
      for (const screen of SCREENS) {
        const page = await browser.newPage({
          ...pageOptions(viewport),
          reducedMotion: 'reduce',
        })
        const size = `${viewport.width}x${viewport.height}${viewport.touch ? ' 指' : ''}`
        const where = `${screen.name} ${size}`
        const response = await page.goto(base + screen.path, { waitUntil: 'load' })
        if ((response?.status() ?? 0) !== 200) {
          failures.push(`${where} ${screen.path} — ${response?.status()} が返った`)
          await page.close()
          continue
        }
        await page.evaluate(settled)

        /*
        軌道図が**出ていること**を見る。

        この検査は「文字が読めるか」しか見ていない。だから軌道図が薄くなる・消えるのは
        改善として素通りする——前の月では実際にそれで1回抜けた（色を CSS に移した日に
        画面の明るさの中央値が 85 から 73.5 まで落ちたのに、ゲートは全部緑のままだった）。

        上限（文字が読めること）だけでなく、下限も要る。測り方は差分——軌道図だけを
        消した絵と比べ、軌道図が描いている画素とその明るさを見る。

        **これが捕まえるのは「消えた・ほぼ消えた」までで、1割の目減りではない。**
        SVG が出ていない・線の色が地と同じ・--orbit-ink を下げすぎた、を止める
        ための下限で、見栄えの調整をここで縛るつもりは無い。
      */
        const png = (buffer) => `data:image/png;base64,${buffer.toString('base64')}`
        const shown = png(await page.screenshot({ type: 'png' }))
        // selector の要素だけを消して撮り、消す前と比べる。札まで消すと、中央値が図の明るさを言わなくなる
        const drawnWithout = async (selector, transparent = '') => {
          const hide = await page.addStyleTag({
            content:
              `${selector} { visibility: hidden !important }` +
              (transparent ? `${transparent} { opacity: 0 !important }` : ''),
          })
          const hidden = png(await page.screenshot({ type: 'png' }))
          await page.evaluate((node) => node.remove(), hide)
          return decoder.evaluate(drawnBy, [shown, hidden])
        }
        const cover = await page.locator('.astra-art').isVisible()
        const legacyParts = {
          lines: {
            label: '軌道の線と星屑',
            /*
              軌道の細い芯と星屑だけを消す。その後ろの光の帯（.orbit-bands）・星雲・ブラックホールは
              消さずに残す——帯は幅が広く淡いので、まとめて消すと画素の大半が帯になり、中央値が
              「軌道が見えるか」を言わなくなる。芯は淡く、星屑は細かい点なので、床は星空の星と
              同じ考え方で低い（ORBIT_TRACE_MIN_DELTA）
            */
            drawn: await drawnWithout(':is(.system, .orbits) :is(.orbit, .stardust)'),
            why: 'SVG が出ていないか、軌道が見えていない',
            minDelta: ORBIT_TRACE_MIN_DELTA,
          },
          bodies: {
            label: '天体',
            // 天体の光（業務の輪も）だけを消す。光の芯は真っ白なので、床は線のころと同じ
            drawn: await drawnWithout(
              ':is(.system, .orbits) :is(.orbit-body__core, .orbit-body__ring)',
            ),
            why: '天体の光が描かれていない',
          },
          art: {
            label: 'ブラックホール',
            // 焼いた光の絵と、その下に敷く影の黒い円をまとめて消す（components.tsx の Hole）
            drawn: await drawnWithout('.hole'),
            why: 'ブラックホールの絵（.hole__art）が読めていないか、影（.hole::before）が無い',
          },
          nebula: {
            label: '星雲',
            drawn: await drawnWithout('.cosmos__nebula'),
            why: '星雲（.cosmos__nebula の背景画像）が描かれていない',
            minDelta: NEBULA_MIN_DELTA,
          },
          stars: {
            label: '星空の星',
            /*
              HTML の点は透明にして合成の層を残す。visibility で消すと、Chromium は星と
              無関係な背景にも 2〜3/255 の丸め差を出し、星の面積と明るさへ混ぜてしまう。
              静止 SVG だけは従来どおり消す。点そのものの画素を比べ、下限は変えない。
            */
            drawn: await drawnWithout('.cosmos__stars--still', '.cosmos__twinkle'),
            why: '星空の星（.cosmos__stars）が描かれていない',
            minDelta: STARS_MIN_DELTA,
          },
        }
        // Measure the foreground ASCII alone. The intentionally faint bitmap
        // glow covers more pixels and would dominate a combined median, masking
        // a missing ASCII picture. Keep that glow in both screenshots.
        const parts = cover
          ? {
              art: {
                label: 'ASCII の天体画',
                drawn: await drawnWithout('.ascii-celestial'),
                why: '表紙のASCII文字が描かれていない',
                minDelta: NEBULA_MIN_DELTA,
              },
              stars: legacyParts.stars,
            }
          : legacyParts
        for (const [part, { label, drawn, why, minDelta = ORBIT_MIN_DELTA }] of Object.entries(
          parts,
        )) {
          const floor = cover && part === 'art' ? 1000 : screen.minPixels[part]
          if (drawn.pixels < floor) {
            failures.push(
              `${where} — ${label}が ${drawn.pixels} 画素しか描いていない（下限 ${floor}）。${why}`,
            )
          } else if (drawn.median < minDelta) {
            failures.push(
              `${where} — ${label}の地からの離れの中央値が ${drawn.median.toFixed(1)}/255（下限 ${minDelta}）。薄すぎて出ていないのと変わらない`,
            )
          }
          const key = `${screen.name}:${part}`
          const dim = dimmest.get(key)
          dimmest.set(key, {
            median: Math.min(dim.median, drawn.median),
            pixels: Math.min(dim.pixels, drawn.pixels),
            where: drawn.pixels < dim.pixels ? size : dim.where,
          })
        }

        await sweep(page, where, screen)
        await page.close()

        // 動かない画面は、途中の姿が無いので、ここで次のページへ
        if (!screen.motion) continue

        /*
        動きの途中の姿も測る。

        上の一巡りは動きを止めて測っている（reducedMotion）。入口も締めも、軌道を星が
        流れ、粒が落ち、ブラックホールの光が揺らぎ、星が瞬く（public/app.css の「動き続ける」）。
        変わる光・粒・星は止まった姿には無いので、字の後ろに掛かる瞬間は上では見えない。

        動きを止めずに開き、名前が orbit- で始まる animation だけを止めて途中の時刻へ
        送る。字の浮かび上がりは先に終わらせる——行ボックスを止まった位置で読むため。
      */
        const moving = await browser.newPage({
          ...pageOptions(viewport),
          reducedMotion: 'no-preference',
        })
        await moving.goto(base + screen.path, { waitUntil: 'load' })
        await moving.evaluate(settled)
        const end = await moving.evaluate(holdOrbits)
        if (Number.isNaN(end) || end <= 0) {
          failures.push(
            `${where} — 有効な周期を持つ animation（名前が orbit- で始まるもの）が見つからない。途中の姿を1つも測れていない。app.css の「動き続ける」と animation の名前・周期を確認すること`,
          )
        }
        const frames = await moving.evaluate(motionFrames, MOTION_FRAMES)
        for (const at of end > 0 ? frames : []) {
          if (!Number.isFinite(at) || !(at > 0 && at < end)) {
            failures.push(
              `${where} — 動きの途中のコマ ${at}ms が動きの長さ（${Math.round(end)}ms）の外。:root の --breathe-dur と流れ星の --dur / --delay を読めているか`,
            )
            continue
          }
          await moving.evaluate(seekOrbits, at)
          await sweep(moving, `${where} 動きの途中 ${at}ms`, screen)
        }
        await moving.close()
      }
    }
  } finally {
    await browser.close()
    await stop()
    await state?.cleanup()
  }

  if (failures.length > 0) {
    console.error(`\n✗ ${failures.length} 件（${checked} 通り中）`)
    for (const line of failures) console.error(`  ${line}`)
    console.error(
      '\n軌道を薄くするより先に、置き場所を疑う。字の後ろの暗がりは app.css の「字の暗がり」、線の濃さは --orbit-ink、継続する光は --hole-light / --breathe-low、粒と星の動きは「動き続ける」。',
    )
    process.exitCode = 1
    return
  }

  console.log(
    `✓ ${checked} 通り。基準を割った行 0（いちばん惜しいのは ${tightest.where} で ${tightest.ratio.toFixed(2)}:1）`,
  )
  for (const [key, dim] of dimmest) {
    if (!Number.isFinite(dim.pixels)) continue
    const [name, part] = key.split(':')
    const label = LABELS[part]
    console.log(
      `  ${name}の${label}はいちばん少ない ${dim.where} でも ${dim.pixels} 画素・地からの離れ（中央値の最小）${dim.median.toFixed(1)}/255`,
    )
  }
}

await main()
