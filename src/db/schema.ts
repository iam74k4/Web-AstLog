import { relations, sql } from 'drizzle-orm'
import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
import { BLOCK_KEYS, FIXED_BLOCK_KEYS } from '../blocks'
import { ITEM_KIND_KEYS } from '../domain'
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
    /*
      /members/:slug になる。管理画面から変えられるが、変えたときは前の slug を
      member_slug_redirects に残し、前の URL は新しい URL へ 301 で送る
      （src/routes/public/member.tsx の renderMemberScreen）。欄を空にして保存しても
      作り直さず、いまの値のまま（src/routes/admin/members.tsx の readMemberForm）
    */
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
    // 追加のフォームの一度きりの札。二重送信で同じ人を2行作らない（form_key の注記）
    formKey: text('form_key').unique(),
    createdAt: text('created_at').notNull().default(now),
    updatedAt: text('updated_at').notNull().default(now),
  },
  (t) => [index('idx_members_public').on(t.published, t.sortOrder)],
)

/*
  追加のフォームの一度きりの札（form_key）。members・items・blocks の3つが持つ。

  管理画面は JavaScript を持たない HTML フォームなので、送信ボタンを押したあとに
  押せなくする手が無い。遅い回線で2度押すと、同じ中身の行が2つできていた
  （日本語だけの題の作品は slug が毎回乱数で作られるので、slug の unique も効かない。
  メモには自然なキーそのものが無い）。フォームを描くときに札を1枚作って hidden で
  持ち回し、行と一緒に書く。2度目の送信は同じ札で見つかり、新しい行を作らずに
  その行への保存として扱う（src/routes/admin/request.ts の newFormKey の注記）。

  null は「札を持たずに作った行」——この列より前の行と、seed と、編集で書いた行。
  SQLite は unique の中の NULL を互いに別物として扱うので、何行あっても通る。
*/

// 絞り込みボタンの元。自由入力をやめてここに寄せる。
// "macOS" と "Mac OS" のような表記ゆれでフィルタが壊れるのを防ぐため
export const platforms = sqliteTable('platforms', {
  key: text('key').primaryKey(),
  label: text('label').notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
})

// 個人開発と業務は列がほぼ同じなので1つの表にし、type で分ける。
// 分けると、横断で並べる（Projects の一覧）たびに UNION が要る
export const items = sqliteTable(
  'items',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    // 値の一覧は src/domain.ts の ITEM_KINDS が正（呼び名・URL の1語目と対）
    type: text('type', { enum: ITEM_KIND_KEYS }).notNull(),
    memberId: integer('member_id').references(() => members.id, { onDelete: 'set null' }),
    platformKey: text('platform_key').references(() => platforms.key, { onDelete: 'set null' }),
    // work のときの区分（「金融系基幹システム」など）
    category: text('category').notNull().default(''),
    title: text('title').notNull(),
    /*
      作品1件の恒久リンク（/apps/item/<slug> と /works/item/<slug>）。

      一覧の URL（/projects/3）は「いまの並びの3枚目」でしかない。並べ替え・公開の
      切り替え・追加のたびに、200 のまま別の作品を指す——404 なら気づけるが、
      これは誰にも気づかれないまま貼ったリンクの中身が入れ替わる。作品を1件だけ
      名指しできる URL を、並び順から切り離してここに持つ。

      null は「恒久リンクがまだ無い」。この列より前からある行だけが該当し、
      管理画面から一度保存すれば埋まる（欄が空なら作品名から作る）。

      管理画面から変えられるが、変えたときは前の slug を item_slug_redirects に
      残し、前の URL は新しい URL へ 301 で送る。欄を空にして保存しても
      作り直さず、いまの値のまま（src/routes/admin/items.tsx の readItemForm）。
      NOT NULL にしないのは、既にある行を1つの既定値で埋めると、その値が
      重なって unique を張れないため。SQLite は unique の中の NULL を
      互いに別物として扱うので、埋まっていない行が何行あっても通る。
    */
    slug: text('slug').unique(),
    // "2026" や "2024 — 現在"（続いているもの。経歴の期間と同じ書き方）を入れるので文字列
    year: text('year').notNull().default(''),
    /*
      並べるための年。year の頭の数字4桁で、頭が数字4桁でなければ null。

      公開の並び（src/db/queries.ts の itemOrder）は year_from の新しい順で、
      null は最後。year の文字列をそのまま比べていたころは、「令和6」「〜2023」
      「FY2024」のような数字で始まらない年が、文字の大小で 2026 より上に来ていた。
      year は表示のためだけに残す。

      **year から DB が作る列（生成列・VIRTUAL）。書く口は無い。** 保存のたびに
      アプリが埋める形にすると、アプリを通らずに入る行（seed.sql・テスト・D1 を
      手で直した行）で year とずれる。ずれた行は並びのどこにも居場所が無く、
      誰にも気づかれない。生成列なら、既にある行の移行（埋め直し）も要らない。
      規則を変えるときは src/lib/format.ts の yearFrom（管理画面の「並びに
      使われません」の知らせ）も一緒に。全角の数字は、年の欄を保存するときに
      半角へ直してある（src/routes/admin/items.tsx の readItemForm）。それより前に
      全角のまま入っていた行は 0013_halfwidth_year が直した。
    */
    yearFrom: integer('year_from').generatedAlwaysAs(
      sql`case when "year" glob '[0-9][0-9][0-9][0-9]*' then cast(substr("year", 1, 4) as integer) end`,
      { mode: 'virtual' },
    ),
    // 「何であるか。何をしたか。」の2文。常体（目録の文。本文 body は「です・ます」）
    summary: text('summary').notNull().default(''),
    /*
      作品ページの本文。背景・やったこと・結果を段落で。
      カードには出さない——出るのは作品のページの説明の下の小節「Story」（#story）
      だけで、空なら（段落が1つも無ければ）その小節を作らない（src/blocks.ts の
      itemStory）。カードの説明（summary）は目録の2文で、作品のページの頭は
      カードを開いたもの。

      既にある行は '' のまま（NOT NULL に定数の既定値なので ALTER で入る）。
      本人の作品の中身をこちらで書いて埋めない。
    */
    body: text('body').notNull().default(''),
    /*
      スクリーンショット。/images/items/<…>（管理画面から KV に上げたもの）か、
      /assets/…（同梱）。null なら画像なし——作品ページに figure を出さず、
      カードにもサムネイルを出さない。

      代替テキストは別の列で持つ（画像そのものに焼き込めない）。空のまま
      公開させない検査は src/blocks.ts の publishErrors（公開の関門）。
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
    /*
      同じ年の中の並び（小さいほど先）。個人開発と業務で1つの数の並びとして
      比べる——公開ページは2つの区分を1つの一覧に混ぜるので、区分ごとに別々の
      並びを持つと、同じ数どうしの前後が決まらない。同じ数なら先に作ったほう（id）
    */
    sortOrder: integer('sort_order').notNull().default(0),
    // 追加のフォームの一度きりの札（members の下の form_key の注記）
    formKey: text('form_key').unique(),
    createdAt: text('created_at').notNull().default(now),
    updatedAt: text('updated_at').notNull().default(now),
  },
  /*
    公開の一覧の3つの引き方（全部・区分で絞る・担当で絞る）に1本ずつ。どれも
    公開の並び（src/db/queries.ts の itemOrder: year_from の新しい順 → sort_order → id）の
    順に索引が並んでいるので、並べ直さずに前から読める。id は索引の末尾に暗に
    入っている rowid が受ける。

    year_from は desc で持つ。itemOrder の「desc nulls last」は SQLite の desc の
    既定の並び（NULL は最小）なので、この索引をそのまま前から読める。asc で持つと、
    後ろから読んだときに sort_order と id まで逆になり、並べ直し（TEMP B-TREE）に戻る。

    並びを変えるときは、ここの3本も一緒に。test/queries.test.ts の「索引」が
    EXPLAIN QUERY PLAN で並べ直しが無いことを見ている。
  */
  (t) => [
    index('idx_items_public').on(
      t.published,
      sql`${sql.identifier('year_from')} desc`,
      t.sortOrder,
    ),
    index('idx_items_kind').on(
      t.type,
      t.published,
      sql`${sql.identifier('year_from')} desc`,
      t.sortOrder,
    ),
    index('idx_items_member').on(
      t.memberId,
      t.published,
      sql`${sql.identifier('year_from')} desc`,
      t.sortOrder,
    ),
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
  /*
    子の行は作品ごとに sort_order の順で引く（カードのタグ・行き先）。主キー
    （item_id, tag）でも作品では引けるが、並べ直しが1件ごとに走る。item_links には
    item_id の索引そのものが無く、作品1件のたびに表を丸ごと読んでいた
  */
  (t) => [
    primaryKey({ columns: [t.itemId, t.tag] }),
    index('idx_item_tags_item').on(t.itemId, t.sortOrder),
  ],
)

export const itemLinks = sqliteTable(
  'item_links',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    itemId: integer('item_id')
      .notNull()
      .references(() => items.id, { onDelete: 'cascade' }),
    label: text('label').notNull(),
    url: text('url').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (t) => [index('idx_item_links_item').on(t.itemId, t.sortOrder)],
)

/*
  前の slug から、いまの行への転送表。作品とメンバーで1つずつ。

  恒久リンク（/apps/item/<slug>・/members/<slug>）は貼られたあとも動かない、が
  約束だった。ところが slug は管理画面から自由に書き換えられ、書き換えた日に
  名刺や SNS に貼った前の URL が 404 になっていた。誤字を直す自由と、リンクを
  切らない保証を両立させるため、書き換えるたびに前の slug をここに残し、
  公開ページは見つからない slug をここで引いて、いまの URL へ 301 で送る。

  old_slug は主キー（1つの前の URL は1つの行だけを指す）。ほかの行が前に使って
  いた slug は、いまの slug として使わせない（src/routes/admin/items.tsx の itemSlugTaken と src/routes/admin/members.tsx の memberSlugTaken）
  ——使わせると、貼られた前の URL が黙って別の作品を指す（それは 404 より悪い）。
  自分の前の slug へ戻すのは通り、そのとき行はここから消える。
  行を消すとここも消える（cascade）。消した作品の前の URL は 404 のまま。
*/
export const itemSlugRedirects = sqliteTable(
  'item_slug_redirects',
  {
    oldSlug: text('old_slug').primaryKey(),
    itemId: integer('item_id')
      .notNull()
      .references(() => items.id, { onDelete: 'cascade' }),
    createdAt: text('created_at').notNull().default(now),
  },
  (t) => [index('idx_item_slug_redirects_item').on(t.itemId)],
)

export const memberSlugRedirects = sqliteTable(
  'member_slug_redirects',
  {
    oldSlug: text('old_slug').primaryKey(),
    memberId: integer('member_id')
      .notNull()
      .references(() => members.id, { onDelete: 'cascade' }),
    createdAt: text('created_at').notNull().default(now),
  },
  (t) => [index('idx_member_slug_redirects_member').on(t.memberId)],
)

/*
  トップページの並び。1行が1ブロック。

  type の種類と、それぞれが何を出すかは src/blocks.ts が正。決まった中身を
  持つもの（apps・team …）は title と body を使わず、置く場所だけを持つ。
  打ち込むもの（ひとこと・数字 …）は title と body に中身が入る。body の
  読み方は種類ごとに違い、メンバーの skills_text と同じく1行1件で持つ。

  空のときは DEFAULT_BLOCKS の並びで描く（真っ白なトップを出さない）。

  決まった中身の種類は1つずつしか置けない（src/blocks.ts の FIXED_BLOCK_KEYS）。
  それを DB でも持つのが blocks_fixed_once（その種類の行だけに効く部分一意索引）。
  「読んでから足す」だけで守っていたころは、二重送信で hero〜contact が2組になり、
  同じ URL がページの並びに2度並んだ（当時は画面の底の「次」が自分自身を指して
  入口から先へ進めなくなった）。
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
    // 追加のフォームの一度きりの札（members の下の form_key の注記）。打ち込むものだけが持つ
    formKey: text('form_key').unique(),
    createdAt: text('created_at').notNull().default(now),
    updatedAt: text('updated_at').notNull().default(now),
  },
  (t) => [
    index('idx_blocks_order').on(t.sortOrder),
    // 値は DDL に焼き込む（索引の条件に束縛変数は置けない）。一覧は src/blocks.ts が正
    uniqueIndex('blocks_fixed_once')
      .on(t.type)
      .where(sql`${t.type} in (${sql.raw(FIXED_BLOCK_KEYS.map((key) => `'${key}'`).join(', '))})`),
  ],
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

  **owner は1人だけ。** それを DB でも持つのが users_one_owner（role = 'owner' の
  行だけに効く部分一意索引。blocks_fixed_once と同じ手）。owner を作るのは
  src/lib/auth.ts の userForIdentity の ON CONFLICT DO NOTHING の1文で、作ったか
  どうかに関わらず読み直す。「読んでから作る」だけだったころは、owner の居ない
  D1 に初回のログインが2本同時に来ると owner が2人でき、「すべての端末から
  ログアウト」が片方のセッションしか消さなかった（既にできた2人は 0014 が寄せる）。
*/
export const users = sqliteTable(
  'users',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    role: text('role', { enum: ['owner', 'member'] })
      .notNull()
      .default('owner'),
    memberId: integer('member_id').references(() => members.id, { onDelete: 'set null' }),
    createdAt: text('created_at').notNull().default(now),
  },
  (t) => [uniqueIndex('users_one_owner').on(t.role).where(sql`${t.role} = 'owner'`)],
)

/*
  users に紐づいた、外のアカウント（GitHub / Google）。

  照合は subject だけで行う。GitHub は数値の id（ログイン名は変えられるので
  使わない）、Google は sub（メールアドレスは変わりうる）。label は画面に
  出すための写し（@ログイン名・メールアドレス）で、照合には使わない。
  ログインのたびに書き直す。

  最初の1行は src/lib/auth.ts の userForIdentity が作る——環境変数の
  OWNER_GITHUB_ID / OWNER_GOOGLE_EMAIL と一致し、その値がまだ使われていない
  （owner_claims に行が無い）ときだけ。以後は subject で引くので、環境変数を
  変えても既に紐づいた行は外れない（外すなら行を消す。消せば紐づき直らない）。
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
  環境変数（OWNER_GITHUB_ID / OWNER_GOOGLE_EMAIL）で owner に紐づけた記録。
  （提供元, 値）の組ごとに1行で、1つの組が owner を作れるのは1度きり。

  環境変数は「最初の紐づけ」のためのもの。これが無かったころは [vars] が残って
  いるかぎり何度でも効いた——README のとおり user_identities の行を消して紐づけを
  外しても、同じアカウントの次のログインで owner に紐づき直り、同じ確認済みの
  アドレスを持つ別の Google アカウント（別の sub）も並んで入れた。いまは、使った組が
  ここに残るので、どちらも 403 になる。

  value は比べた形の値（GitHub は id、Google は小文字にしたアドレス）。subject は
  その組で紐づいたアカウント（調べもの用）。ticket は紐づけた往復だけが知る乱数で、
  userForIdentity が「この組を取ったのが自分か」を同じ batch の中で確かめるために
  使う（取った往復だけが user_identities を書く）。

  外したアカウントをまた使うときは、ここの行も消す（README「紐づけを外す」）。
  環境変数を別の値に書き換えれば、新しい組として1度だけ効く。
*/
export const ownerClaims = sqliteTable(
  'owner_claims',
  {
    provider: text('provider', { enum: PROVIDER_KEYS }).notNull(),
    value: text('value').notNull(),
    subject: text('subject').notNull(),
    ticket: text('ticket').notNull(),
    createdAt: text('created_at').notNull().default(now),
  },
  (t) => [primaryKey({ columns: [t.provider, t.value] })],
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
