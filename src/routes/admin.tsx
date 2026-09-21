import { and, asc, count, eq, ne } from 'drizzle-orm'
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
  DEFAULT_BLOCKS,
  isBlockKey,
  MAX_CHARS,
} from '../blocks'
import {
  countPublishedItems,
  defaultBlocks,
  ensureBlocks,
  listBlocks,
  loadTheme,
  reorderBlocks,
  saveTheme,
} from '../db/queries'
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
import { bool, isSafeUrl, num, paragraphs, parseLines, parseTags, str, toSlug } from '../lib/format'
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
import { Avatar, itemHref, StatusPill } from '../ui/components'
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
          {/*
            紹介文は個人ページの About 1枚に全段落が出る（件数で割れない）。
            段落の数も高さを決めるので、字数と一緒に添える
          */}
          <Area
            label="紹介文"
            name="bio"
            value={value('bio')}
            rows={5}
            hint={`空行で段落を分ける · 1画面 ${MAX_CHARS.memberBio} 字・${MAX_CHARS.memberBioParagraphs} 段落まで`}
            maxlength={MAX_CHARS.memberBio}
            error={props.errors?.bio}
          />
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

/*
  紹介文の長さ。個人ページの About は1枚で、割る先が無い。

  段落の数も見るのは、同じ字数でも空行を増やすと高くなるため（実測: 450 字は
  6段落なら弁が閉じたまま、8段落だと +83px @rail 390x844, Hiragino Sans,
  macOS Chromium）。上限は src/blocks.ts の MAX_CHARS。
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
  const email = c.get('user').email
  const back = (errors: Record<string, string>) =>
    c.html(<MemberForm email={email} errors={errors} values={asValues(values)} />, 400)

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
      slug: submitted.slug ?? '',
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
    slug: item?.slug ?? '',
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
  slug: string
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
          {/*
            この作品だけを指す URL。一覧の URL（/apps/3）は並べ替えるたびに
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
          <Field label="年" name="year" value={d.year} placeholder="2026 / 2024 —" />
          <Area
            label="説明文"
            name="summary"
            value={d.summary}
            rows={3}
            /*
              カードは2行で切る（--card-lines）。長く書いても画面から溢れはしない
              代わりに、溢れたぶんが黙って消える。狭い画面の 46 字を添えるのは、
              上限まで書けば全部読まれる、と読めてしまわないようにするため
            */
            hint={`「何であるか。何をしたか。」の2文 · ${MAX_CHARS.itemSummary} 字まで（カードは2行。狭い画面では ${MAX_CHARS.itemSummaryVisible} 字までしか出ません）`}
            maxlength={MAX_CHARS.itemSummary}
            error={props.errors?.summary}
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
    metricValue: str(form.get('metricValue')) || null,
    metricUnit: str(form.get('metricUnit')) || null,
    metricNote: str(form.get('metricNote')) || null,
    sortOrder: num(form.get('sortOrder'), 0),
    published: bool(form.get('published')),
    updatedAt: new Date().toISOString(),
  }
}

/*
  項目の中身のうち、公開ページで落ちる・切られるもの。

  説明文はカードの2行で切られる（--card-lines）。切られても画面からは溢れない
  ので no-scroll は壊れないが、書いたぶんが黙って消える。上限はいちばん広く
  出る姿でも届かない長さ（src/blocks.ts の MAX_CHARS.itemSummary）にしてある。
*/
function itemErrors(values: { title: string; summary: string }): Record<string, string> | null {
  if (!values.title) return { title: 'タイトルは必須です' }
  const total = chars(values.summary)
  if (total > MAX_CHARS.itemSummary) {
    return {
      summary: `カードに収まりません。説明文は ${MAX_CHARS.itemSummary} 字までです（いま ${total} 字）`,
    }
  }
  return null
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
  const errors = itemErrors(values) ?? (await slugTaken(db(c), values.slug, null))
  if (errors) {
    const { members, platforms } = await formContext(c)
    return c.html(
      <ItemForm
        email={c.get('user').email}
        type={values.type}
        members={members}
        platforms={platforms}
        submitted={submittedItem(form)}
        errors={errors}
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
  const errors = itemErrors(values) ?? (await slugTaken(db(c), values.slug, id))
  if (errors) {
    const { members, platforms } = await formContext(c)
    return c.html(
      <ItemForm
        email={c.get('user').email}
        type={values.type}
        members={members}
        platforms={platforms}
        item={{ ...existing, tags: [], links: [] }}
        submitted={submittedItem(form)}
        errors={errors}
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
        <p>
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
  画面の数を決める、公開中のものの件数。行そのものは引かない
  （数えるだけなら、カードの中身まで取ってくる必要が無い）。
*/
type SiteCounts = { apps: number; works: number; members: number }

async function siteCounts(database: ReturnType<typeof db>): Promise<SiteCounts> {
  const [apps, works, members] = await Promise.all([
    countPublishedItems(database, 'app'),
    countPublishedItems(database, 'work'),
    database
      .select({ n: count() })
      .from(schema.members)
      .where(eq(schema.members.published, 1))
      .then((rows) => rows[0]?.n ?? 0),
  ])
  return { apps, works, members }
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
  ?platform= を付けた URL はこれより少ない画面になることがある。
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
    case 'apps':
      return screenCount(counts.apps, perScreen)
    case 'works':
      return screenCount(counts.works, perScreen)
    case 'team':
      return screenCount(counts.members, perScreen)

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
  email: string
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
    <AdminLayout title="構成" active="blocks" email={props.email} flash={props.flash}>
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
                <li class="row" key={block.id}>
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
            <span class="presets__note">
              連なりのいちばん後ろに足される。置いてから前後に動かす
            </span>
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
      email={c.get('user').email}
      rows={rows}
      counts={counts}
      flash={c.req.query('saved') ? '保存しました' : c.req.query('deleted') ? '外しました' : null}
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
  email: string
  type: BlockType
  block?: schema.Block
  values?: Record<string, string>
  errors?: Record<string, string>
}) => {
  const { type, block } = props
  const value = (key: 'title' | 'body') =>
    props.values?.[key] ?? block?.[key] ?? (key === 'title' && 'title' in type ? type.title : '')
  // 入力エラーで描き直すとき、外した「公開する」も外したまま返す
  const published = props.values ? Number(props.values.published === '1') : (block?.published ?? 1)

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
  if (type?.kind !== 'free') return c.notFound()
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
      : blockLines(type.key, body).map((parts) =>
          (type.key === 'links' ? parts.filter((_, index) => index !== 1) : parts).join(''),
        )
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
  const email = c.get('user').email
  const stored = await listBlocks(db(c))
  // 0件のときサイトに出ているのは既定の並び。重複かどうかもそれで判断する
  const rows = stored.length ? stored : defaultBlocks()

  // 画面の数を数えるのは、一覧を描き直すときだけ。保存できた側では要らない
  if (!type) {
    return c.html(
      <BlocksPage
        email={email}
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
          email={email}
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
        <BlockForm email={email} type={type} values={asValues(values)} errors={errors} />,
        400,
      )
    }
  }

  /*
    ここまで来てから足す。0件なら、先に既定の並びを行にする。
    そうしないと、足した1つだけの DB になって、見えていた5節が消える
  */
  const current = await ensureBlocks(db(c))
  await db(c)
    .insert(schema.blocks)
    .values({
      type: type.key,
      ...(values ?? { published: 1 }),
      sortOrder: nextBlockOrder(current),
    })
  return c.redirect('/admin/blocks?saved=1', 303)
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
    return c.redirect('/admin/blocks?saved=1', 303)
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
  const dir = str(form.get('dir'))
  // 'up' 以外を全部「下へ」にすると、打ち間違いの POST でも並びが変わる
  if (dir !== 'up' && dir !== 'down') {
    return c.html(
      <BlocksPage
        email={c.get('user').email}
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
  return c.redirect('/admin/blocks', 303)
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
    <AdminLayout title="外す" active="blocks" email={c.get('user').email}>
      <Confirm
        title={`「${blockLabel(block)}」をトップから外しますか？`}
        detail={
          type?.kind === 'fixed'
            ? '中身（登録した項目やメンバー）は消えません。あとから「足す」で置き直せます。'
            : '打ち込んだ中身も消えます。'
        }
        action={`/admin/blocks/${id}/delete`}
        cancelHref="/admin/blocks"
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
