import { and, asc, count, eq, sql } from 'drizzle-orm'
import type { DrizzleD1Database } from 'drizzle-orm/d1'
import { DEFAULT_BLOCKS } from '../blocks'
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

/* ------------------------------------------------------------- 構成 */

export function listBlocks(db: Db) {
  return db.query.blocks.findMany({
    orderBy: [asc(schema.blocks.sortOrder), asc(schema.blocks.id)],
  })
}

// 何も置いていないときの並び。id は 0 で、DB には無い
export function defaultBlocks(): schema.Block[] {
  return DEFAULT_BLOCKS.map((type, index) => ({
    id: 0,
    type,
    title: '',
    body: '',
    published: 1,
    sortOrder: (index + 1) * 10,
    createdAt: '',
    updatedAt: '',
  }))
}

/*
  公開ページが描く並び。
  1行も無ければ既定の並び。1行でもあれば、公開中のものだけ。
  「全部下書き」と「まだ何も置いていない」を分けるため、published で絞る前に数える
*/
export async function publishedBlocks(db: Db): Promise<schema.Block[]> {
  const rows = await listBlocks(db)
  if (rows.length === 0) return defaultBlocks()
  return rows.filter((row) => row.published === 1)
}

/*
  並び順を 10 刻みで振り直す。上下入れ替えのたびに呼ぶので、同じ値が並ばない。

  1行ずつ await せず batch で送る。途中で止まると、振り直しの済んだ行と
  済んでいない行が混じり、同じ sortOrder が並ぶ——この関数が防ぎたかった状態——
  で終わってしまうため
*/
export async function reorderBlocks(db: Db, ids: number[]) {
  const updates = ids.map((id, index) =>
    db
      .update(schema.blocks)
      .set({ sortOrder: (index + 1) * 10 })
      .where(eq(schema.blocks.id, id)),
  )
  const [first, ...rest] = updates
  if (!first) return
  await db.batch([first, ...rest])
}

/*
  何も置いていない DB に最初の1つを足すときは、先に既定の並びを行にする。

  0件のトップは既定の並びで描いているので、見えているものは Hero〜Contact。
  そこへ1つ足したときに、その1つだけの DB になって5節が消えるのは、
  足した人から見れば「足したのに減った」になる
*/
export async function ensureBlocks(db: Db): Promise<schema.Block[]> {
  const rows = await listBlocks(db)
  if (rows.length > 0) return rows

  await db
    .insert(schema.blocks)
    .values(
      DEFAULT_BLOCKS.map((type, index) => ({ type, published: 1, sortOrder: (index + 1) * 10 })),
    )
  return listBlocks(db)
}
