import { drizzle } from 'drizzle-orm/d1'
import type { Context } from 'hono'
import { itemStory } from '../../blocks'
import {
  findMovedItem,
  findPublishedItem,
  listPublishedMembers,
  loadSiteSettings,
  loadTheme,
  publishedBlocks,
} from '../../db/queries'
import * as schema from '../../db/schema'
import { type ItemKind, type ItemView, itemImages, KIND_LABEL } from '../../domain'
import type { AppEnv } from '../../env'
import { IMAGE_FORMATS, imageTypeOfPath } from '../../lib/image'
import { tableOfContents } from '../../lib/sequence'
import { SITE } from '../../site'
import {
  BackLink,
  ItemDetail,
  ItemShots,
  ItemStory,
  itemCardId,
  itemHref,
  itemTransition,
  Screen,
  SectionHead,
  SiteIdentity,
} from '../../ui/components'
import type { OgImage } from '../../ui/Layout'
import { NO_FILTER, showMemberOf, soloMember } from './data'
import { absoluteUrl, describe, joinParts, pageTitle } from './meta'
import { movedTo, screenPage } from './page'
import { sitePageLinks, sitePages } from './site'

/*
  作品のページの共有カードの画像（src/ui/Layout.tsx の OgImage）。その作品の顔の1枚
  （メインの画像。無ければほかの画像の1枚目。src/domain.ts の itemImages）。

  使うのは、こちらが上げた画像（/images/items/…）と同梱の素材（/assets/…。seed.sql が
  指す AppMixer の画像）で、種類が貼り先に読まれるもの（AVIF 以外の4種類）だけ。種類は
  拡張子から（putImage が判定の結果から付けたもの・同梱の素材の名前）、寸法は上げたときに
  読んだもの。どちらも分からなければ名乗らない。使えなければ undefined を返し、サイトの
  1枚に戻る。
*/
const SHARE_TYPES = new Set(
  IMAGE_FORMATS.map((format) => format.type).filter((type) => type !== 'image/avif'),
)

function itemOgImage(item: ItemView): OgImage | undefined {
  const cover = itemImages(item)[0]
  if (!cover || !/^\/(images\/items|assets)\//.test(cover.url)) return undefined
  const type = imageTypeOfPath(cover.url)
  if (!type || !SHARE_TYPES.has(type)) return undefined
  return {
    url: absoluteUrl(cover.url),
    alt: cover.alt || item.title,
    type,
    ...(cover.width && cover.height ? { width: cover.width, height: cover.height } : {}),
  }
}

/*
  説明の無い作品の説明文の控え。作品名に、画面の添えと同じ事実（区分・
  プラットフォームか業界・年）とタグを添える。どれも作品ごとに違うので、
  説明の無い作品が2つあっても同じ文にならない（作品名は作品ごとに違う）。
*/
const itemFacts = (item: ItemView) =>
  joinParts(
    `${item.title}（${[KIND_LABEL[item.type], item.platformLabel ?? item.category, item.year]
      .filter(Boolean)
      .join(' · ')}）`,
    item.tags.join('、'),
  )

// 公開ページと認証済みプレビューが、作品の本文を同じ部品で描く。
export function itemPage(item: ItemView, links: { backHref?: string; memberHref?: string } = {}) {
  const note = [item.platformLabel ?? item.category, item.year].filter(Boolean).join(' · ')
  const destinations = [
    ...item.links,
    ...(links.memberHref && item.memberName
      ? [{ label: `担当 ${item.memberName}`, url: links.memberHref }]
      : []),
  ]
  return {
    description: item.summary || describe(itemFacts(item)),
    node: (
      <Screen id="item" label={item.title}>
        {links.backHref ? <BackLink href={links.backHref} label="一覧に戻る" /> : null}
        <SectionHead
          title={item.title}
          note={note || undefined}
          h1
          transition={itemTransition(item)}
          icon={item.iconUrl}
        />
        <ItemDetail item={item} links={destinations} />
        <ItemShots images={itemImages(item)} />
        <ItemStory parts={itemStory(item)} />
      </Screen>
    ),
  }
}

/*
  作品1件のページ（/apps/item/<slug>）。

  一覧の中の位置ではなく slug で1件を名指しするので、何を足しても外しても、並べ
  替えても指す先が動かない（貼るための URL）。

  トップの構成（どのブロックを置いているか）には依らない。Projects の節を外した
  日に、貼られた作品のリンクまで死んではいけない。出る条件は「作品が公開中」の
  1つだけ。

  中身は一覧の行を開いたもの（ItemDetail。画像の無い作品は文の列だけ）と、画像が
  2枚以上の作品の小節「Screenshots」（#screenshots。縦ギャラリー。ItemShots）と、本文の
  小節「Story」（#story。本文を書いた作品にだけ。ItemStory）。以前は本文を次の画面
  （…/story）に分け、作品同士を画面の底の左右の手でめくっていた。1ページにまとめたので、
  前の本文の URL は #story へ 301（story が true）。

  行き来は目次と「← 一覧に戻る」（見出しの上）。戻る先は一覧のこの作品の行
  （/projects#item-<slug>）。
*/
export async function renderItem(
  c: Context<AppEnv>,
  kind: ItemKind,
  slug: string,
  // 前の本文の画面（…/story）の URL で来たか
  story: boolean,
) {
  const db = drizzle(c.env.DB, { schema })
  const [item, members, theme, blocks, site] = await Promise.all([
    findPublishedItem(db, slug),
    listPublishedMembers(db),
    loadTheme(db),
    publishedBlocks(db),
    loadSiteSettings(db),
  ])

  /*
    貼られたあとで動いた URL は、いまの URL へ 301 で寄せる。3つある。

    - slug を変えた作品。前の slug は転送表（item_slug_redirects）に残っている
    - 区分を変えた作品。1語目（src/domain.ts の ITEM_KINDS の path）が区分を
      持つので、前の区分の URL（/works/item/<slug> と書かれた、いまは個人開発の
      作品）が残る
    - 前の本文の画面（…/story）。いまは作品のページの小節（#story）。本文が
      無くなっていればページの頭へ（貼られた URL を 404 にしない）

    どれも「同じ作品に2つの URL」ではない——開けば必ずいまの1つへ移る。
    行き先は管理画面の保存で変わる（slug を元に戻す・区分を戻す・本文を消す）ので、
    ブラウザには覚えさせない（movedTo）。前の slug・前の区分の本文の画面は、
    いったんいまの URL の …/story へ送り、そこで小節へ送る（本文の有無を知って
    いるのは作品の行だけ）。知らない slug と、下書きの作品（転送先も含めて）は 404。
  */
  if (!item) {
    const moved = await findMovedItem(db, slug)
    const at = moved ? itemHref(moved) : null
    return at ? movedTo(c, story ? `${at}/story` : at) : c.notFound()
  }
  const href = itemHref(item)
  if (!href) return c.notFound()
  // 本文の塊（テンプレートの欄と前の本文）。1つも無ければ小節は無い（開く式は src/blocks.ts の itemStory）
  const parts = itemStory(item)
  if (story) return movedTo(c, parts.length ? `${href}#story` : href)
  if (item.type !== kind) return movedTo(c, href)

  const solo = soloMember(members)
  const images = itemImages(item)
  // 目次はサイトのページのまま。このページに絞り込みは無いので、素の並びを聞く
  const { pages } = await sitePages(db, blocks, members, NO_FILTER, undefined, site)
  const links = sitePageLinks(pages, NO_FILTER, solo)

  /*
    「← 一覧に戻る」の行き先。一覧のこの作品の行（id は itemCardId）。一覧は全件を
    1ページに並べるので、どこに載っているかを数えなくてよい。URL は自分で組まず、
    サイトの並びから Projects のページを引く——Projects を先頭に置いた構成では / に
    なり、置いていない構成ではそもそも一覧が無い（そのときは戻る道を出さない）。
  */
  const list = links.find((link) => link.key === 'projects')

  /*
    見出しと添え（SectionHead。アイコンがあれば見出しの左）の下は ItemDetail——一覧の行を
    開いたもの（なぜ行の部品かは ItemDetail に書いてある）。その下に画像のギャラリー（ItemShots）と
    本文の小節（ItemStory）。
  */
  const page = itemPage(item, {
    backHref: list ? `${list.href}#${itemCardId(item)}` : undefined,
    memberHref:
      showMemberOf(blocks, members) && item.memberSlug ? `/members/${item.memberSlug}` : undefined,
  })

  return screenPage(c, {
    title: pageTitle(item.title),
    canonical: href,
    /*
      目次はサイトのもの。作品のページは目次に行を持たず、印はこの作品の載っている
      一覧（Projects）に付く
    */
    nav: tableOfContents(links, 'projects'),
    node: page.node,
    /*
      説明文は要約（summary）のまま。説明の無い作品（公開の関門が説明を求める前に
      公開した作品）は、このページに出ている作品の事実——作品名・区分・
      プラットフォームか業界・年・タグ——から組む（itemFacts）。サイトの紹介文に
      戻すと、入口と同じ説明文の URL が並び、説明の無い作品どうしも同じ文になった
    */
    description: page.description,
    /*
      この URL が何を名指ししているかを、貼った先にも検索にも1つだけ置く。
      サイトの名乗り（Person / Organization）はトップが持っているので、
      ここに載せるのは作品そのもの。画像は絶対 URL で。
    */
    jsonLd: {
      '@context': 'https://schema.org',
      '@type': 'CreativeWork',
      name: item.title,
      url: `${SITE.origin}${href}`,
      ...(item.summary ? { description: item.summary } : {}),
      // 画像は見せる順に（1枚なら URL、2枚以上なら並び）
      ...(images.length === 1
        ? { image: absoluteUrl(images[0]?.url ?? '') }
        : images.length
          ? { image: images.map((image) => absoluteUrl(image.url)) }
          : {}),
    },
    theme,
    footer: <SiteIdentity site={site} solo={solo} />,
    adminPath: `/admin/items/${item.id}/edit`,
    // 貼られたときの札は、この作品の画像（あれば）
    image: itemOgImage(item),
  })
}
