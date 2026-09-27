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

  並びは画面に出る順（絞り込みのピル・帯の件数・管理画面のタブ）。先頭の区分は、
  区分を指さない要求（/admin/items）の既定でもある。
*/
export const ITEM_KINDS = [
  { key: 'app', path: 'apps', label: '個人開発' },
  { key: 'work', path: 'works', label: '業務' },
] as const

export type ItemKind = (typeof ITEM_KINDS)[number]['key']

export const ITEM_KIND_KEYS = ITEM_KINDS.map((kind) => kind.key) as [ItemKind, ...ItemKind[]]

// 画面での呼び名。帯の件数（「個人開発 5 · 業務 2」）と管理画面のタブも同じ言葉
export const KIND_LABEL = Object.fromEntries(
  ITEM_KINDS.map((kind) => [kind.key, kind.label]),
) as Record<ItemKind, string>

// 恒久リンクの1語目
export const KIND_PATH = Object.fromEntries(
  ITEM_KINDS.map((kind) => [kind.key, kind.path]),
) as Record<ItemKind, (typeof ITEM_KINDS)[number]['path']>

export const isItemKind = (value: string): value is ItemKind =>
  ITEM_KIND_KEYS.some((kind) => kind === value)

// フォームと query の区分の読み方。知らない値・無い値は先頭の区分
export const readKind = (value: string | null | undefined): ItemKind =>
  value && isItemKind(value) ? value : ITEM_KINDS[0].key

// 区分ごとの件数（src/db/queries.ts の countPublishedByKind）
export type KindCounts = Record<ItemKind, number>

export const totalOf = (counts: KindCounts) =>
  ITEM_KIND_KEYS.reduce((sum, kind) => sum + counts[kind], 0)

// 作品1件を画面に出す形（src/db/queries.ts の toItemView が DB の行から開く）
export type ItemView = Item & {
  tags: string[]
  links: { label: string; url: string }[]
  platformLabel: string | null
  memberName: string | null
  memberSlug: string | null
}

/*
  いま効いている絞り込み。区分（個人開発 / 業務）とメンバーの2軸で、
  効いていない軸は null。
*/
export type ItemFilter = { kind: ItemKind | null; member: string | null }
