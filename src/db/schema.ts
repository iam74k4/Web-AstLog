import { relations, sql } from 'drizzle-orm'
import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { BLOCK_KEYS } from '../blocks'

/*
  公開サイトは published = 1 の行だけを読む。
  これは index.html のカードに手で書いていた data-show="yes" / "no" を
  置き換えたもので、「消さずに寝かせる」使い方を DB に移したもの。

  並び順は sortOrder（小さいほど先）。id 順に依存しないこと。
  追加した順と見せたい順は一致しない。10 刻みで振ると間に入れやすい。
*/

const now = sql`(datetime('now'))`

export const members = sqliteTable(
  'members',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    // /members/:slug になる。変えると URL が変わる
    slug: text('slug').notNull().unique(),
    name: text('name').notNull(),
    role: text('role').notNull().default(''),
    location: text('location').notNull().default(''),
    headline: text('headline').notNull().default(''),
    // 空行で段落を分ける
    bio: text('bio').notNull().default(''),
    // 1行 = 「表示名 | 補足」。末尾が : の行はグループ見出し。
    // 別テーブルにしないのは、並べて出す以外の使い道がないため
    skillsText: text('skills_text').notNull().default(''),
    // 1行 = 「期間 | 肩書き | 所属」
    careerText: text('career_text').notNull().default(''),
    // /images/<key>（KV にアップロードしたもの）か /assets/...（同梱）。null なら頭文字
    avatarUrl: text('avatar_url'),
    github: text('github'),
    email: text('email'),
    published: integer('published').notNull().default(0),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: text('created_at').notNull().default(now),
    updatedAt: text('updated_at').notNull().default(now),
  },
  (t) => [index('idx_members_public').on(t.published, t.sortOrder)],
)

// 絞り込みボタンの元。自由入力をやめてここに寄せる。
// "macOS" と "Mac OS" のような表記ゆれでフィルタが壊れるのを防ぐため
export const platforms = sqliteTable('platforms', {
  key: text('key').primaryKey(),
  label: text('label').notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
})

// Apps と Works は列がほぼ同じなので1つの表にし、type で分ける。
// 分けると、横断で並べたいときのたびに UNION が要る
export const items = sqliteTable(
  'items',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    type: text('type', { enum: ['app', 'work'] }).notNull(),
    memberId: integer('member_id').references(() => members.id, { onDelete: 'set null' }),
    platformKey: text('platform_key').references(() => platforms.key, { onDelete: 'set null' }),
    // work のときの区分（「金融系基幹システム」など）
    category: text('category').notNull().default(''),
    title: text('title').notNull(),
    // "2026" や "2024 —" を入れるので文字列
    year: text('year').notNull().default(''),
    // 「何であるか。何をしたか。」の2文
    summary: text('summary').notNull().default(''),
    // 実績値。1項目に1つだけ。無い項目のほうが多い
    metricValue: text('metric_value'),
    metricUnit: text('metric_unit'),
    metricNote: text('metric_note'),
    published: integer('published').notNull().default(0),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: text('created_at').notNull().default(now),
    updatedAt: text('updated_at').notNull().default(now),
  },
  (t) => [
    index('idx_items_public').on(t.type, t.published, t.sortOrder),
    index('idx_items_member').on(t.memberId),
  ],
)

export const itemTags = sqliteTable(
  'item_tags',
  {
    itemId: integer('item_id')
      .notNull()
      .references(() => items.id, { onDelete: 'cascade' }),
    tag: text('tag').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.itemId, t.tag] })],
)

export const itemLinks = sqliteTable('item_links', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  itemId: integer('item_id')
    .notNull()
    .references(() => items.id, { onDelete: 'cascade' }),
  label: text('label').notNull(),
  url: text('url').notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
})

/*
  トップページの並び。1行が1ブロック。

  type の種類と、それぞれが何を出すかは src/blocks.ts が正。決まった中身を
  持つもの（apps・team …）は title と body を使わず、置く場所だけを持つ。
  打ち込むもの（ひとこと・数字 …）は title と body に中身が入る。body の
  読み方は種類ごとに違い、メンバーの skills_text と同じく1行1件で持つ。

  空のときは DEFAULT_BLOCKS の並びで描く（真っ白なトップを出さない）。
*/
export const blocks = sqliteTable(
  'blocks',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    type: text('type', { enum: BLOCK_KEYS }).notNull(),
    title: text('title').notNull().default(''),
    body: text('body').notNull().default(''),
    published: integer('published').notNull().default(0),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: text('created_at').notNull().default(now),
    updatedAt: text('updated_at').notNull().default(now),
  },
  (t) => [index('idx_blocks_order').on(t.sortOrder)],
)

/*
  管理画面から変えられる、サイト全体の設定。今のところ見た目のプリセットだけ。

  列を増やさず key-value にしているのは、設定が1つ増えるたびに移行を
  書かずに済ませるため。選べる値は src/theme.ts が正で、ここは選んだ結果を
  置くだけ。知らない値が入っていても既定に戻して描く。
*/
export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: text('updated_at').notNull().default(now),
})

/*
  管理画面のログイン。
  role と memberId を最初から持たせておく。後から「本人が自分のページだけ
  編集できる」を足すときに、列を増やす移行をしなくて済ませるため。
  ただし MVP で作るのは owner の1件だけ。
*/
export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  email: text('email').notNull().unique(),
  // pbkdf2$<iterations>$<salt>$<hash>
  passwordHash: text('password_hash').notNull(),
  role: text('role', { enum: ['owner', 'member'] })
    .notNull()
    .default('owner'),
  memberId: integer('member_id').references(() => members.id, { onDelete: 'set null' }),
  createdAt: text('created_at').notNull().default(now),
})

// Cookie に入るのは id だけ。ログアウトで即座に無効にしたいので
// KV の TTL ではなくこちらに置く（KV は反映まで最大60秒かかる）
export const sessions = sqliteTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: text('expires_at').notNull(),
    createdAt: text('created_at').notNull().default(now),
  },
  (t) => [index('idx_sessions_exp').on(t.expiresAt)],
)

export const membersRelations = relations(members, ({ many }) => ({
  items: many(items),
}))

export const itemsRelations = relations(items, ({ one, many }) => ({
  member: one(members, { fields: [items.memberId], references: [members.id] }),
  platform: one(platforms, { fields: [items.platformKey], references: [platforms.key] }),
  tags: many(itemTags),
  links: many(itemLinks),
}))

export const itemTagsRelations = relations(itemTags, ({ one }) => ({
  item: one(items, { fields: [itemTags.itemId], references: [items.id] }),
}))

export const itemLinksRelations = relations(itemLinks, ({ one }) => ({
  item: one(items, { fields: [itemLinks.itemId], references: [items.id] }),
}))

export type Member = typeof members.$inferSelect
export type Item = typeof items.$inferSelect
export type Platform = typeof platforms.$inferSelect
export type User = typeof users.$inferSelect
export type Block = typeof blocks.$inferSelect
