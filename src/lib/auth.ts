import { eq, lt } from 'drizzle-orm'
import type { DrizzleD1Database } from 'drizzle-orm/d1'
import * as schema from '../db/schema'

/*
  パスワードは PBKDF2-SHA256 で伸ばして保存する。Workers には bcrypt が無く、
  WebCrypto だけで完結するのがこれ。保存形式は pbkdf2$<反復回数>$<salt>$<hash>。
  反復回数を字面に含めているので、後で上げても古い行を読み続けられる。

  注意: 反復回数は CPU 時間に直結する。Workers の無料プランは1リクエスト
  10ms なので、ログインだけがその上限に当たりうる。実測して決めること。
*/
const ITERATIONS = 100_000
const KEY_BITS = 256
const SESSION_DAYS = 14

const encoder = new TextEncoder()

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

async function derive(password: string, salt: Uint8Array, iterations: number) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, [
    'deriveBits',
  ])
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations },
    key,
    KEY_BITS,
  )
  return new Uint8Array(bits)
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const hash = await derive(password, salt, ITERATIONS)
  return `pbkdf2$${ITERATIONS}$${toBase64(salt)}$${toBase64(hash)}`
}

// 比較は必ず定数時間で。早期 return すると、どこまで一致したかが時間に出る
function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= (a[i] as number) ^ (b[i] as number)
  return diff === 0
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, iterations, salt, hash] = stored.split('$')
  if (scheme !== 'pbkdf2' || !iterations || !salt || !hash) return false
  const derived = await derive(password, fromBase64(salt), Number(iterations))
  return timingSafeEqual(derived, fromBase64(hash))
}

export function newToken(bytes = 32): string {
  return [...crypto.getRandomValues(new Uint8Array(bytes))]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

export async function createSession(db: DrizzleD1Database<typeof schema>, userId: number) {
  const id = newToken()
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000)
  await db.insert(schema.sessions).values({ id, userId, expiresAt: expiresAt.toISOString() })
  // 期限切れはここで掃除する。掃除だけの定期実行を持たないための割り切り
  await db.delete(schema.sessions).where(lt(schema.sessions.expiresAt, new Date().toISOString()))
  return { id, expiresAt }
}

export async function getSessionUser(db: DrizzleD1Database<typeof schema>, sessionId: string) {
  const rows = await db
    .select({ user: schema.users, expiresAt: schema.sessions.expiresAt })
    .from(schema.sessions)
    .innerJoin(schema.users, eq(schema.users.id, schema.sessions.userId))
    .where(eq(schema.sessions.id, sessionId))
    .limit(1)

  const row = rows[0]
  if (!row) return null
  if (new Date(row.expiresAt) < new Date()) {
    await destroySession(db, sessionId)
    return null
  }
  return row.user
}

export async function destroySession(db: DrizzleD1Database<typeof schema>, sessionId: string) {
  await db.delete(schema.sessions).where(eq(schema.sessions.id, sessionId))
}

/*
  ログイン試行の制限。KV の TTL に任せるので、掃除する処理を持たない。
  メールアドレス単位で数える（IP は共有されることがあるため）。
*/
const MAX_ATTEMPTS = 5
const WINDOW_SECONDS = 900

export async function loginAttempts(kv: KVNamespace, email: string): Promise<number> {
  const value = await kv.get(`login:${email.toLowerCase()}`)
  return value ? Number(value) : 0
}

export async function recordLoginFailure(kv: KVNamespace, email: string): Promise<void> {
  const key = `login:${email.toLowerCase()}`
  const next = ((await kv.get(key)) ? Number(await kv.get(key)) : 0) + 1
  await kv.put(key, String(next), { expirationTtl: WINDOW_SECONDS })
}

export async function clearLoginFailures(kv: KVNamespace, email: string): Promise<void> {
  await kv.delete(`login:${email.toLowerCase()}`)
}

export const LOGIN_LIMIT = { max: MAX_ATTEMPTS, windowMinutes: WINDOW_SECONDS / 60 }
export const SESSION_COOKIE = 'nx_session'
