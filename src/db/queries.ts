import { and, asc, count, eq, sql } from 'drizzle-orm'
import type { DrizzleD1Database } from 'drizzle-orm/d1'
import { blockType, DEFAULT_BLOCKS } from '../blocks'
import { normalizeTheme, THEME_KEYS, type Theme, type ThemeKey } from '../theme'
import type { ItemKind, ItemView } from '../ui/components'
import * as schema from './schema'

export type Db = DrizzleD1Database<typeof schema>

/*
  作品の並び。新しい順で、個人開発と業務を混ぜて並べる（Projects は1つの一覧）。

  1. 年（year_from）の新しい順。year の頭の数字4桁を保存のときに数にしたもの
     （src/lib/format.ts の yearFrom）で、「2024 — 現在」は 2024。頭が数字4桁で
     ない年と、年を書いていない行は null で、最後に回る（NULLS LAST）
  2. 同じ年の中は管理画面の並び順（sort_order。小さいほど先）。個人開発と業務を
     またいで1つの数の並びとして比べる——公開ページは2つの区分を混ぜて並べるので
  3. それも同じなら先に作ったほう（id）

  以前は year の頭の4文字を文字列のまま比べていた。数字で始まらない年
  （「令和6」「〜2023」「FY2024」）が文字の大小で 2026 より上に来て、一覧の
  先頭に出ていた。

  公開ページの一覧・作品のページのページャ（listPublishedItemKeys）・管理画面の
  一覧が、どれもこの1本を読む。別の並びで数えると、「次」で着く作品が一覧の隣の
  カードと食い違う。
*/
export const itemOrder = [
  sql`${schema.items.yearFrom} desc nulls last`,
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
    orderBy: itemOrder,
    limit: slice.limit,
    offset: slice.offset,
    with: itemWith,
  })

  return rows.map(toItemView)
}

/*
  前の slug から、いまの作品を引く（src/db/schema.ts の item_slug_redirects）。
  公開中のものだけ——下書きの作品へ送ると、送った先が 404 になる。
  返すのは恒久リンクを組むのに要る2つ（区分と、いまの slug）だけ。
*/
export async function findMovedItem(db: Db, oldSlug: string) {
  const [row] = await db
    .select({ type: schema.items.type, slug: schema.items.slug })
    .from(schema.itemSlugRedirects)
    .innerJoin(schema.items, eq(schema.items.id, schema.itemSlugRedirects.itemId))
    .where(and(eq(schema.itemSlugRedirects.oldSlug, oldSlug), eq(schema.items.published, 1)))
    .limit(1)
  return row ?? null
}

// メンバーも同じ（member_slug_redirects）。返すのはいまの slug
export async function findMovedMember(db: Db, oldSlug: string) {
  const [row] = await db
    .select({ slug: schema.members.slug })
    .from(schema.memberSlugRedirects)
    .innerJoin(schema.members, eq(schema.members.id, schema.memberSlugRedirects.memberId))
    .where(and(eq(schema.memberSlugRedirects.oldSlug, oldSlug), eq(schema.members.published, 1)))
    .limit(1)
  return row?.slug ?? null
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
  公開中の作品の並びだけ（id・区分・slug・題）。作品1件のページの行き来に使う
  ——前後の作品へめくるページャと、「← 一覧に戻る」がその作品の載っている
  Projects の何画面目かを数えるのに。

  並びは一覧と同じ itemOrder。別の並びで数えると、「次」で着く作品が一覧の
  隣のカードと食い違い、戻った画面にその作品が居ない。

  カードの中身（タグ・リンク・担当）は引かない。要るのは並びの中の位置だけで、
  7件なら7件ぶんの子を毎回引くことになる。
*/
export function listPublishedItemKeys(db: Db) {
  return db
    .select({
      id: schema.items.id,
      type: schema.items.type,
      slug: schema.items.slug,
      title: schema.items.title,
    })
    .from(schema.items)
    .where(itemsWhere({}))
    .orderBy(...itemOrder)
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
    formKey: null,
    createdAt: '',
    updatedAt: '',
  }))
}

/*
  公開ページが描く並び。
  1行も無ければ既定の並び。1行でもあれば、公開中のものだけ。
  「全部下書き」と「まだ何も置いていない」を分けるため、published で絞る前に数える

  決まった中身の種類（hero・projects・team・contact）は、並びの先頭の1行だけを
  採る。DB の部分一意索引（blocks_fixed_once）ができる前に二重送信で2行になった
  D1 でも、同じ URL が画面の列に2度並んでページャが自分自身を指す、を起こさない
  ための読む側の受け（移行 0009 も同じ行を残して片付ける）。
*/
export async function publishedBlocks(db: Db): Promise<schema.Block[]> {
  const rows = await listBlocks(db)
  if (rows.length === 0) return defaultBlocks()
  const placed = new Set<string>()
  return rows.filter((row) => {
    if (row.published !== 1) return false
    if (blockType(row.type)?.kind !== 'fixed') return true
    if (placed.has(row.type)) return false
    placed.add(row.type)
    return true
  })
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
  何も置いていない DB に、既定の並びを行にする。1行でもあれば何もしない。
  行を足したかどうかを返す（「この並びから始める」が、何もしていないのに
  「保存しました」と出さないため）。

  「数えてから足す」を2文で書かない。2本の送信が同時に来ると、どちらも0件と
  数えて両方が足し、hero〜contact が2組になっていた（ページャが自分自身を指して
  入口から先へ進めなくなる）。1文の INSERT … SELECT … WHERE NOT EXISTS は
  SQLite の中で原子的に動くので、数えると足すの間に割り込めない。それでも
  重なったときの最後の受けが ON CONFLICT DO NOTHING（blocks_fixed_once）。

  値はコードの定数（DEFAULT_BLOCKS）で、束縛変数として渡している。
*/
export async function initBlocks(db: Db): Promise<boolean> {
  const rows = sql.join(
    DEFAULT_BLOCKS.map((type, index) => sql`(${type}, ${(index + 1) * 10})`),
    sql`, `,
  )
  const result = await db.run(sql`
    insert into ${schema.blocks} (type, published, sort_order)
    select column1, 1, column2 from (values ${rows})
    where not exists (select 1 from ${schema.blocks})
    on conflict do nothing
  `)
  return (result.meta?.changes ?? 0) > 0
}

/*
  何も置いていない DB に最初の1つを足すときは、先に既定の並びを行にする。

  0件のトップは既定の並びで描いているので、見えているものは Hero〜Contact。
  そこへ1つ足したときに、その1つだけの DB になって5節が消えるのは、
  足した人から見れば「足したのに減った」になる
*/
export async function ensureBlocks(db: Db): Promise<schema.Block[]> {
  await initBlocks(db)
  return listBlocks(db)
}
