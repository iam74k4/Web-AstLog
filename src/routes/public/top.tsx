import { drizzle } from 'drizzle-orm/d1'
import type { Context } from 'hono'
import {
  countPublishedByKind,
  listPublishedItems,
  listPublishedMembers,
  loadSiteSettings,
  loadTheme,
  publishedBlocks,
} from '../../db/queries'
import * as schema from '../../db/schema'
import { ITEM_KIND_KEYS, type KindCounts } from '../../domain'
import type { AppEnv } from '../../env'
import { tableOfContents } from '../../lib/sequence'
import { SITE } from '../../site'
import { Empty, SiteIdentity } from '../../ui/components'
import { Layout, type NavItem } from '../../ui/Layout'
import { renderBlock } from './blocks'
import {
  kindsOf,
  NO_FILTER,
  profileOf,
  readFilter,
  showMemberOf,
  soloMember,
  type TopData,
} from './data'
import { memberHref } from './member-page'
import {
  describe,
  joinParts,
  nameWithRole,
  pageTitle,
  siteDescription,
  siteJsonLd,
  siteTitle,
} from './meta'
import { adminHref, blockAdminPath, firstOnly, movedTo, screenPage } from './page'
import { pageRows, sitePageLinks, sitePages } from './site'

/*
  公開ブロックを1つのドキュメントに縦に積んだ「全体ページ」（/all）の描画。

  印刷・Ctrl-F・ブラウザ翻訳の宛先、オーナーが全体を通しで点検する手段、
  そしてページごとの組み立てが効かない環境での退避先を、これ1本でまかなう。
  節を縦に積んだ1本の文書で、表紙の高さも貼り付く帯も持たない（body[data-whole]）。
*/
export async function renderWholePage(c: Context<AppEnv>) {
  const db = drizzle(c.env.DB, { schema })
  const [members, items, theme, blocks, site] = await Promise.all([
    listPublishedMembers(db),
    listPublishedItems(db),
    loadTheme(db),
    publishedBlocks(db),
    loadSiteSettings(db),
  ])

  /*
    このページだけは絞り込まない。全部を1ページに載せるのが役目なので、
    ?kind= も ?member= も読まない（絞り込みの手はページごとの URL へのリンクとして
    残る）。
  */
  const counts = Object.fromEntries(
    ITEM_KIND_KEYS.map((kind) => [kind, items.filter((item) => item.type === kind).length]),
  ) as KindCounts
  const data: TopData = {
    site,
    members,
    kinds: kindsOf(counts),
    filter: NO_FILTER,
    showMember: showMemberOf(blocks, members),
    projects: { total: items.length, rows: items },
    counts,
    // このページには一覧そのものがすぐ下に並ぶ。送り出す先が無いので帯は置かない
    band: null,
    // 1人のサイトなら、Team の節の代わりにプロフィールを置く
    profile: profileOf(blocks, members),
  }

  // 管理の「構成」で置いた順に描く。中身の無い節は落ちる（whole: 1つの文書の節として）
  const sections = blocks
    .map((block) => renderBlock(block, data, true))
    .filter((section) => section !== null)
  const nav: NavItem[] = sections
    .filter((section) => section.nav !== null && section.toc)
    .map((section) => ({ href: `#${section.id}`, label: section.nav ?? '' }))

  const solo = soloMember(members)

  return c.html(
    <Layout
      // 入口と同じ題にしない（履歴と検索結果で、全体版を選び直せるように）
      title={solo ? pageTitle(nameWithRole(solo), '全体') : pageTitle('全体')}
      /*
        中身が全部ある唯一のページなので、説明文もそれを言う。並べるのは
        実際に描いた節の名前——固定の一覧を書くと、節を1つ外した日にここだけ
        古い名前を出し続ける
      */
      description={describe(
        joinParts(
          nav.length
            ? `${nav.map((item) => item.label).join(' · ')} を1ページにまとめた全体版です`
            : '',
          siteDescription(solo, site),
        ),
      )}
      /*
        正はこのページ自身。ページごとの URL がそれぞれ自分を正と名乗っているので、
        中身が全部ある唯一のページも自分を名乗る（/ を正にすると、完全版を
        「作品を1件も含まないトップの複製」と申告することになる）。
      */
      canonical={`${SITE.origin}/all`}
      jsonLd={siteJsonLd(members, site)}
      nav={nav}
      theme={theme}
      // 節を縦に積んだ1本の文書。app.css の「ページの外枠」を外す印
      whole
      /*
        足元で名乗る。Hero の h1 は同じページにあるが、印刷した紙の
        終わりや Ctrl-F で飛んだ先では、足元が誰のサイトかを言う
      */
      footer={<SiteIdentity site={site} solo={solo} />}
      // 全部の節が並ぶページなので、節の並び（構成）へ送る
      admin={await adminHref(c, '/admin/blocks')}
    >
      {sections.map((section) => section.node)}
    </Layout>,
  )
}

/*
  /profile。目次の「Profile」の行（1人のサイトのプロフィール）を、その名前のとおりの URL でも
  開けるようにする。行き先は目次の行き先と同じその人のページ（profileOf・memberHref）。

  プロフィールの無いサイト（2人以上・Team を置いていない）では 404——目次にも Profile の
  行が無く、送る先が1つに決まらない。行き先がデータで変わる（2人目を公開した日に無くなる）
  ので、ブラウザに覚えさせない（movedTo。/team の 301 と同じ）。
*/
export async function renderProfileAlias(c: Context<AppEnv>) {
  const db = drizzle(c.env.DB, { schema })
  const [members, blocks] = await Promise.all([listPublishedMembers(db), publishedBlocks(db)])
  const profile = profileOf(blocks, members)
  return profile ? movedTo(c, memberHref(profile.slug)) : c.notFound()
}

/*
  ブロック1つぶんのページの描画。公開ページの本体。

  slug が null ならトップ（並びの先頭）。そうでなければ URL が名指ししたページで、
  見つからなければ 404。知らないページの名前も、中身が無くて出ていないブロックも
  「その URL は無い」の一言に落とす。
*/
export async function renderScreen(c: Context<AppEnv>, slug: string | null) {
  const db = drizzle(c.env.DB, { schema })
  const [members, byKind, theme, blocks, site] = await Promise.all([
    listPublishedMembers(db),
    countPublishedByKind(db),
    loadTheme(db),
    publishedBlocks(db),
    loadSiteSettings(db),
  ])

  const solo = soloMember(members)
  /*
    1人のサイトで Team を置いているあいだ、Team のページは無い——その位置には
    その人のプロフィールが並ぶ（profileOf）。貼られた /team は死なせずにその人の
    ページへ寄せる。

    2人目を公開した日に /team はまた 200 に戻る。行き先がデータで変わる転送なので、
    ブラウザには覚えさせない（movedTo）——覚えさせていたころは、2人目を公開した
    あとも、一度寄せられた人だけが Team へ着けずにプロフィールへ運ばれ続けた。
  */
  const profile = profileOf(blocks, members)
  if (slug === 'team' && profile) {
    return movedTo(c, memberHref(profile.slug))
  }

  const { filter, memberId } = readFilter(c, kindsOf(byKind), members)
  const { pages, counted } = await sitePages(db, blocks, members, filter, byKind, site)

  /*
    出せるページが1つも無いとき（置いたブロックが全部下書き、など）。
    トップだけは 200 で「まだ何もありません」を出す。サイトの入口まで 404 に
    すると、管理画面に入って直す前に手詰まりになる。ほかの URL は素直に 404。
  */
  if (!pages.length) {
    if (slug) return c.notFound()
    return c.html(
      <Layout
        title={siteTitle(solo)}
        description={siteDescription(solo, site)}
        canonical={`${SITE.origin}/`}
        nav={[]}
        theme={theme}
        footer={<SiteIdentity site={site} solo={solo} />}
        // 何も出ていないのは、構成に公開中のブロックが無いから。直す場所はそこ
        admin={await adminHref(c, '/admin/blocks')}
      >
        <Empty>まだ何も置いていません</Empty>
      </Layout>,
    )
  }

  const links = sitePageLinks(pages, filter, solo)
  /*
    並びの先頭がプロフィール（1人のサイトで Hero を外し、Team を先頭に置いた
    構成）。そのページは /members/<slug> にあり、描くのも個人ページの経路
    なので、入口はそこへ送る。構成しだいで変わる行き先なので 302。
  */
  const [first] = pages
  const head = links[0]
  if (!slug && first?.kind === 'profile' && head) return c.redirect(head.href, 302)

  /*
    入口は / と /<slug>（いまなら /hero）の2つで開ける。並びの中では / に
    寄せてあるので、/<slug> で来たぶんも同じページに当てる——同じ1枚なので、
    404 にはしない。canonical は sitePageLinks が / を指している。
    そのページに効かない絞り込みを付けて来た URL（手で打った /contact?kind=work）も
    同じページに当たる（ページは slug で引く。目次の行き先には pageQuery が付けない）。
  */
  const index =
    slug === null ? 0 : pages.findIndex((page) => page.kind === 'block' && page.slug === slug)
  const current = pages[index]
  const link = links[index]
  // プロフィールのページは /members/<slug> にしか無いので、ここでは当たらない
  if (!link || current?.kind !== 'block') return c.notFound()

  // ここで初めて作品の行を引く（一覧と、入口の件数の帯）。ほかのページでは1件も取ってこない
  const listed = await pageRows(db, current, filter, memberId)
  const data: TopData = { ...counted, projects: { ...counted.projects, ...listed } }

  const rendered = renderBlock(current.block, data, false)
  // sitePages が並べたページなので、ここで null は返らない
  if (!rendered) return c.notFound()

  return screenPage(c, {
    title: link.title,
    canonical: link.canonical,
    nav: tableOfContents(links, link.key),
    node: rendered.node,
    // 説明文はこのページに出ているものから作る（renderBlock が持っている）
    description: rendered.description,
    jsonLd: firstOnly(links, link, siteJsonLd(members, site)),
    theme,
    // Contact では足元の GitHub / メールを出さない（本文に同じ手がある。SiteIdentity）
    footer: <SiteIdentity site={site} solo={solo} contact={current.block.type === 'contact'} />,
    adminPath: blockAdminPath(current.block, solo),
  })
}
