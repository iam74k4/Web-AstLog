import { describe, expect, it } from 'vitest'
import {
  isHttpsUrl,
  isSafeUrl,
  num,
  paragraphs,
  parseLines,
  parseSkills,
  parseTags,
  skillRows,
  toSlug,
  yearInJapan,
} from '../src/lib/format'

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

describe('skillRows', () => {
  it('添えごとの行にまとめる。添えは行に1度だけ、添えの無い項目は最後の行', () => {
    /*
      項目ごとに添えを出していたころは、同じ「3年以上」が画面に11回並んでいた。
      行の順は添えが最初に現れた順。添えの無い項目は、途中に書いてあっても
      最後の1行にまとめる
    */
    const [group] = parseSkills(
      'LANGUAGES:\nC# | 3年以上\nSQL | 3年以上\nPython | 1年以上\nTypeScript\nJavaScript | 3年以上\nSwift',
    )
    expect(skillRows(group?.skills ?? [])).toEqual([
      { note: '3年以上', labels: ['C#', 'SQL', 'JavaScript'] },
      { note: '1年以上', labels: ['Python'] },
      { note: '', labels: ['TypeScript', 'Swift'] },
    ])
  })

  it('添えの無い項目が先に来ても、行の順は添えの現れた順のまま', () => {
    const [group] = parseSkills('PRACTICE:\n生成AI\n設計 | 3年以上\nGit')
    expect(skillRows(group?.skills ?? [])).toEqual([
      { note: '3年以上', labels: ['設計'] },
      { note: '', labels: ['生成AI', 'Git'] },
    ])
  })

  it('空なら行も無い', () => {
    expect(skillRows([])).toEqual([])
  })
})

describe('parseLines', () => {
  it('1行を「|」で割る', () => {
    expect(parseLines('2024.03 — 現在 | システムエンジニア | リンクレア')).toEqual([
      ['2024.03 — 現在', 'システムエンジニア', 'リンクレア'],
    ])
  })

  it('足りない列はそのまま短い行として返す', () => {
    expect(parseLines('2021.03 卒業')).toEqual([['2021.03 卒業']])
  })

  it('空行は落とす', () => {
    expect(parseLines('A | 1\n\n  \nB | 2')).toEqual([
      ['A', '1'],
      ['B', '2'],
    ])
  })
})

describe('isSafeUrl', () => {
  it('http(s)・mailto・同じサイトの経路は通す', () => {
    expect(isSafeUrl('https://example.com')).toBe(true)
    expect(isSafeUrl('mailto:a@example.com')).toBe(true)
    expect(isSafeUrl('/members/okazaki')).toBe(true)
  })

  it('それ以外は通さない', () => {
    expect(isSafeUrl('javascript:alert(1)')).toBe(false)
    expect(isSafeUrl('example.com')).toBe(false)
    expect(isSafeUrl(undefined)).toBe(false)
  })

  it('プロトコル相対は「同じサイト」ではない', () => {
    // //evil.example はブラウザでは外部 URL。/ で始まるからと通すと、
    // 同じタブのまま外へ連れて行かれる
    expect(isSafeUrl('//evil.example')).toBe(false)
    expect(isSafeUrl('/\\evil.example')).toBe(false)
  })

  it('タブや改行を含む URL は通さない（ブラウザが取り除いたあとで外のサイトになる）', () => {
    // 「/<タブ>/evil.example」は頭の検査を通るが、ブラウザは //evil.example と読む
    expect(isSafeUrl('/\t/evil.example')).toBe(false)
    expect(isSafeUrl('/\n/evil.example')).toBe(false)
    expect(isSafeUrl('https://example.com/\r\nx')).toBe(false)
  })
})

describe('isHttpsUrl', () => {
  it('https:// の絶対 URL だけを通す（メンバーの GitHub と sameAs）', () => {
    expect(isHttpsUrl('https://github.com/iam74k4')).toBe(true)
    expect(isHttpsUrl('http://github.com/iam74k4')).toBe(false)
    expect(isHttpsUrl('github.com/iam74k4')).toBe(false)
    expect(isHttpsUrl('javascript:alert(1)')).toBe(false)
    expect(isHttpsUrl('/members/okazaki')).toBe(false)
    expect(isHttpsUrl('mailto:a@example.com')).toBe(false)
    expect(isHttpsUrl('https://')).toBe(false)
    expect(isHttpsUrl(null)).toBe(false)
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

describe('yearInJapan', () => {
  it('日本時間で年を数える。UTC の大晦日 15 時は、日本ではもう元日', () => {
    expect(yearInJapan(new Date('2026-12-31T14:59:59Z'))).toBe(2026)
    expect(yearInJapan(new Date('2026-12-31T15:00:00Z'))).toBe(2027)
  })
})
