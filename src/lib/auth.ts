import { and, asc, desc, eq, lt, sql } from 'drizzle-orm'
import type { Db } from '../db/queries'
import * as schema from '../db/schema'
import type { Identity } from './oauth'

/*
  管理画面のセッションと、「このアカウントを通してよいか」。

  ログインは GitHub / Google の OAuth だけで、パスワードは持たない（往復は
  src/routes/admin/auth.tsx の /admin/auth/*、提供元との約束は src/lib/oauth.ts）。
  以前ここにあった PBKDF2・ダミーのハッシュ・KV の試行回数は、パスワードと
  一緒に外した——当てられるパスワードが無ければ、数える相手も居ない。
*/
const SESSION_DAYS = 14

const hex = (bytes: Uint8Array) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')

export function newToken(bytes = 32): string {
  return hex(crypto.getRandomValues(new Uint8Array(bytes)))
}

/*
  D1 の sessions.id に入れる値。クッキーの値（newToken の 32 バイト）を
  SHA-256 にした16進。D1 の写しだけが漏れても、そこからクッキーは作れない。
  入力が 256 ビットの乱数なので、塩も伸ばしも要らない（総当たりの余地が無い）。
*/
export async function sessionKey(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
  return hex(new Uint8Array(digest))
}

// 比較は定数時間で。早期 return すると、どこまで一致したかが時間に出る
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

// 返す token がクッキーに入る値。D1 にはそのハッシュしか置かない
export async function createSession(db: Db, userId: number) {
  const token = newToken()
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000)
  await db
    .insert(schema.sessions)
    .values({ id: await sessionKey(token), userId, expiresAt: expiresAt.toISOString() })
  // 期限切れはここで掃除する。掃除だけの定期実行を持たないための割り切り
  await db.delete(schema.sessions).where(lt(schema.sessions.expiresAt, new Date().toISOString()))
  return { token, expiresAt }
}

export async function getSessionUser(db: Db, token: string) {
  const id = await sessionKey(token)
  const rows = await db
    .select({ user: schema.users, expiresAt: schema.sessions.expiresAt })
    .from(schema.sessions)
    .innerJoin(schema.users, eq(schema.users.id, schema.sessions.userId))
    .where(eq(schema.sessions.id, id))
    .limit(1)

  const row = rows[0]
  if (!row) return null
  if (new Date(row.expiresAt) < new Date()) {
    await db.delete(schema.sessions).where(eq(schema.sessions.id, id))
    return null
  }
  return row.user
}

export async function destroySession(db: Db, token: string) {
  await db.delete(schema.sessions).where(eq(schema.sessions.id, await sessionKey(token)))
}

// 「すべての端末からログアウト」。その人のセッションを、いま使っている端末のものも含めて消す
export async function destroyUserSessions(db: Db, userId: number) {
  await db.delete(schema.sessions).where(eq(schema.sessions.userId, userId))
}

export type OwnerEnv = { OWNER_GITHUB_ID?: string; OWNER_GOOGLE_EMAIL?: string }

// 比べるアドレスの形。ASCII だけを小文字にする（下の ownerValue の注記）
const ASCII_EMAIL = /^[\x21-\x7e]+$/

/*
  まだ誰にも紐づいていないアカウントが、環境変数のどの値に当たるか。当たらなければ null。
  返すのは比べた形の値で、owner_claims の value になる（その値を使ったかの記録）。

  GitHub は数値の id が OWNER_GITHUB_ID と同じとき。Google はメールアドレスが
  OWNER_GOOGLE_EMAIL と同じ（大小は無視）で、かつ Google がそのアドレスを
  確かめている（email_verified）とき。確かめていないアドレスは、誰でも
  自分のアカウントに名乗らせられる。

  大小を無視するのは ASCII のアドレスだけ。ASCII でない字を含むアドレスは当てない
  ——toLowerCase は「K」（ケルビン記号 U+212A）を「k」にするので、独自ドメインの
  アドレスに変えた日に、見た目の違うアドレスが同じ値として通りうる。

  使うのは値ごとに1度だけ（userForIdentity と src/db/schema.ts の owner_claims）。
*/
export function ownerValue(env: OwnerEnv, identity: Identity): string | null {
  if (identity.provider === 'github') {
    const want = env.OWNER_GITHUB_ID?.trim()
    return want && identity.subject === want ? want : null
  }
  const want = env.OWNER_GOOGLE_EMAIL?.trim().toLowerCase()
  const email = identity.email ?? ''
  if (!want || identity.emailVerified !== true || !ASCII_EMAIL.test(email)) return null
  return email.toLowerCase() === want ? want : null
}

/*
  提供元のアカウントから、管理画面の user を引く。通さないなら null。

  1. user_identities に（提供元, subject）の行があれば、その user。label と
     最終ログインを書き直す
  2. 無ければ、環境変数の値に当たり（ownerValue）、しかもその値をまだ使って
     いない（owner_claims に行が無い）ときだけ owner に紐づける。
     環境変数は「最初の紐づけ」のためのもので、ずっと効く鍵ではない。
     値を使った記録が残るので、README のとおり紐づけを外す（user_identities の
     行を消す）と、同じアカウントでもう一度入っても紐づき直らない。同じ確認済みの
     アドレスを持つ別の Google アカウント（別の sub）も入れない
  3. どれにも当たらなければ null（呼ぶ側が 403 にする）

  2 は1つの batch（D1 ではトランザクション）で書く。
  - owner の行は ON CONFLICT DO NOTHING で作る。owner は1人の決まりを部分一意索引
    （users_one_owner）が持つので、既に居れば（パスワードの頃から居る owner も）何も
    せず、その行に紐づく。「読んでから作る」だったころは、初回のログインが2本同時に
    来ると owner が2人できた
  - 記録（owner_claims）を ON CONFLICT DO NOTHING で書き、紐づけ（user_identities）は
    「記録の ticket がこの往復の乱数であるとき」だけ書く。記録を取れなかった往復は
    何も紐づけない。記録と紐づけが同じトランザクションなので、同じアカウントで2本
    同時に来ても、負けた側が読み直すときには勝った側の紐づけがもう見える
*/
export async function userForIdentity(
  db: Db,
  env: OwnerEnv,
  identity: Identity,
): Promise<schema.User | null> {
  const where = and(
    eq(schema.userIdentities.provider, identity.provider),
    eq(schema.userIdentities.subject, identity.subject),
  )
  const linked = async () =>
    (
      await db
        .select({ user: schema.users })
        .from(schema.userIdentities)
        .innerJoin(schema.users, eq(schema.users.id, schema.userIdentities.userId))
        .where(where)
        .limit(1)
    )[0]?.user ?? null

  const found = await linked()
  if (found) {
    await db
      .update(schema.userIdentities)
      .set({ label: identity.label, lastLoginAt: sql`(datetime('now'))` })
      .where(where)
    return found
  }

  const value = ownerValue(env, identity)
  if (value === null) return null

  const ticket = newToken(16)
  const owner = db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.role, 'owner'))
    .orderBy(asc(schema.users.id))
    .limit(1)
  await db.batch([
    db.insert(schema.users).values({ role: 'owner' }).onConflictDoNothing(),
    db
      .insert(schema.ownerClaims)
      .values({ provider: identity.provider, value, subject: identity.subject, ticket })
      .onConflictDoNothing(),
    // 記録がこの往復の ticket のときだけ、1行が返って紐づく（取れなかった往復は0行）
    db
      .insert(schema.userIdentities)
      .select(
        db
          // 列は表の定義の順に全部（drizzle の insert … select の決まり）。id は自動
          .select({
            id: sql<number>`null`.as('id'),
            userId: sql<number>`(${owner})`.as('user_id'),
            provider: schema.ownerClaims.provider,
            subject: schema.ownerClaims.subject,
            label: sql<string>`${identity.label}`.as('label'),
            createdAt: sql<string>`datetime('now')`.as('created_at'),
            lastLoginAt: sql<string>`datetime('now')`.as('last_login_at'),
          })
          .from(schema.ownerClaims)
          .where(
            and(
              eq(schema.ownerClaims.provider, identity.provider),
              eq(schema.ownerClaims.value, value),
              eq(schema.ownerClaims.ticket, ticket),
            ),
          ),
      )
      .onConflictDoNothing(),
  ])
  return linked()
}

// 管理画面の足元に出す「いま誰として入っているか」。最後にログインしたアカウントの label
export async function accountLabel(db: Db, userId: number): Promise<string | null> {
  const [row] = await db
    .select({ label: schema.userIdentities.label })
    .from(schema.userIdentities)
    .where(eq(schema.userIdentities.userId, userId))
    .orderBy(desc(schema.userIdentities.lastLoginAt), desc(schema.userIdentities.id))
    .limit(1)
  return row?.label || null
}

export const SESSION_COOKIE = 'astlog_session'
