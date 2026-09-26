import css from 'virtual:app-css'
import { beforeEach, describe, expect, it } from 'vitest'
import { blockType } from '../src/blocks'
import * as schema from '../src/db/schema'
import { ACCENTS, LAYOUTS, TYPEFACES } from '../src/theme'
import { db, form, get, resetDb, seedItem, seedMember, signIn } from './helpers'

beforeEach(resetDb)

const save = async (values: Record<string, string>) => {
  const signed = await signIn()
  return signed('/admin/appearance', { method: 'POST', body: form(values) })
}

const MAGAZINE = { layout: 'magazine', accent: 'ember', typeface: 'serif' }

describe('見た目のプリセット', () => {
  it('何も選んでいなければ既定の姿で出す', async () => {
    const html = await (await get('/')).text()
    expect(html).toContain('data-layout="rail"')
    expect(html).toContain('data-accent="iris"')
    expect(html).toContain('data-typeface="sans"')
  })

  it('選んだものが公開ページに出る', async () => {
    const response = await save(MAGAZINE)
    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe('/admin/appearance?saved=1')

    const html = await (await get('/')).text()
    expect(html).toContain('data-layout="magazine"')
    expect(html).toContain('data-accent="ember"')
    expect(html).toContain('data-typeface="serif"')
  })

  it('個人ページも同じ姿になる', async () => {
    await seedMember()
    await save(MAGAZINE)

    const html = await (await get('/members/okazaki')).text()
    expect(html).toContain('data-layout="magazine"')
  })

  it('二度保存しても行が増えない', async () => {
    await save(MAGAZINE)
    await save({ layout: 'center', accent: 'mint', typeface: 'mono' })

    const rows = await db().select().from(schema.settings)
    expect(rows).toHaveLength(3)
    expect(await (await get('/')).text()).toContain('data-layout="center"')
  })

  it('知らない値は保存しない', async () => {
    const response = await save({ layout: 'chaos', accent: 'ember', typeface: 'serif' })
    expect(response.status).toBe(400)

    // 1つでも知らなければ、まとめて受け取らない
    const html = await (await get('/')).text()
    expect(html).toContain('data-layout="rail"')
    expect(html).toContain('data-accent="iris"')
  })

  it('DB に知らない値が入っていても既定に戻して描く', async () => {
    // プリセットを1つ減らした後の、選んだままのサイトを想定する
    await db().insert(schema.settings).values({ key: 'theme.layout', value: '消えた骨格' })

    const response = await get('/')
    expect(response.status).toBe(200)
    expect(await response.text()).toContain('data-layout="rail"')
  })

  it('ログインしていなければ見た目を変えられない', async () => {
    const response = await get('/admin/appearance', { method: 'POST', body: form(MAGAZINE) })
    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe('/admin/login')

    expect(await (await get('/')).text()).toContain('data-layout="rail"')
  })

  it('選べるものだけを並べ、いま選んでいるものに印を付ける', async () => {
    await save(MAGAZINE)
    const signed = await signIn()
    const html = await (await signed('/admin/appearance')).text()

    expect(html).toContain('value="magazine" checked=""')
    expect(html).toContain('value="ember" checked=""')
    // 見本は全種類ぶん出るので、data-typeface を見ても選択中は分からない
    expect(html).toContain('value="serif" checked=""')
    expect(html).not.toContain('value="sans" checked=""')
  })
})

/*
  コメントを落とした写し。CSS を見る検査は、生の css ではなくこちらを読む。

  ここの検査は CSS を文字列として探すので、規則の書き方を説明したコメントを
  規則そのものと取り違える。実際に3つが当たっていた。切り出しの起点が
  「そこは丸ごと @supports (height: 100svh) の内側にある」という :root の
  コメントに当たり、'overflow: clip' が弁のコメント（「外側の html と body は
  overflow: clip なので」）に当たり、'100svh' も :root のコメントに当たって
  いた。どれも、指している規則を丸ごと消しても緑のままだった。

  app.css は WHY を実測値つきで厚く書くのが決まりなので、放っておけば必ず
  また起きる。切り出す前に必ず通し、検査もこの写しに当てること。
*/
const bare = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, '')

/* 検査はこの写しを読む。生の css を読むのは「読めているか」の1つだけ */
const sheet = bare(css)

/*
  選択肢は src/theme.ts が正だが、実際に姿を変えるのは app.css。
  片方だけ足すと、選べるのに何も変わらない選択肢ができる。
*/
describe('プリセットと CSS', () => {
  it('CSS を読めている（読めていないと、以下の検査が素通りする）', () => {
    expect(css.length).toBeGreaterThan(1000)
  })

  it('骨格には body[data-layout] の指定がある', () => {
    for (const layout of LAYOUTS) {
      if (layout.key === 'rail') continue // 既定。素の指定がそのまま骨格になる
      expect(sheet).toContain(`body[data-layout='${layout.key}']`)
    }
  })

  it('アクセント色と書体には [data-accent] / [data-typeface] の指定がある', () => {
    for (const accent of ACCENTS) expect(sheet).toContain(`[data-accent='${accent.key}']`)
    for (const typeface of TYPEFACES) expect(sheet).toContain(`[data-typeface='${typeface.key}']`)
  })
})

/*
  marker で始まる括り（@supports や @media）を、対応する閉じ括弧まで切り出す。
  「どこかに書いてある」ではなく「この括りの中に書いてある」を見るため。
  外枠の指定は、同じ1行でも括りの外にあると意味が変わる。
*/
const blockAt = (raw: string, marker: string) => {
  const source = bare(raw)
  const start = source.indexOf(marker)
  expect(start, `${marker} が見つからない`).toBeGreaterThan(-1)

  let depth = 0
  for (let i = source.indexOf('{', start); i < source.length; i += 1) {
    if (source[i] === '{') depth += 1
    if (source[i] === '}') {
      depth -= 1
      if (depth === 0) return source.slice(start, i + 1)
    }
  }
  throw new Error(`${marker} の括りが閉じていない`)
}

/*
  宣言を1つ指して、それが書いてある規則をセレクタごと切り出す。

  blockAt と違って「どこかに書いてある」では足りない場所のため。節には
  同じセレクタの規則が2つ（中身の寄せ方と、溢れの弁）あり、弁だけを
  別の相手に付け替えられると、寄るのに弁の無い節ができる。
*/
const ruleWith = (raw: string, decl: string) => {
  const source = bare(raw)
  const at = source.indexOf(decl)
  expect(at, `${decl} が見つからない`).toBeGreaterThan(-1)

  const open = source.lastIndexOf('{', at)
  // 直前の規則の閉じ括弧か、括りの開き括弧。近いほうが自分のセレクタの頭
  const head = Math.max(source.lastIndexOf('}', open), source.lastIndexOf('{', open - 1))
  const selector = source.slice(head, open)
  return {
    // 切り出しの頭に残る直前の規則の '}' や、括りの '{' を落とす
    selector: selector.replace(/^[{}\s]+/, '').trim(),
    body: source.slice(open + 1, source.indexOf('}', at)).trim(),
  }
}

/*
  ruleWith の逆向き。セレクタを指して、その規則に何が書いてあるかを見る。
  「この1本に4行そろっているか」を確かめたいときのため——2行だけ写して
  持ってきた、という壊れ方は宣言の存在だけでは捕まらない。
*/
const bodyOf = (raw: string, selector: string) => {
  const source = bare(raw)
  const at = source.indexOf(selector)
  expect(at, `${selector} が見つからない`).toBeGreaterThan(-1)

  const open = source.indexOf('{', at)
  return source.slice(open + 1, source.indexOf('}', open)).trim()
}

/*
  「1画面に収める・ページは動かさない」という作りは app.css にしかない。
  骨格の1行が消えても TypeScript は黙っているし、描いた HTML も変わらない。
  出るのは「中身は全部あるのに下が読めないページ」だけで、それに気付ける
  場所がここしかない。だから値ではなく規則の存在そのものを見張る。
*/
describe('画面に収める外枠', () => {
  it('画面1つぶんの高さを :root で持つ', () => {
    // 道具の帯の出入りで伸び縮みしない svh で測る。
    // 値そのものを見る（'100svh' がどこかにある、では @supports の条件に当たる）
    expect(sheet).toContain('--screen-h: calc(100svh')
    /*
      100vh の控えは置かない。--screen-h を読むのは @supports (height: 100svh)
      の内側1か所だけで、svh を知らない環境ではその節ごと効かない。控えを
      書いても一度も読まれないので、起こり得ない機序の説明が1つ残るだけになる
    */
    expect(sheet).not.toContain('--screen-h: 100vh')
  })

  it('画面の高さを実際に読むのは .shell。この1行が外枠の要', () => {
    /*
      app.css 全体で --screen-h は2回しか出てこない。:root の宣言と、この参照。
      消しても TypeScript も lint も HTML も変わらないのに、公開ページの全画面が
      一度に壊れる。しかも壊れ方は「縦に伸びるページに戻る」ではない——html と
      body の overflow: clip はそのまま残るので、画面から溢れたぶんが静かに
      切り取られ、スクロールでもフォーカス移動でも届かなくなる。
      だから「:root にある」ではなく「.shell が読んでいる」を見る。
    */
    const frame = blockAt(sheet, '@supports (height: 100svh)')
    const screen = ruleWith(frame, 'height: var(--screen-h)')

    expect(screen.selector).toContain('.shell')
    // 全体ページ（/all）は外枠の外。ここを外すと /all も1画面に切られる
    expect(screen.selector).toContain(':not([data-whole])')
    /*
      1段目が柱、2段目が本文。2段目は minmax(0, 1fr) で、素の 1fr ではない。
      1fr の最小は auto（＝中身の高さ）なので、本文の行が中身ぶんまで膨らんで
      高さを固定した .shell の外へ出る。外へ出たぶんは clip で切られる
    */
    expect(screen.body).toContain('grid-template-rows: auto minmax(0, 1fr)')
  })

  it('main を2段にして、本文に残りの高さを渡す', () => {
    /*
      1段目が節、2段目がページャ。2段目を auto にしてあるので、ページャは
      いつも画面の底に座り、めくっても位置が動かない。
      main が flex 縦積みのままだと、節もページャも中身の高さのまま積まれ、
      .shell の2段目からはみ出す（はみ出したぶんは clip で切られる）。
    */
    const frame = blockAt(sheet, '@supports (height: 100svh)')
    const box = bodyOf(frame, ':where(body[data-layout]:not([data-whole])) main {')

    expect(box).toContain('display: grid')
    expect(box).toContain('grid-template-rows: minmax(0, 1fr) auto')
  })

  it('高さの足りない箱が、中身の高さのまま居座らないようにする', () => {
    /*
      grid の子の min-height の初期値 auto は「中身より小さくならない」。
      行を minmax(0, 1fr) で縮められるようにしても、子（main と節）自身が
      中身の高さを保ってトラックからはみ出す。0 を書いて初めて、溢れが
      弁（節の overflow: auto）へ回り、切り取られずに読めるようになる。
      main と節の両方に要る。片方だけだと、そちらで止まって同じことが起きる。
    */
    const frame = blockAt(sheet, '@supports (height: 100svh)')

    expect(bodyOf(frame, ':where(body[data-layout]:not([data-whole])) main {')).toContain(
      'min-height: 0',
    )
    expect(ruleWith(frame, 'align-content: safe start').body).toContain('min-height: 0')
  })

  it('節は grid。flex のままだと寄せ方が黙って効かなくなる', () => {
    /*
      この1行が落ちると、すぐ下の align-content（節は上揃え、Hero は中央か下）が
      黙って効かなくなる。.hero は素で display: flex + flex-direction: column
      ——縦並びの flex では交差軸が横なので、align-content は上下ではなく左右を
      動かす指定に変わり、入口の字は画面の上端から積まれたまま残る。節（素は
      display: block）で上下に効くかどうかはブラウザしだいで、そこも当てにできない。
      エラーも溢れも出ないので、気づく手がかりは「なんとなく上に寄っている」だけ。
    */
    const frame = blockAt(sheet, '@supports (height: 100svh)')
    const panel = ruleWith(frame, 'align-content: safe start')

    expect(panel.body).toContain('display: grid')
    expect(panel.selector).toContain('main > :is(.hero, section)')
  })

  it('カードの説明を止める行数を :root で持ち、カードがそれを読む', () => {
    // 高さが一定でないと、1画面に何件置けるかをサーバー側で決められない
    expect(sheet).toContain('--card-lines:')
    expect(sheet).toContain('line-clamp: var(--card-lines)')
  })

  it('600 以上は説明の上限が切れない行数。画像の枠のあるカードだけ 900 以上で減らす', () => {
    /*
      2行で止めていたころは「何であるか。何をしたか。」の2文目がカードから
      ほぼ読めなかった。600 以上は 100 字が切れずに出る行数へ上げる（768 の
      rail で和文 100 字が6行）。数は :root で持ち、メディアクエリの中の :root で
      差し替える——セレクタに行数を書くと、:root を読んでも行数が分からない
    */
    const lines = (block: string, name: string) =>
      Number(bodyOf(block, ':root {').match(new RegExp(`${name}:\\s*(\\d+)`))?.[1])
    const narrow = lines(sheet, '--card-lines')
    const wide = lines(blockAt(sheet, '@media (min-width: 600px)'), '--card-lines')
    expect(narrow).toBe(2)
    expect(wide).toBeGreaterThan(narrow)

    /*
      画像の枠は 1440x900 で説明の3〜4行ぶんを食う。枠のある行だけ 900 以上で
      減らす。600 未満では枠が出ないので、素では同じ数（var() で追う）
    */
    expect(bodyOf(sheet, ':root {')).toContain('--card-lines-shot: var(--card-lines)')
    const shot = lines(blockAt(sheet, '@media (min-width: 900px)'), '--card-lines-shot')
    expect(shot).toBeGreaterThanOrEqual(narrow)
    expect(shot).toBeLessThan(wide)
    const frame = blockAt(sheet, '@supports (height: 100svh)')
    const framed = bodyOf(frame, ':where(body[data-layout]:not([data-whole])) .card__thumb ~ p {')
    expect(framed.match(/line-clamp: var\(--card-lines-shot\)/g)).toHaveLength(2)
  })

  it('行止めは5行そろって初めて効く', () => {
    /*
      行止めは1つの宣言ではなく5行ひとそろい。display: -webkit-box と
      -webkit-box-orient: vertical と overflow: hidden がそろって初めて切る。
      1行でも欠けると切らなくなるが、CSS は何も言わない。出るのは「説明が
      3行のカードと2行のカード」——カードの高さが中身しだいになる。すると
      1画面に何件置けるかを決めている src/blocks.ts の perScreen が実物と
      合わなくなり、設計サイズでも弁が開く。

      前置きの有無で2本あるのは、同じ値を新旧の名前で書いているため。片方を
      落とすと、その名前しか読まないブラウザで切れなくなる。toContain では
      見分けられない（-webkit- 付きの文字列が素の名前を丸ごと含む）ので数える。
    */
    const frame = blockAt(sheet, '@supports (height: 100svh)')
    const clamp = bodyOf(frame, ':where(body[data-layout]:not([data-whole])) .card p {')

    expect(clamp).toContain('display: -webkit-box')
    expect(clamp).toContain('-webkit-box-orient: vertical')
    expect(clamp.match(/line-clamp: var\(--card-lines\)/g)).toHaveLength(2)
    expect(clamp).toContain('overflow: hidden')
  })

  it('骨格ひとそろいを @supports で括ってある', () => {
    // 括り忘れると、svh の無い環境で高さだけ auto に落ちて overflow だけが残る
    expect(sheet).toContain('@supports (height: 100svh)')
  })

  it('スクロール箱を作らず clip で切り、全体ページは対象から外す', () => {
    // hidden は「見えないだけのスクロール箱」。滑った先から戻す手段が無くなる
    const frame = blockAt(sheet, '@supports (height: 100svh)')
    const outer = ruleWith(frame, 'overflow: clip')

    // 当てる先は html と body の両方。片方だけでは、もう片方が動く
    expect(outer.selector).toContain('html:has(> body[data-layout]')
    expect(outer.selector).toContain(':where(body[data-layout]')
    expect(outer.selector).toContain(':not([data-whole])')
  })

  it('割られた画面の節は上揃え。めくっても見出しが跳ねない', () => {
    /*
      上下中央に寄せていたころは、見出しの高さが中身の量で決まり、めくるたびに
      跳ねていた（/projects 91px → /projects/2 124px → /projects/4 243px =
      rail @390x844）。節は上端から置き、見出しを錨にする。そろっていることは
      npm run check:fit が画素で測る（同じ骨格・寸法の中で 1px 以内）
    */
    const frame = blockAt(sheet, '@supports (height: 100svh)')
    const panels = ':where(body[data-layout]:not([data-whole])) main > '
    expect(bodyOf(frame, `${panels}:is(.hero, section) {`)).toContain('align-content: safe start')

    /*
      Hero と月の節は錨を持たない構図。月の無い Hero（個人ページの1枚目）は中央、
      月のある入口と締めの Contact は下。上揃えの規則より後ろに置いて上書きする
      （同じ強さなので、順番が逆だと全部が上揃えになる）
    */
    expect(bodyOf(frame, `${panels}.hero {`)).toContain('align-content: safe center')
    expect(bodyOf(frame, `${panels}.hero:has(> .moon) {`)).toContain('align-content: safe end')
    expect(bodyOf(frame, `${panels}.moonlit {`)).toContain('align-content: safe end')
    const order = [
      `${panels}:is(.hero, section) {`,
      `${panels}.hero {`,
      `${panels}.hero:has(> .moon) {`,
    ].map((selector) => frame.indexOf(selector))
    expect(order).toEqual([...order].sort((a, b) => a - b))

    // 外枠のどの寄せ方にも safe を付ける。素の center / end は、中身が容器を超えた
    // 瞬間に上端を容器の外へ押し出し、ページ自体が動かないので二度と読めない
    expect(frame).not.toMatch(/align-content: (center|end|start)/)
    expect(sheet).not.toContain('align-content: center')
  })

  it('900 以上（2列）では .shell を1段にする', () => {
    // 2列になると柱も本文も1行目に入る。1列ぶんの 'auto + 1fr' のままだと
    // 2行目の 1fr が画面の残りを丸ごと取り、本文は柱の高さで止まって
    // 下が黒く空く。中身が増えても伸びないので、そのぶんは黙って切れる
    const wide = blockAt(blockAt(sheet, '@supports (height: 100svh)'), '@media (min-width: 900px)')
    expect(wide).toContain('grid-template-rows: minmax(0, 1fr)')
  })

  it('900 以上でも1列のままの骨格には、2段を残す', () => {
    // 中央寄せと雑誌風は広い画面でも柱を左に立てない。列を1つに戻す指定と
    // この2段は対。片方だけ直すと、その骨格でだけまた下が空く
    const wide = blockAt(blockAt(sheet, '@supports (height: 100svh)'), '@media (min-width: 900px)')
    for (const layout of ['center', 'magazine']) {
      expect(sheet).toContain(`body[data-layout='${layout}'] .shell`)
      expect(wide).toContain(`body[data-layout='${layout}']`)
    }
    expect(wide).toContain('grid-template-rows: auto minmax(0, 1fr)')
  })

  it('溢れたら弁が開く。hidden でも clip でもなく auto', () => {
    // 画面を増やしても収まらない中身は、隠さず・縮めず・ページを動かさずに
    // パネルの中だけで動かす。hidden や clip にすると、文字を拡大しただけで
    // たどれない部分ができる（WCAG 1.4.4 / 1.4.10）
    const frame = blockAt(sheet, '@supports (height: 100svh)')
    const valve = ruleWith(frame, 'overscroll-behavior: contain')

    expect(valve.body).toContain('overflow: auto')
    // 外側の html と body は overflow: clip。勢いが外へ抜けると戻す手段が無い
    expect(valve.body).toContain('overscroll-behavior: contain')
    // 弁が開いた瞬間に幅が縮むと折り返しが変わり、また溢れる、を繰り返す
    expect(valve.body).toContain('scrollbar-gutter: stable')
  })

  it('弁の付け先は、中身を寄せる相手と同じパネル', () => {
    // クラスを列挙して本文の箱だけに付けると、これから足すブロックが必ず漏れる。
    // 漏れた節は「寄るのに弁が無い節」になり、溢れたぶんが静かに切り取られる
    const frame = blockAt(sheet, '@supports (height: 100svh)')

    expect(ruleWith(frame, 'overscroll-behavior: contain').selector).toBe(
      ruleWith(frame, 'align-content: safe start').selector,
    )
    expect(ruleWith(frame, 'overscroll-behavior: contain').selector).toContain(
      'main > :is(.hero, section)',
    )
  })

  it('弁より先に潰れさせない', () => {
    // 高さの足りない箱の中で flex の子が中身より小さく潰れると、そのぶんは
    // scrollHeight に出ない。弁は開かないまま段落だけが重なる——切り取りより悪い
    const frame = blockAt(sheet, '@supports (height: 100svh)')

    expect(ruleWith(frame, 'flex: 0 0 auto').selector).toContain('main > * > *')
  })

  it('[hidden] の打ち消しを持つ', () => {
    // 節に display を与えるので、打ち消さないと hidden を付けた節が見えてしまう
    expect(sheet).toContain(':is(.hero, section)[hidden]')
  })

  it('狭い画面では、柱だけでなく名札の中身も横帯にする', () => {
    // 柱を横に寝かせるだけでは足りない。名札の中身が縦積みのままだと帯が
    // 何段にも伸び、そのぶん本文の予算が消える（個人ページ専用の名札だった
    // ころは帯だけで 188.7px = rail @390x844, Hiragino Sans, macOS Chromium）
    const narrow = blockAt(
      blockAt(sheet, '@supports (height: 100svh)'),
      '@media (max-width: 899px)',
    )

    expect(narrow).toContain('.identity {')
    const band = narrow.slice(narrow.indexOf('.identity {'))
    expect(band.slice(0, band.indexOf('}'))).toContain('flex-direction: row')

    // 帯に入らないものは畳む（肩書き・ひとこと・柱の GitHub / Mail）
    expect(narrow).toContain('.identity__role')
    expect(narrow).toContain('.identity__tagline')
  })

  it('全体ページの body にだけ、外枠を外す印が付く', async () => {
    // CSS 側はこの印だけを頼りに /all を除いている。印が消えると全体ページが
    // 1画面に切られ、印刷も Ctrl-F も退避先も一度に使えなくなる
    expect(await (await get('/all')).text()).toContain('data-whole=""')

    await seedMember()
    expect(await (await get('/members/okazaki')).text()).not.toContain('data-whole')
  })

  it('柱を上の帯にする骨格は、名札の中身も横に寝かせる', () => {
    /*
      中央寄せと雑誌風は 900 以上でも柱を左に立てない（列を1つに戻している）。
      名札が縦積みのまま残ると、それだけで約237px——トップの帯 30.1px の約8倍
      （rail @390x844）——を取り、そのぶん本文の予算が消えて弁が開く。
      中央寄せで開いていた3画面（about 23px / skills 58px / career 55px 不足）は
      これで3つとも収まる。
    */
    const presets = sheet.slice(sheet.indexOf("body[data-layout='magazine'] .shell"))
    const rule = bodyOf(presets, "body[data-layout='center'] .identity,")

    expect(rule).toContain('flex-direction: row')
    expect(rule).toContain('align-items: center')
    // 4行まとめて。flex-wrap が落ちると6つの子が狭い帯で1行に収まらず切れる
    expect(rule).toContain('flex-wrap: wrap')
    expect(rule).toContain('gap: var(--sp-4)')
    // 雑誌風と同じ1本。片方にだけ書くと、また骨格ごとに違う名札ができる
    expect(presets).toContain("body[data-layout='magazine'] .identity")
  })

  it('雑誌風の上の帯は、名札の行・目次・足元を縦の中心でそろえる', () => {
    /*
      下端（flex-end）でそろえていたころは、高さの違う3つ——名札の行（GitHub /
      Mail の札で 40px）・目次（28px）・足元（11px の字1行）——の箱の下端だけが
      そろい、字は3段ばらばらの高さに座っていた。900 以上の帯にだけ効く規則
    */
    const presets = sheet.slice(sheet.indexOf("body[data-layout='magazine'] .shell {"))
    const wide = blockAt(presets, '@media (min-width: 900px)')
    // 題字の帯の規則（両端に振り分ける1本）。位置を戻す center との共通の規則とは別
    const rail = ruleWith(wide, 'justify-content: space-between')
    expect(rail.selector).toBe("body[data-layout='magazine'] .rail")
    expect(rail.body).toContain('flex-direction: row')
    expect(rail.body).toContain('align-items: center')
    expect(rail.body).not.toContain('flex-end')
  })

  it('中央寄せの上の帯は著作権表示を持たず、全体ページへの1本を目次の行に置く', () => {
    /*
      柱が上の帯になる骨格には足元が無い。著作権表示が帯の真ん中に1段を取り、
      その下から本文が始まっていた。899 以下の帯で畳むのと同じ扱いで、900 以上の
      中央寄せでも出さない。全体ページへの1本は残し、目次と同じ行に並べる
      （名札を1段目いっぱいにして、目次と足元を2段目へ送る）
    */
    const presets = sheet.slice(sheet.indexOf("body[data-layout='magazine'] .shell {"))
    const wide = blockAt(presets, '@media (min-width: 900px)')

    const rail = bodyOf(wide, "body[data-layout='center'] .rail {")
    expect(rail).toContain('flex-direction: row')
    expect(rail).toContain('flex-wrap: wrap')
    expect(bodyOf(wide, "body[data-layout='center'] .rail > .identity {")).toContain(
      'flex-basis: 100%',
    )

    // 畳むのは著作権表示（.rail__copy）だけ。足元ごと畳むと全体ページへの1本まで消える
    const fold = ruleWith(wide, 'display: none')
    expect(fold.selector).toContain("body[data-layout='center'] .rail__copy")
    expect(fold.selector).not.toMatch(/center'\] \.rail__footer/)
    // 足元ごと畳むのは全体ページ（自分への行き先を置かないので、著作権表示しか無い）だけ
    expect(fold.selector).toContain("body[data-layout='center'][data-whole] .rail__footer")
    // 900 以上の中央寄せの外では著作権表示を名指ししない（柱が左に立つ骨格の足元は残す）
    expect(sheet.split('.rail__copy').length).toBe(wide.split('.rail__copy').length)
  })

  it('狭い画面の目次は折り返さず、切れている端をぼかす', () => {
    /*
      899 以下では目次も1行の横帯になる。折り返すと2段で場所を取り、中央寄せの
      390px ではその1段ぶんで 6px 足りなくなっていた。

      切れた先に気づく手がかりはこのぼかししか無い。ページ自体は overflow: clip
      で動かず、タッチ端末ではスクロールバーも出ない。個人ページの目次は
      番号を落としたあとでも 272px の帯に収まらない。
    */
    const narrow = blockAt(
      blockAt(sheet, '@supports (height: 100svh)'),
      '@media (max-width: 899px)',
    )
    const toc = ruleWith(narrow, 'mask-image: var(--fade-right)')

    expect(toc.selector).toContain('.toc')
    expect(toc.body).toContain('flex-wrap: nowrap')
    // 絞り込みの帯も同じ手当て。片方だけだと、同じ形の帯が違う振る舞いをする
    expect(narrow.match(/mask-image: var\(--fade-right\)/g)).toHaveLength(2)
    // 覆いは :root で決める。生の値を各セレクタに散らさない
    expect(sheet).toContain('--fade-right:')
  })

  it('目次の1本だけ :where() を外し、他は外さない', () => {
    /*
      中央寄せの body[data-layout='center'] .toc は (0,2,1)。:where() で包んだ
      外枠の指定は (0,1,0) なので、nowrap を足しても負ける。この1本だけ素で書く。

      16か所すべてから外してはいけない。下の @media print は素の html, body,
      .shell のまま外枠を解いており、それが効くのは目印側の詳細度が0だから。
    */
    const frame = blockAt(sheet, '@supports (height: 100svh)')
    expect(frame.match(/^\s*body\[data-layout\]/gm) ?? []).toHaveLength(1)
    expect(ruleWith(frame, 'flex-wrap: nowrap').selector).not.toContain(':where(')

    const print = blockAt(sheet, '@media print')
    expect(print).toContain('overflow: visible')
    expect(print).toContain('.shell {')
  })

  it('横帯の中央寄せにも safe を付ける', () => {
    // 目次が溢れたとき、素の center は中身を左右へ等しくはみ出させ、左端が
    // スクロールで戻せなくなる。align-content と同じ理屈で、ここも safe
    expect(bodyOf(sheet, "body[data-layout='center'] .toc")).toContain(
      'justify-content: safe center',
    )
    expect(sheet).not.toContain('justify-content: center;\n  flex-wrap: wrap')
  })
})

/*
  骨格ではなく、部品の作法。どれも「壊れても HTML は変わらず、TypeScript も
  黙っている」種類の決まりなので、値ではなく規則の形を見張る。
*/
describe('部品の作法', () => {
  it('目次に番号は振らず、数えるのはページャだけ', async () => {
    // 節が1つも無いと目次もページャも出ない。位置を名乗るのは2画面以上の
    // 節だけなので、Projects が割れる件数（perScreen 2 に対して3件）を置く
    for (const title of ['壱', '弐', '参']) await seedItem({ type: 'app', title })

    /*
      目次の 01〜04（ブロックの並び順）とページャの 01 · 07（いま何画面目か）が
      同じ 11px mono・同じ色で並ぶと、同じ数え上げに見える。しかも目次の番号は
      /projects でも /projects/3 でも「01」のまま動かない。動く番号の隣で動かない番号が
      同じ姿をしているのが、いちばん読み違えやすい。
      落とすと .toc__num の opacity: 0.7（3.34:1 で AA 割れ）も同時に消える。
    */
    expect(sheet).not.toContain('.toc__num')

    /*
      入口（/）では見ない。既定の並びの入口は、帯（一覧で見る →）がページャの
      「次」と同じ行き先なのでページャを出さない（test/public.test.ts の
      「入口のページャ」）。数え上げが残るのはめくる画面のほう
    */
    const projects = await (await get('/projects')).text()
    expect(projects).not.toContain('toc__num')
    expect(projects).toContain('class="pager__count"')

    // 数え上げはページャに残る。数えるのは**節の中**で、位置を名乗るのは節の名前を持つ画面
    expect(projects).toContain('画面のうち')
    expect(projects).toContain('class="pager__section"')
  })

  it('柱の足元のリンクは、著作権表示と見分けが付く', () => {
    /*
      素の a は color: inherit / text-decoration: none。全体ページへの1本を
      .rail__footer に置くだけでは、隣の「© 2026 Noctifex」とまったく同じ姿に
      なり、押せるものだと分からない（色の違いすら無い状態）。
      当たり判定（min-height: var(--tap)）は付けない——柱が 40px 伸び、
      中央寄せと雑誌風の 900 以上では、その 40px がそのまま本文の予算を削る。
    */
    expect(bodyOf(sheet, '.rail__footer a {')).toContain('text-decoration: underline')
    expect(bodyOf(sheet, '.rail__footer a {')).toContain('color: var(--ink-mid)')
    expect(bodyOf(sheet, '.rail__footer a {')).not.toContain('min-height')
  })

  it('ページャの「← 前」が列いっぱいに伸びない', () => {
    // .pager は 1fr auto 1fr。grid の子になった inline-flex は blockify され、
    // justify-self の初期値 normal が stretch として効く（1440 で 396px 対 64px）
    expect(ruleWith(sheet, 'justify-self: start').selector).toBe('.pager__go')
    // 「次 →」だけは右端へ。後ろの規則が勝つので、順番を入れ替えないこと
    expect(ruleWith(sheet, 'justify-self: end').selector).toBe('.pager__go--next')
  })

  it('外に出るリンクは1つの流儀に揃え、記号を薄くしない', () => {
    /*
      カードの中のリンクは、このサイトでいちばん大事な操作子（初めて来た人を
      実物へ送り出す）なのに、本文と同じ --ink-mid だった。区別は opacity .6 の
      ↗（実効 3.97:1）と、地に対し 1.30:1 の罫線だけ。しかも色が変わるのは
      @media (hover: hover) の中だけで、タッチ端末では最後まで気づかれない。
      同じ「外に出る」動作の .linklist__go / .band__go / .member__go に合わせる。
    */
    expect(bodyOf(sheet, '.links a {')).toContain('color: var(--accent)')
    expect(ruleWith(sheet, "content: '↗'").body).not.toContain('opacity')
    // 目次の番号にあった 0.7 も含め、色を薄める生の値は残っていない
    expect(sheet).not.toContain('opacity: 0.7')
    expect(sheet).not.toContain('opacity: 0.6')
  })

  it('カードは面ごと押せる。題のリンクの覆いをカードに被せ、ほかのリンクはその上に出す', () => {
    /*
      題の字だけがリンクだったころ、.card:hover はカードごと浮かせていたのに、
      浮いたカードの説明を押しても何も起きなかった。入れ子の <a> は作れず、
      JavaScript も置かないので、題のリンクの ::after をカードいっぱいに広げる
    */
    const cover = bodyOf(sheet, '.card__link::after {')
    expect(cover).toContain("content: ''")
    expect(cover).toContain('position: absolute')
    expect(cover).toContain('inset: 0')
    // 覆いの基準はカード。外すと覆いが節か外枠まで広がり、画面のどこを押しても作品へ飛ぶ
    expect(bodyOf(sheet, '.card {')).toContain('position: relative')
    // カードの中のほかの行き先は覆いの上へ。出さないと、押しても覆いの下で作品のページへ行く
    for (const selector of ['.links a {', '.card__member {']) {
      const rule = bodyOf(sheet, selector)
      expect(rule, selector).toContain('position: relative')
      expect(rule, selector).toContain('z-index: 1')
    }
  })

  it('カードのフォーカスはカード全体に、節の弁に切られない形で描く', () => {
    /*
      押せる面はカード全体なので、輪郭もカード全体。題の字に描いたままだと、
      輪郭だけが字幅に縮む。外へ離して描くと、節の幅いっぱいのカードでは左右が
      弁（overflow: auto）に切られ、上下の2本だけになる（rail @390x844）
    */
    expect(bodyOf(sheet, '.card__link:focus-visible {')).toContain('outline: none')
    const ring = bodyOf(sheet, '.card__link:focus-visible::after {')
    expect(ring).toContain('outline: var(--focus-ring) solid var(--accent)')
    expect(ring).toContain('outline-offset: calc(var(--focus-ring) * -1)')

    /*
      雑誌風のカードは左右の余白を持たず、内側の輪郭は字に掛かる。段を区切る
      上の罫線を太線にする。box-shadow ではなく border——強制色モードで消えない
    */
    const magazine = bodyOf(
      sheet,
      "body[data-layout='magazine'] .card__link:focus-visible::after {",
    )
    expect(magazine).toContain('outline: none')
    expect(magazine).toContain('border-top: var(--focus-ring) solid var(--accent)')

    // 輪郭の太さは素の :focus-visible と同じ段。値を写さない
    expect(bodyOf(sheet, ':focus-visible {')).toContain('outline: var(--focus-ring) solid')
    expect(sheet).not.toContain('outline: 2px')
  })

  it('ホバーで浮かせるのは、題にリンクを持つカードだけ（雑誌風も同じ）', () => {
    /*
      slug の無いカードは押してもどこへも行かない。浮かせると、押せる合図だけ
      出して押しても何も起きない面ができる——直したかったものそのもの
    */
    const hover = blockAt(sheet, '@media (hover: hover)')
    expect(hover).not.toContain('.card:hover')
    expect(ruleWith(hover, 'transform: translateY(-2px)').selector).toBe(
      ':is(.card:has(.card__link), .member):hover',
    )
    expect(ruleWith(hover, 'border-top-color: var(--accent)').selector).toBe(
      "body[data-layout='magazine'] :is(.card:has(.card__link), .member):hover",
    )
  })

  it('押して縮むのは面を押したときだけ。:has を手触りの列に混ぜない', () => {
    /*
      .card:active にすると、中の Repository を押したときもカードごと縮む。
      列に :has を混ぜると、:has を知らないブラウザで列ごと捨てられ、ほかの
      部品の手触りまで消える
    */
    // 手触りの列（.btn:active から始まる1本）。最初の scale: var(--press) は知らせの keyframes なので、頭で引く
    const head = sheet.indexOf('.btn:active,')
    const list = sheet.slice(head, sheet.indexOf('{', head))
    expect(bodyOf(sheet, '.btn:active,')).toContain('scale: var(--press)')
    expect(list).toContain('.back:active')
    expect(list).not.toContain(':has(')
    expect(bodyOf(sheet, '.card:has(.card__link:active) {')).toContain('scale: var(--press)')
  })

  it('「← 一覧に戻る」は列いっぱいに伸びない丸い札で、当たり判定は --tap', () => {
    // 節は grid。子の inline-flex は blockify され、既定の stretch で節の幅いっぱいに伸びる
    const back = bodyOf(sheet, '.back {')
    expect(back).toContain('justify-self: start')
    // pointer: coarse では --tap が 44px になる。ここで生の高さを書かない
    expect(back).toContain('min-height: var(--tap)')
    // 紙の上では押せない
    expect(ruleWith(blockAt(sheet, '@media print'), 'display: none').selector).toContain('.back')
  })

  it('読み上げだけに残す部品は、padding のある要素に付けても見えない', () => {
    // clip-path: inset(50%) はボーダーボックスの中央を切り抜く。padding のある
    // 要素に再利用すると切り抜きが中身の外へ落ち、文字が見えたまま残る。
    // 次に使う人が条件を覚えなくて済むよう、部品の側で閉じておく
    const rule = bodyOf(sheet, '.sr-only {')
    expect(rule).toContain('clip-path: inset(50%)')
    expect(rule).toContain('padding: 0')
    expect(rule).toContain('border: 0')
  })

  it('404 のロゴの箱は行を作らない。標準モードで字の下がりぶん伸びない', () => {
    /*
      DOCTYPE を足して標準モードになった日、.oops__mark だけが 28px → 35.8px に
      伸びた（= 404 @1440x900, 素の書体, Chromium）。標準モードの行ボックスは
      字が無くても高さの支え（strut）を持ち、svg がベースラインに座るため。
      flex にすれば svg は行に載らず、箱はロゴと同じ高さになる
    */
    expect(bodyOf(sheet, '.oops__mark {')).toContain('display: flex')
  })

  it('見出しと添えは隣り合わせ。空いた幅ぶん引き離さない', () => {
    // space-between だと 1440 で見出しとラベルが 782px 離れ、1組に見えなくなる
    expect(bodyOf(sheet, '.head {')).not.toContain('space-between')
    expect(bodyOf(sheet, '.head {')).not.toMatch(/justify-content: (safe )?center/)
  })

  it('中央寄せの骨格でも、節の見出しは本文の列と同じ左の軸に立てる', () => {
    /*
      見出しだけを中央に置いていたころは、その下の本文（カード・紹介文・経歴）は
      左から始まり、読む目が見出しの中心から本文の左端へ斜めに飛んでいた。
      中央に組むのは入口・締め・ひとこと（Hero・Contact・Statement）だけで、
      本文の列を持つ節の見出しは寄せない。骨格ごとの上書きを1本も書かない
    */
    expect(sheet).not.toMatch(/body\[data-layout='center'\] \.head\b/)
    /*
      「← 一覧に戻る」はすぐ下の見出しに付いて寄る札なので、見出しと一緒に左。
      中央へ寄せる列（帯・名札・全体ページへの1本）に入れない
    */
    const at = sheet.indexOf("body[data-layout='center'] .band,")
    const centred = sheet.slice(at, sheet.indexOf('{', at))
    expect(bodyOf(sheet, "body[data-layout='center'] .band,")).toContain('justify-self: center')
    expect(centred).toContain("body[data-layout='center'] .hero__whole")
    expect(centred).not.toContain('.back')
  })

  it('節の見出しは、h1 に上がっても字面が変わらない', () => {
    /*
      割られた画面（1画面 = 1ドキュメント）では節の見出しが h1、縦に積んだ
      全体ページ（/all）では h2。見出しの階層は読み上げと検索のためのもので、
      大きさの段ではない——要素セレクタを h2 に絞ったままにすると、h1 に
      上げた画面だけがブラウザ既定の 2em 太字で出る。HTML も TypeScript も
      何も言わないので、気づくのは見た目が跳ねたときだけ。
    */
    expect(sheet).not.toContain('.head h2 {')
    expect(bodyOf(sheet, '.head :is(h1, h2) {')).toContain('font-size: var(--fs-display-xs)')

    /*
      Contact の見出しは、割られた画面では読み上げ用の .sr-only、全体ページでは
      .head（SectionHead）。専用の見出しの規則は持たない——持つと、画面に出ない
      h1 に大きさを与えるだけの規則が残る
    */
    expect(sheet).not.toMatch(/\.contact (h1|h2|:is\(h1, h2\))/)
  })

  it('締めの画面（Contact）は箱に入れず、入口と同じ組み方をする', () => {
    /*
      箱（枠・面・影）だったころは、広い画面の真ん中に小さな枠が浮いて周りが
      空いていた。雑誌風の「箱をやめて罫線で区切る」一覧にも戻さない（そこに
      居ると、雑誌風でだけ上に罫線が引かれる）
    */
    const contact = bodyOf(sheet, '.contact {')
    expect(contact).not.toMatch(/\bborder|background|box-shadow/)
    expect(sheet).not.toContain("body[data-layout='magazine'] .contact")

    // 月の受け皿になり、字を月より前に出す。字は入口と同じく画面の下へ
    expect(bodyOf(sheet, '.moonlit {')).toContain('position: relative')
    expect(bodyOf(sheet, '.moonlit > :not(.moon) {')).toContain('z-index: 1')
    const frame = blockAt(sheet, '@supports (height: 100svh)')
    expect(
      bodyOf(frame, ':where(body[data-layout]:not([data-whole])) main > .moonlit {'),
    ).toContain('align-content: safe end')
  })

  it('締めの月は入口の月を返して小さく置き、動かさない', () => {
    /*
      丈は :root の段（--moon-closing-h）から取る。セレクタに生の % を書くと、
      check:contrast の前提（字と月の間隔）を動かした場所が :root から見えなくなる。
      動かさないのは、途中の姿を測る段が締めの画面には無いため——ここで
      月の出を掛けると、check:contrast が見ていない明るさが字の下を通りうる
    */
    const root = blockAt(sheet, ':root {')
    const closing = Number(root.match(/--moon-closing-h:\s*([\d.]+)%/)?.[1])
    const opening = Number(root.match(/--moon-h:\s*([\d.]+)%/)?.[1])
    expect(closing).toBeGreaterThan(0)
    expect(closing).toBeLessThan(opening)
    expect(bodyOf(sheet, '.moon--closing {')).toContain('--moon-h: var(--moon-closing-h)')
    expect(bodyOf(sheet, '.moon--closing .moon__mark {')).toContain('scale: -1 1')
    // 2つを1つの規則で止めている。::before（光暈の広がり）だけ残すと、そちらが動く
    expect(sheet).toMatch(
      /\.moon--closing \.moon__mark,\s*\.moon--closing \.moon__mark::before \{\s*animation: none;\s*\}/,
    )
  })

  it('個人ページの名乗りは、要素とクラスの両方で段を下げる', () => {
    /*
      この見出しは <h1 class="hero__headline">。素の .hero__headline（0,1,0）
      では .hero h1（0,1,1）に負け、大見出しの --fs-display を継ぐ。落ちても
      エラーは出ず、変わるのは「名乗りだけが画面の高さを食う」という結果だけ。
    */
    expect(bodyOf(sheet, '.hero h1.hero__headline {')).toContain('font-size: var(--fs-display-sm)')
    expect(bodyOf(sheet, '.hero h1 {')).toContain('font-size: var(--fs-display)')

    /*
      素の .hero__headline は置かない。付く先は必ず .hero の直接の子の h1 で、
      .hero h1（0,1,1）が勝つ——単独で勝つ機会が無い。要るのは、上の
      「要素とクラスの両方」のほうだけ。
    */
    // 行頭で見る。部分一致だと .hero h1.hero__headline に当たってしまう
    expect(sheet).not.toMatch(/^\.hero__headline\s*[,{]/m)
  })

  it('句読点までの塊は中で折らせない。大見出しは塊を1行ずつに積む', () => {
    expect(bodyOf(sheet, '.phrase {')).toContain('display: inline-block')
    expect(bodyOf(sheet, '.hero h1 .phrase {')).toContain('display: block')
  })

  it('入口の浮かび上がりは出だしの姿だけを持つ。止めた姿が最後の姿になる', () => {
    /*
      to を書くと、reduced-motion で animation: none になったとき（または
      古いブラウザで）の姿と、動き終わった姿が別物になりうる。from だけなら
      どちらも素の姿で同じ
    */
    const keyframes = sheet.slice(sheet.indexOf('@keyframes rise-in'))
    const body = keyframes.slice(0, keyframes.indexOf('\n}\n'))
    expect(body).toContain('from {')
    expect(body).not.toMatch(/\bto\s*\{/)
  })

  it('入口の下の余白は、浮かび上がりのずれ以上に取る。途中で弁を開かせない', () => {
    // 字を下に寄せた入口で、帯が下から浮かび上がる途中だけ 4px 溢れていた
    expect(bodyOf(sheet, '.hero {')).toContain('padding-block: var(--sp-3) var(--enter-shift)')
  })

  it('三日月も光暈もパネルからはみ出させない。はみ出すと縦一直線に途切れて見える', () => {
    /*
      左へ寄せる量（--moon-shift）が、光暈が右へ広がる量より小さいと、光暈が
      パネルの右端で断ち切られる。0 以上（右へ出す）なら三日月そのものが切れる
    */
    const root = blockAt(sheet, ':root {')
    const shift = Number(root.match(/--moon-shift:\s*(-?[\d.]+)%/)?.[1])
    const [, glowRight] = (root.match(/--moon-glow-inset:([^;]*);/)?.[1] ?? '')
      .trim()
      .split(/\s+/)
      .map((part) => Number.parseFloat(part))
    expect(shift).toBeLessThan(0)
    expect(-shift).toBeGreaterThanOrEqual(-(glowRight ?? 0))
  })

  it('技術の小見出しは、見出しに上げても太さを変えない', () => {
    // <h2 class="side-head">。欲しかったのは読み上げでの移動と塊の結び付きで、
    // 太さではない。打ち消さないとブラウザ既定の太字が出る
    expect(bodyOf(sheet, '.side-head {')).toContain('font-weight: 400')
  })

  it('狭い画面で畳むのは柱の中だけ', () => {
    /*
      畳んだぶんが「どこにも無くなる」ものを、この一覧に入れてはいけない。
      素の .socials を隠していたせいで、GitHub のプロフィールが 899 以下で
      ページのどこからも辿れなくなっていた（WCAG 1.4.10）。Contact の画面に
      置いた同じ部品まで巻き添えで消えるので、柱の中（.identity の子）だけを
      名指しする。

      肩書きは入口の Hero（.hero__role）・個人ページの名札・<title> /
      meta description / JSON-LD に残るので畳んでよい。名前（.identity__name）は
      畳まない——1人のサイトの入口以外の画面で、帯の中で誰のサイトかを言うのは
      そこだけになる。
    */
    const narrow = blockAt(
      blockAt(sheet, '@supports (height: 100svh)'),
      '@media (max-width: 899px)',
    )
    const fold = ruleWith(narrow, 'display: none')

    expect(fold.selector).toContain('.identity .socials')
    // 柱の外に置いた .socials（Contact の画面）まで消さない
    expect(fold.selector).not.toContain('[data-whole])) .socials')
    expect(fold.selector).toContain('.identity__role')
    // 本文の側の名札（個人ページの1枚目）は幅で畳まない。そこにしか顔が無い
    expect(fold.selector).not.toContain('nameplate')
    // 柱の名前は畳まない。代わりにワードマークを畳む（下の検査）
    expect(fold.selector).not.toContain('identity__name')
    expect(fold.selector).not.toContain('brand__word')
  })

  it('名乗る帯ではワードマークを見た目だけ畳む。ロゴのリンクの名前は残す', () => {
    /*
      899 以下の帯に名前（.identity__name）を入れる場所は、ワードマーク
      （NOCTIFEX）を畳んで作る。ただし display: none にすると、ロゴのリンクの
      名前がこの字しか無い（印の svg は aria-hidden）ので、名前の無いリンクに
      なる（WCAG 4.1.2）。.sr-only と同じ手で版面からだけ外す。

      名乗らない画面（入口・2人以上のサイト）では畳まない。.identity--named が
      付いた柱だけを名指しすること
    */
    const narrow = blockAt(
      blockAt(sheet, '@supports (height: 100svh)'),
      '@media (max-width: 899px)',
    )
    const hide = bodyOf(narrow, '.identity--named .brand__word {')
    expect(hide).toContain('position: absolute')
    expect(hide).toContain('clip-path: inset(50%)')
    expect(hide).not.toContain('display: none')
    expect(narrow).not.toContain(':not([data-whole])) .brand__word {')

    // 名前は1行のまま。2段に折れると帯が伸び、本文の予算が消える
    expect(bodyOf(narrow, ' .identity__name {')).toContain('white-space: nowrap')
  })

  it('カードのサムネイルは 600 未満で出さない。縦横比は :root の段で、読み込んでも崩れない', () => {
    /*
      600 未満ではカードが1列に積まれ、2枚で1画面がほぼ埋まる（空き 26px）。
      畳んでも作品のページに同じ画像がある（どこにも無くなるものではない）
    */
    const thumb = bodyOf(sheet, '.card__thumb {')
    expect(thumb).toContain('display: none')
    expect(thumb).toContain('aspect-ratio: var(--thumb-ratio)')
    // 縦横比の箱は既定では中身の高さまで伸びる。読み込んだ絵が 120px の枠を 300px にしていた
    expect(thumb).toContain('min-height: 0')
    expect(bodyOf(blockAt(sheet, '@media (min-width: 600px)'), '.card__thumb {')).toContain(
      'display: block',
    )
    // 枠の形をそろえる。絵は枠いっぱいに切り抜く
    expect(bodyOf(sheet, '.card__thumb img {')).toContain('object-fit: cover')
    expect(bodyOf(sheet, ':root {')).toContain('--thumb-ratio:')
  })

  it('雑誌風のサムネイルは横長の段に差し替える。生の比を骨格に書かない', () => {
    /*
      雑誌風は箱の余白が無く、1440 のカードが 655px——3:1 の枠だけで 218px に
      なり、節の見出しを1段上げた日にいちばん高い行が 1440x900 で溢れた
    */
    expect(bodyOf(sheet, "body[data-layout='magazine'] {")).toContain(
      '--thumb-ratio: var(--thumb-ratio-wide)',
    )
    expect(bodyOf(sheet, ':root {')).toMatch(/--thumb-ratio-wide:\s*\d+ \/ \d+/)
  })

  it('作品の画像は枠の高さを :root の段で決め、絵は切らずに枠へ貼る', () => {
    /*
      寸法を DB に持たないので、絵に合わせて枠を伸ばすと、読み込んだ瞬間に本文が
      押し下げられ、1画面に収まるかが絵しだいになる。本文の上限（MAX_CHARS.itemBody）は
      この枠の高さで測ってある
    */
    expect(bodyOf(sheet, ':root {')).toContain('--shot-h:')
    expect(bodyOf(sheet, '.shot {')).toContain('height: var(--shot-h)')
    const img = bodyOf(sheet, '.shot img {')
    expect(img).toContain('object-fit: contain')
    // 流れの中に置くと、絵の寸法（2000px のスクリーンショット）が枠の最小の高さになる
    expect(img).toContain('position: absolute')

    // 900 以上では文の列の横へ。画像の高さが文の列の高さに重なって、本文の予算を食わない
    const wide = blockAt(sheet, '@media (min-width: 900px)')
    expect(bodyOf(wide, '.detail--shot {')).toContain(
      'grid-template-columns: minmax(0, 1fr) minmax(0, 1fr)',
    )
    const beside = bodyOf(wide, '.detail--shot > .shot {')
    expect(beside).toContain('height: auto')
    expect(beside).toContain('min-height: var(--shot-h)')
  })

  it('作品のページの列は grid。高さの足りない箱で flex の子のように潰れない', () => {
    expect(bodyOf(sheet, '.detail,\n.detail__text {')).toContain('display: grid')
  })

  it('行き先の矢印は URL で変える。サイトの中へは →、外へは ↗', () => {
    // components.tsx の LinkRow が同じ条件（URL の頭の /）で target と rel を決めている
    expect(bodyOf(sheet, ".links a[href^='/']::after {")).toContain("content: '→'")
    expect(bodyOf(sheet, '.links a::after {')).toContain("content: '↗'")
  })

  it('割られた画面の節のフォーカスは、節の縁の内側に描く', () => {
    /*
      節は外枠いっぱいに敷いてあり、上下は柱の帯とページャの罫線まで数 px。
      外へ離すと輪郭がその余白に入り、罫線と平行に並んで見分けにくい。
      太さと色は素の :focus-visible のまま（見えることは変えない）
    */
    const ring = bodyOf(sheet, 'main > :is(.hero, section)[tabindex]:focus-visible {')
    expect(ring).toContain('outline-offset: calc(var(--focus-ring) * -1)')
    expect(ring).not.toContain('outline:')
  })

  it('指のときは目次の行き先も、ほかの押す手と同じ --tap の的', () => {
    /*
      素の目次は字の高さ + 上下 4px の 30px で、電話の帯ではいちばんよく押す手が
      いちばん小さかった。幅ではなく入力手段で分ける（iPad の横向きも指）
    */
    const coarse = blockAt(sheet, '@media (pointer: coarse)')
    const target = ruleWith(coarse, 'min-height: var(--tap)')
    expect(target.selector).toContain('.toc a')
    expect(target.body).toContain('align-items: center')
  })

  it('読まれない値を :root に置かない', () => {
    // --tile: 180px は参照0。同じ意味の値は 276 / 240 / 170 / 150 と生で4か所に
    // あって4つとも違う数だった。宣言だけ残すのがいちばん悪い——「ここは :root で
    // 決まっている」と誤解させたうえで、何も決めていない
    expect(sheet).not.toContain('--tile')
  })
})

/*
  一覧の列の数。

  件数（src/blocks.ts の perScreen）と列の数は同じもので、別々に持つと必ず
  ずれる。ずれ方は「広い画面ほど本文が細る」と「件数を増やすと2行目ができて
  画面から溢れる」の2つで、どちらも CSS を見ても HTML を見ても気づけない。
*/
describe('一覧の列数', () => {
  const perScreenOf = (key: string) => {
    const type = blockType(key)
    if (!type || !('perScreen' in type)) throw new Error(`${key} に perScreen が無い`)
    return type.perScreen
  }

  it('列を数える規則は CSS に無い（サーバーが渡した数を読むだけ）', () => {
    /*
      前は repeat(auto-fill, minmax(276px, 1fr))。画面が広いほど列が増えるので、
      2件しか出さない画面でも3列ぶんの幅で割られ、説明の本文が 229px まで
      細っていた（= rail @1440x900, Hiragino Sans, macOS Chromium。電話 390 の
      308px より狭い）。雑誌風は5列で 243px。列を件数に結び付けると、1画面ぶんが
      必ず1行に並ぶので、カードの高さも列の数で変わらない。
    */
    const wide = blockAt(sheet, '@media (min-width: 600px)')
    expect(bodyOf(wide, '.grid {')).toContain(
      'grid-template-columns: repeat(var(--cols), minmax(0, 1fr))',
    )

    // 雑誌風も同じ1本に従う。列を数える規則を2つ持つと、片方だけ古くなる
    expect(ruleWith(sheet, 'column-gap: var(--sp-7)').body).not.toContain('grid-template-columns')

    // 600 未満は1列のまま。カードを2枚並べる幅が無い
    expect(bodyOf(sheet, '.grid {')).toContain('grid-template-columns: minmax(0, 1fr)')
  })

  it('その数は perScreen そのもの', async () => {
    await seedItem({ title: 'アプリ' })
    await seedItem({ title: '業務', type: 'work' })

    const cols = `<div class="grid" style="--cols:${perScreenOf('projects')}">`
    expect(await (await get('/projects')).text()).toContain(cols)
    // 全体ページも同じ。ここだけ別の数にすると、1枚の中で列の幅が変わる
    expect(await (await get('/all')).text()).toContain(cols)
  })

  it('渡さない一覧を作らない（渡し忘れると列が1つに落ちる）', async () => {
    await seedItem({ title: 'アプリ' })
    const html = await (await get('/projects')).text()
    // repeat(var(--cols)) は --cols が無いと計算できず、規則ごと無かったことに
    // なる（1列に戻る）。落ちてもエラーは出ないので、markup 側で数える
    const grids = html.match(/<div class="grid"/g) ?? []
    const withCols = html.match(/<div class="grid" style="--cols:\d+">/g) ?? []
    expect(grids).toHaveLength(withCols.length)
    expect(grids.length).toBeGreaterThan(0)
  })
})

/*
  文字の大きさは :root の段だけで決める（CLAUDE.md 第1条）。宣言と実装が
  ずれていても、描いた HTML は変わらないし TypeScript も黙っている。
*/
describe('文字の段', () => {
  it('段は静的6・連動4の10だけ', () => {
    /*
      連動する段を4つに絞ったのは、残りが設計域（390 / 768 / 1440）でほとんど
      動かなかったため。--fs-card-title は 15.00 / 15.00 / 15.84px——名前は
      「連動」でも実体は静的な 15px（= --fs-md）だった。--fs-lead と
      --fs-section も同じで、3つとも静的な段に畳んである。
    */
    const steps = [...new Set(sheet.match(/--fs-[a-z-]+(?=:)/g) ?? [])].sort()
    expect(steps).toEqual(
      [
        '--fs-base',
        '--fs-display',
        '--fs-display-sm',
        '--fs-display-xl',
        '--fs-display-xs',
        '--fs-label',
        '--fs-lg',
        '--fs-md',
        '--fs-meta',
        '--fs-sm',
      ].sort(),
    )
  })

  /*
    規則ひとつずつを「セレクタ → 本文」の組にする。括り（@media など）の中の規則も
    1つの規則として数える（括りの見出しはセレクタに入らない）
  */
  const rules = [...sheet.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((found) => ({
    selector: (found[1] ?? '').trim().replace(/\s+/g, ' '),
    body: found[2] ?? '',
  }))

  it('和文の最小は --fs-meta。--fs-label（11px）は英大文字の小見出しだけ', () => {
    /*
      業界名の札・帯の件数・節の添え・経歴の期間・柱の足元が 11px（しかも等幅）
      で、和文の札がいちばん読みにくかった。11px を使ってよいのは、和文が入らない
      英大文字の小見出し（技術の LANGUAGES・管理画面の ADMIN・404 の番号）だけ。
      ここに足すときは、和文が入らないことを確かめてから
    */
    const small = rules
      .filter((rule) => /font-size:\s*var\(--fs-label\)/.test(rule.body))
      .map((rule) => rule.selector)
    expect(small.sort()).toEqual(['.login__label', '.oops__code', '.side-head:lang(en)'].sort())
  })

  it('等幅は英数字の札だけ。和文が入りうる所に --font-mono を書かない', () => {
    /*
      等幅の書体は和文の字を持たず、字は結局ほかの書体に落ちる。和文に残るのは
      等幅のための字間と小ささだけ。打ち込んだ字が入る札（タグ・肩書き・技術の
      小見出し）は、英字だけのときに付く lang="en"（components.tsx の langOf）で
      選ぶ
    */
    const mono = rules
      .filter((rule) => /font-family:\s*var\(--font-mono\)/.test(rule.body))
      .map((rule) => rule.selector)
    expect(mono.sort()).toEqual(
      [
        '.brand__word',
        '.hero .hero__role:lang(en)',
        '.pager__of',
        '.tags li:lang(en)',
        '.metric__value',
        '.side-head:lang(en)',
        '.contact__address',
        '.oops__code',
        '.admin-nav__brand',
        '.row__col--num',
        '.login__word',
        '.login__label',
      ].sort(),
    )
    // 年と期間は「2024 — 現在」と和文を含むので、等幅にせず数字の幅だけそろえる
    for (const selector of ['.card__head .year {', '.career .period {']) {
      expect(bodyOf(sheet, selector), selector).toContain('font-variant-numeric: tabular-nums')
    }
  })

  it('本文の字: カードの説明は --fs-base、段落は --fs-md で1行 約40字まで', () => {
    /*
      カードの説明 13px・段落 13px で、1440 の About は1行約65字だった。
      段落の1行の長さは :root の --measure（em なので字数のまま字の大きさに追う）
    */
    expect(bodyOf(sheet, '.card p {')).toContain('font-size: var(--fs-base)')
    const bio = bodyOf(sheet, '.bio p {')
    expect(bio).toContain('font-size: var(--fs-md)')
    expect(bio).toContain('max-width: var(--measure)')
    expect(bodyOf(sheet, ':root {')).toMatch(/--measure:\s*\d+em/)
  })

  it('節の見出しは連動の段のいちばん下。雑誌風はもう1段上げる', () => {
    /*
      節の h1 が全部 18px（--fs-lg）で、カードの題 15px と 3px しか違わなかった。
      雑誌風の説明は「見出しを大きく取り」なのに、大きいのは入口だけだった
    */
    expect(bodyOf(sheet, '.head :is(h1, h2) {')).toContain('font-size: var(--fs-display-xs)')
    expect(bodyOf(sheet, "body[data-layout='magazine'] .head :is(h1, h2) {")).toContain(
      'font-size: var(--fs-display-sm)',
    )
    // 入れ子の小見出し（/all の Profile の h3）は、節の見出しより小さく本文より大きい
    expect(bodyOf(sheet, '.head--sub h3 {')).toContain('font-size: var(--fs-lg)')
  })

  it('見出し・カードの説明・段落は文節で折り、最後の行に1〜2字だけ落とさない', () => {
    /*
      和文はどの字の間でも折れるので「を1 / つの」のように語の途中で行が変わる。
      auto-phrase は Chromium だけの進歩的な強化で、知らないブラウザではこの
      宣言だけが捨てられる。打ち込む中身は Phrases で塊に切っておけないので、
      ここはブラウザの文節に任せる
    */
    const wrap = ruleWith(sheet, 'word-break: auto-phrase')
    for (const part of [
      '.head :is(h1, h2, h3)',
      '.card__head h3',
      '.statement__text',
      '.card p',
      '.bio p',
    ]) {
      expect(wrap.selector, part).toContain(part)
    }
    expect(wrap.body).toContain('text-wrap: pretty')
  })

  it('セレクタに生の文字サイズを書かない', () => {
    // .hero__headline の clamp(24px, 3vw, 38px) と .metric__value の 26px は
    // 段に寄せた。1つ残すと「ここだけ特別」が増え、段がある意味が薄れる
    const sizes = sheet.match(/font-size:\s*[^;{}]+;/g) ?? []
    const raw = sizes.filter((d) => !d.includes('var(--fs-') && !d.includes('var(--avatar-size'))
    expect(raw).toEqual([])
  })

  it('見出しの段は幅だけでなく高さも見る', () => {
    /*
      1画面ぶんの高さに収める作りにしたのに、連動する値の可変部が全部 vw だった。
      幅が広くて背の低い画面（横向きの電話、分割表示、短い窓）では見出しだけが
      大きくなりすぎ、弁（節の overflow: auto）を押し開ける。

      svh の係数は、設計サイズの3つで今日と同じ数になるように選んである
      （いちばん厳しいのは 1440x900 で svh = 9px。上限 ÷ 9 を上回る係数にする）。
    */
    const tall = blockAt(sheet, '@supports (font-size: 1svh)')
    for (const step of ['--fs-display-xl', '--fs-display', '--fs-display-sm', '--fs-display-xs']) {
      expect(tall).toContain(`${step}: clamp(`)
    }
    expect(tall).toContain('svh')

    /*
      括りは必須。@supports で括らずに svh を書くと、svh を知らない環境で
      var() の差し替えに失敗し、見出しが本文の 14px を受け継ぐ。
      マーカーを外枠の @supports (height: 100svh) と分けてあるのも必須で、
      同じ文字列を2つ置くと blockAt が先に見つけたほうを切り出す
      （コメントの中の同じ文字列は bare が落とすので、規則だけを数える）
    */
    expect(sheet).toContain('@supports (font-size: 1svh)')
    expect(sheet.match(/@supports \(height: 100svh\)/g)).toHaveLength(1)
  })
})

/*
  入口の背景の月。装飾だが、置き方を1行間違えると「公開ページはスクロール
  しない」が破れる場所なので、外枠と同じ強さで見張る。
*/
describe('入口の月', () => {
  it('溢れは clip で切る。hidden にも auto にもしない', () => {
    /*
      .hero は弁（overflow: auto）を持つ箱。月は箱より大きいので、clip 以外だと
      溢れがスクロール可能領域になり、入口の画面だけがスクロールするページに
      なる。hidden は「見えないだけのスクロール箱」で、しかもスクロールバーが
      出ないので誰も戻せない——外枠が html/body で hidden を避けたのと同じ理由。
    */
    const body = bodyOf(sheet, '.moon {')
    expect(body).toContain('overflow: clip')
    expect(body).not.toContain('overflow: hidden')
    expect(body).not.toContain('overflow: auto')
    // 受け皿。これが無いと絶対配置が画面全体に対して解決され、箱から逃げる
    expect(bodyOf(sheet, '.hero {')).toContain('position: relative')
  })

  it('大きさは窓ではなくパネルで決める', () => {
    /*
      月が乗るのはパネルであって窓ではない。かつて clamp(280px, min(46vw,
      46svh), 620px) と窓から測っていたころ、同じ数式が 1440x900 の rail では
      パネルの 65%、1024x768 の center では 96% になっていた——器に対する
      大きさが1.5倍ちがう。.moon はパネルに inset: 0 で貼ってあるので、
      % で書けば器そのものを測れる。vw / vh / svh が戻ってきたら止める。
    */
    const root = blockAt(sheet, ':root {')
    expect(root).toMatch(/--moon-h:\s*\d+(\.\d+)?%/)
    expect(root).toMatch(/--moon-top:\s*\d+(\.\d+)?%/)
    for (const token of ['--moon-h', '--moon-top']) {
      const value = root.match(new RegExp(`${token}:([^;]*);`))?.[1] ?? ''
      expect(value).not.toMatch(/\d(vw|vh|svh|dvh|lvh|px)/)
    }
    expect(bodyOf(sheet, '.moon__mark {')).toContain('height: var(--moon-h)')
  })

  it('逃がす量は絵の幅に対する割合。器の幅で測らない', () => {
    /*
      right や margin-right の % はパネルの幅に対して効く。パネルは実測で
      358〜1342px と4倍ちがうので、同じ -12% でも狭い画面では少し欠け、
      広い画面では月が丸ごと外へ出る。translate の % だけが自分の幅を見る。
    */
    const mark = bodyOf(sheet, '.moon__mark {')
    expect(mark).toContain('translate: var(--moon-shift)')
    expect(mark).not.toMatch(/margin-right|right:\s*var\(--moon-shift\)/)
  })

  it('月あかりの色は使う場所で解く。:root で焼き付けない', () => {
    /*
      これが今回いちばん静かに壊れた所。カスタムプロパティの var() は
      **宣言した要素**で解決される。:root で
      `--moon-glow: radial-gradient(..., color-mix(in oklab, var(--accent) …))`
      と組み立てると、--accent は :root の既定の色で確定し、body の
      [data-accent] は二度と効かない。実際、5色すべてで光暈が rgb(45,45,72) の
      紫のまま出ていた（アクセントを変えるとリンクだけが変わった）。

      だから :root には色を持たせず、不透明度の坂だけを置く（--fade-right と
      同じ作法）。色は使う側の規則で var(--accent) を敷く。
    */
    const root = blockAt(sheet, ':root {')
    const glow = root.match(/--moon-glow:([\s\S]*?);/)?.[1] ?? ''
    expect(glow).toContain('radial-gradient')
    expect(glow).not.toContain('--accent')

    const before = bodyOf(sheet, '.moon__mark::before {')
    expect(before).toContain('background: var(--accent)')
    expect(before).toContain('mask-image: var(--moon-glow)')

    /*
      三日月そのものも同じ罠にかかる。素材は無彩色（アルファ1面）で運び、
      色はここで --accent から作る。:root が持てるのは「どれだけ寄せるか」の
      割合だけで、color-mix の式を :root に書くと既定の色で焼き付く。
    */
    const after = bodyOf(sheet, '.moon__mark::after {')
    expect(after).toMatch(/color-mix\([^;]*var\(--accent\)[^;]*var\(--moon-tint\)/)
    expect(root).toMatch(/--moon-tint:\s*\d+(\.\d+)?%/)
    expect(blockAt(sheet, ':root {')).not.toMatch(/--moon-[a-z-]*:\s*color-mix/)
  })

  it('粒子の濃さは :root の1つが持つ', () => {
    /*
      三日月は見出しの後ろを通る。見出し #f2f2f4 に 3:1 を残せる地は 140/255
      までで、粒子のいちばん明るい所は 255。濃さを選択子側に生で書くと、
      この上限がどこにも書かれていない数になる。
    */
    expect(blockAt(sheet, ':root {')).toContain('--moon-ink:')
    expect(bodyOf(sheet, '.moon__mark::after {')).toContain('opacity: var(--moon-ink)')
  })

  it('はっきり見たい設定と、背の低い窓では出さない', () => {
    /*
      forced-colors（Windows のハイコントラスト）は文字だけをシステム色に
      置き換え、画像は置き換えない。何もしないと、いちばん読みやすくしたい
      設定で、白い粒子の上に白い文字だけが残る。
      背の低い窓（弁が開く条件 (b) と同じ 400px）では、パネル自体が潰れて
      月が絵として成り立たない（320x256 の実測でパネルは 16px）。
    */
    expect(blockAt(sheet, '@media (forced-colors: active), (prefers-contrast: more)')).toContain(
      '.moon',
    )
    expect(blockAt(sheet, '@media (max-height: 400px)')).toContain('.moon')
  })

  it('素材は CSS からだけ参照する（出さない場面で取りに行かせないため）', async () => {
    /*
      絵を <img> で貼っていたころは、.moon を display: none にしても
      **取得は止まらなかった**（実測で、背の低い窓でもハイコントラストでも
      moon.avif は 200 で落ちてきた）。当時は <picture> の先頭に空の1枚を
      置いて打ち切っていた。

      いまは CSS の mask なので、display: none の中の要素は mask を取りに
      行かない。細工が要らなくなったかわりに、**素材の URL が
      マークアップ側へ戻っていないこと**を見張る必要がある。戻った瞬間に
      「隠しているのに取ってくる」が黙って復活する。

      取得が実際に止まることは npm run check:contrast が本物のブラウザで測る
      （vitest からは public/ が見えない——実測で 404）。
    */
    const html = await (await get('/')).text()
    expect(html).not.toContain('/assets/moon')

    // AVIF が本命・WebP が控え。素の url() は image-set を知らない環境の受け
    const after = bodyOf(sheet, '.moon__mark::after {')
    expect(after).toContain("mask: url('/assets/moon.webp')")
    expect(sheet).toContain("url('/assets/moon.avif') type('image/avif')")
    expect(sheet).toContain("url('/assets/moon.webp') type('image/webp')")
  })

  it('動くのは着いたときの一度だけ。止まった姿がそのまま完成形', () => {
    /*
      三日月の欠け具合は焼いた絵そのものなので、満ち欠けの動きは作れない。
      動かせるのは出かただけで、入口の字と同じく着いたときに一度だけ出てくる。
      動きが持ち込みうる壊れ方は4つあり、ここで止める。

      (1) 終わりの姿を keyframes に書くと、reduced-motion の人（animation: none）
          の姿と動き終わった姿が別物になりうる。from だけにする
      (2) check:contrast の本体は動きを止めて測る。途中の姿が止まった姿より
          明るい・大きい・下にあると、そこでは見えない。だから from は
          opacity 0 から、ずれは上向き（リード文から遠ざかる側）、光暈は縮めた所から
      (3) ばね（--ease-spring）は 8% 行き過ぎる。月に掛けると止まった姿を
          通り越して、(2) の外側へ一瞬出る。行き過ぎない --ease を使う
      (4) 繰り返すと止める手段が要る（WCAG 2.2.2）が、JavaScript が無いので
          置けない。一度きりで、遅れも含めて 5 秒以内に止める
    */
    const settle = blockAt(sheet, '@keyframes moon-settle')
    const bloom = blockAt(sheet, '@keyframes moon-bloom')
    for (const frames of [settle, bloom]) {
      expect(frames).toContain('from {')
      expect(frames).not.toMatch(/\bto\s*\{|\d%\s*\{/)
      expect(frames).toMatch(/opacity:\s*0;/)
    }
    expect(settle).toContain('translate: var(--moon-shift) calc(-1 * var(--enter-shift))')
    expect(bloom).toContain('scale: var(--moon-bloom)')

    const root = blockAt(sheet, ':root {')
    const token = (name: string) => Number(root.match(new RegExp(`${name}:\\s*([\\d.]+);`))?.[1])
    // 時間は単位ごと読む。1.6s を 1.6 と読むと、5 秒の上限が素通りになる
    const ms = (name: string) => {
      const [, value, unit] = root.match(new RegExp(`${name}:\\s*([\\d.]+)(ms|s);`)) ?? []
      return Number(value) * (unit === 's' ? 1000 : 1)
    }
    expect(token('--moon-bloom')).toBeLessThan(1)

    for (const selector of [
      '.moon {',
      '.moon__mark {',
      '.moon__mark::before {',
      '.moon__mark::after {',
    ]) {
      const rule = bodyOf(sheet, selector)
      if (!rule.includes('animation')) continue
      expect(rule, selector).toMatch(/animation: moon-[a-z]+ var\(--dur-slow\) var\(--ease\)[\s;]/)
      expect(rule, selector).not.toContain('infinite')
    }

    // 遅れのいちばん長い光暈が止まるまでで 5 秒
    const delay = bodyOf(sheet, '.moon__mark::before {').match(/calc\((\d+) \* var\(--stagger\)\)/)
    expect(ms('--dur-slow') + Number(delay?.[1]) * ms('--stagger')).toBeLessThanOrEqual(5000)
  })

  it('紙には刷らない', () => {
    // 淡い装飾はインクを食うだけ。外枠を解く @media print の非表示リストに居ること
    expect(blockAt(sheet, '@media print')).toContain('.moon')
  })

  it('月の光暈の上に乗る小さい字は --ink-mid。--ink-weak では 4.5:1 に届かない', () => {
    /*
      入口の帯の下の「すべてを1ページで読む →」と、締めの Contact の誘いの1文。
      どちらも月の光暈の上に乗る小さい字（WCAG 1.4.3 の 4.5:1）。帯の件数が
      --ink-weak で 3.80:1 まで落ちたのと同じ形で落ちるので、字の色を段で縛る
      （画素で測るのは npm run check:contrast）
    */
    // 頭の改行は必須。.hero > .hero__whole {（浮かび上がりの遅れ）に当てないため
    expect(bodyOf(sheet, '\n.hero__whole {')).toContain('color: var(--ink-mid)')
    expect(bodyOf(sheet, '.contact__lead {')).toContain('color: var(--ink-mid)')
    // 全体ページへの1本は行いっぱいに伸ばさない（右の空白まで押せる面になる）
    expect(bodyOf(sheet, '\n.hero__whole {')).toContain('justify-self: start')
    // 紙の上では押せない。帯と同じく刷らない
    expect(blockAt(sheet, '@media print')).toContain('.hero__whole')
  })

  it('三日月の箱は :root の縦横比で決まる', () => {
    /*
      光暈は三日月の箱（height: --moon-h + aspect-ratio: --moon-ratio）を
      基準に広がるので、比がずれると光だけが別の形で残る。

      **素材そのものの寸法との突き合わせは、ここではできない。**
      vitest は workerd の中で動いていて public/ が配られない（実測で 404）。
      比と実物が食い違っていないかは npm run check:contrast が本物のブラウザで
      測る——あちらは mask の naturalWidth/Height を読める。
    */
    expect(blockAt(sheet, ':root {')).toMatch(/--moon-ratio:\s*\d+\s*\/\s*\d+/)
    expect(bodyOf(sheet, '.moon__mark {')).toContain('aspect-ratio: var(--moon-ratio)')
  })
})
