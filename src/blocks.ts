import type { Block, Item, Member } from './db/schema'
import { STORY_SECTIONS, type StoryColumn, type StoryPart } from './domain'
import { isSafeUrl, paragraphs, parseLines, parseSkills } from './lib/format'

/*
  トップページを組むブロックの一覧。

  トップは「決まった部品の積み重ね」で、管理画面の「構成」から置く・外す・
  並べ替えるだけができる。部品の見た目は変えられない。見た目は
  components.tsx と app.css の :root だけで決まるので、どう並べても
  同じ設計の中に収まる。

  種類はここが正。ブロックを1つ足すには、ここに1行 → このファイルの blockShown に
  1分岐（公開ページに出るか。公開ページと管理画面の「出る / 出ない」が読む）→
  components.tsx に部品 → src/routes/public/blocks.tsx の renderBlock に1分岐。4か所とも
  要る。2つの分岐は switch に default を置いていないので、足し忘れると TS2366 で落ちる。

  ブロック1つが公開ページの1ページ（/projects・/block-3 …）で、中身は全部そのページに
  並ぶ（ページは縦にスクロールする。CLAUDE.md の「公開ページは縦に読む」）。以前は
  1画面に収まる件数と字数を種類ごとに持ち、入りきらないぶんを次の URL に割って
  いたが、節ごとに1ページにしたのでその数は要らなくなった。残した上限は、名前と
  目録の文の長さ（MAX_CHARS）とひとことの一文（MAX_STATEMENT_SENTENCE）だけ。
*/

export const BLOCK_TYPES = [
  // 決まった中身を持つもの。1つだけ置ける
  { key: 'hero', label: 'Hero', note: '大見出しとリード。文言は src/site.ts', kind: 'fixed' },
  /*
    個人開発（app）と業務（work）を1つの一覧に並べる。見る側にとってはどちらも
    「つくったもの」で、節を分けると目次が2倍に伸びる。区分はデータに
    残り（src/domain.ts の ITEM_KINDS）、一覧の行の札（プラットフォーム / 業界・区分）と
    絞り込み（すべて・個人開発・業務）で見分ける。並びは新しい順
    （src/db/queries.ts の itemOrder）
  */
  {
    key: 'projects',
    label: 'Projects',
    note: '個人開発と業務の一覧。公開中の項目が0件なら出ない',
    kind: 'fixed',
  },
  {
    key: 'team',
    label: 'Team',
    note: 'メンバー。2人は横長、3人以上はグリッド。公開中が1人ならその人のプロフィールに置き換わる',
    kind: 'fixed',
  },
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

/*
  書く場所の上限。どれも「名前」か「目録の1文」の長さで、ページの高さの都合ではない
  （ページは縦にスクロールするので、段落や行の数には上限を置かない）。

    itemTitle       作品名。一覧の行の題・作品のページの見出し・<title> と
                    共有カードの題に出る名前。32 字は、行の題が 390 の電話で2行に収まる長さ
    itemSummary     一覧の行の説明（目録の文。「何であるか。何をしたか。」の2文）。行は
                    説明を行数で切らずに全部出すので、長いと一覧が縦に伸びる。2文ぶんの
                    100 字で止める
    memberHeadline  大見出し（入口と個人ページ）。連動の大きな段で出る1つの文で、長いと
                    見出しがページの頭を何行も食う
    blockHeading    打ち込むブロックの見出し（ひとことを除く）。目次の1行の名前で、目次は
                    上の帯に1行で並ぶ。10 字を超える名前が並ぶと、帯の見えている幅に
                    行き先が1つか2つしか入らない

  下書きでは見ない。公開になるときだけ（publishErrors）。
*/
export const MAX_CHARS = {
  itemTitle: 32,
  itemSummary: 100,
  memberHeadline: 80,
  blockHeading: 10,
} as const

export type BlockType = (typeof BLOCK_TYPES)[number]
export type BlockKey = BlockType['key']
type FixedBlockKey = Extract<BlockType, { kind: 'fixed' }>['key']

export const BLOCK_KEYS = BLOCK_TYPES.map((type) => type.key) as [BlockKey, ...BlockKey[]]

/*
  決まった中身の種類（hero / projects / team / contact）。サイトに1つずつしか置けない。

  「1つだけ」はページの並びの前提。同じ種類が2行あると、公開ページの並びに同じ
  URL（/projects）が2度並び、目次に同じ行き先が2行出る（二重送信で実際に2行できた。
  当時は画面の底の「次」が自分自身を指して入口から先へ進めなくなった）。だから
  3か所で守る——
  DB の部分一意索引（src/db/schema.ts の blocks_fixed_once。この一覧から作る）、
  書く側の1文（src/db/queries.ts の initBlocks と src/routes/admin/blocks.tsx の
  「置く」の onConflictDoNothing）、読む側の重複落とし（publishedBlocks）。
*/
export const FIXED_BLOCK_KEYS = BLOCK_TYPES.filter((type) => type.kind === 'fixed').map(
  (type) => type.key,
) as FixedBlockKey[]

export function blockType(key: string): BlockType | undefined {
  return BLOCK_TYPES.find((type) => type.key === key)
}

/*
  前の版の種類の名前（読む側だけが知っている別名）。

  Apps と Works を Projects に畳んだとき、行の書き換え（drizzle/0004_merge_apps_works）
  と読む側の変更を同じリリースに入れていた。書き換えを流さずに出す（手元の
  npm run deploy・移行の失敗・移行より先に出た版）と、apps / works の行は「知らない
  種類」として落ち、作品の一覧・入口の件数・/apps と /works の 301 先がどれも 404 に
  なって、500 ではないので誰も気づかない。

  だから読む側を先に広げる（expand）。構成の行を読むところ（src/db/queries.ts の
  listBlocks と findBlock）が、この表で前の名前をいまの名前に読み替え、apps と works
  の2行は 0004 と同じ形の1行に畳む（先に並んでいたほうの位置、どちらかが公開中なら
  公開）。書き換え（contract）が済んだ D1 でも済んでいない D1 でも、同じ画面になる
  （test/deploy.test.ts が2つを描き比べている）。

  書く側（「置く」・isBlockKey）はこの名前を受け取らない。新しい行はいつもいまの名前で
  入る。ここから外してよいのは、どの環境の D1 にも 0004 が当たったあと。
*/
export const LEGACY_BLOCK_KEYS: Readonly<Record<string, BlockKey>> = {
  apps: 'projects',
  works: 'projects',
}

export function isBlockKey(key: string): key is BlockKey {
  return blockType(key) !== undefined
}

/*
  ブロックの中身を行・段落の列に開く。

  公開ページ（renderBlock）はこの列をそのまま描き、公開ページに出るか（blockShown）と
  公開の関門（blockValueErrors）もここを読む。同じ式を2か所に書くと、片方だけ直した日に
  「公開中なのにサイトに出ない」ブロックが管理画面からは「出る」に見える。
*/

// 1行1件のもの（いま・数字・リンク集・できごと）の行
export function blockLines(key: BlockKey, body: string): string[][] {
  const rows = parseLines(body)
  // 通らない URL の行は公開ページが落とす。落ちた行はページにも出ない
  return key === 'links' ? rows.filter(([, url]) => isSafeUrl(url)) : rows
}

// メモの段落。空行の入れ方で数が変わるので、開く式はこの1本に寄せる
export function blockTexts(body: string): string[] {
  return paragraphs(body)
}

/*
  1行のうち、本文として出る列だけを残す。リンク集の2列目は URL で、href には
  なるが本文には出ないので外す（説明文に畳むとき。src/routes/public/meta.ts の
  lineDigest）。

  **つなぐ文字は持たない。** ここで持つのは「どの列が本文か」までで、そこから先は
  呼ぶ側の都合。
*/
export function blockVisibleParts(key: BlockKey, parts: string[]): string[] {
  return key === 'links' ? parts.filter((_, index) => index !== 1) : parts
}

// その中身が何単位あるか。0 ならページに出すものが無い（blockShown）
function blockUnitCount(key: BlockKey, body: string): number {
  return key === 'note' ? blockTexts(body).length : blockLines(key, body).length
}

/* ------------------------------------------------------------- 公開の関門 */

// 「字」で数える。絵文字や異体字を2字と数えないように、コードポイントで数える
export const chars = (text: string) => [...text].length

/*
  ひとことの一文の長さ。大きな段で1文だけ出る見出しで、120 字を超えると
  「大きな一文」ではなく段落になる（文言の決まり。ページの高さの話ではない）。
*/
export const MAX_STATEMENT_SENTENCE = 120

/*
  リンク集の中で、公開ページが落とす行。

  **全部の行が通るときだけ保存させる。** 以前は「通る URL が1行でもあれば」
  保存を通し、残りの行は「保存しました」のあとで公開ページから黙って消えた
  （https:// を付け忘れた行・URL を書き忘れた行）。「公開なのにサイトに出ない行」
  がいちばん分かりにくい、の行の単位版。

  落ちるかどうかは blockLines そのものに聞く（isSafeUrl の条件をここに写さない。
  写すと、公開側の条件を変えた日にここだけ古いまま残る）。1行ずつ渡して、
  列から消えたら落ちる行。行の番号は欄の中の行（空行も数える）で言う——書いた
  人が見ているのはその番号なので。
*/
function droppedLinkLines(body: string): string[] {
  return body.split('\n').flatMap((line, index) => {
    const [parts] = parseLines(line)
    if (!parts || blockLines('links', line).length > 0) return []
    const [label, url] = parts
    const where = `${index + 1} 行目${label ? `（${label}）` : ''}`
    return [
      url
        ? `${where}の URL は https:// か mailto: か / で始めてください`
        : `${where}に URL がありません（「ラベル | URL | 補足」）`,
    ]
  })
}

/*
  書くブロックの、下書きでも止める中身（受け取れない値）。

  - 中身が空。ひとことは一文が、それ以外は中身が要る。空の行は下書きでも
    作らせない（何も書いていないブロックを一覧に増やさない）
  - リンク集の、公開ページが落とす行（droppedLinkLines）。長さの話ではなく、
    公開ページがどう描いても落とすもの——作品のリンクやメンバーの GitHub と
    同じ扱い（CLAUDE.md「URL の検査は保存と描画の2か所」）

  名前の長さは、ここでは見ない。公開になるときだけ（publishErrors）。
*/
export function blockValueErrors(
  type: BlockType,
  values: { title: string; body: string },
): Record<string, string> | null {
  if (type.kind !== 'free') return null
  if (type.key === 'statement') return values.title ? null : { title: '一文を入れてください' }
  if (!values.body) return { body: '中身を入れてください' }
  if (type.key !== 'links') return null
  const dropped = droppedLinkLines(values.body)
  return dropped.length ? { body: `${dropped.join('。')}。` } : null
}

/*
  公開の関門。**published が 1 になる書き込みは、どれもこの1本を通す**——
  ブロックの編集フォーム・新しく書くブロック・構成の一覧の「公開する」・
  作品の保存・メンバーの保存。下書きに戻す方向（published が 0 になる書き込み）
  は通さない。

  関門が入口ごとに書いてあったころは、2本の入口のうち1本でしか守られて
  いなかった。構成の一覧の「公開する」は検査を通らず、一文を空にしたひとことが
  「公開」になり、公開ページでは節ごと消えた。逆に、下書きの保存でも長さを
  見ていた欄は、上限より前に保存された長い中身の行が「公開を外すことすらできない」
  行き止まりになった。検査を入口ではなく状態の変わり目に付ければ、どちらも起きない。

  止める理由は全部まとめて返す（1つずつ返すと、直すたびに次の理由が出る）。
  下書きでも止める「受け取れない値」（題が空・通らない URL・画像の種類）は
  それぞれの保存の側が見る（ブロックだけは blockValueErrors をここでも
  もう一度見る。一覧の「公開する」は保存を通らないので）。
*/
export type PublishTarget =
  | { kind: 'block'; type: BlockType; title: string; body: string }
  | {
      kind: 'item'
      title: string
      summary: string
      imageAlt: string
      // 保存したあとに画像が残るか（新しく選んだ・いまの画像を外さずに残す）
      hasImage: boolean
      /*
        保存したあとに残るほかの画像の代替テキストと、フォームでの呼び名（「2 枚目」
        「足す画像（1）」。止めるときにどの欄かをそのまま言うため）。外す画像は入れない
      */
      shots: readonly { alt: string; name: string }[]
    }
  | { kind: 'member'; headline: string }

export function publishErrors(target: PublishTarget): Record<string, string> | null {
  const errors =
    target.kind === 'block'
      ? blockPublishErrors(target.type, target)
      : target.kind === 'item'
        ? itemPublishErrors(target)
        : memberPublishErrors(target)
  return errors && Object.keys(errors).length ? errors : null
}

/*
  ブロック。出せない中身は公開させない——下書きでも止める中身（blockValueErrors。
  空・リンク集の通らない行）をもう一度見る。一覧の「公開する」は保存を通らない
  ので、この関門より前に保存された下書き（空にしたひとこと、など）がここに来る。

  長さで見るのは名前だけ。見出し（ひとこと以外）は目次の1行の名前
  （MAX_CHARS.blockHeading）、ひとことは大きく出る一文（MAX_STATEMENT_SENTENCE）。
  行の数や段落の長さは見ない（ページは縦に読む）。
*/
function blockPublishErrors(
  type: BlockType,
  values: { title: string; body: string },
): Record<string, string> | null {
  if (type.kind !== 'free') return null
  const invalid = blockValueErrors(type, values)
  if (invalid) return invalid
  if (type.key === 'statement') {
    return chars(values.title) > MAX_STATEMENT_SENTENCE
      ? { title: `大きく出る一文です。${MAX_STATEMENT_SENTENCE} 字までにしてください` }
      : null
  }
  return chars(values.title) > MAX_CHARS.blockHeading
    ? {
        title: `見出しは ${MAX_CHARS.blockHeading} 字までです（いま ${chars(values.title)} 字）。目次に1行で並ぶ名前です`,
      }
    : null
}

/*
  作品。作品名と説明は長さで止める（MAX_CHARS の itemTitle / itemSummary）。

  説明文は公開するときは必須。一覧の行の本文で、作品のページの説明文（description）
  でもある——空のまま公開すると、そのページの description が入口と同じサイトの
  紹介文になり、検索結果でも共有カードでもどの作品か見分けられなかった。

  画像があるのに代替テキストが空なら止める。作品のページではこの画像が
  作品の見た目を伝える唯一の手段で、名前の無い画像は読み上げでは「画像」と
  しか言えない。ほかの画像（スクリーンショット）も1枚ずつ同じ。何枚目かで言う。
*/
function itemPublishErrors(target: Extract<PublishTarget, { kind: 'item' }>) {
  const errors: Record<string, string> = {}
  const title = chars(target.title)
  if (title > MAX_CHARS.itemTitle) {
    errors.title = `作品名は ${MAX_CHARS.itemTitle} 字までです（いま ${title} 字）`
  }
  const summary = chars(target.summary)
  if (!summary) {
    errors.summary = '公開するときは説明文が要ります。一覧と作品のページの説明文になります'
  } else if (summary > MAX_CHARS.itemSummary) {
    errors.summary = `説明文は ${MAX_CHARS.itemSummary} 字までです（いま ${summary} 字）。一覧に出る2文です`
  }
  if (target.hasImage && !target.imageAlt) {
    errors.imageAlt = '画像を公開するときは、代替テキストが要ります'
  }
  const unnamed = target.shots.flatMap((shot) => (shot.alt ? [] : [shot.name]))
  if (unnamed.length) {
    errors.shots = `ほかの画像を公開するときは、1枚ずつ代替テキストが要ります（${unnamed.join('・')}）`
  }
  return errors
}

/*
  メンバー。大見出しは個人ページの頭に大きく出る1つの文（MAX_CHARS.memberHeadline）。
  止める理由は全部まとめて返す（publishErrors の決まり）。
*/
function memberPublishErrors(target: Extract<PublishTarget, { kind: 'member' }>) {
  const errors: Record<string, string> = {}
  const headline = chars(target.headline)
  if (headline > MAX_CHARS.memberHeadline) {
    errors.headline = `大見出しは ${MAX_CHARS.memberHeadline} 字までです（いま ${headline} 字）`
  }
  return errors
}

/*
  個人ページの中身を開く。紹介は段落、技術は塊（小見出しひとそろい）、経歴は行。
  公開ページ（src/routes/public/member-page.tsx の memberPage と、全体ページの
  ProfileWhole）はこの列を描く。開き方を2か所に書くと、個人ページと全体ページで
  同じ人の中身が違って見える。
*/
export function memberUnits(member: Pick<Member, 'bio' | 'skillsText' | 'careerText'>) {
  return {
    bio: paragraphs(member.bio),
    skills: parseSkills(member.skillsText),
    career: parseLines(member.careerText),
  }
}

/*
  作品の本文を、見出しと段落の塊（src/domain.ts の StoryPart）の並びに開く。塊が1つでも
  あれば、作品のページに小節「Story」（#story）が付く。

  - テンプレートより前に書いた本文（items.body）は、見出しの無い塊として先頭に
  - テンプレートの欄（STORY_SECTIONS）は決まった順に、英語の小見出しを付けて続ける
  - 段落は空行で分ける。空白と空行だけの欄は塊にしない（見出しだけ残さない）

  開く式はこの1本——公開ページ（src/routes/public/ の item.tsx と、全体ページの
  blocks.tsx）が小節を出すかどうかを決めるのも、前の本文の URL（…/story）を
  #story へ送るか作品のページの頭へ送るかを決めるのも、ここを読む。
*/
export function itemStory(item: Pick<Item, 'body' | StoryColumn>): StoryPart[] {
  const lead = paragraphs(item.body)
  return [
    ...(lead.length ? [{ heading: null, paragraphs: lead }] : []),
    ...STORY_SECTIONS.flatMap((section) => {
      const texts = paragraphs(item[section.column])
      return texts.length ? [{ heading: section.heading, paragraphs: texts }] : []
    }),
  ]
}

/*
  公開ページに出るかを決める、サイトの件数。公開ページは描く中身から、管理画面は
  DB を数えて作る（src/routes/admin/blocks.tsx の siteCounts）。
*/
export type SiteCounts = {
  // 公開中の項目の数（絞り込む前）
  items: number
  // 公開中のメンバーの数
  members: number
}

/*
  そのブロックが公開ページに出るか。false なら節ごと出さない（URL も目次の行も
  生まれない）。

  **公開ページと管理画面が同じこの1本を読む。** 公開ページ（src/routes/public/blocks.tsx
  の renderBlock）はこれで節を出すかどうかを決め、管理画面の構成は「出る / 出ない」を
  そのまま出す。「節を出す条件」を2本の switch に書いていたころは、片方だけ直した日に
  管理画面の知らせが実際の公開ページから静かにずれる形だった。

  種類を足し忘れる方向は型が守る（switch に default を置かないので TS2366 で落ちる）。

  - 下書き（published が 1 でない）は出ない。公開ページは publishedBlocks が先に落とす
  - Projects は、公開中が0件なら出ない。絞り込んで0件になっただけなら出す（絞り込みを
    残して、外す手をページに置く。こちらは件数を絞り込む前で数える）
  - 1人のサイトの Team は、その人のプロフィールのページに置き換わって出る
    （src/routes/public/site.ts の pageList）
*/
export function blockShown(
  block: Pick<Block, 'type' | 'title' | 'body' | 'published'>,
  counts: SiteCounts,
): boolean {
  const type = blockType(block.type)
  if (!type || block.published !== 1) return false

  switch (type.key) {
    case 'hero':
    case 'contact':
      return true
    case 'statement':
      return block.title !== ''
    case 'projects':
      return counts.items > 0
    case 'team':
      return counts.members > 0

    // 行は body に入っている（通らない URL は数に入らない）
    case 'links':
    case 'note':
    case 'now':
    case 'numbers':
    case 'timeline':
      return blockUnitCount(type.key, block.body) > 0
  }
}

/*
  何も置いていないサイトの並び。移行前の index.html と同じ順。

  blocks が空のときは、公開ページはこの並びで描き、管理画面には
  「まだ置いていない」と出す。空のテーブルで真っ白なトップが出るより、
  まず何か見えて、そこから外していけるほうが迷わない。
*/
export const DEFAULT_BLOCKS: FixedBlockKey[] = ['hero', 'projects', 'team', 'contact']
