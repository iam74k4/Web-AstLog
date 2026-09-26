import { env, SELF } from 'cloudflare:test'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { expect } from 'vitest'
import * as schema from '../src/db/schema'
import { createSession, SESSION_COOKIE } from '../src/lib/auth'
import { touchSite } from '../src/lib/page-cache'

export const db = () => drizzle(env.DB, { schema })

// テストごとに素の状態から始める。前のテストの残りに引きずられないように
export async function resetDb() {
  const database = db()
  await database.delete(schema.itemSlugRedirects)
  await database.delete(schema.memberSlugRedirects)
  await database.delete(schema.itemLinks)
  await database.delete(schema.itemTags)
  await database.delete(schema.items)
  await database.delete(schema.sessions)
  await database.delete(schema.userIdentities)
  await database.delete(schema.ownerClaims)
  await database.delete(schema.oauthStates)
  await database.delete(schema.users)
  await database.delete(schema.members)
  await database.delete(schema.platforms)
  await database.delete(schema.settings)
  await database.delete(schema.blocks)
  await database.insert(schema.platforms).values([
    { key: 'web', label: 'Web', sortOrder: 10 },
    { key: 'cli', label: 'CLI', sortOrder: 20 },
  ])
  await touchSite(env.MEDIA)
}

/*
  D1 を直に書いたあとで、公開ページの写し（src/lib/page-cache.ts）の版を上げる。
  管理画面を通らない書き換えは版を上げないので、本番で D1 を手で直したときと同じく
  上げてから見る（本番では npm run site:touch）。resetDb と seed… は自分で上げる。
*/
export const touch = () => touchSite(env.MEDIA)

/*
  写しを持たない env。Worker の版（写しの鍵に入る）を呼ぶたびに新しくするので、
  前のテストが置いた写しに当たらない。app.fetch に別の DB を渡して描き比べる
  テスト（写しではなく、その DB で描いた結果を見たいもの）が使う
*/
export const uncachedEnv = (overrides: Partial<Cloudflare.Env> = {}): Cloudflare.Env => ({
  ...env,
  CF_VERSION_METADATA: { id: crypto.randomUUID(), tag: '', timestamp: new Date().toISOString() },
  ...overrides,
})

export async function seedMember(overrides: Partial<typeof schema.members.$inferInsert> = {}) {
  const [member] = await db()
    .insert(schema.members)
    .values({
      slug: 'okazaki',
      name: '岡崎 昂功',
      role: 'System Engineer',
      published: 1,
      sortOrder: 10,
      ...overrides,
    })
    .returning()
  if (!member) throw new Error('member を作れなかった')
  await touchSite(env.MEDIA)
  return member
}

export async function seedItem(overrides: Partial<typeof schema.items.$inferInsert> = {}) {
  const [item] = await db()
    .insert(schema.items)
    .values({ type: 'app', title: 'AppMixer', published: 1, sortOrder: 10, ...overrides })
    .returning()
  if (!item) throw new Error('item を作れなかった')
  await touchSite(env.MEDIA)
  return item
}

export function form(values: Record<string, string | string[]>) {
  const body = new FormData()
  for (const [key, value] of Object.entries(values)) {
    for (const one of Array.isArray(value) ? value : [value]) body.append(key, one)
  }
  return body
}

/*
  owner の行（と、GitHub のアカウントの紐づけ）。何度呼んでも1人だけ。
  subject は vitest.config.ts の OWNER_GITHUB_ID と同じ値にしてある
*/
export async function ensureOwner() {
  const found = await db().query.users.findFirst({ where: eq(schema.users.role, 'owner') })
  if (found) return found
  const [owner] = await db().insert(schema.users).values({ role: 'owner' }).returning()
  if (!owner) throw new Error('owner を作れなかった')
  await db()
    .insert(schema.userIdentities)
    .values({ userId: owner.id, provider: 'github', subject: '1001', label: '@owner' })
  return owner
}

// セッションのクッキー（nx_session=…）を持った fetch
export const withCookie =
  (cookie: string) =>
  (path: string, init: RequestInit = {}) =>
    SELF.fetch(`https://noctifex.test${path}`, {
      ...init,
      redirect: 'manual',
      headers: { ...init.headers, cookie },
    })

/*
  ログインして Cookie を持った fetch を返す。

  OAuth の往復（提供元への fetch）は通さず、セッションを D1 に直接作る。
  往復そのものは test/oauth.test.ts が提供元を差し替えて確かめている。ここで
  毎回通すと、管理画面のどのテストも提供元の偽物に寄りかかることになる。
  認証の壁（クッキー → D1 のセッション）は、このクッキーで毎回通る。
*/
export async function signIn() {
  const owner = await ensureOwner()
  const { token } = await createSession(db(), owner.id)
  return withCookie(`${SESSION_COOKIE}=${token}`)
}

export const get = (path: string, init: RequestInit = {}) =>
  SELF.fetch(`https://noctifex.test${path}`, { redirect: 'manual', ...init })

/*
  公開ページを 200 で受け取り、本文を返す。**本文を読んで確かめるテストはこれを通す。**

  get(...).text() のまま「〜を含まない」を確かめると、URL が 404 や 301 に変わった日に
  空の本文（や 404 のページ）を見て緑になる。Projects を1つにまとめたとき、
  /apps の「構造化データを載せない」は /apps が本文の無い 301 になってからずっと
  何も確かめていなかった。先に状態を確かめれば、否定の期待が空振りしない。
  404 や 301 の本文そのものを見たいテストは、get で状態を確かめてから読むこと。
*/
export async function okText(path: string, init: RequestInit = {}) {
  const response = await get(path, init)
  expect(response.status, `${path} が ${response.status} を返した（200 を期待）`).toBe(200)
  return response.text()
}
