import { asc, eq } from 'drizzle-orm'
import { type Context, Hono } from 'hono'
import type { Child } from 'hono/jsx'
import { blockType, publishErrors } from '../../blocks'
import {
  findAdminItemView,
  listBlocks,
  listPublishedItems,
  listPublishedMembers,
  loadSiteSettings,
  loadTheme,
  publishedBlocks,
} from '../../db/queries'
import * as schema from '../../db/schema'
import { ITEM_KIND_KEYS, type ItemView, type KindCounts } from '../../domain'
import type { AppEnv } from '../../env'
import { bool, str, yearFrom } from '../../lib/format'
import { SITE_SETTING_KEYS, type SiteSettings, siteSettingsErrors } from '../../site'
import { isThemeValue, normalizeTheme, THEME_KEYS, type ThemeKey } from '../../theme'
import {
  Band,
  Empty,
  filterQuery,
  itemHref,
  Screen,
  SectionHead,
  SiteIdentity,
} from '../../ui/components'
import type { NavItem } from '../../ui/Layout'
import { PreviewLayout, type PreviewLayoutProps } from '../../ui/PreviewLayout'
import { renderBlock } from '../public/blocks'
import {
  bandOf,
  kindsOf,
  NO_FILTER,
  profileOf,
  readFilter,
  showMemberOf,
  soloMember,
  type TopData,
} from '../public/data'
import { itemPage } from '../public/item'
import { memberHref, memberPage } from '../public/member-page'
import { pageTitle, siteDescription } from '../public/meta'
import { type PickedImage, pickImage } from './images'
import {
  formContext,
  imageColumns,
  itemSlugTaken,
  itemValueErrors,
  readItemForm,
  readLinks,
  readNewShots,
  readShotEdits,
  shotPlan,
} from './items'
import { memberErrors, memberSlugTaken, readMemberForm } from './members'
import { db, formKeyOf, mergeErrors, parseId } from './request'

export const previewRoutes = new Hono<AppEnv>()

// このルート群は認証・同一Origin・フォーム読取の後、touchSiteOnWrite の前に登録する。
// 保存関数・画像アップロード・初期ブロック作成は呼ばない。
async function snapshot(c: Context<AppEnv>) {
  const database = db(c)
  const [members, items, theme, blocks, site] = await Promise.all([
    listPublishedMembers(database),
    listPublishedItems(database),
    loadTheme(database),
    publishedBlocks(database),
    loadSiteSettings(database),
  ])
  const counts = Object.fromEntries(
    ITEM_KIND_KEYS.map((kind) => [kind, items.filter((item) => item.type === kind).length]),
  ) as KindCounts
  const since = items.reduce<number | null>(
    (oldest, item) =>
      item.yearFrom !== null && (oldest === null || item.yearFrom < oldest)
        ? item.yearFrom
        : oldest,
    null,
  )
  const data: TopData = {
    site,
    members,
    projects: { total: items.length, rows: items, since },
    counts,
    kinds: kindsOf(counts),
    filter: NO_FILTER,
    showMember: showMemberOf(blocks, members),
    band: bandOf(blocks, counts),
    profile: profileOf(blocks, members),
  }
  return { database, members, items, theme, blocks, site, data }
}

type Snapshot = Awaited<ReturnType<typeof snapshot>>
type PreviewScreen = 'hero' | 'projects' | 'team' | 'contact' | 'all'
const SCREENS: readonly PreviewScreen[] = ['hero', 'projects', 'team', 'contact', 'all']
const READ_SCREENS = SCREENS
const PRIVATE_PROJECTS = '/admin/preview/projects'
const SCREEN_LABELS = {
  hero: '入口',
  projects: 'Projects',
  contact: 'Contact',
  team: 'Team',
  all: '全体',
}

function previewNav(saved: Snapshot): NavItem[] {
  const nav: NavItem[] = []
  let position = 0
  for (const block of saved.blocks) {
    if (block.type === 'team' && saved.data.profile) {
      nav.push({ href: `/admin/preview/members/${saved.data.profile.id}`, label: 'Profile' })
      position += 1
      continue
    }
    const rendered = renderBlock(block, saved.data, false)
    if (!rendered) continue
    if (!(position === 0 && block.type === 'hero') && rendered.nav) {
      nav.push({
        href:
          block.type === 'projects'
            ? `${PRIVATE_PROJECTS}${filterQuery(saved.data.filter)}`
            : block.id
              ? `/admin/preview/blocks/${block.id}`
              : `/admin/preview?screen=${block.type}`,
        label: rendered.nav,
      })
    }
    position += 1
  }
  return nav
}

const footer = (saved: Snapshot) => (
  <SiteIdentity site={saved.site} solo={soloMember(saved.members)} />
)

function emptyBlock(block?: schema.Block) {
  const title = block ? block.title || blockType(block.type)?.label || 'プレビュー' : 'プレビュー'
  return (
    <Screen id="preview-empty" label={title}>
      <SectionHead title={title} h1 />
      <Empty>公開対象の内容がありません。構成や公開中のメンバー・項目を確認してください。</Empty>
    </Screen>
  )
}

function blockNode(saved: Snapshot, block: schema.Block): { node: Child; description: string } {
  // 下書きブロックも単体だけ確認する。公開フラグを変えるのはメモリ内の複製だけ。
  const visible = { ...block, published: 1 }
  const data = {
    ...saved.data,
    profile: block.type === 'team' ? soloMember(saved.members) : saved.data.profile,
  }
  if (block.type === 'team' && data.profile) return memberPage(data.profile, null, saved.site)
  const rendered = renderBlock(visible, data, false, { projectsBase: PRIVATE_PROJECTS })
  return rendered ?? { node: emptyBlock(block), description: '表示できる内容がありません' }
}

function renderSnapshot(
  c: Context<AppEnv>,
  saved: Snapshot,
  screen: (typeof READ_SCREENS)[number],
  options: Pick<PreviewLayoutProps, 'editHref' | 'unsaved'>,
) {
  if (screen === 'all') {
    const data = { ...saved.data, band: null }
    const sections = saved.blocks
      .map((block) => renderBlock(block, data, true))
      .filter((section) => section !== null)
    const nav = sections
      .filter((section) => section.nav !== null && section.toc)
      .map((section) => ({ href: `#${section.id}`, label: section.nav ?? '' }))
    return c.html(
      <PreviewLayout
        title={pageTitle('全体')}
        description={siteDescription(soloMember(saved.members), saved.site)}
        label="全体"
        nav={nav}
        theme={saved.theme}
        footer={footer(saved)}
        publicHref="/all"
        whole
        {...options}
      >
        {sections.map((section) => section.node)}
      </PreviewLayout>,
    )
  }
  if (screen === 'projects') {
    // 公開一覧と同じフィルタ。対象は保存済み・公開中の人と作品だけ。
    const { filter, memberId } = readFilter(c, saved.data.kinds, saved.members)
    const rows = saved.items.filter(
      (item) =>
        (!filter.kind || item.type === filter.kind) && (!memberId || item.memberId === memberId),
    )
    saved = {
      ...saved,
      data: {
        ...saved.data,
        filter,
        projects: {
          ...saved.data.projects,
          rows,
          numbers: new Map(saved.items.map((item, index) => [item.id, index + 1])),
        },
      },
    }
  }
  const block = saved.blocks.find((one) => one.type === screen)
  const rendered = block ? blockNode(saved, block) : null
  const label = screen === 'team' && saved.data.profile ? 'Profile' : SCREEN_LABELS[screen]
  return c.html(
    <PreviewLayout
      title={pageTitle(label)}
      description={rendered?.description ?? '表示できる内容がありません'}
      label={label}
      // 未保存の値はこの応答だけにある。移動で値が消えることを避け、目次を出さない。
      nav={options.unsaved ? [] : previewNav(saved)}
      theme={saved.theme}
      footer={footer(saved)}
      publicHref={screen === 'hero' ? '/' : `/${screen}`}
      {...options}
    >
      {rendered?.node ?? emptyBlock(block)}
    </PreviewLayout>,
  )
}

async function postedForm(c: Context<AppEnv>) {
  try {
    return await c.req.formData()
  } catch {
    return null
  }
}

previewRoutes.get('/preview', async (c) => {
  const asked = c.req.query('screen') ?? 'all'
  const screen = READ_SCREENS.find((one) => one === asked)
  if (!screen) return c.notFound()
  return renderSnapshot(c, await snapshot(c), screen, { editHref: '/admin' })
})

previewRoutes.get('/preview/projects', async (c) =>
  renderSnapshot(c, await snapshot(c), 'projects', { editHref: '/admin/items' }),
)

function memberResponse(
  c: Context<AppEnv>,
  saved: Snapshot,
  member: schema.Member,
  options: Pick<PreviewLayoutProps, 'editHref' | 'unsaved' | 'warnings'>,
) {
  // この人物ページの名乗りだけ、保存した場合の公開人数・氏名・肩書きで確認する。
  // 他のGETや全体プレビューへ仮のメンバーを渡さない。
  const members = options.unsaved
    ? [
        ...saved.members.filter((one) => one.id !== member.id),
        ...(member.published === 1 ? [member] : []),
      ]
    : saved.members
  const memberContext = {
    ...saved,
    members,
    data: { ...saved.data, members, profile: profileOf(saved.blocks, members) },
  }
  const counts = Object.fromEntries(
    ITEM_KIND_KEYS.map((kind) => [
      kind,
      saved.items.filter((item) => item.type === kind && item.memberId === member.id).length,
    ]),
  ) as KindCounts
  const publishedMember = saved.members.find((one) => one.id === member.id)
  const band =
    !publishedMember || memberContext.data.profile?.id === member.id
      ? null
      : bandOf(saved.blocks, counts)
  const page = memberPage(
    member,
    band ? (
      <Band
        href={`${PRIVATE_PROJECTS}${filterQuery({
          kind: null,
          member: saved.members.length > 1 ? (publishedMember?.slug ?? null) : null,
        })}`}
        label="このメンバーのつくったもの"
        counts={band.counts}
      />
    ) : null,
    saved.site,
  )
  return c.html(
    <PreviewLayout
      title={pageTitle(member.name)}
      description={page.description}
      label={member.name}
      publicHref={!options.unsaved && member.published === 1 ? memberHref(member.slug) : undefined}
      draft={member.published !== 1}
      nav={options.unsaved ? [] : previewNav(saved)}
      theme={saved.theme}
      footer={footer(memberContext)}
      {...options}
    >
      {page.node}
    </PreviewLayout>,
  )
}

function itemResponse(
  c: Context<AppEnv>,
  saved: Snapshot,
  item: ItemView,
  options: Pick<PreviewLayoutProps, 'editHref' | 'unsaved' | 'warnings'>,
) {
  const page = itemPage(item, {
    backHref: !options.unsaved && saved.data.band ? '/admin/preview?screen=projects' : undefined,
    memberHref:
      saved.data.showMember && item.memberId
        ? `/admin/preview/members/${item.memberId}`
        : undefined,
  })
  return c.html(
    <PreviewLayout
      title={pageTitle(item.title)}
      description={page.description}
      label={item.title}
      publicHref={
        !options.unsaved && item.published === 1 ? (itemHref(item) ?? undefined) : undefined
      }
      draft={item.published !== 1}
      nav={options.unsaved ? [] : previewNav(saved)}
      theme={saved.theme}
      footer={footer(saved)}
      {...options}
    >
      {page.node}
    </PreviewLayout>,
  )
}

previewRoutes.get('/preview/members/:id', async (c) => {
  const id = parseId(c.req.param('id'))
  if (!id) return c.notFound()
  const saved = await snapshot(c)
  const member = await saved.database.query.members.findFirst({ where: eq(schema.members.id, id) })
  if (!member) return c.notFound()
  return memberResponse(c, saved, member, { editHref: `/admin/members/${id}/edit` })
})

previewRoutes.get('/preview/items/:id', async (c) => {
  const id = parseId(c.req.param('id'))
  if (!id) return c.notFound()
  const saved = await snapshot(c)
  const item = await findAdminItemView(saved.database, id)
  if (!item) return c.notFound()
  return itemResponse(c, saved, item, { editHref: `/admin/items/${id}/edit` })
})

// 種類・容量を検査した画像の bytes だけから作る。この応答内に閉じ、KVに置かない。
function imageDataUrl(image: PickedImage) {
  const bytes = new Uint8Array(image.bytes)
  const parts: string[] = []
  for (let at = 0; at < bytes.length; at += 8192) {
    parts.push(String.fromCharCode(...bytes.subarray(at, at + 8192)))
  }
  return `data:${image.type};base64,${btoa(parts.join(''))}`
}

export async function validationFailure(
  c: Context<AppEnv>,
  errors: Record<string, string>,
  editHref: string,
) {
  const saved = await snapshot(c)
  return c.html(
    <PreviewLayout
      title={pageTitle('入力の確認')}
      description="入力を確認してください"
      label="入力の確認"
      editHref={editHref}
      unsaved
      nav={[]}
      theme={saved.theme}
      footer={footer(saved)}
    >
      <Screen id="preview-errors" label="入力の確認">
        <SectionHead title="入力を確認してください" h1 />
        <Empty>
          編集していたタブに戻り、入力を修正してください。{Object.values(errors).join('。')}
        </Empty>
      </Screen>
    </PreviewLayout>,
    400,
  )
}

async function memberPreviewPost(c: Context<AppEnv>, askedId?: string) {
  const id = askedId === undefined ? null : parseId(askedId)
  if (askedId !== undefined && !id) return c.notFound()
  const database = db(c)
  const form = await postedForm(c)
  if (!form) return c.text('フォームを読み取れませんでした。編集画面から再送してください。', 400)
  const sent = formKeyOf(form)
  const existing = id
    ? await database.query.members.findFirst({ where: eq(schema.members.id, id) })
    : sent
      ? await database.query.members.findFirst({ where: eq(schema.members.formKey, sent) })
      : undefined
  if (id && !existing) return c.notFound()
  const { values, errors: unreadable } = readMemberForm(form, existing)
  const picked = await pickImage(form, 'avatar')
  const editHref = existing ? `/admin/members/${existing.id}/edit` : '/admin/members/new'
  const errors = mergeErrors(
    unreadable,
    memberErrors(values),
    picked.error ? { avatar: picked.error } : null,
    await memberSlugTaken(database, values.slug, existing?.id ?? null),
  )
  if (errors) return validationFailure(c, errors, editHref)
  const member: schema.Member = {
    id: existing?.id ?? 0,
    formKey: existing?.formKey ?? null,
    createdAt: existing?.createdAt ?? '',
    ...values,
    avatarUrl: picked.image ? imageDataUrl(picked.image) : (existing?.avatarUrl ?? null),
  }
  return memberResponse(c, await snapshot(c), member, {
    editHref,
    unsaved: true,
    warnings: values.published
      ? publishErrors({ kind: 'member', headline: values.headline })
      : null,
  })
}

async function itemPreviewPost(c: Context<AppEnv>, askedId?: string) {
  const id = askedId === undefined ? null : parseId(askedId)
  if (askedId !== undefined && !id) return c.notFound()
  const database = db(c)
  const form = await postedForm(c)
  if (!form) return c.text('フォームを読み取れませんでした。編集画面から再送してください。', 400)
  const sent = formKeyOf(form)
  const twin =
    !id && sent
      ? await database.query.items.findFirst({ where: eq(schema.items.formKey, sent) })
      : undefined
  const existing = id || twin ? await findAdminItemView(database, id ?? twin?.id ?? 0) : undefined
  if (id && !existing) return c.notFound()
  const context = await formContext(c)
  const { values, tags, errors: unreadable } = readItemForm(form, context, existing ?? undefined)
  const existingShots = existing
    ? await database.query.itemShots.findMany({
        where: eq(schema.itemShots.itemId, existing.id),
        orderBy: [asc(schema.itemShots.sortOrder), asc(schema.itemShots.id)],
      })
    : []
  const picked = await pickImage(form, 'image')
  const icon = await pickImage(form, 'icon')
  const shots = await readNewShots(form)
  const read = readShotEdits(form, existingShots)
  const added = twin && existingShots.length ? [] : shots.added
  const plan = shotPlan(read.edits, added)
  const links = readLinks(form)
  const editHref = existing
    ? `/admin/items/${existing.id}/edit`
    : `/admin/items/new?type=${values.type}`
  const errors = mergeErrors(
    unreadable,
    itemValueErrors(values),
    picked.error ? { image: picked.error } : null,
    icon.error ? { icon: icon.error } : null,
    read.error,
    shots.error,
    plan.error,
    links.error ? { links: links.error } : null,
    await itemSlugTaken(database, values.slug, existing?.id ?? null),
  )
  if (errors) return validationFailure(c, errors, editHref)
  const columns = picked.image
    ? imageColumns(imageDataUrl(picked.image), picked.image)
    : bool(form.get('removeImage')) === 1
      ? imageColumns(null, null)
      : {
          imageUrl: existing?.imageUrl ?? null,
          imageWidth: existing?.imageWidth ?? null,
          imageHeight: existing?.imageHeight ?? null,
        }
  const member = context.members.find((one) => one.id === values.memberId && one.published === 1)
  const item: ItemView = {
    id: existing?.id ?? 0,
    formKey: existing?.formKey ?? null,
    createdAt: existing?.createdAt ?? '',
    ...values,
    yearFrom: yearFrom(values.year),
    ...columns,
    iconUrl: icon.image
      ? imageDataUrl(icon.image)
      : bool(form.get('removeIcon')) === 1
        ? null
        : (existing?.iconUrl ?? null),
    tags,
    links: links.links,
    platformLabel: context.platforms.find((one) => one.key === values.platformKey)?.label ?? null,
    memberName: member?.name ?? null,
    memberSlug: member?.slug ?? null,
    shots: [
      ...plan.kept.map((edit) => ({ ...edit.shot, alt: edit.alt })),
      ...added.map((shot) => ({
        url: imageDataUrl(shot.image),
        alt: shot.alt,
        width: shot.image.width ?? null,
        height: shot.image.height ?? null,
      })),
    ],
  }
  return itemResponse(c, await snapshot(c), item, {
    editHref,
    unsaved: true,
    warnings: values.published
      ? publishErrors({
          kind: 'item',
          title: values.title,
          summary: values.summary,
          imageAlt: values.imageAlt,
          hasImage: columns.imageUrl !== null,
          shots: plan.gate,
        })
      : null,
  })
}

previewRoutes.post('/preview/members', (c) => memberPreviewPost(c))
previewRoutes.post('/preview/members/:id', (c) => memberPreviewPost(c, c.req.param('id')))
previewRoutes.post('/preview/items', (c) => itemPreviewPost(c))
previewRoutes.post('/preview/items/:id', (c) => itemPreviewPost(c, c.req.param('id')))

export async function renderBlockPreview(
  c: Context<AppEnv>,
  block: schema.Block,
  options: {
    editHref: string
    unsaved?: boolean
    draft?: boolean
    warnings?: Record<string, string> | null
  },
) {
  const saved = await snapshot(c)
  const page = blockNode(saved, block)
  const title = block.title || blockType(block.type)?.label || 'ブロック'
  return c.html(
    <PreviewLayout
      title={pageTitle(title)}
      description={page.description}
      label={title}
      editHref={options.editHref}
      unsaved={options.unsaved}
      warnings={options.warnings}
      draft={options.draft ?? block.published !== 1}
      nav={options.unsaved ? [] : previewNav(saved)}
      theme={saved.theme}
      footer={footer(saved)}
    >
      {page.node}
    </PreviewLayout>,
  )
}

previewRoutes.get('/preview/blocks/:id', async (c) => {
  const id = parseId(c.req.param('id'))
  if (!id) return c.notFound()
  const block = (await listBlocks(db(c))).find((one) => one.id === id)
  if (!block) return c.notFound()
  return renderBlockPreview(c, block, { editHref: `/admin/blocks/${id}/edit` })
})

previewRoutes.post('/preview/site', async (c) => {
  const form = await postedForm(c)
  if (!form) return c.text('フォームを読み取れませんでした。編集画面から再送してください。', 400)
  const site = Object.fromEntries(
    SITE_SETTING_KEYS.map((key) => [key, str(form.get(key))]),
  ) as SiteSettings
  const screen = SCREENS.find((one) => one === (str(form.get('previewScreen')) || 'hero'))
  const errors = siteSettingsErrors(site)
  const labels: Record<keyof SiteSettings, string> = {
    tagline: 'サイトの一言',
    heroLead: '入口の紹介文',
    contactLead: 'Contact の案内文',
    email: '公開するメールアドレス',
    github: '公開する GitHub URL',
  }
  const previewErrors: Record<string, string> = {}
  for (const key of SITE_SETTING_KEYS) {
    if (errors?.[key]) previewErrors[key] = `${labels[key]}: ${errors[key]}`
  }
  if (!screen) previewErrors.previewScreen = 'プレビューする画面を選び直してください'
  if (errors || !screen) return validationFailure(c, previewErrors, '/admin/site')
  const saved = await snapshot(c)
  return renderSnapshot(c, { ...saved, site, data: { ...saved.data, site } }, screen, {
    editHref: '/admin/site',
    unsaved: true,
  })
})

previewRoutes.post('/preview/appearance', async (c) => {
  const form = await postedForm(c)
  if (!form) return c.text('フォームを読み取れませんでした。編集画面から再送してください。', 400)
  const picked = Object.fromEntries(THEME_KEYS.map((key) => [key, str(form.get(key))])) as Record<
    ThemeKey,
    string
  >
  const screen = SCREENS.find((one) => one === (str(form.get('previewScreen')) || 'hero'))
  const errors: Record<string, string> = {}
  for (const key of THEME_KEYS) {
    if (!isThemeValue(key, picked[key]))
      errors[key] = `${key === 'accent' ? 'アクセント色' : '書体'}を選び直してください`
  }
  if (!screen) errors.previewScreen = 'プレビューする画面を選び直してください'
  if (!screen || Object.keys(errors).length)
    return validationFailure(c, errors, '/admin/appearance')
  const saved = await snapshot(c)
  return renderSnapshot(c, { ...saved, theme: normalizeTheme(picked) }, screen, {
    editHref: '/admin/appearance',
    unsaved: true,
  })
})
