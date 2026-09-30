import { beforeEach, describe, expect, it } from 'vitest'
import adminCss from '../public/admin.css'
import css from '../public/app.css'
import * as schema from '../src/db/schema'
import {
  CONTACT_FRAME,
  HERO_FRAME,
  LABEL_GAP,
  LABEL_MAX_WIDTH,
  LABEL_MIN_WIDTH,
  TILT,
} from '../src/lib/orbits'
import { ACCENTS, THEME_KEYS, TYPEFACES } from '../src/theme'
import { LOGO_COLORS } from '../src/ui/logo'
import { db, form, get, okText, resetDb, seedItem, seedMember, signIn } from './helpers'

// 着いたあとも動き続ける animation の名前（app.css の「動き続ける」）
const LASTING = /orbit-(turn|flow|swirl|fall|spin|breathe)\b/

beforeEach(resetDb)

const save = async (values: Record<string, string>) => {
  const signed = await signIn()
  return signed('/admin/appearance', { method: 'POST', body: form(values) })
}

const PICKED = { accent: 'ember', typeface: 'serif' }

describe('見た目のプリセット', () => {
  it('何も選んでいなければ既定の姿で出す', async () => {
    const html = await okText('/')
    // 既定はモノクロ（黒の上に白。文字もボタンも白）
    expect(html).toContain('data-accent="mono"')
    expect(html).toContain('data-typeface="sans"')
    // 骨格は選ばせない（上の帯・本文・足元の1つだけ）ので、骨格の印は無い
    expect(html).not.toContain('data-layout')
  })

  it('選んだものが公開ページに出る', async () => {
    const response = await save(PICKED)
    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe('/admin/appearance?saved=1')

    const html = await okText('/')
    expect(html).toContain('data-accent="ember"')
    expect(html).toContain('data-typeface="serif"')
  })

  it('個人ページも同じ姿になる', async () => {
    await seedMember()
    await save(PICKED)

    const html = await okText('/members/okazaki')
    expect(html).toContain('data-accent="ember"')
  })

  it('二度保存しても行が増えない', async () => {
    await save(PICKED)
    await save({ accent: 'mint', typeface: 'mono' })

    const rows = await db().select().from(schema.settings)
    expect(rows).toHaveLength(2)
    expect(await okText('/')).toContain('data-accent="mint"')
  })

  it('知らない値は保存しない', async () => {
    const response = await save({ accent: 'chaos', typeface: 'serif' })
    expect(response.status).toBe(400)

    // 1つでも知らなければ、まとめて受け取らない
    const html = await okText('/')
    expect(html).toContain('data-accent="mono"')
    expect(html).toContain('data-typeface="sans"')
  })

  it('DB に知らない値が入っていても既定に戻して描く', async () => {
    // プリセットを1つ減らした後の、選んだままのサイトを想定する
    await db().insert(schema.settings).values({ key: 'theme.accent', value: '消えた色' })
    // 前に選べた骨格の行が残っていても、読まずに描く
    await db().insert(schema.settings).values({ key: 'theme.layout', value: 'magazine' })

    const response = await get('/')
    expect(response.status).toBe(200)
    const html = await response.text()
    expect(html).toContain('data-accent="mono"')
    expect(html).not.toContain('data-layout')
  })

  it('ログインしていなければ見た目を変えられない', async () => {
    const response = await get('/admin/appearance', { method: 'POST', body: form(PICKED) })
    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe('/admin/login')

    expect(await okText('/')).toContain('data-accent="mono"')
  })

  it('選べるものだけを並べ、いま選んでいるものに印を付ける', async () => {
    await save(PICKED)
    const signed = await signIn()
    const html = await (await signed('/admin/appearance')).text()

    expect(html).toContain('value="ember" checked=""')
    // 見本は全種類ぶん出るので、data-typeface を見ても選択中は分からない
    expect(html).toContain('value="serif" checked=""')
    expect(html).not.toContain('value="sans" checked=""')
    // 骨格の組は並べない
    expect(html).not.toContain('name="layout"')
    expect(THEME_KEYS).toEqual(['accent', 'typeface'])
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
  管理画面だけの規則（public/admin.css）。公開ページは読まないので、公開ページの
  版面を見る検査は sheet だけを読む。段や書体の使い方のような「サイト全体の
  決まり」は、両方を1つにした sheets を読む——片方だけ見ると、管理画面の側に
  生の値や 11px の和文を足しても緑のままになる。
*/
const adminSheet = bare(adminCss)
const sheets = `${sheet}\n${adminSheet}`

/*
  選択肢は src/theme.ts が正だが、実際に姿を変えるのは app.css。
  片方だけ足すと、選べるのに何も変わらない選択肢ができる。
*/
describe('プリセットと CSS', () => {
  it('CSS を読めている（読めていないと、以下の検査が素通りする）', () => {
    expect(css.length).toBeGreaterThan(1000)
    expect(adminCss.length).toBeGreaterThan(1000)
  })

  it('骨格のプリセットは持たない。公開ページの印は data-site', () => {
    /*
      骨格（左の柱・中央寄せ・雑誌風）を選べたころは、どの部品も3通りの並べ方で
      崩れないかを見張っていた。いまは上の帯・本文・足元の1つだけ
    */
    expect(sheet).not.toContain('data-layout')
    expect(sheet).toContain('body[data-site]')
  })

  it('アクセント色と書体には [data-accent] / [data-typeface] の指定がある', () => {
    for (const accent of ACCENTS) expect(sheet).toContain(`[data-accent='${accent.key}']`)
    for (const typeface of TYPEFACES) expect(sheet).toContain(`[data-typeface='${typeface.key}']`)
  })
})

/*
  PERF-2。管理画面の規則（約 17KB）は app.css の中にあり、公開ページの訪問者の全員に
  配られていた。いまは public/admin.css に分け、公開ページは app.css だけを読む
  （どの外枠が何を読むかは test/headers.test.ts の「スタイルシート」）。
*/
describe('スタイルシートの分け方', () => {
  // 規則のセレクタに出てくるクラス名。括りの見出し（@media …）と keyframes の段は除く
  const classesOf = (source: string) =>
    new Set(
      [...source.matchAll(/([^{}]+)\{/g)]
        .map((found) => (found[1] ?? '').trim())
        .filter((selector) => !selector.startsWith('@') && !/^(from|to|\d+%)$/.test(selector))
        .flatMap((selector) => [...selector.matchAll(/\.([a-zA-Z][\w-]*)/g)].map((m) => m[1])),
    )

  it('管理画面の部品の規則は admin.css にだけあり、app.css には無い', () => {
    const admin = classesOf(adminSheet)
    const shared = [...classesOf(sheet)].filter((name) => admin.has(name))
    expect(shared).toEqual([])
    // 代表を名指しで（上の突き合わせは、admin.css が空になっても緑になる）
    for (const name of [
      'admin-shell',
      'admin-nav',
      'btn',
      'field',
      'toggle',
      'row',
      'login',
      'preset',
    ]) {
      expect(admin.has(name), name).toBe(true)
    }
  })

  it('admin.css は値を持たない。:root も生の色も app.css の段を読む', () => {
    expect(adminSheet).not.toContain(':root')
    expect(adminSheet).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    expect(adminSheet).not.toMatch(/\b(rgba?|hsla?)\(/)
  })

  it('作品のリンクの組は、1列に積んでも組の中より組の間を広く空ける', () => {
    /*
      600 未満はラベルと URL が1列に積まれる。同じ間隔で6段に並んでいたころは、
      どの URL がどのラベルの組か見分けられなかった（組の中 --sp-2 = 組の間 --sp-2）
    */
    const step = (value: string | undefined) => Number(value?.match(/--sp-(\d)/)?.[1])
    const inside = step(bodyOf(adminSheet, '.link-row {').match(/row-gap: ([^;]+)/)?.[1])
    const between = step(
      bodyOf(adminSheet, '.link-row + .link-row {').match(/margin-top: ([^;]+)/)?.[1],
    )
    expect(inside).toBeGreaterThan(0)
    expect(between).toBeGreaterThan(inside)
  })

  it('admin.css のメディアクエリも 600 / 900 と入力手段だけ', () => {
    const queries = [...new Set(adminSheet.match(/@media[^{]+/g)?.map((q) => q.trim()))].sort()
    expect(queries).toEqual(
      [
        '@media (hover: hover)',
        '@media (max-width: 899px)',
        '@media (min-width: 600px)',
        '@media (min-width: 900px)',
        '@media (pointer: coarse)',
      ].sort(),
    )
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
  CSS を規則の列として読む（後ろでの上書きを見つけるため）。

  下の ruleWith / bodyOf は、書いてある最初の1か所を切り出す。それだけだと、
  同じセレクタの規則が**後ろで**別の値に上書きされても緑のままだった——
  外枠の @supports の末尾に「.shell の高さを auto」「節の overflow を visible」を
  足しても、この文書の検査は 66 本とも緑だった（外枠が丸ごと効かないのに）。

  だから切り出した規則について、後ろに同じセレクタ（並びを全部含む）を持つ規則が
  あり、同じ性質を別の値にしていたら落とす——その性質は切り出した規則では一度も
  効かない。並びの一部だけを後ろで差し替える（`.detail, .detail__text` の間隔を
  `.detail__text` だけ詰める）のは、共通の規則を細かくする正しい書き方なので数えない。見るのは、同じ括りか、
  より外側（条件の少ない）の括りに書いた規則だけ——@media (min-width: 900px) の
  中で値を差し替えるのは、幅ごとの正しい書き方なので上書きとは数えない。

  字句の解析は素朴（入れ子の規則を持たず、文字列の中に { } ; が無い）で足りる。
  app.css と admin.css はそう書いてあり、書き方が変わったら閉じ括弧の数が合わず
  例外になる。構文解析の依存（css-tree・postcss）を足さないのは、見たいのが
  「規則・括り・宣言」の3つだけで、それ以上の解析は検査の確かさを増やさないため。
  効いているかどうかの最後の確かめは npm run check:fit（ブラウザが解いた値を見る）。
*/
type CssRule = {
  start: number
  end: number
  context: string[]
  selectors: string[]
  decls: [string, string][]
}

const squash = (text: string) => text.replace(/\s+/g, ' ').trim()

// 括弧の外の区切り文字で分ける（:is(.a, .b) の中のコンマで割らない）
const splitTop = (text: string, by: string) => {
  const parts: string[] = []
  let depth = 0
  let from = 0
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === '(') depth += 1
    if (text[i] === ')') depth -= 1
    if (text[i] === by && depth === 0) {
      parts.push(text.slice(from, i))
      from = i + 1
    }
  }
  parts.push(text.slice(from))
  return parts.map(squash).filter(Boolean)
}

const rulesCache = new Map<string, CssRule[]>()
const rulesOf = (source: string): CssRule[] => {
  const cached = rulesCache.get(source)
  if (cached) return cached
  const rules: CssRule[] = []
  const stack: string[] = []
  let from = 0
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i]
    if (char === '{') {
      const prelude = squash(source.slice(from, i))
      if (prelude.startsWith('@')) {
        stack.push(prelude)
        from = i + 1
        continue
      }
      const close = source.indexOf('}', i)
      const body = source.slice(i + 1, close)
      rules.push({
        start: i,
        end: close,
        context: [...stack],
        selectors: splitTop(prelude, ','),
        decls: splitTop(body, ';').flatMap((decl) => {
          const colon = decl.indexOf(':')
          return colon < 0 ? [] : [[squash(decl.slice(0, colon)), squash(decl.slice(colon + 1))]]
        }) as [string, string][],
      })
      i = close
      from = i + 1
    } else if (char === '}') {
      if (stack.pop() === undefined) throw new Error(`${i} 文字目の閉じ括弧が余っている`)
      from = i + 1
    } else if (char === ';' && source.slice(from, i).trim().startsWith('@')) {
      from = i + 1 // @import のような、括りを持たない at 規則
    }
  }
  if (stack.length) throw new Error(`括りが閉じていない: ${stack.join(' > ')}`)
  rulesCache.set(source, rules)
  return rules
}

/*
  raw（sheet か adminSheet、またはその切り出し）の at 文字目を含む規則が、後ろで
  上書きされていないか。切り出しを渡されても、上書きは切り出しの外にも居るので、
  元の全体の中の位置に直して全体を見る。
*/
const expectNotOverridden = (raw: string, at: number) => {
  const source = bare(raw)
  const whole = [sheet, adminSheet].find((base) => base.includes(source))
  if (whole === undefined) throw new Error('切り出しの元（sheet / adminSheet）が分からない')
  const found = overridesAt(whole, whole.indexOf(source) + at)
  if (found.length) throw new Error(found.join('\n'))
}

// whole の offset 文字目を含む規則の宣言のうち、後ろで上書きされているもの
const overridesAt = (whole: string, offset: number): string[] => {
  const rules = rulesOf(whole)
  const rule = rules.find((one) => one.start <= offset && offset <= one.end)
  if (!rule) throw new Error(`${offset} 文字目は規則の中ではない`)

  const within = (outer: string[]) => outer.every((one, i) => rule.context[i] === one)
  const later = rules.filter(
    (other) =>
      other.start > rule.end &&
      other.context.length <= rule.context.length &&
      within(other.context) &&
      rule.selectors.every((selector) => other.selectors.includes(selector)),
  )
  return rule.decls.flatMap(([property, value]) =>
    later.flatMap((other) => {
      const again = other.decls.find(([name]) => name === property)
      return again && again[1] !== value
        ? [
            `${rule.selectors.join(', ')} の ${property}: ${value} は、後ろの ` +
              `${other.selectors.join(', ')} { ${property}: ${again[1]} } に上書きされている`,
          ]
        : []
    }),
  )
}

/*
  宣言を1つ指して、それが書いてある規則をセレクタごと切り出す。

  blockAt と違って「どこかに書いてある」では足りない場所のため。同じ値が
  2か所に書いてあっても、付いているセレクタが違えば意味が違う（目次の帯の
  nowrap と、絞り込みの帯の nowrap）。

  切り出した規則が後ろで上書きされていたら落とす（expectNotOverridden）。
*/
const ruleWith = (raw: string, decl: string) => {
  const source = bare(raw)
  const at = source.indexOf(decl)
  expect(at, `${decl} が見つからない`).toBeGreaterThan(-1)
  expectNotOverridden(raw, at)

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

  こちらも、後ろで上書きされていたら落とす。
*/
const bodyOf = (raw: string, selector: string) => {
  const source = bare(raw)
  const at = source.indexOf(selector)
  expect(at, `${selector} が見つからない`).toBeGreaterThan(-1)

  const open = source.indexOf('{', at)
  expectNotOverridden(raw, open)
  return source.slice(open + 1, source.indexOf('}', open)).trim()
}

describe('CSS を読む道具', () => {
  it('同じセレクタの規則が後ろで同じ性質を上書きしていたら見つける', () => {
    // 外枠の値を末尾で消す、という壊れ方の縮図。@media の中の差し替えは数えない
    const css = [
      '@supports (height: 100svh) {',
      '  :where(body) .shell { height: var(--screen-h); display: grid; }',
      '  @media (min-width: 900px) { :where(body) .shell { height: 50vh; } }',
      '  :where(body) .shell { height: auto; }',
      '}',
      '.detail, .detail__text { gap: 2px; }',
      '.detail__text { gap: 1px; }',
    ].join('\n')
    const found = overridesAt(css, css.indexOf('height: var(--screen-h)'))
    expect(found).toHaveLength(1)
    expect(found[0]).toContain('height: auto')
    // 並びの一部だけを細かくするのは上書きではない
    expect(overridesAt(css, css.indexOf('gap: 2px'))).toEqual([])
  })

  it('外枠の要の規則は、後ろで上書きされていない', () => {
    const frame = blockAt(sheet, '@media screen')
    for (const decl of [
      'min-height: var(--screen-h)',
      'position: sticky',
      'scroll-padding-top: var(--top-clear)',
      'align-content: safe start',
      'min-height: var(--cover-h)',
    ]) {
      expect(() => ruleWith(frame, decl), decl).not.toThrow()
    }
  })
})

/*
  公開ページのレイアウトは app.css にしかない。外枠の1行が消えても TypeScript は
  黙っているし、描いた HTML も変わらない。出るのは「長い中身がページの外で切られる」
  「目次が一番上に置き去りになる」ページだけで、それに気付ける場所がここと
  npm run check:fit しかない。だから値ではなく規則の存在そのものを見張る。
*/
describe('ページの外枠', () => {
  /*
    公開ページは縦にスクロールする（CLAUDE.md の「公開ページは縦に読む」）。以前は
    html と body を overflow: clip で止め、.shell の高さを画面ちょうどに決め打ち、
    溢れを節の弁（overflow: auto）で受けていた。どれか1つが戻ると、長くなった中身が
    ページの外で黙って切られるか、ページの中にもう1つのスクロール箱ができる
  */
  it('html と body はページを止めない（clip / hidden / 高さの決め打ちを持たない）', () => {
    const outer = /(^|[\s>(])(html|body)(\[[^\]]*\]|:[a-z-]+\([^)]*\))*\)*$/
    for (const rule of rulesOf(sheet)) {
      if (!rule.selectors.some((selector) => outer.test(selector))) continue
      for (const [property, value] of rule.decls) {
        const where = `${rule.selectors.join(', ')} { ${property}: ${value} }`
        if (property.startsWith('overflow')) expect(value, where).not.toMatch(/clip|hidden/)
        if (property === 'height') expect(value, where).not.toBe('100%')
        expect(property, where).not.toBe('overscroll-behavior')
      }
    }
  })

  it('節は弁を持たない。スクロール箱はページ1つだけ', () => {
    // 節の overflow: auto・overscroll-behavior・scrollbar-gutter はどれも弁のためのもの
    for (const rule of rulesOf(sheet)) {
      if (!rule.selectors.some((selector) => selector.includes('main > :is(.hero, section)')))
        continue
      for (const [property] of rule.decls) {
        expect(property, rule.selectors.join(', ')).not.toMatch(
          /^(overflow|overscroll-behavior|scrollbar-gutter)/,
        )
      }
    }
    expect(sheet).not.toContain('scrollbar-gutter')
  })

  it('画面1つぶんの高さを :root で持ち、読むのは body の min-height と表紙の高さだけ', () => {
    // 値そのものを見る（'100svh' がどこかにある、では括りの条件にも当たる）
    expect(bodyOf(sheet, ':root {')).toContain('--screen-h: calc(100svh')
    expect(sheet).not.toContain('--screen-h: 100vh')

    /*
      height ではなく min-height。高さを決め打つと、中身が長い画面ではページの外へ
      切られる（以前はそれを避けるために中身を画面ごとに割っていた）。min-height
      なら、短いページでも足元が画面の底に座り、長いページはページごと伸びる
    */
    const frame = blockAt(sheet, '@media screen')
    expect(ruleWith(frame, 'min-height: var(--screen-h)').selector).toBe('body[data-site]')

    // 表紙の高さは画面から帯と本文の上下の余白を除いたもの。:root で1つに決める
    expect(bodyOf(sheet, ':root {')).toContain(
      '--cover-h: calc(var(--screen-h) - var(--top-h) - var(--page-pad) * 2)',
    )
    expect(sheet.match(/var\(--screen-h\)/g)).toHaveLength(2)
    const cover = ruleWith(frame, 'min-height: var(--cover-h)')
    expect(cover.selector).toBe(
      ':where(body[data-site]:not([data-whole])) main > :is(.hero--orbit, .orbital)',
    )
  })

  it('body は縦の flex で、本文が残りを受ける（足元を画面の途中に浮かせない）', () => {
    const frame = blockAt(sheet, '@media screen')
    const body = bodyOf(frame, 'body[data-site] {')
    expect(body).toContain('display: flex')
    expect(body).toContain('flex-direction: column')
    expect(bodyOf(frame, 'body[data-site] > main {')).toContain('flex: 1 0 auto')
  })

  it('節は grid で上から置く。flex のままだと寄せ方が黙って効かなくなる', () => {
    /*
      この1行が落ちると、すぐ下の align-content（節は上揃え）が黙って効かなくなる。
      .hero は素で display: flex + flex-direction: column——縦並びの flex では交差軸が
      横なので、align-content は上下ではなく左右を動かす指定に変わる
    */
    const frame = blockAt(sheet, '@media screen')
    const panel = ruleWith(frame, 'align-content: safe start')

    expect(panel.body).toContain('display: grid')
    expect(panel.selector).toContain('main > :is(.hero, section)')
  })

  it('一覧の行の説明は行数で切らない。タグと行き先も畳まない（一覧は1ページに縦に並ぶ）', () => {
    /*
      1画面に収めていたころは、説明を行数で止め（--card-lines）、電話と画像の行では
      タグと行き先を畳んでいた（--card-extras）。「何であるか。何をしたか。」の2文目が
      カードからほぼ読めない幅があった。いまは Projects が1ページで縦に伸びるので、
      一覧の行は書いたぶんを全部出す。止める段が1つでも残ると、どこかの幅で黙って切れる
    */
    expect(sheet).not.toMatch(/line-clamp/)
    expect(sheet).not.toContain('--card-lines')
    expect(sheet).not.toContain('--card-extras')
    expect(sheet).not.toContain('card--lean')
  })

  it('外枠は画面にだけ当てる。紙は @media print が受け、外枠を解き直さない', () => {
    // 紙には貼り付ける帯も1画面ぶんの表紙も要らない。括りの外に書くと、印刷で
    // 表紙の高さが紙1枚ぶん空く
    expect(sheet.match(/@media screen/g)).toHaveLength(1)
    const print = blockAt(sheet, '@media print')
    expect(print).not.toContain('.shell {')
    expect(print).not.toMatch(/overflow|height/)
  })

  it('節の見出しは上揃え。どの画面でも見出しが同じ高さから始まる', () => {
    /*
      上下中央に寄せていたころは、見出しの高さが中身の量で決まり、画面ごとに
      跳ねていた。節は上端から置き、見出しを錨にする（帯の罫線から本文の上の余白
      --page-pad ぶん下）。そろっていることは npm run check:fit が画素で測る
      （同じ寸法の中で 1px 以内）
    */
    const frame = blockAt(sheet, '@media screen')
    expect(bodyOf(frame, ':where(body[data-site]) main > :is(.hero, section) {')).toContain(
      'align-content: safe start',
    )
    expect(ruleWith(sheet, 'padding-block: var(--page-pad)').selector).toBe(
      'body[data-site] > main',
    )

    // 外枠のどの寄せ方にも safe を付ける。素の center / end は、中身が容器を超えた
    // 瞬間に上端を容器の外へ押し出す
    expect(frame).not.toMatch(/align-content: (center|end|start)/)
    expect(sheet).not.toContain('align-content: center')
  })

  it('上の帯は貼り付き、地を敷いて本文より手前に出る。全体ページでは貼り付けない', () => {
    const frame = blockAt(sheet, '@media screen')
    const top = bodyOf(frame, ':where(body[data-site]:not([data-whole])) .top {')
    expect(top).toContain('position: sticky')
    expect(top).toContain('top: 0')
    /*
      z-index は 2。入口の軌道図の札（1）と、一覧の行の中のリンク（覆いの上に出す 1）
      より上でないと、送った本文が帯の上に描かれる
    */
    expect(top).toContain('z-index: 2')
    expect(sheet.match(/z-index: 1;/g)?.length).toBeGreaterThan(0)
    expect(sheet).not.toMatch(/z-index: [3-9];/)
    // 地は素の .top が敷く（貼り付いた帯の下を本文が流れても、字が重ならない）
    expect(bodyOf(sheet, '.top {')).toContain('background: var(--bg)')
  })

  it('送った先を帯の下に止める。空きは :root の段（帯の高さ + 間）', () => {
    expect(bodyOf(sheet, ':root {')).toContain('--top-clear: calc(var(--top-h) + var(--sp-5))')
    const frame = blockAt(sheet, '@media screen')
    expect(ruleWith(frame, 'scroll-padding-top: var(--top-clear)').selector).toBe(
      ':where(html:has(> body[data-site]:not([data-whole])))',
    )
    // なめらかに送るのは公開ページだけ。reduced-motion の素の html に譲る詳細度 0
    expect(bodyOf(sheet, ':where(html:has(> body[data-site])) {')).toContain(
      'scroll-behavior: smooth',
    )
  })

  it('全体ページの body にだけ、外枠を外す印が付く', async () => {
    // CSS 側はこの印だけを頼りに /all を除いている。印が消えると全体ページにも
    // 表紙の高さと貼り付く帯（目次は1行の横帯）が掛かる
    expect(await okText('/all')).toContain('data-whole=""')

    await seedMember()
    expect(await okText('/members/okazaki')).not.toContain('data-whole')
  })

  it('上の帯の目次は1行のまま横に送る。切れている端をぼかし、最後の行き先は薄めない', () => {
    /*
      帯の段の数を中身で変えない（折り返すと帯が2段になり、貼り付いた帯が画面の上を
      食う）。切れた先に気づく手がかりはこのぼかししか無い——帯は横にしか動かず、
      タッチ端末ではスクロールバーも出ない
    */
    const toc = bodyOf(sheet, '.toc {')
    for (const decl of [
      'flex: 1 1 0',
      'min-width: 0',
      'overflow-x: auto',
      'justify-content: safe flex-end',
      'mask-image: var(--fade-right)',
    ]) {
      expect(toc, decl).toContain(decl)
    }
    expect(toc).not.toContain('flex-wrap: wrap')
    /*
      ぼかしの幅だけ右に空きを持ち、同じだけ右の余白へはみ出す。溢れていなければ
      ぼかしは空きに掛かるだけで、最後の行き先（Contact）は薄まらない
    */
    expect(toc).toContain('padding-inline-end: var(--fade-w)')
    expect(toc).toContain('margin-inline-end: calc(var(--fade-w) * -1)')
    // ぼかしの幅は余白に収まる幅（はみ出してもページを横に動かさない）
    expect(bodyOf(sheet, ':root {')).toContain('--fade-w: min(var(--sp-6), var(--gutter))')

    // 絞り込みの帯も同じ手当て（899 以下）。片方だけだと、同じ形の帯が違う振る舞いをする
    const narrow = blockAt(blockAt(sheet, '@media screen'), '@media (max-width: 899px)')
    const filters = ruleWith(narrow, 'mask-image: var(--fade-right)')
    expect(filters.selector).toContain('.filters')
    expect(filters.body).toContain('padding-inline-end: var(--fade-w)')
    expect(filters.body).toContain('margin-inline-end: calc(var(--fade-w) * -1)')
    // 覆いは :root で決める。生の値を各セレクタに散らさない
    expect(sheet).toContain('--fade-right:')
  })

  it('全体ページの目次は折り返す（貼り付かない頭の帯。ページを横に動かさない）', () => {
    const frame = blockAt(sheet, '@media screen')
    const whole = bodyOf(frame, ':where(body[data-site][data-whole]) .toc {')
    expect(whole).toContain('flex-wrap: wrap')
    expect(whole).toContain('mask-image: none')
  })

  it('外枠の目印は :where() で包み、詳細度を 0 にする', () => {
    /*
      骨格のプリセットは無くなったので、外枠が部品の規則に勝つための強さは要らない。
      目印（body[data-site]）は全部 :where() の中に置き、外枠の規則の強さは部品の
      セレクタだけで決まるようにする（body と main の名指しの2本だけは例外——
      骨格そのもので、部品が上書きする相手が居ない）
    */
    const frame = blockAt(sheet, '@media screen')
    const bare = (frame.match(/^\s*body\[data-site\][^\n]*\{/gm) ?? []).map((line) => line.trim())
    expect(bare).toEqual(['body[data-site] {', 'body[data-site] > main {'])
  })
})

/*
  外枠ではなく、部品の作法。どれも「壊れても HTML は変わらず、TypeScript も
  黙っている」種類の決まりなので、値ではなく規則の形を見張る。
*/
/*
  F5（TEST-2）で上限ちょうどの中身を測って見つかった溢れの直し。値の出どころと
  付け先をここで見張り、効いているかは npm run check:fit が 27通りで測る。
*/
describe('上限ちょうどの中身で収めるための組み方', () => {
  it('リンク集の矢印は行の右上に据え、補足が長くても1行ぶんを取らない', () => {
    expect(bodyOf(sheet, '.linklist__go {')).toContain('position: absolute')
    const row = bodyOf(sheet, '.linklist li a {')
    expect(row).toContain('position: relative')
    expect(row).toContain('padding-inline-end')
  })
})

describe('部品の作法', () => {
  it('目次に番号は振らない。数えるものも置かない', async () => {
    await seedItem({ type: 'app', title: '壱' })

    /*
      目次の 01〜04 はブロックの並び順でしかなく、読む人に言うことが無い。
      落とすと .toc__num の opacity: 0.7（3.34:1 で AA 割れ）も同時に消える。
      画面の底で数えていたページャ（Projects 2 / 4）も外した——ページは節ごとに
      1つで、数える相手が無い
    */
    expect(sheet).not.toContain('.toc__num')
    expect(sheet).not.toContain('.pager')
    const projects = await okText('/projects')
    expect(projects).not.toContain('toc__num')
    expect(projects).not.toContain('class="pager')
  })

  it('足元のリンクは、著作権表示と見分けが付く', () => {
    /*
      素の a は color: inherit / text-decoration: none。全体ページへの1本を
      .foot__meta に置くだけでは、隣の「© 2026 AstLog」とまったく同じ姿に
      なり、押せるものだと分からない（色の違いすら無い状態）
    */
    const link = bodyOf(sheet, '.foot__meta a {')
    expect(link).toContain('text-decoration: underline')
    expect(link).toContain('color: var(--ink-mid)')
  })

  it('外に出るリンクは1つの流儀に揃え、記号を薄くしない', () => {
    /*
      作品の中のリンクは、このサイトでいちばん大事な操作子（初めて来た人を
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

  it('一覧の行は面ごと押せる。題のリンクの覆いを行に被せ、ほかのリンクはその上に出す', () => {
    /*
      題の字だけがリンクだと、押せる合図は行全体に出ているのに、説明を押しても
      何も起きない。入れ子の <a> は作れず、JavaScript も置かないので、題のリンクの
      ::after を行いっぱいに広げる
    */
    const cover = bodyOf(sheet, '.entry__link::after {')
    expect(cover).toContain("content: ''")
    expect(cover).toContain('position: absolute')
    expect(cover).toContain('inset: 0')
    // 覆いの基準は行。外すと覆いが節か外枠まで広がり、画面のどこを押しても作品へ飛ぶ
    expect(bodyOf(sheet, '.entry {')).toContain('position: relative')
    // 行の中のほかの行き先は覆いの上へ。出さないと、押しても覆いの下で作品のページへ行く
    for (const selector of ['.links a {', '.entry__member {']) {
      const rule = bodyOf(sheet, selector)
      expect(rule, selector).toContain('position: relative')
      expect(rule, selector).toContain('z-index: 1')
    }
  })

  it('一覧の行のフォーカスは行全体に、縁の内側に描く', () => {
    /*
      押せる面は行全体なので、輪郭も行全体。題の字に描いたままだと、輪郭だけが
      字幅に縮む。外へ離して描くと、上の行の罫線と重なって、どちらの行を囲んで
      いるのか読み分けにくい
    */
    expect(bodyOf(sheet, '.entry__link:focus-visible {')).toContain('outline: none')
    const ring = bodyOf(sheet, '.entry__link:focus-visible::after {')
    expect(ring).toContain('outline: var(--focus-ring) solid var(--accent)')
    expect(ring).toContain('outline-offset: calc(var(--focus-ring) * -1)')

    // 輪郭の太さは素の :focus-visible と同じ段。値を写さない
    expect(bodyOf(sheet, ':focus-visible {')).toContain('outline: var(--focus-ring) solid')
    expect(sheet).not.toContain('outline: 2px')
  })

  it('ホバーで応えるのは、題にリンクを持つ行だけ', () => {
    /*
      slug の無い行は押してもどこへも行かない。応えると、押せる合図だけ出して
      押しても何も起きない面ができる。:has は :is() の中（知らないブラウザで列ごと
      捨てられないように）
    */
    const hover = blockAt(sheet, '@media (hover: hover)')
    expect(hover).not.toContain('.entry:hover')
    expect(bodyOf(hover, ':is(.entry:has(.entry__link)):hover .entry__go {')).toContain(
      'translate: var(--sp-2) 0',
    )
  })

  it('押して縮むのは面を押したときだけ。:has を手触りの列に混ぜない', () => {
    /*
      .entry:active にすると、中の Repository を押したときも行ごと縮む。
      列に :has を混ぜると、:has を知らないブラウザで列ごと捨てられ、ほかの
      部品の手触りまで消える
    */
    // 手触りの列（.cta:active から始まる1本）。管理画面の部品の列は admin.css に同じ形で
    const head = sheet.indexOf('.cta:active,')
    const list = sheet.slice(head, sheet.indexOf('{', head))
    expect(bodyOf(sheet, '.cta:active,')).toContain('scale: var(--press)')
    expect(list).toContain('.back:active')
    expect(list).toContain('.toc a:active')
    expect(list).not.toContain(':has(')
    expect(bodyOf(adminSheet, '.btn:active,')).toContain('scale: var(--press)')
    expect(bodyOf(sheet, '.entry:has(.entry__link:active) {')).toContain('scale: var(--press)')
  })

  it('「← 一覧に戻る」は字の手。列いっぱいに伸びず、当たり判定は --tap', () => {
    // 節は grid。子の inline-flex は blockify され、既定の stretch で幅いっぱいに伸びる
    const back = bodyOf(sheet, '.back {')
    expect(back).toContain('justify-self: start')
    // pointer: coarse では --tap が 44px になる。ここで生の高さを書かない
    expect(back).toContain('min-height: var(--tap)')
    // 見出しの上に立つので、見出しから離す
    expect(back).toContain('margin-bottom')
    // 紙の上では押せない
    expect(ruleWith(blockAt(sheet, '@media print'), 'display: none').selector).toContain('.back')
    // 押して縮み、ホバーで字が明るくなる
    const head = sheet.indexOf('.cta:active,')
    expect(sheet.slice(head, sheet.indexOf('{', head))).toContain('.back:active')
    const hover = blockAt(sheet, '@media (hover: hover)')
    const at = hover.indexOf('.filters a:not([aria-current]):hover,')
    expect(hover.slice(at, hover.indexOf('{', at))).toContain('.back:hover')
    expect(bodyOf(hover, '.filters a:not([aria-current]):hover,')).toContain('color: var(--ink)')
    // 対になっていた「くわしく読む →」は外した（本文は同じページのすぐ下の小節）
    expect(sheet).not.toContain('.more')
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

  it('404 の印は字の色で光る。線の色に落とさない', () => {
    // 印の光の縁と横線は currentColor。--line-strong に落としていたころ、光が暗い灰色に
    // なり、影の黒い円だけが残って印に見えなかった
    expect(bodyOf(sheet, '.oops__mark {')).not.toMatch(/(^|[\s;])color:/)
  })

  it('見出しと添えは隣り合わせ。空いた幅ぶん引き離さない', () => {
    // space-between だと 1440 で見出しとラベルが 782px 離れ、1組に見えなくなる
    expect(bodyOf(sheet, '.head {')).not.toContain('space-between')
    expect(bodyOf(sheet, '.head {')).not.toMatch(/justify-content: (safe )?center/)
  })

  it('節の見出しは、h1 に上がっても字面が変わらない', () => {
    /*
      ページごとの URL（1ページ = 1ドキュメント）では節の見出しが h1、縦に積んだ
      全体ページ（/all）では h2。見出しの階層は読み上げと検索のためのもので、
      大きさの段ではない——要素セレクタを h2 に絞ったままにすると、h1 に
      上げたページだけがブラウザ既定の 2em 太字で出る。HTML も TypeScript も
      何も言わないので、気づくのは見た目が跳ねたときだけ。
    */
    expect(sheet).not.toContain('.head h2 {')
    expect(bodyOf(sheet, '.head :is(h1, h2) {')).toContain('font-size: var(--fs-display-xl)')

    /*
      Contact の見出しは、ページごとの URL では読み上げ用の .sr-only、全体ページでは
      .head（SectionHead）。専用の見出しの規則は持たない——持つと、ページに出ない
      h1 に大きさを与えるだけの規則が残る
    */
    expect(sheet).not.toMatch(/\.contact (h1|h2|:is\(h1, h2\))/)
  })

  it('締めの画面（Contact）は箱に入れず、軌道図の下に字を置く', () => {
    // 箱（枠・面・影）だったころは、広い画面の真ん中に小さな枠が浮いて周りが空いていた
    const contact = bodyOf(sheet, '.contact {')
    expect(contact).not.toMatch(/\bborder|background|box-shadow/)

    // 軌道図は字の上の行。列の真ん中に置き、幅の上限と縦横比は :root の段
    const orbits = bodyOf(sheet, '.orbits {')
    expect(orbits).toContain('align-self: stretch')
    expect(orbits).toContain('justify-self: center')
    expect(orbits).toContain('width: min(100%, var(--contact-w))')
    expect(orbits).toContain('aspect-ratio: var(--contact-ratio)')
    expect(orbits).not.toContain('position: absolute')
    // 表紙の中で、図の行と字の行。余りは字の上（1fr）が受け、900 以上で字は底に寄る
    expect(bodyOf(sheet, '.orbital {')).toContain('grid-template-rows: auto 1fr')
    expect(bodyOf(blockAt(sheet, '@media (min-width: 900px)'), '.orbital > .contact {')).toContain(
      'align-self: end',
    )
  })

  it('着いたときの動きは入口の軌道図の中だけ。締めで動くのは入口と同じ動き続けるものだけ', () => {
    /*
      着いたときの動き（ブラックホールが灯り、軌道が渦を巻いて収まる）は入口で一度だけ。
      締めで続くのは、入口と同じ動き続けるもの（公転・流れる光・吸い込まれる粒・縁を回る
      光の点・光の揺らぎ）だけ。どちらの画面も npm run check:contrast が動きの途中の姿を
      測る
    */
    const moving = rulesOf(sheet).filter((rule) =>
      rule.decls.some(([name]) => name === 'animation' || name === 'animation-name'),
    )
    const lasting = LASTING
    for (const rule of moving) {
      const [, value] = rule.decls.find(([name]) => name === 'animation') ?? ['', '']
      if (lasting.test(value)) continue
      for (const selector of rule.selectors) {
        if (!/orbit/.test(selector)) continue
        expect(selector, `${selector} が動く`).toMatch(/^\.system__/)
      }
      // ブラックホールは入口と締めで同じ部品。灯るのは入口の枠の中のものだけ
      for (const selector of rule.selectors) {
        if (/\.hole\b/.test(selector)) expect(selector).toBe('.system > .hole')
      }
    }
    // 締めの外へ抜ける道（脱出軌道と探査機）は持ち主が外した
    expect(sheet).not.toMatch(/orbit-escape|orbit-probe/)
  })

  it('個人ページの名乗りは、要素とクラスの両方で段を下げる', () => {
    /*
      この見出しは <h1 class="hero__headline">。素の .hero__headline（0,1,0）
      では .hero h1（0,1,1）に負け、大見出しの --fs-display を継ぐ。落ちても
      エラーは出ず、変わるのは「名乗りだけが画面の高さを食う」という結果だけ。
    */
    expect(bodyOf(sheet, '.hero h1.hero__headline {')).toContain('font-size: var(--fs-display)')
    expect(bodyOf(sheet, '.hero h1 {')).toContain('font-size: var(--fs-display-xl)')

    /*
      素の .hero__headline は置かない。付く先は必ず .hero の直接の子の h1 で、
      .hero h1（0,1,1）が勝つ——単独で勝つ機会が無い。要るのは、上の
      「要素とクラスの両方」のほうだけ。
    */
    // 行頭で見る。部分一致だと .hero h1.hero__headline に当たってしまう
    expect(sheet).not.toMatch(/^\.hero__headline\s*[,{]/m)
  })

  it('句読点までの塊は中で折らせない。大見出しと締めの1文は塊を1行ずつに積む', () => {
    // 頭の改行は必須。.hero h1 .phrase { に当てないため
    expect(bodyOf(sheet, '\n.phrase {')).toContain('display: inline-block')
    expect(bodyOf(sheet, '.hero h1 .phrase {')).toContain('display: block')
    expect(bodyOf(sheet, '.contact__lead .phrase {')).toContain('display: block')
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

  it('入口の軌道図は層を枠いっぱいに重ね、ブラックホールを焦点に置く。札の層も枠いっぱい', () => {
    /*
      絵の層（軌道の奥・ブラックホール・軌道の手前・天体）は枠（.system）いっぱいに
      重ねる。viewBox と枠の比が同じなので、枠の割合で置いたブラックホールがちょうど
      焦点に座る
    */
    const layers = bodyOf(sheet, '.system__orbits,\n.system__bodies {')
    expect(layers).toContain('position: absolute')
    expect(layers).toContain('inset: 0')
    const hole = bodyOf(sheet, '.hole {')
    expect(hole).toContain('left: var(--hole-x)')
    expect(hole).toContain('top: var(--hole-y)')
    expect(hole).toContain('width: var(--hole-w)')
    expect(hole).toContain('aspect-ratio: 1')
    expect(hole).toContain('translate: -50% -50%')
    // 横線（真横から見た円盤）を軌道面と同じだけ傾ける。光は字の白（ロゴと同じ）
    expect(hole).toContain('rotate: var(--system-tilt)')
    expect(hole).toContain('color: var(--ink)')
    // 光・縁を回る光の点・黒い円の3枚を同じ箱に重ねる
    const layers3 = bodyOf(sheet, '.hole > svg {')
    expect(layers3).toContain('position: absolute')
    expect(layers3).toContain('inset: 0')
    expect(sheet).not.toContain('.system > :not(')
    const system = bodyOf(sheet, '.system {')
    expect(system).toContain('width: 100%')
    expect(system).toContain('aspect-ratio: var(--system-ratio)')
    // 札の層は流れの外（grid の行に入ると、星が真ん中から外れる）
    const labels = bodyOf(sheet, '.system__labels {')
    expect(labels).toContain('position: absolute')
    expect(labels).toContain('inset: 0')
    // 横だけ切る（見積もりより長い札でもページを横に動かさない）
    expect(system).toContain('overflow-x: clip')
  })

  it('技術の小見出しは、見出しに上げても太さを変えない', () => {
    // <h2 class="side-head">。欲しかったのは読み上げでの移動と塊の結び付きで、
    // 太さではない。打ち消さないとブラウザ既定の太字が出る
    expect(bodyOf(sheet, '.side-head {')).toContain('font-weight: 400')
  })

  it('名乗りと連絡先は足元に置き、どの幅でも畳まない', () => {
    /*
      柱のころは 899 以下で肩書き・一言・GitHub / メールを畳み、畳んだぶんが
      「どこにも無くなる」ものを入れないよう見張っていた（素の .socials を隠して、
      GitHub のプロフィールが電話から辿れなくなったことがある。WCAG 1.4.10）。
      いまは上の帯にロゴと目次しか置かず、名乗りと連絡先は足元が受ける——
      幅で畳む規則を1本も持たない
    */
    const folds = rulesOf(sheet).filter(
      (rule) =>
        rule.context.some((one) => /width/.test(one)) &&
        rule.decls.some(([name, value]) => name === 'display' && value === 'none'),
    )
    expect(folds.map((rule) => rule.selectors.join(', '))).toEqual([])
    // ロゴはワードマーク1つ（O がブラックホール）。幅で畳まず、大きさは :root の段。
    // O の光は字の箱の外へ出して見せる
    const word = bodyOf(sheet, '.brand__word {')
    expect(word).toContain('height: var(--brand-h)')
    expect(word).toContain('overflow: visible')
  })

  it('経歴とできごとの罫線は行のあいだだけ。見出しの線と2本並べない', () => {
    // 1行目の上にも引いていたころ、見出しの線のすぐ下にもう1本の罫線が並んでいた
    expect(bodyOf(sheet, '.career li {')).not.toContain('border-top')
    expect(bodyOf(sheet, '.career li + li {')).toContain('border-top: 1px solid var(--line)')
  })

  it('行き先の列は折り返した行のあいだを空けない。札の的の高さが行の間隔', () => {
    // --sp-4 を足していたころ、2行に折れた行き先の行の間が 52px 開いていた
    const links = bodyOf(sheet, '.links {')
    expect(links).toContain('gap: 0 var(--sp-5)')
    expect(bodyOf(sheet, '.links a {')).toContain('min-height: var(--tap)')
  })

  it('一覧のサムネイルはどの幅でも出す。縦横比は :root の段', () => {
    /*
      1画面に収めていたころは 600 未満で畳んでいて、電話の一覧には作品の絵が
      どこにも無かった。一覧は縦に読むので出す
    */
    const thumb = bodyOf(sheet, '.entry__thumb {')
    expect(thumb).toContain('display: block')
    expect(thumb).toContain('aspect-ratio: var(--thumb-ratio)')
    expect(thumb).toContain('width: min(100%, var(--entry-thumb))')
    // 縦横比の箱は既定では中身の高さまで伸びる。読み込んだ絵が 120px の枠を 300px にしていた
    expect(thumb).toContain('min-height: 0')
    // 幅で畳まない
    const hidden = rulesOf(sheet).filter(
      (rule) =>
        rule.selectors.some((one) => one.includes('entry__thumb')) &&
        rule.decls.some(([name, value]) => name === 'display' && value === 'none'),
    )
    expect(hidden).toEqual([])
    // 枠の形をそろえる。絵は枠いっぱいに切り抜く
    expect(bodyOf(sheet, '.entry__thumb img {')).toContain('object-fit: cover')
    expect(bodyOf(sheet, ':root {')).toContain('--thumb-ratio:')
  })

  it('作品の画像は枠の高さを :root の段で決め、絵は切らずに枠へ貼る', () => {
    /*
      寸法は共有カードのためにだけ持つ（古い画像には無い）。絵に合わせて枠を
      伸ばすと、読み込んだ瞬間に本文が押し下げられ、縦長の絵1枚でページの頭が
      何画面ぶんも埋まる
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

  it('節に tabindex のための規則を持たない。ページがスクロールするので節は止まる先ではない', () => {
    /*
      節が溢れの弁（overflow: auto）だったころは、WebKit で弁にフォーカスできない
      ために節へ tabindex="0" を付け、その輪郭を縁の内側に描き、箱を --focus-inset
      だけ広げていた。いまはページそのものが動くので、どれも要らない。
      残すと、tabindex の無い節には効かない規則と、読まれない段が残る
    */
    expect(sheet).not.toContain('[tabindex]')
    expect(sheet).not.toContain('--focus-inset')
  })

  it('目次の行き先は、どの入力手段でもほかの押す手と同じ --tap の的', () => {
    /*
      上の帯は --top-h の高さがあり、的を小さく詰める理由が無い。幅ではなく入力手段で
      --tap が 40px / 44px に変わる（iPad の横向きも指）
    */
    expect(bodyOf(sheet, '.toc a {')).toContain('min-height: var(--tap)')
    expect(bodyOf(sheet, '.top__admin {')).toContain('min-height: var(--tap)')
    expect(bodyOf(blockAt(sheet, '@media (pointer: coarse)'), ':root {')).toContain('--tap: 44px')
  })

  it('目次のいまのページは、帯の見えている幅の中で開く（貼り付く帯のときだけ）', () => {
    /*
      JavaScript が無いので、帯は何もしなければいつも左端で開き、並びの後ろの
      節に着くと印が帯の外に出ていた。全体ページの目次は折り返すので要らない
    */
    const frame = blockAt(sheet, '@media screen')
    const marker = ruleWith(frame, 'scroll-initial-target: nearest')
    expect(marker.selector).toBe(
      ":where(body[data-site]:not([data-whole])) .toc a[aria-current='page']",
    )
    // 右端のぼかしの下に座らせない
    expect(marker.body).toContain('scroll-margin-inline: var(--fade-w)')
    expect(sheet.split('scroll-initial-target').length).toBe(2)
  })

  it('読まれない値を :root に置かない', () => {
    // --tile: 180px は参照0。同じ意味の値は 276 / 240 / 170 / 150 と生で4か所に
    // あって4つとも違う数だった。宣言だけ残すのがいちばん悪い——「ここは :root で
    // 決まっている」と誤解させたうえで、何も決めていない
    expect(sheet).not.toContain('--tile')
  })
})

/*
  一覧の行（Projects の索引）。列の数を数える規則は持たない——1列の行を縦に並べ、
  行の中の区画の幅だけを :root の段で決める（広い画面ほど本文が細る、を起こさない）。
*/
describe('一覧の行', () => {
  it('行は1列に縦に並べる。列を数える規則も、サーバーから数を受け取る口も持たない', async () => {
    expect(sheet).not.toContain('--cols')
    expect(sheet).not.toMatch(/repeat\(auto-fill, minmax\(2\d\dpx/)
    expect(bodyOf(sheet, '.entries {')).toContain('flex-direction: column')

    await seedItem({ title: 'アプリ' })
    await seedItem({ title: '業務', type: 'work' })
    const html = await okText('/projects')
    expect(html).toContain('<div class="entries">')
    expect(html).not.toContain('--cols')
  })

  it('行の区画は幅ごとに組み替える。900 以上は横に並べ、区画の幅は :root の段', () => {
    // 600 未満は縦に積む（番号と矢印の下に本文 → サムネイル → 札 → 技術）
    expect(bodyOf(sheet, '.entry {')).toContain('grid-template-columns: minmax(0, 1fr) auto')
    const wide = blockAt(sheet, '@media (min-width: 900px)')
    const row = bodyOf(wide, '.entry {')
    expect(row).toContain("'index main meta tags go'")
    for (const token of ['--entry-index', '--entry-meta', '--entry-tags', '--entry-go']) {
      expect(row, token).toContain(`var(${token})`)
      expect(bodyOf(sheet, ':root {'), token).toMatch(new RegExp(`${token}:`))
    }
    // 本文の列が残りを受ける
    expect(row).toContain('minmax(0, 1fr)')
    // 番号と矢印は題の1行目の高さの真ん中（題の行の高さを :root で持つ）
    expect(bodyOf(sheet, ':root {')).toContain('--entry-title-lh: calc(var(--fs-display-xs) * 1.3)')
  })

  it('行と行のあいだは1本の罫線。箱（枠・面・影・角）に入れない', () => {
    const row = bodyOf(sheet, '.entry {')
    expect(row).toContain('border-bottom: 1px solid var(--line)')
    expect(row).not.toMatch(/border-radius|background|box-shadow/)
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
    const steps = [...new Set(sheets.match(/--fs-[a-z-]+(?=:)/g) ?? [])].sort()
    // 段を決めるのは app.css の :root だけ。admin.css は読むだけ
    expect(adminSheet).not.toMatch(/--fs-[a-z-]+:/)
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
  const rules = [...sheets.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((found) => ({
    selector: (found[1] ?? '').trim().replace(/\s+/g, ' '),
    body: found[2] ?? '',
  }))

  it('和文の最小は --fs-meta。--fs-label（11px）は和文の入らない英字と数字の札だけ', () => {
    /*
      業界名の札・帯の件数・節の添え・経歴の期間・柱の足元が 11px（しかも等幅）
      で、和文の札がいちばん読みにくかった。11px を使ってよいのは、和文が入らない
      英大文字の小見出し（技術の LANGUAGES・管理画面の ADMIN・404 の番号）と、
      英字か数字だけの札（目次の英字の行き先・入口の札と番号・件数・一覧の番号）だけ。
      ここに足すときは、和文が入らないことを確かめてから
    */
    const small = rules
      .filter((rule) => /font-size:\s*var\(--fs-label\)/.test(rule.body))
      .map((rule) => rule.selector)
    expect(small.sort()).toEqual(
      [
        '.login__label',
        '.oops__code',
        '.side-head:lang(en)',
        // 公開ページの英字だけの札（lang="en" か、数字だけのもの）
        '.toc a:lang(en)',
        '.eyebrow :lang(en)',
        '.system__number',
        '.system__label :lang(en)',
        '.tally dt:lang(en)',
        '.head__count',
        '.entry__index',
        '.entry__meta li:lang(en)',
        '.contact__sub :lang(en)',
      ].sort(),
    )
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
        '.tags li:lang(en)',
        '.metric__value',
        '.side-head:lang(en)',
        '.oops__code',
        '.admin-nav__brand',
        '.row__col--num',
        '.login__label',
        '.toc a:lang(en)',
        '.eyebrow :lang(en)',
        '.system__number',
        '.system__label :lang(en)',
        '.tally dt:lang(en)',
        '.head__count',
        '.entry__index',
        '.entry__meta li:lang(en)',
        '.contact__sub :lang(en)',
      ].sort(),
    )
    // 年と期間は「2024 — 現在」と和文を含むので、等幅にせず数字の幅だけそろえる
    for (const selector of ['.entry__year {', '.career .period {']) {
      expect(bodyOf(sheet, selector), selector).toContain('font-variant-numeric: tabular-nums')
    }
  })

  it('本文の字: 一覧の行の説明は --fs-base、段落は --fs-md で1行 約40字まで', () => {
    /*
      カードの説明 13px・段落 13px で、1440 の About は1行約65字だった。
      段落の1行の長さは :root の --measure（em なので字数のまま字の大きさに追う）
    */
    expect(bodyOf(sheet, '.entry__main p {')).toContain('font-size: var(--fs-base)')
    expect(bodyOf(sheet, '.entry__main p {')).toContain('max-width: var(--measure)')
    const bio = bodyOf(sheet, '.bio p {')
    expect(bio).toContain('font-size: var(--fs-md)')
    expect(bio).toContain('max-width: var(--measure)')
    expect(bodyOf(sheet, ':root {')).toMatch(/--measure:\s*\d+em/)
  })

  it('見出しの段: 節は最上段、個人ページの頭はその下、章はさらに下、小節と行の題は小さく', () => {
    /*
      ページの名前（Projects…）は大きな字で1つだけ置く（入口の大見出しと同じ段）。
      個人ページは頭の大見出し（h1）が --fs-display で、章（About / Skills / Career の
      h2）はそれより小さい --fs-display-sm——同じ大きさだと章が h1 と同じ格に見える
    */
    expect(bodyOf(sheet, '.head :is(h1, h2) {')).toContain('font-size: var(--fs-display-xl)')
    expect(bodyOf(sheet, '.hero h1.hero__headline {')).toContain('font-size: var(--fs-display)')
    expect(bodyOf(sheet, '.head--chapter :is(h1, h2) {')).toContain(
      'font-size: var(--fs-display-sm)',
    )
    expect(bodyOf(sheet, '.head--chapter {')).toContain('margin-top: var(--sp-7)')
    /*
      小節の見出し（作品のページの Story の h2、/all の Profile の h3）は、節の見出しより
      ずっと小さく本文より大きい（大きくすると作品名の h1 と同じ格に見える）
    */
    expect(bodyOf(sheet, '.head--sub :is(h2, h3) {')).toContain('font-size: var(--fs-lg)')
    // 一覧の行の題は節の見出しから2段以上離す
    expect(bodyOf(sheet, '.entry__main h3 {')).toContain('font-size: var(--fs-display-xs)')
  })

  it('見出し・行の説明・段落は文節で折り、最後の行に1〜2字だけ落とさない', () => {
    /*
      和文はどの字の間でも折れるので「を1 / つの」のように語の途中で行が変わる。
      auto-phrase は Chromium だけの進歩的な強化で、知らないブラウザではこの
      宣言だけが捨てられる。打ち込む中身は Phrases で塊に切っておけないので、
      ここはブラウザの文節に任せる
    */
    const wrap = ruleWith(sheet, 'word-break: auto-phrase')
    for (const part of [
      '.hero h1',
      '.head :is(h1, h2, h3)',
      '.entry__main :is(h3, p)',
      '.statement__text',
      '.contact__lead',
      '.bio p',
    ]) {
      expect(wrap.selector, part).toContain(part)
    }
    expect(wrap.body).toContain('text-wrap: pretty')
  })

  it('セレクタに生の文字サイズを書かない', () => {
    // .hero__headline の clamp(24px, 3vw, 38px) と .metric__value の 26px は
    // 段に寄せた。1つ残すと「ここだけ特別」が増え、段がある意味が薄れる
    const sizes = sheets.match(/font-size:\s*[^;{}]+;/g) ?? []
    const raw = sizes.filter((d) => !d.includes('var(--fs-') && !d.includes('var(--avatar-size'))
    expect(raw).toEqual([])
  })

  it('見出しの段は幅だけでなく高さも見る', () => {
    /*
      連動する値の可変部が全部 vw だと、幅が広くて背の低い画面（横向きの電話、
      分割表示、短い窓）では見出しだけが大きくなりすぎ、1行の見出しが画面の
      大半を食う。

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
    */
    expect(sheet).toContain('@supports (font-size: 1svh)')
  })
})

/*
  入口の軌道図。装飾だが、置き方を1行間違えるとページが横に動くか、星が焦点から
  外れる場所なので、外枠と同じ強さで見張る。
*/
describe('入口の軌道図', () => {
  const root = () => blockAt(sheet, ':root {')
  const token = (name: string) =>
    Number.parseFloat(root().match(new RegExp(`${name}:\\s*([\\d.]+)`))?.[1] ?? 'NaN')

  it('入口は 900 以上で2列。左に見出しの列、右に軌道図、底に件数の帯', () => {
    // 1列のときは軌道図を上に（見出しの列が DOM の先頭。並べ替えは区画の名前だけ）
    const hero = bodyOf(sheet, '.hero--orbit {')
    expect(hero).toContain("grid-template-areas: 'map' 'copy' 'tally'")
    const wide = bodyOf(blockAt(sheet, '@media (min-width: 900px)'), '.hero--orbit {')
    expect(wide).toContain("grid-template-areas: 'copy map' 'tally tally'")
    expect(wide).toContain('grid-template-columns: minmax(0, 1fr) minmax(0, 1fr)')
    // 区画の名前は部品の側が持つ
    expect(bodyOf(sheet, '.hero__copy {')).toContain('grid-area: copy')
    expect(bodyOf(sheet, '.system {')).toContain('grid-area: map')
    expect(bodyOf(sheet, '.tally {')).toContain('grid-area: tally')
  })

  it('枠の縦横比と面の傾きは orbits.ts と同じ数。札を出す枠の幅と札のずれも同じ数', () => {
    // SVG は枠いっぱいに貼るので、比がずれるとブラックホールが軌道の焦点から外れる
    expect(root()).toContain(`--system-ratio: ${HERO_FRAME.width} / ${HERO_FRAME.height};`)
    expect(root()).toContain(`--contact-ratio: ${CONTACT_FRAME.width} / ${CONTACT_FRAME.height};`)
    // 軌道は orbits.ts が傾けて描き、ブラックホールの横線（円盤は同じ面）は CSS が同じだけ回す
    expect(root()).toContain(`--system-tilt: ${TILT}deg;`)
    // 札の置き場所は、この幅の枠とこのずれで重ならないように選んである（placeLabels）
    expect(sheet).toContain(`@container (min-width: ${LABEL_MIN_WIDTH}px)`)
    expect(root()).toContain(`--label-dx: ${LABEL_GAP.x}px;`)
    expect(root()).toContain(`--label-dy: ${LABEL_GAP.y}px;`)
    expect(root()).toContain(`--label-max: ${LABEL_MAX_WIDTH}px;`)
    // 名前はふだん隠し、キーボードで選んだときと、マウスで重ねたときに出す。長い名前は
    // 札の幅で末尾を省き、札は伸びる向きの枠の端までの空き（--room）で止める
    expect(bodyOf(sheet, '.system__name {')).toContain('clip-path: inset(50%)')
    expect(bodyOf(sheet, '.system__label a:focus-visible .system__name {')).toContain(
      'text-overflow: ellipsis',
    )
    expect(bodyOf(sheet, '.system__label > :is(a, span) {')).toContain(
      'max-width: min(var(--label-max), calc(var(--room) - var(--label-dx) - var(--sp-1)))',
    )
    // :hover で名前を出すのは (hover: hover) の中だけ（タッチで押した札に貼り付かない）
    const reveals = rulesOf(sheet).filter((rule) =>
      rule.selectors.some((one) => one.includes(':hover') && one.includes('.system__name')),
    )
    expect(reveals.map((rule) => rule.context)).toEqual([['@media (hover: hover)']])
    // 番号だけの札は小さいので、指で押せる的（--tap）を札の中心に重ねる
    expect(bodyOf(sheet, '.system__label a::after {')).toContain('height: var(--tap)')
    expect(bodyOf(sheet, '.system {')).toContain('container-type: inline-size')
    // 札はふだん出さず、枠が広いときだけ出す
    expect(bodyOf(sheet, '.system__labels {')).toContain('display: none')
  })

  it('線と点の色は使う場所で --accent と --ink から敷く。:root で焼き付けない', () => {
    /*
      :root で color-mix(…var(--accent)…) を組み立てると、--accent は :root の既定の
      色で解けてしまい、body の [data-accent] が効かない（前の月の光暈で5色すべてが
      紫のまま残った）。:root が持つのは濃さと不透明度の坂だけ
    */
    expect(root()).not.toMatch(
      /--(orbit|system|hole|ignite|infall)[a-z-]*:[^;]*(color-mix|var\(--accent\))/,
    )

    /*
      線の色は部品が線ごとに渡す坂（stroke 属性の url(#…)）が持ち、坂の両端の色と濃さを
      ここで敷く。奥の端は薄く、手前へ続けて濃くなる（半分ずつ濃さを変えていたころは、
      継ぎ目で濃さが倍に跳んだ）。.orbit に stroke を書くと坂を上書きする
    */
    const orbit = bodyOf(sheet, '.orbit {')
    expect(orbit).not.toMatch(/\bstroke(-opacity)?:/)
    const far = bodyOf(sheet, '.orbit-depth__far {')
    expect(far).toContain('stop-color: var(--accent)')
    expect(far).toContain('stop-opacity: calc(var(--orbit-ink) * var(--orbit-far))')
    const near = bodyOf(sheet, '.orbit-depth__near {')
    expect(near).toContain('stop-color: var(--accent)')
    expect(near).toContain('stop-opacity: var(--orbit-ink)')
    expect(sheet).not.toContain('.orbit--far')
    expect(bodyOf(sheet, '.orbit-body path {')).toContain('stroke: var(--ink)')
    // 手前の半分の下の縁取りは地の色（光の縁の前を通る所で、線が光に溶けない）
    expect(bodyOf(sheet, '.orbit__casing {')).toContain('stroke: var(--bg)')
    expect(token('--orbit-ink')).toBeLessThan(1)
    expect(token('--orbit-far')).toBeLessThan(1)
  })

  it('線と点の太さは画面の px。枠が縮んでも点を潰さない', () => {
    for (const selector of [
      '.orbit {',
      '.orbit__casing {',
      '.orbit-body path {',
      '.orbit-flow {',
      '.orbit-grain__dot {',
    ]) {
      expect(bodyOf(sheet, selector), selector).toContain('vector-effect: non-scaling-stroke')
    }
    expect(root()).toMatch(/--orbit-line:\s*\d+px;/)
    expect(root()).toMatch(/--orbit-body:\s*clamp\(\d+px, [\d.]+vw, \d+px\);/)
  })

  it('業務は破線の軌道と輪の天体。区分を色だけで分けない', () => {
    expect(bodyOf(sheet, '.orbit--work {')).toContain('stroke-dasharray: var(--orbit-dash)')
    const hole = bodyOf(sheet, '.orbit-body .orbit-body__hole {')
    expect(hole).toContain('stroke: var(--bg)')
    expect(hole).toContain('stroke-width: calc(var(--orbit-body) / 2)')
  })

  it('番号の札は地を塗る。小さい字の 4.5:1 を軌道の線に削らせない', () => {
    const label = bodyOf(sheet, '.system__label > :is(a, span) {')
    expect(label).toContain('background: var(--bg)')
    expect(label).toContain('color: var(--ink-mid)')
    // 札は枠の中で位置を持つ（天体の点が原点）
    const place = bodyOf(sheet, '.system__label {')
    expect(place).toContain('left: var(--x)')
    expect(place).toContain('top: var(--y)')
  })

  it('はっきり見たい設定と、背の低い窓では出さない', () => {
    for (const marker of [
      '@media (forced-colors: active), (prefers-contrast: more)',
      '@media (max-height: 400px)',
    ]) {
      const block = blockAt(sheet, marker)
      const hidden = ruleWith(block, 'display: none').selector
      expect(hidden, marker).toContain('.system')
      expect(hidden, marker).toContain('.orbits')
      // 図の区画も畳む（残すと 900 以上の入口の右半分が空き、締めの字が表紙の上に寄る）
      expect(bodyOf(block, '.hero--orbit {'), marker).toContain(
        "grid-template-areas: 'copy' 'tally'",
      )
      expect(bodyOf(block, '.orbital {'), marker).toContain('grid-template-rows: 1fr')
    }
  })

  it('ブラックホールはロゴの O と同じ SVG。焼いた絵を読まない。軌道と天体もページに直に描く', async () => {
    /*
      前は scripts/blackhole/render.py で焼いた絵（AVIF / WebP）を背景として読んでいた。
      持ち主の「ワードマークのブラックホールと統一」で、ロゴの O をそのまま大きく描く
      （components.tsx の Hole）。焼いた絵と前の月の素材を読む道は残さない
    */
    expect(sheet).not.toMatch(/\/assets\/(moon|blackhole)/)
    expect(sheet).not.toMatch(/\.hole::(before|after)/)
    await seedMember()
    await seedItem({ type: 'app' })
    const html = await okText('/')
    expect(html).not.toMatch(/\/assets\/(moon|blackhole)/)
    expect(html).toContain('class="system__orbits system__orbits--far"')
    expect(html).toContain('<span class="hole" aria-hidden="true"')
    // 光 → 縁を回る光の点 → 黒い円の順に重ねる（DOM の順が重なりの順）
    const hole = html.slice(html.indexOf('<span class="hole"'))
    expect(hole.indexOf('class="hole__light"')).toBeLessThan(hole.indexOf('class="hole__spin"'))
    expect(hole.indexOf('class="hole__spin"')).toBeLessThan(hole.indexOf('class="hole__core"'))
  })

  it('動くのは着いたときの一度だけ。止まった姿がそのまま完成形で、5 秒以内に止まる', () => {
    /*
      出だしの姿（from）だけを書き、終わりの姿は持たせない——reduced-motion で
      animation: none になった姿が、そのまま動き終わった姿になる
    */
    for (const name of ['orbit-light', 'orbit-ignite', 'orbit-infall', 'orbit-count']) {
      const frames = blockAt(sheet, `@keyframes ${name}`)
      expect(frames, name).toContain('from {')
      expect(frames, name).not.toMatch(/\bto\s*\{|\d+%\s*\{/)
    }
    // レーダー（走査線・波紋）はやめた。ブラックホールが灯り、軌道が引き寄せられる
    expect(sheet).not.toMatch(/system__beam|orbit-ring|orbit-sweep|--sweep|--radar-/)
    expect(bodyOf(sheet, '.system > .hole {')).toContain('animation: orbit-ignite')
    expect(ruleWith(sheet, 'animation: orbit-infall').selector).toMatch(
      /^\.system__orbits,\s*\.system__bodies$/,
    )

    // 着いたときの動きは繰り返さない（続くものは下の「動き続ける」）
    const moving = rulesOf(sheet).filter((rule) =>
      rule.decls.some(
        ([name, value]) => name === 'animation' && /orbit-/.test(value) && !LASTING.test(value),
      ),
    )
    expect(moving.length).toBeGreaterThanOrEqual(5)
    for (const rule of moving) {
      const [, value] = rule.decls.find(([name]) => name === 'animation') ?? ['', '']
      expect(value, rule.selectors.join(', ')).not.toMatch(/infinite/)
    }

    /*
      5 秒以内に止まる（WCAG 2.2.2）。いちばん遅いのは最後に出る番号の札（引き寄せの
      3/4 から、8つ目まで --stagger ずつ遅れ、そのあと --dur かけて出る）
    */
    const ms = (name: string) => token(name)
    const ignite = ms('--ignite-delay') + ms('--ignite-dur')
    const infall = ms('--infall-delay') + ms('--infall-dur')
    const label =
      ms('--infall-delay') + ms('--infall-dur') * 0.75 + 8 * ms('--stagger') + ms('--dur')
    const count = ms('--infall-delay') + ms('--infall-dur') * 0.3 + ms('--count-dur')
    for (const end of [ignite, infall, label, count]) {
      expect(end).toBeGreaterThan(1000)
      expect(end).toBeLessThanOrEqual(5000)
    }
    expect(root()).toContain('--label-delay: calc(var(--infall-delay) + var(--infall-dur) * 0.75)')
    expect(root()).toContain('--count-delay: calc(var(--infall-delay) + var(--infall-dur) * 0.3)')
    expect(ruleWith(sheet, 'min(var(--i, 0), 8) * var(--stagger)').selector).toBe('.system__label')
    // 出る前でも、キーボードで選んだ札はすぐ見せる（見えないリンクに見えない輪を付けない）
    expect(bodyOf(sheet, '.system__label:focus-within {')).toContain('opacity: 1 !important')
  })

  it('動き続けるものは、動きを減らす設定の外でだけ動く。keyframes は var() を持たない', () => {
    /*
      公転・流れる光・吸い込まれる粒・縁を回る光の点・光の揺らぎは 5 秒を超えて続く。
      止める手は置かない（持ち主の「動きを止める 不要」）。動きを減らす設定では動く層を
      出さない——止まった天体と札が完成形
    */
    // 終わらない動きは、動きを減らす設定の外（no-preference）の括りの中だけ
    const lasting = rulesOf(sheet).filter((rule) =>
      rule.decls.some(([name, value]) => name === 'animation' && /infinite/.test(value)),
    )
    expect(lasting.length).toBeGreaterThanOrEqual(6)
    for (const rule of lasting) {
      const [, value] = rule.decls.find(([name]) => name === 'animation') ?? ['', '']
      expect(value, rule.selectors.join(', ')).toMatch(LASTING)
      expect(rule.context, rule.selectors.join(', ')).toEqual([
        '@media (prefers-reduced-motion: no-preference)',
      ])
    }
    // ふだんは動く層を出さない（動きを減らす設定の姿）
    const hidden = rulesOf(sheet).find(
      (rule) =>
        rule.context.length === 0 &&
        rule.selectors.includes(':is(.orbit-flows, .orbit-dust, .orbit-movers, .hole__spin)'),
    )
    expect(hidden?.decls).toContainEqual(['display', 'none'])
    // 止める手は外した
    expect(sheet).not.toMatch(/\.motion\b|motion-toggle/)

    /*
      動き続ける keyframes に var() を書かない（光の揺らぎの1つだけは要素が1つなので
      許す）。var() を持つ keyframes は、動いている要素ごとに毎コマ解き直され、粒の多い
      入口では style の計算だけでコマの予算を食った（電話相当で 1 秒あたり 480ms）
    */
    for (const name of ['orbit-turn', 'orbit-flow', 'orbit-swirl', 'orbit-fall', 'orbit-spin']) {
      expect(blockAt(sheet, `@keyframes ${name}`), name).not.toContain('var(')
    }
    // 公転は1周前の姿から止まった姿（親の transform が決めた場所）まで。from だけ
    const turn = blockAt(sheet, '@keyframes orbit-turn')
    expect(turn).toContain('transform: rotate(-1turn)')
    expect(turn).not.toMatch(/\bto\s*\{|\d+%\s*\{/)

    // 図の中を選んだとき・マウスを重ねたとき（手触りの括り）は、止まった天体と札に戻す
    expect(bodyOf(sheet, '.system:focus-within .orbit-movers {')).toContain('opacity: 0')
    expect(
      bodyOf(sheet, '.system:focus-within > :is(.system__bodies, .system__labels) {'),
    ).toContain('opacity: 1')
    expect(
      bodyOf(blockAt(sheet, '@media (hover: hover)'), '.system:hover .orbit-movers {'),
    ).toContain('opacity: 0')
  })

  it('紙には刷らない', () => {
    // 装飾はインクを食うだけ。押し手も紙の上では押せない
    const print = blockAt(sheet, '@media print')
    for (const selector of ['.system', '.orbits', '.cta']) {
      expect(print).toContain(selector)
    }
  })

  it('入口と締めのまわりの小さい字は --ink-mid 以上。--ink-weak では札の 4.5:1 に届かない所がある', () => {
    // 画素で測るのは npm run check:contrast
    expect(bodyOf(sheet, '.hero__lead {')).toContain('color: var(--ink-mid)')
    expect(bodyOf(sheet, '.contact__go {')).toContain('color: var(--ink-mid)')
    expect(bodyOf(sheet, '.contact__sub {')).toContain('color: var(--ink-mid)')
  })
})

/*
  配色は黒基調の1つで、OS がライトでも白い地に切り替えない（「黒の上に白」が見た目の
  芯。持ち主が白い地の姿を見て「黒基調で文字やボタンは白のつもりだった」と戻した）。
  紙だけは白い地で刷る——黒い地のまま刷ると、白に近い字が白い紙に乗る（地の色は
  既定では刷られない）。

  紙の配色（@media print の :root）は同じ名前の色の段を差し替えるだけ。片方にしか
  無い色の段があると、その色だけが紙に黒い地の色のまま残る（白い紙に白に近い字）。
*/
describe('配色（黒基調と紙）', () => {
  // 覆い（--fade-right）は不透明度の坂で、色の段ではない（地の色と関わらない）
  const MASKS = new Set(['--fade-right'])
  const colorTokens = (body: string) =>
    [...body.matchAll(/(--[\w-]+):\s*([^;]+);/g)]
      .filter(
        ([, name = '', value = '']) =>
          !MASKS.has(name) && /#[0-9a-fA-F]{3,8}\b|\brgba?\(/.test(value),
      )
      .map(([, name = '']) => name)
      .sort()

  it('画面は黒基調の1つ。OS の配色の申告で白い地に切り替えない', async () => {
    expect(sheets).not.toContain('prefers-color-scheme')
    expect(bodyOf(sheet, ':root {')).toContain('color-scheme: dark;')
    // 公開・404・管理画面の外枠がどれも同じ1本（components.tsx の ColorSchemeMeta）を置く
    const meta = '<meta name="color-scheme" content="dark"/>'
    expect(await okText('/')).toContain(meta)
    const missing = await get('/no-such-page')
    expect(missing.status).toBe(404)
    expect(await missing.text()).toContain(meta)
    const login = await get('/admin/login')
    expect(login.status).toBe(200)
    expect(await login.text()).toContain(meta)
  })

  it('既定のアクセントはモノクロ。リンクもボタンも字と同じ白で、ボタンの字は黒', () => {
    const root = bodyOf(sheet, ':root {')
    const value = (name: string) => root.match(new RegExp(`${name}:\\s*([^;]+);`))?.[1]
    expect(value('--accent')).toBe('var(--mono)')
    // 白は字の白と同じ1色（白を2種類持たない）
    expect(value('--mono')).toBe(value('--ink'))
    expect(bodyOf(sheet, "[data-accent='mono'] {")).toContain('--accent: var(--mono);')
  })

  it('紙の色の段は、黒い地の色の段をどれも差し替える。紙だけの段は作らない', () => {
    const screen = bodyOf(sheet, ':root {')
    const paper = bodyOf(blockAt(sheet, '@media print'), ':root {')
    const screenColors = colorTokens(screen)
    // 読めているか（地・面・線・字・モノクロとアクセント6色と薄い地・危険・スイッチ）
    expect(screenColors.length).toBeGreaterThan(20)
    expect(colorTokens(paper)).toEqual(screenColors)
    for (const [, name] of paper.matchAll(/(--[\w-]+):/g)) {
      expect(screen, `${name} は :root に無い`).toContain(`${name}:`)
    }
  })

  it('ロゴの素材に焼く色は、画面の :root の段と同じ', () => {
    /*
      favicon とワードマークのファイルは貼る先の字の色を継げないので、色を決め打って
      焼く（src/ui/logo.ts の LOGO_COLORS）。段を変えた日に素材だけが前の色で残らない
      ように、ここで突き合わせる（変えたら node scripts/logo/export.mjs で焼き直す）
    */
    const root = bodyOf(sheet, ':root {')
    const value = (name: string) => root.match(new RegExp(`${name}:\\s*([^;]+);`))?.[1]
    expect(value('--ink')).toBe(LOGO_COLORS.ink)
    expect(value('--bg')).toBe(LOGO_COLORS.ground)
    expect(value('--hole-core')).toBe(LOGO_COLORS.core)
  })
})
