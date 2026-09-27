/*
  公開ページのレイアウトを、実際にブラウザで測る。`npm run check:fit`。

  公開ページは節ごとに1ページで、縦にスクロールする（CLAUDE.md の「公開ページは縦に読む」）。
  その代わりに
  守らなければならないことが、どれも版面を組んでみないと分からない——typecheck も
  lint も vitest も寸法を測らない（vitest は workerd の上で動き、版面を組むエンジンが
  居ない）。だから測るほうを1つのコマンドにしてある。

  ## 何を測るか

  **幾何で測る。** 規則が書いてあるか（test/theme.test.ts が文字列で見る）ではなく、
  ブラウザが解いた結果の箱の位置を見る。後ろで別のセレクタに上書きされても、
  ここは書き方に左右されない。

    (1) スクロールできる   html と body の overflow が visible（clip / hidden にすると
                          中身がページの外で黙って切られる）
    (2) 横にはみ出さない   ページの scrollWidth ≤ clientWidth、見えている要素の左右が
                          画面の中（横に動く帯＝目次・絞り込みの中身と、月は除く）
    (3) 切られた要素が無い  overflow が hidden / clip の祖先の外へ出ている要素も、
                          自分の中身（字）を hidden / clip で切っている箱も無い
                          （行止め line-clamp・1行で末尾を省く ellipsis・読み上げ用の
                          1px の箱・月は除く）
    (4) h1 がちょうど1つ   1ページ = 1ドキュメント（WCAG 1.3.1）
    (5) 柱の場所           柱が骨格どおりの場所（rail の 900 以上は本文の左、ほかは上）
    (6) 目次の貼り付け     柱（帯）の position が sticky。本文の下に画面3つぶんの空きを
                          足して一番下まで送っても、目次といまの印が画面の中に見えて
                          いて、帯の姿では本文より手前に描かれ（印の真ん中の点が柱）、
                          地が透けていない
    (7) 送った先           main の中の id を持つ要素（#about など）へ送ると、上端が
                          帯の下端より下（rail の 900 以上は画面の上端より下）に来る
                          （app.css の scroll-padding-top と :root の --band-clear）
    (8) 目次の的           指（pointer: coarse）の姿で、目次の行き先と管理画面への
                          入口の高さが --tap 以上
    (9) 見出しの錨         同じ骨格・書体・寸法・姿の中で、節の見出しの上端の y が
                          1px 以内でそろう
   (10) 中央の軸           中央寄せの骨格で、入口の Hero の直接の子の中心 x が Hero の中心と
                          そろう（行いっぱいに伸びた子は、中身の広がりの中心で見る）

  ほかに、読み込み直して測るものが2つある（measureRun の後半）。

   (11) 目次の印           目次が帯になる姿（899 以下の全骨格と、上の帯になる骨格の
                          900 以上）で、いまのページの行き先（aria-current）が帯の見えて
                          いる幅の中にある。帯の最初の位置は読み込んだ時点で決まる
                          （app.css の scroll-initial-target）ので、属性の差し替えでは
                          測れない——骨格はサーバーの返す HTML の data-layout を
                          書き換えて開き直す。書体はサイトの既定のまま
   (12) 全体ページ         /all がどの骨格・書体・寸法でも横に動かない

  (9) は「どのページでも見出しが同じ高さから始まる」。節は上揃えで、見出しの高さは
  中身の量で変わらない（app.css の「ページの外枠」）。比べるのは main の最初の子が
  節のページだけ——Hero で始まるページ（入口・個人ページの名札）と月の節（Contact）は
  見出しで始まるページではなく、名乗り・誘いを置く表紙そのもの。作品のページは
  「← 一覧に戻る」が見出しの上に立つので、その札の上端で比べる。

  1px までは許す。連動する文字の段は clamp() で決まるので、幅しだいで端数が出る。

  以前（公開ページが1画面に収まっていたころ）は「ページが動かない」「節の弁が
  開かない」と、画面の底のページャの手の高さを測っていた。いまはページが動くのが
  正しく、ページャも無いので、どれも測らない。

  ## 何の中身で測るか

  4つの中身を、それぞれ使い捨ての D1 に入れて測る（手元の D1 には触らない）。

    seed               seed.sql。本人のサイトそのもの（1人・打ち込むブロック無し）
    fixture（複数人）  scripts/lib/fit-fixture.mjs が作る、重い中身の複数人のサイト
                       （打ち込むブロック6種 × 2形の長い中身・6人の Team・長い肩書き・
                       上限の大見出し・長い紹介文と経歴・いちばん重いカードの行・
                       長い本文）
    fixture（1人）     同じ中身で公開中のメンバーを1人にしたもの。Team の位置に
                       プロフィールが入り、柱が名前と長い職種で名乗る姿
    seed＋ブロック3本  seed.sql に、打ち込むブロックを既定の見出しのまま3本
                       （fit-fixture.mjs の seedBlocks）。本人がブロックを数本
                       足しただけで目次の帯が溢れる姿（(11) の相手）

  どの中身も、訪問者の姿とログインした姿（柱に「管理画面」の入口が出る）の
  両方で測る。ログインした姿は、セッションを使い捨ての D1 に直接作り、クッキーを
  渡して開く（OAuth は通らない）。

  骨格と書体は body の data-layout / data-typeface を差し替えて見る（下の measure）。
  寸法3 × 骨格3 × 書体3 = 27通りを、URL ごと・姿ごとに。

  `npm test` とは分けてある。あちらは workerd の中で D1 と KV ごと動かす場所で、
  こちらは本物の版面が要る。混ぜると、片方のために片方の実行環境を曲げることになる。

  ## 手元の dev を測る・絞る

  FIT_ONLY=seed,blocks,many,solo で測る中身を絞れる（CI は絞らない）。

  FIT_BASE を渡すと、そこに立っている dev サーバをそのまま測る（中身はその D1 の
  まま・訪問者の姿だけ。セッションを作れないので）。FIT_PORT は自分で立てるときの
  ポート（中身ごとに同じポートで順に立てる）。
*/

import { createHash, randomBytes } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import process from 'node:process'
import { chromium } from 'playwright'
import { devServer, ROOT, scratchState } from './lib/dev-server.mjs'
import { fixture, seedBlocks } from './lib/fit-fixture.mjs'
import { keysOf } from './lib/theme.mjs'
import { DESIGN_SIZES } from './lib/viewports.mjs'

// 設計サイズ（390 と 768 は指で測る）。一覧と理由は scripts/lib/viewports.mjs
const VIEWPORTS = DESIGN_SIZES

/*
  柱が本文の左に立つ骨格と、その幅。ほかの骨格・幅では柱は本文の上の帯になる。
  app.css の「ページの外枠」の 900 以上（rail だけが .shell を2列の grid に戻す）と同じ。
*/
const BESIDE = { rail: 900 }

// 端数の許し。連動する段は clamp() で決まるので、幅しだいで 0.x px が出る
const SLACK = 1

/*
  見出しの錨を比べる相手。main の最初の子が節で、月の節（.moonlit）でないもの。
  Hero（header.hero）で始まるページ（入口・個人ページ）は比べない——個人ページの
  About の見出しは名札の下にあり、名札の高さしだいで下がる。
*/
const ANCHORED = 'main > section:first-child:not(.moonlit)'

// src/lib/auth.ts の SESSION_COOKIE と sessionKey（SHA-256 の16進）と同じ
const SESSION_COOKIE = 'nx_session'

/*
  ログインした姿のためのセッション。使い捨ての D1 に owner を1人と、その
  セッションを1本、直接入れる。D1 にはクッキーの値のハッシュしか置かない
  （src/lib/auth.ts の sessionKey）ので、同じ式で作る。
*/
function session() {
  const token = randomBytes(32).toString('hex')
  const id = createHash('sha256').update(token).digest('hex')
  const sql = [
    "INSERT INTO users (id, role) VALUES (9001, 'owner');",
    `INSERT INTO sessions (id, user_id, expires_at) VALUES ('${id}', 9001, '2999-01-01T00:00:00.000Z');`,
  ].join('\n')
  return { token, sql }
}

/*
  測る URL は sitemap.xml から引く。

  手で並べた表を持つと、ページを1つ足した日にこちらだけ古くなる——しかも
  古くなったことは緑のまま分からない。sitemap は公開ページと同じ式
  （sitePageLinks / memberHref / itemHref）から数え上げているので、新しい URL の族を
  足せばこの検査の対象も自動で増える。

  **少なすぎたら止める。** ここが無いと、この検査は黙って空振りする——D1 が空なら
  ページがほとんど生えず、それでも1本ずつは 200 で返るので「✓」で終わる。
  seed は 11 本（1人のサイトでは /team がプロフィールへの 301 で sitemap から
  外れる）、seed＋ブロック3本は 14 本、fixture は作った中身から必ず生える URL
  （fit-fixture.mjs の expect）を1本ずつ突き合わせる。本当にページを減らしたなら、
  この数も一緒に下げること——その変更が diff に出ることに意味がある。
*/
async function screenPaths(base, run) {
  const response = await fetch(`${base}/sitemap.xml`)
  if (!response.ok) throw new Error(`/sitemap.xml が ${response.status} を返した`)

  const xml = await response.text()
  const all = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((found) => new URL(found[1]).pathname)

  // 縦に伸びてよいのは全体ページだけ（body[data-whole]）。ここだけは測らない
  const paths = all.filter((path) => path !== '/all')
  if (paths.length === all.length) {
    console.warn('注意: sitemap に /all が無い。全体ページの除外が空振りしている')
  }

  if (paths.length < run.least) {
    throw new Error(
      `${run.label}: sitemap.xml の URL が ${paths.length} 本しかない（${run.least} 本を期待）。` +
        '中身が入っていないまま測ると、ほとんど何も測らずに緑で終わる',
    )
  }
  const missing = (run.expect ?? []).filter((path) => !paths.includes(path))
  if (missing.length) {
    throw new Error(
      `${run.label}: 中身から生えるはずのページが sitemap に無い: ${missing.join(', ')}。` +
        '測ったつもりで、そのページは測られない',
    )
  }
  return paths
}

/*
  1つの姿を測る。ページの中で動く（page.evaluate）。

  骨格と書体は body の data-layout / data-typeface を差し替えて見る。マークアップは
  どのプリセットでも同じで、変わるのは app.css の [data-layout] / [data-typeface]
  側だけ（src/ui/Layout.tsx がそう書いてある）。だから属性を差し替えれば、管理画面で
  保存したのと同じ姿になる。保存の経路を通すと、測りたい版面ではなく設定の保存を
  測ることになる。

  測り終えたら、足した空きを外してページの頭へ戻す（次の姿を同じ位置から測る）。
*/
const measure = ([layout, typeface, cfg]) => {
  const root = document.documentElement
  const scroller = document.scrollingElement ?? root
  const to = (y) => scroller.scrollTo({ top: y, behavior: 'instant' })
  document.body.dataset.layout = layout
  document.body.dataset.typeface = typeface
  to(0)

  const slack = cfg.slack
  const problems = []
  const round = (n) => Math.round(n * 10) / 10
  const nameOf = (el) =>
    el.id
      ? `#${el.id}`
      : `${el.tagName.toLowerCase()}${el.classList.length ? `.${[...el.classList].join('.')}` : ''}`
  const list = (items) =>
    `${items.slice(0, 3).join(', ')}${items.length > 3 ? ` ほか ${items.length - 3}` : ''}`

  // (1) スクロールできる。clip / hidden にすると、長い中身がページの外で黙って切られる
  for (const el of [root, document.body]) {
    const style = getComputedStyle(el)
    if (style.overflowY !== 'visible' || style.overflowX !== 'visible') {
      problems.push(
        `${el.tagName.toLowerCase()} の overflow が ${style.overflowX} / ${style.overflowY}（visible のはず）`,
      )
    }
  }

  const shell = document.querySelector('.shell')
  const main = document.querySelector('main')
  const rail = document.querySelector('.rail')
  const toc = rail?.querySelector('.toc')
  if (!shell || !main || !rail || !toc) {
    return { problems: ['.shell / main / .rail / .toc のどれかが無い'], anchor: null, tall: 0 }
  }

  // (4) h1 はちょうど1つ
  const h1s = document.querySelectorAll('h1')
  if (h1s.length !== 1) problems.push(`h1 が ${h1s.length} 個（ちょうど1つのはず）`)

  // (5) 柱の場所。骨格どおりに解けているか
  const railBox = rail.getBoundingClientRect()
  const mainBox = main.getBoundingClientRect()
  const beside = cfg.beside[layout] !== undefined && innerWidth >= cfg.beside[layout]
  if (beside ? railBox.right > mainBox.left + slack : railBox.bottom > mainBox.top + slack) {
    problems.push(
      `柱が本文の${beside ? '左' : '上'}に居ない（柱 ${round(railBox.bottom)} / 本文 ${round(mainBox.top)}）`,
    )
  }

  /*
    (2)(3) 横のはみ出しと、切られた要素。

    除くもの: 大きさの無い箱、visibility: hidden、読み上げ用の 1px の箱（.sr-only・
    畳んだワードマーク）の中、月（aria-hidden の飾り。自分の overflow: clip の中で
    光暈を切る）、行止め（line-clamp）の中、横や縦に送れる箱（overflow: auto /
    scroll ——目次と絞り込みの帯、900 以上の柱）の中。送れる箱はその箱自身を測る
  */
  const scrolls = (style) =>
    ['auto', 'scroll'].includes(style.overflowX) || ['auto', 'scroll'].includes(style.overflowY)
  const clips = (style) =>
    ['hidden', 'clip'].includes(style.overflowX) || ['hidden', 'clip'].includes(style.overflowY)
  const skipped = new Set()
  const wide = []
  const cut = []
  for (const el of [...rail.querySelectorAll('*'), ...main.querySelectorAll('*')]) {
    const parent = el.parentElement
    if (parent && skipped.has(parent)) {
      skipped.add(el)
      continue
    }
    const style = getComputedStyle(el)
    const rect = el.getBoundingClientRect()
    if (
      el.classList.contains('moon') ||
      (rect.width <= 1 && rect.height <= 1 && style.position === 'absolute') ||
      style.webkitLineClamp !== 'none'
    ) {
      skipped.add(el)
      // 月の箱そのものは画面の中に居ること（中の光暈は自分で切る）
      if (!el.classList.contains('moon')) continue
    }
    if (rect.width === 0 || rect.height === 0 || style.visibility === 'hidden') continue
    if (rect.right > innerWidth + slack || rect.left < -slack) {
      wide.push(`${nameOf(el)} ${round(rect.left)}〜${round(rect.right)}px`)
    }
    if (scrolls(style)) skipped.add(el)
    if (skipped.has(el)) continue
    /*
      自分の中身（字）を切っている箱。子の要素が無い段落を max-height と
      overflow: hidden で止めても、子の位置では見つからない。1行で末尾を省く箱
      （text-overflow: ellipsis。読み上げには全部が残る）は決まりどおりなので除く
    */
    if (
      clips(style) &&
      style.textOverflow !== 'ellipsis' &&
      (el.scrollHeight > el.clientHeight + slack || el.scrollWidth > el.clientWidth + slack)
    ) {
      cut.push(
        `${nameOf(el)} の中身（${el.scrollWidth}x${el.scrollHeight} を ${el.clientWidth}x${el.clientHeight} で）`,
      )
    }
    for (let up = el.parentElement; up && up !== shell; up = up.parentElement) {
      const upStyle = getComputedStyle(up)
      if (scrolls(upStyle)) break
      if (!clips(upStyle)) continue
      const box = up.getBoundingClientRect()
      const x = ['hidden', 'clip'].includes(upStyle.overflowX)
      const y = ['hidden', 'clip'].includes(upStyle.overflowY)
      if (
        (x && (rect.left < box.left - slack || rect.right > box.right + slack)) ||
        (y && (rect.top < box.top - slack || rect.bottom > box.bottom + slack))
      ) {
        cut.push(`${nameOf(el)}（${nameOf(up)} の外）`)
        break
      }
    }
  }
  const across = scroller.scrollWidth - scroller.clientWidth
  if (across > slack) problems.push(`ページが横に ${across}px 動く`)
  if (wide.length) problems.push(`画面の横にはみ出している: ${list(wide)}`)
  if (cut.length) problems.push(`切られている: ${list(cut)}`)

  /*
    (8) 目次の的。指のときは目次の行き先と管理画面への入口も --tap（app.css の
    @media (pointer: coarse)）
  */
  const tap = parseFloat(getComputedStyle(root).getPropertyValue('--tap'))
  if (matchMedia('(pointer: coarse)').matches) {
    for (const hand of rail.querySelectorAll('.toc a, .rail__admin')) {
      const tall = hand.getBoundingClientRect().height
      if (tall > 0 && tall < tap - slack) {
        problems.push(
          `目次の的「${hand.textContent.trim()}」が ${round(tall)}px（--tap は ${tap}px）`,
        )
      }
    }
  }

  /*
    (10) 中央寄せの入口の Hero の子の中心。自分の幅の子（帯・全体ページへの1本）は
    箱の中心、行いっぱいに伸びた子（見出し・リード文）は中身の広がり（Range）の中心で
    見る——伸びた箱の中心はいつも真ん中なので、中身が左に寄っていても見逃す。
    個人ページの頭（.hero--profile）は中央に組まない（本文の列と同じ左の軸）ので測らない
  */
  const hero =
    layout === 'center' ? document.querySelector('main > .hero:not(.hero--profile)') : null
  if (hero) {
    const heroStyle = getComputedStyle(hero)
    const heroBox = hero.getBoundingClientRect()
    const inner =
      hero.clientWidth - parseFloat(heroStyle.paddingLeft) - parseFloat(heroStyle.paddingRight)
    const axis = heroBox.left + hero.clientLeft + parseFloat(heroStyle.paddingLeft) + inner / 2
    for (const kid of hero.children) {
      const kidStyle = getComputedStyle(kid)
      if (kidStyle.position === 'absolute' || kidStyle.display === 'none') continue
      const box = kid.getBoundingClientRect()
      if (box.width <= 1 || box.height <= 1) continue
      let rect = box
      if (box.width >= inner - slack) {
        const range = document.createRange()
        range.selectNodeContents(kid)
        rect = range.getBoundingClientRect()
      }
      const centre = (rect.left + rect.right) / 2
      if (Math.abs(centre - axis) > slack) {
        problems.push(
          `中央寄せの Hero の子 ${nameOf(kid)} の中心が ${round(centre - axis)}px ずれている`,
        )
      }
    }
  }

  /*
    (9) 錨の y。節の最初の h1 の上端——ただし h1 より前に別の子（作品のページの
    「← 一覧に戻る」）が立つページでは、その最初の子の上端。絶対配置の子
    （月）と display: none の子は並びに数えない。ページの頭で測る。
  */
  const anchored = document.querySelector(cfg.anchored)
  let anchor = null
  if (anchored) {
    const kids = [...anchored.children].filter((kid) => {
      const kidStyle = getComputedStyle(kid)
      return kidStyle.position !== 'absolute' && kidStyle.display !== 'none'
    })
    const heading = anchored.querySelector('h1')
    const first = kids[0]
    const leader = first && heading && !first.contains(heading) ? first : (heading ?? first)
    anchor = leader ? round(leader.getBoundingClientRect().top) : null
  }
  const tall = scroller.scrollHeight

  /*
    (6) 目次の貼り付け。本文の下に画面3つぶんの空きを足し、ページを一番下まで
    送る。いまの中身が1画面に収まるページでも、貼り付けが効いているかを必ず試せる。
  */
  const railStyle = getComputedStyle(rail)
  if (railStyle.position !== 'sticky') {
    problems.push(`柱の position が ${railStyle.position}（sticky のはず）`)
  }
  const spacer = document.createElement('div')
  spacer.style.height = `${innerHeight * 3}px`
  main.append(spacer)
  try {
    to(scroller.scrollHeight)
    const tocBox = toc.getBoundingClientRect()
    if (tocBox.top < -slack || tocBox.top >= innerHeight) {
      problems.push(`一番下まで送ると目次が画面の外（上端 ${round(tocBox.top)}px）`)
    }
    const mark = toc.querySelector("a[aria-current='page']")
    if (mark) {
      const at = mark.getBoundingClientRect()
      if (at.top < -slack || at.bottom > innerHeight + slack) {
        problems.push(
          `一番下まで送ると目次の印が画面の外（${round(at.top)}〜${round(at.bottom)}px）`,
        )
      }
    }

    /*
      帯の姿では、本文を帯の下へ潜らせた位置で、帯が手前に描かれているか（印の
      真ん中の点が柱の中の要素）と、地が透けていないか（背景が透明でない）
    */
    if (!beside) {
      to(Math.max(0, mainBox.top - railBox.height + innerHeight / 3))
      const probe = mark ?? toc
      const at = probe.getBoundingClientRect()
      const hit = document.elementFromPoint((at.left + at.right) / 2, (at.top + at.bottom) / 2)
      if (hit && !rail.contains(hit)) {
        problems.push(`送ると帯の上に本文が描かれる（${nameOf(hit)} が目次の上）`)
      }
      const paint = railStyle.backgroundColor
      if (paint === 'transparent' || /rgba\(.*,\s*0\)$/.test(paint)) {
        problems.push(`帯の地が透けている（background-color: ${paint}）`)
      }
    }

    /*
      (7) 送った先。main の中の id を持つ要素（と main 自身）へ送り、上端が帯の下端
      より下に来るか。scrollIntoView は html の scroll-padding-top を読む
      （フラグメントで移るときと同じ）
    */
    const hidden = []
    for (const target of [main, ...main.querySelectorAll('[id]')]) {
      if (target.getBoundingClientRect().height === 0) continue
      target.scrollIntoView({ block: 'start', behavior: 'instant' })
      const floor = beside ? 0 : rail.getBoundingClientRect().bottom
      const top = target.getBoundingClientRect().top
      if (top < floor - slack)
        hidden.push(`#${target.id} ${round(top)}px（帯の下端 ${round(floor)}px）`)
    }
    if (hidden.length) problems.push(`送った先が帯の下に隠れる: ${list(hidden)}`)
  } finally {
    spacer.remove()
    to(0)
  }

  return { problems, anchor, tall }
}

/*
  (11) 目次の印。帯の姿（柱が本文の左に立たない骨格・幅）でだけ測る。

  骨格は属性の差し替えではなく、サーバーの返す HTML の data-layout を書き換えて
  開き直す。帯の最初のスクロール位置（scroll-initial-target）は読み込んだときに
  決まるので、開いたあとで骨格を変えても「その骨格で開いた姿」にはならない。
*/
const tocMark = ([slack]) => {
  const toc = document.querySelector('.toc')
  const mark = toc?.querySelector("a[aria-current='page']")
  if (!toc || !mark) return null
  const box = toc.getBoundingClientRect()
  const left = box.left + toc.clientLeft
  const right = left + toc.clientWidth
  const at = mark.getBoundingClientRect()
  return {
    inside: at.left >= left - slack && at.right <= right + slack,
    name: mark.textContent.trim(),
    overflow: toc.scrollWidth - toc.clientWidth,
    scrolled: toc.scrollLeft,
  }
}

async function tocPass(browser, base, paths, layouts) {
  const failures = []
  let checked = 0
  let scrolled = 0
  for (const viewport of VIEWPORTS) {
    for (const layout of layouts) {
      if (BESIDE[layout] !== undefined && viewport.width >= BESIDE[layout]) continue
      const context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        hasTouch: viewport.touch,
      })
      const page = await context.newPage()
      await page.route('**/*', async (route) => {
        if (route.request().resourceType() !== 'document') return route.continue()
        const response = await route.fetch()
        const html = await response.text()
        const opening = /<body data-layout="[a-z]+"/
        if (!opening.test(html)) {
          failures.push(`${route.request().url()} — body の data-layout を書き換えられない`)
        }
        const body = html.replace(opening, `<body data-layout="${layout}"`)
        await route.fulfill({ response, body })
      })
      const where = `${layout} ${viewport.width}x${viewport.height}${viewport.touch ? ' 指' : ''}`
      for (const path of paths) {
        await page.goto(base + path, { waitUntil: 'load' })
        await page.evaluate(() => document.fonts.ready.then(() => true))
        const found = await page.evaluate(tocMark, [SLACK])
        if (!found) continue
        checked += 1
        if (found.scrolled > 0) scrolled += 1
        if (!found.inside) {
          failures.push(
            `${where} ${path} — 目次の印「${found.name}」が帯の見えている幅の外にある（帯は ${found.overflow}px 溢れ、${found.scrolled}px 送って開いた）`,
          )
        }
      }
      await context.close()
    }
  }
  return { failures, checked, scrolled }
}

/*
  (12) 全体ページが横に動かない。/all は節を縦に積んだ1本の文書で、柱を貼り付けない
  （app.css の「ページの外枠」の外）ので上の測り方には入れていない。横はどのページも動かない。
*/
async function wholePass(browser, base, layouts, typefaces) {
  const failures = []
  let checked = 0
  for (const viewport of VIEWPORTS) {
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      hasTouch: viewport.touch,
    })
    const page = await context.newPage()
    const response = await page.goto(`${base}/all`, { waitUntil: 'load' })
    if (response?.status() !== 200) {
      failures.push(`/all が ${response?.status()} を返した`)
      await context.close()
      continue
    }
    await page.evaluate(() => document.fonts.ready.then(() => true))
    for (const layout of layouts) {
      for (const typeface of typefaces) {
        const wide = await page.evaluate(
          ([layout, typeface]) => {
            document.body.dataset.layout = layout
            document.body.dataset.typeface = typeface
            const root = document.documentElement
            return root.scrollWidth - root.clientWidth
          },
          [layout, typeface],
        )
        checked += 1
        if (wide > SLACK) {
          failures.push(
            `${layout}/${typeface} ${viewport.width}x${viewport.height} /all — ページが横に ${wide}px 動く`,
          )
        }
      }
    }
    await context.close()
  }
  return { failures, checked }
}

/*
  1つの中身（seed か fixture）を測る。base に立っているサーバの sitemap の全 URL を、
  寸法3 × 姿（訪問者・ログイン）× 骨格3 × 書体3 で。
*/
async function measureRun(browser, base, run, layouts, typefaces) {
  const failures = []
  const anchors = new Map()
  let checked = 0
  let longest = { tall: 0, where: '' }

  const paths = await screenPaths(base, run)
  const poses = run.token ? ['訪問者', 'ログイン'] : ['訪問者']

  for (const viewport of VIEWPORTS) {
    for (const pose of poses) {
      const context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        hasTouch: viewport.touch,
      })
      if (pose === 'ログイン') {
        await context.addCookies([{ name: SESSION_COOKIE, value: run.token, url: base }])
      }
      const page = await context.newPage()
      const where = `${viewport.width}x${viewport.height}${viewport.touch ? ' 指' : ''}${pose === 'ログイン' ? ' ログイン' : ''}`

      for (const path of paths) {
        const response = await page.goto(base + path, { waitUntil: 'load' })
        const status = response?.status() ?? 0
        if (status !== 200) {
          failures.push(`${where} ${path} — ${status} が返った（sitemap に載っているのに）`)
          continue
        }
        // ログインした姿は柱に管理画面への入口が出る。出ていなければ、その姿は測れていない
        if (pose === 'ログイン' && (await page.locator('.rail a[href^="/admin"]').count()) === 0) {
          failures.push(
            `${where} ${path} — ログインしたのに柱に管理画面の入口が無い（姿を測れていない）`,
          )
        }
        // 書体が決まる前に測ると、行の高さが見積もりとずれる
        await page.evaluate(() => document.fonts.ready.then(() => true))

        for (const layout of layouts) {
          for (const typeface of typefaces) {
            const found = await page.evaluate(measure, [
              layout,
              typeface,
              { slack: SLACK, anchored: ANCHORED, beside: BESIDE },
            ])
            checked += 1
            const label = `${layout}/${typeface} ${where} ${path}`
            if (found.anchor !== null) {
              const key = `${layout}/${typeface} ${where}`
              if (!anchors.has(key)) anchors.set(key, [])
              anchors.get(key).push({ path, y: found.anchor })
            }
            for (const problem of found.problems) failures.push(`${label} — ${problem}`)
            if (found.tall > longest.tall) longest = { tall: found.tall, where: label }
          }
        }
      }
      await context.close()
    }
  }

  /*
    見出しの錨。同じ骨格・書体・寸法・姿の中で、いちばん上といちばん下の差が
    SLACK を超えたら、外れたページを名指しする（多数派の y から離れているもの）。
  */
  let worstDrift = 0
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
        `${key} ${one.path} — 見出しの錨が ${one.y}px（ほかのページは ${usual}px）。ページごとに見出しが跳ねる`,
      )
    }
    // 多数派から 1px ずつずれて並んだ（どれも名指しできない）ときも、差そのもので落とす
    if (strays.length === 0) {
      failures.push(`${key} — 見出しの錨が ${Math.min(...ys)}〜${Math.max(...ys)}px に散っている`)
    }
  }

  const toc = await tocPass(browser, base, paths, layouts)
  const whole = await wholePass(browser, base, layouts, typefaces)
  failures.push(...toc.failures, ...whole.failures)

  return {
    failures,
    checked,
    urls: paths.length,
    poses: poses.length,
    longest,
    drift: Math.round(worstDrift * 10) / 10,
    toc,
    whole,
  }
}

async function main() {
  const layouts = keysOf('LAYOUTS')
  const typefaces = keysOf('TYPEFACES')
  const port = Number(process.env.FIT_PORT ?? 8788)

  const many = fixture()
  const solo = fixture({ solo: true })
  const blocks = seedBlocks()
  const runs = process.env.FIT_BASE
    ? [{ label: '指定の先', base: process.env.FIT_BASE, least: 5 }]
    : [
        {
          key: 'seed',
          label: 'seed（1人のサイト）',
          sql: [await readFile(`${ROOT}seed.sql`, 'utf8')],
          least: 11,
        },
        {
          key: 'blocks',
          label: 'seed＋ブロック3本（1人のサイト・目次が帯から溢れる）',
          sql: [await readFile(`${ROOT}seed.sql`, 'utf8'), blocks.sql],
          least: 14,
          expect: blocks.expect,
        },
        {
          key: 'many',
          label: 'fixture（複数人・重い中身）',
          sql: [many.sql],
          least: many.expect.length,
          expect: many.expect,
        },
        {
          key: 'solo',
          label: 'fixture（1人・重い中身）',
          sql: [solo.sql],
          least: solo.expect.length,
          expect: solo.expect,
        },
      ]

  // FIT_ONLY=seed,solo のように、測る中身を絞れる（手元で直しながら回すとき用。CI は全部）
  const only = process.env.FIT_ONLY?.split(',')
  const chosen = only ? runs.filter((run) => only.includes(run.key)) : runs
  if (chosen.length === 0)
    throw new Error(
      `FIT_ONLY=${process.env.FIT_ONLY} に当たる中身が無い（seed / blocks / many / solo）`,
    )

  const browser = await chromium.launch()
  const results = []
  try {
    for (const run of chosen) {
      let state = null
      let server = null
      try {
        if (run.sql) {
          const { token, sql } = session()
          run.token = token
          state = await scratchState('fit', [...run.sql, sql])
        }
        server = await devServer(run.base, port, state?.dir)
        console.log(`測る — ${run.label}`)
        results.push({ run, ...(await measureRun(browser, server.base, run, layouts, typefaces)) })
      } finally {
        await server?.stop()
        await state?.cleanup()
      }
    }
  } finally {
    await browser.close()
  }

  const shape = `${layouts.length}骨格 × ${typefaces.length}書体 × ${VIEWPORTS.length}寸法`
  let failed = 0
  for (const result of results) {
    const poses = result.poses > 1 ? ` × ${result.poses}姿` : ''
    if (result.failures.length > 0) {
      failed += result.failures.length
      console.error(
        `\n✗ ${result.run.label}: ${result.failures.length} 件（${result.checked} 通り中）`,
      )
      for (const line of result.failures.slice(0, 80)) console.error(`  ${line}`)
      if (result.failures.length > 80) console.error(`  …ほか ${result.failures.length - 80} 件`)
      continue
    }
    console.log(
      `✓ ${result.run.label}: ${result.checked} 通り（${result.urls} URL × ${shape}${poses}）。` +
        `横のはみ出し 0・切られた要素 0・h1 はどれも1つ・一番下まで送っても目次が見え、送った先は帯の下。` +
        `いちばん長いページ ${result.longest.tall}px（${result.longest.where}）。` +
        `見出しの錨のずれ 最大 ${result.drift}px。` +
        `目次の印 ${result.toc.checked} ページが帯の中（うち ${result.toc.scrolled} ページは送って開いた）。` +
        `/all は ${result.whole.checked} 通りとも横に動かない`,
    )
  }

  if (failed > 0) {
    console.error(
      '\n横のはみ出し・切られた要素・柱の場所・貼り付けが出たら、app.css の「ページの外枠」が効いていない（後ろで上書きされた・条件が外れた）か、部品の幅の決め方（min-width: 0・長い1語）を疑う。' +
        '\n送った先が帯の下に隠れたら、:root の --band-clear / --band-clear-wide（帯の高さ）と html の scroll-padding-top を見る。' +
        '\n見出しの錨がずれたら、節の寄せ方（app.css の align-content: safe start）か、見出しより前に置いた子を疑う。' +
        '\n目次の印が帯の外なら app.css の scroll-initial-target（帯の姿の2か所）と、帯がスクロール容器か（overflow-x: auto）を見る。' +
        '\n目次の的が --tap に合わなければ @media (pointer: coarse)、中央の軸がずれたら中央寄せの Hero の子の寄せ方、' +
        '/all が横に動いたら目次の折り返し（flex-wrap）を見る。',
    )
    process.exitCode = 1
  }
}

await main()
