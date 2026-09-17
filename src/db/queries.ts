import { and, asc, count, eq, sql } from 'drizzle-orm'
import type { DrizzleD1Database } from 'drizzle-orm/d1'
import { normalizeTheme, THEME_KEYS, type Theme, type ThemeKey } from '../theme'
import type { ItemView } from '../ui/components'
import * as schema from './schema'

export type Db = DrizzleD1Database<typeof schema>

const publicOrder = [asc(schema.items.sortOrder), asc(schema.items.id)]

export function listPublishedMembers(db: Db) {
  return db.query.members.findMany({
    where: eq(schema.members.published, 1),
    orderBy: [asc(schema.members.sortOrder), asc(schema.members.id)],
  })
}

export function findPublishedMember(db: Db, slug: string) {
  return db.query.members.findFirst({
    where: and(eq(schema.members.slug, slug), eq(schema.members.published, 1)),
  })
}

export async function listPublishedItems(db: Db, type: 'app' | 'work'): Promise<ItemView[]> {
  const rows = await db.query.items.findMany({
    where: and(eq(schema.items.type, type), eq(schema.items.published, 1)),
    orderBy: publicOrder,
    with: {
      tags: { orderBy: [asc(schema.itemTags.sortOrder)] },
      links: { orderBy: [asc(schema.itemLinks.sortOrder)] },
      member: true,
      platform: true,
    },
  })

  return rows.map((row) => {
    // 下書きのメンバーは名前も出さない。出すと、まだ公開していない人の名前が
    // カードに載り、404 になるプロフィールへ導いてしまう
    const member = row.member?.published === 1 ? row.member : null
    return {
      ...row,
      tags: row.tags.map((tag) => tag.tag),
      links: row.links.map((link) => ({ label: link.label, url: link.url })),
      platformLabel: row.platform?.label ?? null,
      memberName: member?.name ?? null,
      memberSlug: member?.slug ?? null,
    }
  })
}

// 絞り込みボタンは、公開中の Apps に実際に出てくるものだけ並べる。
// 空振りするボタンを置かないため
export function usedPlatforms(items: ItemView[], all: schema.Platform[]) {
  const used = new Set(items.map((item) => item.platformKey).filter(Boolean))
  return all.filter((platform) => used.has(platform.key))
}

export function listPlatforms(db: Db) {
  return db.query.platforms.findMany({ orderBy: [asc(schema.platforms.sortOrder)] })
}

export async function countMemberItems(db: Db, memberId: number) {
  const rows = await db
    .select({ type: schema.items.type, n: count() })
    .from(schema.items)
    .where(and(eq(schema.items.memberId, memberId), eq(schema.items.published, 1)))
    .groupBy(schema.items.type)

  return {
    app: rows.find((row) => row.type === 'app')?.n ?? 0,
    work: rows.find((row) => row.type === 'work')?.n ?? 0,
  }
}

/* ------------------------------------------------------------- 見た目 */

/*
  settings は key-value なので、見た目の3つは接頭辞を付けて置く。
  他の設定が増えても、この3行だけを拾えるようにするため。
*/
const THEME_PREFIX = 'theme.'

const settingKey = (key: ThemeKey) => `${THEME_PREFIX}${key}`

export async function loadTheme(db: Db): Promise<Theme> {
  const rows = await db.query.settings.findMany()
  const raw: Partial<Record<ThemeKey, string>> = {}
  for (const key of THEME_KEYS) {
    raw[key] = rows.find((row) => row.key === settingKey(key))?.value
  }
  return normalizeTheme(raw)
}

export async function saveTheme(db: Db, theme: Theme) {
  const updatedAt = new Date().toISOString()
  await db
    .insert(schema.settings)
    .values(THEME_KEYS.map((key) => ({ key: settingKey(key), value: theme[key], updatedAt })))
    .onConflictDoUpdate({
      target: schema.settings.key,
      set: { value: sql`excluded.value`, updatedAt },
    })
}
