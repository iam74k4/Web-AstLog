/*
  管理画面のログインの相手（GitHub と Google）との約束ごと。

  ここは提供元に何を送り、返ってきたものをどう読むかだけを持つ。D1 も
  クッキーも触らない——state を1回きりにする・誰を通すかを決めるのは
  src/routes/admin/auth.tsx（/admin/auth/*）と src/lib/auth.ts の仕事。

  どちらも認可コードフロー＋PKCE（S256）。GitHub の OAuth App も PKCE に
  対応している（公式ドキュメント「Authorizing OAuth apps」の code_challenge /
  code_verifier。plain は受け付けず S256 だけ）。

  取得したアクセストークンは、本人の ID を引いたらその場で捨てる。保存しない・
  ログに出さない・例外の文言にも入れない（ProviderError の文言は提供元の
  error の種類と HTTP の番号だけ）。
*/

export const PROVIDER_KEYS = ['github', 'google'] as const
export type ProviderKey = (typeof PROVIDER_KEYS)[number]

export const isProviderKey = (value: string): value is ProviderKey =>
  (PROVIDER_KEYS as readonly string[]).includes(value)

export const PROVIDER_LABEL: Record<ProviderKey, string> = { github: 'GitHub', google: 'Google' }

// 外への fetch はどれもこれで打ち切る。提供元が固まっても Worker を道連れにしない
const TIMEOUT_MS = 10_000

export type ClientEnv = {
  GITHUB_CLIENT_ID?: string
  GITHUB_CLIENT_SECRET?: string
  GOOGLE_CLIENT_ID?: string
  GOOGLE_CLIENT_SECRET?: string
  OAUTH_REDIRECT_ORIGIN?: string
}

export type Client = { id: string; secret: string }

/*
  提供元に渡すコールバック（redirect_uri）。提供元に登録したものと1字でも違うと断られる。

  ふだんはリクエストの origin（本番は https://noctifex.dev）。wrangler dev だけは
  OAUTH_REDIRECT_ORIGIN（.dev.vars）で渡す——wrangler.toml に routes があると、
  wrangler dev は Worker に見せる URL を http://noctifex.dev/… に書き換える
  （ブラウザは http://localhost:8787 に居るのに）。書き換わった origin を渡すと、
  開発用に登録したコールバックと食い違う。

  リクエストのヘッダー（dev の MF-Original-Hostname など）からは組まない。
  本番にも誰でも付けて送れる値で、提供元へ渡す宛先を外から選ばせることになる。
*/
export function callbackUrl(env: ClientEnv, requestUrl: string, provider: ProviderKey): string {
  let origin = new URL(requestUrl).origin
  if (env.OAUTH_REDIRECT_ORIGIN) {
    try {
      origin = new URL(env.OAUTH_REDIRECT_ORIGIN).origin
    } catch {
      // 読めない値なら使わない。リクエストの origin のまま
    }
  }
  return `${origin}/admin/auth/${provider}/callback`
}

// ID とシークレットの両方がそろっている提供元だけを使う。片方だけでは往復できない
export function clientFor(env: ClientEnv, provider: ProviderKey): Client | null {
  const id = provider === 'github' ? env.GITHUB_CLIENT_ID : env.GOOGLE_CLIENT_ID
  const secret = provider === 'github' ? env.GITHUB_CLIENT_SECRET : env.GOOGLE_CLIENT_SECRET
  return id && secret ? { id, secret } : null
}

/*
  提供元から見た「この人」。subject が照合の鍵で、label は画面に出す写し。
  email は Google のときだけ入り、emailVerified が true のときだけ最初の
  紐づけに使ってよい（src/lib/auth.ts の isOwnerIdentity）。
*/
export type Identity = {
  provider: ProviderKey
  subject: string
  label: string
  email?: string
  emailVerified?: boolean
}

// 提供元との通信か応答の形がおかしい。訪問者には 502 で出す
export class ProviderError extends Error {
  constructor(
    readonly provider: ProviderKey,
    reason: string,
  ) {
    super(`${PROVIDER_LABEL[provider]}: ${reason}`)
  }
}

// 応答は届いたが、id_token の中身がこの往復のものではない（aud・iss・nonce・exp）
export class IdTokenError extends Error {}

export function base64url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64url(value: string): string {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4))
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

// RFC 7636。verifier は 32 バイトの乱数を base64url にした 43 字
export async function pkcePair(): Promise<{ verifier: string; challenge: string }> {
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)))
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  return { verifier, challenge: base64url(new Uint8Array(digest)) }
}

export function authorizeUrl(
  provider: ProviderKey,
  args: { clientId: string; redirectUri: string; state: string; challenge: string; nonce: string },
): string {
  const common = {
    client_id: args.clientId,
    redirect_uri: args.redirectUri,
    state: args.state,
    code_challenge: args.challenge,
    code_challenge_method: 'S256',
  }
  if (provider === 'github') {
    /*
      scope は付けない＝公開プロフィールだけ。見るのは数値の id だけで、
      メールアドレスもリポジトリも要らない。allow_signup=false は、ここから
      GitHub のアカウントを作らせないため（作っても入れない）
    */
    const query = new URLSearchParams({ ...common, allow_signup: 'false' })
    return `https://github.com/login/oauth/authorize?${query}`
  }
  const query = new URLSearchParams({
    ...common,
    response_type: 'code',
    scope: 'openid email',
    nonce: args.nonce,
    // ブラウザが複数の Google アカウントを持っているとき、黙って1つを選ばせない
    prompt: 'select_account',
  })
  return `https://accounts.google.com/o/oauth2/v2/auth?${query}`
}

async function send(provider: ProviderKey, url: string, init: RequestInit): Promise<unknown> {
  let response: Response
  try {
    response = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) })
  } catch (error) {
    const name = error instanceof Error ? error.name : 'Error'
    throw new ProviderError(provider, `通信できません（${name}）`)
  }
  let body: unknown
  try {
    body = await response.json()
  } catch {
    throw new ProviderError(provider, `応答が JSON ではありません（HTTP ${response.status}）`)
  }
  if (!response.ok) {
    throw new ProviderError(provider, `HTTP ${response.status}（${errorCode(body)}）`)
  }
  return body
}

// 提供元の error は種類の名前だけを拾う。説明文やトークンを文言に混ぜない
const errorCode = (body: unknown): string => {
  const code = (body as { error?: unknown } | null)?.error
  return typeof code === 'string' && /^[\w.-]{1,64}$/.test(code) ? code : 'error'
}

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' ? (value as Record<string, unknown>) : {}

/*
  code をトークンに換え、本人の ID を引く。ここを抜けたら、トークンはどこにも
  残らない（変数ごと捨てる）。
*/
export async function identify(
  provider: ProviderKey,
  args: { client: Client; code: string; redirectUri: string; verifier: string; nonce: string },
): Promise<Identity> {
  return provider === 'github' ? identifyGithub(args) : identifyGoogle(args)
}

async function identifyGithub(args: {
  client: Client
  code: string
  redirectUri: string
  verifier: string
}): Promise<Identity> {
  const token = record(
    await send('github', 'https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/x-www-form-urlencoded',
        'user-agent': 'AstLog',
      },
      body: new URLSearchParams({
        client_id: args.client.id,
        client_secret: args.client.secret,
        code: args.code,
        redirect_uri: args.redirectUri,
        code_verifier: args.verifier,
      }),
    }),
  )
  // GitHub は code が違っても 200 で { error: 'bad_verification_code' } を返す
  if (typeof token.access_token !== 'string' || !token.access_token) {
    throw new ProviderError('github', `トークンを受け取れません（${errorCode(token)}）`)
  }

  const user = record(
    await send('github', 'https://api.github.com/user', {
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${token.access_token}`,
        // GitHub の API は User-Agent の無い要求を 403 で断る
        'user-agent': 'AstLog',
        'x-github-api-version': '2022-11-28',
      },
    }),
  )
  // 本人の確認は数値の id だけ。login（ユーザー名）は本人が変えられる
  if (typeof user.id !== 'number' || !Number.isSafeInteger(user.id) || user.id <= 0) {
    throw new ProviderError('github', 'ユーザーの id がありません')
  }
  const login = typeof user.login === 'string' ? user.login : ''
  return {
    provider: 'github',
    subject: String(user.id),
    label: login ? `@${login}` : `id ${user.id}`,
  }
}

const GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com']

async function identifyGoogle(args: {
  client: Client
  code: string
  redirectUri: string
  verifier: string
  nonce: string
}): Promise<Identity> {
  const token = record(
    await send('google', 'https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: args.client.id,
        client_secret: args.client.secret,
        code: args.code,
        redirect_uri: args.redirectUri,
        code_verifier: args.verifier,
      }),
    }),
  )
  if (typeof token.id_token !== 'string') {
    throw new ProviderError('google', 'id_token がありません')
  }
  const claims = readIdToken(token.id_token, { clientId: args.client.id, nonce: args.nonce })
  const email = typeof claims.email === 'string' ? claims.email : undefined
  return {
    provider: 'google',
    subject: claims.sub,
    label: email ?? `sub ${claims.sub}`,
    email,
    // OIDC では真偽値。古い応答に文字列の "true" があったので、それも同じ意味に読む
    emailVerified: claims.email_verified === true || claims.email_verified === 'true',
  }
}

/*
  id_token の中身を確かめる（OIDC Core 3.1.3.7）。

  署名は確かめない。この id_token はブラウザを経由せず、トークンエンドポイント
  （https://oauth2.googleapis.com/token）から TLS で直接受け取ったもので、
  3.1.3.7 の 6 は、その場合は TLS のサーバー検証を署名の検証の代わりにしてよい
  と定めている。JWKS を取りに行く往復と鍵の持ち回りを増やさずに済む。

  代わりに、この往復のものであることは必ず確かめる。
    iss   Google が出したもの（2つの書き方のどちらか）
    aud   このクライアント ID に宛てたもの（配列なら含み、azp もこちら）
    exp   期限が切れていない
    nonce start で作って D1 に置いた値と同じ（同じ id_token の使い回しを止める）
    sub   照合の鍵。無ければ誰だか分からない
*/
export function readIdToken(
  idToken: string,
  expect: { clientId: string; nonce: string },
  now: Date = new Date(),
): Record<string, unknown> & { sub: string } {
  const payload = idToken.split('.')[1]
  if (!payload || idToken.split('.').length !== 3) throw new IdTokenError('形が違う')
  let claims: Record<string, unknown>
  try {
    claims = record(JSON.parse(fromBase64url(payload)))
  } catch {
    throw new IdTokenError('中身を読めない')
  }

  if (typeof claims.iss !== 'string' || !GOOGLE_ISSUERS.includes(claims.iss)) {
    throw new IdTokenError('iss が違う')
  }
  const aud = claims.aud
  const audiences = Array.isArray(aud) ? aud : [aud]
  if (!audiences.includes(expect.clientId)) throw new IdTokenError('aud が違う')
  if (audiences.length > 1 && claims.azp !== expect.clientId) throw new IdTokenError('azp が違う')
  if (typeof claims.exp !== 'number' || claims.exp * 1000 <= now.getTime()) {
    throw new IdTokenError('期限切れ')
  }
  if (typeof claims.nonce !== 'string' || claims.nonce !== expect.nonce) {
    throw new IdTokenError('nonce が違う')
  }
  if (typeof claims.sub !== 'string' || !claims.sub) throw new IdTokenError('sub が無い')
  return claims as Record<string, unknown> & { sub: string }
}
