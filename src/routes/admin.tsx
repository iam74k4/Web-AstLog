import { and, asc, count, eq, inArray, lt, ne } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import type { Context } from 'hono'
import { Hono } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import { createMiddleware } from 'hono/factory'
import type { Child } from 'hono/jsx'
import {
  BLOCK_TYPES,
  type BlockType,
  blockLines,
  blockPerScreen,
  blockTexts,
  blockType,
  blockUnitCount,
  blockVisibleParts,
  DEFAULT_BLOCKS,
  isBlockKey,
  MAX_CHARS,
  memberScreenCount,
} from '../blocks'
import {
  countPublishedItems,
  defaultBlocks,
  ensureBlocks,
  listBlocks,
  listPublishedMembers,
  loadTheme,
  reorderBlocks,
  saveTheme,
} from '../db/queries'
import * as schema from '../db/schema'
import type { AppEnv } from '../env'
import {
  accountLabel,
  createSession,
  destroySession,
  destroyUserSessions,
  getSessionUser,
  newToken,
  SESSION_COOKIE,
  timingSafeEqual,
  userForIdentity,
} from '../lib/auth'
import {
  bool,
  isSafeUrl,
  num,
  paragraphs,
  parseLines,
  parseTags,
  str,
  timeInJapan,
  toSlug,
} from '../lib/format'
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
} from '../lib/oauth'
import { chunk, screenCount } from '../lib/paginate'
import {
  isThemeValue,
  normalizeTheme,
  type PresetOption,
  THEME_CHOICES,
  THEME_GROUPS,
  THEME_KEYS,
  type Theme,
  type ThemeKey,
} from '../theme'
import { AdminBare, AdminLayout } from '../ui/AdminLayout'
import { Avatar, itemHref, KIND_LABEL, Shot, StatusPill } from '../ui/components'
import { ExternalIcon, MarkIcon, PencilIcon, TrashIcon } from '../ui/icons'

export const adminRoutes = new Hono<AppEnv>()

const db = (c: { env: { DB: D1Database } }) => drizzle(c.env.DB, { schema })

/*
  SameSite=Lax だけに頼らず、書き込みは送り元も見る。
  ログアウトも「書き込み」なので、認証の壁より外側で掛ける（内側だけに置くと、
  壁の手前にあるものを素通りする）。/admin/auth/* は GET だけなのでここには
  掛からない——あちらの CSRF は、クッキーと D1 の state が一致することで止める。

  見る順は Origin → Sec-Fetch-Site → Referer。比べるのは scheme・host・port の
  組（origin）ごと。host だけだと http と https を取り違える。

  - Origin: null は拒む（403）。Referrer-Policy: no-referrer のページや
    サンドボックスの iframe から来ると null になり、どこから来たか分からない。
    以前は new URL('null') が例外を投げて 500 になっていた
  - 3つとも無いときは通す。今のブラウザは POST に Origin も Sec-Fetch-Site も
    付けるので、どちらも無いのはブラウザ以外（curl など）で、それはそもそも
    ほかの人のクッキーを持てない。しかも管理画面の POST はどれもセッションの
    クッキーが要り、そのクッキーは SameSite=Lax で、別のサイトからの POST には
    付かない。パスワードのログイン（クッキー無しで受ける POST）はもう無いので、
    「クッキー無しでも効く CSRF」の入口も残っていない
*/
function writeIsSameOrigin(request: Request): boolean {
  const own = new URL(request.url).origin
  const origin = request.headers.get('origin')
  if (origin !== null) return origin !== 'null' && origin === own

  const site = request.headers.get('sec-fetch-site')
  if (site !== null) return site === 'same-origin' || site === 'none'

  const referer = request.headers.get('referer')
  if (referer !== null) {
    try {
      return new URL(referer).origin === own
    } catch {
      return false
    }
  }
  return true
}

const sameOrigin = createMiddleware<AppEnv>(async (c, next) => {
  if (c.req.method !== 'GET' && c.req.method !== 'HEAD' && !writeIsSameOrigin(c.req.raw)) {
    return c.text('別のサイトからの送信は受け付けません', 403)
  }
  await next()
})

adminRoutes.use('*', sameOrigin)

// URL の :id は数字とは限らない。数字でなければ 404 にする
function parseId(value: string | undefined): number | null {
  const id = Number(value)
  return Number.isInteger(id) && id > 0 ? id : null
}

/*
  ログイン後の戻り先。管理画面の中の経路だけを通す。
  外の URL や //host を通すと、ログイン画面が他サイトへの踏み台になる。
  ログインの往復そのもの（/admin/login・/admin/auth/…）とログアウトも
  戻り先にしない——戻った先でまたログインが始まる・すぐ抜ける、の輪になる
*/
function safeNext(value: string | null | undefined): string | null {
  if (!value || !/^\/admin(\/[\w\-./?=&%]*)?$/.test(value)) return null
  if (value.includes('..') || value.includes('//')) return null
  if (/^\/admin\/(login|logout|auth)/.test(value)) return null
  return value
}

// 保存の知らせ。下書きで保存したときは、サイトにまだ出ていないことまで言う
const savedParam = (published: number) => (published ? '1' : 'draft')

function flashFor(c: Context<AppEnv>, deleted = '削除しました'): string | null {
  const saved = c.req.query('saved')
  if (saved === 'draft') return '下書きで保存しました。サイトにはまだ出ていません'
  if (saved) return '保存しました'
  return c.req.query('deleted') ? deleted : null
}

// 削除の確認から「キャンセル」したときの戻り先。編集画面から来たなら編集画面へ
const cameFromEdit = (c: Context<AppEnv>) => c.req.query('from') === 'edit'

/* ------------------------------------------------------------------ 部品 */

const Field = (props: {
  label: string
  name: string
  value?: string | number | null
  type?: string
  hint?: string
  error?: string
  required?: boolean
  placeholder?: string
}) => (
  <label class="field">
    <span class="field__label">{props.label}</span>
    <input
      class={props.error ? 'input input--error' : 'input'}
      type={props.type ?? 'text'}
      name={props.name}
      value={props.value ?? ''}
      required={props.required}
      placeholder={props.placeholder}
    />
    {props.error ? <span class="field__error">{props.error}</span> : null}
    {props.hint ? <span class="field__hint">{props.hint}</span> : null}
  </label>
)

const Area = (props: {
  label: string
  name: string
  value?: string | null
  hint?: string
  rows?: number
  error?: string
  /*
    上限がある欄には付ける。ブラウザ側で止まるので、長い文を打ったあとに
    保存で弾かれて直す、という往復が減る。数える単位はサーバー側（コード
    ポイント）と少し違い、絵文字は2字と数えられる——止めるのが少しだけ
    早くなるぶんには困らないので、そろえずにそのまま使う。
    保存してよいかを決めるのは、いつもサーバー側の検査のほう
  */
  maxlength?: number
}) => (
  <label class="field field--wide">
    <span class="field__label">{props.label}</span>
    <textarea
      class={props.error ? 'input input--area input--error' : 'input input--area'}
      name={props.name}
      rows={props.rows ?? 4}
      maxlength={props.maxlength}
    >
      {props.value ?? ''}
    </textarea>
    {props.error ? <span class="field__error">{props.error}</span> : null}
    {props.hint ? <span class="field__hint">{props.hint}</span> : null}
  </label>
)

const Select = (props: {
  label: string
  name: string
  value?: string | number | null
  options: { value: string; label: string }[]
  hint?: string
}) => (
  <label class="field">
    <span class="field__label">{props.label}</span>
    <select class="input" name={props.name}>
      {props.options.map((option) => (
        <option
          key={option.value}
          value={option.value}
          selected={String(props.value ?? '') === option.value}
        >
          {option.label}
        </option>
      ))}
    </select>
    {props.hint ? <span class="field__hint">{props.hint}</span> : null}
  </label>
)

const PublishToggle = ({ published }: { published: number }) => (
  <label class="toggle">
    <input type="checkbox" name="published" value="1" checked={published === 1} />
    <span class="toggle__track" aria-hidden="true">
      <span class="toggle__knob" />
    </span>
    <span class="toggle__text">
      公開する<span class="toggle__hint">外すと下書き。サイトには出ない</span>
    </span>
  </label>
)

const FormActions = ({
  cancelHref,
  deleteHref,
  deleteLabel = 'この項目を削除…',
}: {
  cancelHref: string
  deleteHref?: string
  deleteLabel?: string
}) => (
  <div class="form-actions">
    {deleteHref ? (
      <a class="btn btn--link btn--danger" href={deleteHref}>
        {deleteLabel}
      </a>
    ) : (
      <span />
    )}
    <div class="form-actions__right">
      <a class="btn btn--ghost" href={cancelHref}>
        キャンセル
      </a>
      <button class="btn btn--primary" type="submit">
        保存
      </button>
    </div>
  </div>
)

const Confirm = (props: {
  title: string
  detail: string
  action: string
  cancelHref: string
  // ボタンの文言。既定は「削除する」。構成から外すときは「外す」
  verb?: string
  children?: Child
}) => (
  <div class="confirm">
    <h1>{props.title}</h1>
    <p>{props.detail}</p>
    {props.children}
    <form method="post" action={props.action} class="confirm__actions">
      <a class="btn btn--ghost" href={props.cancelHref}>
        キャンセル
      </a>
      <button class="btn btn--danger" type="submit">
        {props.verb ?? '削除する'}
      </button>
    </form>
  </div>
)

/* ------------------------------------------------------------- ログイン */

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

/*
  クッキーの Secure は https のときだけ。本番（noctifex.dev）は常に https なので
  必ず付く。http://localhost の開発では、Secure のクッキーを捨てるブラウザが
  あり（Safari）、付けるとログインの往復そのものが通らなくなる
*/
const isHttps = (c: Context<AppEnv>) => new URL(c.req.url).protocol === 'https:'

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
    <MarkIcon size={30} />
    <span class="login__word">NOCTIFEX</span>
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
      <span class="login__note">Noctifex メンバーのみアクセスできます</span>
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

adminRoutes.get('/login', (c) =>
  c.html(
    <LoginPage
      providers={configuredProviders(c.env)}
      next={safeNext(c.req.query('next')) ?? undefined}
      error={loginError(c.req.query('error'))}
      note={c.req.query('out') === 'all' ? 'すべての端末からログアウトしました。' : undefined}
    />,
  ),
)

adminRoutes.get('/auth/:provider/start', async (c) => {
  const provider = c.req.param('provider')
  if (!isProviderKey(provider)) return c.notFound()
  const client = clientFor(c.env, provider)
  if (!client) return notConfigured(c, provider)

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

adminRoutes.get('/auth/:provider/callback', async (c) => {
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

adminRoutes.post('/logout', async (c) => {
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
adminRoutes.all('/setup', (c) => c.notFound())

/* --------------------------------------------------------------- 認証の壁 */

const requireAuth = createMiddleware<AppEnv>(async (c, next) => {
  const token = getCookie(c, SESSION_COOKIE)
  const user = token ? await getSessionUser(db(c), token) : null
  if (!user) {
    // GET なら行き先を持ち回す（POST の宛先は開き直せないので持たない）
    const url = new URL(c.req.url)
    const next = c.req.method === 'GET' ? safeNext(url.pathname + url.search) : null
    return c.redirect(next ? `/admin/login?next=${encodeURIComponent(next)}` : '/admin/login', 303)
  }
  c.set('user', user)
  c.set('account', (await accountLabel(db(c), user.id)) ?? 'アカウント')
  await next()
})

const app = new Hono<AppEnv>()
app.use('*', requireAuth)

app.get('/', (c) => c.redirect('/admin/members', 303))

/* ------------------------------------------------------------- Members */

app.get('/members', async (c) => {
  const members = await db(c).query.members.findMany({
    orderBy: [asc(schema.members.sortOrder), asc(schema.members.id)],
  })

  return c.html(
    <AdminLayout title="Members" active="members" account={c.get('account')} flash={flashFor(c)}>
      <div class="admin-head">
        <h1>Members</h1>
        <a class="btn btn--primary" href="/admin/members/new">
          ＋ Add member
        </a>
      </div>

      {members.length === 0 ? (
        <div class="empty-state">
          <p>まだメンバーがいません</p>
          <a class="btn btn--primary" href="/admin/members/new">
            ＋ 最初のメンバーを追加
          </a>
        </div>
      ) : (
        <ul class="rows">
          {members.map((member) => (
            <li class="row" key={member.id}>
              <Avatar src={member.avatarUrl} name={member.name} size={36} />
              <span class="row__main">
                <strong>{member.name}</strong>
                <span class="row__sub">/members/{member.slug}</span>
              </span>
              <span class="row__col">{member.role}</span>
              <span class="row__col row__col--num">{member.sortOrder}</span>
              <StatusPill published={member.published} />
              <span class="row__actions">
                {/* 下書きの人のページは 404 なので、公開中のときだけ出す */}
                {member.published ? (
                  <a
                    class="icon-btn"
                    href={`/members/${member.slug}`}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={`${member.name} のページをサイトで見る`}
                  >
                    <ExternalIcon />
                    <span class="icon-btn__text">サイトで見る</span>
                  </a>
                ) : null}
                <a
                  class="icon-btn"
                  href={`/admin/members/${member.id}/edit`}
                  aria-label={`${member.name} を編集`}
                >
                  <PencilIcon />
                  <span class="icon-btn__text">編集</span>
                </a>
                <a
                  class="icon-btn icon-btn--danger"
                  href={`/admin/members/${member.id}/delete`}
                  aria-label={`${member.name} を削除`}
                >
                  <TrashIcon />
                  <span class="icon-btn__text">削除</span>
                </a>
              </span>
            </li>
          ))}
        </ul>
      )}
    </AdminLayout>,
  )
})

const MemberForm = (props: {
  account: string
  member?: schema.Member
  errors?: Record<string, string>
  values?: Record<string, string>
}) => {
  const member = props.member
  const value = (key: keyof schema.Member, fallback = '') =>
    props.values?.[key] ?? (member ? String(member[key] ?? '') : fallback)

  return (
    <AdminLayout
      title={member ? member.name : '新しいメンバー'}
      active="members"
      account={props.account}
    >
      <div class="admin-head">
        <div class="admin-head__title">
          <span class="crumbs">Members / {member ? '編集' : '追加'}</span>
          <h1>{member ? member.name : '新しいメンバー'}</h1>
        </div>
      </div>

      <form
        method="post"
        action={member ? `/admin/members/${member.id}` : '/admin/members'}
        enctype="multipart/form-data"
        class="form"
      >
        <div class="form-grid">
          <Field
            label="氏名"
            name="name"
            value={value('name')}
            required
            error={props.errors?.name}
          />
          <Field
            label="slug"
            name="slug"
            value={value('slug')}
            error={props.errors?.slug}
            hint="/members/<slug> になる。空なら氏名から作る"
          />
          <Field label="役割 / 肩書" name="role" value={value('role')} />
          <Field label="所在地" name="location" value={value('location')} />
          <Field
            label="大見出し"
            name="headline"
            value={value('headline')}
            hint="個人ページの一番上。言い切りで"
          />
          <Field
            label="並び順"
            name="sortOrder"
            value={value('sortOrder', '10')}
            hint="小さいほど先。10刻み"
          />
          {/*
            個人ページは柱も Contact もサイトのものを使う。この人の行き先が出るのは、
            サイトの行き先と違うときの1枚目だけ（同じ行き先を2つ置かない）
          */}
          <Field
            label="GitHub URL"
            name="github"
            value={value('github')}
            hint="サイトの GitHub と違うときだけ、個人ページの1枚目に出る"
          />
          <Field
            label="Email"
            name="email"
            type="email"
            value={value('email')}
            hint="サイトのメールと違うときだけ、個人ページの1枚目に出る"
          />
          {/*
            紹介文は個人ページの About 1枚に全段落が出る（件数で割れない）。
            段落の数も高さを決めるので、字数と一緒に添える
          */}
          <Area
            label="紹介文"
            name="bio"
            value={value('bio')}
            rows={5}
            hint={`「です・ます」で。空行で段落を分ける · 1画面 ${MAX_CHARS.memberBio} 字・${MAX_CHARS.memberBioParagraphs} 段落まで`}
            maxlength={MAX_CHARS.memberBio}
            error={props.errors?.bio}
          />
          <Area
            label="スキル"
            name="skillsText"
            value={value('skillsText')}
            rows={5}
            /*
              補足（「3年以上」）は公開ページで行の頭にまとまる（components.tsx の
              SkillGroups）。書き方は変わらないが、同じ補足は同じ字で書かないと
              別の行に分かれる
            */
            hint="末尾が : の行はグループ見出し。それ以外は「表示名 | 補足」。同じ補足の項目は1行にまとまる"
          />
          <Area
            label="経歴"
            name="careerText"
            value={value('careerText')}
            rows={4}
            hint="1行に1件。「期間 | 肩書き | 所属」"
          />
          <label class="field">
            <span class="field__label">アバター画像</span>
            <input class="input input--file" type="file" name="avatar" accept="image/*" />
            {props.errors?.avatar ? <span class="field__error">{props.errors.avatar}</span> : null}
            <span class="field__hint">
              {member?.avatarUrl
                ? '選ぶと差し替わる。空なら今のまま'
                : '1MB まで。未設定なら頭文字を出す'}
            </span>
          </label>
        </div>

        <div class="form-foot">
          <PublishToggle published={member?.published ?? 0} />
          <FormActions
            cancelHref="/admin/members"
            deleteHref={member ? `/admin/members/${member.id}/delete?from=edit` : undefined}
          />
        </div>
      </form>
    </AdminLayout>
  )
}

app.get('/members/new', (c) => c.html(<MemberForm account={c.get('account')} />))

app.get('/members/:id/edit', async (c) => {
  const member = await db(c).query.members.findFirst({
    where: eq(schema.members.id, Number(c.req.param('id'))),
  })
  if (!member) return c.notFound()
  return c.html(<MemberForm account={c.get('account')} member={member} />)
})

async function readMemberForm(c: Context<AppEnv>) {
  const form = await c.req.formData()
  const name = str(form.get('name'))
  const slug = toSlug(str(form.get('slug')) || name) || `member-${newToken(3)}`

  return {
    form,
    values: {
      name,
      slug,
      role: str(form.get('role')),
      location: str(form.get('location')),
      headline: str(form.get('headline')),
      bio: str(form.get('bio')),
      skillsText: str(form.get('skillsText')),
      careerText: str(form.get('careerText')),
      github: str(form.get('github')) || null,
      email: str(form.get('email')) || null,
      sortOrder: num(form.get('sortOrder'), 0),
      published: bool(form.get('published')),
      updatedAt: new Date().toISOString(),
    },
  }
}

const IMAGE_MAX_BYTES = 1_000_000

/*
  画像は KV に置く。R2 が未有効なのと、画像は読むばかりで書き換えが稀なため。
  置き場は2つ——メンバーの顔（avatars/）と作品のスクリーンショット（items/）。
  取り込みの経路と検査（種類と大きさ）は1本で、置き場の名前だけが違う。

  検査（pickImage）と書き込み（putImage）を分けてあるのは、作品のフォームが
  「画像があるか」を知ってから保存してよいかを決めるため（代替テキストの
  要否）。検査に通っただけの画像は、まだどこにも書いていない——弾かれた
  保存で KV に孤児の画像を残さない。

  戻り値で「選ばれていない」と「弾いた」を区別する。同じ null にすると、
  大きすぎる画像を選んだ人に「保存しました」と出てしまう。
*/
type ImageFolder = 'avatars' | 'items'
type PickedImage = { file: File | null; error?: string }

function pickImage(form: FormData, field: string): PickedImage {
  const file = form.get(field)
  if (!(file instanceof File) || file.size === 0) return { file: null }
  if (!file.type.startsWith('image/')) return { file: null, error: '画像ファイルを選んでください' }
  if (file.size > IMAGE_MAX_BYTES) {
    return { file: null, error: '画像は 1MB までです。小さくしてから選び直してください' }
  }
  return { file }
}

/*
  キーは /images/ 側の検査（src/routes/public.tsx の IMAGE_KEY——置き場の
  名前 / 英数字で始まり英数字と . _ - だけ）を必ず通る形にする。name は
  slug から作るので toSlug を通す（空なら置き場ごとの控えの名前）。
*/
async function putImage(kv: KVNamespace, file: File, folder: ImageFolder, name: string) {
  const extension = file.type.split('/')[1]?.replace(/[^a-z0-9]/g, '') || 'bin'
  const fallback = folder === 'avatars' ? 'member' : 'item'
  const key = `${folder}/${toSlug(name) || fallback}-${newToken(4)}.${extension}`
  await kv.put(key, await file.arrayBuffer(), { metadata: { contentType: file.type } })
  return `/images/${key}`
}

type AvatarResult = { url: string | null; error?: string }

async function saveAvatar(kv: KVNamespace, form: FormData, slug: string): Promise<AvatarResult> {
  const picked = pickImage(form, 'avatar')
  if (picked.error) return { url: null, error: picked.error }
  return { url: picked.file ? await putImage(kv, picked.file, 'avatars', slug) : null }
}

/*
  差し替え・外す・削除で使われなくなった画像は KV に残さない。
  残すと、URL を知っている人がいつまでも取得できる。

  消すのはこちらが上げた画像（/images/<置き場>/…）だけ。同梱の /assets/… や
  外の URL は KV に無いので触らない。
*/
async function removeImage(kv: KVNamespace, url: string | null | undefined) {
  if (!url || !/^\/images\/(avatars|items)\//.test(url)) return
  await kv.delete(url.replace('/images/', ''))
}

/*
  紹介文の長さ。個人ページの About は1枚で、割る先が無い。

  段落の数も見るのは、同じ字数でも空行を増やすと高くなるため（実測: 3段落なら
  405 字まで弁が閉じたまま、6段落に割ると 315 字まで下がる @rail 390x844 指,
  Hiragino Sans, macOS Chromium）。上限と測り方は src/blocks.ts の MAX_CHARS。
*/
function memberErrors(values: { name: string; bio: string }): Record<string, string> | null {
  if (!values.name) return { name: '氏名は必須です' }
  const total = chars(values.bio)
  if (total > MAX_CHARS.memberBio) {
    return {
      bio: `1画面に収まりません。紹介文は ${MAX_CHARS.memberBio} 字までです（いま ${total} 字）`,
    }
  }
  const parts = paragraphs(values.bio).length
  if (parts > MAX_CHARS.memberBioParagraphs) {
    return {
      bio: `1画面に収まりません。段落は ${MAX_CHARS.memberBioParagraphs} つまでです（いま ${parts} つ）`,
    }
  }
  return null
}

// 入力エラーで描き直すとき、打った内容をそのまま返すための変換
function asValues(values: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(values).map(([key, value]) => [key, String(value ?? '')]),
  )
}

app.post('/members', async (c) => {
  const { form, values } = await readMemberForm(c)
  const account = c.get('account')
  const back = (errors: Record<string, string>) =>
    c.html(<MemberForm account={account} errors={errors} values={asValues(values)} />, 400)

  const invalid = memberErrors(values)
  if (invalid) return back(invalid)

  const duplicate = await db(c).query.members.findFirst({
    where: eq(schema.members.slug, values.slug),
  })
  if (duplicate) return back({ slug: 'この slug は既に使われています' })

  const avatar = await saveAvatar(c.env.MEDIA, form, values.slug)
  if (avatar.error) return back({ avatar: avatar.error })

  await db(c)
    .insert(schema.members)
    .values({ ...values, avatarUrl: avatar.url })
  return c.redirect(`/admin/members?saved=${savedParam(values.published)}`, 303)
})

app.post('/members/:id', async (c) => {
  const id = parseId(c.req.param('id'))
  if (!id) return c.notFound()
  const member = await db(c).query.members.findFirst({ where: eq(schema.members.id, id) })
  if (!member) return c.notFound()

  const { form, values } = await readMemberForm(c)
  const account = c.get('account')
  const back = (errors: Record<string, string>) =>
    c.html(
      <MemberForm account={account} member={member} errors={errors} values={asValues(values)} />,
      400,
    )

  const invalid = memberErrors(values)
  if (invalid) return back(invalid)

  const duplicate = await db(c).query.members.findFirst({
    where: and(eq(schema.members.slug, values.slug), ne(schema.members.id, id)),
  })
  if (duplicate) return back({ slug: 'この slug は既に使われています' })

  const avatar = await saveAvatar(c.env.MEDIA, form, values.slug)
  if (avatar.error) return back({ avatar: avatar.error })

  await db(c)
    .update(schema.members)
    .set({ ...values, ...(avatar.url ? { avatarUrl: avatar.url } : {}) })
    .where(eq(schema.members.id, id))
  if (avatar.url) await removeImage(c.env.MEDIA, member.avatarUrl)
  return c.redirect(`/admin/members?saved=${savedParam(values.published)}`, 303)
})

app.get('/members/:id/delete', async (c) => {
  const id = parseId(c.req.param('id'))
  if (!id) return c.notFound()
  const member = await db(c).query.members.findFirst({ where: eq(schema.members.id, id) })
  if (!member) return c.notFound()

  const owned = await db(c)
    .select({ n: count() })
    .from(schema.items)
    .where(eq(schema.items.memberId, id))
  const n = owned[0]?.n ?? 0

  return c.html(
    <AdminLayout title="削除の確認" active="members" account={c.get('account')}>
      <Confirm
        title={`「${member.name}」を削除しますか？`}
        detail="この操作は取り消せません。"
        action={`/admin/members/${id}/delete`}
        cancelHref={cameFromEdit(c) ? `/admin/members/${id}/edit` : '/admin/members'}
      >
        <p>
          担当している項目 {n} 件は消えず、担当者が空になります。
          <br />
          サイトから隠したいだけなら、編集で「公開する」を外すほうが安全です。
        </p>
      </Confirm>
    </AdminLayout>,
  )
})

app.post('/members/:id/delete', async (c) => {
  const id = parseId(c.req.param('id'))
  if (!id) return c.notFound()
  const member = await db(c).query.members.findFirst({ where: eq(schema.members.id, id) })
  if (!member) return c.notFound()

  await db(c).delete(schema.members).where(eq(schema.members.id, id))
  await removeImage(c.env.MEDIA, member.avatarUrl)
  return c.redirect('/admin/members?deleted=1', 303)
})

/* --------------------------------------------------------------- Items */

/*
  管理画面の呼び名は公開ページにそろえる。公開ページでは Apps と Works を
  1つの一覧（Projects）にまとめ、区分を「個人開発 / 業務」と呼んでいる。
  入力欄は区分ごとに違う（個人開発はプラットフォーム、業務は業界と実績値）ので、
  タブは2つのまま。
*/
const typeLabel = (type: 'app' | 'work') => KIND_LABEL[type]

app.get('/items', async (c) => {
  const type = c.req.query('type') === 'work' ? 'work' : 'app'
  const rows = await db(c).query.items.findMany({
    where: eq(schema.items.type, type),
    orderBy: [asc(schema.items.sortOrder), asc(schema.items.id)],
    with: { member: true, platform: true },
  })

  return c.html(
    <AdminLayout title="Projects" active="items" account={c.get('account')} flash={flashFor(c)}>
      <div class="admin-head">
        <div class="admin-head__title">
          <h1>Projects</h1>
          <div class="tabs">
            <a href="/admin/items?type=app" aria-current={type === 'app' ? 'page' : undefined}>
              {typeLabel('app')}
            </a>
            <a href="/admin/items?type=work" aria-current={type === 'work' ? 'page' : undefined}>
              {typeLabel('work')}
            </a>
          </div>
        </div>
        <a class="btn btn--primary" href={`/admin/items/new?type=${type}`}>
          ＋ Add item
        </a>
      </div>

      {rows.length === 0 ? (
        <div class="empty-state">
          <p>{typeLabel(type)} はまだありません</p>
          <a class="btn btn--primary" href={`/admin/items/new?type=${type}`}>
            ＋ 最初の項目を追加
          </a>
        </div>
      ) : (
        <ul class="rows">
          {rows.map((item) => (
            <li class="row" key={item.id}>
              <span class="row__main">
                <strong>{item.title}</strong>
                {/*
                  恒久リンクをここに出す。貼るための URL なので、探しに行かずに
                  読めるところに置く。slug の無い行（列より前からある作品）も、
                  黙っていると気づけないので名指しで出す
                */}
                <span class="row__sub">
                  {item.member?.name ?? '担当なし'} ·{' '}
                  {itemHref(item) ?? '恒久リンクなし（保存すると付く）'}
                </span>
              </span>
              <span class="row__col">{item.platform?.label ?? item.category}</span>
              <span class="row__col">{item.year}</span>
              <span class="row__col row__col--num">{item.sortOrder}</span>
              <StatusPill published={item.published} />
              <span class="row__actions">
                <a
                  class="icon-btn"
                  href={`/admin/items/${item.id}/edit`}
                  aria-label={`${item.title} を編集`}
                >
                  <PencilIcon />
                  <span class="icon-btn__text">編集</span>
                </a>
                <a
                  class="icon-btn icon-btn--danger"
                  href={`/admin/items/${item.id}/delete`}
                  aria-label={`${item.title} を削除`}
                >
                  <TrashIcon />
                  <span class="icon-btn__text">削除</span>
                </a>
              </span>
            </li>
          ))}
        </ul>
      )}
    </AdminLayout>,
  )
})

type ItemFormData = {
  account: string
  type: 'app' | 'work'
  members: schema.Member[]
  platforms: schema.Platform[]
  item?: schema.Item & { tags: { tag: string }[]; links: { label: string; url: string }[] }
  // 入力エラーで描き直すとき、送られてきた内容をそのまま返すために使う
  submitted?: Record<string, string>
  errors?: Record<string, string>
}

/*
  フォームが描く値は、DB の行から来ることも、送信されて弾かれた内容から
  来ることもある。どちらも同じ形にしてから渡す。入力エラーのたびに
  打った内容が消えるのは、ここを分けていないと起きる。
*/
function itemDraft(item?: ItemFormData['item'], submitted?: Record<string, string>): ItemDraft {
  if (submitted) {
    return {
      title: submitted.title ?? '',
      slug: submitted.slug ?? '',
      memberId: submitted.memberId ?? '',
      platformKey: submitted.platformKey ?? '',
      category: submitted.category ?? '',
      year: submitted.year ?? '',
      summary: submitted.summary ?? '',
      body: submitted.body ?? '',
      imageAlt: submitted.imageAlt ?? '',
      removeImage: submitted.removeImage === '1',
      tags: submitted.tags ?? '',
      sortOrder: submitted.sortOrder ?? '10',
      published: submitted.published === '1' ? 1 : 0,
      metricValue: submitted.metricValue ?? '',
      metricUnit: submitted.metricUnit ?? '',
      metricNote: submitted.metricNote ?? '',
      links: submitted.links ? JSON.parse(submitted.links) : [],
    }
  }
  return {
    title: item?.title ?? '',
    slug: item?.slug ?? '',
    memberId: item?.memberId ? String(item.memberId) : '',
    platformKey: item?.platformKey ?? '',
    category: item?.category ?? '',
    year: item?.year ?? '',
    summary: item?.summary ?? '',
    body: item?.body ?? '',
    imageAlt: item?.imageAlt ?? '',
    removeImage: false,
    tags: (item?.tags ?? []).map((tag) => tag.tag).join(', '),
    sortOrder: String(item?.sortOrder ?? 10),
    published: item?.published ?? 0,
    metricValue: item?.metricValue ?? '',
    metricUnit: item?.metricUnit ?? '',
    metricNote: item?.metricNote ?? '',
    links: item?.links ?? [],
  }
}

type ItemDraft = {
  title: string
  slug: string
  memberId: string
  platformKey: string
  category: string
  year: string
  summary: string
  body: string
  imageAlt: string
  removeImage: boolean
  tags: string
  sortOrder: string
  published: number
  metricValue: string
  metricUnit: string
  metricNote: string
  links: { label: string; url: string }[]
}

/*
  実績値の添えのヒント。添えはカードでも作品のページでも説明文でも、値と単位の
  すぐあとに続けて出る（components.tsx の Metric、public.tsx の metricDigest）。
  「見込み 40人日 → 実績」と書くと、→ が値より前を指して「20 人日 見込み
  40人日 → 実績」と逆に読める。続けて読んで意味が通る形を例で見せる。
*/
const METRIC_NOTE_HINT =
  '添えは値と単位のあとに続けて読まれる。「20 人日 見込み 40人日から半減」のように、続けて読んで意味が通る形で'

const ItemForm = (props: ItemFormData) => {
  const item = props.item
  const d = itemDraft(item, props.submitted)
  const links = [...d.links, { label: '', url: '' }, { label: '', url: '' }].slice(0, 3)

  return (
    <AdminLayout title={item ? item.title : '新しい項目'} active="items" account={props.account}>
      <div class="admin-head">
        <div class="admin-head__title">
          <span class="crumbs">
            Projects / {typeLabel(props.type)} / {item ? '編集' : '追加'}
          </span>
          <h1>{item ? item.title : '新しい項目'}</h1>
        </div>
      </div>

      {/* 画像を受け取るので multipart。アバターのフォーム（MemberForm）と同じ */}
      <form
        method="post"
        action={item ? `/admin/items/${item.id}` : '/admin/items'}
        enctype="multipart/form-data"
        class="form"
      >
        <input type="hidden" name="type" value={props.type} />
        <div class="form-grid">
          <Field
            label="タイトル"
            name="title"
            value={d.title}
            required
            error={props.errors?.title}
          />
          {/*
            この作品だけを指す URL。一覧の URL（/projects/3）は並べ替えるたびに
            別の作品を指すので、貼るならこちら。変えると前の URL は 404 に
            なる——貼ったあとで変えないこと
          */}
          <Field
            label="slug"
            name="slug"
            value={d.slug}
            error={props.errors?.slug}
            hint={`${itemHref({ type: props.type, slug: '<slug>' })} になる。空なら作品名から作る（日本語だけの題からは作れないので自動生成になる）`}
          />
          <Select
            label="担当メンバー"
            name="memberId"
            value={d.memberId}
            options={[
              { value: '', label: '（なし）' },
              ...props.members.map((member) => ({ value: String(member.id), label: member.name })),
            ]}
          />
          {props.type === 'app' ? (
            <Select
              label="プラットフォーム"
              name="platformKey"
              value={d.platformKey}
              options={[
                { value: '', label: '（なし）' },
                ...props.platforms.map((platform) => ({
                  value: platform.key,
                  label: platform.label,
                })),
              ]}
              hint="絞り込みボタンと同じ値。自由入力にしないのは表記ゆれを防ぐため"
            />
          ) : (
            <Field
              label="区分"
              name="category"
              value={d.category}
              placeholder="金融系基幹システム"
            />
          )}
          {/*
            年の書き方は経歴（「2024.03 — 現在」）とそろえる。「2024 —」と書いて
            いたころは、ダッシュの先が空いたまま書きかけに見えた。一覧の並び
            （新しい順）は頭の4桁だけで決まる（queries.ts の publicOrder）ので、
            「2024 — 現在」でも 2024 として並ぶ
          */}
          <Field
            label="年"
            name="year"
            value={d.year}
            placeholder="2026 / 2024 — 現在"
            hint="終わったものは「2026」、続いているものは「2024 — 現在」。一覧は頭の4桁で新しい順に並ぶ"
          />
          <Area
            label="説明文"
            name="summary"
            value={d.summary}
            rows={3}
            /*
              カードは行数で切る（--card-lines。600 以上は上限の 100 字が切れずに
              出る6行、電話の幅は2行）。長く書いても画面から溢れはしない代わりに、
              溢れたぶんが黙って消える。電話の幅の字数（itemSummaryVisible）を
              添えるのは、上限まで書けばどの画面でも全部読まれる、と読めてしまわない
              ようにするため。

              説明は目録の文なので常体（〜する。〜した。）。本文（下の欄）は
              「です・ます」。同じ作品のページに2つが続けて出るので、文体で
              目録と本文を分ける（CLAUDE.md「文言」）
            */
            hint={`「何であるか。何をしたか。」の2文を常体で（〜する。〜した。）· ${MAX_CHARS.itemSummary} 字まで（電話の幅のカードは2行で、${MAX_CHARS.itemSummaryVisible} 字までしか出ません）`}
            maxlength={MAX_CHARS.itemSummary}
            error={props.errors?.summary}
          />
          {/*
            本文は作品のページにだけ出る（カードには出ない）。作品のページは
            1画面に収める決まりで、同じ画面に説明・画像・実績値・行き先が並ぶ
            ので、上限は紹介文よりずっと短い（数と測り方は src/blocks.ts）。
            「空行で段落を分ける」は段落を2つ以上置けるときだけ言う——1段落まで
            のときに言うと、言われたとおりに分けた人が保存で止められる
          */}
          <Area
            label="本文"
            name="body"
            value={d.body}
            rows={4}
            hint={`背景・やったこと・結果を「です・ます」で。${MAX_CHARS.itemBodyParagraphs > 1 ? '空行で段落を分ける' : '空行を入れずに1段落で'} · ${MAX_CHARS.itemBody} 字・${MAX_CHARS.itemBodyParagraphs} 段落まで（作品のページに出る。カードには出ない）`}
            maxlength={MAX_CHARS.itemBody}
            error={props.errors?.body}
          />
          <label class="field">
            <span class="field__label">画像</span>
            <input
              class={props.errors?.image ? 'input input--file input--error' : 'input input--file'}
              type="file"
              name="image"
              accept="image/*"
            />
            {props.errors?.image ? <span class="field__error">{props.errors.image}</span> : null}
            <span class="field__hint">
              {item?.imageUrl
                ? '選ぶと差し替わる。空なら今のまま · 1MB まで'
                : 'スクリーンショット。1MB まで · 作品のページと、600px 以上の一覧のカードに出る'}
            </span>
          </label>
          {/*
            代替テキストは画像そのものと別の欄。作品のページではこの画像が作品の
            見た目を伝える唯一の手段なので、画像を公開するなら空にできない
            （itemErrors）。下書きでは空のまま保存できる
          */}
          <Field
            label="画像の代替テキスト"
            name="imageAlt"
            value={d.imageAlt}
            error={props.errors?.imageAlt}
            hint="画像に何が写っているかを1文で。画像を公開するときは必須"
          />
          {item?.imageUrl ? (
            <div class="field field--wide">
              <span class="field__label">いまの画像（作品のページと同じ枠）</span>
              {/* 見本。何が写っているかは上の欄が言うので、ここでは名前を持たせない */}
              <Shot src={item.imageUrl} alt="" />
              <label class="check">
                <input type="checkbox" name="removeImage" value="1" checked={d.removeImage} />
                画像を外す
              </label>
            </div>
          ) : null}
          <Field label="タグ" name="tags" value={d.tags} hint="カンマ区切り" />
          <Field label="並び順" name="sortOrder" value={d.sortOrder} hint="小さいほど先。10刻み" />

          <fieldset class="field field--wide fieldset">
            <legend class="field__label">リンク</legend>
            {links.map((link, index) => (
              <div class="link-row" key={index}>
                <input
                  class="input"
                  type="text"
                  name="linkLabel"
                  value={link.label}
                  placeholder="Repository"
                />
                <input
                  class="input"
                  type="url"
                  name="linkUrl"
                  value={link.url}
                  placeholder="https://"
                />
              </div>
            ))}
          </fieldset>

          {props.type === 'work' ? (
            <fieldset class="field field--wide fieldset">
              <legend class="field__label">実績値 — 1項目に1つだけ</legend>
              <div class="metric-row">
                <input
                  class="input"
                  type="text"
                  name="metricValue"
                  value={d.metricValue}
                  placeholder="20"
                />
                <input
                  class="input"
                  type="text"
                  name="metricUnit"
                  value={d.metricUnit}
                  placeholder="人日"
                />
                <input
                  class="input"
                  type="text"
                  name="metricNote"
                  value={d.metricNote}
                  placeholder="見込み 40人日から半減"
                />
              </div>
              {/* 添えは値のあとに続けて読まれる（METRIC_NOTE_HINT を見ること） */}
              <span class="field__hint">{METRIC_NOTE_HINT}</span>
            </fieldset>
          ) : null}
        </div>

        <div class="form-foot">
          <PublishToggle published={d.published} />
          <FormActions
            cancelHref={`/admin/items?type=${props.type}`}
            deleteHref={item ? `/admin/items/${item.id}/delete?from=edit` : undefined}
          />
        </div>
      </form>
    </AdminLayout>
  )
}

async function formContext(c: { env: { DB: D1Database } }) {
  const database = db(c)
  const [members, platforms] = await Promise.all([
    database.query.members.findMany({ orderBy: [asc(schema.members.sortOrder)] }),
    database.query.platforms.findMany({ orderBy: [asc(schema.platforms.sortOrder)] }),
  ])
  return { members, platforms }
}

app.get('/items/new', async (c) => {
  const type = c.req.query('type') === 'work' ? 'work' : 'app'
  const { members, platforms } = await formContext(c)
  return c.html(
    <ItemForm account={c.get('account')} type={type} members={members} platforms={platforms} />,
  )
})

app.get('/items/:id/edit', async (c) => {
  const editId = parseId(c.req.param('id'))
  if (!editId) return c.notFound()
  const item = await db(c).query.items.findFirst({
    where: eq(schema.items.id, editId),
    with: {
      tags: { orderBy: [asc(schema.itemTags.sortOrder)] },
      links: { orderBy: [asc(schema.itemLinks.sortOrder)] },
    },
  })
  if (!item) return c.notFound()
  const { members, platforms } = await formContext(c)
  return c.html(
    <ItemForm
      account={c.get('account')}
      type={item.type}
      members={members}
      platforms={platforms}
      item={item}
    />,
  )
})

async function readItemForm(form: FormData) {
  const type = str(form.get('type')) === 'work' ? ('work' as const) : ('app' as const)
  const memberId = num(form.get('memberId'), 0)
  const platformKey = str(form.get('platformKey'))
  const title = str(form.get('title'))

  return {
    type,
    memberId: memberId || null,
    platformKey: type === 'app' && platformKey ? platformKey : null,
    category: type === 'work' ? str(form.get('category')) : '',
    title,
    /*
      恒久リンクの3語目。空なら作品名から作る（メンバーの slug と同じ作り方）。

      題が日本語だけだと toSlug は空を返すので、そのときは読めない代わりに
      重ならない名前にする。空のまま保存させないのは、恒久リンクの無い作品を
      作らないため——この列より前からある行だけが「まだ無い」側で、
      ここを通った行は必ず名指しできる。
    */
    slug: toSlug(str(form.get('slug')) || title) || `item-${newToken(3)}`,
    year: str(form.get('year')),
    summary: str(form.get('summary')),
    body: str(form.get('body')),
    imageAlt: str(form.get('imageAlt')),
    metricValue: str(form.get('metricValue')) || null,
    metricUnit: str(form.get('metricUnit')) || null,
    metricNote: str(form.get('metricNote')) || null,
    sortOrder: num(form.get('sortOrder'), 0),
    published: bool(form.get('published')),
    updatedAt: new Date().toISOString(),
  }
}

/*
  項目の中身のうち、公開ページで落ちる・切られる・困るもの。

  説明文はカードの行数で切られる（--card-lines）。切られても画面からは溢れない
  ので no-scroll は壊れないが、書いたぶんが黙って消える。上限は 600 以上の
  カードなら切れずに出る長さ（src/blocks.ts の MAX_CHARS.itemSummary）にしてある。

  本文は作品のページ1枚に全段落が出る。割る先が無いので、字数と段落の数の
  両方で止める（MAX_CHARS.itemBody / itemBodyParagraphs。紹介文と同じ形）。
  字数は打った文字列そのままで数える（空行も字。紹介文と同じ数え方）。

  画像があるのに代替テキストが空なら止める。作品のページではこの画像が
  作品の見た目を伝える唯一の手段で、名前の無い画像は読み上げでは「画像」と
  しか言えない。hasImage は保存したあとに画像が残るか（新しく選んだ・いまの
  画像を外さずに残す）で、呼ぶ側が決める。

  **下書きの保存では、題のほかは見ない。** 長さも代替テキストも、公開する
  ものに掛ける決まり（CLAUDE.md「下書きに戻す保存では長さを見ない」）。
  見ると、上限より前に保存された長い中身を持つ作品が「公開を外すことすら
  できない」行き止まりになる。以前は説明文の長さだけを下書きでも見ていて、
  その行き止まりがここに1つ残っていた。

  止める理由は全部まとめて返す。1つずつ返すと、直して保存するたびに次の
  理由が1つずつ出てくる。
*/
function itemErrors(
  values: { title: string; summary: string; body: string; imageAlt: string; published: number },
  hasImage: boolean,
): Record<string, string> | null {
  if (!values.title) return { title: 'タイトルは必須です' }
  if (!values.published) return null

  const errors: Record<string, string> = {}
  const summary = chars(values.summary)
  if (summary > MAX_CHARS.itemSummary) {
    errors.summary = `カードに収まりません。説明文は ${MAX_CHARS.itemSummary} 字までです（いま ${summary} 字）`
  }
  const body = chars(values.body)
  const parts = paragraphs(values.body).length
  if (body > MAX_CHARS.itemBody) {
    errors.body = `1画面に収まりません。本文は ${MAX_CHARS.itemBody} 字までです（いま ${body} 字）`
  } else if (parts > MAX_CHARS.itemBodyParagraphs) {
    errors.body = `1画面に収まりません。段落は ${MAX_CHARS.itemBodyParagraphs} つまでです（いま ${parts} つ）`
  }
  if (hasImage && !values.imageAlt) {
    errors.imageAlt = '画像を公開するときは、代替テキストが要ります'
  }
  return Object.keys(errors).length ? errors : null
}

/*
  選んだ画像を受け取らずに戻すときの知らせ。ブラウザはファイルの欄を描き直せ
  ないので、何も言わないと「選んだ画像も保存された」と読める。保存を止めた
  ときは KV にも書いていない（putImage は検査が全部通ってから）。
*/
const imageNotKept = (form: FormData, errors: Record<string, string>) => {
  const file = form.get('image')
  if (errors.image || !(file instanceof File) || file.size === 0) return errors
  return { ...errors, image: '画像はまだ保存していません。直したあとで、もう一度選んでください' }
}

/*
  slug が重なったら弾く。メンバーの slug と同じ扱い。

  黙って番号を足して通さないのは、そうすると「保存した順」で URL が決まって
  しまうため。恒久リンクは1つの URL が1つの作品を指すことに全部が懸かって
  いるので、重なりは人に直してもらう。
*/
async function slugTaken(
  database: ReturnType<typeof db>,
  slug: string,
  exceptId: number | null,
): Promise<Record<string, string> | null> {
  const duplicate = await database.query.items.findFirst({
    where: exceptId
      ? and(eq(schema.items.slug, slug), ne(schema.items.id, exceptId))
      : eq(schema.items.slug, slug),
  })
  return duplicate ? { slug: 'この slug は既に使われています' } : null
}

// 弾いたときに、打った内容をそのままフォームへ返すための形
function submittedItem(form: FormData): Record<string, string> {
  const labels = form.getAll('linkLabel').map((value) => str(value))
  const urls = form.getAll('linkUrl').map((value) => str(value))
  return {
    title: str(form.get('title')),
    slug: str(form.get('slug')),
    memberId: str(form.get('memberId')),
    platformKey: str(form.get('platformKey')),
    category: str(form.get('category')),
    year: str(form.get('year')),
    summary: str(form.get('summary')),
    body: str(form.get('body')),
    imageAlt: str(form.get('imageAlt')),
    removeImage: bool(form.get('removeImage')) ? '1' : '',
    tags: str(form.get('tags')),
    sortOrder: str(form.get('sortOrder')),
    published: bool(form.get('published')) ? '1' : '',
    metricValue: str(form.get('metricValue')),
    metricUnit: str(form.get('metricUnit')),
    metricNote: str(form.get('metricNote')),
    links: JSON.stringify(labels.map((label, index) => ({ label, url: urls[index] ?? '' }))),
  }
}

// タグとリンクは総入れ替えにする。差分を取るより、消して入れ直すほうが読める
async function replaceChildren(database: ReturnType<typeof db>, itemId: number, form: FormData) {
  const tags = parseTags(str(form.get('tags')))
  const labels = form.getAll('linkLabel').map((value) => str(value))
  const urls = form.getAll('linkUrl').map((value) => str(value))

  await database.delete(schema.itemTags).where(eq(schema.itemTags.itemId, itemId))
  await database.delete(schema.itemLinks).where(eq(schema.itemLinks.itemId, itemId))

  if (tags.length) {
    await database
      .insert(schema.itemTags)
      .values(tags.map((tag, index) => ({ itemId, tag, sortOrder: index })))
  }

  const links = labels
    .map((label, index) => ({ label, url: urls[index] ?? '' }))
    .filter((link) => link.label && link.url)
  if (links.length) {
    await database
      .insert(schema.itemLinks)
      .values(links.map((link, index) => ({ itemId, ...link, sortOrder: index })))
  }
}

app.post('/items', async (c) => {
  const form = await c.req.formData()
  const values = await readItemForm(form)
  // 画像の種類と大きさは下書きでも見る。長さの話ではなく、受け取れない画像
  const picked = pickImage(form, 'image')
  const errors =
    (picked.error ? { image: picked.error } : null) ??
    itemErrors(values, picked.file !== null) ??
    (await slugTaken(db(c), values.slug, null))
  if (errors) {
    const { members, platforms } = await formContext(c)
    return c.html(
      <ItemForm
        account={c.get('account')}
        type={values.type}
        members={members}
        platforms={platforms}
        submitted={submittedItem(form)}
        errors={imageNotKept(form, errors)}
      />,
      400,
    )
  }

  // 検査が全部通ってから KV に書く。止めた保存で孤児の画像を残さない
  const imageUrl = picked.file
    ? await putImage(c.env.MEDIA, picked.file, 'items', values.slug)
    : null
  const inserted = await db(c)
    .insert(schema.items)
    .values({ ...values, imageUrl })
    .returning({ id: schema.items.id })
  const id = inserted[0]?.id
  if (id) await replaceChildren(db(c), id, form)
  return c.redirect(`/admin/items?type=${values.type}&saved=${savedParam(values.published)}`, 303)
})

app.post('/items/:id', async (c) => {
  const id = parseId(c.req.param('id'))
  if (!id) return c.notFound()
  // 先に存在を確かめる。無い id のまま進むと、タグの差し替えが外部キーで
  // 落ちて 500 になるか、何も変わっていないのに「保存しました」と出る
  const existing = await db(c).query.items.findFirst({ where: eq(schema.items.id, id) })
  if (!existing) return c.notFound()

  const form = await c.req.formData()
  const values = await readItemForm(form)
  const picked = pickImage(form, 'image')
  /*
    保存したあとの画像。新しく選んだならそれ（差し替え）、「画像を外す」なら
    無し、どちらでもなければいまのまま。選んだうえで外すにも印を付けたときは、
    選んだほうを採る——ファイルを選ぶ手間のほうが、印1つより強い意思表示
  */
  const removing = bool(form.get('removeImage')) === 1
  const keeps = !removing && existing.imageUrl !== null
  const errors =
    (picked.error ? { image: picked.error } : null) ??
    itemErrors(values, picked.file !== null || keeps) ??
    (await slugTaken(db(c), values.slug, id))
  if (errors) {
    const { members, platforms } = await formContext(c)
    return c.html(
      <ItemForm
        account={c.get('account')}
        type={values.type}
        members={members}
        platforms={platforms}
        item={{ ...existing, tags: [], links: [] }}
        submitted={submittedItem(form)}
        errors={imageNotKept(form, errors)}
      />,
      400,
    )
  }

  const imageUrl = picked.file
    ? await putImage(c.env.MEDIA, picked.file, 'items', values.slug)
    : keeps
      ? existing.imageUrl
      : null
  await db(c)
    .update(schema.items)
    .set({ ...values, imageUrl })
    .where(eq(schema.items.id, id))
  // 差し替えた・外した画像は KV から消す（removeImage の注記）
  if (imageUrl !== existing.imageUrl) await removeImage(c.env.MEDIA, existing.imageUrl)
  await replaceChildren(db(c), id, form)
  return c.redirect(`/admin/items?type=${values.type}&saved=${savedParam(values.published)}`, 303)
})

app.get('/items/:id/delete', async (c) => {
  const id = parseId(c.req.param('id'))
  if (!id) return c.notFound()
  const item = await db(c).query.items.findFirst({
    where: eq(schema.items.id, id),
    with: { tags: true, links: true },
  })
  if (!item) return c.notFound()

  return c.html(
    <AdminLayout title="削除の確認" active="items" account={c.get('account')}>
      <Confirm
        title={`「${item.title}」を削除しますか？`}
        detail="この操作は取り消せません。"
        action={`/admin/items/${id}/delete`}
        cancelHref={cameFromEdit(c) ? `/admin/items/${id}/edit` : `/admin/items?type=${item.type}`}
      >
        <p>
          タグ {item.tags.length} 件とリンク {item.links.length} 件{item.imageUrl ? '、画像' : ''}
          も一緒に消えます。
          <br />
          サイトから隠したいだけなら、編集で「公開する」を外すほうが安全です。
        </p>
      </Confirm>
    </AdminLayout>,
  )
})

app.post('/items/:id/delete', async (c) => {
  const id = parseId(c.req.param('id'))
  if (!id) return c.notFound()
  const item = await db(c).query.items.findFirst({ where: eq(schema.items.id, id) })
  if (!item) return c.notFound()

  await db(c).delete(schema.items).where(eq(schema.items.id, id))
  await removeImage(c.env.MEDIA, item.imageUrl)
  return c.redirect(`/admin/items?type=${item.type}&deleted=1`, 303)
})

/* --------------------------------------------------------------- 構成 */

/*
  公開ページの画面の連なり。置く・外す・前後に動かす、の3つだけ。
  部品の見た目はここからは変えられない（見た目は「見た目」で、全体に対して選ぶ）。

  1つのブロックが何画面になるかは中身の件数で決まる（1画面あたりの件数は
  src/blocks.ts の perScreen が正）。行に出す「N 画面」はその結果の知らせで、
  操作する口ではない。置いたものが何画面になるかが見えないと、
  「13件目を公開したら画面が1枚増えた」ことに気づけない。
*/

const blockLabel = (block: schema.Block) =>
  block.title || blockType(block.type)?.label || block.type

/*
  画面の数を決める、公開中のものの件数。項目の行そのものは引かない
  （数えるだけなら、カードの中身まで取ってくる必要が無い）。

  メンバーだけは行を引く。公開中がちょうど1人なら、Team の行はその人の
  プロフィールに置き換わる（src/routes/public.tsx の profileOf）ので、その人の
  紹介・技術・経歴から画面の数を数える（src/blocks.ts の memberScreenCount。
  公開ページの memberScreens と同じ開き方）。profile はその数で、1人でない
  サイトでは null。
*/
type SiteCounts = { projects: number; members: number; profile: number | null }

async function siteCounts(database: ReturnType<typeof db>): Promise<SiteCounts> {
  const [projects, members] = await Promise.all([
    // Projects は個人開発と業務を1つの一覧に並べるので、区分を問わず数える
    countPublishedItems(database),
    listPublishedMembers(database),
  ])
  const [solo] = members.length === 1 ? members : []
  return {
    projects,
    members: members.length,
    profile: solo ? memberScreenCount(solo) : null,
  }
}

/*
  そのブロックが公開ページで何画面になるか。

  割りかたは公開ページと同じ src/lib/paginate.ts（screenCount）で、1画面あたりの
  件数は src/blocks.ts の perScreen。行の開き方（何を1件と数えるか）も同じ
  src/blocks.ts の blockUnitCount——公開ページの renderBlock が描く列と、ここで
  数える列が同じ式から出ていないと、「3 画面」と実際の画面数が静かにずれる。

  種類を足し忘れる方向は型が守っている（switch に default を置かない判断で、
  blocks.ts に1つ足すとここと renderBlock の両方が TS2366 で落ちる）。中身が
  ずれる方向を守るのが blockUnitCount のほう。

  下書きと、中身が0件のものは 0 画面——公開ページが節ごと出さないので、
  URL も生まれない。数えるのは絞り込みのかかっていない素のサイトで、
  ?kind= を付けた URL はこれより少ない画面になることがある。
*/
function blockScreens(block: schema.Block, counts: SiteCounts): number {
  const type = blockType(block.type)
  // 下書きは publishedBlocks が落とす。種類ごと消えた行も読む側が無視している
  if (!type || block.published !== 1) return 0
  const perScreen = blockPerScreen(type.key)

  switch (type.key) {
    // 画面まるごとのもの。2画面目は無い
    case 'hero':
    case 'contact':
      return 1
    case 'statement':
      return block.title ? 1 : 0

    // 件数で割れるもの。行は DB に入っている
    case 'projects':
      return screenCount(counts.projects, perScreen)
    // 公開中が1人なら、Team の画面はその人のプロフィールの画面に置き換わる
    case 'team':
      return counts.profile ?? screenCount(counts.members, perScreen)

    // 件数で割れるもの。行は body に入っている（通らない URL は数に入らない）
    case 'links':
    case 'note':
    case 'now':
    case 'numbers':
    case 'timeline':
      return screenCount(blockUnitCount(type.key, block.body), perScreen)
  }
}

const BlocksPage = (props: {
  account: string
  rows: schema.Block[]
  counts: SiteCounts
  flash?: string | null
  error?: string
}) => {
  const placed = new Set(props.rows.map((row) => row.type))
  // 決まった中身のものは1つだけ。打ち込むものはいくつでも置ける
  const available = BLOCK_TYPES.filter((type) => type.kind === 'free' || !placed.has(type.key))
  // 行ごとの画面数と、その合計（＝いまサイトが何画面あるか）
  const screens = props.rows.map((row) => blockScreens(row, props.counts))
  const total = screens.reduce((sum, n) => sum + n, 0)

  return (
    <AdminLayout title="構成" active="blocks" account={props.account} flash={props.flash}>
      <div class="admin-head">
        <div class="admin-head__title">
          <span class="crumbs">トップページ</span>
          <h1>構成</h1>
        </div>
        {/*
          「見る」は2つある。入口（/）は読む人が着くところで、1画面ずつ
          めくる姿そのもの。全体ページ（/all）は置いたものが全部縦に並ぶ唯一の
          姿で、この一覧が「合計 N 画面」と言っている中身を通しで見られる
          ——並べ替えたあとに確かめる先はこちらのほうで、画面ごとに割った
          あとは、めくらずに全部を見る手がここにしか無い。

          入れ物は .form-actions__right（横並び・同じ幅）を借りる。管理画面で
          ボタンを2つ並べる形はこれ1つで、新しい見た目を増やさない。
        */}
        <div class="form-actions__right">
          <a class="btn btn--ghost" href="/" target="_blank" rel="noreferrer">
            サイトを見る ↗
          </a>
          <a class="btn btn--ghost" href="/all" target="_blank" rel="noreferrer">
            全体を1ページで見る ↗
          </a>
        </div>
      </div>

      {props.error ? <p class="banner banner--error">{props.error}</p> : null}

      {/*
        まだ1行も無いときは「足す」を出さない。今そこに見えている5節は
        既定の並びで、行としては存在しない。先にそれを行にしてから触らせる
      */}
      {props.rows.length === 0 ? (
        <div class="empty-state">
          <p>
            まだ何も置いていないので、既定の並び（Hero → Projects → Team → Contact）で 出しています
          </p>
          <form method="post" action="/admin/blocks/init">
            <button class="btn btn--primary" type="submit">
              この並びから始める
            </button>
          </form>
        </div>
      ) : (
        <>
          {/*
            画面がいくつあるかは、置いたものと登録の件数で決まる。ここに出さないと、
            1件足したせいで画面が1枚増えたことが公開ページを開くまで分からない
          */}
          <p class="form-note">
            合計 {total} 画面。公開ページはこの順に1画面ずつ出ます（下書きと、中身の無いものは 0
            画面）。
          </p>
          <ul class="rows">
            {props.rows.map((block, index) => {
              const type = blockType(block.type)
              return (
                // id は「動かした・直した行」へ戻ってくるための着地点
                <li class="row" id={`block-${block.id}`} key={block.id}>
                  <span class="row__move">
                    <form method="post" action={`/admin/blocks/${block.id}/move`}>
                      <input type="hidden" name="dir" value="up" />
                      <button
                        class="move-btn"
                        type="submit"
                        disabled={index === 0}
                        aria-label={`${blockLabel(block)} を前へ`}
                      >
                        ↑
                      </button>
                    </form>
                    <form method="post" action={`/admin/blocks/${block.id}/move`}>
                      <input type="hidden" name="dir" value="down" />
                      <button
                        class="move-btn"
                        type="submit"
                        disabled={index === props.rows.length - 1}
                        aria-label={`${blockLabel(block)} を後ろへ`}
                      >
                        ↓
                      </button>
                    </form>
                  </span>
                  <span class="row__main">
                    <strong>{blockLabel(block)}</strong>
                    <span class="row__sub">
                      {type?.label ?? block.type}
                      {type?.kind === 'fixed' ? ' · 中身は自動' : ''}
                    </span>
                    {/*
                      1人のサイトの Team。公開ページでは Team の画面を作らず、その
                      位置にその人のプロフィール（1枚目・About・Skills・Career）が
                      並ぶ。ここで言っておかないと、「Team」の行が「4 画面」と
                      出る理由も、公開ページに Team が見当たらない理由も分からない。
                      下書きの行にも出す——公開したら何が出るかの知らせなので
                    */}
                    {block.type === 'team' && props.counts.profile !== null ? (
                      <span class="row__sub">
                        公開中が1人のあいだは、その人のプロフィール（{props.counts.profile}{' '}
                        画面）に置き換わる
                      </span>
                    ) : null}
                  </span>
                  {/* 読み取り専用の知らせ。ここから件数は変えられない */}
                  <span class="row__col">{screens[index] ?? 0} 画面</span>
                  <StatusPill published={block.published} />
                  <span class="row__actions">
                    {/*
                      公開と下書きを、編集フォームを通らずに切り替える。
                      フォームを通ると本文の検査に当たるので、上限より前に
                      保存された長い中身は「引っ込める」ことすらできなかった。
                      ピルは状態の表示、こちらは操作——文言は起きることで書く
                    */}
                    <form
                      class="row__publish"
                      method="post"
                      action={`/admin/blocks/${block.id}/publish`}
                    >
                      <input type="hidden" name="published" value={block.published ? '' : '1'} />
                      <button
                        class="icon-btn icon-btn--wide"
                        type="submit"
                        aria-label={`${blockLabel(block)} を${
                          block.published ? '下書きにする' : '公開する'
                        }`}
                      >
                        {block.published ? '下書きにする' : '公開する'}
                      </button>
                    </form>
                    <a
                      class="icon-btn"
                      href={`/admin/blocks/${block.id}/edit`}
                      aria-label={`${blockLabel(block)} を編集`}
                    >
                      <PencilIcon />
                      <span class="icon-btn__text">編集</span>
                    </a>
                    <a
                      class="icon-btn icon-btn--danger"
                      href={`/admin/blocks/${block.id}/delete`}
                      aria-label={`${blockLabel(block)} を外す`}
                    >
                      <TrashIcon />
                      <span class="icon-btn__text">外す</span>
                    </a>
                  </span>
                </li>
              )
            })}
          </ul>
        </>
      )}

      {props.rows.length === 0 ? null : (
        <section class="catalog">
          <h2 class="catalog__title">
            足す
            <span class="presets__note">Contact の手前に入る。置いてから前後に動かす</span>
          </h2>
          <ul class="catalog__grid">
            {available.map((type) => (
              <li class="catalog__item" key={type.key}>
                <span class="catalog__label">{type.label}</span>
                <span class="catalog__note">{type.note}</span>
                {type.kind === 'fixed' ? (
                  <form method="post" action="/admin/blocks">
                    <input type="hidden" name="type" value={type.key} />
                    <button class="btn btn--ghost" type="submit">
                      置く
                    </button>
                  </form>
                ) : (
                  <a class="btn btn--ghost" href={`/admin/blocks/new?type=${type.key}`}>
                    書く
                  </a>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </AdminLayout>
  )
}

app.get('/blocks', async (c) => {
  const database = db(c)
  const [rows, counts] = await Promise.all([listBlocks(database), siteCounts(database)])
  return c.html(
    <BlocksPage
      account={c.get('account')}
      rows={rows}
      counts={counts}
      flash={flashFor(c, '外しました')}
    />,
  )
})

/*
  中身の欄に添える一文。1画面に何件・何字まで出るかを、保存を押す前に出す。

  どちらの数も src/blocks.ts が正で、ここは結果の知らせ。件数のほうは入り
  きらないぶんが次の画面に回るので気にしなくてよく、字数のほうは回せない
  ——この違いがあるので、両方を同じ並びで見せる。
*/
const bodyHint = (type: Extract<BlockType, { kind: 'free' }>) => {
  const parts: string[] = [type.hint]
  if ('perScreen' in type) parts.push(`1画面 ${type.perScreen} 件`)
  // free 6種はすべて maxChars を持つので、ここは条件で包まない
  // （1行上の perScreen は statement が持たないので、あちらは本当に分岐する）
  parts.push(
    type.key === 'statement'
      ? `一文とあわせて ${type.maxChars} 字まで`
      : `1画面 ${type.maxChars} 字まで`,
  )
  return parts.join(' · ')
}

const BlockForm = (props: {
  account: string
  type: BlockType
  block?: schema.Block
  values?: Record<string, string>
  errors?: Record<string, string>
}) => {
  const { type, block } = props
  const value = (key: 'title' | 'body') =>
    props.values?.[key] ?? block?.[key] ?? (key === 'title' && 'title' in type ? type.title : '')
  // 入力エラーで描き直すとき、外した「公開する」も外したまま返す
  /*
    入力エラーで描き直すとき、外した「公開する」も外したまま返す。
    新しく書くときは下書きから始める（メンバー・項目と同じ。置くだけのもの——
    Projects や Team——はフォームを通らず、置いた時点で出る）
  */
  const published = props.values ? Number(props.values.published === '1') : (block?.published ?? 0)

  return (
    <AdminLayout title={type.label} active="blocks" account={props.account}>
      <div class="admin-head">
        <div class="admin-head__title">
          <span class="crumbs">構成 / {block ? '編集' : '追加'}</span>
          <h1>{type.label}</h1>
        </div>
      </div>

      <form
        method="post"
        action={block ? `/admin/blocks/${block.id}` : '/admin/blocks'}
        class="form"
      >
        <input type="hidden" name="type" value={type.key} />
        <div class="form-grid">
          {type.kind === 'free' ? (
            <>
              <Field
                label={type.key === 'statement' ? '一文' : '見出し'}
                name="title"
                value={value('title')}
                error={props.errors?.title}
                hint={
                  type.key === 'statement'
                    ? `大きく出る · ${MAX_STATEMENT_SENTENCE} 字まで`
                    : `空なら「${type.title || type.label}」`
                }
              />
              <Area
                label={type.key === 'statement' ? '添え書き' : '中身'}
                name="body"
                value={value('body')}
                rows={6}
                hint={bodyHint(type)}
                error={props.errors?.body}
              />
            </>
          ) : (
            <p class="form-note field--wide">
              中身は自動で入ります（{type.note}）。ここでは出す・出さないだけを決めます。
            </p>
          )}
        </div>

        <div class="form-foot">
          <PublishToggle published={published} />
          <FormActions
            cancelHref="/admin/blocks"
            deleteHref={block ? `/admin/blocks/${block.id}/delete?from=edit` : undefined}
            deleteLabel="トップから外す…"
          />
        </div>
      </form>
    </AdminLayout>
  )
}

app.get('/blocks/new', (c) => {
  const key = c.req.query('type') ?? ''
  const type = isBlockKey(key) ? blockType(key) : undefined
  // 決まった中身のものは書くことが無いので、一覧の「置く」から直接入る
  if (type?.kind !== 'free') return c.notFound()
  return c.html(<BlockForm account={c.get('account')} type={type} />)
})

app.get('/blocks/:id/edit', async (c) => {
  const id = parseId(c.req.param('id'))
  if (!id) return c.notFound()
  const block = await db(c).query.blocks.findFirst({ where: eq(schema.blocks.id, id) })
  const type = block ? blockType(block.type) : undefined
  if (!block || !type) return c.notFound()
  return c.html(<BlockForm account={c.get('account')} type={type} block={block} />)
})

function readBlockForm(form: FormData) {
  return {
    title: str(form.get('title')),
    body: str(form.get('body')),
    published: bool(form.get('published')),
  }
}

/*
  自由文の長さの上限。数そのものは src/blocks.ts の maxChars が正で、
  ここはその数を「画面ごとの合計」に当てる側。

  1行1件のものは件数で割れる（入りきらないぶんは次の画面に回る）が、割った
  「あと」の1画面に何字入るかは件数では決まらない。2000字の段落を保存させると、
  公開ページでは弁（overflow: auto）が開いて節の中がスクロールするだけで、
  1画面には収まらない。入口で止めるほかに手が無いので、ここで見る。

  一文だけは字数と別に見る。ひとことは1枚の画面に大きく出る一文で、
  120 字を超えると「大きな一文」ではなく段落になる（収まるかどうかとは別の話）。
*/
const MAX_STATEMENT_SENTENCE = 120

// 「字」で数える。絵文字や異体字を2字と数えないように、コードポイントで数える
const chars = (text: string) => [...text].length

/*
  1画面ぶんずつの字数。割りかたは公開ページと同じ（chunk と perScreen）で、
  行の開き方も同じ（src/blocks.ts の blockTexts / blockLines）。

  数えるのは画面に文字として出るものだけ。リンク集の URL は href であって
  本文には出ないので、2列目は落とす（URL の長さで書ける説明が減るのはおかしい）。
  形が通らない URL の行は公開ページに出ないので、blockLines が先に落とす。
*/
function screenChars(type: BlockType, body: string): number[] {
  const perScreen = blockPerScreen(type.key)
  const units =
    type.key === 'note'
      ? blockTexts(body)
      : blockLines(type.key, body).map((parts) => blockVisibleParts(type.key, parts).join(''))
  return chunk(units, perScreen).map((screen) => screen.reduce((sum, text) => sum + chars(text), 0))
}

/*
  出せない中身は保存しない。「公開」なのにサイトに出ない行を作らないため。
  ひとことは一文が、それ以外は中身が要る。リンク集は URL の形まで見る
  （公開ページは通らない URL を落とすので、素通しすると節ごと消える）。

  長さも同じ理由で見る——公開ページで1画面に収まらない中身は、管理画面でも
  保存させない。いちばん多い画面の字数を出して添えるのは、何字削れば通るかが
  分からないと直しようがないため。
*/
function blockErrors(
  /*
    free に絞ってあるのは、**安全性のため**。BlockType のまま受けて
    `'maxChars' in type ? type.maxChars : Infinity` としていたころは、
    maxChars を持たない free ブロックを足したときに無制限で保存を通し、
    公開ページで弁が開いて「スクロールしない」が静かに破れた。
    いまは同じ足し忘れが TS2339 でその場で落ちる。
  */
  type: Extract<BlockType, { kind: 'free' }>,
  values: { title: string; body: string },
): Record<string, string> | null {
  const max = type.maxChars
  if (type.key === 'statement') {
    if (!values.title) return { title: '一文を入れてください' }
    if (chars(values.title) > MAX_STATEMENT_SENTENCE) {
      return { title: `大きく出る一文です。${MAX_STATEMENT_SENTENCE} 字までにしてください` }
    }
    const total = chars(values.title) + chars(values.body)
    if (total > max) {
      return { body: `1画面に収まりません。一文と添え書きで ${max} 字までです（いま ${total} 字）` }
    }
    return null
  }
  if (!values.body) return { body: '中身を入れてください' }
  if (type.key === 'links' && !parseLines(values.body).some(([, url]) => isSafeUrl(url))) {
    return { body: 'URL は https:// か mailto: か / で始めてください' }
  }
  // 画面の数だけ数が並ぶので、広げずに畳む（行数に上限は無い）
  const worst = screenChars(type, values.body).reduce((most, n) => Math.max(most, n), 0)
  if (worst > max) {
    return {
      body: `1画面に収まりません。1画面は ${max} 字までです（いちばん多い画面が ${worst} 字）`,
    }
  }
  return null
}

// 足す先はいちばん下。行はもう読んであるので、最大値を DB に聞き直さない
const nextBlockOrder = (rows: schema.Block[]) =>
  rows.reduce((last, row) => Math.max(last, row.sortOrder), 0) + 10

app.post('/blocks', async (c) => {
  const form = await c.req.formData()
  const key = str(form.get('type'))
  const type = isBlockKey(key) ? blockType(key) : undefined
  const account = c.get('account')
  const stored = await listBlocks(db(c))
  // 0件のときサイトに出ているのは既定の並び。重複かどうかもそれで判断する
  const rows = stored.length ? stored : defaultBlocks()

  // 画面の数を数えるのは、一覧を描き直すときだけ。保存できた側では要らない
  if (!type) {
    return c.html(
      <BlocksPage
        account={account}
        rows={stored}
        counts={await siteCounts(db(c))}
        error="置けないブロックです"
      />,
      400,
    )
  }

  if (type.kind === 'fixed') {
    if (rows.some((row) => row.type === type.key)) {
      return c.html(
        <BlocksPage
          account={account}
          rows={stored}
          counts={await siteCounts(db(c))}
          error={`${type.label} は既に置いてあります`}
        />,
        400,
      )
    }
  }

  const values = type.kind === 'free' ? readBlockForm(form) : null
  if (type.kind === 'free' && values) {
    const errors = blockErrors(type, values)
    if (errors) {
      return c.html(
        <BlockForm account={account} type={type} values={asValues(values)} errors={errors} />,
        400,
      )
    }
  }

  /*
    ここまで来てから足す。0件なら、先に既定の並びを行にする。
    そうしないと、足した1つだけの DB になって、見えていた5節が消える
  */
  const current = await ensureBlocks(db(c))
  const [added] = await db(c)
    .insert(schema.blocks)
    .values({
      type: type.key,
      ...(values ?? { published: 1 }),
      sortOrder: nextBlockOrder(current),
    })
    .returning({ id: schema.blocks.id })
  if (!added) return c.text('足せませんでした', 500)

  /*
    足す先は Contact の手前。連なりのいちばん後ろに付けると締めの連絡先の後ろに
    来てしまい、↑ を何度も押して運ぶことになる
  */
  const contact = current.findIndex((row) => row.type === 'contact')
  if (contact >= 0) {
    const ids = current.map((row) => row.id)
    ids.splice(contact, 0, added.id)
    await reorderBlocks(db(c), ids)
  }

  const published = values ? values.published : 1
  return c.redirect(`/admin/blocks?saved=${savedParam(published)}#block-${added.id}`, 303)
})

// 何も置いていないときだけ、既定の並びを行にする。2回目以降は何もしない
app.post('/blocks/init', async (c) => {
  const rows = await listBlocks(db(c))
  // 2回目以降は何もしない。何もしていないのに「保存しました」と出さない
  if (rows.length > 0) return c.redirect('/admin/blocks', 303)

  await db(c)
    .insert(schema.blocks)
    .values(
      DEFAULT_BLOCKS.map((type, index) => ({ type, published: 1, sortOrder: (index + 1) * 10 })),
    )
  return c.redirect('/admin/blocks?saved=1', 303)
})

app.post('/blocks/:id', async (c) => {
  const id = parseId(c.req.param('id'))
  if (!id) return c.notFound()
  const block = await db(c).query.blocks.findFirst({ where: eq(schema.blocks.id, id) })
  const type = block ? blockType(block.type) : undefined
  if (!block || !type) return c.notFound()

  const values = readBlockForm(await c.req.formData())
  const updatedAt = new Date().toISOString()

  // 決まった中身のものは、出す・出さないしか変えられない
  if (type.kind === 'fixed') {
    await db(c)
      .update(schema.blocks)
      .set({ published: values.published, updatedAt })
      .where(eq(schema.blocks.id, id))
    return c.redirect(`/admin/blocks?saved=${savedParam(values.published)}#block-${id}`, 303)
  }

  /*
    下書きに戻す保存では中身を見ない。公開しないものは公開ページに出ないので、
    1画面に収まるかどうかを問う理由が無い。

    問うていたころは行き止まりができていた。上限より前に保存された長い中身を
    持つ行は、編集フォームが DB の本文で初期化されるので、「公開する」を外して
    保存しようとしても同じ 400 で戻ってくる。引っ込める手は本文ごと削除しか
    残らず、一度当たった人はその画面を触らなくなる。
  */
  const errors = values.published ? blockErrors(type, values) : null
  if (errors) {
    return c.html(
      <BlockForm
        account={c.get('account')}
        type={type}
        block={block}
        values={asValues(values)}
        errors={errors}
      />,
      400,
    )
  }

  await db(c)
    .update(schema.blocks)
    .set({ ...values, updatedAt })
    .where(eq(schema.blocks.id, id))
  return c.redirect(`/admin/blocks?saved=${savedParam(values.published)}#block-${id}`, 303)
})

/*
  一覧から公開・下書きだけを切り替える。中身は触らないので検査もしない。

  種類も見ない（外すのと同じ理由——blocks.ts から種類を1つ減らしたとき、
  その行が引っ込められずに残らないように）。
*/
app.post('/blocks/:id/publish', async (c) => {
  const id = parseId(c.req.param('id'))
  if (!id) return c.notFound()
  const block = await db(c).query.blocks.findFirst({ where: eq(schema.blocks.id, id) })
  if (!block) return c.notFound()

  const form = await c.req.formData()
  await db(c)
    .update(schema.blocks)
    .set({ published: bool(form.get('published')), updatedAt: new Date().toISOString() })
    .where(eq(schema.blocks.id, id))
  // 押した行へ戻す。一覧の頭に戻すと、どれを切り替えたかを探し直すことになる
  return c.redirect(`/admin/blocks?saved=1#block-${id}`, 303)
})

/*
  上下に1つ動かす。並び順は毎回 10 刻みで振り直すので、同じ値が並んで
  「動かしたのに順番が変わらない」ことが起きない
*/
app.post('/blocks/:id/move', async (c) => {
  const id = parseId(c.req.param('id'))
  if (!id) return c.notFound()
  const rows = await listBlocks(db(c))
  const index = rows.findIndex((row) => row.id === id)
  if (index < 0) return c.notFound()

  const form = await c.req.formData()
  const dir = str(form.get('dir'))
  // 'up' 以外を全部「下へ」にすると、打ち間違いの POST でも並びが変わる
  if (dir !== 'up' && dir !== 'down') {
    return c.html(
      <BlocksPage
        account={c.get('account')}
        rows={rows}
        counts={await siteCounts(db(c))}
        error="動かす向きが分かりません"
      />,
      400,
    )
  }

  const target = dir === 'up' ? index - 1 : index + 1
  const ids = rows.map((row) => row.id)
  if (target >= 0 && target < ids.length) {
    const [moved] = ids.splice(index, 1)
    if (moved !== undefined) ids.splice(target, 0, moved)
    await reorderBlocks(db(c), ids)
  }
  // 動かした行へ戻す。ページの頭に戻すと、続けて動かすたびに行を探し直すことになる
  return c.redirect(`/admin/blocks#block-${id}`, 303)
})

/*
  外すのに種類は要らない。blocks.ts から種類を1つ減らしたとき、その行が
  編集も削除もできずに一覧へ残り続けるのを避けるため（読む側は既に無視している）
*/
app.get('/blocks/:id/delete', async (c) => {
  const id = parseId(c.req.param('id'))
  if (!id) return c.notFound()
  const block = await db(c).query.blocks.findFirst({ where: eq(schema.blocks.id, id) })
  if (!block) return c.notFound()
  const type = blockType(block.type)

  return c.html(
    <AdminLayout title="外す" active="blocks" account={c.get('account')}>
      <Confirm
        title={`「${blockLabel(block)}」をトップから外しますか？`}
        detail={
          type?.kind === 'fixed'
            ? '中身（登録した項目やメンバー）は消えません。あとから「足す」で置き直せます。'
            : '打ち込んだ中身も消えます。'
        }
        action={`/admin/blocks/${id}/delete`}
        // 種類が消えた行は編集画面が開けないので、一覧へ戻す
        cancelHref={
          cameFromEdit(c) && type ? `/admin/blocks/${id}/edit` : `/admin/blocks#block-${id}`
        }
        verb="外す"
      >
        <p>いったん隠したいだけなら、編集で「公開する」を外すほうが安全です。</p>
      </Confirm>
    </AdminLayout>,
  )
})

app.post('/blocks/:id/delete', async (c) => {
  const id = parseId(c.req.param('id'))
  if (!id) return c.notFound()
  const block = await db(c).query.blocks.findFirst({ where: eq(schema.blocks.id, id) })
  if (!block) return c.notFound()

  await db(c).delete(schema.blocks).where(eq(schema.blocks.id, id))
  return c.redirect('/admin/blocks?deleted=1', 303)
})

/* --------------------------------------------------------------- 見た目 */

/*
  骨格の見取り図。実物の縮小ではなく、どこに何が来るかだけを帯で見せる。
  本物を縮めて出すには CSS を二重に持つことになり、片方だけ古くなる。
*/
const Skeleton = ({ layout }: { layout: string }) => (
  <span class={`skel skel--${layout}`} aria-hidden="true">
    <i class="skel__mark" />
    <i />
    <i />
  </span>
)

// 見本は公開ページと同じ指定（data-*）で色と書体を出す。見本用の値を別に持たない
const PresetPreview = ({ group, option }: { group: ThemeKey; option: string }) => {
  if (group === 'layout') return <Skeleton layout={option} />
  if (group === 'accent') return <span class="swatch" data-accent={option} aria-hidden="true" />
  return (
    <span class="sample" data-typeface={option} aria-hidden="true">
      Aa 夜
    </span>
  )
}

const PresetChoice = (props: { group: ThemeKey; option: PresetOption; current: string }) => (
  <label class="preset">
    <input
      type="radio"
      name={props.group}
      value={props.option.key}
      checked={props.current === props.option.key}
    />
    <span class="preset__box">
      <PresetPreview group={props.group} option={props.option.key} />
      <span class="preset__label">{props.option.label}</span>
      <span class="preset__note">{props.option.note}</span>
    </span>
  </label>
)

const AppearancePage = (props: {
  account: string
  theme: Theme
  flash?: string | null
  error?: string
}) => (
  <AdminLayout title="見た目" active="appearance" account={props.account} flash={props.flash}>
    <div class="admin-head">
      <div class="admin-head__title">
        <span class="crumbs">サイト全体</span>
        <h1>見た目</h1>
      </div>
      <a class="btn btn--ghost" href="/" target="_blank" rel="noreferrer">
        サイトを見る ↗
      </a>
    </div>

    {props.error ? <p class="banner banner--error">{props.error}</p> : null}

    {/* 選んだ色と書体は、この中の「選択中」の印にもそのまま効く */}
    <form
      method="post"
      action="/admin/appearance"
      class="form"
      data-accent={props.theme.accent}
      data-typeface={props.theme.typeface}
    >
      {THEME_GROUPS.map((group) => (
        <fieldset class="presets" key={group.key}>
          <legend class="presets__legend">
            {group.label}
            <span class="presets__note">{group.note}</span>
          </legend>
          <div class="presets__grid">
            {THEME_CHOICES[group.key].map((option) => (
              <PresetChoice
                key={option.key}
                group={group.key}
                option={option}
                current={props.theme[group.key]}
              />
            ))}
          </div>
        </fieldset>
      ))}

      <FormActions cancelHref="/admin/appearance" />
    </form>
  </AdminLayout>
)

app.get('/appearance', async (c) => {
  const theme = await loadTheme(db(c))
  return c.html(
    <AppearancePage
      account={c.get('account')}
      theme={theme}
      flash={c.req.query('saved') ? '保存しました' : null}
    />,
  )
})

app.post('/appearance', async (c) => {
  const form = await c.req.formData()
  const picked: Partial<Record<ThemeKey, string>> = {}
  for (const key of THEME_KEYS) picked[key] = str(form.get(key))

  /*
    知らない値は受け取らない。CSS に無いものを保存すると、管理画面では
    選ばれているのにサイトは既定のまま、という食い違いが残る。
  */
  if (THEME_KEYS.some((key) => !isThemeValue(key, picked[key] ?? ''))) {
    return c.html(
      <AppearancePage
        account={c.get('account')}
        theme={await loadTheme(db(c))}
        error="選べない見た目です。もう一度選び直してください"
      />,
      400,
    )
  }

  await saveTheme(db(c), normalizeTheme(picked))
  return c.redirect('/admin/appearance?saved=1', 303)
})

/* ------------------------------------------------------------- アカウント */

/*
  ログインに使えるアカウントの一覧と、「すべての端末からログアウト」。

  紐づけも外しもここからはしない。紐づくのは OWNER_… と一致するアカウントで
  初めてログインしたときだけで、外すのは D1 の行を消す（README）。画面から
  外せると、セッションを盗んだ人が持ち主のアカウントを外して締め出せる。
*/
app.get('/account', async (c) => {
  const identities = await db(c)
    .select()
    .from(schema.userIdentities)
    .where(eq(schema.userIdentities.userId, c.get('user').id))
    .orderBy(asc(schema.userIdentities.provider), asc(schema.userIdentities.id))
  const unlinked = PROVIDER_KEYS.filter(
    (provider) => !identities.some((identity) => identity.provider === provider),
  )

  return c.html(
    <AdminLayout title="アカウント" active="account" account={c.get('account')}>
      <div class="admin-head">
        <h1>アカウント</h1>
      </div>
      <p class="form-note">
        この管理画面に入れるアカウントです。どれでログインしても、同じ管理画面に入ります。
      </p>
      <ul class="rows">
        {identities.map((identity) => (
          <li class="row" key={identity.id}>
            <span class="row__main">
              <strong>{PROVIDER_LABEL[identity.provider]}</strong>
              <span class="row__sub">{identity.label}</span>
            </span>
            <span class="row__col">最後のログイン {timeInJapan(identity.lastLoginAt)}</span>
          </li>
        ))}
      </ul>
      {unlinked.map((provider) => (
        <p class="form-note" key={provider}>
          {PROVIDER_LABEL[provider]} はまだ紐づいていません。
          {provider === 'github'
            ? 'OWNER_GITHUB_ID と同じ ID の GitHub アカウントで一度ログインすると紐づきます。'
            : 'OWNER_GOOGLE_EMAIL と同じ、Google が確認済みのアドレスで一度ログインすると紐づきます。'}
        </p>
      ))}
      <section class="catalog">
        <h2 class="catalog__title">すべての端末からログアウト</h2>
        <p class="catalog__note">
          この端末も含めて、ログインしている端末をすべてログアウトします。端末を失くした・共用の端末でログアウトし忘れたときに使います。
        </p>
        <form method="post" action="/admin/account/logout-all">
          <button class="btn btn--danger" type="submit">
            すべての端末からログアウト
          </button>
        </form>
      </section>
    </AdminLayout>,
  )
})

app.post('/account/logout-all', async (c) => {
  await destroyUserSessions(db(c), c.get('user').id)
  deleteCookie(c, SESSION_COOKIE, { path: '/', secure: isHttps(c) })
  return c.redirect('/admin/login?out=all', 303)
})

adminRoutes.route('/', app)
