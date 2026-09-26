import { describe, expect, it } from 'vitest'
import { isOwnerIdentity, newToken, sessionKey, timingSafeEqual } from '../src/lib/auth'
import {
  base64url,
  callbackUrl,
  clientFor,
  IdTokenError,
  pkcePair,
  readIdToken,
} from '../src/lib/oauth'

describe('newToken', () => {
  it('毎回違う値を返す', () => {
    expect(newToken()).not.toBe(newToken())
  })

  it('長さはバイト数の2倍（hex）', () => {
    expect(newToken(8)).toHaveLength(16)
  })
})

describe('sessionKey', () => {
  it('クッキーの値そのものではなく、その SHA-256（16進 64 字）', async () => {
    const token = newToken()
    const key = await sessionKey(token)
    expect(key).toMatch(/^[0-9a-f]{64}$/)
    expect(key).not.toBe(token)
    // 同じ値からは同じ鍵（毎回ハッシュしてから引くので、ずれると誰も入れない）
    expect(await sessionKey(token)).toBe(key)
    // 既知の値で確かめる（SHA-256("abc")）
    expect(await sessionKey('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    )
  })
})

it('timingSafeEqual は長さも中身も見る', () => {
  expect(timingSafeEqual('abc', 'abc')).toBe(true)
  expect(timingSafeEqual('abc', 'abd')).toBe(false)
  expect(timingSafeEqual('abc', 'abcd')).toBe(false)
})

describe('PKCE', () => {
  it('verifier は 43 字、challenge はその SHA-256 の base64url（S256）', async () => {
    const { verifier, challenge } = await pkcePair()
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43}$/)
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
    expect(challenge).toBe(base64url(new Uint8Array(digest)))
  })
})

it('クライアントは ID とシークレットの両方がそろったときだけ使う', () => {
  expect(clientFor({ GITHUB_CLIENT_ID: 'id' }, 'github')).toBeNull()
  expect(clientFor({ GITHUB_CLIENT_ID: 'id', GITHUB_CLIENT_SECRET: 's' }, 'github')).toEqual({
    id: 'id',
    secret: 's',
  })
  expect(clientFor({ GITHUB_CLIENT_ID: 'id', GITHUB_CLIENT_SECRET: 's' }, 'google')).toBeNull()
})

describe('コールバック（redirect_uri）', () => {
  it('ふだんはリクエストの origin。本番は https://noctifex.dev', () => {
    expect(callbackUrl({}, 'https://noctifex.dev/admin/auth/github/start?next=x', 'github')).toBe(
      'https://noctifex.dev/admin/auth/github/callback',
    )
  })

  /*
    wrangler dev は routes があると、Worker に見せる URL を http://noctifex.dev/… に
    書き換える（実測。ブラウザは localhost:8787 に居る）。そのまま組むと、開発用に
    登録したコールバックと食い違って提供元に断られる
  */
  it('wrangler dev では OAUTH_REDIRECT_ORIGIN を使う。読めない値なら使わない', () => {
    const dev = { OAUTH_REDIRECT_ORIGIN: 'http://localhost:8787/' }
    expect(callbackUrl(dev, 'http://noctifex.dev/admin/auth/google/start', 'google')).toBe(
      'http://localhost:8787/admin/auth/google/callback',
    )
    expect(
      callbackUrl({ OAUTH_REDIRECT_ORIGIN: 'not a url' }, 'https://noctifex.dev/x', 'github'),
    ).toBe('https://noctifex.dev/admin/auth/github/callback')
  })
})

describe('最初の紐づけ（isOwnerIdentity）', () => {
  const env = { OWNER_GITHUB_ID: '1001', OWNER_GOOGLE_EMAIL: 'Owner@Example.test' }

  it('GitHub は数値の id だけを見る。ログイン名が同じでも id が違えば通さない', () => {
    expect(isOwnerIdentity(env, { provider: 'github', subject: '1001', label: '@x' })).toBe(true)
    expect(isOwnerIdentity(env, { provider: 'github', subject: '1002', label: '@owner' })).toBe(
      false,
    )
  })

  it('Google は確認済みのアドレスだけ。大小は無視する', () => {
    const google = (email: string, emailVerified: boolean) =>
      isOwnerIdentity(env, { provider: 'google', subject: 's', label: email, email, emailVerified })
    expect(google('owner@example.TEST', true)).toBe(true)
    expect(google('owner@example.test', false)).toBe(false)
    expect(google('someone@example.test', true)).toBe(false)
  })

  it('設定が空なら誰も通さない（空の ID と空のアドレスを一致とみなさない）', () => {
    expect(isOwnerIdentity({}, { provider: 'github', subject: '', label: '' })).toBe(false)
    expect(
      isOwnerIdentity(
        { OWNER_GOOGLE_EMAIL: '' },
        { provider: 'google', subject: 's', label: '', email: '', emailVerified: true },
      ),
    ).toBe(false)
  })
})

describe('id_token の検査（readIdToken）', () => {
  const clientId = 'test-google-client.apps.googleusercontent.com'
  const now = new Date('2026-09-26T12:00:00Z')
  const good = {
    iss: 'https://accounts.google.com',
    aud: clientId,
    sub: '110000000000000000001',
    exp: now.getTime() / 1000 + 600,
    nonce: 'n-1',
    email: 'owner@example.test',
    email_verified: true,
  }
  const token = (claims: Record<string, unknown>) =>
    [{ alg: 'RS256', typ: 'JWT' }, claims]
      .map((part) => base64url(new TextEncoder().encode(JSON.stringify(part))))
      .concat('signature')
      .join('.')
  const read = (claims: Record<string, unknown>) =>
    readIdToken(token(claims), { clientId, nonce: 'n-1' }, now)

  it('この往復のものなら中身を返す。iss は2つの書き方のどちらでもよい', () => {
    expect(read(good).sub).toBe(good.sub)
    expect(read({ ...good, iss: 'accounts.google.com' }).sub).toBe(good.sub)
    expect(read({ ...good, aud: [clientId, 'other'], azp: clientId }).sub).toBe(good.sub)
  })

  it.each([
    ['iss が違う', { iss: 'https://evil.example' }],
    ['aud が違う', { aud: 'other-client' }],
    ['aud が複数で azp が違う', { aud: [clientId, 'other'], azp: 'other' }],
    ['期限切れ', { exp: now.getTime() / 1000 - 1 }],
    ['exp が無い', { exp: undefined }],
    ['nonce が違う', { nonce: 'n-2' }],
    ['nonce が無い', { nonce: undefined }],
    ['sub が無い', { sub: '' }],
  ])('%s なら受け付けない', (_, change) => {
    expect(() => read({ ...good, ...change })).toThrow(IdTokenError)
  })

  it('形の壊れたものは例外（IdTokenError）にする', () => {
    expect(() => readIdToken('abc', { clientId, nonce: 'n-1' }, now)).toThrow(IdTokenError)
    expect(() => readIdToken('a.%%%.c', { clientId, nonce: 'n-1' }, now)).toThrow(IdTokenError)
  })
})
