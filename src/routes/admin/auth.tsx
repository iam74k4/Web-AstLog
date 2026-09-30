import { inArray, lt } from 'drizzle-orm'
import type { Context } from 'hono'
import { Hono } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import type { Child } from 'hono/jsx'
import * as schema from '../../db/schema'
import type { AppEnv } from '../../env'
import {
  createSession,
  destroySession,
  newToken,
  SESSION_COOKIE,
  timingSafeEqual,
  userForIdentity,
} from '../../lib/auth'
import {
  authorizeUrl,
  callbackUrl,
  clientFor,
  type Identity,
  IdTokenError,
  identify,
  isProviderKey,
  PROVIDER_KEYS,
  PROVIDER_LABEL,
  ProviderError,
  type ProviderKey,
  pkcePair,
} from '../../lib/oauth'
import { SITE } from '../../site'
import { AdminBare } from '../../ui/AdminLayout'
import { Wordmark } from '../../ui/icons'
import { db } from './request'
import { isHttps, safeNext } from './session'

export const authRoutes = new Hono<AppEnv>()

/*
  ログインは GitHub / Google の OAuth だけ（パスワードは持たない）。

  入口の2つはフォームではなく GET のリンク。フォームの POST から提供元へ
  リダイレクトさせると、あとで CSP の form-action 'self' を入れた日に、
  外へのリダイレクトごと止まる。

  往復は /admin/auth/:provider/start → 提供元 → /admin/auth/:provider/callback。
  どちらも認証の壁の外で、sameOrigin の内側（ただし GET なので Origin は見ない。
  CSRF はクッキーと D1 の state が一致することで止める）。
*/

// state を入れるクッキー。往復の2本（start と callback）にだけ送られればよい
const STATE_COOKIE = 'nx_oauth_state'
const STATE_PATH = '/admin/auth'
const STATE_MINUTES = 10

// 提供元に登録するコールバック。本番と開発で origin だけが違う（src/lib/oauth.ts の callbackUrl）
const redirectUri = (c: Context<AppEnv>, provider: ProviderKey) =>
  callbackUrl(c.env, c.req.url, provider)

// ログイン画面の知らせ。query から受けるのは決まった札だけで、文言はここで持つ
function loginError(code: string | undefined): string | undefined {
  switch (code) {
    case 'denied':
      return 'ログインを取りやめました。'
    case 'expired':
      return 'ログインの手続きが切れたか、別のタブで始めたものです。もう一度お試しください。'
    case 'provider':
      return 'ログインを受け付けられませんでした。もう一度お試しください。'
    default:
      return undefined
  }
}

const backToLogin = (error: string, next?: string | null) => {
  const query = new URLSearchParams({ error })
  const safe = safeNext(next)
  if (safe) query.set('next', safe)
  return `/admin/login?${query}`
}

const LoginBrand = () => (
  <span class="login__brand">
    <Wordmark class="brand__word" />
    <span class="sr-only">{SITE.name}</span>
    <span class="login__label">ADMIN</span>
  </span>
)

const LoginPage = (props: {
  providers: ProviderKey[]
  next?: string
  error?: string
  note?: string
}) => (
  <AdminBare title="ログイン">
    <div class="login">
      <LoginBrand />
      {/* 見出しで移動する人のために。目に見える名乗りはロゴの箱が持っている */}
      <h1 class="sr-only">ログイン</h1>
      {props.note ? <p class="flash">{props.note}</p> : null}
      {props.error ? <p class="banner banner--error">{props.error}</p> : null}
      {props.providers.length === 0 ? (
        <p class="banner banner--error">
          ログインの設定がまだありません（README の「管理画面に入る」）。
        </p>
      ) : null}
      {props.providers.map((provider) => (
        <a
          key={provider}
          class="btn btn--ghost btn--block"
          href={`/admin/auth/${provider}/start${props.next ? `?next=${encodeURIComponent(props.next)}` : ''}`}
        >
          {PROVIDER_LABEL[provider]} でログイン
        </a>
      ))}
      <span class="login__note">AstLog メンバーのみアクセスできます</span>
    </div>
  </AdminBare>
)

// 往復の途中で止まったときの画面。ログイン画面と同じ箱に、理由と戻り道だけを置く
const AuthProblem = (props: { title: string; detail: string; children?: Child }) => (
  <AdminBare title={props.title}>
    <div class="login">
      <LoginBrand />
      <h1 class="banner banner--error">{props.title}</h1>
      <p class="login__note">{props.detail}</p>
      {props.children}
      <a class="btn btn--ghost btn--block" href="/admin/login">
        ログイン画面へ戻る
      </a>
    </div>
  </AdminBare>
)

const notConfigured = (c: Context<AppEnv>, provider: ProviderKey) =>
  c.html(
    <AuthProblem
      title={`${PROVIDER_LABEL[provider]} でのログインはまだ使えません`}
      detail="クライアント ID とシークレットが設定されていません（README の「管理画面に入る」）。"
    />,
    503,
  )

const configuredProviders = (env: AppEnv['Bindings']) =>
  PROVIDER_KEYS.filter((provider) => clientFor(env, provider))

authRoutes.get('/login', (c) =>
  c.html(
    <LoginPage
      providers={configuredProviders(c.env)}
      next={safeNext(c.req.query('next')) ?? undefined}
      error={loginError(c.req.query('error'))}
      note={c.req.query('out') === 'all' ? 'すべての端末からログアウトしました。' : undefined}
    />,
  ),
)

/*
  ログインの入口の回数の上限。

  入口は開くたびに D1 へ書く（期限切れの掃除と state の1行）。ログインしていない
  GET なので、上限が無いとボットが提供元に何も送らずに叩き続けられ、D1 の書き込みの
  枠（無料のプランは1日 10 万行）を使い切られる——そうなると管理画面の保存も
  持ち主のログインも UTC 0 時まで止まる。

  数えるのは Workers の Rate Limiting（wrangler.toml の [[ratelimits]]。IP ごとに
  60 秒で 10 回）で、D1 に書く前に止める。IP ごとにしたのは、持ち主を締め出す道を
  作らないため。全体の上限（有効な state の行数など）にすると、叩く側がその数を
  埋め続けるだけで、別の場所から入ろうとする持ち主まで 429 になる。IP ごとなら、
  止まるのは叩いている IP だけ。多くの IP から叩かれる場合は Cloudflare の WAF の
  レート制限（/admin/auth/ の下の start）で外から止める（CLAUDE.md「ログイン」）。

  IP（cf-connecting-ip）は Cloudflare が付けるもので、訪問者には書き換えられない。
  付いていない要求（テストの中）と、binding が無い環境は数えない。
*/
async function tooManyStarts(c: Context<AppEnv>): Promise<boolean> {
  const limiter = c.env.LOGIN_RATE_LIMIT
  const ip = c.req.header('cf-connecting-ip')
  if (!limiter || !ip) return false
  const { success } = await limiter.limit({ key: `login-start:${ip}` })
  return !success
}

authRoutes.get('/auth/:provider/start', async (c) => {
  const provider = c.req.param('provider')
  if (!isProviderKey(provider)) return c.notFound()
  const client = clientFor(c.env, provider)
  if (!client) return notConfigured(c, provider)
  if (await tooManyStarts(c)) {
    c.header('retry-after', '60')
    return c.html(
      <AuthProblem
        title="ログインの試行が多すぎます"
        detail="1分ほど待ってから、もう一度お試しください。"
      />,
      429,
    )
  }

  const state = newToken()
  const nonce = newToken()
  const { verifier, challenge } = await pkcePair()
  const now = Date.now()
  const database = db(c)
  // 期限切れの札はここで掃除する。セッションと同じく、掃除だけの定期実行を持たない
  await database.batch([
    database
      .delete(schema.oauthStates)
      .where(lt(schema.oauthStates.expiresAt, new Date(now).toISOString())),
    database.insert(schema.oauthStates).values({
      state,
      provider,
      codeVerifier: verifier,
      nonce,
      next: safeNext(c.req.query('next')),
      expiresAt: new Date(now + STATE_MINUTES * 60_000).toISOString(),
    }),
  ])

  /*
    SameSite=Lax でなければならない。提供元からのコールバックは別のサイトからの
    トップレベルの GET で、Strict のクッキーはそこで送られない（state が毎回
    食い違う）。None にする理由も無い
  */
  setCookie(c, STATE_COOKIE, state, {
    httpOnly: true,
    secure: isHttps(c),
    sameSite: 'Lax',
    path: STATE_PATH,
    maxAge: STATE_MINUTES * 60,
  })
  c.header('cache-control', 'no-store')
  return c.redirect(
    authorizeUrl(provider, {
      clientId: client.id,
      redirectUri: redirectUri(c, provider),
      state,
      challenge,
      nonce,
    }),
    302,
  )
})

authRoutes.get('/auth/:provider/callback', async (c) => {
  const provider = c.req.param('provider')
  if (!isProviderKey(provider)) return c.notFound()
  c.header('cache-control', 'no-store')

  const cookieState = getCookie(c, STATE_COOKIE)
  const queryState = c.req.query('state')
  deleteCookie(c, STATE_COOKIE, { path: STATE_PATH, secure: isHttps(c) })

  /*
    出した札は、この先どう転んでも使い切る。クッキーの側と query の側の両方を
    消すので、食い違って弾いた場合も、同じ state がもう一度通ることは無い
  */
  const presented = [...new Set([cookieState, queryState])].filter((value): value is string =>
    Boolean(value),
  )
  const burned =
    presented.length > 0
      ? await db(c)
          .delete(schema.oauthStates)
          .where(inArray(schema.oauthStates.state, presented))
          .returning()
      : []
  const row = burned.find((one) => one.state === cookieState)

  // 提供元の画面で断った（access_denied）・提供元が断った。state の検査より先に帰す
  const refused = c.req.query('error')
  if (refused) {
    return c.redirect(
      backToLogin(refused === 'access_denied' ? 'denied' : 'provider', row?.next),
      303,
    )
  }

  const code = c.req.query('code')
  if (
    !row ||
    !cookieState ||
    !queryState ||
    !timingSafeEqual(cookieState, queryState) ||
    row.provider !== provider ||
    new Date(row.expiresAt).getTime() <= Date.now() ||
    !code
  ) {
    return c.redirect(backToLogin('expired', row?.next), 303)
  }

  const client = clientFor(c.env, provider)
  if (!client) return notConfigured(c, provider)

  let identity: Identity
  try {
    identity = await identify(provider, {
      client,
      code,
      redirectUri: redirectUri(c, provider),
      verifier: row.codeVerifier,
      nonce: row.nonce,
    })
  } catch (error) {
    // 文言は提供元の名前と error の種類だけ（src/lib/oauth.ts）。トークンは入っていない
    if (error instanceof ProviderError) {
      console.error(error.message)
      return c.html(
        <AuthProblem
          title={`${PROVIDER_LABEL[provider]} との通信に失敗しました`}
          detail="時間をおいてもう一度お試しください。"
        />,
        502,
      )
    }
    if (error instanceof IdTokenError) {
      console.error(`Google の id_token を受け付けません: ${error.message}`)
      return c.html(
        <AuthProblem
          title="ログインを確かめられませんでした"
          detail="最初からもう一度お試しください。"
        />,
        400,
      )
    }
    throw error
  }

  const user = await userForIdentity(db(c), c.env, identity)
  if (!user) {
    return c.html(
      <AuthProblem
        title="このアカウントでは入れません"
        detail={`${PROVIDER_LABEL[provider]} の ${identity.label}（ID ${identity.subject}）は、この管理画面に紐づいていません。`}
      >
        {/* 持ち主が設定を間違えたときの助け。出すのはその人自身の ID だけ */}
        <p class="login__note">
          {provider === 'github'
            ? '持ち主のアカウントなら、wrangler.toml の OWNER_GITHUB_ID をこの ID にしてください。'
            : identity.emailVerified
              ? '持ち主のアカウントなら、wrangler.toml の OWNER_GOOGLE_EMAIL をこのアドレスにしてください。'
              : 'このアドレスは Google で確認されていないため、紐づけられません。'}
        </p>
      </AuthProblem>,
      403,
    )
  }

  // 前のセッションが残っていれば捨ててから発行し直す（ログインの前後で同じ ID を使わない）
  const previous = getCookie(c, SESSION_COOKIE)
  if (previous) await destroySession(db(c), previous)
  await startSession(c, user.id)
  // 開こうとしていた画面へ戻す。セッションが切れて弾かれた人を、一覧の頭に放り出さない
  return c.redirect(safeNext(row.next) ?? '/admin', 303)
})

async function startSession(c: Context<AppEnv>, userId: number) {
  const session = await createSession(db(c), userId)
  setCookie(c, SESSION_COOKIE, session.token, {
    httpOnly: true,
    sameSite: 'Lax',
    secure: isHttps(c),
    path: '/',
    expires: session.expiresAt,
  })
}

authRoutes.post('/logout', async (c) => {
  const token = getCookie(c, SESSION_COOKIE)
  if (token) await destroySession(db(c), token)
  deleteCookie(c, SESSION_COOKIE, { path: '/', secure: isHttps(c) })
  return c.redirect('/admin/login', 303)
})

/*
  パスワードの頃の初期設定の入口。消したことを 404 で言い切る——壁に吸わせると
  ログイン画面へ送られ、まだどこかに在るように見える。最初の owner は、
  OWNER_GITHUB_ID / OWNER_GOOGLE_EMAIL と一致するアカウントの初回ログインで作られる
*/
authRoutes.all('/setup', (c) => c.notFound())
