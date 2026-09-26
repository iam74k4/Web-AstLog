import { and, asc, desc, eq, lt, sql } from 'drizzle-orm'
import type { DrizzleD1Database } from 'drizzle-orm/d1'
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

type Db = DrizzleD1Database<typeof schema>

export function newToken(bytes = 32): string {
  return [...crypto.getRandomValues(new Uint8Array(bytes))]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/*
  D1 の sessions.id に入れる値。クッキーの値（newToken の 32 バイト）を
  SHA-256 にした16進。D1 の写しだけが漏れても、そこからクッキーは作れない。
  入力が 256 ビットの乱数なので、塩も伸ばしも要らない（総当たりの余地が無い）。
*/
export async function sessionKey(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
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

/*
  まだ誰にも紐づいていないアカウントを、owner に紐づけてよいか。

  GitHub は数値の id が OWNER_GITHUB_ID と同じとき。Google はメールアドレスが
  OWNER_GOOGLE_EMAIL と同じ（大小は無視）で、かつ Google がそのアドレスを
  確かめている（email_verified）とき。確かめていないアドレスは、誰でも
  自分のアカウントに名乗らせられる。

  使うのは最初の1回だけ。紐づいたあとは subject で引く（userForIdentity）。
*/
export function isOwnerIdentity(env: OwnerEnv, identity: Identity): boolean {
  if (identity.provider === 'github') {
    const want = env.OWNER_GITHUB_ID?.trim()
    return Boolean(want) && identity.subject === want
  }
  const want = env.OWNER_GOOGLE_EMAIL?.trim().toLowerCase()
  return Boolean(want) && identity.emailVerified === true && identity.email?.toLowerCase() === want
}

/*
  提供元のアカウントから、管理画面の user を引く。通さないなら null。

  1. user_identities に（提供元, subject）の行があれば、その user。label と
     最終ログインを書き直す
  2. 無ければ、isOwnerIdentity に当たったときだけ owner に紐づける。owner の行は
     既にあればそれ（パスワードの頃から居る owner も id を変えずに引き継ぐ）、
     無ければ作る
  3. どれにも当たらなければ null（呼ぶ側が 403 にする）
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

  if (!isOwnerIdentity(env, identity)) return null

  const owner =
    (await db.query.users.findFirst({
      where: eq(schema.users.role, 'owner'),
      orderBy: [asc(schema.users.id)],
    })) ?? (await db.insert(schema.users).values({ role: 'owner' }).returning())[0]
  if (!owner) return null

  /*
    同じアカウントで2本同時に来ても、unique に当たった側は黙って下がり、
    先に入った行の user を読み直して返す（自分が作った owner を返さない）
  */
  await db
    .insert(schema.userIdentities)
    .values({
      userId: owner.id,
      provider: identity.provider,
      subject: identity.subject,
      label: identity.label,
    })
    .onConflictDoNothing()
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

export const SESSION_COOKIE = 'nx_session'
