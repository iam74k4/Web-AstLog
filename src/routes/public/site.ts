import { blockPerScreen, blockType } from '../../blocks'
import {
  countPublishedByKind,
  countPublishedItems,
  type Db,
  listPublishedItems,
} from '../../db/queries'
import type * as schema from '../../db/schema'
import { type ItemFilter, type ItemView, type KindCounts, totalOf } from '../../domain'
import type { Step } from '../../lib/sequence'
import { filterQuery } from '../../ui/components'
import { renderBlock } from './blocks'
import {
  bandOf,
  filterApplies,
  kindsOf,
  profileOf,
  scopeOf,
  showMemberOf,
  type TopData,
} from './data'
import { type MemberScreen, memberScreens, memberStep, PROFILE_TOC } from './member-screens'
import { pageTitle, siteTitle } from './meta'

/*
  サイトの画面の列——管理の「構成」で置いた順に、ブロックを画面へほどいたもの。
  トップ（top.tsx）・作品のページ（item.tsx）・個人ページ（member.tsx）・sitemap
  （crawl.ts）が同じこの列を読む。作品のページや個人ページに出る目次は、トップの
  目次そのものでなければならない——別に組むと、節が1つ増えた日に片方だけ古い
  並びを出し続ける。
*/

/*
  画面1つ。列の1要素で、ブロック単位ではなく画面単位。だから Projects の最後の
  画面の「次」は、次のブロックの1画面目になる。目次に載らない画面（Hero・
  ひとこと）も列には並ぶので、めくれば必ずたどり着ける。
*/
export type BlockScreen = {
  kind: 'block'
  block: schema.Block
  slug: string
  nav: string | null
  toc: boolean
  // <title> の画面の部分（Rendered の title）。画面ごとに違う
  title: string | null
  page: number
}

/*
  1人のサイトのプロフィールの1枚（data.ts の profileOf）。Team のブロックの位置に、
  その人の画面がそのまま並ぶ。URL は /members/<slug> …のままで、描くのも
  個人ページの経路（member.tsx）。サイトの列に入っているのは、前後・目次・
  ページャの数をサイトの連なりとして数えるため。

  1枚目の帯（このメンバーのつくったもの）は付けない——入口の帯と同じ行き先・
  同じ件数になり、同じ札が連なりに2度出る。
*/
export type ProfileScreen = {
  kind: 'profile'
  member: schema.Member
  screen: MemberScreen
}

export type SiteScreen = BlockScreen | ProfileScreen

function screenList(blocks: schema.Block[], data: TopData): SiteScreen[] {
  const screens: SiteScreen[] = []
  for (const block of blocks) {
    // 1人のサイトの Team は、その人の画面に置き換わる
    const person = block.type === 'team' ? data.profile : undefined
    if (person) {
      for (const screen of memberScreens(person, null)) {
        screens.push({ kind: 'profile', member: person, screen })
      }
      continue
    }
    /*
      1画面目を描いて、そのブロックが何画面になるかを聞く。中身が無ければ
      null が返り、画面は1つも生まれない——未配置・下書き・0件のブロックに
      URL が無いのは、renderBlock の「節ごと出さない」がそのまま伸びた結果。
    */
    const first = renderBlock(block, data, 1)
    if (!first) continue
    for (let page = 1; page <= first.pages; page += 1) {
      /*
        2画面目からも描いて題だけを聞く。題はその画面の中身から決まる
        （見出しの無いメモは、その画面の最初の段落の頭）。数えるためだけの
        呼び出しなので、描いた節は捨てる
      */
      const rendered = page === 1 ? first : renderBlock(block, data, page)
      screens.push({
        kind: 'block',
        block,
        slug: first.slug,
        nav: first.nav,
        toc: first.toc,
        title: rendered?.title ?? first.title,
        page,
      })
    }
  }
  return screens
}

/*
  1画面目は /projects、2画面目からは /projects/2。同じ画面に URL を2つ作らない。

  query は絞り込み（?kind=… / ?member=…）。めくる先にも目次の行き先にも
  同じものを付ける。付けないと、次の画面へ移った瞬間に絞り込みだけが外れる。
*/
export const screenHref = (screen: { slug: string; page: number }, query = '') =>
  `/${screen.slug}${screen.page === 1 ? '' : `/${screen.page}`}${query}`

/*
  その画面に効く絞り込みだけを URL に残す（data.ts の filterApplies）。
  絞り込みが画面をまたいで残ること自体は意図どおり（test/public.test.ts の
  「絞り込みは、めくっても外れない。一覧の無い画面には付けて回らない」）。落とすのは、その画面では
  何の意味も持たない項目だけ。
*/
export const stepQuery = (slug: string, filter: ItemFilter): string =>
  filterApplies(slug) ? filterQuery(filter) : ''

/*
  いま出す画面のぶんだけを引く。絞り込みの効かない画面では1件も引かない
  ——その画面に一覧は無い。
*/
export async function screenRows(
  db: Db,
  screen: BlockScreen,
  filter: ItemFilter,
  memberId: number | null,
): Promise<ItemView[]> {
  const type = blockType(screen.block.type)
  if (!filterApplies(screen.block.type) || !type) return []
  const perScreen = blockPerScreen(type.key)
  return listPublishedItems(db, {
    ...scopeOf(filter, memberId),
    limit: perScreen,
    offset: (screen.page - 1) * perScreen,
  })
}

/*
  サイトの画面の列と、それを組むのに使った数。

  ここで引くのは数だけ。カードそのものは、どの画面を出すかが決まってから
  1画面ぶんだけ引く（screenRows）。絞り込みが効いていないときは、絞り込み後の
  件数を数え直さない（同じ数になる）。
*/
export async function siteScreens(
  db: Db,
  blocks: schema.Block[],
  members: schema.Member[],
  filter: ItemFilter,
  memberId: number | null,
  // 区分ごとの件数。呼ぶ側が絞り込みを読むのに先に引いていれば渡す（二度引かない）
  byKind?: KindCounts,
): Promise<{ screens: SiteScreen[]; counted: TopData }> {
  const counts = byKind ?? (await countPublishedByKind(db))
  const total = totalOf(counts)
  const matched =
    filter.kind || memberId ? await countPublishedItems(db, scopeOf(filter, memberId)) : total

  const counted: TopData = {
    members,
    kinds: kindsOf(counts),
    filter,
    showMember: showMemberOf(blocks, members),
    projects: { total, matched, rows: [] },
    band: bandOf(blocks, counts),
    profile: profileOf(blocks, members),
  }

  return { screens: screenList(blocks, counted), counted }
}

/*
  サイトの画面の列を、連なりの1枚ずつに写す。

  目次に並ぶのは slug ごとに1行（sequence が同じ tocKey——省けば navKey——の
  最初の1枚だけを採る）。だからブロックの2画面目以降でも、その見出しに印が残る。

  canonical: 先頭の画面は / と /<slug> の2つの URL で開けるので、正は / の
  ほうにそろえる。2つ目からは、その画面の URL が正。絞り込みは付けない——
  同じ中身の取り出し方なので、ピルの組み合わせのぶんだけ URL が数えられると、
  どれが本体か分からなくなる。

  href も先頭だけは / に寄せる（ページャの「前」が /hero を指して、入口と同じ中身の
  URL をリンクから辿れる場所に増やさない）。/hero を直接開いた人のためのルートは
  残してある（top.tsx の renderScreen で読み替える）。

  1人のサイトのプロフィールの画面（ProfileScreen）は、個人ページと同じ1枚
  （memberStep）に写す。目次では「Profile」の1行にまとめ（PROFILE_TOC）、
  ページャでは節ごとに名乗る。先頭に来ても / には寄せない——その1枚を描くのは
  個人ページの経路で、/ は renderScreen がそこへ送る。
*/
export const siteSteps = (
  screens: SiteScreen[],
  filter: ItemFilter,
  solo?: schema.Member,
): Step[] =>
  screens.map((screen, position) =>
    screen.kind === 'profile'
      ? memberStep(screen.member, screen.screen, PROFILE_TOC)
      : {
          navKey: screen.slug,
          href:
            position === 0
              ? `/${stepQuery(screen.slug, filter)}`
              : screenHref(screen, stepQuery(screen.slug, filter)),
          canonical: position === 0 ? '/' : screenHref(screen),
          nav: screen.nav,
          // 目次に並べない節（見出しを空けたメモ）。ページャでは名乗る
          ...(screen.toc ? {} : { tocLabel: null }),
          title: screen.title === null ? siteTitle(solo) : pageTitle(screen.title),
        },
  )
