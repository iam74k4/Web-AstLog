import { describe, expect, it } from 'vitest'
import { type Step, sequence, stepAt } from '../src/lib/sequence'

/*
  画面の連なり。トップも個人ページも、この1本で「いま何枚目か」を決めている。

  ここが壊れると、めくる先・目次の印・通し番号・canonical が同時に狂う。
  DOM も DB も要らない純関数なので、境界だけを直接突く（src/lib/paginate.ts の
  テストと同じ形）。
*/

// 目次に出る画面。同じ navKey は「1つのブロックを割った続き」を意味する
const step = (navKey: string, href: string, nav: string | null = navKey): Step => ({
  navKey,
  href,
  canonical: href,
  nav,
  title: `${navKey} — Noctifex`,
})

const STEPS: Step[] = [
  step('hero', '/', null),
  step('apps', '/apps'),
  step('apps', '/apps/2'),
  step('contact', '/contact'),
]

describe('画面の連なり', () => {
  it('目次は navKey ごとに1行。行き先はその最初の1枚', () => {
    const seq = sequence(STEPS, 0)
    expect(seq?.nav.map((item) => item.href)).toEqual(['/apps', '/contact'])
    // Apps · Apps と同じ見出しが数だけ増えない。2画面目は目次に並ばない
    expect(seq?.nav).toHaveLength(2)
  })

  it('目次に出ないものがある（Hero・ひとこと）。列には並ぶのでめくれば着く', () => {
    const seq = sequence(STEPS, 0)
    expect(seq?.nav.some((item) => item.label === 'hero')).toBe(false)
    // 列には居るので、次で着く
    expect(seq?.pager?.next).toBe('/apps')
  })

  it('ブロックの2画面目でも、その見出しに印が残る', () => {
    const seq = sequence(STEPS, 2)
    expect(seq?.current.href).toBe('/apps/2')
    // 印は URL ではなく navKey で付く。/apps/2 は Apps の続きなので Apps に付く
    expect(seq?.nav.filter((item) => item.active).map((item) => item.label)).toEqual(['apps'])
  })

  it('端ではめくる先を出さない。押しても何も起きない手を置かない', () => {
    expect(sequence(STEPS, 0)?.pager).toEqual({
      prev: null,
      prevSection: null,
      next: '/apps',
      // 次は別の節なので行き先を名乗る
      nextSection: 'apps',
      // Hero は目次に出ない＝名前を持たないので、節としては名乗らない
      section: null,
      index: 1,
      total: 1,
    })
    expect(sequence(STEPS, 3)?.pager?.next).toBeNull()
  })

  /*
    数えるのは節の中。全体の通し番号にしない理由は sequence.ts に書いてある
    （絞り込みが無関係な画面の番号を動かしていた）。
  */
  it('数えるのは節の中。全体の通し番号ではない', () => {
    // /apps は Apps の1枚目。Apps は2画面ある
    expect(sequence(STEPS, 1)?.pager).toMatchObject({ section: 'apps', index: 1, total: 2 })
    // /apps/2 は同じ節の2枚目。列の中では3番目だが、そこは数えない
    expect(sequence(STEPS, 2)?.pager).toMatchObject({ section: 'apps', index: 2, total: 2 })
    // Contact は1画面しか無いので 1 / 1
    expect(sequence(STEPS, 3)?.pager).toMatchObject({ section: 'contact', index: 1, total: 1 })
  })

  it('節をまたぐ手だけが行き先を名乗る', () => {
    // 節の中の移動は名乗らない（「次 →」のまま）
    expect(sequence(STEPS, 1)?.pager?.nextSection).toBeNull()
    // 節をまたぐときは名乗る。予告なく別の節へ出るのを止めるため
    expect(sequence(STEPS, 2)?.pager?.nextSection).toBe('contact')
    expect(sequence(STEPS, 3)?.pager?.prevSection).toBe('apps')
    expect(sequence(STEPS, 2)?.pager?.prevSection).toBeNull()
  })

  it('1枚しか無ければページャそのものを出さない', () => {
    expect(sequence([step('contact', '/contact')], 0)?.pager).toBeNull()
  })

  it('範囲の外は「その URL は無い」。-1 も同じ', () => {
    expect(sequence(STEPS, 4)).toBeNull()
    expect(sequence(STEPS, -1)).toBeNull()
  })

  it('継ぎ合わせた列では、継ぎ目の手が隣の連なりの節を名乗る', () => {
    /*
      個人ページは Team の直後に差し込んだ列でめくる（renderMemberScreen）。
      1枚目の「←」は Team を、最後の「→」は Contact を名乗る——「← 前」の
      ままだと、別の連なりへ出ることが押す前に分からない
    */
    const spliced = [
      step('team', '/team', 'Team'),
      step('member:', '/members/okazaki', '岡崎 昂功'),
      step('member:about', '/members/okazaki/about', 'About'),
      step('contact', '/contact', 'Contact'),
    ]
    const first = sequence(spliced, 1)?.pager
    expect(first?.prevSection).toBe('Team')
    expect(first?.nextSection).toBe('About')
    const last = sequence(spliced, 2)?.pager
    expect(last?.prevSection).toBe('岡崎 昂功')
    expect(last?.nextSection).toBe('Contact')
    expect(last?.next).toBe('/contact')
  })
})

/*
  目次のまとめ単位（tocKey）は、節（navKey）より大きくてよい。

  1人のサイトでは Team の代わりにその人の画面（1枚目・About・Skills・Career）が
  サイトの列に入る。ページャは節ごとに名乗る（「About →」）が、目次は「Profile」の
  1行にまとめる——節をそのまま並べると柱の目次が倍に伸び、899 以下の帯に入らない。
*/
describe('目次のまとめ単位', () => {
  const profile = (navKey: string, href: string, nav: string): Step => ({
    ...step(navKey, href, nav),
    tocKey: 'profile',
    tocLabel: 'Profile',
  })
  const SOLO: Step[] = [
    step('hero', '/', null),
    step('projects', '/projects', 'Projects'),
    profile('member:', '/members/okazaki', '岡崎 昂功'),
    profile('member:about', '/members/okazaki/about', 'About'),
    profile('member:career', '/members/okazaki/career', 'Career'),
    profile('member:career', '/members/okazaki/career/2', 'Career'),
    step('contact', '/contact', 'Contact'),
  ]

  it('tocKey ごとに1行。名前は tocLabel、行き先はそのまとまりの最初の1枚', () => {
    expect(sequence(SOLO, 0)?.nav).toEqual([
      { href: '/projects', label: 'Projects', active: false },
      { href: '/members/okazaki', label: 'Profile', active: false },
      { href: '/contact', label: 'Contact', active: false },
    ])
  })

  it('まとまりのどの画面でも、その行に印が付く', () => {
    for (const index of [2, 3, 4, 5]) {
      const marked = sequence(SOLO, index)?.nav.filter((item) => item.active)
      expect(marked, SOLO[index]?.href).toEqual([
        { href: '/members/okazaki', label: 'Profile', active: true },
      ])
    }
  })

  it('ページャの数え方と名乗りは節（navKey / nav）のまま', () => {
    // Projects の最後の「次」は、プロフィールの1枚目を名前で名乗る
    expect(sequence(SOLO, 1)?.pager?.nextSection).toBe('岡崎 昂功')
    // 1枚目の次は About。同じ Profile の中でも節が違えば名乗る
    expect(sequence(SOLO, 2)?.pager?.nextSection).toBe('About')
    // Career は2画面で 1 / 2、2 / 2。Profile 全体（4枚）では数えない
    expect(sequence(SOLO, 4)?.pager).toMatchObject({ section: 'Career', index: 1, total: 2 })
    expect(sequence(SOLO, 5)?.pager).toMatchObject({ index: 2, total: 2, nextSection: 'Contact' })
  })

  it('tocLabel が null の画面は目次に出ない。印は同じ tocKey の行に付く', () => {
    // 2人以上のサイトの個人ページ。ページャでは名乗るが、目次の行は持たず Team に印
    const spliced: Step[] = [
      step('team', '/team', 'Team'),
      { ...step('member:', '/members/okazaki', '岡崎 昂功'), tocKey: 'team', tocLabel: null },
      step('contact', '/contact', 'Contact'),
    ]
    const seq = sequence(spliced, 1)
    expect(seq?.nav.map((item) => item.label)).toEqual(['Team', 'Contact'])
    expect(seq?.nav.find((item) => item.active)?.label).toBe('Team')
    expect(seq?.pager?.prevSection).toBe('Team')
  })

  it('名前の無い1枚が先に居ても、まとまりの行は後ろの名前のある1枚から作る', () => {
    const late: Step[] = [
      { ...step('a', '/a', null), tocKey: 'group' },
      { ...step('b', '/b', 'B'), tocKey: 'group', tocLabel: 'Group' },
    ]
    expect(sequence(late, 0)?.nav).toEqual([{ href: '/b', label: 'Group', active: true }])
  })
})

describe('URL から画面を引く', () => {
  it('名指しが無ければ先頭。どちらの連なりも入口は1枚目', () => {
    expect(stepAt(STEPS, null)).toBe(0)
  })

  it('URL が一致した画面。知らない URL は -1', () => {
    expect(stepAt(STEPS, '/apps/2')).toBe(2)
    expect(stepAt(STEPS, '/nope')).toBe(-1)
  })
})

/*
  列の前提は「1つの URL は1度だけ」（PUB-1 / SYS-4）。固定のブロックが二重送信で
  2行になったとき、/projects が列に2度並び、1つ目の「次」が自分自身を指して
  入口から先へ進めなくなった。重なりは黙って落とさず、例外にする（理由は
  src/lib/sequence.ts の assertUniqueHrefs）。
*/
describe('URL の重なり', () => {
  it('同じ URL が2度並んだ列は、組む前に例外にする（黙って自分自身を指さない）', () => {
    const doubled: Step[] = [
      step('hero', '/', null),
      step('projects', '/projects'),
      step('contact', '/contact'),
      step('projects', '/projects'),
    ]
    expect(() => sequence(doubled, 0)).toThrow('/projects')
  })

  it('重なりの無い列はそのまま組める。次は自分以外を指す', () => {
    for (const [index, current] of STEPS.entries()) {
      const pager = sequence(STEPS, index)?.pager
      expect(pager?.next, current.href).not.toBe(current.href)
      expect(pager?.prev, current.href).not.toBe(current.href)
    }
  })
})
