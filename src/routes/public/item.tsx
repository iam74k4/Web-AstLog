import { drizzle } from 'drizzle-orm/d1'
import type { Context } from 'hono'
import { itemDocument, itemStory } from '../../blocks'
import {
  findMovedItem,
  findPublishedItem,
  listPublishedMembers,
  loadSiteSettings,
  publishedBlocks,
} from '../../db/queries'
import * as schema from '../../db/schema'
import {
  ITEM_DOCUMENT,
  ITEM_DOCUMENTS,
  type ItemDocumentKey,
  type ItemKind,
  type ItemView,
  itemImages,
  KIND_LABEL,
} from '../../domain'
import type { AppEnv } from '../../env'
import { IMAGE_FORMATS, imageTypeOfPath, isVideoUrl } from '../../lib/image'
import { type DocumentBlock, documentLanguages } from '../../lib/markdown'
import { tableOfContents } from '../../lib/sequence'
import { SITE, type SiteSettings } from '../../site'
import {
  BackLink,
  ContactList,
  DocumentBody,
  hasContactRows,
  ItemDetail,
  ItemShots,
  ItemStory,
  itemCardId,
  itemDocumentHref,
  itemHref,
  itemTransition,
  LanguageLinks,
  Screen,
  SectionHead,
  SiteSocials,
} from '../../ui/components'
import type { OgImage } from '../../ui/Layout'
import { NO_FILTER, showMemberOf, soloMember } from './data'
import { absoluteUrl, describe, joinParts, pageTitle } from './meta'
import { movedTo, screenPage } from './page'
import { sitePageLinks, sitePages } from './site'

/*
  作品のページの共有カードの画像（src/ui/Layout.tsx の OgImage）。その作品の顔の1枚
  （メインの画像。無ければほかの画像の1枚目。src/domain.ts の itemImages）。動画は飛ばす
  （貼り先は動画の最初の絵を出さない）——ほかの画像の先頭が動画なら、次の画像が顔。

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
  const cover = itemImages(item).find((image) => !isVideoUrl(image.url))
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

/*
  公開ページと認証済みプレビューが、作品の本文を同じ部品で描く。

  documentHref は文書のページ（プライバシーポリシー・サポート）の URL。書いてある文書にだけ、
  作品のリンクのあとに行き先を置く（名前は文書の見出しと同じ英語。サイトの中なので →）。
  渡さなければ置かない（まだ保存していないプレビュー。行き先のページが無い）。
*/
export function itemPage(
  item: ItemView,
  links: {
    backHref?: string
    memberHref?: string
    documentHref?: (key: ItemDocumentKey) => string | null
  } = {},
) {
  const note = [item.platformLabel ?? item.category, item.year].filter(Boolean).join(' · ')
  const documents = ITEM_DOCUMENTS.flatMap((doc) => {
    const url = itemDocument(item, doc.key).length ? links.documentHref?.(doc.key) : null
    return url ? [{ label: doc.title, url }] : []
  })
  const destinations = [
    ...item.links,
    ...documents,
    ...(links.memberHref && item.memberName
      ? [{ label: `担当 ${item.memberName}`, url: links.memberHref }]
      : []),
  ]
  return {
    description: item.summary || describe(itemFacts(item)),
    node: (
      <Screen id="item" label={item.title}>
        {links.backHref ? <BackLink href={links.backHref} label="Projects" /> : null}
        <SectionHead
          title={item.title}
          note={note || undefined}
          h1
          item
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
  作品の文書のページ（/apps/item/<slug>/privacy・…/support。src/domain.ts の ITEM_DOCUMENTS）。
  公開ページと認証済みプレビューが同じ部品で描く。

  作品のページの続きの1ページ。頭に作品へ戻る手（「← 作品名」）、見出しは文書の名前の h1
  （Contact と同じ節の見出しの形）に作品名を添え、その下に書いた本文（DocumentBody。## が h2、
  ### が h3）。

  サポートは、本文の下に連絡先の表（Contact のページと同じ ContactList）を必ず置く。
  App Store の審査はサポートの URL に連絡手段があることを求め、本文にメールを書き忘れても
  ここで出る。表を置いたページは、足元に同じ行き先を出さない（contact を返す。Contact の
  ページと同じ決まり）。表に出る行が1つも無いサイト（連絡先が空）では、表も見出しも置かない
  （管理画面の欄が知らせる）。

  「## 日本語」「## English」で分けた文書（src/lib/markdown.ts の documentLanguages）は、
  選んだ言語の節だけを出し、見出しの下に切り替え（LanguageLinks）を置く。言語は query の
  lang（en）で、無い・知らない値なら最初の節（日本語）。最初の言語の見出しより前（最終更新日）は
  どの言語でも出す。サポートの連絡先の表はどの言語でも本文の下。href はこのページの URL
  （切り替えの行き先の素。公開ページとプレビューで違う）。
*/
export function itemDocumentPage(
  item: ItemView,
  key: ItemDocumentKey,
  blocks: DocumentBlock[],
  options: { backHref?: string; site: SiteSettings; href: string; lang?: string },
) {
  const doc = ITEM_DOCUMENT[key]
  const { site } = options
  const contact = key === 'support' && hasContactRows(site)
  const split = documentLanguages(blocks)
  const current = split
    ? (split.sections.find((section) => section.code === options.lang) ?? split.sections[0])
    : undefined
  return {
    title: pageTitle(item.title, doc.title),
    // 検索結果の説明文。作品名で、作品ごとに違う文になる
    description: `${item.title} の${doc.about}です。`,
    contact,
    node: (
      <Screen id={key} label={doc.title}>
        {options.backHref ? <BackLink href={options.backHref} label={item.title} /> : null}
        <SectionHead title={doc.title} note={item.title} h1 />
        {split && current ? (
          <LanguageLinks sections={split.sections} current={current.code} href={options.href} />
        ) : null}
        <DocumentBody
          blocks={split && current ? [...split.preamble, ...current.blocks] : blocks}
          // ページは日本語（<html lang="ja">）。ほかの言語の節を出すときだけ本文に言語を付ける
          lang={current && current.code !== 'ja' ? current.code : undefined}
          quiet={current?.heading}
        />
        {contact ? (
          <div class="doc-contact">
            <SectionHead title="Contact" sub={2} />
            <ContactList
              email={site.email}
              github={site.github}
              x={site.x}
              instagram={site.instagram}
              discord={site.discord}
            />
          </div>
        ) : null}
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
  前の本文の URL は #story へ 301（rest が story）。文書のページ（…/privacy・…/support。
  rest が文書の語）も、作品を引く・寄せる道はここと同じ（itemDocumentPage が描く）。

  行き来は目次と「← Projects」（見出しの上）。戻る先は一覧のこの作品の行
  （/projects#item-<slug>）。
*/
export async function renderItem(
  c: Context<AppEnv>,
  kind: ItemKind,
  slug: string,
  /*
    作品の URL の4語目。null は作品のページ、story は前の本文の画面（…/story）、
    privacy / support は文書のページ（ITEM_DOCUMENTS）
  */
  rest: 'story' | ItemDocumentKey | null,
) {
  const db = drizzle(c.env.DB, { schema })
  const [item, members, blocks, site] = await Promise.all([
    findPublishedItem(db, slug),
    listPublishedMembers(db),
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

    文書のページ（…/privacy・…/support）も同じ道で寄せる——前の slug はいまの URL の
    同じ文書へ（そこで文書が空なら 404）、前の区分は1回でいまの文書の URL へ。文書が
    空の作品は、どの URL でも 404（書いていないページを作らない）。言語の切り替え
    （?lang=en）は付けたまま送る（英語で読んでいた人を日本語へ戻さない）。
  */
  const keep = rest && rest !== 'story' ? new URL(c.req.url).search : ''
  if (!item) {
    const moved = await findMovedItem(db, slug)
    const at = moved ? itemHref(moved) : null
    return at ? movedTo(c, rest ? `${at}/${rest}${keep}` : at) : c.notFound()
  }
  const href = itemHref(item)
  if (!href) return c.notFound()
  // 本文の塊（テンプレートの欄と前の本文）。1つも無ければ小節は無い（開く式は src/blocks.ts の itemStory）
  const parts = itemStory(item)
  if (rest === 'story') return movedTo(c, parts.length ? `${href}#story` : href)
  // 文書の見出しと段落。空ならそのページは無い（開く式は src/blocks.ts の itemDocument）
  const document = rest ? itemDocument(item, rest) : []
  if (rest && !document.length) return c.notFound()
  if (item.type !== kind) return movedTo(c, rest ? `${href}/${rest}${keep}` : href)

  const solo = soloMember(members)
  // 構造化データの画像（image）は絵だけ。動画は画像として名乗らない
  const images = itemImages(item).filter((image) => !isVideoUrl(image.url))
  // 目次はサイトのページのまま。このページに絞り込みは無いので、素の並びを聞く
  const { pages } = await sitePages(db, blocks, members, NO_FILTER, undefined, site)
  const links = sitePageLinks(pages, NO_FILTER, solo)

  /*
    「← Projects」の行き先。一覧のこの作品の行（id は itemCardId）。一覧は全件を
    1ページに並べるので、どこに載っているかを数えなくてよい。URL は自分で組まず、
    サイトの並びから Projects のページを引く——Projects を先頭に置いた構成では / に
    なり、置いていない構成ではそもそも一覧が無い（そのときは戻る道を出さない）。
  */
  const list = links.find((link) => link.key === 'projects')

  if (rest) {
    /*
      文書のページ。目次はサイトのまま印は Projects（作品のページと同じ）。戻る手は作品の
      ページへ（一覧ではなく、この文書の持ち主の作品）。canonical は文書の URL 自身。
      構造化データは載せない（この URL は作品そのものではない。作品の CreativeWork は
      作品のページが1つだけ持つ）
    */
    const page = itemDocumentPage(item, rest, document, {
      backHref: href,
      site,
      href: `${href}/${rest}`,
      lang: c.req.query('lang'),
    })
    return screenPage(c, {
      title: page.title,
      canonical: `${href}/${rest}`,
      nav: tableOfContents(links, 'projects'),
      node: page.node,
      description: page.description,
      footer: <SiteSocials site={site} contact={page.contact} />,
      adminPath: `/admin/items/${item.id}/edit`,
      image: itemOgImage(item),
    })
  }

  /*
    見出しと添え（SectionHead。アイコンがあれば見出しの左）の下は ItemDetail——一覧の行を
    開いたもの（なぜ行の部品かは ItemDetail に書いてある）。その下に画像のギャラリー（ItemShots）と
    本文の小節（ItemStory）。
  */
  const page = itemPage(item, {
    backHref: list ? `${list.href}#${itemCardId(item)}` : undefined,
    memberHref:
      showMemberOf(blocks, members) && item.memberSlug ? `/members/${item.memberSlug}` : undefined,
    documentHref: (key) => itemDocumentHref(item, key),
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
    footer: <SiteSocials site={site} />,
    adminPath: `/admin/items/${item.id}/edit`,
    // 貼られたときの札は、この作品の画像（あれば）
    image: itemOgImage(item),
  })
}
