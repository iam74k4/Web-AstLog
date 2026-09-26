import { isSafeUrl, paragraphs, parseLines } from './lib/format'

/*
  トップページを組むブロックの一覧。

  トップは「決まった部品の積み重ね」で、管理画面の「構成」から置く・外す・
  並べ替えるだけができる。部品の見た目は変えられない。見た目は
  components.tsx と app.css の :root だけで決まるので、どう並べても
  同じ設計の中に収まる。

  種類はここが正。ブロックを1つ足すには、ここに1行 → components.tsx に
  部品 → public.tsx の renderBlock に1分岐 → admin.tsx の blockScreens に
  1分岐（何画面になるかの知らせ）。4か所とも要る。後ろの2つは switch に
  default を置いていないので、足し忘れると TS2366 で落ちる。

  perScreen は「1画面に何件まで出すか」。CSS の値ではなく件数で、サーバーが
  画面を割る（src/lib/paginate.ts）のに使うので :root ではなくここに置く。
  管理画面には出さない。見た目を変える口にはしない。

  maxChars は「1画面に出せる字数」。件数と対で1画面ぶんを決める（下の注記）。
*/

/*
  1画面に出せる字数。件数（perScreen）の隣に置くのは、2つで1つの決まりだから。

  件数で割れるものは、入りきらないぶんを次の画面に回せる。回せないのは割った
  「あと」の1画面で、そこに何字入るかは件数では決まらない。前は「メモは1段落
  400 字」と割る前の単位で見ていたが、1画面には3段落出るので、規則どおり空行で
  分けた 1200 字がそのまま通っていた。数えるのは割ったあとの画面ぶんにする。

  数えるのは「その画面に文字として出るもの」。見出し（名詞ひとつ）は数えず、
  リンク集の URL も数えない——href であって、本文としては出ない。

  数は実測で決める。測り方は「節の弁（overflow: auto）が1pxも開かない」で、
  骨格3 × 書体3 × 設計サイズ3（390x844 / 768x1024 / 1440x900）の27通り。
  同じ字数でも1行に寄せたほうが高くなるので、均等に割った形と1行に寄せた形の
  両方で測り、通ったほうではなく厳しいほうを採った。
  （実測 = 上限 / 最初に開く量 @プリセット, 書体, ブラウザ）
    メモ     400 / 600 で +3px @rail 390x844, Hiragino Sans, macOS Chromium
    いま     250 / 400 で +31px @rail 390x844, Hiragino Sans, macOS Chromium
    数字     160 / 200 で +2px @center 1440x900, Hiragino Sans, macOS Chromium
    リンク集 160 / 180 で +5px @center 1440x900, Hiragino Sans, macOS Chromium
    できごと 250 / 400 で +12px @rail 390x844, Hiragino Sans, macOS Chromium
    ひとこと 300 / 一文と添え書きの合計。362 字まで閉じているぶんを余白にした

  ここを上げるときは、CSS を触るのではなく、この27通りを測り直すこと。
  設計サイズで弁が開いたら、それは弁の不具合ではなく件数か字数の不具合。
*/

export const BLOCK_TYPES = [
  // 決まった中身を持つもの。1つだけ置ける
  // hero と contact は画面まるごとなので perScreen を持たない
  { key: 'hero', label: 'Hero', note: '大見出しとリード。文言は src/site.ts', kind: 'fixed' },
  /*
    個人開発（app）と業務（work）を1つの一覧に並べる。以前は Apps と Works の
    2つの節だったが、見る側にとってはどちらも「つくったもの」で、節が分かれて
    いると目次もページャも2倍に伸びるだけだった。区分はデータに残り、カードの
    札（プラットフォーム / 業界）と絞り込みのピル（すべて・個人開発・業務）で
    見分ける。並びは新しい順（src/db/queries.ts の publicOrder）
  */
  {
    key: 'projects',
    label: 'Projects',
    note: '個人開発と業務の一覧。公開中の項目が0件なら出ない',
    kind: 'fixed',
    perScreen: 2,
  },
  {
    key: 'team',
    label: 'Team',
    note: 'メンバー。1〜2人は横長、3人以上はグリッド',
    kind: 'fixed',
    perScreen: 6,
  },
  { key: 'contact', label: 'Contact', note: '連絡先。文言は src/site.ts', kind: 'fixed' },

  // 中身を打ち込むもの。いくつでも置ける
  // statement は画面まるごとなので perScreen を持たない
  {
    key: 'statement',
    label: 'ひとこと',
    note: '大きな一文。添え書きを1行つけられる',
    kind: 'free',
    title: '',
    hint: '見出しに一文。本文は添え書き（無くてよい）',
    // 画面まるごと1枚。数えるのは一文と添え書きの合計
    maxChars: 300,
  },
  {
    key: 'now',
    label: 'いま',
    note: '取り組んでいることの箇条書き',
    kind: 'free',
    title: 'Now',
    hint: '1行に1件。「何を | 補足」',
    perScreen: 10,
    maxChars: 250,
  },
  {
    key: 'numbers',
    label: '数字',
    note: '大きな数字を並べる。2〜4つが収まりがよい',
    kind: 'free',
    title: '数字で見る',
    hint: '1行に1件。「値 | 単位 | 説明」',
    perScreen: 6,
    maxChars: 160,
  },
  {
    key: 'links',
    label: 'リンク集',
    note: '外へのリンクを並べる',
    kind: 'free',
    title: 'Links',
    hint: '1行に1件。「ラベル | URL | 補足」',
    perScreen: 10,
    maxChars: 160,
  },
  {
    key: 'timeline',
    label: 'できごと',
    note: '年月と出来事を並べる',
    kind: 'free',
    title: 'Timeline',
    hint: '1行に1件。「年月 | 何を | 補足」',
    perScreen: 5,
    maxChars: 250,
  },
  {
    key: 'note',
    label: 'メモ',
    note: '段落の文章',
    kind: 'free',
    title: '',
    hint: '空行で段落を分ける',
    perScreen: 3,
    maxChars: 400,
  },
] as const

/*
  ブロックではない「書く場所」の上限。同じ実測の並びなので、ここに一緒に置く。

  itemSummary（作品カードの説明）だけは性質が違う。カードの高さは
  --card-lines（2行）で止めてあるので、長く書いても画面からは溢れない——
  溢れる代わりに、書いたぶんが黙って切られる。だから上限は「溢れない長さ」
  ではなく「どの画面でも誰にも届かない長さ」にした。いちばん広く出る
  雑誌風でも2行は 100 字（= magazine @1440x900, Hiragino Sans, macOS Chromium）。
  いちばん狭い設計サイズでは 46 字（= rail @768x1024 と @390x844、同条件）
  までしか出ないので、書く側にはそれも添える。

  memberBio（紹介文）は個人ページの About 1枚に全段落が出る。件数で割れない
  ので、字数と段落の数の両方で止める。実測（27通り）: 450 字・6段落は弁が
  1pxも開かないが、同じ 450 字でも8段落に割ると +83px @rail 390x844。
  段落の区切りそのものが高さを取るため。
*/
export const MAX_CHARS = {
  itemSummary: 100,
  itemSummaryVisible: 46,
  memberBio: 450,
  memberBioParagraphs: 6,
} as const

export type BlockType = (typeof BLOCK_TYPES)[number]
export type BlockKey = BlockType['key']
type FixedBlockKey = Extract<BlockType, { kind: 'fixed' }>['key']

export const BLOCK_KEYS = BLOCK_TYPES.map((type) => type.key) as [BlockKey, ...BlockKey[]]

export function blockType(key: string): BlockType | undefined {
  return BLOCK_TYPES.find((type) => type.key === key)
}

export function isBlockKey(key: string): key is BlockKey {
  return blockType(key) !== undefined
}

// その種類の1画面あたりの件数。持たない種類（hero・contact・ひとこと）は画面まるごと
export function blockPerScreen(key: BlockKey): number {
  const type = blockType(key)
  return type && 'perScreen' in type ? type.perScreen : 1
}

/*
  ブロックの中身を「画面に割る単位」の列に開く。

  公開ページ（renderBlock）はこの列をそのまま描き、管理画面（blockScreens と
  screenChars）は数えるだけ。同じ式を2か所に書くと、片方だけ直した日に管理画面の
  「N 画面」が静かに古い数を出し続ける——あの表示は「13件目を公開したら画面が1枚
  増えた」と気づかせるためにあるので、いちばん要るときに嘘をつくことになる。

  種類を足し忘れる方向は型が守っている（switch に default を置かない判断で、
  ここに1つ足すと renderBlock と blockScreens の両方が TS2366 で落ちる）。
  既存の分岐の中身がずれる方向は、開く式をここに寄せる以外に守りようが無い。
*/

// 1行1件のもの（いま・数字・リンク集・できごと）の行
export function blockLines(key: BlockKey, body: string): string[][] {
  const rows = parseLines(body)
  // 通らない URL の行は公開ページが落とす。落ちた行は画面にもならない
  return key === 'links' ? rows.filter(([, url]) => isSafeUrl(url)) : rows
}

// メモの段落。空行の入れ方で数が変わるので、開く式はこの1本に寄せる
export function blockTexts(body: string): string[] {
  return paragraphs(body)
}

/*
  1行のうち、本文として出る列だけを残す。

  リンク集の2列目は URL で、href にはなるが本文には出ない。だから
  説明文に畳むとき（public.tsx の lineDigest）も字数を数えるとき
  （admin.tsx の screenChars）も、そこは外す。その規則が2か所に別々に
  書いてあった——このファイルは「開く式は blockLines / blockTexts /
  blockUnitCount が1本の正」と宣言しているのに、ここだけ漏れていた。

  **つなぐ文字は共有しない。** 説明文は ' ' で、字数は '' で畳む。
  ここで持つのは「どの列が本文か」までで、そこから先は呼ぶ側の都合。
*/
export function blockVisibleParts(key: BlockKey, parts: string[]): string[] {
  return key === 'links' ? parts.filter((_, index) => index !== 1) : parts
}

// その中身が何単位あるか。画面の数を数えるだけの側（管理画面）はこれで足りる
export function blockUnitCount(key: BlockKey, body: string): number {
  return key === 'note' ? blockTexts(body).length : blockLines(key, body).length
}

/*
  個人ページの1画面あたりの件数。トップの perScreen と同じ置き場に置く。

  ここに無いと、個人ページだけが「1画面に何件」の軸を持たない連なりになる。
  次の人は perScreen を探して見つけられず、入りきらない画面を CSS で縮めに
  いく——このリポジトリがいちばん禁じている方向。

  数は増やすためではなく、増やせる場所を1か所に決めるために置いてある。
  どれも今日の中身（紹介 3段落 / 技術 3塊19項目 / 経歴 3行）では1画面のままで、
  書き足したぶんだけ次の画面に回る。

    about   紹介文の段落。書く側の上限（MAX_CHARS.memberBioParagraphs）と
            同じ数にしてある——あの 6 は「6段落なら弁が1pxも開かない」という
            実測そのものなので、上限を上げた日に画面が割れて追いつく
    skills  小見出しひとそろい（.skill-group）。塊は割らない。3 は app.css が
            「技術の3つの塊」と呼んでいる今日の姿で、27通りの実測はしていない
            保守的な数（割るほうへ外れても溢れない）
    career  できごとの行。同じ <Timeline> と .career で描く timeline ブロックの
            perScreen をそのまま読む。同じ形のものを2つの数で割らない
*/
export const MEMBER_PER_SCREEN = {
  about: MAX_CHARS.memberBioParagraphs,
  skills: 3,
  career: blockPerScreen('timeline'),
}

/*
  何も置いていないサイトの並び。移行前の index.html と同じ順。

  blocks が空のときは、公開ページはこの並びで描き、管理画面には
  「まだ置いていない」と出す。空のテーブルで真っ白なトップが出るより、
  まず何か見えて、そこから外していけるほうが迷わない。
*/
export const DEFAULT_BLOCKS: FixedBlockKey[] = ['hero', 'projects', 'team', 'contact']
