import { describe, expect, it } from 'vitest'
import { num, paragraphs, parseCareer, parseSkills, parseTags, toSlug } from '../src/lib/format'

describe('parseSkills', () => {
  it('末尾が : の行でグループを分ける', () => {
    const groups = parseSkills('LANGUAGES:\nC# | 3年以上\nSwift\nINFRA:\nDocker')
    expect(groups).toEqual([
      {
        heading: 'LANGUAGES',
        skills: [
          { label: 'C#', note: '3年以上' },
          { label: 'Swift', note: '' },
        ],
      },
      { heading: 'INFRA', skills: [{ label: 'Docker', note: '' }] },
    ])
  })

  it('見出しの無い行だけでも落ちない', () => {
    expect(parseSkills('C#')).toEqual([{ heading: '', skills: [{ label: 'C#', note: '' }] }])
  })

  it('空文字なら空配列', () => {
    expect(parseSkills('')).toEqual([])
  })
})

describe('parseCareer', () => {
  it('1行を3つに割る', () => {
    expect(parseCareer('2024.03 — 現在 | システムエンジニア | リンクレア')).toEqual([
      { period: '2024.03 — 現在', title: 'システムエンジニア', org: 'リンクレア' },
    ])
  })

  it('足りない項目は空文字にする', () => {
    expect(parseCareer('2021.03 卒業')).toEqual([{ period: '2021.03 卒業', title: '', org: '' }])
  })
})

describe('paragraphs', () => {
  it('空行で段落を分ける', () => {
    expect(paragraphs('一段落目。\n続き。\n\n二段落目。')).toEqual([
      '一段落目。\n続き。',
      '二段落目。',
    ])
  })
})

describe('parseTags', () => {
  it('カンマで割り、空と重複を落とす', () => {
    expect(parseTags('Swift, SwiftUI , , Swift')).toEqual(['Swift', 'SwiftUI'])
  })
})

describe('toSlug', () => {
  it('URL に置ける形にする', () => {
    expect(toSlug('AppMixer for macOS')).toBe('appmixer-for-macos')
  })

  it('日本語だけなら空になる（呼び出し側で補う）', () => {
    expect(toSlug('岡崎 昂功')).toBe('')
  })
})

describe('num', () => {
  it('未入力は既定値', () => {
    expect(num('', 10)).toBe(10)
    expect(num(null, 10)).toBe(10)
  })

  it('数字でなければ既定値', () => {
    expect(num('abc', 10)).toBe(10)
  })

  it('0 は 0 のまま', () => {
    expect(num('0', 10)).toBe(0)
  })
})
