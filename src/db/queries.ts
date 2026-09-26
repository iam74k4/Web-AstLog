import { and, asc, count, desc, eq, sql } from 'drizzle-orm'
import type { DrizzleD1Database } from 'drizzle-orm/d1'
import { DEFAULT_BLOCKS } from '../blocks'
import { normalizeTheme, THEME_KEYS, type Theme, type ThemeKey } from '../theme'
import type { ItemKind, ItemView } from '../ui/components'
import * as schema from './schema'

export type Db = DrizzleD1Database<typeof schema>

/*
  公開ページの並び。新しい順で、個人開発と業務を混ぜて並べる（Projects は
  1つの一覧）。年は頭の4桁で比べる——「2024 —」（2024年から続いている）は
  2024。年を書いていない行は最後に回る（空文字は数字より小さい）。
  同じ年の中は管理画面で決めた並び（sort_order）。区分ごとに別々に振った
  数なので、同じ数どうしは先に作ったほう（id）が前に来る。
*/
const publicOrder = [
  desc(sql`substr(${schema.items.year}, 1, 4)`),
  asc(schema.items.sortOrder),
  asc(schema.items.id),
]

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

/*
  一覧を絞り込む条件。区分（個人開発 app / 業務 work）とメンバーの2軸で、
  どちらも無ければ全件。

  メンバーは slug ではなく id で受ける。呼ぶ側は公開中のメンバーの一覧から
  引き当てるので、下書きのメンバーの slug では絞り込めない（絞り込まずに
  全件が出る）。ここで slug を受けると、その一手間を飛ばせてしまう。
*/
export type ItemScope = { kind?: ItemKind | null; memberId?: number | null }

/*
  1画面ぶんだけを引くための範囲。limit と offset は必ず対で渡すこと。
  offset だけでは SQL に載らず、静かに1画面目が出る。
*/
type ItemSlice = ItemScope & { limit?: number; offset?: number }

const itemsWhere = (scope: ItemScope) =>
  and(
    eq(schema.items.published, 1),
    scope.kind ? eq(schema.items.type, scope.kind) : undefined,
    scope.memberId ? eq(schema.items.memberId, scope.memberId) : undefined,
  )

/*
  画面に出すぶんだけを引く。範囲を渡さなければ全件（全体ページ /all はこちら）。

  条件は idx_items_public（type, published, sort_order）と
  idx_items_member（member_id）にそのまま乗る。
*/
// カード1枚ぶんに要る子（タグ・リンク・担当・プラットフォーム）を一緒に引く形
const itemWith = {
  tags: { orderBy: [asc(schema.itemTags.sortOrder)] },
  links: { orderBy: [asc(schema.itemLinks.sortOrder)] },
  // true をそのまま書くと boolean に広がって、drizzle の with が受け取らない
  member: true as const,
  platform: true as const,
}

/*
  DB の行を画面に出す形に開く。一覧（listPublishedItems）と作品1件
  （findPublishedItem）で同じ式を読む——片方だけ直すと、一覧のカードと
  その作品の恒久リンクで中身が食い違う。
*/
type ItemRow = schema.Item & {
  tags: { tag: string }[]
  links: { label: string; url: string }[]
  member: schema.Member | null
  platform: schema.Platform | null
}

function toItemView(row: ItemRow): ItemView {
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
}

export async function listPublishedItems(db: Db, slice: ItemSlice = {}): Promise<ItemView[]> {
  const rows = await db.query.items.findMany({
    where: itemsWhere(slice),
    orderBy: publicOrder,
    limit: slice.limit,
    offset: slice.offset,
    with: itemWith,
  })

  return rows.map(toItemView)
}

/*
  作品1件を恒久リンク（/apps/item/<slug>）から引く。

  並び順も絞り込みも見ない。一覧の URL（/apps/3）は「いまの並びの3枚目」で、
  並べ替えれば同じ URL が別の作品を指すが、こちらは slug で名指しするので
  何を足しても外しても指す先が動かない。それがこの列の全部の理由。

  公開中のものだけ。下書きの作品は、一覧に出ないのと同じ理由でここにも無い
  （URL を知っている人にだけ見える下書き、という抜け道を作らない）。
*/
export async function findPublishedItem(db: Db, slug: string): Promise<ItemView | null> {
  const row = await db.query.items.findFirst({
    where: and(eq(schema.items.slug, slug), eq(schema.items.published, 1)),
    with: itemWith,
  })
  return row ? toItemView(row) : null
}

/*
  画面が何枚になるかを決める数。カードを引かずに数えるので、出さない画面の
  中身は取ってこない。
*/
export async function countPublishedItems(db: Db, scope: ItemScope = {}) {
  const [row] = await db.select({ n: count() }).from(schema.items).where(itemsWhere(scope))
  return row?.n ?? 0
}

export function listPlatforms(db: Db) {
  return db.query.platforms.findMany({ orderBy: [asc(schema.platforms.sortOrder)] })
}

/*
  区分ごとの公開中の件数。絞り込みのピル（両方の区分に項目があるときだけ並べる）
  と、一覧への帯の「個人開発 5 · 業務 2」に使う。memberId を渡せばその人のぶん。

  ピルは絞り込む前の件数から決める。絞り込んだ結果から決めると、押すたびに
  ピルの並びが変わり、いま押したピルが消えて戻れなくなる。
*/
export async function countPublishedByKind(db: Db, memberId: number | null = null) {
  const rows = await db
    .select({ type: schema.items.type, n: count() })
    .from(schema.items)
    .where(itemsWhere({ memberId }))
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
