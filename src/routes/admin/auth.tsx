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
  sessionCookie,
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
const STATE_COOKIE = 'astlog_oauth_state'
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

  入口は開くたびに D1 へ書く（state の1行と、応答のあとの期限切れの掃除）。ログイン
  していない GET なので、ボットが提供元に何も送らずに叩き続けられる。D1 の書き込みの
  枠（無料のプランは1日 10 万行）を使い切られると、管理画面の保存も持ち主のログインも
  UTC 0 時まで止まる。

  ここで数えるのは Workers の Rate Limiting（wrangler.toml の [[ratelimits]]。IP ごと
  ——IPv6 は /64 ごと（limitKey）——に 60 秒で 10 回）で、D1 に書く前に止める。
  止まるのは1つの送り元だけで、これだけでは枠を守り切れない——1つの IP でも1日に
  約 1.4 万回は通るので、IP を数個そろえれば枠に届く。WAF のレート制限のルールを
  足しても同じで、Enterprise 以外は IP ごと・データセンターごとにしか数えないので、
  1つの IP の速さを下げるだけ。IP の数によらず止められるのは、ボットを落とす WAF の
  カスタムルール（/admin/auth/ の下の start に Managed Challenge）か、手前に置く
  Cloudflare Access。どちらもコードの外の設定で、持ち主がダッシュボードで置かない限り
  無い（README「管理画面に入る」）。

  それでも IP ごとに数えるのは、持ち主を締め出す道を作らないため。全体の上限（有効な
  state の行数など）にすると、叩く側がその数を埋め続けるだけで、別の場所から入ろうと
  する持ち主まで 429 になる。IP ごとなら、止まるのは叩いている送り元だけ。

  IP（cf-connecting-ip）は Cloudflare が付けるもので、訪問者には書き換えられない。
  付いていない要求（テストの中）と、binding が無い環境は数えない。
*/
async function tooManyStarts(c: Context<AppEnv>): Promise<boolean> {
  const limiter = c.env.LOGIN_RATE_LIMIT
  const ip = c.req.header('cf-connecting-ip')
  if (!limiter || !ip) return false
  const { success } = await limiter.limit({ key: `login-start:${limitKey(ip)}` })
  return !success
}

/*
  回数を数える単位。IPv4 はアドレスそのもの、IPv6 は頭の 64 ビット（/64）。
  IPv6 は回線1本に /64 が丸ごと配られるのが普通で、アドレスごとに数えると、
  1台が下の 64 ビットを替えるだけで上限が無いのと同じになる。

  同じ /64 は書き方（0 の省略・::・大小）が違っても同じ鍵にする。IPv4 を写した
  形（::ffff:203.0.113.7）は IPv4 として数える。読めない値はそのままの字で数える
  （例外にすると、ログインの入口ごと落ちる）
*/
export function limitKey(ip: string): string {
  const address = ip.trim().toLowerCase()
  if (!address.includes(':')) return address
  const mapped = address.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/)?.[1]
  if (mapped) return mapped
  const halves = address.split('::')
  if (halves.length > 2) return address
  const groups = (part: string | undefined) => (part ? part.split(':') : [])
  const head = groups(halves[0])
  const tail = groups(halves[1])
  const gap = 8 - head.length - tail.length
  if (halves.length === 1 ? gap !== 0 : gap < 1) return address
  const full = [...head, ...Array<string>(halves.length === 2 ? gap : 0).fill('0'), ...tail]
  if (!full.every((group) => /^[0-9a-f]{1,4}$/.test(group))) return address
  const prefix = full.slice(0, 4).map((group) => Number.parseInt(group, 16).toString(16))
  return `${prefix.join(':')}::/64`
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
  await database.insert(schema.oauthStates).values({
    state,
    provider,
    codeVerifier: verifier,
    nonce,
    next: safeNext(c.req.query('next')),
    expiresAt: new Date(now + STATE_MINUTES * 60_000).toISOString(),
  })
  /*
    期限切れの札はここで掃除する（セッションと同じく、掃除だけの定期実行を持たない）。
    掃除は応答のあと（waitUntil）で、提供元へ送るのを待たせない。後ろへ回しても
    1回きりの約束は変わらない——札を使えるかは callback が自分で消して（DELETE …
    RETURNING）期限を見て決めるので、まだ掃除されていない期限切れの行も通らない。
    掃除が落ちても、次の start がまた消す
  */
  c.executionCtx.waitUntil(
    database
      .delete(schema.oauthStates)
      .where(lt(schema.oauthStates.expiresAt, new Date(now).toISOString()))
      .then(
        () => undefined,
        (error: unknown) => console.error('期限切れの state を掃除できませんでした', error),
      ),
  )

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
  const expiresAt = row ? new Date(row.expiresAt).getTime() : Number.NaN
  if (
    !row ||
    !cookieState ||
    !queryState ||
    !timingSafeEqual(cookieState, queryState) ||
    row.provider !== provider ||
    !Number.isFinite(expiresAt) ||
    expiresAt <= Date.now() ||
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
  const previous = getCookie(c, sessionCookie(c.req.url))
  if (previous) await destroySession(db(c), previous)
  await startSession(c, user.id)
  // 開こうとしていた画面へ戻す。セッションが切れて弾かれた人を、一覧の頭に放り出さない
  return c.redirect(safeNext(row.next) ?? '/admin', 303)
})

async function startSession(c: Context<AppEnv>, userId: number) {
  const session = await createSession(db(c), userId)
  setCookie(c, sessionCookie(c.req.url), session.token, {
    httpOnly: true,
    sameSite: 'Lax',
    secure: isHttps(c),
    path: '/',
    expires: session.expiresAt,
  })
}

authRoutes.post('/logout', async (c) => {
  const token = getCookie(c, sessionCookie(c.req.url))
  if (token) await destroySession(db(c), token)
  deleteCookie(c, sessionCookie(c.req.url), { path: '/', secure: isHttps(c) })
  return c.redirect('/admin/login', 303)
})

/*
  パスワードの頃の初期設定の入口。消したことを 404 で言い切る——壁に吸わせると
  ログイン画面へ送られ、まだどこかに在るように見える。最初の owner は、
  OWNER_GITHUB_ID / OWNER_GOOGLE_EMAIL と一致するアカウントの初回ログインで作られる
*/
authRoutes.all('/setup', (c) => c.notFound())
