import { drizzle } from 'drizzle-orm/d1'
import type { Context } from 'hono'
import { blockPerScreen, itemStory } from '../../blocks'
import {
  findMovedItem,
  findPublishedItem,
  listPublishedItemKeys,
  listPublishedMembers,
  loadTheme,
  publishedBlocks,
} from '../../db/queries'
import * as schema from '../../db/schema'
import type { ItemKind, ItemView } from '../../domain'
import type { AppEnv } from '../../env'
import { IMAGE_FORMATS, imageTypeOfPath } from '../../lib/image'
import { type Sequence, type Step, sequence, stepAt } from '../../lib/sequence'
import { SITE } from '../../site'
import {
  BackLink,
  ItemDetail,
  itemHref,
  itemStoryHref,
  Note,
  Screen,
  SectionHead,
  SiteIdentity,
} from '../../ui/components'
import type { OgImage } from '../../ui/Layout'
import { NO_FILTER, showMemberOf, soloMember } from './data'
import { absoluteUrl, describe, pageTitle, siteDescription } from './meta'
import { screenPage } from './page'
import { siteScreens, siteSteps } from './site'

/*
  作品のページの共有カードの画像（src/ui/Layout.tsx の OgImage）。

  使うのは、こちらが上げた画像（/images/items/…）で、種類が貼り先に読まれる
  もの（AVIF 以外の4種類）だけ。種類は拡張子から（putImage が判定の結果から
  付けたもの）、寸法は上げたときに読んだもの。どちらも分からなければ名乗らない。
  使えなければ undefined を返し、サイトの1枚に戻る。
*/
const SHARE_TYPES = new Set(
  IMAGE_FORMATS.map((format) => format.type).filter((type) => type !== 'image/avif'),
)

function itemOgImage(item: ItemView): OgImage | undefined {
  if (!item.imageUrl?.startsWith('/images/items/')) return undefined
  const type = imageTypeOfPath(item.imageUrl)
  if (!type || !SHARE_TYPES.has(type)) return undefined
  return {
    url: absoluteUrl(item.imageUrl),
    alt: item.imageAlt || item.title,
    type,
    ...(item.imageWidth && item.imageHeight
      ? { width: item.imageWidth, height: item.imageHeight }
      : {}),
  }
}

/*
  作品1件のページ。作品同士を横にめくる、自分たちだけの連なり。

  一覧の URL（/projects/3）は「いまの並びの3枚目」でしかなく、並べ替えや公開の
  切り替えで 200 のまま別の作品を指す。こちらは slug で1件を名指しするので、
  何を足しても外しても指す先が動かない（貼るための URL）。

  トップの構成（どのブロックを置いているか）には依らない。Projects の節を外した
  日に、貼られた作品のリンクまで死んではいけない。出る条件は「作品が公開中」の
  1つだけ。

  作品1件は1枚か2枚。
    - 1枚目（/apps/item/<slug>）: カードを開いたもの（ItemDetail）
    - 本文の画面（/apps/item/<slug>/story）: 本文（items.body）だけ。本文を
      書いた作品にだけある
  screen はどちらを出すか。本文の無い作品の story は「その URL は無い」（404）。

  行き来は2本。
    - ページャ（画面の底）: 作品同士を一覧と同じ並びでめくる。本文のある作品は
      1枚目 → Story → 次の作品の1枚目。「← 前」「Projects 3 / 7」「次 →」。
      数えるのは作品（Story の画面でも 3 / 7 のまま）で、恒久リンクを持つ作品だけ
    - 「← 一覧に戻る」（どちらの画面も頭）: その作品が載っている Projects の画面へ
*/
export async function renderItem(
  c: Context<AppEnv>,
  kind: ItemKind,
  slug: string,
  screen: 'first' | 'story',
) {
  const db = drizzle(c.env.DB, { schema })
  const [item, order, members, theme, blocks] = await Promise.all([
    findPublishedItem(db, slug),
    listPublishedItemKeys(db),
    listPublishedMembers(db),
    loadTheme(db),
    publishedBlocks(db),
  ])

  // 同じ作品のどちらの画面か。転送の行き先も、名指しされた画面のまま継ぐ
  const hrefOf = (row: { type: ItemKind; slug: string | null }) =>
    screen === 'story' ? itemStoryHref(row) : itemHref(row)

  /*
    貼られたあとで動いた URL は、いまの URL へ 301 で寄せる。2つある。

    - slug を変えた作品。前の slug は転送表（item_slug_redirects）に残っている
    - 区分を変えた作品。1語目（src/domain.ts の ITEM_KINDS の path）が区分を
      持つので、前の区分の URL（/works/item/<slug> と書かれた、いまは個人開発の
      作品）が残る

    どちらも「同じ作品に2つの URL」ではない——開けば必ずいまの1つへ移る。
    本文の画面（…/story）はいまの URL の …/story へ送る（本文が無くなっていれば、
    着いた先が 404）。知らない slug と、下書きの作品（転送先も含めて）は 404 のまま。
  */
  if (!item) {
    const moved = await findMovedItem(db, slug)
    const to = moved ? hrefOf(moved) : null
    return to ? c.redirect(to, 301) : c.notFound()
  }
  const href = hrefOf(item)
  if (!href) return c.notFound()
  if (item.type !== kind) return c.redirect(href, 301)

  // 本文の段落。1つも無ければ本文の画面は無い（開く式は src/blocks.ts の itemStory）
  const story = itemStory(item.body)
  if (screen === 'story' && !story.length) return c.notFound()

  const solo = soloMember(members)
  // 目次はサイトの画面のまま。この画面に絞り込みは無いので、素の並びを聞く
  const { screens } = await siteScreens(db, blocks, members, NO_FILTER, null)
  const steps = siteSteps(screens, NO_FILTER, solo)

  /*
    作品の列。並びは一覧と同じ（listPublishedItemKeys が itemOrder で引く）で、
    恒久リンクを持つ作品だけ——slug の無い作品にはめくって着く URL が無い。
    本文のある作品は、1枚目のすぐ後ろに本文の画面を並べる。

    navKey はどれも同じ 'item' なので、sequence は列ぜんぶを1つの節として
    数え、手は節をまたがないので行き先を名乗らず「← 前」「次 →」のまま。
    節の名前（nav）は一覧の名前そのもので、ページャの真ん中に「Projects」と出る。

    数える単位（countKey）は作品——1枚目の URL を2枚に共通の札にする。Story を
    別の節にしないのは src/lib/sequence.ts の countKey の注記のとおり（次の作品へ
    出る手が「Projects →」を名乗り、一覧へ行くと読める）。

    目次の単位（tocKey）は一覧の 'projects'。目次に行は持たず（tocLabel: null）、
    印だけがこの作品の載っている一覧（Projects）に付く。
  */
  const own: Step[] = order.flatMap((row) => {
    const at = itemHref(row)
    if (!at) return []
    const first: Step = {
      navKey: 'item',
      countKey: at,
      tocKey: 'projects',
      tocLabel: null,
      href: at,
      canonical: at,
      nav: 'Projects',
      title: pageTitle(row.title),
    }
    const told = itemStory(row.body).length ? itemStoryHref(row) : null
    return told
      ? [first, { ...first, href: told, canonical: told, title: pageTitle(row.title, 'Story') }]
      : [first]
  })
  const index = stepAt(own, href)
  const step = own[index]
  if (!step) return c.notFound()

  /*
    目次とページャは別の列から取る（member.tsx と同じ2回呼び）。目次はサイトの
    画面の列に作品の列を継いで聞く——作品の行は目次に並ばないので、並ぶのは
    トップと同じ行き先で、印は Projects に付く。ページャは作品の列だけで聞く
    （サイトの列と継いだままめくると、最初の作品の「←」が Contact を指す）。

    index は作品の列の中の位置。構造化データ（CreativeWork）はどの作品の
    1枚目にも載せるので、firstOnly は通さない（下の jsonLd）。
  */
  const seq: Sequence = {
    index,
    current: step,
    nav: sequence([...steps, ...own], steps.length + index)?.nav ?? [],
    pager: sequence(own, index)?.pager ?? null,
  }

  /*
    「← 一覧に戻る」の行き先。この作品が一覧の何画面目に載っているかを、
    一覧と同じ並び（order。slug の無い作品も一覧には載るので数に入れる）の
    中の位置と perScreen から出す。本文の画面からも同じ所へ戻す。

    URL は自分で組まず、サイトの画面の列から Projects の N 枚目を引く。
    Projects を先頭に置いた構成では1枚目が / になり、Projects を置いて
    いない構成ではそもそも一覧が無い（そのときは戻る道を出さない）。
  */
  const position = order.findIndex((row) => row.id === item.id)
  const listPage = Math.floor(position / blockPerScreen('projects')) + 1
  const listSteps = steps.filter((_, at) => {
    const one = screens[at]
    return one?.kind === 'block' && one.block.type === 'projects'
  })
  const back = listSteps[listPage - 1]?.href ?? null
  const backLink = back ? <BackLink href={back} label="一覧に戻る" /> : null

  // どちらの画面にも共通のもの。題と canonical は seq が持つ
  const common = {
    theme,
    sidebar: <SiteIdentity solo={solo} />,
    adminPath: `/admin/items/${item.id}/edit`,
    // 1枚が作品1件。読み上げは「Projects の 7 件のうち 3 件目」
    unit: '件' as const,
    // 貼られたときの札は、この作品の画像（あれば）。本文の画面も同じ作品の話
    image: itemOgImage(item),
  }

  /*
    本文の画面。見出し（作品名に「Story」の添え）と本文の段落（Note。紹介文・
    メモと同じ部品）と、戻る道だけ。1枚目の説明・画像・行き先は繰り返さない。

    説明文は本文そのもの（1枚目の説明文は要約）。構造化データは載せない。
    「この URL が何か」を名乗るのは作品の1枚目で、同じ作品の CreativeWork を
    2つの URL が名乗ると、どちらが作品か決められない。
  */
  if (screen === 'story') {
    return screenPage(c, seq, {
      node: (
        <Screen id="story" label={item.title}>
          {backLink}
          <SectionHead title={item.title} note="Story" h1 />
          <Note paragraphs={story} />
        </Screen>
      ),
      description: describe(story.join(' ')),
      ...common,
    })
  }

  /*
    見出しと添え（SectionHead）の下は ItemDetail——カードを開いたもの（なぜ
    カードの部品かは ItemDetail に書いてある）。説明文にカードの <p> を使わない
    のは、あちらが行数で切られるため（--card-lines）。この画面は作品1件のため
    だけにあるので、書いたぶんが全部出る形にする。本文は次の画面（Story）。
  */
  const note = [item.platformLabel ?? item.category, item.year].filter(Boolean).join(' · ')
  const links = [
    ...item.links,
    /*
      担当を出す条件はカードと同じ（showMemberOf）。サイトの中の行き先なので、
      矢印は →・同じタブ（LinkRow が URL の頭の / で決める）
    */
    ...(showMemberOf(blocks, members) && item.memberName && item.memberSlug
      ? [{ label: `担当 ${item.memberName}`, url: `/members/${item.memberSlug}` }]
      : []),
  ]

  return screenPage(c, seq, {
    node: (
      <Screen id="item" label={item.title}>
        {backLink}
        <SectionHead title={item.title} note={note || undefined} h1 />
        <ItemDetail item={item} links={links} story={story.length ? itemStoryHref(item) : null} />
      </Screen>
    ),
    // 説明文は要約（summary）のまま。本文は次の画面が自分の説明文にする
    description: item.summary || siteDescription(solo),
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
      ...(item.imageUrl ? { image: absoluteUrl(item.imageUrl) } : {}),
    },
    ...common,
  })
}
