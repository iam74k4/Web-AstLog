/*
  月の上で、文字が読めるか（WCAG 1.4.3）を実際にブラウザで測る。

  月が出るのはサイトの並びの最初と最後——入口と、締めの Contact（入口の
  三日月を左右に返して小さく置く。ページに出る字は誘いの1文とボタン2つ）。
  どちらも字の後ろに光暈が回る。
  測る画面と字の一覧は下の SCREENS。

  月は入口の画面の h1 とリード文の後ろを通る。月の点はいちばん明るい所が白
  （255）で、見出しも #f2f2f4 なので、置き方を間違えると白の上の白になる。
  実際にそうなっていた——リード文が明るい縁に載って **1.00:1**、つまり
  その字は背景と同じ明るさで、完全に消えていた。

  これは vitest では捕まらない。あちらは workerd の中で動くので版面を持たず、
  CSS の文字列は読めても「実際に何色の上に何色が乗るか」は分からない。
  check-fit.mjs と同じ理由でブラウザが要る。

  測り方に1つ落とし穴がある。**合成後の画面をそのまま読んではいけない。**
  文字のグリフそのものが写っているので、それを「背景」として数えると
  どの組も 1.00:1 になり（文字の色 vs 文字の色）、検査は意味を失う。
  だから h1 とリード文を visibility: hidden にした「地だけ」を撮り、
  文字が実際に乗る行ボックス（Range.getClientRects）の下を読む。

  名前の上の肩書き（小さい字なので 4.5:1 が要る）も同じく測る。
  帯（一覧への丸い札）も同じ Hero の中にあって光暈の上に乗るので、その字
  （題・件数）も測る。帯の下の「すべてを1ページで読む →」（全体
  ページへの控えめな1本）も同じ。帯は半透明の面を持つので、隠すのは字だけで
  面は残す——面ごと隠すと、実際より暗い地で測ることになる。締めの画面の
  メールと GitHub のピルも同じで、字の色だけを抜いて面を残す。締めの
  誘いの1文（リード）は面を持たないので、入口のリード文と同じく丸ごと隠す。

  動きは止めて測る（reducedMotion）。入口の見出しは浮かび上がって出てくるので、
  止めないと、動いている途中の姿を測ることがある。そのうえで月の出（月が
  降りてきて焦点が合い、光暈が広がる）だけは、途中の姿を最後に別に測る——
  止めて測るだけでは、途中で止まった姿より明るくなる瞬間が見えない。

  画素は、撮った PNG をページへ戻して canvas から読む。Node 側に画像を
  展開する道具を増やさずに済む。

    npm run check:contrast
*/

import process from 'node:process'
import { chromium } from 'playwright'
import { devServer } from './lib/dev-server.mjs'
import { keysOf } from './lib/theme.mjs'
import { DESIGN_SIZES, SHORT_WIDE } from './lib/viewports.mjs'

/*
  設計サイズ3つ（scripts/lib/viewports.mjs。check:fit と同じ電話・板・机）に、
  背の低い窓（SHORT_WIDE）を足して幅の順に並べる。電話と板は指で測る（touch。
  check:fit と同じ）。指では押す手が --tap の 44px になり、柱の帯と入口の
  「すべてを1ページで読む →」（.hero__whole）が伸びる。入口の字は画面の下に
  寄せてある（app.css の main > .hero:has(> .moon)）ので、下の1本が伸びたぶん
  見出し・リード文・帯が月のほうへ上がる——細いポインタの姿だけを測っていたころは、
  実物の電話の位置を一度も測っていなかった。
*/
const VIEWPORTS = [...DESIGN_SIZES, SHORT_WIDE]
  .map(({ width, height, touch }) => ({ width, height, touch: Boolean(touch) }))
  .sort((a, b) => a.width - b.width)

// newPage に渡す形（touch は hasTouch へ）
const pageOptions = ({ width, height, touch }) => ({
  viewport: { width, height },
  hasTouch: touch,
})

/*
  月が出るページ。サイトの並びの最初（入口）と最後（Contact）の2つだけ——
  /all にも個人ページにも出さない。

  panel はその画面の節。targets は測る字（selector は panel の中で探す）で、
  required の無いものは出ていないサイトでは測らない（肩書きは1人のサイトだけ、
  帯は件数のあるサイトだけ）。

  hide と ink は「地だけ」を撮るときに字を消すやり方。hide は丸ごと隠す
  （visibility）、ink は字の色だけを抜いて面を残す（color: transparent）。
  ピルのように塗りや半透明の面を持つものは、面ごと隠すと実際より暗い地で
  測ることになるので ink で抜く（ピルは字が a の直下にあり、子だけを隠す
  やり方が取れない）。

  minPixels は三日月が「出ている」と言える画素数の下限。締めの月は入口より
  小さい（--moon-closing-h）ので、面積の比（0.34 / 0.45 の2乗 ≒ 0.57）だけ下げる。
  motion は月の出（途中の姿）を測るか。締めの月は動かさない。
*/
const SCREENS = [
  {
    name: '入口',
    path: '/',
    panel: 'main > .hero',
    targets: [
      { selector: ':scope > h1', name: '見出し', required: true },
      { selector: ':scope > p.hero__role', name: '肩書き' },
      { selector: ':scope > p:not(.hero__role)', name: 'リード文', required: true },
      { selector: '.band .band__body strong', name: '帯の題' },
      { selector: '.band .band__meta', name: '帯の件数' },
      // 入口のページには必ず出る（帯の有無に依らない）。出ていなければ落とす
      { selector: ':scope > .hero__whole', name: '全体ページへの1本', required: true },
    ],
    // 帯は字の子だけを隠せば面が残る（面ごと隠すと実際より暗い地で測る）
    hide: 'main > .hero > :is(h1, p, .hero__whole), main > .hero > .band .band__body > *',
    ink: null,
    minPixels: 8000,
    motion: true,
  },
  {
    name: '締め',
    path: '/contact',
    panel: 'main > .moonlit',
    // 画面に出る字は誘いの1文とボタン2つ（見出しは読み上げ用の .sr-only で、描かれない）
    targets: [
      { selector: '.contact__lead', name: 'リード文', required: true },
      { selector: '.contact__actions .socials a', name: 'GitHub のピル', required: true },
      { selector: '.contact__actions .pill-cta', name: 'メールのピル', required: true },
    ],
    // リードは面を持たないので丸ごと隠す。ピルは面を残して字の色だけ抜く（ink）
    hide: 'main > .moonlit .contact__lead',
    ink: 'main > .moonlit .contact__actions a',
    minPixels: 4500,
    motion: false,
  },
]

/*
  三日月の明るさの下限（中央値）。画素数の下限は画面ごと（SCREENS の minPixels）。

  実測（DPR1・iris）では入口の 4寸法で 2.0万〜3.4万画素、明るさの中央値 80〜85
  だったころに決めた。下限はそこから大きく引いてある——見栄えを縛るのではなく、
  「描かれていない」を止めるための数だから。
*/
const MOON_MIN_LUMA = 45

/*
  月の出（public/app.css の moon-settle / moon-bloom）のどこで止めて測るか。
  月が止まるまでの時間に対する割合。

  ばねのように行き過ぎる曲線なら、いちばん明るい・いちばん下に来るのは
  動きの半ばより少し前（ばねの山は 46% 前後）。光暈は遅れて出るので、
  全体の時間で見るとその山は 4〜6 割に散る。3コマはそこを挟むように置く。
*/
const MOTION_FRAMES = [0.2, 0.4, 0.6]

// 月の animation を頭から止め、ほかの動き（字の浮かび上がり）は終わらせる。月が止まる時刻を返す
const holdMoon = () => {
  /*
    まず掛け直す。読み込みが遅いと、ここへ来る前に月の出が終わっていて、
    終わった animation は getAnimations() に出てこない（CI の遅い日にだけ
    「見つからない」で落ちる）。いったん外して戻せば頭から始まる。
    getAnimations() はスタイルを確定させるので、外した姿と戻した姿を1回ずつ通る
  */
  const off = document.createElement('style')
  off.textContent = '.moon, .moon *, .moon *::before, .moon *::after { animation: none !important }'
  document.head.append(off)
  document.getAnimations()
  off.remove()

  let end = 0
  for (const animation of document.getAnimations()) {
    if (animation.animationName?.startsWith('moon-')) {
      animation.pause()
      end = Math.max(end, animation.effect.getComputedTiming().endTime)
    } else {
      animation.finish()
    }
  }
  return end
}

const seekMoon = (at) => {
  for (const animation of document.getAnimations()) {
    if (animation.animationName?.startsWith('moon-')) animation.currentTime = at
  }
}

/*
  骨格とアクセントを差し替えて、文字の行ボックスと色を集める。
  check-fit.mjs と同じで、保存の経路（D1 とログイン）は通さない——
  測りたいのは版面であって、設定の保存経路ではない。
*/
const collect = ([layout, accent, screen]) => {
  document.body.dataset.layout = layout
  document.body.dataset.accent = accent

  const panel = document.querySelector(screen.panel)
  if (!panel) return null

  /*
    子孫の文字ノードを全部たどる。見出しとリード文は句読点で切った塊
    （<span class="phrase">）に入っているので、直下の子だけを見ると1行も
    拾えない
  */
  const lines = (element) => {
    const found = []
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const range = document.createRange()
      range.selectNodeContents(node)
      for (const box of range.getClientRects()) {
        found.push([
          Math.round(box.left),
          Math.round(box.top),
          Math.round(box.right),
          Math.round(box.bottom),
        ])
      }
    }
    return found
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
    const found = [...panel.querySelectorAll(target.selector)]
    if (found.length === 0) {
      return target.required
        ? [{ name: target.name, color: 'rgb(0, 0, 0)', need: 0, lines: [] }]
        : []
    }
    return found.map((node) => read(node, target.name))
  })
}

// 三日月を消した絵と比べ、三日月が描いた画素とその明るさを返す
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
      if (moved >= 2) lit.push(0.2126 * a[at] + 0.7152 * a[at + 1] + 0.0722 * a[at + 2])
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
  // CONTRAST_BASE を渡したときだけ、そこに向けて測る（手元の dev を使いたいとき）
  const { base, stop } = await devServer(
    process.env.CONTRAST_BASE,
    Number(process.env.CONTRAST_PORT ?? 8789),
  )

  const layouts = keysOf('LAYOUTS')
  const accents = keysOf('ACCENTS')
  const browser = await chromium.launch()
  const failures = []
  let checked = 0
  let tightest = { ratio: Number.POSITIVE_INFINITY, where: '' }
  // いちばん薄かった月は画面ごとに持つ。締めの月は入口より小さいので、混ぜると入口の目減りが隠れる
  const dimmest = new Map(
    SCREENS.map((screen) => [
      screen.name,
      { median: Number.POSITIVE_INFINITY, pixels: 0, where: '' },
    ]),
  )

  // 骨格 × アクセントを一巡りして、字の下の地を読む。止まった姿も途中の姿もこれを通る
  const sweep = async (page, where, screen) => {
    for (const layout of layouts) {
      for (const accent of accents) {
        const targets = await page.evaluate(collect, [layout, accent, screen])
        if (!targets) {
          failures.push(
            `${layout} ${accent} ${where} — ${screen.name}のパネル（${screen.panel}）が見つからない`,
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

        const found = await page.evaluate(worstIn, [`data:image/png;base64,${shot}`, targets])
        checked += 1

        for (const one of found) {
          if (one.total === 0) {
            failures.push(`${layout} ${accent} ${where} — ${one.name}の行ボックスが0件`)
            continue
          }
          if (one.worst < tightest.ratio) {
            tightest = { ratio: one.worst, where: `${layout} ${accent} ${where} の${one.name}` }
          }
          if (one.below > 0) {
            const share = ((one.below / one.total) * 100).toFixed(1)
            failures.push(
              `${layout} ${accent} ${where} — ${one.name}が最小 ${one.worst.toFixed(2)}:1（要 ${one.need}:1）。面積の ${share}% が足りない`,
            )
          }
        }
      }
    }
  }

  // 画面ごとの姿の数。止まった姿1つ + 月を動かす画面なら月の出の途中の姿
  const poses = (screen) => 1 + (screen.motion ? MOTION_FRAMES.length : 0)
  const grid = VIEWPORTS.length * layouts.length * accents.length
  console.log(
    `月の上で文字が読めるか — ${VIEWPORTS.length}ビューポート × ${layouts.length}骨格 × ${accents.length}アクセント × (${SCREENS.map((screen) => `${screen.name} ${poses(screen)}姿`).join(' + ')}) = ${grid * SCREENS.reduce((sum, screen) => sum + poses(screen), 0)}通り（入口は止まった姿 + 月の出の途中 ${MOTION_FRAMES.length}コマ）`,
  )

  try {
    for (const viewport of VIEWPORTS) {
      for (const screen of SCREENS) {
        const page = await browser.newPage({ ...pageOptions(viewport), reducedMotion: 'reduce' })
        const size = `${viewport.width}x${viewport.height}${viewport.touch ? ' 指' : ''}`
        const where = `${screen.name} ${size}`
        const response = await page.goto(base + screen.path, { waitUntil: 'load' })
        if ((response?.status() ?? 0) !== 200) {
          failures.push(`${where} ${screen.path} — ${response?.status()} が返った`)
          await page.close()
          continue
        }
        await page.evaluate(() => document.fonts.ready.then(() => true))

        /*
        測り始める前に、素材と CSS が食い違っていないかを見る。

        三日月は CSS の mask で描いていて、箱の形は --moon-ratio が決める。
        素材を焼き直して縦横比が変わったのに --moon-ratio を直し忘れると、
        絵は箱の中で潰れ、光暈だけが元の形のまま残る。しかもその潰れは
        「文字の下に来る明るさ」を変えるので、**この検査が測っている前提
        そのものが崩れる**。だから測る前に確かめる。

        vitest ではできない——あちらは workerd の中で動いていて public/ が
        配られない（実測で 404）。素材の実寸を読めるのはブラウザだけ。
      */
        const ratio = await page.evaluate(async (panel) => {
          const mark = document.querySelector(`${panel} .moon__mark`)
          if (!mark) return { error: '三日月（.moon__mark）が無い' }
          const url = getComputedStyle(mark, '::after').maskImage.match(/url\(["']?([^"')]+)/)?.[1]
          if (!url) return { error: 'mask の url を読めない' }
          const image = new Image()
          image.src = url
          try {
            await image.decode()
          } catch {
            return { error: `素材を読めない: ${url}` }
          }
          const box = mark.getBoundingClientRect()
          return {
            url,
            asset: image.naturalWidth / image.naturalHeight,
            box: box.width / box.height,
          }
        }, screen.panel)
        if (ratio?.error) {
          failures.push(`${where} — ${ratio.error}`)
        } else if (ratio) {
          // 1% まで許す。--moon-ratio は整数の比なので端数が出る
          const drift = Math.abs(ratio.asset - ratio.box) / ratio.asset
          if (drift > 0.01) {
            failures.push(
              `${where} — 素材の縦横比 ${ratio.asset.toFixed(3)} と箱の ${ratio.box.toFixed(3)} が ${(drift * 100).toFixed(1)}% ずれている（public/app.css の --moon-ratio を素材に合わせること）`,
            )
          }
        }

        /*
        月が**出ていること**を見る。

        この検査は「文字が読めるか」しか見ていない。だから月が暗くなるのは
        改善として素通りする——実際それで1回抜けた。色を CSS に持たせた日に
        濃淡をアルファへ移し、画面での中央値が 85 から 73.5 まで落ちたのに、
        ゲートは全部緑のままだった（「月が消えた」と言われて初めて気づいた）。

        上限（文字が読めること）だけでなく、下限も要る。測り方は差分——
        三日月だけを消した絵と比べ、三日月が描いている画素とその明るさを見る。

        **これが捕まえるのは「消えた・ほぼ消えた」までで、1割の目減りではない。**
        素材が 404 になった・mask が壊れた・--moon-ink を下げすぎた、を止める
        ための下限で、見栄えの調整をここで縛るつもりは無い。
      */
        const moon = await (async () => {
          const shown = await page.screenshot({ type: 'png' })
          const hide = await page.addStyleTag({
            content: '.moon__mark::after{display:none !important}',
          })
          const hidden = await page.screenshot({ type: 'png' })
          await page.evaluate((node) => node.remove(), hide)
          return page.evaluate(drawnBy, [
            `data:image/png;base64,${shown.toString('base64')}`,
            `data:image/png;base64,${hidden.toString('base64')}`,
          ])
        })()
        if (moon.pixels < screen.minPixels) {
          failures.push(
            `${where} — 三日月が ${moon.pixels} 画素しか描いていない（下限 ${screen.minPixels}）。素材が届いていないか、mask が効いていない`,
          )
        } else if (moon.median < MOON_MIN_LUMA) {
          failures.push(
            `${where} — 三日月の明るさの中央値が ${moon.median.toFixed(1)}/255（下限 ${MOON_MIN_LUMA}）。薄すぎて出ていないのと変わらない`,
          )
        }
        if (moon.median < dimmest.get(screen.name).median) {
          dimmest.set(screen.name, { ...moon, where: size })
        }

        await sweep(page, where, screen)
        await page.close()

        // 締めの月は動かさない。途中の姿が無いので、ここで次のページへ
        if (!screen.motion) continue

        /*
        月の出の途中の姿も測る。

        上の一巡りは動きを止めて測っている（reducedMotion）。入口の月は着いた
        ときに一度だけ降りてきて焦点が合い、光暈が広がる（public/app.css の
        --dur-slow）。その途中に止まった姿より明るい瞬間があっても、上では
        見えないまま字の下を通り過ぎる——ばねで行き過ぎさせる・下からずらす・
        光暈を大きい所から縮める、のどれでもそうなる。app.css の keyframes は
        「暗い・小さい・上」からしか出ないように書いてあり、test/theme.test.ts が
        その書き方を見張っているが、実際に描いて確かめられるのはここだけ。

        動きを止めずに開き、月の animation だけを止めて途中の時刻へ送る。
        字の浮かび上がりは先に終わらせる——行ボックスを止まった位置で読むため。
      */
        const moving = await browser.newPage(pageOptions(viewport))
        await moving.goto(base + screen.path, { waitUntil: 'load' })
        await moving.evaluate(() => document.fonts.ready.then(() => true))
        const end = await moving.evaluate(holdMoon)
        if (end === 0) {
          failures.push(
            `${where} — 月の出の animation（名前が moon- で始まるもの）が見つからない。途中の姿を1つも測れていない（月を動かすのをやめたなら、この段ごと外すこと）`,
          )
        }
        for (const share of end > 0 ? MOTION_FRAMES : []) {
          const at = Math.round(end * share)
          await moving.evaluate(seekMoon, at)
          await sweep(moving, `${where} 月の出 ${at}ms`, screen)
        }
        await moving.close()
      }
    }
  } finally {
    await browser.close()
    stop()
  }

  if (failures.length > 0) {
    console.error(`\n✗ ${failures.length} 件（${checked} 通り中）`)
    for (const line of failures) console.error(`  ${line}`)
    console.error(
      '\n月を薄くするより先に、置き場所を疑う。三日月は public/app.css の --moon-top / --moon-h、光暈は --moon-glow-inset / --moon-glow-ink。',
    )
    process.exitCode = 1
    return
  }

  console.log(
    `✓ ${checked} 通り。基準を割った行 0（いちばん惜しいのは ${tightest.where} で ${tightest.ratio.toFixed(2)}:1）`,
  )
  for (const [name, dim] of dimmest) {
    console.log(
      `  ${name}の月はいちばん薄い ${dim.where} でも ${dim.pixels} 画素・明るさ ${dim.median.toFixed(1)}/255`,
    )
  }
}

await main()
