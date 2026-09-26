import { and, asc, count, eq, inArray, lt, ne, type SQL, sql } from 'drizzle-orm'
import type { BatchItem } from 'drizzle-orm/batch'
import { drizzle } from 'drizzle-orm/d1'
import type { Context } from 'hono'
import { Hono } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import { createMiddleware } from 'hono/factory'
import type { Child } from 'hono/jsx'
import {
  BLOCK_TYPES,
  type BlockType,
  blockPerScreen,
  blockType,
  blockUnitCount,
  blockValueErrors,
  isBlockKey,
  MAX_CHARS,
  MAX_STATEMENT_SENTENCE,
  memberScreenCount,
  publishErrors,
} from '../blocks'
import {
  countPublishedItems,
  defaultBlocks,
  ensureBlocks,
  findBlock,
  initBlocks,
  itemOrder,
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
  halfWidthDigits,
  int,
  isHttpsUrl,
  isSafeUrl,
  parseTags,
  str,
  timeInJapan,
  toSlug,
  yearFrom,
} from '../lib/format'
import { IMAGE_ACCEPT, IMAGE_LABELS, type SniffedImage, sniffImage } from '../lib/image'
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
import { touchSiteOnWrite } from '../lib/page-cache'
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
    以前は new URL('null') が例外を投げて 500 になっていた。このサイトのページは
    Referrer-Policy: strict-origin-when-cross-origin（src/index.tsx）なので、自分の
    フォームからの POST が null になることは無い——no-referrer に変えると、全部ここで止まる
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
  /*
    slug を変えた保存。前の URL が切れていないことまで言う——言わないと、
    名刺や SNS に貼った URL を直しに行くことになる（src/db/schema.ts の
    item_slug_redirects）
  */
  const moved = c.req.query('moved') ? '。前の URL は、新しい URL へ転送します' : ''
  if (saved === 'draft') return `下書きで保存しました。サイトにはまだ出ていません${moved}`
  if (saved) return `保存しました${moved}`
  return c.req.query('deleted') ? deleted : null
}

/*
  追加のフォームの一度きりの札（src/db/schema.ts の form_key の注記）。

  フォームを描くときに1枚作って hidden で持ち回し、行と一緒に書く。同じ札で
  同じ中身（題・名前…）の2度目の送信は、検査より先に「もう保存してある」と見て、
  書かずに一覧へ送る（英字の題の作品を2度押すと、2度目が「この slug は既に
  使われています」の 400 になり、保存できたのに失敗したように見えていた）。
  検査に当たって描き直すときも同じ札を持ち回す。

  同じ札で中身が違うのは、ブラウザの「戻る」で開き直した追加のフォームから、
  別のものを書いて送ったとき。それは2度押しではないので、新しい札で書く
  （黙って捨てて「保存しました」と言わない）。

  受け取るのはこちらが作った形（16進 16 字）だけ。手で組んだ POST の任意の
  文字列を unique の列に入れない。札の無い送信は今までどおり書く（札は重複を
  止めるためのもので、書いてよいかの判断には使わない）。
*/
const newFormKey = () => newToken(8)

function formKeyOf(form: FormData): string | null {
  const key = str(form.get('formKey'))
  return /^[0-9a-f]{16}$/.test(key) ? key : null
}

const FormKey = ({ value }: { value?: string | null }) =>
  value ? <input type="hidden" name="formKey" value={value} /> : null

/*
  書き込みが unique のどの列に当たって止まったか（列は「表.列」で渡す）。
  drizzle は D1 の例外を cause に包んで投げ直すので、原因をたどって見る。
  同時に来た2本の送信が、検査を両方すり抜けて DB の制約で止まったときに、
  500 ではなく検査と同じ答え（400・保存済み）に戻すために使う。
*/
function uniqueViolation(error: unknown, column: string): boolean {
  let current: unknown = error
  while (current instanceof Error) {
    if (current.message.includes('UNIQUE constraint failed') && current.message.includes(column)) {
      return true
    }
    current = current.cause
  }
  return false
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
  /*
    保存は止めないが、書いた人に知らせたいこと（作品の年が並びに使われない、など）。
    エラーとは色を分ける——赤で出すと「保存できなかった」と読まれる
  */
  warning?: string
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
    {props.warning ? <span class="field__warn">{props.warning}</span> : null}
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
  error?: string
}) => (
  <label class="field">
    <span class="field__label">{props.label}</span>
    <select class={props.error ? 'input input--error' : 'input'} name={props.name}>
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
    {props.error ? <span class="field__error">{props.error}</span> : null}
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
// 書き込みのたびに公開ページの写しの版を上げる（壁の内側なので、ログインした POST だけ）
app.use('*', touchSiteOnWrite)

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
  // 追加のフォームの一度きりの札（newFormKey）。編集では持たない
  formKey?: string | null
  errors?: Record<string, string>
  values?: Record<string, string>
}) => {
  const member = props.member
  const value = (key: keyof schema.Member, fallback = '') =>
    props.values?.[key] ?? (member ? String(member[key] ?? '') : fallback)
  /*
    入力エラーで描き直すときは、送られた「公開する」をそのまま返す（項目・
    ブロックのフォームと同じ）。DB の値に戻していたころは、公開を外して保存し、
    slug の重なりで弾かれて直すと、描き直しで付いた「公開する」がそのまま
    送られて、引っ込めたはずのページが公開のまま残った
  */
  const published = props.values ? Number(props.values.published === '1') : (member?.published ?? 0)

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
        <FormKey value={props.formKey} />
        <div class="form-grid">
          <Field
            label="氏名"
            name="name"
            value={value('name')}
            required
            error={props.errors?.name}
          />
          {/*
            変えてよい。前の URL は新しい URL へ 301 で送る（member_slug_redirects）。
            それを書く前に言っておく——言わないと、変えた人は貼った先を全部
            直しに行くか、変えるのをあきらめる
          */}
          <Field
            label="slug"
            name="slug"
            value={value('slug')}
            error={props.errors?.slug}
            hint={
              member
                ? '/members/<slug> になる。変えると、前の URL は新しい URL へ転送する。空にしたときはいまのまま'
                : '/members/<slug> になる。空なら氏名から作る'
            }
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
            error={props.errors?.sortOrder}
            hint="小さいほど先。10刻み"
          />
          {/*
            個人ページは柱も Contact もサイトのものを使う。この人の行き先が出るのは、
            サイトの行き先と違うときの1枚目だけ（同じ行き先を2つ置かない）
          */}
          {/*
            https:// で始まる URL だけを受ける（memberErrors）。type=url でも
            ブラウザは javascript: や http: を通すので、決めるのはサーバー側
          */}
          <Field
            label="GitHub URL"
            name="github"
            type="url"
            value={value('github')}
            placeholder="https://github.com/…"
            error={props.errors?.github}
            hint="https:// から。サイトの GitHub と違うときだけ、個人ページの1枚目に出る"
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
            <input
              class={props.errors?.avatar ? 'input input--file input--error' : 'input input--file'}
              type="file"
              name="avatar"
              accept={IMAGE_ACCEPT}
            />
            {props.errors?.avatar ? <span class="field__error">{props.errors.avatar}</span> : null}
            <span class="field__hint">
              {member?.avatarUrl
                ? `選ぶと差し替わる。空なら今のまま · ${IMAGE_LABELS}（1MB まで）`
                : `${IMAGE_LABELS}（1MB まで）。未設定なら頭文字を出す`}
            </span>
          </label>
        </div>

        <div class="form-foot">
          <PublishToggle published={published} />
          <FormActions
            cancelHref="/admin/members"
            deleteHref={member ? `/admin/members/${member.id}/delete?from=edit` : undefined}
          />
        </div>
      </form>
    </AdminLayout>
  )
}

app.get('/members/new', (c) =>
  c.html(<MemberForm account={c.get('account')} formKey={newFormKey()} />),
)

app.get('/members/:id/edit', async (c) => {
  const member = await db(c).query.members.findFirst({
    where: eq(schema.members.id, Number(c.req.param('id'))),
  })
  if (!member) return c.notFound()
  return c.html(<MemberForm account={c.get('account')} member={member} />)
})

/*
  並び順の欄。空なら編集ではいまの値、追加では既定の 10（フォームが初めに出す数）。
  数として読めなければ、黙って別の数に倒さず 400 で欄を示す（src/lib/format.ts の
  int）。返す text は描き直し用——打った字をそのまま返す。
*/
const SORT_ORDER_ERROR = '並び順は数字で入れてください（例: 10）'

function readSortOrder(form: FormData, current: number | undefined) {
  const text = str(form.get('sortOrder'))
  const value = text ? int(text) : (current ?? 10)
  return {
    text,
    value: value ?? current ?? 10,
    error: value === null ? { sortOrder: SORT_ORDER_ERROR } : null,
  }
}

/*
  slug の欄の読み方。メンバーと作品で同じ。

  **欄が空なら、編集ではいまの slug のまま。** 以前は空にすると名前から作り直し、
  日本語だけの名前では乱数になって、貼られていた前の URL がその日から 404 に
  なった（「空にすれば作り直される」と思って消すのは、ごく自然な操作）。
  作り直すのは、まだ slug を持たない行（追加と、slug の列より前からある作品）だけ。
  打った slug が英数字を1つも含まない（toSlug が空を返す）ときも空と同じ扱い。
*/
const readSlug = (typed: string, current: string | null | undefined, name: string) =>
  toSlug(typed) || current || toSlug(name) || null

async function readMemberForm(c: Context<AppEnv>, existing?: schema.Member) {
  const form = await c.req.formData()
  const name = str(form.get('name'))
  const slug = readSlug(str(form.get('slug')), existing?.slug, name) ?? `member-${newToken(3)}`
  const sortOrder = readSortOrder(form, existing?.sortOrder)

  return {
    form,
    // 下書きでも止める、受け取れない値（並び順が数でない）
    errors: sortOrder.error,
    // 読めなかった並び順は、打ったままの字を欄へ返す（倒した数を見せない）
    typed: (sortOrder.error ? { sortOrder: sortOrder.text } : {}) as Record<string, string>,
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
      sortOrder: sortOrder.value,
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

  種類は中身の先頭のバイトで決める（src/lib/image.ts の sniffImage）。ブラウザが
  名乗る file.type は見ない——image/png を名乗った SVG を名乗りのまま保存して
  配ると、開いた人のブラウザがこのサイトのオリジンでスクリプトを走らせる。
  通すのは PNG・JPEG・WebP・AVIF・GIF だけで、SVG と HEIC は理由を添えて弾く。

  検査（pickImage）と書き込み（putImage）を分けてあるのは、作品のフォームが
  「画像があるか」を知ってから保存してよいかを決めるため（代替テキストの
  要否）。検査に通っただけの画像は、まだどこにも書いていない——弾かれた
  保存で KV に孤児の画像を残さない。

  戻り値で「選ばれていない」と「弾いた」を区別する。同じ null にすると、
  大きすぎる画像を選んだ人に「保存しました」と出てしまう。
*/
type ImageFolder = 'avatars' | 'items'
type PickedImage = SniffedImage & { bytes: ArrayBuffer }
type Picked = { image: PickedImage | null; error?: string }

const IMAGE_TYPE_ERROR = `${IMAGE_LABELS} の画像を選んでください（SVG と HEIC は受け付けません。iPhone の写真は JPEG で書き出してください）`

async function pickImage(form: FormData, field: string): Promise<Picked> {
  const file = form.get(field)
  if (!(file instanceof File) || file.size === 0) return { image: null }
  if (file.size > IMAGE_MAX_BYTES) {
    return { image: null, error: '画像は 1MB までです。小さくしてから選び直してください' }
  }
  const bytes = await file.arrayBuffer()
  const sniffed = sniffImage(new Uint8Array(bytes))
  if (!sniffed) return { image: null, error: IMAGE_TYPE_ERROR }
  return { image: { ...sniffed, bytes } }
}

/*
  キーは /images/ 側の検査（src/routes/public.tsx の IMAGE_KEY——置き場の
  名前 / 英数字で始まり英数字と . _ - だけ）を必ず通る形にする。name は
  slug から作るので toSlug を通す（空なら置き場ごとの控えの名前）。
  拡張子と content-type は判定の結果から付ける（名乗りを KV に入れない）。
*/
async function putImage(kv: KVNamespace, image: PickedImage, folder: ImageFolder, name: string) {
  const fallback = folder === 'avatars' ? 'member' : 'item'
  const key = `${folder}/${toSlug(name) || fallback}-${newToken(4)}.${image.extension}`
  await kv.put(key, image.bytes, { metadata: { contentType: image.type } })
  return `/images/${key}`
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
  KV と D1 は1つのトランザクションにできない。だから順序で守る。

  1. 新しい画像を KV に置く（putImage）
  2. D1 を書く（write）。ここで落ちたら、1 で置いた画像を消してから投げ直す
     ——どの行からも指されない画像を KV に残さない
  3. D1 が通ってから、使われなくなった前の画像を消す（呼ぶ側。removeImage）

  逆（D1 を先に書いて、あとで KV に置く）にすると、KV で落ちたときに D1 が
  無い画像を指したまま残り、公開ページに壊れた画像が出る。前の画像を D1 より
  先に消しても同じことが起きる。

  片付けの失敗は元の失敗を隠さない（記録だけ残して、元の例外を投げる）。
*/
async function commitWithImage<T>(
  kv: KVNamespace,
  placed: string | null,
  write: () => Promise<T>,
): Promise<T> {
  try {
    return await write()
  } catch (error) {
    if (placed) await removeImage(kv, placed).catch((cleanup) => console.error(cleanup))
    throw error
  }
}

/*
  選んだ画像を受け取らずに戻すときの知らせ。ブラウザはファイルの欄を描き直せ
  ないので、何も言わないと「選んだ画像も保存された」と読める。保存を止めた
  ときは KV にも書いていない（putImage は検査が全部通ってから）。
  アバターと作品の画像で同じ（field が欄の名前）。
*/
const imageNotKept = (form: FormData, field: string, errors: Record<string, string>) => {
  const file = form.get(field)
  if (errors[field] || !(file instanceof File) || file.size === 0) return errors
  return {
    ...errors,
    [field]: '画像はまだ保存していません。直したあとで、もう一度選んでください',
  }
}

/*
  メンバーの、下書きでも止める値（受け取れない値）。氏名が空・通らない GitHub。

  紹介文の長さはここでは見ない。公開するときにだけ見る（src/blocks.ts の
  publishErrors）——下書きの保存でも見ていたころは、上限より前に保存された
  長い紹介文の人が「公開を外すことすらできない」行き止まりになっていた。
*/
function memberErrors(values: {
  name: string
  github: string | null
}): Record<string, string> | null {
  if (!values.name) return { name: '氏名は必須です' }
  const errors: Record<string, string> = {}
  /*
    GitHub は https:// で始まる絶対 URL だけ。公開ページも同じ検査（isHttpsUrl）で
    落とすので、ここで通さないと「保存できたのにサイトに出ない」になる。
    「github.com/…」のように頭を省くと相対 URL になって 404、javascript: は
    公開ページの href に載る。下書きでも見る——長さではなく、受け取れない値
  */
  if (values.github && !isHttpsUrl(values.github)) {
    errors.github = 'https:// で始まる URL を入れてください（例: https://github.com/…）'
  }
  return Object.keys(errors).length ? errors : null
}

// 入力エラーで描き直すとき、打った内容をそのまま返すための変換
function asValues(values: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(values).map(([key, value]) => [key, String(value ?? '')]),
  )
}

/*
  slug が重なったら弾く。いまの slug に加えて、ほかの行の前の slug
  （転送表に残っているもの）も使わせない——使わせると、その前の URL を
  貼っていた人のリンクが黙って別の人・別の作品を指す（404 より悪い）。
  自分の前の slug へ戻すのは通す（転送の行は、保存の batch の中で消える）。

  黙って番号を足して通さないのは、そうすると「保存した順」で URL が決まって
  しまうため。恒久リンクは1つの URL が1つの行を指すことに全部が懸かって
  いるので、重なりは人に直してもらう。
*/
const SLUG_TAKEN = 'この slug は既に使われています'
const SLUG_MOVED = (whose: string) =>
  `この slug は、${whose}の前の URL として転送に使っています。使うと、貼られた前の URL が行き先を変えます`

async function memberSlugTaken(
  database: ReturnType<typeof db>,
  slug: string,
  exceptId: number | null,
): Promise<Record<string, string> | null> {
  const [live, moved] = await Promise.all([
    database.query.members.findFirst({
      where: exceptId
        ? and(eq(schema.members.slug, slug), ne(schema.members.id, exceptId))
        : eq(schema.members.slug, slug),
    }),
    database.query.memberSlugRedirects.findFirst({
      where: exceptId
        ? and(
            eq(schema.memberSlugRedirects.oldSlug, slug),
            ne(schema.memberSlugRedirects.memberId, exceptId),
          )
        : eq(schema.memberSlugRedirects.oldSlug, slug),
    }),
  ])
  if (live) return { slug: SLUG_TAKEN }
  if (moved) return { slug: SLUG_MOVED('別のメンバー') }
  return null
}

/*
  slug を変えた保存に足す2文（src/db/schema.ts の member_slug_redirects）。
  前の slug を転送表に残し、新しい slug が自分の前の slug だったなら、その行を
  消す（いまの slug と転送が同じ URL を指さない）。行の書き換えと同じ batch に
  入れる——別々に書くと、行は変わったのに転送が無い、が途中で止まったときに残る。
*/
function memberSlugMoves(
  database: ReturnType<typeof db>,
  id: number,
  before: string,
  after: string,
): BatchItem<'sqlite'>[] {
  if (before === after) return []
  return [
    database
      .delete(schema.memberSlugRedirects)
      .where(eq(schema.memberSlugRedirects.oldSlug, after)),
    database
      .insert(schema.memberSlugRedirects)
      .values({ oldSlug: before, memberId: id })
      .onConflictDoUpdate({ target: schema.memberSlugRedirects.oldSlug, set: { memberId: id } }),
  ]
}

app.post('/members', async (c) => {
  const database = db(c)
  const { form, values, errors: unreadable, typed } = await readMemberForm(c)
  const account = c.get('account')
  const sent = formKeyOf(form)
  const saved = () => c.redirect(`/admin/members?saved=${savedParam(values.published)}`, 303)
  // 同じフォームの2度目の送信。1度目がもう書いている（newFormKey の注記）
  const twin = sent
    ? await database.query.members.findFirst({ where: eq(schema.members.formKey, sent) })
    : undefined
  if (twin?.name === values.name) return saved()
  const formKey = twin ? newFormKey() : sent
  const back = (errors: Record<string, string>) =>
    c.html(
      <MemberForm
        account={account}
        formKey={formKey}
        errors={imageNotKept(form, 'avatar', errors)}
        values={{ ...asValues(values), ...typed }}
      />,
      400,
    )

  const picked = await pickImage(form, 'avatar')
  const errors = mergeErrors(
    picked.error ? { avatar: picked.error } : null,
    unreadable,
    memberErrors(values),
    values.published ? publishErrors({ kind: 'member', bio: values.bio }) : null,
    await memberSlugTaken(database, values.slug, null),
  )
  if (errors) return back(errors)

  // 検査が全部通ってから KV に置き、D1 が落ちたら置いた画像を消す（commitWithImage）
  const avatarUrl = picked.image
    ? await putImage(c.env.MEDIA, picked.image, 'avatars', values.slug)
    : null
  try {
    await commitWithImage(c.env.MEDIA, avatarUrl, () =>
      database.insert(schema.members).values({ ...values, avatarUrl, formKey }),
    )
  } catch (error) {
    // 検査のあとに同じ札・同じ slug が先に書かれた（同時に来た2本の送信）
    if (uniqueViolation(error, 'members.form_key')) return saved()
    if (uniqueViolation(error, 'members.slug')) return back({ slug: SLUG_TAKEN })
    throw error
  }
  return saved()
})

app.post('/members/:id', async (c) => {
  const id = parseId(c.req.param('id'))
  if (!id) return c.notFound()
  const database = db(c)
  const member = await database.query.members.findFirst({ where: eq(schema.members.id, id) })
  if (!member) return c.notFound()

  const { form, values, errors: unreadable, typed } = await readMemberForm(c, member)
  const account = c.get('account')
  const back = (errors: Record<string, string>) =>
    c.html(
      <MemberForm
        account={account}
        member={member}
        errors={imageNotKept(form, 'avatar', errors)}
        values={{ ...asValues(values), ...typed }}
      />,
      400,
    )

  const picked = await pickImage(form, 'avatar')
  const errors = mergeErrors(
    picked.error ? { avatar: picked.error } : null,
    unreadable,
    memberErrors(values),
    values.published ? publishErrors({ kind: 'member', bio: values.bio }) : null,
    await memberSlugTaken(database, values.slug, id),
  )
  if (errors) return back(errors)

  // 新しい画像を置く → D1 → 通ってから前の画像を消す（commitWithImage の順序）
  const avatarUrl = picked.image
    ? await putImage(c.env.MEDIA, picked.image, 'avatars', values.slug)
    : null
  const update = database
    .update(schema.members)
    .set({ ...values, ...(avatarUrl ? { avatarUrl } : {}) })
    .where(eq(schema.members.id, id))
  try {
    await commitWithImage(c.env.MEDIA, avatarUrl, () =>
      database.batch([update, ...memberSlugMoves(database, id, member.slug, values.slug)]),
    )
  } catch (error) {
    if (uniqueViolation(error, 'members.slug')) return back({ slug: SLUG_TAKEN })
    throw error
  }
  if (avatarUrl) await removeImage(c.env.MEDIA, member.avatarUrl)
  const moved = member.slug !== values.slug ? '&moved=1' : ''
  return c.redirect(`/admin/members?saved=${savedParam(values.published)}${moved}`, 303)
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
  /*
    並びは公開ページと同じ（年の新しい順 → 並び順 → 作った順。queries.ts の
    itemOrder）。並び順だけで並べていたころは、ここで先頭に見えている作品が
    公開ページでは年に負けて後ろにいて、公開の並びをどこでも確かめられなかった
  */
  const rows = await db(c).query.items.findMany({
    where: eq(schema.items.type, type),
    orderBy: itemOrder,
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

      {/*
        タブは入力欄の違い（プラットフォーム / 業界と実績値）で分けているだけで、
        公開ページでは1つの一覧。並びの規則を1文で言っておく
      */}
      <p class="form-note">
        公開ページでは{typeLabel('app')}と{typeLabel('work')}を1つの一覧に混ぜ、年の新しい順 →
        並び順（区分をまたいで比べる）→ 作った順に並べます。ここもその順です。
      </p>

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
  // 追加のフォームの一度きりの札（newFormKey）。編集では持たない
  formKey?: string | null
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
  /*
    リンクの欄は、公開できる本数（MAX_CHARS.itemLinks）ぶんを空けて出す。
    それより多く持っている作品（上限より前に保存したもの）は全部の行を出す
    ——3行で切っていたころは、4本目から先が欄に出ないまま、保存の総入れ替えで
    黙って消えた
  */
  const blank = { label: '', url: '' }
  const links = [
    ...d.links,
    ...Array.from({ length: Math.max(0, MAX_CHARS.itemLinks - d.links.length) }, () => blank),
  ]
  // 年の欄の頭が数字4桁でなければ、並びに使われない（保存は止めない）
  const unordered = d.year !== '' && yearFrom(d.year) === null

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
        <FormKey value={props.formKey} />
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
            別の作品を指すので、貼るならこちら。変えてよい——前の URL は新しい
            URL へ 301 で送る（item_slug_redirects）。それを書く前に言っておく
          */}
          <Field
            label="slug"
            name="slug"
            value={d.slug}
            error={props.errors?.slug}
            hint={
              item?.slug
                ? `${itemHref({ type: props.type, slug: '<slug>' })} になる。変えると、前の URL は新しい URL へ転送する。空にしたときはいまのまま`
                : `${itemHref({ type: props.type, slug: '<slug>' })} になる。空なら作品名から作る（日本語だけの題からは作れないので自動生成になる）`
            }
          />
          <Select
            label="担当メンバー"
            name="memberId"
            value={d.memberId}
            error={props.errors?.memberId}
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
              error={props.errors?.platformKey}
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
            （新しい順）は頭の数字4桁だけで決まる（items.year_from。DB が year から
            作る列で、知らせは同じ規則の src/lib/format.ts の yearFrom）ので、
            「2024 — 現在」でも 2024 として並ぶ。

            頭が数字4桁でない年（「令和6」「FY2024」）は保存を止めない（表示の
            書き方は自由）が、並びに使われないことをその場で言う——言わないと、
            一覧の最後に回った理由がどこにも見えない
          */}
          <Field
            label="年"
            name="year"
            value={d.year}
            placeholder="2026 / 2024 — 現在"
            warning={
              unordered
                ? '頭が数字4桁ではないので、並びに使われません（一覧では年の無い作品と一緒に最後に並びます）'
                : undefined
            }
            hint="終わったものは「2026」、続いているものは「2024 — 現在」。一覧は頭の数字4桁で新しい順に並ぶ"
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
              「です・ます」。作品のページの1枚目（説明）から「くわしく読む →」で
              次の画面（本文）へ続けて読まれるので、文体で目録と本文を分ける
              （CLAUDE.md「文言」）
            */
            hint={`「何であるか。何をしたか。」の2文を常体で（〜する。〜した。）· ${MAX_CHARS.itemSummary} 字まで（電話の幅のカードは2行で、${MAX_CHARS.itemSummaryVisible} 字までしか出ません）`}
            maxlength={MAX_CHARS.itemSummary}
            error={props.errors?.summary}
          />
          {/*
            本文は作品のページの2枚目（本文の画面 Story。/apps/item/<slug>/story）に
            だけ出る（カードにも1枚目にも出ない。1枚目には「くわしく読む →」の入口が
            出る）。上限は本文の画面1枚に収まる数（割らない。数と測り方は
            src/blocks.ts）。空なら本文の画面は作らない。
            「空行で段落を分ける」は段落を2つ以上置けるときだけ言う——1段落まで
            のときに言うと、言われたとおりに分けた人が保存で止められる
          */}
          <Area
            label="本文"
            name="body"
            value={d.body}
            rows={6}
            hint={`背景・やったこと・結果を「です・ます」で。${MAX_CHARS.itemBodyParagraphs > 1 ? '空行で段落を分ける' : '空行を入れずに1段落で'} · ${MAX_CHARS.itemBody} 字・${MAX_CHARS.itemBodyParagraphs} 段落まで（作品のページの次の画面「Story」に出る。空なら画面を作らない。カードには出ない）`}
            maxlength={MAX_CHARS.itemBody}
            error={props.errors?.body}
          />
          <label class="field">
            <span class="field__label">画像</span>
            <input
              class={props.errors?.image ? 'input input--file input--error' : 'input input--file'}
              type="file"
              name="image"
              accept={IMAGE_ACCEPT}
            />
            {props.errors?.image ? <span class="field__error">{props.errors.image}</span> : null}
            <span class="field__hint">
              {item?.imageUrl
                ? `選ぶと差し替わる。空なら今のまま · ${IMAGE_LABELS}（1MB まで）`
                : `スクリーンショット。${IMAGE_LABELS}（1MB まで） · 作品のページと、600px 以上の一覧のカードに出る。横長なら共有カードも大きく出る`}
            </span>
          </label>
          {/*
            代替テキストは画像そのものと別の欄。作品のページではこの画像が作品の
            見た目を伝える唯一の手段なので、画像を公開するなら空にできない
            （公開の関門 publishErrors）。下書きでは空のまま保存できる
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
          <Field
            label="タグ"
            name="tags"
            value={d.tags}
            error={props.errors?.tags}
            hint={`カンマ区切り · 公開は ${MAX_CHARS.itemTags} つまで（作品のページの1画面に収まる数）`}
          />
          {/*
            並びは年が先に効き、同じ年の中でこの数。個人開発と業務は公開ページで
            1つの一覧に混ざるので、この数も区分をまたいで比べる（queries.ts の
            itemOrder）。「小さいほど先」とだけ書いていたころは、1 を付けても年が
            古い作品は後ろのままで、理由が分からなかった
          */}
          <Field
            label="並び順"
            name="sortOrder"
            value={d.sortOrder}
            error={props.errors?.sortOrder}
            hint="同じ年の中で、小さいほど先。個人開発と業務をまたいで比べる（同じ数なら先に作ったほう）。10刻み"
          />

          {/*
            行ごとの検査は readLinks。知らせは何行目かで言うので、行の順は
            送った順のまま描き直す（submittedItem）
          */}
          <fieldset class="field field--wide fieldset">
            <legend class="field__label">リンク</legend>
            {links.map((link, index) => {
              // 弾いたあとの描き直しでだけ、通らなかった行に印を付ける
              const bad = props.errors?.links ? linkProblem(link.label, link.url) : null
              return (
                <div class="link-row" key={index}>
                  <input
                    class={bad ? 'input input--error' : 'input'}
                    type="text"
                    name="linkLabel"
                    value={link.label}
                    placeholder="Repository"
                  />
                  <input
                    class={bad ? 'input input--error' : 'input'}
                    type="url"
                    name="linkUrl"
                    value={link.url}
                    placeholder="https://"
                  />
                </div>
              )
            })}
            {props.errors?.links ? <span class="field__error">{props.errors.links}</span> : null}
            <span class="field__hint">
              ラベルと URL は両方入れる。URL は https:// か mailto: か / から · 公開は{' '}
              {MAX_CHARS.itemLinks} 本まで
            </span>
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
    <ItemForm
      account={c.get('account')}
      type={type}
      members={members}
      platforms={platforms}
      formKey={newFormKey()}
    />,
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

/*
  フォームの値を行の形にする。読めなかった値は errors に入れて返す
  （下書きでも止める、受け取れない値）。

  担当メンバーとプラットフォームは、フォームを描いたときの選択肢（formContext）に
  在るものだけを受ける。別のタブでメンバーを消したあとで、古いフォームのまま
  保存すると、以前は外部キーで 500 になり、打った内容も消えていた。いまは
  選び直してもらう（400。打った内容は残す）。
*/
function readItemForm(
  form: FormData,
  context: { members: schema.Member[]; platforms: schema.Platform[] },
  existing?: schema.Item,
) {
  const type = str(form.get('type')) === 'work' ? ('work' as const) : ('app' as const)
  const title = str(form.get('title'))
  // 全角の数字は半角に直す。並べるための年（year_from）は DB がこの字から作る
  const year = halfWidthDigits(str(form.get('year')))
  const sortOrder = readSortOrder(form, existing?.sortOrder)
  const errors: Record<string, string> = { ...sortOrder.error }

  const memberText = str(form.get('memberId'))
  const memberId = memberText ? int(memberText) : null
  if (memberText && !context.members.some((member) => member.id === memberId)) {
    errors.memberId =
      '担当メンバーが見つかりません（削除された可能性があります）。選び直してください'
  }
  const platformKey = type === 'app' ? str(form.get('platformKey')) : ''
  if (platformKey && !context.platforms.some((platform) => platform.key === platformKey)) {
    errors.platformKey = 'プラットフォームが見つかりません。選び直してください'
  }

  return {
    errors: Object.keys(errors).length ? errors : null,
    tags: parseTags(str(form.get('tags'))),
    values: {
      type,
      memberId,
      platformKey: platformKey || null,
      category: type === 'work' ? str(form.get('category')) : '',
      title,
      /*
        恒久リンクの3語目（readSlug）。空なら、編集ではいまの slug のまま、まだ
        持たない行では作品名から作る。

        題が日本語だけだと toSlug は空を返すので、そのときは読めない代わりに
        重ならない名前にする。空のまま保存させないのは、恒久リンクの無い作品を
        作らないため——この列より前からある行だけが「まだ無い」側で、
        ここを通った行は必ず名指しできる。
      */
      slug: readSlug(str(form.get('slug')), existing?.slug, title) ?? `item-${newToken(3)}`,
      year,
      summary: str(form.get('summary')),
      body: str(form.get('body')),
      imageAlt: str(form.get('imageAlt')),
      metricValue: str(form.get('metricValue')) || null,
      metricUnit: str(form.get('metricUnit')) || null,
      metricNote: str(form.get('metricNote')) || null,
      sortOrder: sortOrder.value,
      published: bool(form.get('published')),
      updatedAt: new Date().toISOString(),
    },
  }
}

/*
  作品の、下書きでも止める値。いまは題だけ（空の題の作品は一覧でも名指しできない）。

  説明文・本文の長さ、タグの数・リンクの本数、画像の代替テキストは、公開する
  ときにだけ見る（src/blocks.ts の publishErrors）。見ると、上限より前に保存された
  長い中身を持つ作品が「公開を外すことすらできない」行き止まりになる
  （CLAUDE.md「下書きに戻す保存では長さを見ない」）。
*/
function itemValueErrors(values: { title: string }): Record<string, string> | null {
  return values.title ? null : { title: 'タイトルは必須です' }
}

// slug の重なり。いまの slug と、ほかの作品の前の slug（memberSlugTaken と同じ規則）
async function itemSlugTaken(
  database: ReturnType<typeof db>,
  slug: string,
  exceptId: number | null,
): Promise<Record<string, string> | null> {
  const [live, moved] = await Promise.all([
    database.query.items.findFirst({
      where: exceptId
        ? and(eq(schema.items.slug, slug), ne(schema.items.id, exceptId))
        : eq(schema.items.slug, slug),
    }),
    database.query.itemSlugRedirects.findFirst({
      where: exceptId
        ? and(
            eq(schema.itemSlugRedirects.oldSlug, slug),
            ne(schema.itemSlugRedirects.itemId, exceptId),
          )
        : eq(schema.itemSlugRedirects.oldSlug, slug),
    }),
  ])
  if (live) return { slug: SLUG_TAKEN }
  if (moved) return { slug: SLUG_MOVED('別の作品') }
  return null
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

/*
  作品のリンク（行き先）。フォームはラベルと URL の欄を行ごとに並べて送る。

  1行ずつ見て、通らない行は保存させない（400 で何行目かを示す）。黙って落とすと、
  「保存しました」と出たのにサイトにリンクが無い、になる（CLAUDE.md「公開ページで
  落とす中身は、管理画面でも保存させない」）。

  - URL は isSafeUrl（https:// か http:// か mailto: か / で始まる）。公開ページの
    LinkRow も同じ検査で落とす。javascript: は同じオリジンの href に載り、
    頭を省いた「github.com/…」は相対 URL になって 404 になる
  - ラベルと URL は両方要る。片方だけの行は、以前は知らせなしに捨てていた
  - 両方空の行（フォームが用意した空き）は数えない

  下書きでも見る。長さではなく、受け取れない値なので（画像の種類と同じ）。
*/
type ItemLink = { label: string; url: string }

// 1行の検査。通らなければ「N 行目」に続ける言葉を返す（フォームも行の印に同じものを使う）
function linkProblem(label: string, url: string): string | null {
  if (!label && !url) return null
  if (!label || !url) return 'はラベルと URL の両方を入れてください'
  if (!isSafeUrl(url)) return 'の URL は https:// か mailto: か / で始めてください'
  return null
}

function readLinks(form: FormData): { links: ItemLink[]; error?: string } {
  const labels = form.getAll('linkLabel').map((value) => str(value))
  const urls = form.getAll('linkUrl').map((value) => str(value))
  const links: ItemLink[] = []
  const problems: string[] = []
  for (let index = 0; index < Math.max(labels.length, urls.length); index += 1) {
    const label = labels[index] ?? ''
    const url = urls[index] ?? ''
    const problem = linkProblem(label, url)
    if (problem) problems.push(`${index + 1} 行目${problem}`)
    else if (label && url) links.push({ label, url })
  }
  return problems.length ? { links, error: `${problems.join('。')}。` } : { links }
}

// 検査の結果を1つにまとめる。止める理由は全部返す（1つずつ返すと、直すたびに次が出る）
function mergeErrors(
  ...sets: (Record<string, string> | null | undefined)[]
): Record<string, string> | null {
  const all: Record<string, string> = Object.assign({}, ...sets.filter(Boolean))
  return Object.keys(all).length ? all : null
}

/*
  作品の保存は、行・タグ・リンク・転送表の書き込みを全部1つの batch に入れる
  （D1 の batch は1つのトランザクション。途中で落ちれば何も書かれない）。

  1本ずつ await していたころは、途中で止まると半分だけ書かれた。タグを 34 個
  付けて保存すると、D1 の束縛変数の上限（1文に 100 個）でタグの INSERT が落ち、
  その時点で前のタグとリンクはもう DELETE 済み——500 の画面の裏で、リポジトリや
  ストアのリンクまで消えていた。新しく作るときは作品の行だけが残り、送り直すと
  「この slug は既に使われています」で弾かれた（タグの無い作品は公開済み）。
  構成の並べ替え（queries.ts の reorderBlocks）が batch なのと同じ理由。

  新しく作るときは親の id がまだ無い。そこで子の行は親を slug で引く
  （INSERT … VALUES ((SELECT id FROM items WHERE slug = ?), …)）。slug は保存の前に
  決まっていて unique なので、同じ batch の中の先の INSERT が作った行を指せる。

  タグとリンクの総入れ替えはそのまま（差分を取るより、消して入れ直すほうが読める）。
  複数行の INSERT は、1文の束縛変数が D1 の上限（100）を超えないように分ける。
*/
const D1_MAX_VARIABLES = 100
// 1行ぶんの束縛変数の数（item_id か親を引く slug・残りの列）から、1文に入る行数
const rowsPerInsert = (variablesPerRow: number) => Math.floor(D1_MAX_VARIABLES / variablesPerRow)

function childWrites(
  database: ReturnType<typeof db>,
  // 既にある作品なら id、同じ batch で作る作品なら slug
  owner: number | string,
  tags: string[],
  links: ItemLink[],
): BatchItem<'sqlite'>[] {
  const itemId: number | SQL =
    typeof owner === 'number'
      ? owner
      : sql`(select ${schema.items.id} from ${schema.items} where ${schema.items.slug} = ${owner})`
  return [
    // 新しく作る作品には、消す子がまだ無い
    ...(typeof owner === 'number'
      ? [
          database.delete(schema.itemTags).where(eq(schema.itemTags.itemId, owner)),
          database.delete(schema.itemLinks).where(eq(schema.itemLinks.itemId, owner)),
        ]
      : []),
    // item_id・tag・sort_order
    ...chunk(
      tags.map((tag, index) => ({ itemId, tag, sortOrder: index })),
      rowsPerInsert(3),
    ).map((rows) => database.insert(schema.itemTags).values(rows)),
    // item_id・label・url・sort_order（id は自動なので変数を使わない）
    ...chunk(
      links.map((link, index) => ({ itemId, ...link, sortOrder: index })),
      rowsPerInsert(4),
    ).map((rows) => database.insert(schema.itemLinks).values(rows)),
  ]
}

// slug を変えた保存に足す2文。メンバーの memberSlugMoves と同じ（前の slug が無い行は何も残さない）
function itemSlugMoves(
  database: ReturnType<typeof db>,
  id: number,
  before: string | null,
  after: string,
): BatchItem<'sqlite'>[] {
  if (!before || before === after) return []
  return [
    database.delete(schema.itemSlugRedirects).where(eq(schema.itemSlugRedirects.oldSlug, after)),
    database
      .insert(schema.itemSlugRedirects)
      .values({ oldSlug: before, itemId: id })
      .onConflictDoUpdate({ target: schema.itemSlugRedirects.oldSlug, set: { itemId: id } }),
  ]
}

// 画像の列（URL と寸法）。寸法は読めたときだけ（src/db/schema.ts の imageWidth）
const imageColumns = (url: string | null, image: PickedImage | null) => ({
  imageUrl: url,
  imageWidth: image?.width ?? null,
  imageHeight: image?.height ?? null,
})

app.post('/items', async (c) => {
  const database = db(c)
  const form = await c.req.formData()
  const context = await formContext(c)
  const { values, tags, errors: unreadable } = readItemForm(form, context)
  const saved = () =>
    c.redirect(`/admin/items?type=${values.type}&saved=${savedParam(values.published)}`, 303)
  // 同じ札で書いた行（newFormKey の注記）
  const twinOf = (key: string | null) =>
    key
      ? database.query.items.findFirst({
          where: eq(schema.items.formKey, key),
          columns: { title: true, type: true },
        })
      : undefined
  const same = (row: { title: string; type: string } | undefined) =>
    row?.title === values.title && row.type === values.type
  // 同じフォームの2度目の送信。1度目がもう書いている
  const sent = formKeyOf(form)
  const twin = await twinOf(sent)
  if (same(twin)) return saved()
  const formKey = twin ? newFormKey() : sent

  const back = (errors: Record<string, string>) =>
    c.html(
      <ItemForm
        account={c.get('account')}
        type={values.type}
        members={context.members}
        platforms={context.platforms}
        formKey={formKey}
        submitted={submittedItem(form)}
        errors={imageNotKept(form, 'image', errors)}
      />,
      400,
    )

  // 画像の種類と大きさ、リンクの形は下書きでも見る。長さの話ではなく、受け取れない値
  const picked = await pickImage(form, 'image')
  const links = readLinks(form)
  const errors = mergeErrors(
    picked.error ? { image: picked.error } : null,
    links.error ? { links: links.error } : null,
    unreadable,
    itemValueErrors(values),
    values.published
      ? publishErrors({
          kind: 'item',
          summary: values.summary,
          body: values.body,
          imageAlt: values.imageAlt,
          hasImage: picked.image !== null,
          tags: tags.length,
          links: links.links.length,
        })
      : null,
    await itemSlugTaken(database, values.slug, null),
  )
  if (errors) return back(errors)

  // 検査が全部通ってから KV に置き、D1 が落ちたら置いた画像を消す（commitWithImage）
  const imageUrl = picked.image
    ? await putImage(c.env.MEDIA, picked.image, 'items', values.slug)
    : null
  try {
    await commitWithImage(c.env.MEDIA, imageUrl, () =>
      database.batch([
        database
          .insert(schema.items)
          .values({ ...values, ...imageColumns(imageUrl, picked.image), formKey }),
        ...childWrites(database, values.slug, tags, links.links),
      ]),
    )
  } catch (error) {
    /*
      検査のあとに同じ札か同じ slug が先に書かれた（同時に来た2本の送信）。
      同じ札の行があれば、それは1度目の送信——英字の題なら slug も同じなので、
      どちらの制約が先に当たっても「保存済み」に寄せる
    */
    if (uniqueViolation(error, 'items.')) {
      if (same(await twinOf(formKey))) return saved()
      if (uniqueViolation(error, 'items.slug')) return back({ slug: SLUG_TAKEN })
    }
    throw error
  }
  return saved()
})

app.post('/items/:id', async (c) => {
  const id = parseId(c.req.param('id'))
  if (!id) return c.notFound()
  const database = db(c)
  // 先に存在を確かめる。無い id のまま進むと、タグの差し替えが外部キーで
  // 落ちて 500 になるか、何も変わっていないのに「保存しました」と出る
  const existing = await database.query.items.findFirst({ where: eq(schema.items.id, id) })
  if (!existing) return c.notFound()

  const form = await c.req.formData()
  const context = await formContext(c)
  const { values, tags, errors: unreadable } = readItemForm(form, context, existing)
  const back = (errors: Record<string, string>) =>
    c.html(
      <ItemForm
        account={c.get('account')}
        type={values.type}
        members={context.members}
        platforms={context.platforms}
        item={{ ...existing, tags: [], links: [] }}
        submitted={submittedItem(form)}
        errors={imageNotKept(form, 'image', errors)}
      />,
      400,
    )

  const picked = await pickImage(form, 'image')
  const links = readLinks(form)
  /*
    保存したあとの画像。新しく選んだならそれ（差し替え）、「画像を外す」なら
    無し、どちらでもなければいまのまま。選んだうえで外すにも印を付けたときは、
    選んだほうを採る——ファイルを選ぶ手間のほうが、印1つより強い意思表示
  */
  const removing = bool(form.get('removeImage')) === 1
  const keeps = !removing && existing.imageUrl !== null
  const errors = mergeErrors(
    picked.error ? { image: picked.error } : null,
    links.error ? { links: links.error } : null,
    unreadable,
    itemValueErrors(values),
    values.published
      ? publishErrors({
          kind: 'item',
          summary: values.summary,
          body: values.body,
          imageAlt: values.imageAlt,
          hasImage: picked.image !== null || keeps,
          tags: tags.length,
          links: links.links.length,
        })
      : null,
    await itemSlugTaken(database, values.slug, id),
  )
  if (errors) return back(errors)

  // 新しい画像を置く → D1 → 通ってから前の画像を消す（commitWithImage の順序）
  const placed = picked.image
    ? await putImage(c.env.MEDIA, picked.image, 'items', values.slug)
    : null
  const image = placed ? imageColumns(placed, picked.image) : keeps ? {} : imageColumns(null, null)
  try {
    await commitWithImage(c.env.MEDIA, placed, () =>
      database.batch([
        database
          .update(schema.items)
          .set({ ...values, ...image })
          .where(eq(schema.items.id, id)),
        ...itemSlugMoves(database, id, existing.slug, values.slug),
        ...childWrites(database, id, tags, links.links),
      ]),
    )
  } catch (error) {
    if (uniqueViolation(error, 'items.slug')) return back({ slug: SLUG_TAKEN })
    throw error
  }
  // 差し替えた・外した画像は KV から消す（removeImage の注記）
  if (placed || !keeps) await removeImage(c.env.MEDIA, existing.imageUrl)
  /*
    前の URL が変わったか。slug を変えたときと、区分を変えたとき（1語目の
    apps / works が変わる。公開ページが前の区分の URL を 301 で寄せる）
  */
  const moved =
    existing.slug !== null && (existing.slug !== values.slug || existing.type !== values.type)
  return c.redirect(
    `/admin/items?type=${values.type}&saved=${savedParam(values.published)}${moved ? '&moved=1' : ''}`,
    303,
  )
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
                      公開にするほうは編集フォームと同じ関門を通る（止めたら
                      その行の編集画面へ。POST /blocks/:id/publish の注記）。
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
  // 追加のフォームの一度きりの札（newFormKey）。編集では持たない
  formKey?: string | null
  values?: Record<string, string>
  errors?: Record<string, string>
  // フォームの上に出す知らせ（一覧の「公開する」を関門が止めて、ここへ送ってきたとき）
  notice?: string
}) => {
  const { type, block } = props
  const value = (key: 'title' | 'body') =>
    props.values?.[key] ?? block?.[key] ?? (key === 'title' && 'title' in type ? type.title : '')
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

      {props.notice ? <p class="banner banner--error">{props.notice}</p> : null}

      <form
        method="post"
        action={block ? `/admin/blocks/${block.id}` : '/admin/blocks'}
        class="form"
      >
        <input type="hidden" name="type" value={type.key} />
        <FormKey value={props.formKey} />
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
  return c.html(<BlockForm account={c.get('account')} type={type} formKey={newFormKey()} />)
})

/*
  一覧の「公開する」を関門（publishErrors）が止めたときの着地点。
  /admin/blocks/:id/edit?publish=blocked で来る。

  止めた理由をその行のフォームに出し、「公開する」に印を付けて描く——直して
  保存すれば、押したかった「公開」がそのまま通る。理由がもう無ければ（別の
  タブで直した）、ふつうの編集画面。
*/
const PUBLISH_BLOCKED = '公開できませんでした。下の理由を直して保存すると、公開されます'

app.get('/blocks/:id/edit', async (c) => {
  const id = parseId(c.req.param('id'))
  if (!id) return c.notFound()
  const block = await findBlock(db(c), id)
  const type = block ? blockType(block.type) : undefined
  if (!block || !type) return c.notFound()
  const blocked =
    c.req.query('publish') === 'blocked'
      ? publishErrors({ kind: 'block', type, title: block.title, body: block.body })
      : null
  return c.html(
    blocked ? (
      <BlockForm
        account={c.get('account')}
        type={type}
        block={block}
        values={{ title: block.title, body: block.body, published: '1' }}
        errors={blocked}
        notice={PUBLISH_BLOCKED}
      />
    ) : (
      <BlockForm account={c.get('account')} type={type} block={block} />
    ),
  )
})

function readBlockForm(form: FormData) {
  return {
    title: str(form.get('title')),
    body: str(form.get('body')),
    published: bool(form.get('published')),
  }
}

/*
  ブロックを保存してよいか。下書きでも止めるのは受け取れない値（中身が空・
  リンク集の通らない行。blockValueErrors）だけで、1画面に収まる長さは公開に
  なるときにだけ見る（publishErrors）。数そのものは src/blocks.ts の maxChars が正。
*/
const blockSaveErrors = (type: BlockType, values: ReturnType<typeof readBlockForm>) =>
  values.published
    ? publishErrors({ kind: 'block', type, title: values.title, body: values.body })
    : blockValueErrors(type, values)

// 足す先はいちばん下。行はもう読んであるので、最大値を DB に聞き直さない
const nextBlockOrder = (rows: schema.Block[]) =>
  rows.reduce((last, row) => Math.max(last, row.sortOrder), 0) + 10

app.post('/blocks', async (c) => {
  const database = db(c)
  const form = await c.req.formData()
  const key = str(form.get('type'))
  const type = isBlockKey(key) ? blockType(key) : undefined
  const account = c.get('account')
  const values = type?.kind === 'free' ? readBlockForm(form) : null
  const saved = (id: number) =>
    c.redirect(`/admin/blocks?saved=${savedParam(values ? values.published : 1)}#block-${id}`, 303)

  // 同じ札で書いた、同じ中身の行（newFormKey の注記）
  const twinOf = (key: string | null) =>
    key ? database.query.blocks.findFirst({ where: eq(schema.blocks.formKey, key) }) : undefined
  const same = (row: schema.Block | undefined) =>
    row !== undefined &&
    row.type === type?.key &&
    row.title === values?.title &&
    row.body === values?.body
  // 同じフォームの2度目の送信。1度目がもう書いている
  const sent = formKeyOf(form)
  const twin = await twinOf(sent)
  if (twin && same(twin)) return saved(twin.id)
  const formKey = twin ? newFormKey() : sent

  const stored = await listBlocks(database)
  // 0件のときサイトに出ているのは既定の並び。重複かどうかもそれで判断する
  const rows = stored.length ? stored : defaultBlocks()
  const placedAlready = (label: string) =>
    siteCounts(database).then((counts) =>
      c.html(
        <BlocksPage
          account={account}
          rows={stored}
          counts={counts}
          error={`${label} は既に置いてあります`}
        />,
        400,
      ),
    )

  // 画面の数を数えるのは、一覧を描き直すときだけ。保存できた側では要らない
  if (!type) {
    return c.html(
      <BlocksPage
        account={account}
        rows={stored}
        counts={await siteCounts(database)}
        error="置けないブロックです"
      />,
      400,
    )
  }

  if (type.kind === 'fixed' && rows.some((row) => row.type === type.key)) {
    return placedAlready(type.label)
  }

  if (values) {
    const errors = blockSaveErrors(type, values)
    if (errors) {
      return c.html(
        <BlockForm
          account={account}
          type={type}
          formKey={formKey}
          values={asValues(values)}
          errors={errors}
        />,
        400,
      )
    }
  }

  /*
    ここまで来てから足す。0件なら、先に既定の並びを行にする。
    そうしないと、足した1つだけの DB になって、見えていた5節が消える。

    書くのは ON CONFLICT DO NOTHING の1文。決まった中身の種類は DB の部分一意
    索引（blocks_fixed_once）が、打ち込むものは札（form_key）が、同時に来た
    2本目を止める。止まったら行は返らない
  */
  const current = await ensureBlocks(database)
  const [added] = await database
    .insert(schema.blocks)
    .values({
      type: type.key,
      ...(values ?? { published: 1 }),
      sortOrder: nextBlockOrder(current),
      formKey: values ? formKey : null,
    })
    .onConflictDoNothing()
    .returning({ id: schema.blocks.id })
  if (!added) {
    // 打ち込むものなら1度目の送信が書いている。決まった中身なら、もう置いてある
    const first = await twinOf(formKey)
    return first && same(first) ? saved(first.id) : placedAlready(type.label)
  }

  /*
    足す先は Contact の手前。連なりのいちばん後ろに付けると締めの連絡先の後ろに
    来てしまい、↑ を何度も押して運ぶことになる
  */
  const contact = current.findIndex((row) => row.type === 'contact')
  if (contact >= 0) {
    const ids = current.map((row) => row.id)
    ids.splice(contact, 0, added.id)
    await reorderBlocks(database, ids)
  }

  return saved(added.id)
})

/*
  何も置いていないときだけ、既定の並びを行にする。2回目以降は何もしない
  （何もしていないのに「保存しました」と出さない）。数えると足すを1文でやる
  （src/db/queries.ts の initBlocks）ので、2本同時に来ても2組にならない
*/
app.post('/blocks/init', async (c) => {
  const created = await initBlocks(db(c))
  return c.redirect(created ? '/admin/blocks?saved=1' : '/admin/blocks', 303)
})

app.post('/blocks/:id', async (c) => {
  const id = parseId(c.req.param('id'))
  if (!id) return c.notFound()
  const block = await findBlock(db(c), id)
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
    下書きに戻す保存では中身の長さを見ない（関門は published が 1 になるときだけ。
    publishErrors）。公開しないものは公開ページに出ないので、1画面に収まるか
    どうかを問う理由が無い。

    問うていたころは行き止まりができていた。上限より前に保存された長い中身を
    持つ行は、編集フォームが DB の本文で初期化されるので、「公開する」を外して
    保存しようとしても同じ 400 で戻ってくる。引っ込める手は本文ごと削除しか
    残らず、一度当たった人はその画面を触らなくなる。
  */
  const errors = blockSaveErrors(type, values)
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
  一覧から公開・下書きだけを切り替える。中身は触らない。

  **公開にするほうは、編集フォームと同じ関門を通す（publishErrors）。** 中身は
  触らないから検査もしない、としていたころは、下書きのまま上限の3倍に書き足した
  メモや、一文を空にしたひとことが、このボタン1つで公開になった（下書きの保存は
  長さを見ないので、検査が1度も走らない道ができていた）。止めたら 303 でその行の
  編集画面へ送り、理由を出す（GET /blocks/:id/edit の publish=blocked）。

  下書きに戻すほうは何も見ない（引っ込める道を塞がない）。種類も見ない——
  外すのと同じ理由で、blocks.ts から種類を1つ減らしたとき、その行が引っ込められずに
  残らないように。種類の消えた行を公開にするときも見るものが無い（公開ページが
  読み飛ばす）。
*/
app.post('/blocks/:id/publish', async (c) => {
  const id = parseId(c.req.param('id'))
  if (!id) return c.notFound()
  const block = await findBlock(db(c), id)
  if (!block) return c.notFound()

  const form = await c.req.formData()
  const published = bool(form.get('published'))
  const type = blockType(block.type)
  if (
    published &&
    type &&
    publishErrors({ kind: 'block', type, title: block.title, body: block.body })
  ) {
    return c.redirect(`/admin/blocks/${id}/edit?publish=blocked`, 303)
  }
  await db(c)
    .update(schema.blocks)
    .set({ published, updatedAt: new Date().toISOString() })
    .where(eq(schema.blocks.id, id))
  // 押した行へ戻す。一覧の頭に戻すと、どれを切り替えたかを探し直すことになる
  return c.redirect(`/admin/blocks?saved=${savedParam(published)}#block-${id}`, 303)
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
  const block = await findBlock(db(c), id)
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
  const block = await findBlock(db(c), id)
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
