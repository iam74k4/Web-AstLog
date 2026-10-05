import { count, inArray, min } from 'drizzle-orm'
import { Hono } from 'hono'
import { blockShown } from '../../blocks'
import { defaultBlocks, listBlocks, loadSiteSettings, loadTheme } from '../../db/queries'
import * as schema from '../../db/schema'
import type { AppEnv } from '../../env'
import { SITE_SETTING_KEYS } from '../../site'
import { THEME_CHOICES } from '../../theme'
import { AdminDashboard, type DashboardAction, type DashboardCounts } from '../../ui/AdminDashboard'
import { db } from './request'

export const dashboardRoutes = new Hono<AppEnv>()

type CountRow = { published: number; total: number; firstId: number | null }

const countsOf = (rows: CountRow[]): DashboardCounts => {
  const published = rows
    .filter((row) => row.published === 1)
    .reduce((sum, row) => sum + row.total, 0)
  const draftRows = rows.filter((row) => row.published !== 1)
  const drafts = draftRows.reduce((sum, row) => sum + row.total, 0)
  const ids = draftRows.flatMap((row) => (row.firstId === null ? [] : [row.firstId]))
  return {
    published,
    drafts,
    total: published + drafts,
    firstDraft: ids.length ? Math.min(...ids) : null,
  }
}

// GET は状態を読むだけ。既定の構成を表示しても、初期行を勝手に保存しない。
dashboardRoutes.get('/', async (c) => {
  const database = db(c)
  const [memberRows, itemRows, blocks, site, theme, siteRows] = await Promise.all([
    database
      .select({
        published: schema.members.published,
        total: count(),
        firstId: min(schema.members.id),
      })
      .from(schema.members)
      .groupBy(schema.members.published),
    database
      .select({
        type: schema.items.type,
        published: schema.items.published,
        total: count(),
        firstId: min(schema.items.id),
      })
      .from(schema.items)
      .groupBy(schema.items.type, schema.items.published),
    listBlocks(database),
    loadSiteSettings(database),
    loadTheme(database),
    database
      .select({ key: schema.settings.key })
      .from(schema.settings)
      .where(
        inArray(
          schema.settings.key,
          SITE_SETTING_KEYS.map((key) => `site.${key}`),
        ),
      ),
  ])
  const members = countsOf(memberRows)
  const apps = countsOf(itemRows.filter((row) => row.type === 'app'))
  const works = countsOf(itemRows.filter((row) => row.type === 'work'))
  const items = countsOf(itemRows)
  const siteSaved = siteRows.length === SITE_SETTING_KEYS.length
  const effectiveBlocks = blocks.length ? blocks : defaultBlocks()
  const pages = effectiveBlocks.filter((block) =>
    blockShown(block, { members: members.published, items: items.published }),
  ).length
  const blockDrafts = blocks.filter((block) => block.published !== 1).length
  const shown = (type: string) =>
    effectiveBlocks.some(
      (block) =>
        block.type === type &&
        blockShown(block, { members: members.published, items: items.published }),
    )

  let next: DashboardAction
  if (pages === 0) {
    next = {
      title: '公開ページの構成を確認する',
      note: '現在、目次に表示するページはありません。出すページと下書きを構成から確認できます。',
      href: '/admin/blocks',
      label: '構成を開く',
    }
  } else if (!siteSaved) {
    next = {
      title: 'サイトの紹介文を確認する',
      note:
        siteRows.length === 0
          ? 'いまは既定の文章が使われています。紹介文と、載せる連絡先を整えられます。'
          : '紹介文と連絡先を確認できます。まだ保存していない項目には、既定の値が使われています。',
      href: '/admin/site',
      label: 'サイト設定を開く',
    }
  } else if (members.total === 0) {
    next = {
      title: 'プロフィールを追加する',
      note: '自分やチームの紹介を載せる場合は、名前と紹介文から始められます。',
      href: '/admin/members/new',
      label: 'プロフィールを追加',
    }
  } else if (members.published === 0 && members.firstDraft !== null) {
    next = {
      title: 'プロフィールの下書きを確認する',
      note: '登録したプロフィールは下書きです。内容を確認して、載せるものだけ公開できます。',
      href: `/admin/members/${members.firstDraft}/edit`,
      label: '下書きを編集',
    }
  } else if (items.total === 0) {
    next = {
      title: '最初の作品を追加する',
      note: '作品名と短い説明から始められます。途中の内容は下書きで保存できます。',
      href: '/admin/items/new?type=app',
      label: '個人開発を追加',
    }
  } else if (items.firstDraft !== null) {
    next = {
      title: '作品の下書きを確認する',
      note: `${items.drafts} 件の作品が下書きです。編集画面から、公開前の見た目も確認できます。`,
      href: `/admin/items/${items.firstDraft}/edit`,
      label: '下書きを編集',
    }
  } else if (members.firstDraft !== null) {
    next = {
      title: 'プロフィールの下書きを確認する',
      note: `${members.drafts} 件のプロフィールが下書きです。載せるものだけ公開できます。`,
      href: `/admin/members/${members.firstDraft}/edit`,
      label: '下書きを編集',
    }
  } else {
    next = {
      title: '公開画面を確認する',
      note: '保存済みの公開内容をまとめて確認できます。必要なところから、いつでも編集できます。',
      href: '/admin/preview',
      label: 'プレビューを開く ↗',
      newTab: true,
    }
  }

  return c.html(
    <AdminDashboard
      account={c.get('account')}
      next={next}
      members={members}
      apps={apps}
      works={works}
      profilesShown={shown('team')}
      projectsShown={shown('projects')}
      siteSaved={siteSaved}
      siteStarted={siteRows.length > 0}
      hasContact={Boolean(site.email || site.github)}
      blockCount={blocks.length}
      blockDrafts={blockDrafts}
      pages={pages}
      appearance={[
        THEME_CHOICES.accent.find((option) => option.key === theme.accent)?.label,
        THEME_CHOICES.typeface.find((option) => option.key === theme.typeface)?.label,
      ].join(' · ')}
    />,
  )
})
