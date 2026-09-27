import { beforeEach, describe, expect, it } from 'vitest'
import adminCss from '../public/admin.css'
import css from '../public/app.css'
import { PROJECT_COLUMNS } from '../src/blocks'
import * as schema from '../src/db/schema'
import { ACCENTS, LAYOUTS, TYPEFACES } from '../src/theme'
import { db, form, get, okText, resetDb, seedItem, seedMember, signIn } from './helpers'

beforeEach(resetDb)

const save = async (values: Record<string, string>) => {
  const signed = await signIn()
  return signed('/admin/appearance', { method: 'POST', body: form(values) })
}

const MAGAZINE = { layout: 'magazine', accent: 'ember', typeface: 'serif' }

describe('見た目のプリセット', () => {
  it('何も選んでいなければ既定の姿で出す', async () => {
    const html = await okText('/')
    expect(html).toContain('data-layout="rail"')
    expect(html).toContain('data-accent="iris"')
    expect(html).toContain('data-typeface="sans"')
  })

  it('選んだものが公開ページに出る', async () => {
    const response = await save(MAGAZINE)
    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe('/admin/appearance?saved=1')

    const html = await okText('/')
    expect(html).toContain('data-layout="magazine"')
    expect(html).toContain('data-accent="ember"')
    expect(html).toContain('data-typeface="serif"')
  })

  it('個人ページも同じ姿になる', async () => {
    await seedMember()
    await save(MAGAZINE)

    const html = await okText('/members/okazaki')
    expect(html).toContain('data-layout="magazine"')
  })

  it('二度保存しても行が増えない', async () => {
    await save(MAGAZINE)
    await save({ layout: 'center', accent: 'mint', typeface: 'mono' })

    const rows = await db().select().from(schema.settings)
    expect(rows).toHaveLength(3)
    expect(await okText('/')).toContain('data-layout="center"')
  })

  it('知らない値は保存しない', async () => {
    const response = await save({ layout: 'chaos', accent: 'ember', typeface: 'serif' })
    expect(response.status).toBe(400)

    // 1つでも知らなければ、まとめて受け取らない
    const html = await okText('/')
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

    expect(await okText('/')).toContain('data-layout="rail"')
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
  中で値を差し替えるのは、骨格や幅ごとの正しい書き方なので上書きとは数えない。

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
      'scroll-padding-top: var(--band-clear)',
      'align-content: safe start',
    ]) {
      expect(() => ruleWith(frame, decl), decl).not.toThrow()
    }
  })
})

/*
  公開ページのレイアウトは app.css にしかない。骨格の1行が消えても TypeScript は
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

  it('画面1つぶんの高さを :root で持ち、読むのは .shell の min-height だけ', () => {
    // 値そのものを見る（'100svh' がどこかにある、では括りの条件にも当たる）
    expect(bodyOf(sheet, ':root {')).toContain('--screen-h: calc(100svh')
    expect(sheet).not.toContain('--screen-h: 100vh')

    /*
      height ではなく min-height。高さを決め打つと、中身が長い画面ではページの外へ
      切られる（以前はそれを避けるために中身を画面ごとに割っていた）。min-height
      なら、短い画面（入口と締めの表紙）は画面いっぱいに月を敷き、長い画面は
      ページごと伸びる。全体ページ（/all）は外枠の外
    */
    expect(sheet.match(/var\(--screen-h\)/g)).toHaveLength(1)
    const frame = blockAt(sheet, '@media screen')
    const shell = ruleWith(frame, 'min-height: var(--screen-h)')
    expect(shell.selector).toBe(':where(body[data-layout]:not([data-whole])) .shell')
  })

  it('帯の姿の .shell は縦の flex。grid の子の貼り付けは自分の段から出られない', () => {
    /*
      grid の子の position: sticky は、その子の grid area の中でしか動けない。
      帯（.rail）の段は auto＝帯そのものの高さなので、grid のままでは1px も貼り付かない。
      flex の子なら .shell 全体の中を動ける。柱が左に立つ rail の 900 以上だけは
      2列の grid に戻す（柱の area がページの高さいっぱいで、素の sticky が効く）
    */
    const frame = blockAt(sheet, '@media screen')
    const shell = bodyOf(frame, ':where(body[data-layout]:not([data-whole])) .shell {')
    expect(shell).toContain('display: flex')
    expect(shell).toContain('flex-direction: column')
    expect(bodyOf(frame, ':where(body[data-layout]:not([data-whole])) main {')).toContain(
      'flex: 1 0 auto',
    )
    const wide = blockAt(frame, '@media (min-width: 900px)')
    expect(ruleWith(wide, 'display: grid').selector).toBe(
      ":where(body[data-layout='rail']:not([data-whole])) .shell",
    )
  })

  it('節は grid で、残りの高さを受ける。flex のままだと寄せ方が黙って効かなくなる', () => {
    /*
      この1行が落ちると、すぐ下の align-content（節は上揃え、Hero は中央か下）が
      黙って効かなくなる。.hero は素で display: flex + flex-direction: column
      ——縦並びの flex では交差軸が横なので、align-content は上下ではなく左右を
      動かす指定に変わり、入口の字は表紙の上端から積まれたまま残る。
      flex: 1 0 auto が無いと、節は中身の高さで止まり、表紙が画面を満たさない
    */
    const frame = blockAt(sheet, '@media screen')
    const panel = ruleWith(frame, 'align-content: safe start')

    expect(panel.body).toContain('display: grid')
    expect(panel.body).toContain('flex: 1 0 auto')
    expect(panel.selector).toContain('main > :is(.hero, section)')
  })

  it('カードの説明は行数で切らない。タグと行き先も畳まない（一覧は1ページに縦に並ぶ）', () => {
    /*
      1画面に収めていたころは、説明を行数で止め（--card-lines）、電話と画像の行では
      タグと行き先を畳んでいた（--card-extras）。「何であるか。何をしたか。」の2文目が
      カードからほぼ読めない幅があった。いまは Projects が1ページで縦に伸びるので、
      カードは書いたぶんを全部出す。止める段が1つでも残ると、どこかの幅で黙って切れる
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
      跳ねていた（/projects 91px → /projects/2 124px → /projects/4 243px =
      rail @390x844）。節は上端から置き、見出しを錨にする。そろっていることは
      npm run check:fit が画素で測る（同じ骨格・寸法の中で 1px 以内）
    */
    const frame = blockAt(sheet, '@media screen')
    const panels = ':where(body[data-layout]:not([data-whole])) main > '
    expect(bodyOf(frame, `${panels}:is(.hero, section) {`)).toContain('align-content: safe start')

    /*
      Hero と月の節は錨を持たない表紙。月の無い Hero は中央（個人ページの名札は下の
      「最後の節だけが伸びる」で伸びないので、効くのは控えとして）、月のある入口と
      締めの Contact は下。上揃えの規則より後ろに置いて上書きする
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
    // 瞬間に上端を容器の外へ押し出す
    expect(frame).not.toMatch(/align-content: (center|end|start)/)
    expect(sheet).not.toContain('align-content: center')
  })

  it('節を2つ以上持つページでは、最後の節だけが残りの高さを受ける（名札を浮かせない）', () => {
    /*
      個人ページは 名札の Hero → About → Skills → Career を1ページに並べる。どの節も
      flex: 1 0 auto のままだと、中身の短い人のページで余った高さが節ごとに割り振られ、
      名札と About のあいだが空き、名札が画面の真ん中に浮く
    */
    const frame = blockAt(sheet, '@media screen')
    const rest = ruleWith(frame, 'flex-grow: 0')
    expect(rest.selector).toBe(
      ':where(body[data-layout]:not([data-whole])) main > :is(.hero, section):not(:last-child)',
    )
    // 伸びる規則より後ろ。前に置くと、後ろの flex: 1 0 auto に上書きされる
    expect(frame.indexOf(rest.selector)).toBeGreaterThan(
      frame.indexOf(':where(body[data-layout]:not([data-whole])) main > :is(.hero, section) {'),
    )
  })

  it('899 以下の帯は貼り付き、地を敷いて本文より手前に出る。貼り付く前の版面は動かさない', () => {
    const narrow = blockAt(blockAt(sheet, '@media screen'), '@media (max-width: 899px)')
    const band = bodyOf(narrow, ':where(body[data-layout]:not([data-whole])) .rail {')
    expect(band).toContain('position: sticky')
    expect(band).toContain('top: 0')
    expect(band).toContain('background: var(--bg)')
    /*
      z-index は 2。Hero と月の節の中身（月より前に出す 1）と、カードの中のリンク
      （覆いの上に出す 1）より上でないと、送った本文が帯の上に描かれる
    */
    expect(band).toContain('z-index: 2')
    expect(sheet.match(/z-index: 1;/g)?.length).toBeGreaterThan(0)
    expect(sheet).not.toMatch(/z-index: [3-9];/)
    // 空きは負の margin で戻す。戻さないと表紙が縮み、月の大きさと字の位置が変わる
    expect(band).toContain('margin-block: calc(var(--sp-3) * -1)')
    expect(band).toContain('padding-block: var(--sp-3)')
  })

  it('900 以上の上の帯（中央寄せ・雑誌風）も貼り付く。骨格の position: static に勝つ強さで', () => {
    const wide = blockAt(blockAt(sheet, '@media screen'), '@media (min-width: 900px)')
    const band = ruleWith(wide, 'position: sticky')
    // :where() で包むと (0,1,0) になり、骨格の body[data-layout='center'] .rail（0,2,1）に負ける
    expect(band.selector.split(/,\s*/)).toEqual([
      "body[data-layout='center']:not([data-whole]) .rail",
      "body[data-layout='magazine']:not([data-whole]) .rail",
    ])
    expect(band.body).toContain('background: var(--bg)')
    expect(band.body).toContain('z-index: 2')
    expect(band.body).toContain('margin-top: calc(var(--sp-3) * -1)')
    expect(band.body).toContain('padding-top: var(--sp-3)')
    // 外枠は柱を static に戻さない（以前はページが動かないので貼り付けを外していた）
    expect(blockAt(sheet, '@media screen')).not.toContain('position: static')
  })

  it('柱が左に立つ 900 以上の rail は、素の規則で貼り付き、画面より高ければ柱の中だけが動く', () => {
    // 最初の 900 以上の括りは素の骨格のもの（プリセットと外枠のものは後ろ）
    const wide = blockAt(sheet, '@media (min-width: 900px)')
    expect(wide).toContain('grid-template-columns: var(--nav-w) minmax(0, 1fr)')
    const rail = bodyOf(wide, '.rail {')
    expect(rail).toContain('position: sticky')
    expect(rail).toContain('align-self: start')
    expect(rail).toContain('max-height: calc(100dvh - var(--gutter) * 2)')
    expect(rail).toContain('overflow-y: auto')
  })

  it('送った先を帯の下に止める。空きは :root の段で、帯の姿ごとに差し替える', () => {
    const root = bodyOf(sheet, ':root {')
    expect(root).toMatch(/--band-clear: calc\(var\(--tap\)/)
    expect(root).toMatch(/--band-clear-wide: calc\(var\(--tap\) \* 2/)

    const frame = blockAt(sheet, '@media screen')
    expect(ruleWith(frame, 'scroll-padding-top: var(--band-clear)').selector).toBe(
      ':where(html:has(> body[data-layout]:not([data-whole])))',
    )
    const wide = blockAt(frame, '@media (min-width: 900px)')
    expect(ruleWith(wide, 'scroll-padding-top: var(--band-clear-wide)').selector).toContain(
      "body[data-layout='center']",
    )
    expect(ruleWith(wide, 'scroll-padding-top: var(--sp-7)').selector).toContain(
      "body[data-layout='rail']",
    )
    // なめらかに送るのは公開ページだけ。reduced-motion の素の html に譲る詳細度 0
    expect(bodyOf(sheet, ':where(html:has(> body[data-layout])) {')).toContain(
      'scroll-behavior: smooth',
    )
  })

  it('[hidden] の打ち消しを持つ', () => {
    // 節に display を与えるので、打ち消さないと hidden を付けた節が見えてしまう
    expect(sheet).toContain(':is(.hero, section)[hidden]')
  })

  it('狭い画面では、柱だけでなく名札の中身も横帯にする', () => {
    // 柱を横に寝かせるだけでは足りない。名札の中身が縦積みのままだと帯が
    // 何段にも伸び、貼り付いた帯が画面の上を食う（個人ページ専用の名札だった
    // ころは帯だけで 188.7px = rail @390x844, Hiragino Sans, macOS Chromium）
    const narrow = blockAt(blockAt(sheet, '@media screen'), '@media (max-width: 899px)')

    expect(narrow).toContain('.identity {')
    const band = narrow.slice(narrow.indexOf('.identity {'))
    expect(band.slice(0, band.indexOf('}'))).toContain('flex-direction: row')

    // 帯に入らないものは畳む（肩書き・ひとこと・柱の GitHub / メール）
    expect(narrow).toContain('.identity__role')
    expect(narrow).toContain('.identity__tagline')
  })

  it('全体ページの body にだけ、外枠を外す印が付く', async () => {
    // CSS 側はこの印だけを頼りに /all を除いている。印が消えると全体ページにも
    // 表紙の高さと貼り付く帯（目次は1行の横帯）が掛かる
    expect(await okText('/all')).toContain('data-whole=""')

    await seedMember()
    expect(await okText('/members/okazaki')).not.toContain('data-whole')
  })

  it('柱を上の帯にする骨格は、名札の中身も横に寝かせる', () => {
    /*
      中央寄せと雑誌風は 900 以上でも柱を左に立てない（列を1つに戻している）。
      名札が縦積みのまま残ると、それだけで約237px——トップの帯 30.1px の約8倍
      （rail @390x844）——を取り、貼り付いた帯が画面の上の3割近くを食う。
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
      メールの札で 40px）・目次（28px）・足元（11px の字1行）——の箱の下端だけが
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

      切れた先に気づく手がかりはこのぼかししか無い。帯は横にしか動かず、
      タッチ端末ではスクロールバーも出ない。
    */
    const narrow = blockAt(blockAt(sheet, '@media screen'), '@media (max-width: 899px)')
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
      （900 以上の上の帯は骨格を名指しした (0,3,1) で書く——別の検査）

      ほかは外さない。骨格のプリセットが後から部品を上書きする書き方なので、
      外枠の側が強いと、プリセットの差し替えが黙って効かなくなる。
    */
    const frame = blockAt(sheet, '@media screen')
    expect(frame.match(/^\s*body\[data-layout\]/gm) ?? []).toHaveLength(1)
    expect(ruleWith(frame, 'flex-wrap: nowrap').selector).not.toContain(':where(')
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
/*
  F5（TEST-2）で上限ちょうどの中身を測って見つかった溢れの直し。値の出どころと
  付け先をここで見張り、効いているかは npm run check:fit が 27通りで測る。
*/
describe('上限ちょうどの中身で収めるための組み方', () => {
  const frame = () => blockAt(sheet, '@media screen')

  it('上の帯の目次は 900 以上でも1行で、帯の行の残りを取る（件数で帯を伸ばさない）', () => {
    const wide = blockAt(frame(), '@media (min-width: 900px)')
    const toc = ruleWith(wide, 'flex: 1 1 0')
    expect(toc.selector).toContain("body[data-layout='center']:not([data-whole]) .toc")
    expect(toc.selector).toContain("body[data-layout='magazine']:not([data-whole]) .toc")
    for (const decl of ['min-width: 0', 'flex-wrap: nowrap', 'mask-image: var(--fade-right)']) {
      expect(toc.body).toContain(decl)
    }
  })

  it('上の帯の職種は1行のまま末尾を省く（長い職種で帯を2段にしない）', () => {
    const wide = blockAt(frame(), '@media (min-width: 900px)')
    const role = ruleWith(wide, 'max-width: var(--role-w)')
    expect(role.selector).toContain('.identity__role')
    expect(role.body).toContain('text-overflow: ellipsis')
    expect(role.body).toContain('white-space: nowrap')
    expect(bodyOf(sheet, ':root {')).toMatch(/--role-w: \d+em/)
  })

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

  it('柱の足元のリンクは、著作権表示と見分けが付く', () => {
    /*
      素の a は color: inherit / text-decoration: none。全体ページへの1本を
      .rail__footer に置くだけでは、隣の「© 2026 Noctifex」とまったく同じ姿に
      なり、押せるものだと分からない（色の違いすら無い状態）。
      当たり判定（min-height: var(--tap)）は付けない——柱が 40px 伸び、
      中央寄せと雑誌風の 900 以上では、その 40px がそのまま貼り付いた帯を伸ばす。
    */
    expect(bodyOf(sheet, '.rail__footer a {')).toContain('text-decoration: underline')
    expect(bodyOf(sheet, '.rail__footer a {')).toContain('color: var(--ink-mid)')
    expect(bodyOf(sheet, '.rail__footer a {')).not.toContain('min-height')
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

  it('カードのフォーカスはカード全体に、縁の内側に描く', () => {
    /*
      押せる面はカード全体なので、輪郭もカード全体。題の字に描いたままだと、
      輪郭だけが字幅に縮む。外へ離して描くと、並んだカードの間隔の中に輪郭が
      出て、どちらのカードを囲んでいるのか読み分けにくい
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
    // 手触りの列（.pill-cta:active から始まる1本）。管理画面の部品の列は admin.css に同じ形で
    const head = sheet.indexOf('.pill-cta:active,')
    const list = sheet.slice(head, sheet.indexOf('{', head))
    expect(bodyOf(sheet, '.pill-cta:active,')).toContain('scale: var(--press)')
    expect(list).toContain('.back:active')
    expect(list).not.toContain(':has(')
    expect(bodyOf(adminSheet, '.btn:active,')).toContain('scale: var(--press)')
    expect(bodyOf(sheet, '.card:has(.card__link:active) {')).toContain('scale: var(--press)')
  })

  it('「← 一覧に戻る」は丸い札。列いっぱいに伸びず、当たり判定は --tap', () => {
    // 節は grid。子の inline-flex は blockify され、既定の stretch で幅いっぱいに伸びる
    const pill = bodyOf(sheet, '.back {')
    expect(pill).toContain('justify-self: start')
    // pointer: coarse では --tap が 44px になる。ここで生の高さを書かない
    expect(pill).toContain('min-height: var(--tap)')
    // 見出しの上に立つので、見出しから離す
    expect(pill).toContain('margin-bottom')
    // 紙の上では押せない
    expect(ruleWith(blockAt(sheet, '@media print'), 'display: none').selector).toContain('.back')
    // 押して縮み、ホバーで地が明るくなる
    const head = sheet.indexOf('.pill-cta:active,')
    expect(sheet.slice(head, sheet.indexOf('{', head))).toContain('.back:active')
    expect(
      ruleWith(
        blockAt(sheet, '@media (hover: hover)'),
        'background: var(--surface-hover);\n    color: var(--ink);',
      ).selector,
    ).toContain('.back:hover')
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
    const band = "body[data-layout='center'] .hero:not(.hero--profile) > .band,"
    const at = sheet.indexOf(band)
    const centred = sheet.slice(at, sheet.indexOf('{', at))
    expect(bodyOf(sheet, band)).toContain('justify-self: center')
    expect(centred).toContain("body[data-layout='center'] .hero__whole")
    expect(centred).not.toContain('.back')
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
    expect(bodyOf(sheet, '.head :is(h1, h2) {')).toContain('font-size: var(--fs-display-xs)')

    /*
      Contact の見出しは、ページごとの URL では読み上げ用の .sr-only、全体ページでは
      .head（SectionHead）。専用の見出しの規則は持たない——持つと、ページに出ない
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
    const frame = blockAt(sheet, '@media screen')
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

  it('入口の下の余白は、浮かび上がりのずれ以上に取る。途中でページを伸ばさない', () => {
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
    const narrow = blockAt(blockAt(sheet, '@media screen'), '@media (max-width: 899px)')
    const fold = ruleWith(narrow, 'display: none')

    expect(fold.selector).toContain('.identity .socials')
    // 柱の外に置いた .socials（Contact の画面）まで消さない
    expect(fold.selector).not.toContain('[data-whole])) .socials')
    expect(fold.selector).toContain('.identity__role')
    // 本文の側の名札（個人ページの頭）は幅で畳まない。そこにしか顔が無い
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
    const narrow = blockAt(blockAt(sheet, '@media screen'), '@media (max-width: 899px)')
    const hide = bodyOf(narrow, '.identity--named .brand__word {')
    expect(hide).toContain('position: absolute')
    expect(hide).toContain('clip-path: inset(50%)')
    expect(hide).not.toContain('display: none')
    expect(narrow).not.toContain(':not([data-whole])) .brand__word {')

    // 名前は1行のまま。2段に折れると貼り付いた帯が伸び、画面の上を食う
    expect(bodyOf(narrow, ' .identity__name {')).toContain('white-space: nowrap')
  })

  it('経歴とできごとの罫線は行のあいだだけ。見出しの線と2本並べない', () => {
    // 1行目の上にも引いていたころ、見出しの線のすぐ下にもう1本の罫線が並んでいた
    expect(bodyOf(sheet, '.career li {')).not.toContain('border-top')
    expect(bodyOf(sheet, '.career li + li {')).toContain('border-top: 1px solid var(--line)')
  })

  it('行き先の列は折り返した行のあいだを空けない。札の的の高さが行の間隔', () => {
    // --sp-4 を足していたころ、2行に折れた行き先の行の間が 52px 開いていた
    const links = bodyOf(sheet, '.links {')
    expect(links).toContain('gap: 0 var(--sp-4)')
    expect(bodyOf(sheet, '.links a {')).toContain('min-height: var(--tap)')
  })

  it('カードのサムネイルはどの幅でも出す。空の枠だけは 600 未満で出さない。縦横比は :root の段', () => {
    /*
      1画面に収めていたころは 600 未満で畳んでいて、電話の一覧には作品の絵が
      どこにも無かった。一覧は縦に読むので出す。行をそろえる空の枠（中身の無い
      span）は、カードが1列に積まれる 600 未満ではそろえる相手が居ないので出さない
    */
    const thumb = bodyOf(sheet, '.card__thumb {')
    expect(thumb).toContain('display: block')
    expect(thumb).toContain('aspect-ratio: var(--thumb-ratio)')
    // 縦横比の箱は既定では中身の高さまで伸びる。読み込んだ絵が 120px の枠を 300px にしていた
    expect(thumb).toContain('min-height: 0')
    expect(bodyOf(sheet, '.card__thumb:empty {')).toContain('display: none')
    expect(bodyOf(blockAt(sheet, '@media (min-width: 600px)'), '.card__thumb:empty {')).toContain(
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

  it('指のときは入口の「すべてを1ページで読む →」も --tap の的', () => {
    // 字の1行ぶん（22px）だった。899 以下では柱の足元の1本を畳むので、指の画面で
    // 全体ページへ行く手はこれだけになる
    const coarse = blockAt(sheet, '@media (pointer: coarse)')
    const whole = bodyOf(coarse, '.hero__whole {')
    expect(whole).toContain('min-height: var(--tap)')
    expect(whole).toContain('align-items: center')
  })

  it('目次のいまのページは、帯の見えている幅の中で開く（帯のときだけ）', () => {
    /*
      JavaScript が無いので、帯は何もしなければいつも左端で開き、並びの後ろの
      節に着くと印が帯の外に出ていた。scroll-initial-target は帯の姿（899 以下と、
      上の帯になる骨格の 900 以上）にだけ掛ける——柱が縦に立つ rail では、
      いちばん近いスクロール容器が柱そのものになり、柱を縦に送ってしまう
    */
    const frame = blockAt(sheet, '@media screen')
    const narrow = blockAt(frame, '@media (max-width: 899px)')
    const wide = blockAt(frame, '@media (min-width: 900px)')
    for (const block of [narrow, wide]) {
      const marker = ruleWith(block, 'scroll-initial-target: nearest')
      expect(marker.selector).toContain(".toc a[aria-current='page']")
      // 右端のぼかしの下に座らせない
      expect(marker.body).toContain('scroll-margin-inline: var(--sp-6)')
    }
    expect(ruleWith(wide, 'scroll-initial-target: nearest').selector).not.toContain('rail')
    // 素の外では掛けない（rail の縦の柱に当たる）
    expect(sheet.split('scroll-initial-target').length).toBe(3)
    /*
      900 以上の上の帯は、素の 900 以上の .toc { overflow: visible }（縦の柱のため）を
      受けたままではスクロール容器にならず、溢れた行き先がぼかしの外で切られていた
    */
    expect(ruleWith(wide, 'flex: 1 1 0').body).toContain('overflow-x: auto')
  })

  it('全体ページの雑誌風の目次は折り返す（ページを横に動かさない）', () => {
    // 900 以上の雑誌風の .toc は素の overflow: visible を受ける。折り返さないと、
    // はみ出しが目次の中ではなくページの幅になった（scrollWidth 1550 = @1440x900）
    const wraps = rulesOf(sheet).filter(
      (rule) =>
        rule.selectors.includes("body[data-layout='magazine'] .toc") &&
        rule.decls.some(([name, value]) => name === 'flex-wrap' && value === 'wrap'),
    )
    expect(wraps).toHaveLength(1)
    expect(wraps[0]?.context).toEqual(['@media (min-width: 900px)'])
    expectNotOverridden(sheet, wraps[0]?.start ?? -1)
  })

  it('中央寄せでも、個人ページの頭（名札・大見出し）は本文の列と同じ左の軸に立てる', () => {
    /*
      個人ページは1ページで、頭のすぐ下に About・Skills・Career の本文が続く。
      頭だけを中央に組んでいたころ（中央寄せ @1440x900）は、中央の大見出しから
      左の About へ読む目が斜めに飛んでいた。中央に組むのは入口の表紙だけ
    */
    const head = "body[data-layout='center'] .rail,"
    const at = sheet.indexOf(head)
    const selector = sheet.slice(at, sheet.indexOf('{', at))
    expect(bodyOf(sheet, head)).toContain('align-items: center')
    expect(selector).toContain("body[data-layout='center'] .hero:not(.hero--profile)")
    expect(selector).not.toMatch(/\.hero\s*(,|$)/)
    expect(sheet).toContain("body[data-layout='center'] .hero:not(.hero--profile) p {")
    // 全体ページの Profile の大見出し（Statement）も、名札と同じ左の軸
    expect(
      bodyOf(sheet, "body[data-layout='center'] .statement:not(.profile > .statement) {"),
    ).toContain('align-items: center')
    // 名札・その人の GitHub / メールを中央へ寄せる規則は無い
    expect(sheet).not.toMatch(/body\[data-layout='center'\] \.nameplate/)
    expect(sheet).not.toMatch(/body\[data-layout='center'\] \.hero > \.socials/)
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

  列の数はサーバーが決める（src/blocks.ts の PROJECT_COLUMNS）。CSS の auto-fill に
  任せると「広い画面ほど本文が細る」になり、CSS を見ても HTML を見ても気づけない。
*/
describe('一覧の列数', () => {
  it('列を数える規則は CSS に無い（サーバーが渡した数を読むだけ）', () => {
    /*
      前は repeat(auto-fill, minmax(276px, 1fr))。画面が広いほど列が増えるので、
      2件しか出さない画面でも3列ぶんの幅で割られ、説明の本文が 229px まで
      細っていた（= rail @1440x900, Hiragino Sans, macOS Chromium。電話 390 の
      308px より狭い）。雑誌風は5列で 243px。
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

  it('その数は PROJECT_COLUMNS そのもの', async () => {
    await seedItem({ title: 'アプリ' })
    await seedItem({ title: '業務', type: 'work' })

    const cols = `<div class="grid" style="--cols:${PROJECT_COLUMNS}">`
    expect(await okText('/projects')).toContain(cols)
    // 全体ページも同じ。ここだけ別の数にすると、1枚の中で列の幅が変わる
    expect(await okText('/all')).toContain(cols)
  })

  it('渡さない一覧を作らない（渡し忘れると列が1つに落ちる）', async () => {
    await seedItem({ title: 'アプリ' })
    const html = await okText('/projects')
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
    expect(
      bodyOf(
        sheet,
        "body[data-layout='magazine'] .head:not(.head--sub, .head--chapter) :is(h1, h2) {",
      ),
    ).toContain('font-size: var(--fs-display-sm)')
    /*
      個人ページの章（About / Skills / Career の h2）も雑誌風で上げない。上げていた
      ころは頭の大見出し（h1。--fs-display-sm）と同じ大きさで、字の重さでは h1 を
      越えていた（= magazine @1440x900）。章の上は1段空ける
    */
    expect(bodyOf(sheet, '.hero h1.hero__headline {')).toContain('font-size: var(--fs-display-sm)')
    expect(bodyOf(sheet, '.head--chapter {')).toContain('margin-top: var(--sp-7)')
    /*
      小節の見出し（作品のページの Story の h2、/all の Profile の h3）は、節の見出しより
      小さく本文より大きい。雑誌風でも上げない（上げると作品名の h1 と同じ格に見える）
    */
    expect(bodyOf(sheet, '.head--sub :is(h2, h3) {')).toContain('font-size: var(--fs-lg)')
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
  入口の背景の月。装飾だが、置き方を1行間違えるとページが横に動く（光暈と
  ずらした三日月がはみ出す）場所なので、外枠と同じ強さで見張る。
*/
describe('入口の月', () => {
  it('溢れは clip で切る。hidden にも auto にもしない', () => {
    /*
      三日月は光暈のぶん左へずらし、光暈は三日月の箱より外へ広がる。clip 以外
      だと溢れがページのスクロール可能領域になり、電話でページが横に動く。
      hidden は「見えないだけのスクロール箱」で、しかもスクロールバーが
      出ないので誰も戻せない。
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

  it('月の濃さは :root の1つが持つ', () => {
    /*
      三日月は見出しの後ろを通る。見出し #f2f2f4 に 3:1 を残せる地は 140/255
      までで、月の点のいちばん明るい所は 255。濃さを選択子側に生で書くと、
      この上限がどこにも書かれていない数になる。
    */
    expect(blockAt(sheet, ':root {')).toContain('--moon-ink:')
    expect(bodyOf(sheet, '.moon__mark::after {')).toContain('opacity: var(--moon-ink)')
  })

  it('はっきり見たい設定と、背の低い窓では出さない', () => {
    /*
      forced-colors（Windows のハイコントラスト）は文字だけをシステム色に
      置き換え、画像は置き換えない。何もしないと、いちばん読みやすくしたい
      設定で、白い月の上に白い文字だけが残る。
      背の低い窓（400px 未満）では、貼り付いた帯を除いた表紙が月を絵として
      置けるほど高くならない。
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
    const html = await okText('/')
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
