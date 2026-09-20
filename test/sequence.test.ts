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
    expect(seq?.pager?.total).toBe(4)
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
      next: '/apps',
      index: 1,
      total: 4,
    })
    expect(sequence(STEPS, 3)?.pager?.next).toBeNull()
  })

  it('1枚しか無ければページャそのものを出さない', () => {
    expect(sequence([step('contact', '/contact')], 0)?.pager).toBeNull()
  })

  it('範囲の外は「その URL は無い」。-1 も同じ', () => {
    expect(sequence(STEPS, 4)).toBeNull()
    expect(sequence(STEPS, -1)).toBeNull()
  })

  it('連なりの外の行き先は目次のいちばん最後', () => {
    const seq = sequence(STEPS, 0, [{ href: '/apps?member=okazaki', label: 'Apps · Works' }])
    expect(seq?.nav.at(-1)?.label).toBe('Apps · Works')
    // めくって着く先ではないので、ページャの数には入らない
    expect(seq?.pager?.total).toBe(4)
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
