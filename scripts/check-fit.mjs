/*
  「公開ページはスクロールしない」を、実際にブラウザで測る。

  この不変条件はこの機能の名前そのものなのに、確かめる手段がリポジトリに
  1つも無かった。typecheck も lint も vitest も寸法を測らない——vitest は
  workerd の上で動くので、そもそも版面を組むエンジンが居ない。残っていたのは
  「9通りを手で開く」という手順だけで、1回目は実行されるが2回目は
  「今回は件数を1つ増やしただけだから」で飛ばされる。

  だから測るほうを1つのコマンドにする。`npm run check:fit`。

  測るのは2つ。
    (1) ページそのものが動くか        document.scrollingElement の scrollHeight - clientHeight
    (2) 節の弁（overflow: auto）が開くか  節ごとの scrollHeight - clientHeight
  どちらも設計サイズでは 0 でなければならない。弁が開くのは public/app.css が
  名前を付けている3つの条件——拡大 200% 以上・画面高 400px 未満・書体差——の
  ときだけで、設計サイズで開いたなら弁の出番ではなく perScreen の不具合。

  (1) は documentElement ではなく document.scrollingElement で測る。
  このサイトの HTML には `<!DOCTYPE html>` が無く、ブラウザは互換モードで
  組んでいる。互換モードでは scrollingElement が body になり、
  documentElement.clientHeight は画面の高さではなく中身の高さを返す——つまり
  documentElement で測ると、差はどのページでも必ず 0 になり、検査は永久に緑の
  まま何も見ない（縦に 3275px ある /all でさえ 0 と出る。実測で確認した）。
  scrollingElement なら、どちらのモードでも「動く箱」を指す。

  1px までは許す。連動する文字の段は clamp() で決まるので、幅しだいで端数が出る。

  `npm test` とは分けてある。あちらは workerd の中で D1 と KV ごと動かす場所で、
  こちらは本物の版面が要る。混ぜると、片方のために片方の実行環境を曲げることになる。
*/

import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import process from 'node:process'
import { setTimeout as sleep } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

/*
  設計サイズ。CLAUDE.md と public/app.css の「9通り」は、この3つ × 骨格3つのこと。
  電話・板・机。WCAG 1.4.10 の 320x256 はここに入れない——あの寸法にはカードが
  1枚も入らず、収めにいくと設計サイズの件数まで削ることになる。あちらは弁を開けて
  受け、そのかわりキーボードで操作できるようにしてある（節の tabindex）。
*/
const VIEWPORTS = [
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1440, height: 900 },
]

/*
  弁の付け先。public/app.css の
  `:where(body[data-layout]:not([data-whole])) main > :is(.hero, section)`
  と同じ相手を、同じ書き方で選ぶ。クラスを列挙すると、これから足す節が漏れる。
*/
const PANELS = 'main > :is(.hero, section)'

// 端数の許し。連動する段は clamp() で決まるので、幅しだいで 0.x px が出る
const SLACK = 1

const ROOT = fileURLToPath(new URL('..', import.meta.url))

/*
  骨格の一覧は src/theme.ts が正。ここに 'rail' と書き写すと、4つ目の
  プリセットを足した日に、その骨格だけ誰も測らないまま出ていくことになる。
  .ts をそのまま読み込めないので、宣言の文字列から key だけを拾う。
*/
function layoutKeys() {
  const source = readFileSync(`${ROOT}src/theme.ts`, 'utf8')
  const block = source.match(/export const LAYOUTS = \[([\s\S]*?)\] as const/)?.[1]
  if (!block) throw new Error('src/theme.ts の LAYOUTS を読めなかった（宣言の形が変わった？）')

  const keys = [...block.matchAll(/key: '([^']+)'/g)].map((found) => found[1])
  if (keys.length === 0) throw new Error('src/theme.ts の LAYOUTS が空に見える')
  return keys
}

/*
  測る URL は sitemap.xml から引く。

  手で並べた表を持つと、画面を1つ足した日にこちらだけ古くなる——しかも
  古くなったことは緑のまま分からない。sitemap は公開ページと同じ式
  （siteSteps / memberScreens / itemHref）から数え上げているので、
  新しい連なりを足せばこの検査の対象も自動で増える。
*/
async function screenPaths(base) {
  const response = await fetch(`${base}/sitemap.xml`)
  if (!response.ok) throw new Error(`/sitemap.xml が ${response.status} を返した`)

  const xml = await response.text()
  const all = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((found) => new URL(found[1]).pathname)
  if (all.length === 0) throw new Error('sitemap.xml に URL が1つも無い')

  // 縦に伸びてよいのは全体ページだけ（body[data-whole]）。ここだけは測らない
  const paths = all.filter((path) => path !== '/all')
  if (paths.length === all.length) {
    console.warn('注意: sitemap に /all が無い。全体ページの除外が空振りしている')
  }
  return paths
}

// dev サーバが返事をするまで待つ。起動は初回だけ数秒かかる
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

/*
  サーバは自分で立てる。FIT_BASE を渡したときだけ、そこに向けて測る
  （手元で `npm run dev` を動かしたまま測りたいとき）。

  npx を挟まず node_modules/.bin/wrangler を直に起動する。npx を挟むと
  SIGTERM が届くのは npx のほうで、本体の wrangler がポートを掴んだまま
  残ることがある（次の実行がそのポートで立てられなくなる）。

  サーバの出力はためておいて、うまくいったときは捨てる。成功した run の
  最後に 160 行のアクセスログが出ると、肝心の1行が読めなくなる。
*/
function startServer(port) {
  const server = spawn(`${ROOT}node_modules/.bin/wrangler`, ['dev', '--port', String(port)], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const log = []
  const keep = (chunk) => log.push(String(chunk))
  server.stdout.on('data', keep)
  server.stderr.on('data', keep)

  const stop = () => {
    server.stdout.off('data', keep)
    server.stderr.off('data', keep)
    server.kill('SIGTERM')
  }
  const spill = () => console.error(log.join(''))
  return { server, stop, spill }
}

/*
  骨格は body の data-layout を差し替えて見る。

  マークアップはどのプリセットでも同じで、変わるのは app.css の [data-layout]
  側だけ（src/ui/Layout.tsx がそう書いてあり、theme.layout を読むのもあの3行
  しか無い）。だから属性を差し替えれば、管理画面で保存したのと同じ姿になる。
  保存の経路を使うと owner のアカウントと D1 への書き込みが要り、CI では
  seed に居ない人でログインすることになる——測りたいのは版面であって、
  設定の保存経路ではない。
*/
const measure = ([layout, panels, slack]) => {
  document.body.dataset.layout = layout

  // 互換モード（このサイトには DOCTYPE が無い）では body、標準モードでは html
  const scroller = document.scrollingElement ?? document.documentElement
  const boxes = [...document.querySelectorAll(panels)]
  return {
    page: Math.max(0, scroller.scrollHeight - scroller.clientHeight),
    open: boxes
      .map((box) => ({
        name: box.id || box.className || box.tagName.toLowerCase(),
        over: Math.max(0, box.scrollHeight - box.clientHeight),
      }))
      .filter((box) => box.over > slack),
    panels: boxes.length,
  }
}

async function main() {
  const port = Number(process.env.FIT_PORT ?? 8788)
  const given = process.env.FIT_BASE
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

  const browser = await chromium.launch()
  const failures = []
  let checked = 0
  let worstPage = 0
  let worstValve = 0

  try {
    const layouts = layoutKeys()
    const paths = await screenPaths(base)
    console.log(
      `画面に収まっているか — ${layouts.length}骨格 × ${VIEWPORTS.length}ビューポート × ${paths.length}URL = ${layouts.length * VIEWPORTS.length * paths.length}通り`,
    )

    for (const viewport of VIEWPORTS) {
      const page = await browser.newPage({
        viewport: { width: viewport.width, height: viewport.height },
      })
      const where = `${viewport.width}x${viewport.height}`

      for (const path of paths) {
        const response = await page.goto(base + path, { waitUntil: 'load' })
        const status = response?.status() ?? 0
        if (status !== 200) {
          failures.push(`${where} ${path} — ${status} が返った（sitemap に載っているのに）`)
          continue
        }
        // 書体が決まる前に測ると、行の高さが見積もりとずれる
        await page.evaluate(() => document.fonts.ready.then(() => true))

        for (const layout of layouts) {
          const found = await page.evaluate(measure, [layout, PANELS, SLACK])
          checked += 1
          worstPage = Math.max(worstPage, found.page)
          worstValve = Math.max(worstValve, ...found.open.map((box) => box.over), 0)

          if (found.panels === 0) {
            failures.push(`${layout} ${where} ${path} — 節が1つも無い（${PANELS} に当たらない）`)
          }
          if (found.page > SLACK) {
            failures.push(`${layout} ${where} ${path} — ページが ${found.page}px 動く`)
          }
          for (const box of found.open) {
            failures.push(`${layout} ${where} ${path} — 節「${box.name}」の弁が ${box.over}px 開く`)
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
      '\n設計サイズで弁が開いたら、それは弁の不具合ではなく src/blocks.ts の perScreen の不具合。まず件数を疑う。',
    )
    process.exitCode = 1
    return
  }

  console.log(
    `✓ ${checked} 通り。ページが動いた画面 0、弁が開いた節 0（いちばん惜しいところでページ ${worstPage}px・弁 ${worstValve}px）`,
  )
}

await main()
