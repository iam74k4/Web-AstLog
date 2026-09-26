import { and, asc, count, eq, ne } from 'drizzle-orm'
import type { BatchItem } from 'drizzle-orm/batch'
import type { Context } from 'hono'
import { Hono } from 'hono'
import { MAX_CHARS, MEMBER_PER_SCREEN, publishErrors, TIMELINE } from '../../blocks'
import type { Db } from '../../db/queries'
import * as schema from '../../db/schema'
import type { AppEnv } from '../../env'
import { newToken } from '../../lib/auth'
import { bool, isHttpsUrl, str } from '../../lib/format'
import { IMAGE_ACCEPT, IMAGE_LABELS } from '../../lib/image'
import { Area, Confirm, Field, FormActions, FormKey, PublishToggle } from '../../ui/AdminForm'
import { AdminLayout } from '../../ui/AdminLayout'
import { Avatar, StatusPill } from '../../ui/components'
import { ExternalIcon, PencilIcon, TrashIcon } from '../../ui/icons'
import { commitWithImage, imageNotKept, pickImage, putImage, removeImage } from './images'
import {
  asValues,
  cameFromEdit,
  db,
  flashFor,
  formKeyOf,
  mergeErrors,
  newFormKey,
  parseId,
  readSlug,
  readSortOrder,
  SLUG_MOVED,
  SLUG_TAKEN,
  savedParam,
  uniqueViolation,
} from './request'

export const memberRoutes = new Hono<AppEnv>()

memberRoutes.get('/members', async (c) => {
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
            error={props.errors?.headline}
            hint={`個人ページの一番上。言い切りで · ${MAX_CHARS.memberHeadline} 字まで`}
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
            error={props.errors?.careerText}
            hint={`1行に1件。「期間 | 肩書き | 所属」 · ${MEMBER_PER_SCREEN.career} 行ごとに1画面、1画面 ${TIMELINE.maxChars} 字まで`}
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

memberRoutes.get('/members/new', (c) =>
  c.html(<MemberForm account={c.get('account')} formKey={newFormKey()} />),
)

memberRoutes.get('/members/:id/edit', async (c) => {
  const member = await db(c).query.members.findFirst({
    where: eq(schema.members.id, Number(c.req.param('id'))),
  })
  if (!member) return c.notFound()
  return c.html(<MemberForm account={c.get('account')} member={member} />)
})

function readMemberForm(form: FormData, existing?: schema.Member) {
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

async function memberSlugTaken(
  database: Db,
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
  database: Db,
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

memberRoutes.post('/members', async (c) => {
  const database = db(c)
  const form = await c.req.formData()
  const sent = formKeyOf(form)
  // 同じ札で書いた行（newFormKey の注記）
  const twinOf = (key: string | null) =>
    key ? database.query.members.findFirst({ where: eq(schema.members.formKey, key) }) : undefined
  /*
    同じフォームの2度目の送信は、1度目が作った人への保存（作品の POST /items と同じ。
    中身が違えば編集として反映し、公開の関門も通す）
  */
  const twin = await twinOf(sent)
  if (twin) return saveMember(c, twin, form, true)

  const { values, errors: unreadable, typed } = readMemberForm(form)
  const account = c.get('account')
  const saved = () => c.redirect(`/admin/members?saved=${savedParam(values.published)}`, 303)
  const back = (errors: Record<string, string>) =>
    c.html(
      <MemberForm
        account={account}
        formKey={sent}
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
    values.published
      ? publishErrors({
          kind: 'member',
          headline: values.headline,
          bio: values.bio,
          careerText: values.careerText,
        })
      : null,
    await memberSlugTaken(database, values.slug, null),
  )
  if (errors) return back(errors)

  // 検査が全部通ってから KV に置き、D1 が落ちたら置いた画像を消す（commitWithImage）
  const avatarUrl = picked.image
    ? await putImage(c.env.MEDIA, picked.image, 'avatars', values.slug)
    : null
  try {
    await commitWithImage(c.env.MEDIA, avatarUrl, () =>
      database.insert(schema.members).values({ ...values, avatarUrl, formKey: sent }),
    )
  } catch (error) {
    // 検査のあとに同じ札・同じ slug が先に書かれた（同時に来た2本の送信）
    if (uniqueViolation(error, 'members.')) {
      const first = await twinOf(sent)
      if (first) return saveMember(c, first, form, true)
      if (uniqueViolation(error, 'members.slug')) return back({ slug: SLUG_TAKEN })
    }
    throw error
  }
  return saved()
})

memberRoutes.post('/members/:id', async (c) => {
  const id = parseId(c.req.param('id'))
  if (!id) return c.notFound()
  const member = await db(c).query.members.findFirst({ where: eq(schema.members.id, id) })
  if (!member) return c.notFound()
  return saveMember(c, member, await c.req.formData(), false)
})

/*
  既にある人への保存。編集フォームの送信と、追加のフォームの2度目の送信（again）の
  両方がここを通る（作品の saveItem と同じ）。
*/
async function saveMember(
  c: Context<AppEnv>,
  member: schema.Member,
  form: FormData,
  again: boolean,
) {
  const id = member.id
  const database = db(c)
  const { values, errors: unreadable, typed } = readMemberForm(form, member)
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
    values.published
      ? publishErrors({
          kind: 'member',
          headline: values.headline,
          bio: values.bio,
          careerText: values.careerText,
        })
      : null,
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
  return c.redirect(
    `/admin/members?saved=${savedParam(values.published)}${moved}${again ? '&again=1' : ''}`,
    303,
  )
}

memberRoutes.get('/members/:id/delete', async (c) => {
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

memberRoutes.post('/members/:id/delete', async (c) => {
  const id = parseId(c.req.param('id'))
  if (!id) return c.notFound()
  const member = await db(c).query.members.findFirst({ where: eq(schema.members.id, id) })
  if (!member) return c.notFound()

  await db(c).delete(schema.members).where(eq(schema.members.id, id))
  await removeImage(c.env.MEDIA, member.avatarUrl)
  return c.redirect('/admin/members?deleted=1', 303)
})
