import {
  countPublishedByKind,
  type Db,
  listPublishedItemKeys,
  listPublishedItems,
} from '../../db/queries'
import type * as schema from '../../db/schema'
import { type ItemFilter, type KindCounts, totalOf } from '../../domain'
import type { Page } from '../../lib/sequence'
import { filterQuery } from '../../ui/components'
import { renderBlock } from './blocks'
import {
  bandOf,
  filterApplies,
  type ItemListData,
  kindsOf,
  profileOf,
  scopeOf,
  showMemberOf,
  type TopData,
} from './data'
import { memberHref } from './member-page'
import { pageTitle, siteTitle } from './meta'

/*
  サイトのページの並び——管理の「構成」で置いた順に、ブロックを1つずつページに
  したもの。トップ（top.tsx）・作品のページ（item.tsx）・個人ページ（member.tsx）・
  sitemap（crawl.ts）が同じこの並びを読む。作品のページや個人ページに出る目次は、
  トップの目次そのものでなければならない——別に組むと、節が1つ増えた日に片方
  だけ古い並びを出し続ける。
*/

/*
  ブロック1つのページ。目次に載らないページ（Hero・ひとこと）も並びには入る
  （URL を持ち、sitemap に載る）。
*/
export type BlockPage = {
  kind: 'block'
  block: schema.Block
  slug: string
  nav: string | null
  toc: boolean
  // <title> のページの部分（Rendered の title）
  title: string | null
}

/*
  1人のサイトのプロフィール（data.ts の profileOf）。Team のブロックの位置に、
  その人のページがそのまま並ぶ。URL は /members/<slug> のままで、描くのも
  個人ページの経路（member.tsx）。サイトの並びに入っているのは、目次に
  「Profile」の1行を持たせるため。

  帯（このメンバーのつくったもの）は付けない——入口の「一覧で見る →」と同じ
  行き先・同じ件数になり、同じ手がサイトに2度出る。
*/
export type ProfilePage = {
  kind: 'profile'
  member: schema.Member
}

export type SitePage = BlockPage | ProfilePage

function pageList(blocks: schema.Block[], data: TopData): SitePage[] {
  const pages: SitePage[] = []
  for (const block of blocks) {
    // 1人のサイトの Team は、その人のページに置き換わる
    const person = block.type === 'team' ? data.profile : undefined
    if (person) {
      pages.push({ kind: 'profile', member: person })
      continue
    }
    /*
      描いて、そのブロックが出るかと名前を聞く。中身が無ければ null が返り、
      ページは生まれない——未配置・下書き・0件のブロックに URL が無いのは、
      renderBlock の「節ごと出さない」がそのまま伸びた結果。描いた節は捨てる
    */
    const rendered = renderBlock(block, data, false)
    if (!rendered) continue
    pages.push({
      kind: 'block',
      block,
      slug: rendered.slug,
      nav: rendered.nav,
      toc: rendered.toc,
      title: rendered.title,
    })
  }
  return pages
}

/*
  そのページに効く絞り込みだけを URL に残す（data.ts の filterApplies）。
  Projects を絞り込んだまま目次の「Projects」を押しても絞り込みが外れないように、
  目次の行き先にも付ける（test/public.test.ts の「絞り込みは、目次の行き先にも
  残る。一覧の無いページには付けて回らない」）。落とすのは、そのページでは何の
  意味も持たない項目だけ。
*/
const pageQuery = (slug: string, filter: ItemFilter): string =>
  filterApplies(slug) ? filterQuery(filter) : ''

/*
  いま出すページの行を引く。一覧（Projects）は絞り込みを効かせて、入口は件数の帯の
  いちばん古い年（Since）のために公開中の全件を（入口に絞り込みは効かない）。ほかの
  ページでは1件も引かない——そのページに作品は出ない。

  絞り込んだ一覧は、行の番号のために公開中の並び（id）も引く。番号は絞り込む前の並びでの
  位置（data.ts の ItemListData）。
*/
export async function pageRows(
  db: Db,
  page: BlockPage,
  filter: ItemFilter,
  memberId: number | null,
): Promise<Pick<ItemListData, 'rows' | 'numbers'>> {
  if (page.block.type === 'hero') return { rows: await listPublishedItems(db) }
  if (!filterApplies(page.block.type)) return { rows: [] }
  const scope = scopeOf(filter, memberId)
  if (!scope.kind && !scope.memberId) return { rows: await listPublishedItems(db) }
  const [rows, order] = await Promise.all([
    listPublishedItems(db, scope),
    listPublishedItemKeys(db),
  ])
  return { rows, numbers: new Map(order.map((key, index) => [key.id, index + 1])) }
}

/*
  サイトのページの並びと、それを組むのに使った数。

  ここで引くのは数だけ。一覧の行そのものは、どのページを出すかが決まってから
  引く（pageRows）。
*/
export async function sitePages(
  db: Db,
  blocks: schema.Block[],
  members: schema.Member[],
  filter: ItemFilter,
  // 区分ごとの件数。呼ぶ側が絞り込みを読むのに先に引いていれば渡す（二度引かない）
  byKind?: KindCounts,
): Promise<{ pages: SitePage[]; counted: TopData }> {
  const counts = byKind ?? (await countPublishedByKind(db))

  const counted: TopData = {
    members,
    kinds: kindsOf(counts),
    filter,
    showMember: showMemberOf(blocks, members),
    projects: { total: totalOf(counts), rows: [] },
    counts,
    band: bandOf(blocks, counts),
    profile: profileOf(blocks, members),
  }

  return { pages: pageList(blocks, counted), counted }
}

/*
  サイトのページの並びを、目次の1行ずつ（Page）に写す。

  canonical: 先頭のページは / と /<slug> の2つの URL で開けるので、正は / の
  ほうにそろえる。2つ目からは、そのページの URL が正。絞り込みは付けない——
  同じ中身の取り出し方なので、絞り込みの組み合わせのぶんだけ URL が数えられると、
  どれが本体か分からなくなる。

  href も先頭だけは / に寄せる（目次が /hero を指して、入口と同じ中身の URL を
  リンクから辿れる場所に増やさない）。/hero を直接開いた人のためのルートは
  残してある（top.tsx の renderScreen で読み替える）。

  1人のサイトのプロフィール（ProfilePage）は key を 'profile'、名前を「Profile」に
  する。先頭に来ても / には寄せない——そのページを描くのは個人ページの経路で、
  / は renderScreen がそこへ送る。
*/
export const sitePageLinks = (
  pages: SitePage[],
  filter: ItemFilter,
  solo?: schema.Member,
): Page[] =>
  pages.map((page, position) => {
    if (page.kind === 'profile') {
      const href = memberHref(page.member.slug)
      return {
        key: PROFILE_KEY,
        nav: 'Profile',
        href,
        canonical: href,
        title: pageTitle(page.member.name),
      }
    }
    const query = pageQuery(page.slug, filter)
    return {
      key: page.slug,
      // 目次に並べない節（見出しを空けたメモ）は名前を持っていても目次に出さない
      nav: page.toc ? page.nav : null,
      href: position === 0 ? `/${query}` : `/${page.slug}${query}`,
      canonical: position === 0 ? '/' : `/${page.slug}`,
      title: page.title === null ? siteTitle(solo) : pageTitle(page.title),
    }
  })

// 1人のサイトのプロフィールの目次の単位（個人ページはこの行に印を付ける）
export const PROFILE_KEY = 'profile'
