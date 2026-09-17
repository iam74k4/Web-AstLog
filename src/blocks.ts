/*
  トップページを組むブロックの一覧。

  トップは「決まった部品の積み重ね」で、管理画面の「構成」から置く・外す・
  並べ替えるだけができる。部品の見た目は変えられない。見た目は
  components.tsx と app.css の :root だけで決まるので、どう並べても
  同じ設計の中に収まる。

  種類はここが正。ブロックを1つ足すには、ここに1行 → components.tsx に
  部品 → public.tsx の renderBlock に1分岐。3か所とも要る。
*/

export const BLOCK_TYPES = [
  // 決まった中身を持つもの。1つだけ置ける
  { key: 'hero', label: 'Hero', note: '大見出しとリード。文言は src/site.ts', kind: 'fixed' },
  { key: 'apps', label: 'Apps', note: '個人開発。公開中の app が0件なら出ない', kind: 'fixed' },
  { key: 'works', label: 'Works', note: '業務。公開中の work が0件なら出ない', kind: 'fixed' },
  { key: 'team', label: 'Team', note: 'メンバー。1〜2人は横長、3人以上はグリッド', kind: 'fixed' },
  { key: 'contact', label: 'Contact', note: '連絡先。文言は src/site.ts', kind: 'fixed' },

  // 中身を打ち込むもの。いくつでも置ける
  {
    key: 'statement',
    label: 'ひとこと',
    note: '大きな一文。添え書きを1行つけられる',
    kind: 'free',
    title: '',
    hint: '見出しに一文。本文は添え書き（無くてよい）',
  },
  {
    key: 'now',
    label: 'いま',
    note: '取り組んでいることの箇条書き',
    kind: 'free',
    title: 'Now',
    hint: '1行に1件。「何を | 補足」',
  },
  {
    key: 'numbers',
    label: '数字',
    note: '大きな数字を並べる。2〜4つが収まりがよい',
    kind: 'free',
    title: '数字で見る',
    hint: '1行に1件。「値 | 単位 | 説明」',
  },
  {
    key: 'links',
    label: 'リンク集',
    note: '外へのリンクを並べる',
    kind: 'free',
    title: 'Links',
    hint: '1行に1件。「ラベル | URL | 補足」',
  },
  {
    key: 'timeline',
    label: 'できごと',
    note: '年月と出来事を並べる',
    kind: 'free',
    title: 'Timeline',
    hint: '1行に1件。「年月 | 何を | 補足」',
  },
  {
    key: 'note',
    label: 'メモ',
    note: '段落の文章',
    kind: 'free',
    title: '',
    hint: '空行で段落を分ける',
  },
] as const

export type BlockType = (typeof BLOCK_TYPES)[number]
export type BlockKey = BlockType['key']
export type FixedBlockKey = Extract<BlockType, { kind: 'fixed' }>['key']
export type FreeBlockKey = Extract<BlockType, { kind: 'free' }>['key']

export const BLOCK_KEYS = BLOCK_TYPES.map((type) => type.key) as [BlockKey, ...BlockKey[]]

export function blockType(key: string): BlockType | undefined {
  return BLOCK_TYPES.find((type) => type.key === key)
}

export function isBlockKey(key: string): key is BlockKey {
  return blockType(key) !== undefined
}

export function isFreeBlock(key: BlockKey): key is FreeBlockKey {
  return blockType(key)?.kind === 'free'
}

/*
  何も置いていないサイトの並び。移行前の index.html と同じ順。

  blocks が空のときは、公開ページはこの並びで描き、管理画面には
  「まだ置いていない」と出す。空のテーブルで真っ白なトップが出るより、
  まず何か見えて、そこから外していけるほうが迷わない。
*/
export const DEFAULT_BLOCKS: FixedBlockKey[] = ['hero', 'apps', 'works', 'team', 'contact']
