import { ONGOING_HINT } from './lib/format'

// 入力項目の定義は保存と描画で共有する。DB の本文形式は既存の公開部品と互換のまま。
export const BLOCK_COLUMNS: Record<string, readonly string[]> = {
  numbers: ['値', '単位', '説明'],
  links: ['ラベル', 'URL', '補足'],
  timeline: ['年月', '出来事', '補足'],
  now: ['取り組み', '補足'],
}

/*
  行ごとの入力欄に添える一文。列の名前だけでは伝わらない書き方。できごとは、年月が
  「現在」で終わる行が公開ページの星座のいまの星になる（src/lib/format.ts の isOngoing）
*/
export const BLOCK_ROW_NOTES: Record<string, string> = {
  timeline: ONGOING_HINT,
}

export function readBlockBody(form: FormData) {
  const columns = BLOCK_COLUMNS[String(form.get('type'))]
  if (!columns || !form.has('blockPart0')) return String(form.get('body') ?? '').trim()
  const fields = columns.map((_, index) => form.getAll(`blockPart${index}`).map(String))
  return Array.from({ length: Math.max(...fields.map((field) => field.length)) }, (_, index) =>
    fields.map((field) => (field[index] ?? '').trim()),
  )
    .filter((row) => row.some(Boolean))
    .map((row) => row.join(' | '))
    .join('\n')
}

export function blockRowError(form: FormData): Record<string, string> | null {
  const columns = BLOCK_COLUMNS[String(form.get('type'))]
  if (!columns || !form.has('blockPart0')) return null
  return columns.some((_, index) =>
    form.getAll(`blockPart${index}`).some((value) => /[|\r\n]/.test(String(value))),
  )
    ? { body: '各項目は1行で入力してください。「|」は使えません（文章中では「｜」を使えます）。' }
    : null
}

// エラー時は区切り文字へ戻さず、送られた各欄の値をそのまま描き直す。
export function readBlockRows(form: FormData): string[][] | undefined {
  const columns = BLOCK_COLUMNS[String(form.get('type'))]
  if (!columns || !form.has('blockPart0')) return undefined
  const fields = columns.map((_, index) => form.getAll(`blockPart${index}`).map(String))
  return Array.from({ length: Math.max(...fields.map((field) => field.length)) }, (_, row) =>
    fields.map((field) => field[row] ?? ''),
  )
}
