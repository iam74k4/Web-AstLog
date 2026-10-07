import { type SQL, sql } from 'drizzle-orm'
import type { Db } from './queries'
import { editGuard } from './schema'

export const EDIT_CONFLICT =
  '別の画面で更新されています。入力内容は残しています。最新の内容と比較してから、最新の編集画面に変更を反映してください。'

export function editMatches(
  form: FormData,
  current: { updatedAt: string; createdAt: string },
  again = false,
) {
  const version = form.get('_version')
  return (
    version === current.updatedAt ||
    (again && version === 'new' && current.updatedAt === current.createdAt)
  )
}

export const nextUpdatedAt = (previous: string) =>
  new Date(Math.max(Date.now(), (Date.parse(previous) || 0) + 1)).toISOString()

// 検査と保存を別リクエストにしない。D1 batch の先頭に置き、競合なら batch 全体を中止する。
export const guardEdit = (db: Db, condition: SQL) =>
  db
    .insert(editGuard)
    .values({ id: 1, valid: sql`CASE WHEN ${condition} THEN 1 ELSE 0 END` })
    .onConflictDoUpdate({ target: editGuard.id, set: { valid: sql`excluded.valid` } })

export function isEditConflict(error: unknown): boolean {
  let current = error
  while (current instanceof Error) {
    if (current.message.includes('edit_version_matches')) return true
    current = current.cause
  }
  return false
}

export const settingsSnapshot = (prefix: 'site.' | 'theme.') =>
  sql<string>`(SELECT json_group_array(json_array(key, value, updated_at)) FROM (SELECT key, value, updated_at FROM settings WHERE key LIKE ${`${prefix}%`} ORDER BY key))`

export async function settingsVersion(db: Db, prefix: 'site.' | 'theme.') {
  const result = await db.get<{ version: string }>(
    sql`SELECT ${settingsSnapshot(prefix)} AS version`,
  )
  return result?.version ?? '[]'
}
