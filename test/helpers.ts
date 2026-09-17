import { env, SELF } from 'cloudflare:test'
import { drizzle } from 'drizzle-orm/d1'
import * as schema from '../src/db/schema'

export const db = () => drizzle(env.DB, { schema })

export const OWNER = { email: 'owner@example.test', password: 'correct-horse-battery' }

// テストごとに素の状態から始める。前のテストの残りに引きずられないように
export async function resetDb() {
  const database = db()
  await database.delete(schema.itemLinks)
  await database.delete(schema.itemTags)
  await database.delete(schema.items)
  await database.delete(schema.sessions)
  await database.delete(schema.users)
  await database.delete(schema.members)
  await database.delete(schema.platforms)
  await database.delete(schema.settings)
  await database.delete(schema.blocks)
  await database.insert(schema.platforms).values([
    { key: 'web', label: 'Web', sortOrder: 10 },
    { key: 'cli', label: 'CLI', sortOrder: 20 },
  ])
}

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
  return member
}

export async function seedItem(overrides: Partial<typeof schema.items.$inferInsert> = {}) {
  const [item] = await db()
    .insert(schema.items)
    .values({ type: 'app', title: 'AppMixer', published: 1, sortOrder: 10, ...overrides })
    .returning()
  if (!item) throw new Error('item を作れなかった')
  return item
}

export function form(values: Record<string, string | string[]>) {
  const body = new FormData()
  for (const [key, value] of Object.entries(values)) {
    for (const one of Array.isArray(value) ? value : [value]) body.append(key, one)
  }
  return body
}

// ログインして Cookie を持った fetch を返す。
// 管理画面のテストは、毎回ここを通る（認証の壁ごと確かめたいため）
export async function signIn() {
  await SELF.fetch('https://noctifex.test/admin/setup', {
    method: 'POST',
    body: form({ token: 'test-setup-token', email: OWNER.email, password: OWNER.password }),
  })

  const response = await SELF.fetch('https://noctifex.test/admin/login', {
    method: 'POST',
    body: form({ email: OWNER.email, password: OWNER.password }),
    redirect: 'manual',
  })
  const cookie = response.headers.get('set-cookie')?.split(';')[0]
  if (!cookie) throw new Error(`ログインできなかった: ${response.status}`)

  return (path: string, init: RequestInit = {}) =>
    SELF.fetch(`https://noctifex.test${path}`, {
      ...init,
      redirect: 'manual',
      headers: { ...init.headers, cookie },
    })
}

export const get = (path: string, init: RequestInit = {}) =>
  SELF.fetch(`https://noctifex.test${path}`, { redirect: 'manual', ...init })
