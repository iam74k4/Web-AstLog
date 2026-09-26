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
import { isHttpsUrl, isSafeRedirect } from '../../lib/format'
import { type Sequence, sequence, stepAt } from '../../lib/sequence'
import { SITE } from '../../site'
import { Band, filterQuery, SiteIdentity } from '../../ui/components'
import { bandOf, NO_FILTER, soloMember } from './data'
import { memberHref, memberScreens, memberStep, TEAM_TOC } from './member-screens'
import { personJsonLd, siteJsonLd } from './meta'
import { firstOnly, movedTo, screenPage } from './page'
import { siteScreens, siteSteps } from './site'

/*
  個人ページの画面1つ。want が null なら1枚目（/members/<slug>）。

  下書きのメンバーも、その人が持たない画面（技術も経歴も書いていない）も、
  知らない画面の名前も、まとめて「その URL は無い」に落とす。

  **個人ページはサイトの連なりの一部。** 柱と目次はサイトのままで、個人ページ
  専用のものに入れ替えない（入れ替えると、Team のカードを押した先が別のサイトに
  見え、Team へ戻る道も無くなる）。どう連なるかは人数で2つに分かれる。

    1人のサイト（Team を置いているとき。data.ts の profileOf）
      Team の画面は作らず、その位置にこの人の画面がそのまま並ぶ（site.ts の
      screenList）。/ から「次」を押し続けると 入口 → Projects … → 1枚目 →
      About → Skills → Career → Contact と一周する。目次は「Profile」の1行。
      1枚目の帯は出さない（入口の帯と同じ行き先・同じ件数）。構造化データも
      載せない（連なりの途中）
    2人以上のサイト
      Team の続き。目次はサイトのもの（Team に印）で、ページャはサイトの列の
      Team の直後にこの人の画面を差し込んだ列でめくる——
      ← Team → 1枚目 → About → Skills → Career → Contact →。Team の画面自身の
      「次」は Contact のまま（個人ページはカードから入る脇の道）

  Team を置いていないサイトでは、差し込む先が無いので、この人の画面だけで
  連ねる（カードの担当者名から入る単独の連なり）。連絡先はサイトの Contact に
  合流させた（/members/<slug>/contact はそこへ 301）。
*/
export async function renderMemberScreen(
  c: Context<AppEnv>,
  slug: string,
  want: { key: string; page: number } | null,
) {
  const db = drizzle(c.env.DB, { schema })
  const [member, members, theme, blocks] = await Promise.all([
    findPublishedMember(db, slug),
    /*
      人数だけを見る。サイトが1人として名乗っているあいだ（soloMember）は、
      この人が所属する「Noctifex という組織」は存在しない——トップの
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
    いるので、同じ画面のいまの URL へ 301 で寄せる（作品の恒久リンクと同じ）。
    行き先は URL の残り（画面の名前・ページ数・query）をそのまま継ぐ——
    パスの一部から組むので、Location に入れてよい形かを確かめてから
    （routes.ts の readPage と同じ）。
  */
  if (!member) {
    const moved = await findMovedMember(db, slug)
    const to = moved ? memberHref(moved, want?.key ?? '', want?.page ?? 1) : null
    return to && isSafeRedirect(to) ? movedTo(c, `${to}${new URL(c.req.url).search}`) : c.notFound()
  }

  const solo = soloMember(members)
  // サイトの画面の列。1人のサイトならこの人の画面はもう入っている（profileOf）
  const [counts, { screens: site, counted }] = await Promise.all([
    countPublishedByKind(db, member.id),
    siteScreens(db, blocks, members, NO_FILTER, null),
  ])
  const siteList = siteSteps(site, NO_FILTER, solo)

  /*
    個人ページの Contact は持たず、サイトの Contact に合流させた。貼られた
    URL は死なせずにそちらへ寄せる（恒久的な移動なので 301）。サイトに
    Contact を置いていなければ、寄せる先が無いので「その URL は無い」
  */
  if (want?.key === 'contact' && want.page === 1) {
    const contact = siteList.find((step) => step.navKey === 'contact')
    return contact ? movedTo(c, contact.canonical) : c.notFound()
  }

  /*
    1枚目は /members/<slug> だけで開く。1枚目の key は空文字なので、名指し
    （3語目。/members/<slug>/hero のような）では当たらない
  */
  const asked =
    want === null ? memberHref(member.slug, '') : memberHref(member.slug, want.key, want.page)

  /*
    1人のサイトのプロフィール。この人の画面はサイトの列そのものに並んでいる
    ので、そこから引いてそのまま連ねる——前後も目次もページャの数もサイトの
    連なりのもの。帯は付けない（site.ts の ProfileScreen）。構造化データは列の
    先頭にだけ載せる（firstOnly）ので、入口より後ろのプロフィールには載らない。
  */
  if (counted.profile) {
    const at = stepAt(siteList, asked)
    const seq = sequence(siteList, at)
    const current = site[at]
    if (!seq || current?.kind !== 'profile') return c.notFound()
    return screenPage(c, seq, {
      node: current.screen.node,
      description: current.screen.description,
      jsonLd: firstOnly(seq, siteJsonLd(members)),
      theme,
      sidebar: <SiteIdentity solo={solo} />,
      adminPath: `/admin/members/${member.id}/edit`,
    })
  }

  /*
    この人の一覧への帯。カードをここに複製せず、絞り込んだ一覧の1画面目へ送る。
    行き先と件数の決め方は data.ts の bandOf。

    1人のサイトでは ?member= を付けない。readFilter が読まない（名前のピルが
    無い）ので、付けても効かない URL が1本増えるだけになる。
  */
  const band = bandOf(
    blocks,
    counts,
    filterQuery({ kind: null, member: members.length > 1 ? member.slug : null }),
  )

  const screens = memberScreens(
    member,
    band ? <Band href={band.href} label="このメンバーのつくったもの" counts={band.counts} /> : null,
  )
  const own = screens.map((screen) => memberStep(member, screen, TEAM_TOC))

  const index = stepAt(own, asked)
  const step = own[index]
  const current = screens[index]
  if (!step || !current) return c.notFound()

  /*
    めくる列。サイトの列の Team（割られていれば最後の画面）の直後に、この人の
    画面を差し込む。1枚目の「←」は Team へ、最後の画面の「→」は Team の次の
    節（ふつうは Contact）へ出る。Team の画面自身の「次」は変えない。

    目次もこの列から取る。この人の画面は目次に行を持たず（TEAM_TOC）、印は
    Team に付く——作品1件のページが「載っている一覧」に印を付けるのと同じ
    借り方で、印を付ける手続きは sequence に任せる。

    Team を置いていないサイト（カードの担当者名から入る）では差し込む先が
    無いので、めくるのはこの人の画面だけ。目次はサイトのまま（印は無い）。
  */
  const teamEnd = siteList.map((one) => one.navKey).lastIndexOf('team')
  const around =
    teamEnd < 0
      ? [...siteList, ...own]
      : [...siteList.slice(0, teamEnd + 1), ...own, ...siteList.slice(teamEnd + 1)]
  const spliced = sequence(around, (teamEnd < 0 ? siteList.length : teamEnd + 1) + index)
  const pager = teamEnd < 0 ? (sequence(own, index)?.pager ?? null) : (spliced?.pager ?? null)

  // index は個人ページの中での位置。0（1枚目）にだけ構造化データが載る
  const seq: Sequence = { index, current: step, nav: spliced?.nav ?? [], pager }

  return screenPage(c, seq, {
    node: current.node,
    // 説明文もその画面のもの（memberScreens が画面ごとに持っている）
    description: current.description,
    jsonLd: firstOnly(seq, {
      '@context': 'https://schema.org',
      ...personJsonLd(member, `${SITE.origin}/members/${member.slug}`, {
        // sameAs はこの文書の外で読まれる。相対の URL や javascript: は載せない
        ...(isHttpsUrl(member.github) ? { sameAs: [member.github] } : {}),
        // 1人のサイトなら器は無い。2人目が公開された日に戻る
        ...(solo
          ? {}
          : { worksFor: { '@type': 'Organization', name: SITE.name, url: SITE.origin } }),
      }),
    }),
    theme,
    // 柱はサイトのもの。個人ページだけの柱に入れ替えると、別のサイトへ飛んだように見える
    sidebar: <SiteIdentity solo={solo} />,
    adminPath: `/admin/members/${member.id}/edit`,
  })
}
