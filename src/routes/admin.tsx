import { and, asc, count, eq, ne } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import type { Context } from 'hono'
import { Hono } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import { createMiddleware } from 'hono/factory'
import type { Child } from 'hono/jsx'
import * as schema from '../db/schema'
import type { AppEnv } from '../env'
import {
  clearLoginFailures,
  createSession,
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
import { AdminBare, AdminLayout } from '../ui/AdminLayout'
import { Avatar, StatusPill } from '../ui/components'
import { MarkIcon, PencilIcon, TrashIcon } from '../ui/icons'

export const adminRoutes = new Hono<AppEnv>()

const db = (c: { env: { DB: D1Database } }) => drizzle(c.env.DB, { schema })

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
}) => (
  <label class="field field--wide">
    <span class="field__label">{props.label}</span>
    <textarea class="input input--area" name={props.name} rows={props.rows ?? 4}>
      {props.value ?? ''}
    </textarea>
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

const FormActions = ({ cancelHref, deleteHref }: { cancelHref: string; deleteHref?: string }) => (
  <div class="form-actions">
    {deleteHref ? (
      <a class="btn btn--link btn--danger" href={deleteHref}>
        この項目を削除…
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
        削除する
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
  const ok = user ? await verifyPassword(password, user.passwordHash) : false

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

// SameSite=Lax だけに頼らず、書き込みは Origin も見る
const sameOrigin = createMiddleware<AppEnv>(async (c, next) => {
  if (c.req.method === 'POST') {
    const origin = c.req.header('origin')
    if (origin && new URL(origin).host !== new URL(c.req.url).host) {
      return c.text('別のサイトからの送信は受け付けません', 403)
    }
  }
  await next()
})

const app = new Hono<AppEnv>()
app.use('*', sameOrigin, requireAuth)

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

// 画像は KV に置く。R2 が未有効なのと、アバターは読むばかりで書き換えが稀なため
async function saveAvatar(kv: KVNamespace, form: FormData, slug: string): Promise<string | null> {
  const file = form.get('avatar')
  if (!(file instanceof File) || file.size === 0) return null
  if (!file.type.startsWith('image/')) return null
  if (file.size > 1_000_000) return null

  const extension = file.type.split('/')[1]?.replace('+xml', '') ?? 'bin'
  const key = `avatars/${slug}-${newToken(4)}.${extension}`
  await kv.put(key, await file.arrayBuffer(), { metadata: { contentType: file.type } })
  return `/images/${key}`
}

app.post('/members', async (c) => {
  const { form, values } = await readMemberForm(c)
  if (!values.name)
    return c.html(
      <MemberForm email={c.get('user').email} errors={{ name: '氏名は必須です' }} />,
      400,
    )

  const duplicate = await db(c).query.members.findFirst({
    where: eq(schema.members.slug, values.slug),
  })
  if (duplicate) {
    return c.html(
      <MemberForm
        email={c.get('user').email}
        errors={{ slug: 'この slug は既に使われています' }}
        values={Object.fromEntries(
          Object.entries(values).map(([key, value]) => [key, String(value ?? '')]),
        )}
      />,
      400,
    )
  }

  const avatarUrl = await saveAvatar(c.env.MEDIA, form, values.slug)
  await db(c)
    .insert(schema.members)
    .values({ ...values, avatarUrl })
  return c.redirect('/admin/members?saved=1', 303)
})

app.post('/members/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const member = await db(c).query.members.findFirst({ where: eq(schema.members.id, id) })
  if (!member) return c.notFound()

  const { form, values } = await readMemberForm(c)
  const duplicate = await db(c).query.members.findFirst({
    where: and(eq(schema.members.slug, values.slug), ne(schema.members.id, id)),
  })
  if (duplicate) {
    return c.html(
      <MemberForm
        email={c.get('user').email}
        member={member}
        errors={{ slug: 'この slug は既に使われています' }}
      />,
      400,
    )
  }

  const avatarUrl = await saveAvatar(c.env.MEDIA, form, values.slug)
  await db(c)
    .update(schema.members)
    .set({ ...values, ...(avatarUrl ? { avatarUrl } : {}) })
    .where(eq(schema.members.id, id))
  return c.redirect('/admin/members?saved=1', 303)
})

app.get('/members/:id/delete', async (c) => {
  const id = Number(c.req.param('id'))
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
  await db(c)
    .delete(schema.members)
    .where(eq(schema.members.id, Number(c.req.param('id'))))
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
}

const ItemForm = (props: ItemFormData) => {
  const item = props.item
  const links = [...(item?.links ?? []), { label: '', url: '' }, { label: '', url: '' }].slice(0, 3)

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
          <Field label="タイトル" name="title" value={item?.title} required />
          <Select
            label="担当メンバー"
            name="memberId"
            value={item?.memberId ?? ''}
            options={[
              { value: '', label: '（なし）' },
              ...props.members.map((member) => ({ value: String(member.id), label: member.name })),
            ]}
          />
          {props.type === 'app' ? (
            <Select
              label="プラットフォーム"
              name="platformKey"
              value={item?.platformKey ?? ''}
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
              value={item?.category}
              placeholder="金融系基幹システム"
            />
          )}
          <Field label="年" name="year" value={item?.year} placeholder="2026 / 2024 —" />
          <Area
            label="説明文"
            name="summary"
            value={item?.summary}
            rows={3}
            hint="「何であるか。何をしたか。」の2文"
          />
          <Field
            label="タグ"
            name="tags"
            value={(item?.tags ?? []).map((tag) => tag.tag).join(', ')}
            hint="カンマ区切り"
          />
          <Field
            label="並び順"
            name="sortOrder"
            value={item?.sortOrder ?? 10}
            hint="小さいほど先。10刻み"
          />

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
                  value={item?.metricValue ?? ''}
                  placeholder="20"
                />
                <input
                  class="input"
                  type="text"
                  name="metricUnit"
                  value={item?.metricUnit ?? ''}
                  placeholder="人日"
                />
                <input
                  class="input"
                  type="text"
                  name="metricNote"
                  value={item?.metricNote ?? ''}
                  placeholder="見込み 40人日 → 実績"
                />
              </div>
            </fieldset>
          ) : null}
        </div>

        <div class="form-foot">
          <PublishToggle published={item?.published ?? 0} />
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
  const item = await db(c).query.items.findFirst({
    where: eq(schema.items.id, Number(c.req.param('id'))),
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
  const id = Number(c.req.param('id'))
  const form = await c.req.formData()
  const values = await readItemForm(form)

  await db(c).update(schema.items).set(values).where(eq(schema.items.id, id))
  await replaceChildren(db(c), id, form)
  return c.redirect(`/admin/items?type=${values.type}&saved=1`, 303)
})

app.get('/items/:id/delete', async (c) => {
  const id = Number(c.req.param('id'))
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
  const id = Number(c.req.param('id'))
  const item = await db(c).query.items.findFirst({ where: eq(schema.items.id, id) })
  await db(c).delete(schema.items).where(eq(schema.items.id, id))
  return c.redirect(`/admin/items?type=${item?.type ?? 'app'}&deleted=1`, 303)
})

adminRoutes.route('/', app)
