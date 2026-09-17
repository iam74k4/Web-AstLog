import { and, asc, count, eq, max, ne } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import type { Context } from 'hono'
import { Hono } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import { createMiddleware } from 'hono/factory'
import type { Child } from 'hono/jsx'
import {
  BLOCK_TYPES,
  type BlockKey,
  type BlockType,
  blockType,
  DEFAULT_BLOCKS,
  isBlockKey,
} from '../blocks'
import { listBlocks, loadTheme, reorderBlocks, saveTheme } from '../db/queries'
import * as schema from '../db/schema'
import type { AppEnv } from '../env'
import {
  clearLoginFailures,
  createSession,
  DUMMY_HASH,
  destroySession,
  getSessionUser,
  hashPassword,
  LOGIN_LIMIT,
  loginAttempts,
  newToken,
  recordLoginFailure,
  SESSION_COOKIE,
  verifyPassword,
} from '../lib/auth'
import { bool, num, parseTags, str, toSlug } from '../lib/format'
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
import { Avatar, StatusPill } from '../ui/components'
import { MarkIcon, PencilIcon, TrashIcon } from '../ui/icons'

export const adminRoutes = new Hono<AppEnv>()

const db = (c: { env: { DB: D1Database } }) => drizzle(c.env.DB, { schema })

/*
  SameSite=Lax だけに頼らず、書き込みは Origin も見る。
  ログイン・ログアウト・初期設定も「書き込み」なので、認証の壁より
  外側で掛ける。内側だけに置くと、壁の手前にあるこの3つを素通りする。
*/
const sameOrigin = createMiddleware<AppEnv>(async (c, next) => {
  if (c.req.method === 'POST') {
    const origin = c.req.header('origin')
    if (origin && new URL(origin).host !== new URL(c.req.url).host) {
      return c.text('別のサイトからの送信は受け付けません', 403)
    }
  }
  await next()
})

adminRoutes.use('*', sameOrigin)

// URL の :id は数字とは限らない。数字でなければ 404 にする
function parseId(value: string | undefined): number | null {
  const id = Number(value)
  return Number.isInteger(id) && id > 0 ? id : null
}

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
}) => (
  <label class="field field--wide">
    <span class="field__label">{props.label}</span>
    <textarea
      class={props.error ? 'input input--area input--error' : 'input input--area'}
      name={props.name}
      rows={props.rows ?? 4}
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

/* ------------------------------------------------------- ログインと初期設定 */

const LoginPage = ({ email, error }: { email?: string; error?: string }) => (
  <AdminBare title="ログイン">
    <form class="login" method="post" action="/admin/login">
      <span class="login__brand">
        <MarkIcon size={30} />
        <span class="login__word">NOCTIFEX</span>
        <span class="login__label">ADMIN</span>
      </span>
      {error ? <p class="banner banner--error">{error}</p> : null}
      <Field
        label="Email"
        name="email"
        type="email"
        value={email}
        required
        placeholder="you@example.com"
      />
      <Field label="Password" name="password" type="password" required />
      <button class="btn btn--primary btn--block" type="submit">
        Sign in →
      </button>
      <span class="login__note">Noctifex メンバーのみアクセスできます</span>
    </form>
  </AdminBare>
)

adminRoutes.get('/login', (c) => c.html(<LoginPage />))

adminRoutes.post('/login', async (c) => {
  const form = await c.req.formData()
  const email = str(form.get('email')).toLowerCase()
  const password = str(form.get('password'))

  if ((await loginAttempts(c.env.MEDIA, email)) >= LOGIN_LIMIT.max) {
    return c.html(
      <LoginPage
        email={email}
        error={`試行回数が多すぎます。${LOGIN_LIMIT.windowMinutes}分後にもう一度お試しください。`}
      />,
      429,
    )
  }

  const user = await db(c).query.users.findFirst({ where: eq(schema.users.email, email) })
  // ユーザーが居なくても必ず1回ハッシュを計算する。
  // 居ないときだけ即座に返すと、応答の速さでアカウントの有無が分かってしまう
  const ok = await verifyPassword(password, user?.passwordHash ?? DUMMY_HASH)

  if (!user || !ok) {
    await recordLoginFailure(c.env.MEDIA, email)
    // どちらが違うかは言わない。メールアドレスの存在を教えないため
    return c.html(<LoginPage email={email} error="メールアドレスかパスワードが違います" />, 401)
  }

  await clearLoginFailures(c.env.MEDIA, email)
  const session = await createSession(db(c), user.id)
  setCookie(c, SESSION_COOKIE, session.id, {
    httpOnly: true,
    sameSite: 'Lax',
    secure: new URL(c.req.url).protocol === 'https:',
    path: '/',
    expires: session.expiresAt,
  })
  return c.redirect('/admin/members', 303)
})

adminRoutes.post('/logout', async (c) => {
  const sessionId = getCookie(c, SESSION_COOKIE)
  if (sessionId) await destroySession(db(c), sessionId)
  deleteCookie(c, SESSION_COOKIE, { path: '/' })
  return c.redirect('/admin/login', 303)
})

/*
  最初の owner を作るためだけの入口。users が空のときしか通らず、
  SETUP_TOKEN（wrangler secret）と一致しない限り何もしない。
  パスワードをリポジトリに置かずに済ませるための仕掛け。
*/
adminRoutes.all('/setup', async (c) => {
  const existing = await db(c).select({ n: count() }).from(schema.users)
  if ((existing[0]?.n ?? 0) > 0) return c.text('すでに設定済みです', 404)
  if (!c.env.SETUP_TOKEN) return c.text('SETUP_TOKEN が未設定です', 404)

  if (c.req.method !== 'POST') {
    return c.html(
      <AdminBare title="初期設定">
        <form class="login" method="post" action="/admin/setup">
          <span class="login__brand">
            <MarkIcon size={30} />
            <span class="login__word">NOCTIFEX</span>
            <span class="login__label">SETUP</span>
          </span>
          <Field label="Setup token" name="token" type="password" required />
          <Field label="Email" name="email" type="email" required />
          <Field label="Password" name="password" type="password" required hint="12文字以上" />
          <button class="btn btn--primary btn--block" type="submit">
            owner を作成
          </button>
        </form>
      </AdminBare>,
    )
  }

  const form = await c.req.formData()
  if (str(form.get('token')) !== c.env.SETUP_TOKEN) return c.text('token が違います', 403)
  const email = str(form.get('email')).toLowerCase()
  const password = str(form.get('password'))
  if (!email || password.length < 12)
    return c.text('メールアドレスと12文字以上のパスワードが必要です', 400)

  await db(c)
    .insert(schema.users)
    .values({ email, passwordHash: await hashPassword(password), role: 'owner' })
  return c.redirect('/admin/login', 303)
})

/* --------------------------------------------------------------- 認証の壁 */

const requireAuth = createMiddleware<AppEnv>(async (c, next) => {
  const sessionId = getCookie(c, SESSION_COOKIE)
  const user = sessionId ? await getSessionUser(db(c), sessionId) : null
  if (!user) return c.redirect('/admin/login', 303)
  c.set('user', user)
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
    <AdminLayout
      title="Members"
      active="members"
      email={c.get('user').email}
      flash={c.req.query('saved') ? '保存しました' : c.req.query('deleted') ? '削除しました' : null}
    >
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
  email: string
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
      email={props.email}
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
          <Field label="GitHub URL" name="github" value={value('github')} />
          <Field label="Email" name="email" type="email" value={value('email')} />
          <Area label="紹介文" name="bio" value={value('bio')} rows={5} hint="空行で段落を分ける" />
          <Area
            label="スキル"
            name="skillsText"
            value={value('skillsText')}
            rows={5}
            hint="末尾が : の行はグループ見出し。それ以外は「表示名 | 補足」"
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
            deleteHref={member ? `/admin/members/${member.id}/delete` : undefined}
          />
        </div>
      </form>
    </AdminLayout>
  )
}

app.get('/members/new', (c) => c.html(<MemberForm email={c.get('user').email} />))

app.get('/members/:id/edit', async (c) => {
  const member = await db(c).query.members.findFirst({
    where: eq(schema.members.id, Number(c.req.param('id'))),
  })
  if (!member) return c.notFound()
  return c.html(<MemberForm email={c.get('user').email} member={member} />)
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

const AVATAR_MAX_BYTES = 1_000_000

/*
  画像は KV に置く。R2 が未有効なのと、アバターは読むばかりで書き換えが稀なため。

  戻り値で「選ばれていない」と「弾いた」を区別する。同じ null にすると、
  大きすぎる画像を選んだ人に「保存しました」と出てしまう。
*/
type AvatarResult = { url: string | null; error?: string }

async function saveAvatar(kv: KVNamespace, form: FormData, slug: string): Promise<AvatarResult> {
  const file = form.get('avatar')
  if (!(file instanceof File) || file.size === 0) return { url: null }
  if (!file.type.startsWith('image/')) return { url: null, error: '画像ファイルを選んでください' }
  if (file.size > AVATAR_MAX_BYTES) {
    return { url: null, error: '画像は 1MB までです。小さくしてから選び直してください' }
  }

  // キーは /images/ 側の検査（avatars/ 配下・英数字のみ）を必ず通る形にする
  const extension = file.type.split('/')[1]?.replace(/[^a-z0-9]/g, '') || 'bin'
  const key = `avatars/${toSlug(slug) || 'member'}-${newToken(4)}.${extension}`
  await kv.put(key, await file.arrayBuffer(), { metadata: { contentType: file.type } })
  return { url: `/images/${key}` }
}

// 差し替え・削除で使われなくなった画像は KV に残さない。
// 残すと、URL を知っている人がいつまでも取得できる
async function removeAvatar(kv: KVNamespace, avatarUrl: string | null | undefined) {
  if (!avatarUrl?.startsWith('/images/avatars/')) return
  await kv.delete(avatarUrl.replace('/images/', ''))
}

// 入力エラーで描き直すとき、打った内容をそのまま返すための変換
function asValues(values: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(values).map(([key, value]) => [key, String(value ?? '')]),
  )
}

app.post('/members', async (c) => {
  const { form, values } = await readMemberForm(c)
  const email = c.get('user').email
  const back = (errors: Record<string, string>) =>
    c.html(<MemberForm email={email} errors={errors} values={asValues(values)} />, 400)

  if (!values.name) return back({ name: '氏名は必須です' })

  const duplicate = await db(c).query.members.findFirst({
    where: eq(schema.members.slug, values.slug),
  })
  if (duplicate) return back({ slug: 'この slug は既に使われています' })

  const avatar = await saveAvatar(c.env.MEDIA, form, values.slug)
  if (avatar.error) return back({ avatar: avatar.error })

  await db(c)
    .insert(schema.members)
    .values({ ...values, avatarUrl: avatar.url })
  return c.redirect('/admin/members?saved=1', 303)
})

app.post('/members/:id', async (c) => {
  const id = parseId(c.req.param('id'))
  if (!id) return c.notFound()
  const member = await db(c).query.members.findFirst({ where: eq(schema.members.id, id) })
  if (!member) return c.notFound()

  const { form, values } = await readMemberForm(c)
  const email = c.get('user').email
  const back = (errors: Record<string, string>) =>
    c.html(
      <MemberForm email={email} member={member} errors={errors} values={asValues(values)} />,
      400,
    )

  if (!values.name) return back({ name: '氏名は必須です' })

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
  if (avatar.url) await removeAvatar(c.env.MEDIA, member.avatarUrl)
  return c.redirect('/admin/members?saved=1', 303)
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
    <AdminLayout title="削除の確認" active="members" email={c.get('user').email}>
      <Confirm
        title={`「${member.name}」を削除しますか？`}
        detail="この操作は取り消せません。"
        action={`/admin/members/${id}/delete`}
        cancelHref="/admin/members"
      >
        <p class="confirm__detail">
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
  await removeAvatar(c.env.MEDIA, member.avatarUrl)
  return c.redirect('/admin/members?deleted=1', 303)
})

/* --------------------------------------------------------------- Items */

const typeLabel = (type: 'app' | 'work') => (type === 'app' ? 'Apps' : 'Works')

app.get('/items', async (c) => {
  const type = c.req.query('type') === 'work' ? 'work' : 'app'
  const rows = await db(c).query.items.findMany({
    where: eq(schema.items.type, type),
    orderBy: [asc(schema.items.sortOrder), asc(schema.items.id)],
    with: { member: true, platform: true },
  })

  return c.html(
    <AdminLayout
      title="Apps & Works"
      active="items"
      email={c.get('user').email}
      flash={c.req.query('saved') ? '保存しました' : c.req.query('deleted') ? '削除しました' : null}
    >
      <div class="admin-head">
        <div class="admin-head__title">
          <h1>Apps &amp; Works</h1>
          <div class="tabs">
            <a href="/admin/items?type=app" aria-current={type === 'app' ? 'page' : undefined}>
              Apps
            </a>
            <a href="/admin/items?type=work" aria-current={type === 'work' ? 'page' : undefined}>
              Works
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
                <span class="row__sub">{item.member?.name ?? '担当なし'}</span>
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
  email: string
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
      memberId: submitted.memberId ?? '',
      platformKey: submitted.platformKey ?? '',
      category: submitted.category ?? '',
      year: submitted.year ?? '',
      summary: submitted.summary ?? '',
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
    memberId: item?.memberId ? String(item.memberId) : '',
    platformKey: item?.platformKey ?? '',
    category: item?.category ?? '',
    year: item?.year ?? '',
    summary: item?.summary ?? '',
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
  memberId: string
  platformKey: string
  category: string
  year: string
  summary: string
  tags: string
  sortOrder: string
  published: number
  metricValue: string
  metricUnit: string
  metricNote: string
  links: { label: string; url: string }[]
}

const ItemForm = (props: ItemFormData) => {
  const item = props.item
  const d = itemDraft(item, props.submitted)
  const links = [...d.links, { label: '', url: '' }, { label: '', url: '' }].slice(0, 3)

  return (
    <AdminLayout title={item ? item.title : '新しい項目'} active="items" email={props.email}>
      <div class="admin-head">
        <div class="admin-head__title">
          <span class="crumbs">
            Apps &amp; Works / {typeLabel(props.type)} / {item ? '編集' : '追加'}
          </span>
          <h1>{item ? item.title : '新しい項目'}</h1>
        </div>
      </div>

      <form method="post" action={item ? `/admin/items/${item.id}` : '/admin/items'} class="form">
        <input type="hidden" name="type" value={props.type} />
        <div class="form-grid">
          <Field
            label="タイトル"
            name="title"
            value={d.title}
            required
            error={props.errors?.title}
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
          <Field label="年" name="year" value={d.year} placeholder="2026 / 2024 —" />
          <Area
            label="説明文"
            name="summary"
            value={d.summary}
            rows={3}
            hint="「何であるか。何をしたか。」の2文"
          />
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
                  placeholder="見込み 40人日 → 実績"
                />
              </div>
            </fieldset>
          ) : null}
        </div>

        <div class="form-foot">
          <PublishToggle published={d.published} />
          <FormActions
            cancelHref={`/admin/items?type=${props.type}`}
            deleteHref={item ? `/admin/items/${item.id}/delete` : undefined}
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
    <ItemForm email={c.get('user').email} type={type} members={members} platforms={platforms} />,
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
      email={c.get('user').email}
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

  return {
    type,
    memberId: memberId || null,
    platformKey: type === 'app' && platformKey ? platformKey : null,
    category: type === 'work' ? str(form.get('category')) : '',
    title: str(form.get('title')),
    year: str(form.get('year')),
    summary: str(form.get('summary')),
    metricValue: str(form.get('metricValue')) || null,
    metricUnit: str(form.get('metricUnit')) || null,
    metricNote: str(form.get('metricNote')) || null,
    sortOrder: num(form.get('sortOrder'), 0),
    published: bool(form.get('published')),
    updatedAt: new Date().toISOString(),
  }
}

// 弾いたときに、打った内容をそのままフォームへ返すための形
function submittedItem(form: FormData): Record<string, string> {
  const labels = form.getAll('linkLabel').map((value) => str(value))
  const urls = form.getAll('linkUrl').map((value) => str(value))
  return {
    title: str(form.get('title')),
    memberId: str(form.get('memberId')),
    platformKey: str(form.get('platformKey')),
    category: str(form.get('category')),
    year: str(form.get('year')),
    summary: str(form.get('summary')),
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
  if (!values.title) {
    const { members, platforms } = await formContext(c)
    return c.html(
      <ItemForm
        email={c.get('user').email}
        type={values.type}
        members={members}
        platforms={platforms}
        submitted={submittedItem(form)}
        errors={{ title: 'タイトルは必須です' }}
      />,
      400,
    )
  }

  const inserted = await db(c)
    .insert(schema.items)
    .values(values)
    .returning({ id: schema.items.id })
  const id = inserted[0]?.id
  if (id) await replaceChildren(db(c), id, form)
  return c.redirect(`/admin/items?type=${values.type}&saved=1`, 303)
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
  if (!values.title) {
    const { members, platforms } = await formContext(c)
    return c.html(
      <ItemForm
        email={c.get('user').email}
        type={values.type}
        members={members}
        platforms={platforms}
        item={{ ...existing, tags: [], links: [] }}
        submitted={submittedItem(form)}
        errors={{ title: 'タイトルは必須です' }}
      />,
      400,
    )
  }

  await db(c).update(schema.items).set(values).where(eq(schema.items.id, id))
  await replaceChildren(db(c), id, form)
  return c.redirect(`/admin/items?type=${values.type}&saved=1`, 303)
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
    <AdminLayout title="削除の確認" active="items" email={c.get('user').email}>
      <Confirm
        title={`「${item.title}」を削除しますか？`}
        detail="この操作は取り消せません。"
        action={`/admin/items/${id}/delete`}
        cancelHref={`/admin/items?type=${item.type}`}
      >
        <p class="confirm__detail">
          タグ {item.tags.length} 件とリンク {item.links.length} 件も一緒に消えます。
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
  return c.redirect(`/admin/items?type=${item.type}&deleted=1`, 303)
})

/* --------------------------------------------------------------- 構成 */

/*
  トップページの並び。置く・外す・上下に動かす、の3つだけ。
  部品の見た目はここからは変えられない（見た目は「見た目」で、全体に対して選ぶ）。
*/

const blockLabel = (block: schema.Block) =>
  block.title || blockType(block.type)?.label || block.type

const BlocksPage = (props: {
  email: string
  rows: schema.Block[]
  flash?: string | null
  error?: string
}) => {
  const placed = new Set(props.rows.map((row) => row.type))
  // 決まった中身のものは1つだけ。打ち込むものはいくつでも置ける
  const available = BLOCK_TYPES.filter((type) => type.kind === 'free' || !placed.has(type.key))

  return (
    <AdminLayout title="構成" active="blocks" email={props.email} flash={props.flash}>
      <div class="admin-head">
        <div class="admin-head__title">
          <span class="crumbs">トップページ</span>
          <h1>構成</h1>
        </div>
        <a class="btn btn--ghost" href="/" target="_blank" rel="noreferrer">
          サイトを見る ↗
        </a>
      </div>

      {props.error ? <p class="banner banner--error">{props.error}</p> : null}

      {props.rows.length === 0 ? (
        <div class="empty-state">
          <p>
            まだ何も置いていないので、既定の並び（Hero → Apps → Works → Team → Contact）で
            出しています
          </p>
          <form method="post" action="/admin/blocks/init">
            <button class="btn btn--primary" type="submit">
              この並びから始める
            </button>
          </form>
        </div>
      ) : (
        <ul class="rows">
          {props.rows.map((block, index) => {
            const type = blockType(block.type)
            return (
              <li class="row" key={block.id}>
                <span class="row__move">
                  <form method="post" action={`/admin/blocks/${block.id}/move`}>
                    <input type="hidden" name="dir" value="up" />
                    <button
                      class="move-btn"
                      type="submit"
                      disabled={index === 0}
                      aria-label={`${blockLabel(block)} を上へ`}
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
                      aria-label={`${blockLabel(block)} を下へ`}
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
                </span>
                <StatusPill published={block.published} />
                <span class="row__actions">
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
      )}

      <section class="catalog">
        <h2 class="catalog__title">
          足す<span class="presets__note">下に足される。置いてから上下に動かす</span>
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
    </AdminLayout>
  )
}

app.get('/blocks', async (c) => {
  return c.html(
    <BlocksPage
      email={c.get('user').email}
      rows={await listBlocks(db(c))}
      flash={c.req.query('saved') ? '保存しました' : c.req.query('deleted') ? '外しました' : null}
    />,
  )
})

const BlockForm = (props: {
  email: string
  type: BlockType
  block?: schema.Block
  values?: Record<string, string>
  errors?: Record<string, string>
}) => {
  const { type, block } = props
  const value = (key: 'title' | 'body') =>
    props.values?.[key] ?? block?.[key] ?? (key === 'title' && 'title' in type ? type.title : '')

  return (
    <AdminLayout title={type.label} active="blocks" email={props.email}>
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
                  type.key === 'statement' ? '大きく出る' : `空なら「${type.title || type.label}」`
                }
              />
              <Area
                label={type.key === 'statement' ? '添え書き' : '中身'}
                name="body"
                value={value('body')}
                rows={6}
                hint={type.hint}
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
          <PublishToggle published={block?.published ?? 1} />
          <FormActions
            cancelHref="/admin/blocks"
            deleteHref={block ? `/admin/blocks/${block.id}/delete` : undefined}
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
  if (!type || type.kind !== 'free') return c.notFound()
  return c.html(<BlockForm email={c.get('user').email} type={type} />)
})

app.get('/blocks/:id/edit', async (c) => {
  const id = parseId(c.req.param('id'))
  if (!id) return c.notFound()
  const block = await db(c).query.blocks.findFirst({ where: eq(schema.blocks.id, id) })
  const type = block ? blockType(block.type) : undefined
  if (!block || !type) return c.notFound()
  return c.html(<BlockForm email={c.get('user').email} type={type} block={block} />)
})

function readBlockForm(form: FormData) {
  return {
    title: str(form.get('title')),
    body: str(form.get('body')),
    published: bool(form.get('published')),
  }
}

// ひとことは一文が無いと出せない。それ以外は中身が無いと出せない
function blockErrors(
  key: BlockKey,
  values: { title: string; body: string },
): Record<string, string> | null {
  if (key === 'statement' && !values.title) return { title: '一文を入れてください' }
  if (key !== 'statement' && !values.body) return { body: '中身を入れてください' }
  return null
}

async function nextBlockOrder(c: Context<AppEnv>) {
  const [row] = await db(c)
    .select({ last: max(schema.blocks.sortOrder) })
    .from(schema.blocks)
  return (row?.last ?? 0) + 10
}

app.post('/blocks', async (c) => {
  const form = await c.req.formData()
  const key = str(form.get('type'))
  const type = isBlockKey(key) ? blockType(key) : undefined
  const email = c.get('user').email
  const rows = await listBlocks(db(c))

  if (!type) {
    return c.html(<BlocksPage email={email} rows={rows} error="置けないブロックです" />, 400)
  }

  if (type.kind === 'fixed') {
    if (rows.some((row) => row.type === type.key)) {
      return c.html(
        <BlocksPage email={email} rows={rows} error={`${type.label} は既に置いてあります`} />,
        400,
      )
    }
    await db(c)
      .insert(schema.blocks)
      .values({ type: type.key, published: 1, sortOrder: await nextBlockOrder(c) })
    return c.redirect('/admin/blocks?saved=1', 303)
  }

  const values = readBlockForm(form)
  const errors = blockErrors(type.key, values)
  if (errors) {
    return c.html(
      <BlockForm email={email} type={type} values={asValues(values)} errors={errors} />,
      400,
    )
  }

  await db(c)
    .insert(schema.blocks)
    .values({ type: type.key, ...values, sortOrder: await nextBlockOrder(c) })
  return c.redirect('/admin/blocks?saved=1', 303)
})

// 何も置いていないときだけ、既定の並びを行にする。2回目以降は何もしない
app.post('/blocks/init', async (c) => {
  const rows = await listBlocks(db(c))
  if (rows.length === 0) {
    await db(c)
      .insert(schema.blocks)
      .values(
        DEFAULT_BLOCKS.map((type, index) => ({ type, published: 1, sortOrder: (index + 1) * 10 })),
      )
  }
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
    return c.redirect('/admin/blocks?saved=1', 303)
  }

  const errors = blockErrors(type.key, values)
  if (errors) {
    return c.html(
      <BlockForm
        email={c.get('user').email}
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
  return c.redirect('/admin/blocks?saved=1', 303)
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
  const target = str(form.get('dir')) === 'up' ? index - 1 : index + 1
  const ids = rows.map((row) => row.id)
  if (target >= 0 && target < ids.length) {
    const [moved] = ids.splice(index, 1)
    if (moved !== undefined) ids.splice(target, 0, moved)
    await reorderBlocks(db(c), ids)
  }
  return c.redirect('/admin/blocks', 303)
})

app.get('/blocks/:id/delete', async (c) => {
  const id = parseId(c.req.param('id'))
  if (!id) return c.notFound()
  const block = await db(c).query.blocks.findFirst({ where: eq(schema.blocks.id, id) })
  const type = block ? blockType(block.type) : undefined
  if (!block || !type) return c.notFound()

  return c.html(
    <AdminLayout title="外す" active="blocks" email={c.get('user').email}>
      <Confirm
        title={`「${blockLabel(block)}」をトップから外しますか？`}
        detail={
          type.kind === 'fixed'
            ? '中身（登録した項目やメンバー）は消えません。あとから「足す」で置き直せます。'
            : '打ち込んだ中身も消えます。'
        }
        action={`/admin/blocks/${id}/delete`}
        cancelHref="/admin/blocks"
        verb="外す"
      >
        <p class="confirm__detail">
          いったん隠したいだけなら、編集で「公開する」を外すほうが安全です。
        </p>
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
  email: string
  theme: Theme
  flash?: string | null
  error?: string
}) => (
  <AdminLayout title="見た目" active="appearance" email={props.email} flash={props.flash}>
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
      email={c.get('user').email}
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
        email={c.get('user').email}
        theme={await loadTheme(db(c))}
        error="選べない見た目です。もう一度選び直してください"
      />,
      400,
    )
  }

  await saveTheme(db(c), normalizeTheme(picked))
  return c.redirect('/admin/appearance?saved=1', 303)
})

adminRoutes.route('/', app)
