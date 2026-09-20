import { describe, expect, it } from 'vitest'
import { chunk, screenCount } from '../src/lib/paginate'

/*
  画面の割りかたは境界だけが問題になる。ちょうど入るか、1件はみ出すか、
  1件も無いか。screenCount は chunk の長さと必ず一致していないと、
  「次の画面」へのリンクだけがある空の URL ができる。
*/
describe('chunk / screenCount', () => {
  it('ちょうど perScreen 件なら1画面', () => {
    expect(chunk(['a', 'b'], 2)).toEqual([['a', 'b']])
    expect(screenCount(2, 2)).toBe(1)
  })

  it('1件はみ出すと2画面。余りは次の画面へ', () => {
    expect(chunk(['a', 'b', 'c'], 2)).toEqual([['a', 'b'], ['c']])
    expect(screenCount(3, 2)).toBe(2)
  })

  it('0件なら空配列。空の画面は作らない', () => {
    // 0件なら節ごと出さない、に合わせる。[[]] を返すと空の画面が1つできる
    expect(chunk([], 2)).toEqual([])
    expect(screenCount(0, 2)).toBe(0)
  })
})
