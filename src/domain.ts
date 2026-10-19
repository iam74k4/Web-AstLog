import type { Item } from './db/schema'

/*
  UI と DB の両方が読む、作品の形。どちらの層にも属さないので、ここに置く
  （DB の層 src/db/queries.ts が UI の層 src/ui/components.tsx から型を借りない）。
*/

/*
  作品の区分。データの値（items.type）・恒久リンクの1語目（/apps/item/<slug>）・
  画面の呼び名（個人開発 / 業務）の対応は、この表が正。

  スキーマの enum（src/db/schema.ts）・呼び名（KIND_LABEL）・恒久リンク
  （src/ui/components.tsx の itemHref）・公開のルートと前の一覧の 301
  （src/routes/public/routes.ts）・区分ごとの件数（src/db/queries.ts の
  countPublishedByKind）・管理画面のタブは、どれもここから作る。区分を1つ足すと、
  そのすべてに一度に出る。

  並びは画面に出る順（絞り込み・入口の件数・管理画面のタブ）。先頭の区分は、
  区分を指さない要求（/admin/items）の既定でもある。
*/
export const ITEM_KINDS = [
  { key: 'app', path: 'apps', label: '個人開発', name: 'Personal' },
  { key: 'work', path: 'works', label: '業務', name: 'Work' },
] as const

export type ItemKind = (typeof ITEM_KINDS)[number]['key']

export const ITEM_KIND_KEYS = ITEM_KINDS.map((kind) => kind.key) as [ItemKind, ...ItemKind[]]

// 和名。管理画面のタブと、公開ページの説明文（検索結果に出る文）の中で使う
export const KIND_LABEL = Object.fromEntries(
  ITEM_KINDS.map((kind) => [kind.key, kind.label]),
) as Record<ItemKind, string>

/*
  公開ページの札の呼び名（英語）。絞り込み・見出しの添え・一覧の行の札・個人ページの帯
  （「Personal 5 · Work 2」）。押す手と札の言葉は英語にそろえる（持ち主の「文言統一」）
*/
export const KIND_NAME = Object.fromEntries(
  ITEM_KINDS.map((kind) => [kind.key, kind.name]),
) as Record<ItemKind, string>

// 恒久リンクの1語目
export const KIND_PATH = Object.fromEntries(
  ITEM_KINDS.map((kind) => [kind.key, kind.path]),
) as Record<ItemKind, (typeof ITEM_KINDS)[number]['path']>

const isItemKind = (value: string): value is ItemKind =>
  ITEM_KIND_KEYS.some((kind) => kind === value)

// フォームと query の区分の読み方。知らない値・無い値は先頭の区分
export const readKind = (value: string | null | undefined): ItemKind =>
  value && isItemKind(value) ? value : ITEM_KINDS[0].key

// 区分ごとの件数（src/db/queries.ts の countPublishedByKind）
export type KindCounts = Record<ItemKind, number>

export const totalOf = (counts: KindCounts) =>
  ITEM_KIND_KEYS.reduce((sum, kind) => sum + counts[kind], 0)

// 作品の画像1枚（メインの画像か、ほかの画像の1枚）。寸法は読めたときだけ
export type ItemImage = {
  url: string
  alt: string
  width: number | null
  height: number | null
}

// 作品1件を画面に出す形（src/db/queries.ts の toItemView が DB の行から開く）
export type ItemView = Item & {
  tags: string[]
  links: { label: string; url: string }[]
  // ほかの画像（item_shots）。並び順のまま
  shots: ItemImage[]
  platformLabel: string | null
  memberName: string | null
  memberSlug: string | null
}

/*
  作品の本文（Story）のテンプレート。個人開発も業務も同じ欄・同じ見出し・同じ順で書く
  （持ち主の「個人開発と業務で内容を統一するテンプレート」）。列（items の story_*）・
  管理画面の欄と書き方の手がかり・作品のページの小見出しの対応は、この表が正。

  - label と hint は管理画面の欄（src/routes/admin/items.tsx の StoryFields）
  - heading は作品のページの小見出し（components.tsx の StoryParts）。節の名前は英語の
    決まり（CLAUDE.md「文言」）で、Skills の英字の小見出しと同じく大文字
  - 並びは読む順（なぜ → 何を → どう → どうなった）。中身の無い欄は出さない
    （src/blocks.ts の itemStory）

  欄を足すときは、ここに1行と、src/db/schema.ts に列（npm run db:generate）。
*/
export const STORY_SECTIONS = [
  {
    column: 'storyBackground',
    label: '背景',
    heading: 'BACKGROUND',
    hint: 'なぜつくったか・何が困っていたか',
  },
  {
    column: 'storyApproach',
    label: '取り組み',
    heading: 'APPROACH',
    hint: '自分の役割と、やったこと',
  },
  {
    column: 'storyHighlights',
    label: '工夫',
    heading: 'HIGHLIGHTS',
    hint: '技術の選び方・こだわった点',
  },
  { column: 'storyResults', label: '成果', heading: 'RESULTS', hint: '結果・数字・使われ方' },
] as const satisfies readonly { column: keyof Item; label: string; heading: string; hint: string }[]

export type StoryColumn = (typeof STORY_SECTIONS)[number]['column']

/*
  作品の文書のページ。販売するアプリが App Store とアプリの中から指す、プライバシーポリシーと
  サポートの2つ。列（items の privacy / support）・URL の最後の語（/<区分>/item/<slug>/privacy）・
  ページの見出し・管理画面の欄の対応は、この表が正。

  - key は URL の最後の語で、列の名前でもある。**アプリのバイナリと App Store Connect に
    登録する URL なので、変えない**
  - title はページの h1 と作品のページの行き先の名前（節の名前は英語。CLAUDE.md「文言」）
  - label は管理画面の欄、about は検索結果の説明文の名前

  空の欄の作品にはそのページが無い（404。src/blocks.ts の itemDocument が開く）。文書を
  1つ足すときは、ここに1行と src/db/schema.ts に列（npm run db:generate）。
*/
export const ITEM_DOCUMENTS = [
  {
    key: 'privacy',
    title: 'Privacy Policy',
    label: 'プライバシーポリシー',
    about: 'プライバシーポリシー',
  },
  { key: 'support', title: 'Support', label: 'サポート', about: 'サポートと問い合わせ先' },
] as const satisfies readonly { key: keyof Item; title: string; label: string; about: string }[]

export type ItemDocumentKey = (typeof ITEM_DOCUMENTS)[number]['key']

// 文書の語から、その文書の行（見出し・欄の名前）
export const ITEM_DOCUMENT = Object.fromEntries(ITEM_DOCUMENTS.map((doc) => [doc.key, doc])) as {
  [K in ItemDocumentKey]: Extract<(typeof ITEM_DOCUMENTS)[number], { key: K }>
}

/*
  Story の塊（src/blocks.ts の itemStory が開く）。heading はテンプレートの欄の小見出しで、
  null はテンプレートより前に書いた本文（見出しの無い段落）
*/
export type StoryPart = { heading: string | null; paragraphs: string[] }

/*
  作品の画像を見せる順に。メインの画像（items.image_url）が先で、ほかの画像が続く。
  先頭の1枚がその作品の顔——一覧の行のサムネイル・共有カード（メインの画像が無い
  作品では、ほかの画像の1枚目）。作品のページは、2枚以上あれば全部を横に並べる
  （components.tsx の ItemShots）。
*/
export const itemImages = (
  item: Pick<ItemView, 'imageUrl' | 'imageAlt' | 'imageWidth' | 'imageHeight' | 'shots'>,
): ItemImage[] => [
  ...(item.imageUrl
    ? [
        {
          url: item.imageUrl,
          alt: item.imageAlt,
          width: item.imageWidth,
          height: item.imageHeight,
        },
      ]
    : []),
  ...item.shots,
]

/*
  いま効いている絞り込み。区分（個人開発 / 業務）とメンバーの2軸で、
  効いていない軸は null。
*/
export type ItemFilter = { kind: ItemKind | null; member: string | null }
