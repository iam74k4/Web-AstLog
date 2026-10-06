import { env } from 'cloudflare:test'
import { drizzle } from 'drizzle-orm/d1'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as schema from '../src/db/schema'
import { createSession, SESSION_COOKIE, sessionKey, userForIdentity } from '../src/lib/auth'
import { base64url } from '../src/lib/oauth'
import { db, ensureOwner, form, get, okText, resetDb, withCookie } from './helpers'

/*
  管理画面のログイン（GitHub と Google の OAuth）の往復。

  提供元への fetch は globalThis.fetch を差し替えて受ける（テストは SELF と
  同じ isolate で動くので、Worker の中の fetch もここに来る）。差し替えに無い
  宛先へ出たら例外にする——知らないうちに本物の提供元へ出ていく道を残さない。

  設定（クライアント ID・OWNER_…）は vitest.config.ts の bindings にある
  テスト用の値。OWNER_GITHUB_ID は 1001、OWNER_GOOGLE_EMAIL は Owner@Example.test。
*/

beforeEach(resetDb)
afterEach(() => {
  vi.restoreAllMocks()
})

const ORIGIN = 'https://astlog.test'
const GOOGLE_CLIENT = 'test-google-client.apps.googleusercontent.com'
const GITHUB_TOKEN = 'gho_secret_token_do_not_leak'
const GOOGLE_TOKEN = 'ya29.secret_token_do_not_leak'

type Provider = 'github' | 'google'
type Handler = (request: Request) => Response | Promise<Response>

const json = (body: unknown, status = 200) => Response.json(body, { status })

// フォームの本文（application/x-www-form-urlencoded）を開く。.text() は workerd が警告を出す
const formBody = async (request: Request) =>
  new URLSearchParams(new TextDecoder().decode(await request.arrayBuffer()))

// 外への fetch を受ける偽物。呼ばれた宛先と、打ち切りの signal が付いていたかを残す
function providers(handlers: Record<string, Handler>) {
  const calls: { key: string; timed: boolean }[] = []
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const request = new Request(input as RequestInfo, init)
    const url = new URL(request.url)
    const key = `${request.method} ${url.origin}${url.pathname}`
    calls.push({ key, timed: init?.signal instanceof AbortSignal })
    const handler = handlers[key]
    if (!handler) throw new Error(`想定していない fetch: ${key}`)
    return handler(request)
  })
  return calls
}

function github(user: Record<string, unknown> = { id: 1001, login: 'owner' }) {
  const seen: { body?: URLSearchParams; accept?: string | null; auth?: string | null } = {}
  const handlers: Record<string, Handler> = {
    'POST https://github.com/login/oauth/access_token': async (request) => {
      seen.body = await formBody(request)
      seen.accept = request.headers.get('accept')
      return json({ access_token: GITHUB_TOKEN, token_type: 'bearer', scope: '' })
    },
    'GET https://api.github.com/user': (request) => {
      seen.auth = request.headers.get('authorization')
      // GitHub の API は User-Agent が無いと 403 を返す
      if (!request.headers.get('user-agent')) return json({ message: 'no UA' }, 403)
      return json(user)
    },
  }
  return { seen, handlers }
}

const idToken = (claims: Record<string, unknown>) =>
  [{ alg: 'RS256', typ: 'JWT' }, claims]
    .map((part) => base64url(new TextEncoder().encode(JSON.stringify(part))))
    .concat('signature')
    .join('.')

const googleClaims = (nonce: string, change: Record<string, unknown> = {}) => ({
  iss: 'https://accounts.google.com',
  aud: GOOGLE_CLIENT,
  sub: '110000000000000000001',
  exp: Math.floor(Date.now() / 1000) + 600,
  iat: Math.floor(Date.now() / 1000),
  nonce,
  email: 'owner@example.test',
  email_verified: true,
  ...change,
})

function google(claims: Record<string, unknown>) {
  const seen: { body?: URLSearchParams } = {}
  const handlers: Record<string, Handler> = {
    'POST https://oauth2.googleapis.com/token': async (request) => {
      seen.body = await formBody(request)
      return json({
        access_token: GOOGLE_TOKEN,
        id_token: idToken(claims),
        token_type: 'Bearer',
        expires_in: 3599,
      })
    },
  }
  return { seen, handlers }
}

// /admin/auth/:provider/start を開き、提供元へ送った URL と state のクッキーを返す
async function start(provider: Provider, next?: string) {
  const query = next ? `?next=${encodeURIComponent(next)}` : ''
  const response = await get(`/admin/auth/${provider}/start${query}`)
  expect(response.status).toBe(302)
  const location = new URL(response.headers.get('location') ?? '')
  const stateCookie =
    response.headers.getSetCookie().find((one) => one.startsWith('astlog_oauth_state=')) ?? ''
  return {
    location,
    stateCookie,
    cookie: stateCookie.split(';')[0] ?? '',
    state: location.searchParams.get('state') ?? '',
    nonce: location.searchParams.get('nonce') ?? '',
    challenge: location.searchParams.get('code_challenge') ?? '',
  }
}

const callback = (provider: Provider, query: Record<string, string>, cookie?: string) =>
  get(
    `/admin/auth/${provider}/callback?${new URLSearchParams(query)}`,
    cookie ? { headers: { cookie } } : {},
  )

// 値の入ったセッションのクッキー（消すための空のクッキーは数えない）
const sessionCookie = (response: Response) =>
  response.headers
    .getSetCookie()
    .find((one) => one.startsWith(`${SESSION_COOKIE}=`) && !one.startsWith(`${SESSION_COOKIE}=;`))

const identities = () => db().select().from(schema.userIdentities)
const users = () => db().select().from(schema.users)
const states = () => db().select().from(schema.oauthStates)

async function signInWith(provider: Provider, handlers: Record<string, Handler>, next?: string) {
  providers(handlers)
  const flow = await start(provider, next)
  return callback(provider, { code: 'the-code', state: flow.state }, flow.cookie)
}

describe('GitHub でログイン', () => {
  it('提供元へ送る: state・PKCE（S256）・スコープ無し。state は D1 とクッキーの両方に置く', async () => {
    const flow = await start('github')
    const params = flow.location.searchParams
    expect(`${flow.location.origin}${flow.location.pathname}`).toBe(
      'https://github.com/login/oauth/authorize',
    )
    expect(params.get('client_id')).toBe('test-github-client')
    expect(params.get('redirect_uri')).toBe(`${ORIGIN}/admin/auth/github/callback`)
    expect(params.get('code_challenge_method')).toBe('S256')
    expect(flow.challenge).toMatch(/^[A-Za-z0-9_-]{43}$/)
    // 公開プロフィールだけ。メールアドレスもリポジトリも頼まない
    expect(params.get('scope')).toBeNull()
    expect(flow.state).toMatch(/^[0-9a-f]{64}$/)

    // 往復の2本にだけ送られる、JavaScript から読めない、Lax のクッキー
    for (const attribute of ['HttpOnly', 'Secure', 'SameSite=Lax', 'Path=/admin/auth']) {
      expect(flow.stateCookie).toContain(attribute)
    }
    expect(flow.cookie).toBe(`astlog_oauth_state=${flow.state}`)

    const [row] = await states()
    expect(row?.state).toBe(flow.state)
    expect(row?.provider).toBe('github')
    const minutes = (new Date(row?.expiresAt ?? 0).getTime() - Date.now()) / 60_000
    expect(minutes).toBeGreaterThan(9)
    expect(minutes).toBeLessThanOrEqual(10)
  })

  it('初回は OWNER_GITHUB_ID と一致したら owner に紐づけ、2回目からは数値の id で照合する', async () => {
    const mock = github({ id: 1001, login: 'owner' })
    const calls = providers(mock.handlers)
    const flow = await start('github')
    const response = await callback('github', { code: 'c-1', state: flow.state }, flow.cookie)

    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe('/admin')
    const cookie = sessionCookie(response)
    for (const attribute of ['HttpOnly', 'Secure', 'SameSite=Lax', 'Path=/']) {
      expect(cookie).toContain(attribute)
    }
    // state のクッキーは使い切ったので消す
    expect(response.headers.getSetCookie().join('\n')).toMatch(/astlog_oauth_state=;.*Max-Age=0/)

    // トークンの交換: PKCE の verifier は、送った challenge の元になった値
    const verifier = mock.seen.body?.get('code_verifier') ?? ''
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
    expect(base64url(new Uint8Array(digest))).toBe(flow.challenge)
    expect(mock.seen.body?.get('code')).toBe('c-1')
    expect(mock.seen.body?.get('client_secret')).toBe('test-github-secret')
    expect(mock.seen.body?.get('redirect_uri')).toBe(`${ORIGIN}/admin/auth/github/callback`)
    expect(mock.seen.accept).toBe('application/json')
    expect(mock.seen.auth).toBe(`Bearer ${GITHUB_TOKEN}`)
    // 外への fetch はどれも打ち切りの signal 付き
    expect(calls.map((call) => call.timed)).toEqual([true, true])

    const [linked] = await identities()
    expect(linked).toMatchObject({ provider: 'github', subject: '1001', label: '@owner' })
    const [owner] = await users()
    expect(owner?.role).toBe('owner')
    expect(linked?.userId).toBe(owner?.id)
    expect((await withCookie(cookie?.split(';')[0] ?? '')('/admin/members')).status).toBe(200)

    // 2回目。ログイン名を変えても id で入れる。label は書き直す
    const renamed = github({ id: 1001, login: 'renamed' })
    vi.restoreAllMocks()
    const again = await signInWith('github', renamed.handlers)
    expect(again.status).toBe(303)
    expect(sessionCookie(again)).toBeDefined()
    expect(await users()).toHaveLength(1)
    expect((await identities()).map((one) => one.label)).toEqual(['@renamed'])
  })

  it('パスワードの頃から居る owner には、id を変えずに紐づく', async () => {
    const [before] = await db().insert(schema.users).values({ role: 'owner' }).returning()
    const response = await signInWith('github', github().handlers)
    expect(response.status).toBe(303)
    expect(await users()).toHaveLength(1)
    expect((await identities())[0]?.userId).toBe(before?.id)
  })

  it('知らないアカウントは 403。その人の ID は出すが、紐づけもセッションも作らない', async () => {
    const response = await signInWith('github', github({ id: 2002, login: 'owner' }).handlers)
    expect(response.status).toBe(403)
    const html = await response.text()
    expect(html).toContain('このアカウントでは入れません')
    // ログイン名が持ち主と同じでも、id が違えば別人
    expect(html).toContain('ID 2002')
    expect(html).toContain('OWNER_GITHUB_ID')
    expect(sessionCookie(response)).toBeUndefined()
    expect(await identities()).toHaveLength(0)
    expect(await users()).toHaveLength(0)
  })

  it('提供元との通信に失敗したら 502。トークンは画面にもログにも出さない', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const broken: Record<string, Handler>[] = [
      // トークンの交換が 500
      { 'POST https://github.com/login/oauth/access_token': () => json({}, 500) },
      // 届かない
      {
        'POST https://github.com/login/oauth/access_token': () => {
          throw new TypeError('network down')
        },
      },
      // code が違う。GitHub はこれを 200 で返す
      {
        'POST https://github.com/login/oauth/access_token': () =>
          json({ error: 'bad_verification_code', error_description: 'The code is incorrect' }),
      },
      // トークンは出たが、本人を引けない
      {
        'POST https://github.com/login/oauth/access_token': () =>
          json({ access_token: GITHUB_TOKEN }),
        'GET https://api.github.com/user': () => json({ message: 'Bad credentials' }, 401),
      },
      // 本人の形が違う（id が無い）
      {
        'POST https://github.com/login/oauth/access_token': () =>
          json({ access_token: GITHUB_TOKEN }),
        'GET https://api.github.com/user': () => json({ login: 'owner' }),
      },
    ]
    for (const [index, handlers] of broken.entries()) {
      vi.spyOn(globalThis, 'fetch').mockRestore()
      const response = await signInWith('github', handlers)
      expect(response.status, String(index)).toBe(502)
      const html = await response.text()
      expect(html, String(index)).toContain('GitHub との通信に失敗しました')
      expect(html, String(index)).not.toContain(GITHUB_TOKEN)
      expect(sessionCookie(response), String(index)).toBeUndefined()
    }
    const logged = errors.mock.calls.flat().map(String).join('\n')
    expect(logged).toContain('GitHub')
    expect(logged).not.toContain(GITHUB_TOKEN)
    expect(await identities()).toHaveLength(0)
  })
})

describe('Google でログイン', () => {
  it('提供元へ送る: openid email・PKCE（S256）・nonce・select_account', async () => {
    const flow = await start('google')
    const params = flow.location.searchParams
    expect(`${flow.location.origin}${flow.location.pathname}`).toBe(
      'https://accounts.google.com/o/oauth2/v2/auth',
    )
    expect(params.get('client_id')).toBe(GOOGLE_CLIENT)
    expect(params.get('redirect_uri')).toBe(`${ORIGIN}/admin/auth/google/callback`)
    expect(params.get('response_type')).toBe('code')
    expect(params.get('scope')).toBe('openid email')
    expect(params.get('prompt')).toBe('select_account')
    expect(params.get('code_challenge_method')).toBe('S256')
    expect(flow.nonce).toMatch(/^[0-9a-f]{64}$/)
    expect((await states())[0]?.nonce).toBe(flow.nonce)
  })

  it('初回は確認済みの OWNER_GOOGLE_EMAIL（大小を無視）で紐づけ、2回目からは sub で照合する', async () => {
    // GitHub で先に紐づいた owner が居れば、Google も同じ人に紐づく
    const owner = await ensureOwner()
    const flow = await start('google')
    const mock = google(googleClaims(flow.nonce, { email: 'OWNER@example.test' }))
    providers(mock.handlers)
    const response = await callback('google', { code: 'g-1', state: flow.state }, flow.cookie)

    expect(response.status).toBe(303)
    expect(sessionCookie(response)).toBeDefined()
    expect(mock.seen.body?.get('grant_type')).toBe('authorization_code')
    expect(mock.seen.body?.get('client_secret')).toBe('test-google-secret')
    expect(mock.seen.body?.get('code_verifier')).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(mock.seen.body?.get('redirect_uri')).toBe(`${ORIGIN}/admin/auth/google/callback`)

    const linked = (await identities()).find((one) => one.provider === 'google')
    expect(linked).toMatchObject({ subject: '110000000000000000001', userId: owner.id })
    expect(await users()).toHaveLength(1)

    // 2回目。アドレスが変わっても sub で入れる
    vi.restoreAllMocks()
    const next = await start('google')
    providers(google(googleClaims(next.nonce, { email: 'moved@example.test' })).handlers)
    const again = await callback('google', { code: 'g-2', state: next.state }, next.cookie)
    expect(again.status).toBe(303)
    expect((await identities()).find((one) => one.provider === 'google')?.label).toBe(
      'moved@example.test',
    )
  })

  it('email_verified が false なら、アドレスが同じでも紐づけない（403）', async () => {
    const flow = await start('google')
    providers(google(googleClaims(flow.nonce, { email_verified: false })).handlers)
    const response = await callback('google', { code: 'g', state: flow.state }, flow.cookie)
    expect(response.status).toBe(403)
    expect(await response.text()).toContain('Google で確認されていない')
    expect(sessionCookie(response)).toBeUndefined()
    expect(await identities()).toHaveLength(0)
  })

  it.each([
    ['aud が別のクライアント', { aud: 'other-client.apps.googleusercontent.com' }],
    ['iss が Google ではない', { iss: 'https://evil.example' }],
    ['nonce がこの往復のものではない', { nonce: 'replayed' }],
    ['exp が過ぎている', { exp: Math.floor(Date.now() / 1000) - 5 }],
  ])('%s id_token は受け付けない（400）', async (_, change) => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const flow = await start('google')
    providers(google(googleClaims(flow.nonce, change)).handlers)
    const response = await callback('google', { code: 'g', state: flow.state }, flow.cookie)
    expect(response.status).toBe(400)
    expect(await response.text()).toContain('ログインを確かめられませんでした')
    expect(sessionCookie(response)).toBeUndefined()
    expect(await identities()).toHaveLength(0)
  })
})

describe('state は1回きり', () => {
  it('query の state がクッキーと違えば、提供元に問い合わせずにやり直させる。どちらの札も使い切る', async () => {
    const calls = providers(github().handlers)
    const mine = await start('github')
    const theirs = await start('github')
    const response = await callback('github', { code: 'x', state: theirs.state }, mine.cookie)
    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe('/admin/login?error=expired')
    expect(sessionCookie(response)).toBeUndefined()
    expect(calls).toHaveLength(0)
    expect(await states()).toHaveLength(0)
  })

  it('クッキーが無ければやり直させる（ほかの人の state を踏ませるログイン CSRF）', async () => {
    const calls = providers(github().handlers)
    const flow = await start('github')
    const response = await callback('github', { code: 'x', state: flow.state })
    expect(response.headers.get('location')).toBe('/admin/login?error=expired')
    expect(sessionCookie(response)).toBeUndefined()
    expect(calls).toHaveLength(0)
    // 差し出された札は、弾いた場合も消える
    expect(await states()).toHaveLength(0)
  })

  it('同じ state は2度通らない（成功したあとでも）', async () => {
    const calls = providers(github().handlers)
    const flow = await start('github')
    const first = await callback('github', { code: 'c', state: flow.state }, flow.cookie)
    expect(first.status).toBe(303)
    expect(first.headers.get('location')).toBe('/admin')

    const replay = await callback('github', { code: 'c', state: flow.state }, flow.cookie)
    expect(replay.headers.get('location')).toBe('/admin/login?error=expired')
    expect(sessionCookie(replay)).toBeUndefined()
    expect(calls).toHaveLength(2)
  })

  it('期限（10分）の切れた state は通らない', async () => {
    const calls = providers(github().handlers)
    const flow = await start('github')
    await db()
      .update(schema.oauthStates)
      .set({ expiresAt: new Date(Date.now() - 1000).toISOString() })
    const response = await callback('github', { code: 'c', state: flow.state }, flow.cookie)
    expect(response.headers.get('location')).toBe('/admin/login?error=expired')
    expect(calls).toHaveLength(0)
  })

  it('期限を読めない state は通らず、提供元にも問い合わせない', async () => {
    const calls = providers(github().handlers)
    const flow = await start('github')
    await db().update(schema.oauthStates).set({ expiresAt: 'not-a-date' })

    const response = await callback('github', { code: 'c', state: flow.state }, flow.cookie)
    expect(response.headers.get('location')).toBe('/admin/login?error=expired')
    expect(sessionCookie(response)).toBeUndefined()
    expect(calls).toHaveLength(0)
    expect(await states()).toHaveLength(0)
  })

  it('別の提供元のコールバックに回した state は通らない', async () => {
    const calls = providers(github().handlers)
    const flow = await start('github')
    const response = await callback('google', { code: 'c', state: flow.state }, flow.cookie)
    expect(response.headers.get('location')).toBe('/admin/login?error=expired')
    expect(calls).toHaveLength(0)
  })

  it('期限切れの札は start のたびに掃除する', async () => {
    await db()
      .insert(schema.oauthStates)
      .values({
        state: 'old',
        provider: 'github',
        codeVerifier: 'v',
        nonce: 'n',
        expiresAt: new Date(Date.now() - 60_000).toISOString(),
      })
    await start('github')
    expect((await states()).map((row) => row.state)).not.toContain('old')
  })

  it('提供元で断ったら、ログイン画面に知らせて戻す。札は使い切る', async () => {
    const calls = providers(github().handlers)
    const flow = await start('github', '/admin/items')
    const denied = await callback(
      'github',
      { error: 'access_denied', state: flow.state },
      flow.cookie,
    )
    expect(denied.status).toBe(303)
    // 戻り先はやり直しにも持ち回す
    expect(denied.headers.get('location')).toBe('/admin/login?error=denied&next=%2Fadmin%2Fitems')
    expect(await okText(denied.headers.get('location') ?? '')).toContain('ログインを取りやめました')
    expect(await states()).toHaveLength(0)

    const other = await start('github')
    const failed = await callback(
      'github',
      { error: 'server_error', state: other.state },
      other.cookie,
    )
    expect(failed.headers.get('location')).toBe('/admin/login?error=provider')
    expect(calls).toHaveLength(0)
  })

  it('知らない提供元は 404', async () => {
    expect((await get('/admin/auth/twitter/start')).status).toBe(404)
    expect((await get('/admin/auth/twitter/callback?code=x&state=y')).status).toBe(404)
  })
})

describe('戻り先（next）', () => {
  it('start で安全化して D1 に持ち、ログインのあとでそこへ戻す', async () => {
    const response = await signInWith('github', github().handlers, '/admin/appearance')
    expect(response.headers.get('location')).toBe('/admin/appearance')
  })

  it('管理画面の外・ログインの往復そのものには戻さない', async () => {
    for (const next of [
      'https://evil.example',
      '//evil.example',
      '/admin/../..//evil',
      '/members/okazaki',
      '/admin/logout',
      '/admin/auth/github/start',
      '/admin/login',
      '/admin/%2e%2e/',
      '/admin/one/%2e%2e/auth/github/start',
      '/admin/%61uth/github/start',
      '/admin/%6cogin',
      '/admin/%2f%2fevil.example',
      '/admin/%',
    ]) {
      vi.restoreAllMocks()
      const response = await signInWith('github', github().handlers, next)
      expect(response.headers.get('location'), next).toBe('/admin')
    }
  })
})

describe('セッション', () => {
  it('期限を読めないセッションでは入れず、そのセッションを消す', async () => {
    const owner = await ensureOwner()
    const { token } = await createSession(db(), owner.id)
    await db().update(schema.sessions).set({ expiresAt: 'not-a-date' })

    const response = await withCookie(`${SESSION_COOKIE}=${token}`)('/admin/members')
    expect(response.status).toBe(303)
    expect(await db().select().from(schema.sessions)).toHaveLength(0)
  })

  it('D1 にはクッキーの値ではなく、その SHA-256 だけを置く', async () => {
    const response = await signInWith('github', github().handlers)
    const token = sessionCookie(response)?.split(';')[0]?.split('=')[1] ?? ''
    expect(token).toMatch(/^[0-9a-f]{64}$/)
    const ids = (await db().select().from(schema.sessions)).map((row) => row.id)
    expect(ids).toEqual([await sessionKey(token)])
    expect(ids).not.toContain(token)
  })

  it('ログインのたびにセッションを作り直す。前のクッキーはもう使えない', async () => {
    const owner = await ensureOwner()
    const old = (await createSession(db(), owner.id)).token
    const oldCookie = `${SESSION_COOKIE}=${old}`

    providers(github().handlers)
    const flow = await start('github')
    const response = await callback(
      'github',
      { code: 'c', state: flow.state },
      `${flow.cookie}; ${oldCookie}`,
    )
    const fresh = sessionCookie(response)?.split(';')[0] ?? ''
    expect(fresh).not.toBe(oldCookie)
    expect((await withCookie(fresh)('/admin/members')).status).toBe(200)
    expect((await withCookie(oldCookie)('/admin/members')).status).toBe(303)
    expect(await db().select().from(schema.sessions)).toHaveLength(1)
  })

  it('すべての端末からログアウトすると、その人のセッションが全部消える', async () => {
    const owner = await ensureOwner()
    const [other] = await db().insert(schema.users).values({ role: 'member' }).returning()
    const cookie = async (userId: number) =>
      `${SESSION_COOKIE}=${(await createSession(db(), userId)).token}`
    const phone = withCookie(await cookie(owner.id))
    const laptop = withCookie(await cookie(owner.id))
    const someoneElse = withCookie(await cookie(other?.id ?? 0))

    const response = await phone('/admin/account/logout-all', { method: 'POST' })
    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe('/admin/login?out=all')
    expect(response.headers.get('set-cookie')).toMatch(/astlog_session=;.*Max-Age=0/)

    expect((await phone('/admin/members')).status).toBe(303)
    expect((await laptop('/admin/members')).status).toBe(303)
    // ほかの人のセッションには触らない
    expect((await someoneElse('/admin/members')).status).toBe(200)
    expect(await okText('/admin/login?out=all')).toContain('すべての端末からログアウトしました')
  })

  it('アカウントの画面に、紐づいたアカウントと最後のログインを出す。足元からも入れる', async () => {
    const owner = await ensureOwner()
    await db().insert(schema.userIdentities).values({
      userId: owner.id,
      provider: 'google',
      subject: 'g-sub',
      label: 'owner@example.test',
      // D1 の datetime('now') は UTC。画面には日本時間で出す
      lastLoginAt: '2099-09-26 12:00:00',
    })
    const signed = withCookie(`${SESSION_COOKIE}=${(await createSession(db(), owner.id)).token}`)

    const html = await (await signed('/admin/account')).text()
    for (const text of ['GitHub', '@owner', 'Google', 'owner@example.test', '2099-09-26 21:00']) {
      expect(html).toContain(text)
    }
    expect(html).toContain('action="/admin/account/logout-all"')

    // 足元の入口は、最後にログインしたアカウントの label
    const members = await (await signed('/admin/members')).text()
    expect(members).toContain('href="/admin/account"')
    expect(members).toContain('owner@example.test</a>')
  })
})

describe('パスワードのログインは無い', () => {
  it('/admin/setup は GET も POST も 404（ログインしていてもいなくても）', async () => {
    const body = form({ token: 'x', email: 'a@example.test', password: 'x'.repeat(12) })
    expect((await get('/admin/setup')).status).toBe(404)
    expect((await get('/admin/setup', { method: 'POST', body })).status).toBe(404)
    const owner = await ensureOwner()
    const signed = withCookie(`${SESSION_COOKIE}=${(await createSession(db(), owner.id)).token}`)
    expect((await signed('/admin/setup')).status).toBe(404)
    expect(await users()).toHaveLength(1)
  })

  it('POST /admin/login ではセッションができない。ログイン画面にパスワードの欄もフォームも無い', async () => {
    await ensureOwner()
    const response = await get('/admin/login', {
      method: 'POST',
      body: form({ email: 'owner@example.test', password: 'correct-horse-battery' }),
    })
    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe('/admin/login')
    expect(sessionCookie(response)).toBeUndefined()

    const html = await okText('/admin/login')
    expect(html).not.toContain('type="password"')
    // 入口は GET のリンク（後で CSP の form-action 'self' を入れても外へ出られるように）
    expect(html).not.toContain('<form')
    expect(html).toContain('GitHub でログイン')
    expect(html).toContain('Google でログイン')
  })

  it('KV にログインの記録を書かない（KV は画像だけ）', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const keys = async () => (await env.MEDIA.list()).keys.map((key) => key.name).sort()
    const before = await keys()

    await signInWith('github', github({ id: 2002, login: 'stranger' }).handlers)
    vi.restoreAllMocks()
    await signInWith('github', github().handlers)
    await get('/admin/login', {
      method: 'POST',
      body: form({ email: 'owner@example.test', password: 'x' }),
    })

    expect(await keys()).toEqual(before)
    expect((await env.MEDIA.list({ prefix: 'login:' })).keys).toHaveLength(0)
  })
})

/*
  SEC-N1。環境変数（OWNER_GITHUB_ID / OWNER_GOOGLE_EMAIL）で owner に紐づけるのは、
  その値ごとに1度きり（使った記録は owner_claims）。以前は [vars] が残っているかぎり
  ずっと効き、README のとおり紐づけを外しても次のログインで紐づき直り、同じ確認済みの
  アドレスを持つ別の Google アカウント（別の sub）も並んで入れた。
*/
describe('環境変数で紐づけるのは値ごとに1度きり', () => {
  const claims = () => db().select().from(schema.ownerClaims)

  it('README のとおり紐づけを外すと、同じアカウントでもう一度入っても紐づき直らない', async () => {
    expect((await signInWith('github', github().handlers)).status).toBe(303)
    expect(await claims()).toEqual([
      expect.objectContaining({ provider: 'github', value: '1001', subject: '1001' }),
    ])

    // README「紐づけを外す」: user_identities の行とセッションを消す
    await env.DB.prepare("DELETE FROM user_identities WHERE provider = 'github'").run()
    await env.DB.prepare('DELETE FROM sessions').run()
    vi.restoreAllMocks()
    const again = await signInWith('github', github().handlers)
    expect(again.status).toBe(403)
    expect(sessionCookie(again)).toBeUndefined()
    expect(await identities()).toHaveLength(0)

    // また使うときは記録の行も消す（README）
    await env.DB.prepare("DELETE FROM owner_claims WHERE provider = 'github'").run()
    vi.restoreAllMocks()
    expect((await signInWith('github', github().handlers)).status).toBe(303)
    expect(await identities()).toHaveLength(1)
  })

  it('同じ確認済みのアドレスでも、別の Google アカウント（別の sub）は入れない', async () => {
    const first = await start('google')
    providers(google(googleClaims(first.nonce)).handlers)
    const linked = await callback('google', { code: 'g', state: first.state }, first.cookie)
    expect(linked.status).toBe(303)

    vi.restoreAllMocks()
    const next = await start('google')
    providers(
      google(
        googleClaims(next.nonce, { sub: '220000000000000000002', email: 'OWNER@example.test' }),
      ).handlers,
    )
    const other = await callback('google', { code: 'g', state: next.state }, next.cookie)
    expect(other.status).toBe(403)
    expect((await identities()).map((one) => one.subject)).toEqual(['110000000000000000001'])
  })

  it('環境変数を別の値に書き換えれば、新しい値として1度だけ効く', async () => {
    const google1 = { provider: 'google' as const, label: 'a@example.test', emailVerified: true }
    const envA = { OWNER_GOOGLE_EMAIL: 'a@example.test' }
    const envB = { OWNER_GOOGLE_EMAIL: 'b@example.test' }
    const a = await userForIdentity(db(), envA, {
      ...google1,
      subject: 'A',
      email: 'a@example.test',
    })
    expect(a?.role).toBe('owner')
    // 同じ値の2つ目は通らない。書き換えた値の最初の1つは通る
    expect(
      await userForIdentity(db(), envA, { ...google1, subject: 'A2', email: 'A@example.test' }),
    ).toBeNull()
    const b = await userForIdentity(db(), envB, {
      ...google1,
      subject: 'B',
      email: 'b@example.test',
    })
    expect(b?.id).toBe(a?.id)
  })
})

/*
  SEC-N4。owner は1人。owner の居ない D1 に初回のログインが2本同時に来ても、owner の
  行は1つで、どちらの紐づけもその1人に付く（users_one_owner と ON CONFLICT DO NOTHING）。
  「読んでから作る」だったころは owner が2人でき、「すべての端末からログアウト」が
  片方のセッションしか消さなかった。
*/
describe('owner は1人', () => {
  const owners = async () =>
    (await users()).filter((one) => one.role === 'owner').map((one) => one.id)
  const ownerEnv = { OWNER_GITHUB_ID: '1001', OWNER_GOOGLE_EMAIL: 'owner@example.test' }
  const githubOwner = { provider: 'github' as const, subject: '1001', label: '@owner' }
  const googleOwner = {
    provider: 'google' as const,
    subject: 'g-sub',
    label: 'owner@example.test',
    email: 'owner@example.test',
    emailVerified: true,
  }

  it('GitHub と Google の初回のログインが同時に来ても、owner は1人', async () => {
    const [a, b] = await Promise.all([
      userForIdentity(db(), ownerEnv, githubOwner),
      userForIdentity(db(), ownerEnv, googleOwner),
    ])
    const ids = await owners()
    expect(ids).toHaveLength(1)
    expect([a?.id, b?.id]).toEqual([ids[0], ids[0]])
    expect((await identities()).map((one) => one.userId)).toEqual([ids[0], ids[0]])
  })

  it('同じアカウントの初回が2本同時に来ても、owner も紐づけも1つで、どちらも入れる', async () => {
    const [a, b] = await Promise.all([
      userForIdentity(db(), ownerEnv, githubOwner),
      userForIdentity(db(), ownerEnv, githubOwner),
    ])
    const ids = await owners()
    expect(ids).toHaveLength(1)
    expect([a?.id, b?.id]).toEqual([ids[0], ids[0]])
    expect(await identities()).toHaveLength(1)
  })

  it('2人目の owner の行は DB が受け付けない（users_one_owner）', async () => {
    await db().insert(schema.users).values({ role: 'owner' })
    await expect(db().insert(schema.users).values({ role: 'owner' })).rejects.toThrow()
    // member は何人でも
    await db()
      .insert(schema.users)
      .values([{ role: 'member' }, { role: 'member' }])
  })
})

/*
  SEC-N3。ログインの入口は開くたびに D1 へ書くので、IP ごとに回数の上限を持つ
  （Workers の Rate Limiting。wrangler.toml の [[ratelimits]]: 60 秒で 10 回）。
  止めた要求は D1 に書かない。ほかの IP（持ち主）は止まらない。
*/
describe('ログインの入口の回数', () => {
  it('同じ IP から続けて開くと 429 で止め、D1 に書かない。ほかの IP は入れる', async () => {
    const from = (ip: string) => ({ headers: { 'cf-connecting-ip': ip } })
    const statuses: number[] = []
    // 窓（60 秒）の境をまたいでも必ず上限を超える数（上限 10 の2倍 + 1）
    for (let i = 0; i < 21; i += 1) {
      statuses.push((await get('/admin/auth/github/start', from('203.0.113.7'))).status)
    }
    const passed = statuses.filter((status) => status === 302).length
    expect(statuses).toContain(429)
    expect(passed).toBeLessThanOrEqual(20)
    expect(await states()).toHaveLength(passed)

    const refused = await get('/admin/auth/github/start', from('203.0.113.7'))
    expect(refused.status).toBe(429)
    expect(refused.headers.get('retry-after')).toBe('60')
    expect(await refused.text()).toContain('ログインの試行が多すぎます')

    // 叩いている IP だけが止まる。持ち主の IP からは入口が開く
    expect((await get('/admin/auth/github/start', from('198.51.100.1'))).status).toBe(302)
  })
})

/*
  0006（users から email と password_hash を外し、user_identities と oauth_states を
  足す）と 0007（平文のセッションを消す）を、パスワードの頃の D1 に当てる。

  本来の DB には setup.ts が全部の移行を当ててしまうので、空の MIGRATION_DB に
  0005 までを流して行を入れ、そのあとで新しい移行を当てる。
*/
describe('移行', () => {
  const d1 = () => env.MIGRATION_DB
  const run = async (names: (name: string) => boolean) => {
    for (const migration of env.TEST_MIGRATIONS.filter((one) => names(one.name))) {
      for (const query of migration.queries) await d1().prepare(query).run()
    }
  }

  // 前の実行の残りを片付ける（後から作った表から消す）
  const clear = async () => {
    const { results } = await d1()
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY rowid DESC",
      )
      .all<{ name: string }>()
    for (const { name } of results) await d1().prepare(`DROP TABLE \`${name}\``).run()
  }

  it('パスワードの頃の owner を、id と member を保ったまま引き継ぐ。平文のセッションは消える', async () => {
    await clear()
    await run((name) => name < '0006')
    await d1().batch([
      d1().prepare("INSERT INTO members (id, slug, name) VALUES (3, 'okazaki', '岡崎')"),
      d1().prepare(
        "INSERT INTO users (id, email, password_hash, role, member_id) VALUES (7, 'owner@example.test', 'pbkdf2$100000$x$y', 'owner', 3)",
      ),
      d1().prepare(
        "INSERT INTO sessions (id, user_id, expires_at) VALUES ('plain-cookie-value', 7, '2099-01-01T00:00:00.000Z')",
      ),
    ])

    await run((name) => name >= '0006')

    const columns = await d1().prepare('PRAGMA table_info(users)').all<{ name: string }>()
    expect(columns.results.map((column) => column.name)).toEqual([
      'id',
      'role',
      'member_id',
      'created_at',
    ])
    const owner = await d1().prepare('SELECT * FROM users').all()
    expect(owner.results).toEqual([expect.objectContaining({ id: 7, role: 'owner', member_id: 3 })])
    expect((await d1().prepare('SELECT * FROM sessions').all()).results).toHaveLength(0)

    // 初めての OAuth のログインは、その owner（id 7）に紐づく
    const migrated = drizzle(d1(), { schema })
    const user = await userForIdentity(
      migrated,
      { OWNER_GITHUB_ID: '1001' },
      { provider: 'github', subject: '1001', label: '@owner' },
    )
    expect(user?.id).toBe(7)
  })

  /*
    0013〜0016 を、その前の D1 に当てる。
    - 0013: 全角の数字で書かれた年を半角に直す（COR-3。year_from が付く）
    - 0014: owner が2人いる D1 を1人に寄せる（SEC-N4。紐づけとセッションを残す owner へ）
    - 0015: owner_claims と users_one_owner（2人のままだと索引を作れずに止まる）
    - 0016: 既に紐づいた owner のアカウントの記録を埋める（SEC-N1。外したら紐づき直らない）
  */
  it('0013〜0016: 全角の年を直し、owner を1人に寄せ、紐づけの記録を埋める', async () => {
    await clear()
    await run((name) => name < '0013')
    await d1().batch([
      d1().prepare("INSERT INTO members (id, slug, name) VALUES (4, 'okazaki', '岡崎')"),
      d1().prepare("INSERT INTO users (id, role) VALUES (3, 'owner')"),
      d1().prepare("INSERT INTO users (id, role, member_id) VALUES (5, 'owner', 4)"),
      d1().prepare(
        "INSERT INTO user_identities (user_id, provider, subject, label) VALUES (3, 'github', '1001', '@owner')",
      ),
      d1().prepare(
        "INSERT INTO user_identities (user_id, provider, subject, label) VALUES (5, 'google', 'g-sub', 'Owner@Example.test')",
      ),
      d1().prepare(
        "INSERT INTO sessions (id, user_id, expires_at) VALUES ('s3', 3, '2099-01-01T00:00:00.000Z'), ('s5', 5, '2099-01-01T00:00:00.000Z')",
      ),
      d1().prepare(
        "INSERT INTO items (type, title, slug, year) VALUES ('app', 'A', 'a', '２０２３'), ('app', 'B', 'b', '２０２４ — 現在'), ('app', 'C', 'c', '令和6')",
      ),
    ])

    await run((name) => name >= '0013')

    const years = await d1()
      .prepare('SELECT year, year_from FROM items ORDER BY id')
      .all<{ year: string; year_from: number | null }>()
    expect(years.results).toEqual([
      { year: '2023', year_from: 2023 },
      { year: '2024 — 現在', year_from: 2024 },
      { year: '令和6', year_from: null },
    ])

    const owners = await d1().prepare('SELECT id, role, member_id FROM users').all()
    expect(owners.results).toEqual([{ id: 3, role: 'owner', member_id: 4 }])
    const linked = await d1().prepare('SELECT user_id FROM user_identities').all()
    expect(linked.results).toEqual([{ user_id: 3 }, { user_id: 3 }])
    const sessions = await d1().prepare('SELECT user_id FROM sessions ORDER BY id').all()
    expect(sessions.results).toEqual([{ user_id: 3 }, { user_id: 3 }])
    const claims = await d1()
      .prepare('SELECT provider, value, subject FROM owner_claims ORDER BY provider')
      .all()
    expect(claims.results).toEqual([
      { provider: 'github', value: '1001', subject: '1001' },
      { provider: 'google', value: 'owner@example.test', subject: 'g-sub' },
    ])

    // 移行の前に紐づいたアカウントも、外したら紐づき直らない
    await d1().prepare("DELETE FROM user_identities WHERE provider = 'github'").run()
    const migrated = drizzle(d1(), { schema })
    expect(
      await userForIdentity(
        migrated,
        { OWNER_GITHUB_ID: '1001' },
        { provider: 'github', subject: '1001', label: '@owner' },
      ),
    ).toBeNull()
  })

  it('0006 は表を作り直さない（D1 では PRAGMA foreign_keys=OFF が効かない）', () => {
    /*
      表を作り直す形（__new_users へ写して DROP TABLE users）だと、D1 では
      外部キーを止められず、DROP の時点で sessions が cascade で消え、
      members の参照も確かめ直される。列を落とすだけの ALTER で済んでいることを確かめる
    */
    const sql =
      env.TEST_MIGRATIONS.find((one) => one.name.includes('oauth_identities'))?.queries.join(
        '\n',
      ) ?? ''
    expect(sql).toContain('ALTER TABLE `users` DROP COLUMN `password_hash`')
    expect(sql).toContain('ALTER TABLE `users` DROP COLUMN `email`')
    expect(sql).not.toMatch(/__new_users|PRAGMA foreign_keys/)
  })
})
