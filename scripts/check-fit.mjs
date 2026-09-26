/*
  「公開ページはスクロールしない」を、実際にブラウザで測る。

  この不変条件はこの機能の名前そのものなのに、確かめる手段がリポジトリに
  1つも無かった。typecheck も lint も vitest も寸法を測らない——vitest は
  workerd の上で動くので、そもそも版面を組むエンジンが居ない。残っていたのは
  「9通りを手で開く」という手順だけで、1回目は実行されるが2回目は
  「今回は件数を1つ増やしただけだから」で飛ばされる。

  だから測るほうを1つのコマンドにする。`npm run check:fit`。

  ## 何を測るか

  **幾何で測る。** 以前は「ページが動くか」を scrollingElement の
  scrollHeight − clientHeight で見ていた。html と body は overflow: clip なので、
  外枠（.shell の高さ）や弁（節の overflow: auto）が外れて中身が画面の下へ
  はみ出しても、clip の下では scrollHeight が伸びないことがあり、切り取られた
  ぶんを 0px と報告した（CSS を差し替えて再現した: 画面の外に 14px 出ていて 0）。
  切り取られた中身はスクロールでもフォーカスでも届かない——CLAUDE.md がいちばん
  恐れている壊れ方が、番人から見えなかった。いまは箱の位置そのものを見る。

    (1) 外枠        .shell の下端 ≤ 画面の高さ、.shell の高さ = 画面の高さ
    (2) 切り取り    main と柱（.rail）の見えている子孫の下端 ≤ 画面の高さ
                    （弁が開いた節の中身は除く。そちらは (3) で数える）
    (3) 弁          節ごとに scrollHeight ≤ clientHeight
    (4) 効いているか 計算済みのスタイルで、html と body の overflow が clip、
                    節の overflow-y が auto、柱が骨格どおりの場所（柱が左に立つ骨格は
                    本文の左、ほかは本文の上）に居ること
    (5) 見出しの錨   同じ骨格・書体・寸法・姿の中で、節の見出しの上端の y

  (4) は test/theme.test.ts が CSS を文字列で読んで見ている決まりの、実際に効いた
  姿。文字列の検査は「その規則が書いてあるか」しか見られず、後ろで別のセレクタに
  上書きされても（外枠の @supports の末尾に `.shell { height: auto }` を足しても）
  緑のままだった。ここはブラウザが解いた結果を見るので、書き方に左右されない。

  (5) は「めくっても見出しが跳ねない」。割られた画面の節は上揃えで、見出しは
  どの画面でも同じ高さから始まる（app.css の「画面に収める外枠」）。上下中央に
  寄せていたころは、見出しの高さが中身の量で決まり、/projects 91px →
  /projects/2 124px → /projects/4 243px と跳ねていた（= rail @390x844）。
  比べないのは Hero（入口・個人ページの1枚目）と月の節（Contact）——どちらも
  見出しで始まる画面ではなく、名乗り・誘いを中央や下に置く構図そのもの。
  作品のページ（1枚目と本文の画面 Story）は「← 一覧に戻る」が見出しの上に立つので、
  その札の上端で比べる（見出しより前に何かがある画面は、節の最初の子の上端が錨）。

  1px までは許す。連動する文字の段は clamp() で決まるので、幅しだいで端数が出る。

  成功行の「いちばん惜しい」は、節の余り（中身を置ける高さ − 中身の高さ）の最小。
  以前は「開いた弁のうち最大」を出していて、開いた弁は失敗なので、合格したときは
  いつも 0px だった——余裕がどれだけ残っているかは一度も出なかった。

  ## 何の中身で測るか

  3つの中身を、それぞれ使い捨ての D1 に入れて測る（手元の D1 には触らない）。

    seed               seed.sql。本人のサイトそのもの（1人・打ち込むブロック無し）
    fixture（複数人）  scripts/lib/fit-fixture.mjs が src/blocks.ts の上限から作る、
                       上限ちょうどの複数人のサイト（打ち込むブロック6種 × 2形・
                       6人の Team・長い肩書き・上限の大見出し・紹介文・経歴・
                       いちばん重いカードの行・本文の画面）
    fixture（1人）     同じ中身で公開中のメンバーを1人にしたもの。Team の位置に
                       プロフィールが入り、柱が名前と長い職種で名乗る姿

  seed だけを測っていたころは、打ち込むブロックも 3人以上の Team も本文の画面も
  一度も測られておらず、src/blocks.ts の maxChars は手で測った数のまま守られて
  いなかった。字の段や余白を動かす変更が来ても、検査はその姿を見ないまま緑を出した。

  どちらの中身も、訪問者の姿とログインした姿（柱に「管理画面」の入口が出る）の
  両方で測る。ログインした姿は、セッションを使い捨ての D1 に直接作り、クッキーを
  渡して開く（OAuth は通らない）。

  骨格と書体は body の data-layout / data-typeface を差し替えて見る（下の measure）。
  寸法3 × 骨格3 × 書体3 = 27通りを、URL ごと・姿ごとに。

  `npm test` とは分けてある。あちらは workerd の中で D1 と KV ごと動かす場所で、
  こちらは本物の版面が要る。混ぜると、片方のために片方の実行環境を曲げることになる。

  ## 手元の dev を測る・絞る

  FIT_ONLY=seed,many,solo で測る中身を絞れる（CI は絞らない）。

  FIT_BASE を渡すと、そこに立っている dev サーバをそのまま測る（中身はその D1 の
  まま・訪問者の姿だけ。セッションを作れないので）。FIT_PORT は自分で立てるときの
  ポート（2つの中身を同じポートで順に立てる）。
*/

import { createHash, randomBytes } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import process from 'node:process'
import { chromium } from 'playwright'
import { devServer, ROOT, scratchState } from './lib/dev-server.mjs'
import { fixture } from './lib/fit-fixture.mjs'
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
  柱が本文の左に立つ骨格と、その幅。ほかの骨格・幅では柱は本文の上の帯になる。
  app.css の「画面に収める外枠」の 900 以上（rail だけが .shell を1段にする）と同じ。
*/
const BESIDE = { rail: 900 }

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

  手で並べた表を持つと、画面を1つ足した日にこちらだけ古くなる——しかも
  古くなったことは緑のまま分からない。sitemap は公開ページと同じ式
  （siteSteps / memberScreens / itemHref / itemStoryHref）から数え上げているので、
  新しい連なりを足せばこの検査の対象も自動で増える。

  **少なすぎたら止める。** ここが無いと、この検査は黙って空振りする——D1 が空なら
  画面がほとんど生えず、それでも1本ずつは 200 で返るので「✓」で終わる。
  seed は 17 本（1人のサイトでは /team がプロフィールへの 301 で sitemap から外れる）、
  fixture は作った中身から必ず生える URL（fit-fixture.mjs の expect）を1本ずつ
  突き合わせる。本当に画面を減らしたなら、この数も一緒に下げること——その変更が
  diff に出ることに意味がある。
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
      `${run.label}: 中身から生えるはずの画面が sitemap に無い: ${missing.join(', ')}。` +
        '測ったつもりで、その画面は測られない',
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
*/
const measure = ([layout, typeface, cfg]) => {
  document.body.dataset.layout = layout
  document.body.dataset.typeface = typeface

  const height = innerHeight
  const slack = cfg.slack
  const problems = []
  const round = (n) => Math.round(n * 10) / 10
  const nameOf = (el) =>
    el.id
      ? `#${el.id}`
      : `${el.tagName.toLowerCase()}${el.classList.length ? `.${[...el.classList].join('.')}` : ''}`

  // (4) 外側は clip。hidden は「見えないだけのスクロール箱」、visible は伸びるページ
  for (const el of [document.documentElement, document.body]) {
    const style = getComputedStyle(el)
    if (style.overflowX !== 'clip' || style.overflowY !== 'clip') {
      problems.push(
        `${el.tagName.toLowerCase()} の overflow が ${style.overflowX} / ${style.overflowY}（clip のはず）`,
      )
    }
  }

  // (1) 外枠
  const shell = document.querySelector('.shell')
  const main = document.querySelector('main')
  const rail = document.querySelector('.rail')
  if (!shell || !main || !rail) {
    return { problems: ['.shell / main / .rail のどれかが無い'], panels: [], anchor: null, page: 0 }
  }
  const frame = shell.getBoundingClientRect()
  if (Math.abs(frame.height - height) > slack) {
    problems.push(`.shell の高さが ${round(frame.height)}px（画面は ${height}px）`)
  }
  if (frame.bottom > height + slack) problems.push(`.shell の下端が ${round(frame.bottom)}px`)

  // (4) 柱の場所。骨格どおりに解けているか
  const railBox = rail.getBoundingClientRect()
  const mainBox = main.getBoundingClientRect()
  const beside = cfg.beside[layout] !== undefined && innerWidth >= cfg.beside[layout]
  if (beside ? railBox.right > mainBox.left + slack : railBox.bottom > mainBox.top + slack) {
    problems.push(
      `柱が本文の${beside ? '左' : '上'}に居ない（柱 ${round(railBox.bottom)} / 本文 ${round(mainBox.top)}）`,
    )
  }

  // (3) 弁と、節の余り
  const boxes = [...document.querySelectorAll(cfg.panels)]
  const panels = boxes.map((box) => {
    const style = getComputedStyle(box)
    if (style.overflowY !== 'auto')
      problems.push(`節 ${nameOf(box)} の overflow-y が ${style.overflowY}（auto のはず）`)
    const over = Math.max(0, box.scrollHeight - box.clientHeight)
    /*
      余り。中身を置ける高さ（clientHeight − 上下の padding）から、流れに乗った子の
      外形（margin 込み）の上端〜下端を引く。絶対配置の子（月）は数えない
    */
    const kids = [...box.children].filter((kid) => {
      const kidStyle = getComputedStyle(kid)
      return kidStyle.position !== 'absolute' && kidStyle.display !== 'none'
    })
    let free = null
    if (kids.length) {
      const top = Math.min(
        ...kids.map(
          (kid) => kid.getBoundingClientRect().top - parseFloat(getComputedStyle(kid).marginTop),
        ),
      )
      const bottom = Math.max(
        ...kids.map(
          (kid) =>
            kid.getBoundingClientRect().bottom + parseFloat(getComputedStyle(kid).marginBottom),
        ),
      )
      const inner =
        box.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom)
      free = round(inner - (bottom - top))
    }
    return { box, name: nameOf(box), over, free }
  })

  // (2) 切り取り。弁の開いた節の中は (3) が数えるので除く
  const open = panels.filter((panel) => panel.over > slack).map((panel) => panel.box)
  const strays = []
  for (const el of [...rail.querySelectorAll('*'), ...main.querySelectorAll('*')]) {
    if (open.some((box) => box.contains(el))) continue
    const rect = el.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) continue
    if (rect.bottom <= height + slack) continue
    if (getComputedStyle(el).visibility === 'hidden') continue
    strays.push(`${nameOf(el)} ${round(rect.bottom)}px`)
  }
  if (strays.length) {
    problems.push(
      `画面の外（下端 ${height}px より下）で切られている: ${strays.slice(0, 3).join(', ')}${strays.length > 3 ? ` ほか ${strays.length - 3}` : ''}`,
    )
  }

  // 以前の測り方も残す。標準モードでは scrollingElement が html で、動けば出る
  const scroller = document.scrollingElement ?? document.documentElement
  const page = Math.max(0, scroller.scrollHeight - scroller.clientHeight)
  if (page > slack) problems.push(`ページが ${page}px 動く`)

  /*
    (5) 錨の y。節の最初の h1 の上端——ただし h1 より前に別の子（作品のページの
    「← 一覧に戻る」）が立つ画面では、その最初の子の上端。絶対配置の子
    （月）と display: none の子は並びに数えない。
  */
  const anchored = document.querySelector(cfg.anchored)
  let anchor = null
  if (anchored) {
    const kids = [...anchored.children].filter((kid) => {
      const style = getComputedStyle(kid)
      return style.position !== 'absolute' && style.display !== 'none'
    })
    const heading = anchored.querySelector('h1')
    const first = kids[0]
    const leader = first && heading && !first.contains(heading) ? first : (heading ?? first)
    anchor = leader ? round(leader.getBoundingClientRect().top) : null
  }

  return {
    problems,
    panels: panels.map(({ name, over, free }) => ({ name, over, free })),
    anchor,
    page,
  }
}

/*
  1つの中身（seed か fixture）を測る。base に立っているサーバの sitemap の全 URL を、
  寸法3 × 姿（訪問者・ログイン）× 骨格3 × 書体3 で。
*/
async function measureRun(browser, base, run, layouts, typefaces) {
  const failures = []
  const anchors = new Map()
  let checked = 0
  let closest = { free: Number.POSITIVE_INFINITY, where: '' }

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
              { slack: SLACK, panels: PANELS, anchored: ANCHORED, beside: BESIDE },
            ])
            checked += 1
            const label = `${layout}/${typeface} ${where} ${path}`
            if (found.anchor !== null) {
              const key = `${layout}/${typeface} ${where}`
              if (!anchors.has(key)) anchors.set(key, [])
              anchors.get(key).push({ path, y: found.anchor })
            }
            if (found.panels.length === 0) {
              failures.push(`${label} — 節が1つも無い（${PANELS} に当たらない）`)
            }
            for (const problem of found.problems) failures.push(`${label} — ${problem}`)
            for (const panel of found.panels) {
              if (panel.over > SLACK) {
                failures.push(`${label} — 節「${panel.name}」の弁が ${panel.over}px 開く`)
              } else if (panel.free !== null && panel.free < -SLACK) {
                // scrollHeight は整数に丸まる。余りは小数のまま測るので、こちらで拾う
                failures.push(`${label} — 節「${panel.name}」の中身が ${-panel.free}px はみ出す`)
              }
              if (panel.free !== null && panel.free < closest.free) {
                closest = { free: panel.free, where: label }
              }
            }
          }
        }
      }
      await context.close()
    }
  }

  /*
    見出しの錨。同じ骨格・書体・寸法・姿の中で、いちばん上といちばん下の差が
    SLACK を超えたら、外れた画面を名指しする（多数派の y から離れているもの）。
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
        `${key} ${one.path} — 見出しの錨が ${one.y}px（ほかの画面は ${usual}px）。めくると見出しが跳ねる`,
      )
    }
    // 多数派から 1px ずつずれて並んだ（どれも名指しできない）ときも、差そのもので落とす
    if (strays.length === 0) {
      failures.push(`${key} — 見出しの錨が ${Math.min(...ys)}〜${Math.max(...ys)}px に散っている`)
    }
  }

  return {
    failures,
    checked,
    urls: paths.length,
    poses: poses.length,
    closest,
    drift: Math.round(worstDrift * 10) / 10,
  }
}

async function main() {
  const layouts = keysOf('LAYOUTS')
  const typefaces = keysOf('TYPEFACES')
  const port = Number(process.env.FIT_PORT ?? 8788)

  const many = fixture()
  const solo = fixture({ solo: true })
  const runs = process.env.FIT_BASE
    ? [{ label: '指定の先', base: process.env.FIT_BASE, least: 5 }]
    : [
        {
          key: 'seed',
          label: 'seed（1人のサイト）',
          sql: [await readFile(`${ROOT}seed.sql`, 'utf8')],
          least: 17,
        },
        {
          key: 'many',
          label: 'fixture（複数人・上限ちょうど）',
          sql: [many.sql],
          least: many.expect.length,
          expect: many.expect,
        },
        {
          key: 'solo',
          label: 'fixture（1人・上限ちょうど）',
          sql: [solo.sql],
          least: solo.expect.length,
          expect: solo.expect,
        },
      ]

  // FIT_ONLY=seed,solo のように、測る中身を絞れる（手元で直しながら回すとき用。CI は全部）
  const only = process.env.FIT_ONLY?.split(',')
  const chosen = only ? runs.filter((run) => only.includes(run.key)) : runs
  if (chosen.length === 0)
    throw new Error(`FIT_ONLY=${process.env.FIT_ONLY} に当たる中身が無い（seed / many / solo）`)

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
        `ページが動いた画面 0・切られた要素 0・弁が開いた節 0。` +
        `いちばん惜しい節の余り ${result.closest.free}px（${result.closest.where}）。` +
        `見出しの錨のずれ 最大 ${result.drift}px`,
    )
  }

  if (failed > 0) {
    console.error(
      '\n設計サイズで弁が開いたら、それは弁の不具合ではなく src/blocks.ts の perScreen / maxChars の不具合。まず件数と字数を疑う。' +
        '\n切られた要素・外枠・柱の場所が出たら、app.css の「画面に収める外枠」が効いていない（後ろで上書きされた・条件が外れた）。' +
        '\n見出しの錨がずれたら、節の寄せ方（app.css の align-content: safe start）か、見出しより前に置いた子を疑う。',
    )
    process.exitCode = 1
  }
}

await main()
