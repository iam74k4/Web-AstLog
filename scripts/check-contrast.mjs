/*
  入口の月の上で、文字が読めるか（WCAG 1.4.3）を実際にブラウザで測る。

  月は入口の画面の h1 とリード文の後ろを通る。粒子はいちばん明るい所が白
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

  画素は、撮った PNG をページへ戻して canvas から読む。Node 側に画像を
  展開する道具を増やさずに済む。

    npm run check:contrast
*/

import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import process from 'node:process'
import { setTimeout as sleep } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

/*
  設計サイズ3つ（check-fit.mjs と同じ電話・板・机）に 1024x768 を足す。

  1024x768 は「幅は広いのに背が低い」窓で、パネルがいちばん短くなる
  （center で 810x366）。月と文字の間隔がいちばん詰まるのがここなので、
  収まりの検査には入れていなくても、重なりの検査には要る。
*/
const VIEWPORTS = [
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
  { width: 1440, height: 900 },
]

// 月が出るのは入口の画面だけ（/all にも個人ページにも出さない）
const PATH = '/'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

const keysOf = (name) => {
  const source = readFileSync(`${ROOT}src/theme.ts`, 'utf8')
  const block = source.match(new RegExp(`export const ${name} = \\[([\\s\\S]*?)\\] as const`))?.[1]
  if (!block) throw new Error(`src/theme.ts の ${name} を読めなかった（宣言の形が変わった？）`)
  const keys = [...block.matchAll(/key: '([^']+)'/g)].map((found) => found[1])
  if (keys.length === 0) throw new Error(`src/theme.ts の ${name} が空に見える`)
  return keys
}

async function waitForServer(base, limitMs = 120_000) {
  const until = Date.now() + limitMs
  while (Date.now() < until) {
    try {
      const response = await fetch(base, { redirect: 'manual' })
      if (response.status < 500) return
    } catch {
      // まだ立っていない
    }
    await sleep(500)
  }
  throw new Error(`${base} が ${limitMs / 1000} 秒たっても応えない`)
}

// check-fit.mjs と同じ理由で npx を挟まない（SIGTERM が本体に届かない）
function startServer(port) {
  const server = spawn(`${ROOT}node_modules/.bin/wrangler`, ['dev', '--port', String(port)], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const log = []
  const keep = (chunk) => log.push(String(chunk))
  server.stdout.on('data', keep)
  server.stderr.on('data', keep)
  return {
    stop: () => {
      server.stdout.off('data', keep)
      server.stderr.off('data', keep)
      server.kill('SIGTERM')
    },
    spill: () => console.error(log.join('')),
  }
}

/*
  骨格とアクセントを差し替えて、文字の行ボックスと色を集める。
  check-fit.mjs と同じで、保存の経路（D1 とログイン）は通さない——
  測りたいのは版面であって、設定の保存経路ではない。
*/
const collect = ([layout, accent]) => {
  document.body.dataset.layout = layout
  document.body.dataset.accent = accent

  const hero = document.querySelector('main > .hero')
  if (!hero) return null

  const lines = (element) => {
    const found = []
    for (const node of element.childNodes) {
      if (node.nodeType !== Node.TEXT_NODE) continue
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

  return [read(hero.querySelector('h1'), '見出し'), read(hero.querySelector('p'), 'リード文')]
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
  const port = Number(process.env.CONTRAST_PORT ?? 8789)
  const given = process.env.CONTRAST_BASE
  const base = given ?? `http://localhost:${port}`
  const dev = given ? null : startServer(port)

  if (dev) {
    try {
      await waitForServer(base)
    } catch (error) {
      dev.spill()
      dev.stop()
      throw error
    }
  }

  const layouts = keysOf('LAYOUTS')
  const accents = keysOf('ACCENTS')
  const browser = await chromium.launch()
  const failures = []
  let checked = 0
  let tightest = { ratio: Number.POSITIVE_INFINITY, where: '' }

  console.log(
    `月の上で文字が読めるか — ${VIEWPORTS.length}ビューポート × ${layouts.length}骨格 × ${accents.length}アクセント = ${VIEWPORTS.length * layouts.length * accents.length}通り`,
  )

  try {
    for (const viewport of VIEWPORTS) {
      const page = await browser.newPage({ viewport })
      const where = `${viewport.width}x${viewport.height}`
      const response = await page.goto(base + PATH, { waitUntil: 'load' })
      if ((response?.status() ?? 0) !== 200) {
        failures.push(`${where} ${PATH} — ${response?.status()} が返った`)
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
      const ratio = await page.evaluate(async () => {
        const mark = document.querySelector('.moon__mark')
        if (!mark) return null
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
      })
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

      for (const layout of layouts) {
        for (const accent of accents) {
          const targets = await page.evaluate(collect, [layout, accent])
          if (!targets) {
            failures.push(`${layout} ${accent} ${where} — 入口のパネルが見つからない`)
            continue
          }

          // 地だけを撮る。グリフを背景として数えないための肝
          await page.evaluate(() => {
            for (const node of document.querySelectorAll('main > .hero > :is(h1, p)')) {
              node.style.visibility = 'hidden'
            }
          })
          const shot = (await page.screenshot({ type: 'png' })).toString('base64')
          await page.evaluate(() => {
            for (const node of document.querySelectorAll('main > .hero > :is(h1, p)')) {
              node.style.visibility = ''
            }
          })

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
      await page.close()
    }
  } finally {
    await browser.close()
    dev?.stop()
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
}

await main()
