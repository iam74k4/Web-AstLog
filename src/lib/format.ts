/*
  DB に文字列で持っているものを、表示用の形に開く。

  スキルと経歴を子テーブルにしていないのは、並べて出す以外の使い道が
  無いため。入力は1行1件のテキストエリアで受ける。
*/

export type SkillGroup = { heading: string; skills: { label: string; note: string }[] }

// 末尾が : の行はグループ見出し。それ以外は「表示名 | 補足」
export function parseSkills(text: string): SkillGroup[] {
  const groups: SkillGroup[] = []
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    if (trimmed.endsWith(':')) {
      groups.push({ heading: trimmed.slice(0, -1).trim(), skills: [] })
      continue
    }
    const [label, note] = trimmed.split('|').map((part) => part.trim())
    if (!label) continue
    if (groups.length === 0) groups.push({ heading: '', skills: [] })
    groups[groups.length - 1]?.skills.push({ label, note: note ?? '' })
  }
  return groups
}

export type CareerEntry = { period: string; title: string; org: string }

// 1行 = 「期間 | 肩書き | 所属」
export function parseCareer(text: string): CareerEntry[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [period, title, org] = line.split('|').map((part) => part.trim())
      return { period: period ?? '', title: title ?? '', org: org ?? '' }
    })
}

// 空行で段落を分ける
export function paragraphs(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((part) => part.trim())
    .filter(Boolean)
}

export function initials(name: string): string {
  return name.trim().slice(0, 1).toUpperCase() || '·'
}

// フォームから来る値。ファイルも混ざるので、文字列以外は空として扱う
type FormValue = string | File | null | undefined

export function str(value: FormValue): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function num(value: FormValue, fallback = 0): number {
  const parsed = Number(str(value))
  return Number.isFinite(parsed) ? parsed : fallback
}

export function bool(value: FormValue): number {
  return str(value) ? 1 : 0
}

// 「Swift, SwiftUI, Core Audio」→ 配列。重複と空白は落とす
export function parseTags(value: string): string[] {
  const seen = new Set<string>()
  for (const tag of value.split(',').map((part) => part.trim())) {
    if (tag) seen.add(tag)
  }
  return [...seen]
}

// 人が打った文字列から slug を作る。既に入っていればそれを尊重する
export function toSlug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
}
