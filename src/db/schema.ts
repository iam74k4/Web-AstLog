import { relations, sql } from 'drizzle-orm'
import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
import { BLOCK_KEYS } from '../blocks'
import { PROVIDER_KEYS } from '../lib/oauth'

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
    /*
      作品1件の恒久リンク（/apps/item/<slug> と /works/item/<slug>）。

      一覧の URL（/apps/3）は「いまの並びの3枚目」でしかない。並べ替え・公開の
      切り替え・追加のたびに、200 のまま別の作品を指す——404 なら気づけるが、
      これは誰にも気づかれないまま貼ったリンクの中身が入れ替わる。作品を1件だけ
      名指しできる URL を、並び順から切り離してここに持つ。

      null は「恒久リンクがまだ無い」。この列より前からある行だけが該当し、
      管理画面から一度保存すれば埋まる（保存時は必ず作品名から作る）。
      NOT NULL にしないのは、既にある行を1つの既定値で埋めると、その値が
      重なって unique を張れないため。SQLite は unique の中の NULL を
      互いに別物として扱うので、埋まっていない行が何行あっても通る。
    */
    slug: text('slug').unique(),
    // "2026" や "2024 — 現在"（続いているもの。経歴の期間と同じ書き方）を入れるので文字列
    year: text('year').notNull().default(''),
    // 「何であるか。何をしたか。」の2文。常体（目録の文。本文 body は「です・ます」）
    summary: text('summary').notNull().default(''),
    /*
      作品ページの本文。背景・やったこと・結果を段落で（段落の数の上限は
      MAX_CHARS.itemBodyParagraphs。いまは1段落）。
      カードには出さない——カードの説明（summary）は行数で切られる要約で、
      中身を読みに来た人が着く先は作品のページ（/apps/item/<slug>）。
      長さの上限は src/blocks.ts の MAX_CHARS（1画面に収まる実測）。

      既にある行は '' のまま（NOT NULL に定数の既定値なので ALTER で入る）。
      本人の作品の中身をこちらで書いて埋めない。
    */
    body: text('body').notNull().default(''),
    /*
      スクリーンショット。/images/items/<…>（管理画面から KV に上げたもの）か、
      /assets/…（同梱）。null なら画像なし——作品ページに figure を出さず、
      カードにもサムネイルを出さない。

      代替テキストは別の列で持つ（画像そのものに焼き込めない）。空のまま
      公開させない検査は src/routes/admin.tsx の itemErrors。
    */
    imageUrl: text('image_url'),
    imageAlt: text('image_alt').notNull().default(''),
    /*
      画像の寸法（px）。上げたときに中身の頭から読んだもの（src/lib/image.ts の
      sniffImage）。使うのは共有カードだけ——og:image:width / height と、
      twitter:card を大きい札にするかどうか（src/ui/Layout.tsx の OgImage）。
      画面の枠には使わない（枠の形は CSS が先に決める。CLAUDE.md「画像の枠は
      絵に合わせない」）。

      null は「分からない」。この列より前に上げた画像と、寸法を読めなかった
      画像がそう。分からないときは寸法を名乗らない。画像を外せば両方 null に戻す。
    */
    imageWidth: integer('image_width'),
    imageHeight: integer('image_height'),
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
  管理画面に入る人。
  role と memberId を最初から持たせておく。後から「本人が自分のページだけ
  編集できる」を足すときに、列を増やす移行をしなくて済ませるため。
  ただし MVP で作るのは owner の1件だけ。

  パスワードもメールアドレスも持たない。ログインは GitHub / Google の OAuth
  だけで、「この人は誰か」は user_identities の（提供元, ID）が決める。
  以前あった email と password_hash は 0006 で外した（行の id はそのまま残る
  ので、members や sessions からの参照は切れない）。
*/
export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  role: text('role', { enum: ['owner', 'member'] })
    .notNull()
    .default('owner'),
  memberId: integer('member_id').references(() => members.id, { onDelete: 'set null' }),
  createdAt: text('created_at').notNull().default(now),
})

/*
  users に紐づいた、外のアカウント（GitHub / Google）。

  照合は subject だけで行う。GitHub は数値の id（ログイン名は変えられるので
  使わない）、Google は sub（メールアドレスは変わりうる）。label は画面に
  出すための写し（@ログイン名・メールアドレス）で、照合には使わない。
  ログインのたびに書き直す。

  最初の1行は src/routes/admin.tsx の linkOwner が作る——環境変数の
  OWNER_GITHUB_ID / OWNER_GOOGLE_EMAIL と一致したときだけ。以後は subject で
  引くので、環境変数を変えても既に紐づいた行は外れない（外すなら行を消す）。
*/
export const userIdentities = sqliteTable(
  'user_identities',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    provider: text('provider', { enum: PROVIDER_KEYS }).notNull(),
    subject: text('subject').notNull(),
    label: text('label').notNull().default(''),
    createdAt: text('created_at').notNull().default(now),
    lastLoginAt: text('last_login_at').notNull().default(now),
  },
  (t) => [
    uniqueIndex('user_identities_provider_subject').on(t.provider, t.subject),
    index('idx_user_identities_user').on(t.userId),
  ],
)

/*
  OAuth の往復のあいだだけ持つ、1回きりの札。

  /admin/auth/:provider/start が1行作り、同じ state をクッキーにも置く。
  callback は両方が一致したときだけ進み、行は成否にかかわらず必ず消す
  （同じ state を2度通さない）。期限は10分で、切れた行は start のたびに掃除する。
  code_verifier（PKCE）と nonce（Google の id_token）もここに持つ——クッキーに
  置くと、ブラウザ側の値だけで往復が完結してしまう。
*/
export const oauthStates = sqliteTable(
  'oauth_states',
  {
    state: text('state').primaryKey(),
    provider: text('provider', { enum: PROVIDER_KEYS }).notNull(),
    codeVerifier: text('code_verifier').notNull(),
    nonce: text('nonce').notNull(),
    // ログイン後の戻り先。safeNext を通したものだけが入る
    next: text('next'),
    expiresAt: text('expires_at').notNull(),
  },
  (t) => [index('idx_oauth_states_exp').on(t.expiresAt)],
)

/*
  ログイン中の端末。ログアウトで即座に無効にしたいので KV の TTL ではなく
  こちらに置く（KV は反映まで最大60秒かかる）。

  id はクッキーの値そのものではなく、その SHA-256（16進）。クッキーを受けたら
  毎回ハッシュしてから引く（src/lib/auth.ts の sessionKey）。D1 のエクスポートや
  バックアップだけが漏れても、そこにある値はクッキーとして使えない。
  平文で持っていたころの行は 0007 で消した（全員ログインし直し）。
*/
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
export type UserIdentity = typeof userIdentities.$inferSelect
export type Block = typeof blocks.$inferSelect
