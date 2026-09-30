import { drizzle } from 'drizzle-orm/d1'
import type { Context } from 'hono'
import {
  countPublishedByKind,
  findMovedMember,
  findPublishedMember,
  listPublishedMembers,
  loadTheme,
  publishedBlocks,
} from '../../db/queries'
import * as schema from '../../db/schema'
import type { AppEnv } from '../../env'
import { isHttpsUrl } from '../../lib/format'
import { tableOfContents } from '../../lib/sequence'
import { SITE } from '../../site'
import { Band, filterQuery, SiteIdentity } from '../../ui/components'
import { bandOf, NO_FILTER, soloMember } from './data'
import {
  MEMBER_SECTIONS,
  type MemberSection,
  memberHref,
  memberPage,
  memberSectionHref,
} from './member-page'
import { pageTitle, personJsonLd, siteJsonLd } from './meta'
import { firstOnly, movedTo, screenPage } from './page'
import { PROFILE_KEY, sitePageLinks, sitePages } from './site'

const isSection = (key: string): key is MemberSection =>
  (MEMBER_SECTIONS as readonly string[]).includes(key)

/*
  個人ページ（/members/<slug>）。rest は前の URL の続き（/about・/skills・/career・
  /contact。割っていたころの /career/2 も同じ）で、どれも転送するだけ。

  下書きのメンバーも、知らない続きの名前も、まとめて「その URL は無い」に落とす。

  **個人ページはサイトの並びの一部。** 上の帯と目次と足元はサイトのままで、個人ページ
  専用のものに入れ替えない（入れ替えると、Team のカードを押した先が別のサイトに
  見え、Team へ戻る道も無くなる）。どう並ぶかは人数で2つに分かれる。

    1人のサイト（Team を置いているとき。data.ts の profileOf）
      Team のページは作らず、その位置にこの人のページが並ぶ（site.ts の pageList）。
      目次は「Profile」の1行で、このページでその行に印。帯は出さない（入口の
      「一覧で見る →」と同じ行き先・同じ件数）。構造化データはサイトの並びの先頭のときだけ
      サイトの名乗りを載せる（firstOnly）
    2人以上のサイト
      Team の続き。目次はサイトのもので、印は Team に付く。この人の一覧への帯を
      名札の下に置き、構造化データはこの人の Person

  Team を置いていないサイトでは、目次に印の付く行が無い（一覧の行の担当者名から
  入る並びの外のページ）。連絡先はサイトの Contact に合流させた
  （/members/<slug>/contact はそこへ 301）。
*/
export async function renderMemberScreen(c: Context<AppEnv>, slug: string, rest: string | null) {
  /*
    続きの名前は決まった4つだけ。先に見ておくと、下の転送で Location に入れる
    文字列がこの4つに限られる（パスの一部をそのまま Location に入れない。
    c.req.param() は percent-decode するので、CR/LF が入ると Headers.set が例外を
    投げて 500 になり、// で始まるとプロトコル相対の外の URL へ飛ぶ）
  */
  if (rest !== null && rest !== 'contact' && !isSection(rest)) return c.notFound()
  const db = drizzle(c.env.DB, { schema })
  const [member, members, theme, blocks] = await Promise.all([
    findPublishedMember(db, slug),
    /*
      人数だけを見る。サイトが1人として名乗っているあいだ（soloMember）は、
      この人が所属する「AstLog という組織」は存在しない——トップの
      構造化データは同じ URL を Person として名乗っているので、ここで
      worksFor に同じ URL の Organization を書くと、1つの URL が2つの型を
      持つことになる。
    */
    listPublishedMembers(db),
    loadTheme(db),
    publishedBlocks(db),
  ])

  /*
    slug を変えたメンバー。前の slug は転送表（member_slug_redirects）に残って
    いるので、いまの URL へ 301 で寄せる（作品の恒久リンクと同じ）。続き（/about …）
    で来たぶんは、いまの URL の続きへ送る——そこからもう一度、小節へ送られる。
    query はそのまま継ぐ。
  */
  if (!member) {
    const moved = await findMovedMember(db, slug)
    if (!moved) return c.notFound()
    const to = `${memberHref(moved)}${rest ? `/${rest}` : ''}`
    return movedTo(c, `${to}${new URL(c.req.url).search}`)
  }

  const solo = soloMember(members)
  // サイトのページの並び。1人のサイトならこの人のページはもう入っている（profileOf）
  const [counts, { pages, counted }] = await Promise.all([
    countPublishedByKind(db, member.id),
    sitePages(db, blocks, members, NO_FILTER),
  ])
  const links = sitePageLinks(pages, NO_FILTER, solo)

  if (rest !== null) {
    /*
      個人ページの Contact は持たず、サイトの Contact に合流させた。貼られた
      URL は死なせずにそちらへ寄せる（恒久的な移動なので 301）。サイトに
      Contact を置いていなければ、寄せる先が無いので「その URL は無い」
    */
    if (rest === 'contact') {
      const contact = links.find((link) => link.key === 'contact')
      return contact ? movedTo(c, contact.canonical) : c.notFound()
    }
    /*
      前の続き（/about・/skills・/career）は、このページの中の小節へ。小節が
      無くなっていればページの頭へ（memberSectionHref）。行き先は中身しだいで
      変わるので、ブラウザには覚えさせない（movedTo）
    */
    return isSection(rest) ? movedTo(c, memberSectionHref(member, rest)) : c.notFound()
  }

  const href = memberHref(member.slug)
  /*
    1人のサイトのプロフィール。この人のページはサイトの並びそのものに入っている
    ので、目次の印は「Profile」の行に付く。帯は付けない（site.ts の ProfilePage）。
  */
  const inSite = counted.profile ? links.find((link) => link.key === PROFILE_KEY) : undefined

  /*
    この人の一覧への帯。一覧の行をここに複製せず、絞り込んだ一覧へ送る。
    行き先と件数の決め方は data.ts の bandOf。1人のサイトのプロフィールでは
    出さない（入口の「一覧で見る →」と同じ行き先・同じ件数になる）。

    1人のサイトでは ?member= を付けない。readFilter が読まない（名前の絞り込みが
    無い）ので、付けても効かない URL が1本増えるだけになる。
  */
  const band = inSite
    ? null
    : bandOf(
        blocks,
        counts,
        filterQuery({ kind: null, member: members.length > 1 ? member.slug : null }),
      )
  const page = memberPage(
    member,
    band ? <Band href={band.href} label="このメンバーのつくったもの" counts={band.counts} /> : null,
  )

  return screenPage(c, {
    title: inSite?.title ?? pageTitle(member.name),
    canonical: href,
    /*
      目次はサイトのもの。印は1人のサイトなら Profile、2人以上なら Team（作品のページが
      「載っている一覧」に印を付けるのと同じ借り方）。Team を置いていないサイトでは
      どの行にも付かない
    */
    nav: tableOfContents(links, inSite ? PROFILE_KEY : 'team'),
    node: page.node,
    description: page.description,
    /*
      1人のサイトのプロフィールは、サイトの並びの先頭のときだけサイトの名乗りを載せる
      （Hero を外して Team を先頭に置いた構成）。それ以外は、この人の Person——
      このページが何の URL かを言う
    */
    jsonLd: inSite
      ? firstOnly(links, inSite, siteJsonLd(members))
      : {
          '@context': 'https://schema.org',
          ...personJsonLd(member, `${SITE.origin}${href}`, {
            // sameAs はこの文書の外で読まれる。相対の URL や javascript: は載せない
            ...(isHttpsUrl(member.github) ? { sameAs: [member.github] } : {}),
            // 1人のサイトなら器は無い。2人目が公開された日に戻る
            ...(solo
              ? {}
              : { worksFor: { '@type': 'Organization', name: SITE.name, url: SITE.origin } }),
          }),
        },
    theme,
    // 足元はサイトのもの。個人ページだけのものに入れ替えると、別のサイトへ飛んだように見える
    footer: <SiteIdentity solo={solo} />,
    adminPath: `/admin/members/${member.id}/edit`,
  })
}
