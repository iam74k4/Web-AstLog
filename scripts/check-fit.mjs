/*
  「公開ページはスクロールしない」を、実際にブラウザで測る。

  この不変条件はこの機能の名前そのものなのに、確かめる手段がリポジトリに
  1つも無かった。typecheck も lint も vitest も寸法を測らない——vitest は
  workerd の上で動くので、そもそも版面を組むエンジンが居ない。残っていたのは
  「9通りを手で開く」という手順だけで、1回目は実行されるが2回目は
  「今回は件数を1つ増やしただけだから」で飛ばされる。

  だから測るほうを1つのコマンドにする。`npm run check:fit`。

  測るのは3つ。
    (1) ページそのものが動くか        document.scrollingElement の scrollHeight - clientHeight
    (2) 節の弁（overflow: auto）が開くか  節ごとの scrollHeight - clientHeight
    (3) 見出しの錨がそろっているか    同じ骨格・寸法の中で、節の見出しの上端の y
  (1)(2) はどちらも設計サイズでは 0 でなければならない。弁が開くのは
  public/app.css が名前を付けている3つの条件——拡大 200% 以上・画面高 400px
  未満・書体差——のときだけで、設計サイズで開いたなら弁の出番ではなく
  perScreen の不具合。

  (3) は「めくっても見出しが跳ねない」。割られた画面の節は上揃えで、見出しは
  どの画面でも同じ高さから始まる（app.css の「画面に収める外枠」）。上下中央に
  寄せていたころは、見出しの高さが中身の量で決まり、/projects 91px →
  /projects/2 124px → /projects/4 243px と跳ねていた（= rail @390x844）。
  比べないのは Hero（入口・個人ページの1枚目）と月の節（Contact）——どちらも
  見出しで始まる画面ではなく、名乗り・誘いを中央や下に置く構図そのもの。
  作品のページは「← 一覧に戻る」が見出しの上に立つので、その札の上端で比べる
  （見出しより前に何かがある画面は、節の最初の子の上端が錨）。

  (1) は documentElement ではなく document.scrollingElement で測る。
  以前このサイトの HTML には `<!DOCTYPE html>` が無く、ブラウザは互換モードで
  組んでいた。互換モードでは scrollingElement が body になり、
  documentElement.clientHeight は画面の高さではなく中身の高さを返す——つまり
  documentElement で測ると、差はどのページでも必ず 0 になり、検査は永久に緑の
  まま何も見なかった（縦に 3275px ある /all でさえ 0 と出た。実測で確認した）。
  いまは外枠がすべて src/ui/components.tsx の HtmlDocument を通って DOCTYPE を
  出すので標準モードで、scrollingElement は html を指す。それでも
  scrollingElement で測るのは、どちらのモードでも「動く箱」を指す正しい測り方
  だから。外枠が1つ DOCTYPE を落としても、この検査はその画面を正しく測る
  （落としたこと自体は test/public.test.ts の「文書の外枠」が捕まえる）。

  1px までは許す。連動する文字の段は clamp() で決まるので、幅しだいで端数が出る。

  `npm test` とは分けてある。あちらは workerd の中で D1 と KV ごと動かす場所で、
  こちらは本物の版面が要る。混ぜると、片方のために片方の実行環境を曲げることになる。
*/

import process from 'node:process'
import { chromium } from 'playwright'
import { devServer } from './lib/dev-server.mjs'
import { keysOf } from './lib/theme.mjs'

/*
  設計サイズ。CLAUDE.md と public/app.css の「9通り」は、この3つ × 骨格3つのこと。
  電話・板・机。WCAG 1.4.10 の 320x256 はここに入れない——あの寸法にはカードが
  1枚も入らず、収めにいくと設計サイズの件数まで削ることになる。あちらは弁を開けて
  受け、そのかわりキーボードで操作できるようにしてある（節の tabindex）。

  電話と板は指で測る（touch: hasTouch で pointer: coarse になる）。実物は指で
  触る寸法で、指のときは押す手が --tap の 44px になり、目次の行き先も 44px の
  的になって 899 以下の柱の帯が 30px → 44px に伸びる（app.css の
  @media (pointer: coarse)）。細いポインタで測っていたころは、電話の実物より
  14px 以上多い予算で合格を出していた。指の姿は細いポインタの姿より必ず高い
  （足すだけで削る規則が無い）ので、指で閉じれば細いポインタでも閉じる。
*/
const VIEWPORTS = [
  { width: 390, height: 844, touch: true },
  { width: 768, height: 1024, touch: true },
  { width: 1440, height: 900, touch: false },
]

/*
  弁の付け先。public/app.css の
  `:where(body[data-layout]:not([data-whole])) main > :is(.hero, section)`
  と同じ相手を、同じ書き方で選ぶ。クラスを列挙すると、これから足す節が漏れる。
*/
const PANELS = 'main > :is(.hero, section)'

// 端数の許し。連動する段は clamp() で決まるので、幅しだいで 0.x px が出る
const SLACK = 1

/*
  見出しの錨を比べる相手。割られた画面の節のうち、Hero（header.hero）でも
  月の節（.moonlit）でもないもの。app.css の上揃えの規則と同じ相手を選ぶ。
*/
const ANCHORED = 'main > section:not(.moonlit)'

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

  /*
    少なすぎたら止める。**ここが無いと、この検査は黙って空振りする。**

    数え上げる相手を sitemap から引いているので、D1 が空（migrate / seed を
    忘れた新しいワークツリー、など）だと画面がほとんど生えず、sitemap が
    数本しか返さない。それでも1本ずつは 200 で返るので、検査は
    「✓ 9 通り」と緑で終わる——**測っていないのに合格**になる。
    実際に再現した（paths を1本に絞ると 3骨格 × 3寸法 × 1URL = 9通りで緑、
    終了コード 0）。

    このリポジトリは同じ型の事故を3回やっている（規則をそのまま引用した
    コメントに当たって永久に緑になった件）。床は低めに置いてあり、
    「中身が減った」ではなく「DB が立っていない」を捕まえるためのもの。
    本当に画面を減らしたなら、この数も一緒に下げること——その変更が
    diff に出ることに意味がある。
  */
  const FLOOR = 5
  if (all.length < FLOOR) {
    throw new Error(
      `sitemap.xml の URL が ${all.length} 本しかない（最低 ${FLOOR} 本を期待）。` +
        'D1 が空のまま測ると、ほとんど何も測らずに緑で終わる。' +
        'npm run db:migrate:local と npm run db:seed:local を先に通すこと',
    )
  }

  // 縦に伸びてよいのは全体ページだけ（body[data-whole]）。ここだけは測らない
  const paths = all.filter((path) => path !== '/all')
  if (paths.length === all.length) {
    console.warn('注意: sitemap に /all が無い。全体ページの除外が空振りしている')
  }
  return paths
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
const measure = ([layout, panels, anchored, slack]) => {
  document.body.dataset.layout = layout

  // 標準モード（いまのこのサイト）では html、互換モード（DOCTYPE が無い）では body
  const scroller = document.scrollingElement ?? document.documentElement
  const boxes = [...document.querySelectorAll(panels)]

  /*
    錨の y。節の最初の h1 の上端——ただし h1 より前に別の子（作品のページの
    「← 一覧に戻る」）が立つ画面では、その最初の子の上端。絶対配置の子
    （月）と display: none の子は並びに数えない。
  */
  const panel = document.querySelector(anchored)
  let anchor = null
  if (panel) {
    const kids = [...panel.children].filter((kid) => {
      const style = getComputedStyle(kid)
      return style.position !== 'absolute' && style.display !== 'none'
    })
    const heading = panel.querySelector('h1')
    const first = kids[0]
    const leader = first && heading && !first.contains(heading) ? first : (heading ?? first)
    anchor = leader ? Math.round(leader.getBoundingClientRect().top * 10) / 10 : null
  }

  return {
    page: Math.max(0, scroller.scrollHeight - scroller.clientHeight),
    open: boxes
      .map((box) => ({
        name: box.id || box.className || box.tagName.toLowerCase(),
        over: Math.max(0, box.scrollHeight - box.clientHeight),
      }))
      .filter((box) => box.over > slack),
    panels: boxes.length,
    anchor,
  }
}

async function main() {
  // FIT_BASE を渡したときだけ、そこに向けて測る（手元の dev を使いたいとき）
  const { base, stop } = await devServer(process.env.FIT_BASE, Number(process.env.FIT_PORT ?? 8788))

  const browser = await chromium.launch()
  const failures = []
  let checked = 0
  let worstPage = 0
  let worstValve = 0
  let urlCount = 0
  let layoutCount = 0
  // 骨格 × 寸法ごとの、見出しの錨の y（URL ごと）
  const anchors = new Map()
  let worstDrift = 0

  try {
    const layouts = keysOf('LAYOUTS')
    const paths = await screenPaths(base)
    urlCount = paths.length
    layoutCount = layouts.length
    console.log(
      `画面に収まっているか — ${layoutCount}骨格 × ${VIEWPORTS.length}ビューポート × ${paths.length}URL = ${layouts.length * VIEWPORTS.length * paths.length}通り`,
    )

    for (const viewport of VIEWPORTS) {
      const context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        hasTouch: viewport.touch,
      })
      const page = await context.newPage()
      const where = `${viewport.width}x${viewport.height}${viewport.touch ? ' 指' : ''}`

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
          const found = await page.evaluate(measure, [layout, PANELS, ANCHORED, SLACK])
          checked += 1
          if (found.anchor !== null) {
            const key = `${layout} ${where}`
            if (!anchors.has(key)) anchors.set(key, [])
            anchors.get(key).push({ path, y: found.anchor })
          }
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
      await context.close()
    }
  } finally {
    await browser.close()
    stop()
  }

  /*
    見出しの錨。同じ骨格・寸法の中で、いちばん上といちばん下の差が SLACK を
    超えたら、外れた画面を名指しする（多数派の y から離れているもの）。
  */
  for (const [key, list] of anchors) {
    const ys = list.map((one) => one.y)
    const drift = Math.max(...ys) - Math.min(...ys)
    worstDrift = Math.max(worstDrift, drift)
    if (drift <= SLACK) continue
    const tally = new Map()
    for (const y of ys) tally.set(y, (tally.get(y) ?? 0) + 1)
    const usual = [...tally].sort((a, b) => b[1] - a[1])[0][0]
    const strays = list.filter((one) => Math.abs(one.y - usual) > SLACK)
    for (const one of strays) {
      failures.push(
        `${key} ${one.path} — 見出しの錨が ${one.y}px（ほかの画面は ${usual}px）。めくると見出しが跳ねる`,
      )
    }
    // 多数派から 1px ずつずれて並んだ（どれも名指しできない）ときも、差そのもので落とす
    if (strays.length === 0) {
      failures.push(`${key} — 見出しの錨が ${Math.min(...ys)}〜${Math.max(...ys)}px に散っている`)
    }
  }

  if (failures.length > 0) {
    console.error(`\n✗ ${failures.length} 件（${checked} 通り中）`)
    for (const line of failures) console.error(`  ${line}`)
    console.error(
      '\n設計サイズで弁が開いたら、それは弁の不具合ではなく src/blocks.ts の perScreen の不具合。まず件数を疑う。' +
        '\n見出しの錨がずれたら、節の寄せ方（app.css の align-content: safe start）か、見出しより前に置いた子を疑う。',
    )
    process.exitCode = 1
    return
  }

  console.log(
    `✓ ${checked} 通り（${urlCount} URL × ${layoutCount}骨格 × ${VIEWPORTS.length}寸法）。` +
      `ページが動いた画面 0、弁が開いた節 0（いちばん惜しいところでページ ${worstPage}px・弁 ${worstValve}px）。` +
      `見出しの錨のずれ 最大 ${Math.round(worstDrift * 10) / 10}px`,
  )
}

await main()
