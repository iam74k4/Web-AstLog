import type { Block, Member } from './db/schema'
import { isSafeUrl, paragraphs, parseLines, parseSkills } from './lib/format'
import { chunk, screenCount } from './lib/paginate'

/*
  トップページを組むブロックの一覧。

  トップは「決まった部品の積み重ね」で、管理画面の「構成」から置く・外す・
  並べ替えるだけができる。部品の見た目は変えられない。見た目は
  components.tsx と app.css の :root だけで決まるので、どう並べても
  同じ設計の中に収まる。

  種類はここが正。ブロックを1つ足すには、ここに1行 → このファイルの blockPages に
  1分岐（何画面になるか。公開ページと管理画面の「N 画面」が読む）→ components.tsx に
  部品 → src/routes/public/blocks.tsx の renderBlock に1分岐。4か所とも要る。
  2つの分岐は switch に default を置いていないので、足し忘れると TS2366 で落ちる。

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
  骨格3 × 書体3 × 設計サイズ3（390x844 指 / 768x1024 指 / 1440x900）の27通り。
  390 と 768 は指（pointer: coarse）で測る——設計上は電話と板で、指では押す手が
  44px になり、柱の帯もそのぶん伸びる（npm run check:fit と同じ条件）。
  同じ字数でも1行に寄せたほうが高くなるので、均等に割った形と1行に寄せた形の
  両方で測り、通ったほうではなく厳しいほうを採った。文は実際の文に近い和文
  （英字まじり）で測る——段落は word-break: auto-phrase で文節の切れ目でだけ
  折れるので、「あ」を並べた文より行末に空きが出て、行が増える。
  （実測 = 上限 / 最初に開く量 @プリセット, 書体, ブラウザ）
    メモ     400 / 406 で +23px @rail 390x844 指, Hiragino Sans, macOS Chromium
             （3段落を1つに寄せた形。節の見出しあり）
    いま     250 / 269 で +15px @rail 390x844 指, 同条件
    数字     160 / 229 で +4px @rail 390x844 指, 同条件
    リンク集 160 / 164 で +3px @magazine 390x844 指, 同条件
    できごと 250 / 363 で +10px @rail 390x844 指, 同条件
    ひとこと 300 / 563 で +3px @rail 390x844 指, 同条件（一文と添え書きの合計）
  段落の字を 15px に、節の見出しを連動の段に上げた日に測り直した（app.css の
  .bio p と .head）。メモは 400 のまま 5 字しか余らない——字の段や段落の間隔を
  動かしたら、まずメモを測り直すこと。

  **いまは npm run check:fit が毎回この上限ちょうどで測る。** scripts/lib/fit-fixture.mjs
  がこのファイルの maxChars / perScreen / MAX_CHARS を読んで、上限ちょうどの中身
  （均等に割った形と1つに寄せた形の2つずつ・見出しも上限の長さ・前後の画面も同じ
  長さの見出し）を作り、27通り × 訪問者とログインの姿で測る。上の表は数を決めた
  日の手測りの記録で、守っているのは検査のほう。数を変えれば検査も新しい数で測る。

  ここを上げるときは、CSS を触るのではなく、check:fit を通すこと。
  設計サイズで弁が開いたら、それは弁の不具合ではなく件数か字数の不具合。
*/

export const BLOCK_TYPES = [
  // 決まった中身を持つもの。1つだけ置ける
  // hero と contact は画面まるごとなので perScreen を持たない
  { key: 'hero', label: 'Hero', note: '大見出しとリード。文言は src/site.ts', kind: 'fixed' },
  /*
    個人開発（app）と業務（work）を1つの一覧に並べる。見る側にとってはどちらも
    「つくったもの」で、節を分けると目次もページャも2倍に伸びる。区分はデータに
    残り（src/domain.ts の ITEM_KINDS）、カードの札（プラットフォーム / 業界）と
    絞り込みのピル（すべて・個人開発・業務）で見分ける。並びは新しい順
    （src/db/queries.ts の itemOrder）
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
    note: 'メンバー。2人は横長、3人以上はグリッド。公開中が1人ならその人のプロフィールに置き換わる',
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
  --card-lines で止めてあるので、長く書いても画面からは溢れない——
  溢れる代わりに、書いたぶんが黙って切られる。だから上限は「溢れない長さ」
  ではなく「広い画面ならどこでも切れずに出る長さ」にした。600 以上は 100 字が
  切れずに出る6行で止める（app.css の「600px 以上」の :root。画像のある行だけ
  900 以上で3行）。600 未満はカードが2枚縦に積まれ、実績値か担当者名を持つ
  重い行は2行しか置けず、42 字（和文だけの文。= rail / center @390x844,
  Hiragino Sans, macOS Chromium）までしか出ないので、書く側にはそれも添える
  （itemSummaryVisible）。その2つを持たない軽い行は電話でも 100 字が出る
  （app.css の --card-lines-lean）。

  memberBio（紹介文）は個人ページの About 1枚に全段落が出る。件数で割れない
  ので、字数と段落の数の両方で止める。段落の区切りそのものが高さを取るので、
  同じ字数でも段落が多いほど高くつく。
  （実測 = 段落の数ごとに閉じる字数 @プリセット, 書体, ブラウザ）
    6段落 315 / 5段落 314 / 4段落 360 / 3段落 405（406 で +23px）
    / 2段落 426 / 1段落 459  @rail 390x844 指, Hiragino Sans, macOS Chromium
    （5段落だけ magazine。どれも1段落に寄せた形がいちばん厳しい）
  3段落・400 字にした。6段落・315 字より書ける量が多く、「経歴・取り組み・
  社外の活動」のように3つに分けて書ける。以前は 450 字・6段落（13px の段落で
  測った数）で、段落を 15px に上げた日に 6段落 315 字まで下がった。

  itemBody（作品の本文）は作品の本文の画面（/apps/item/<slug>/story。1枚目の
  次の1枚）に全段落が出る。割らないので（itemStory の注記）、紹介文と同じく
  字数と段落の数の両方で止める。同じ画面に並ぶのは戻る道・見出し（作品名と
  「Story」の添え）・ページャだけで、メモの1画面より「← 一覧に戻る」の札ぶん低い。
  見出しは作品名なので長さが決まっていない。公開中でいちばん長い作品名
  （問い合わせ対応エージェント、13字。雑誌風の 390 で添えと1行にぎりぎり収まる）と、
  390 で2行に折れる作品名（24字）の両方で測り、厳しいほうを採った。
  （実測 = 段落の数ごとに閉じる字数 @プリセット, 書体, ブラウザ。均等に割った形と
  1つに寄せた形の厳しいほう）
    作品名 13字: 1段落 425 / 2段落 380 / 3段落 336 / 4段落 313 / 5段落 263
    作品名 24字: 1段落 379 / 2段落 332 / 3段落 312（313 で +19px）/ 4段落 262
    @rail 390x844 指, Hiragino Sans, macOS Chromium（13字の3段落だけ magazine）
  3段落・300 字にした。「背景・やったこと・結果」を1段落ずつ書ける数で、作品名が
  2行に折れても閉じる。縛っているのは 390x844 の指（768x1024 指は 3段落 831 字、
  1440x900 は中央寄せで 515 字まで閉じる）。
  以前は本文を1枚目（説明・画像・実績値・タグ・行き先4本と同じ画面）に置いていて、
  60 字・1段落しか入らなかった（段落を 15px に上げ、電話を指で測るようにした日に
  2段落・130 字から下がった）。1枚目から本文を抜いて「くわしく読む →」の札を
  足した姿は、いちばん重い作品で 27通りとも閉じ、いちばん惜しい所で 44px 余る
  （= magazine 390x844 指。説明 100 字・画像・実績値・タグ3つ・行き先4本）。
  字の段や段落の間隔、戻る道の札を動かしたら、ここを測り直すこと。
  説明（summary）は数えない。別の欄で、上限（itemSummary）も別に持っている。
*/
/*
  itemTags / itemLinks は字数ではなく数。作品のページの高さを決めているのは
  字数だけではなく、タグの札の数（.tags は折り返す）と行き先の本数も同じ——
  作品の1枚目を測った「いちばん重い作品」がタグ3つ・行き先4本（リンク3本 +
  複数人のサイトの「担当」）の姿なので、公開できるのはその数まで。それより多い
  作品は、測っていない高さを持つことになる。増やすなら 27通りを測り直すこと
  （本文を次の画面へ移したので、1枚目はいちばん惜しい所で 44px 余っている）。
  リンクの欄が空けて出す行の数も同じ数（src/routes/admin/items.tsx の ItemForm）。
  下書きでは数を見ない（保存そのものは何個でも通る——D1 の束縛変数の上限は
  書き込みを行ごとに分けて避けている。src/routes/admin/items.tsx の childWrites）。
*/
/*
  memberHeadline（個人ページの大見出し）と blockHeading（打ち込むブロックの見出し。
  ひとことを除く）は、割れない1つの文・1つの名前。どちらも上限が無く、長い一文の
  大見出しを書くと個人ページの1枚目で弁が開き、長い見出しはページャを壊した。

  見出しはページャの手（「← 見出し」「見出し →」）と真ん中の枡に、前後の画面の
  見出しと1行に並ぶ。20 字の見出しが3つ並ぶと、390 ではページャの手が1字ずつの
  縦書きになって 443px まで伸び、どのブロックの画面も弁が 180〜350px 開いた。
  （実測 = check:fit の fixture。前後も同じ長さの見出し・中身は上限ちょうど。
  いちばん惜しい節の余り @プリセット, 書体, ブラウザ）
    見出し 10字   26px @magazine 390x844 指（ページャ 89px）
           12字    4px @magazine 390x844 指（ページャ 111px）
           14字  +18px 溢れる @magazine 390x844 指（ページャ 133px）
    大見出し 80字  82px @center 1440x900 / 100字 +17px 溢れる @center 1440x900
    （Hiragino Sans, macOS Chromium。書体3つとも同じ）
  見出しは 10 字、大見出しは 80 字にした。見出しの既定（Now・数字で見る・Links・
  Timeline・メモ）はどれも収まる。字で数えるので英字の見出しは実際より厳しく
  数えられる（Timeline は8字）が、ページャの幅はいちばん幅のある和文で決まる。

  経歴（careerText）の上限は、できごと（timeline）の maxChars をそのまま使う
  （memberPublishErrors の注記）。ここには置かない。
*/
/*
  itemTitle（作品名）はカードの題（--fs-md。行数で切らない）・作品のページと Story の
  見出し（--fs-display-xs）に出る。本文の上限（itemBody）は作品名を 24 字までと置いて
  測った数で、作品名そのものは見ていなかった——60 字の作品名で公開すると、雑誌風の
  390 の Story で弁が 37px 開き、本文の最後の段落が隠れた。
  （実測 = check:fit の fixture の2件（本文を均等に割った形と1つに寄せた形）の作品名を
  その長さにして、Projects・1枚目・Story を 27通り × 訪問者とログイン。いちばん惜しい
  節の余り @プリセット, 書体, ブラウザ）
    作品名 30字 / 32字  10.6px @magazine 390x844 指（1枚目。見出しが2行）
           36字          3.9px @rail 390x844 指（Projects。カードの題が2行）
           38字        +22px 溢れる @rail / center 390x844 指（Projects。題が3行に折れる）
           48字        +52px 溢れる @magazine 390x844 指（1枚目）
    （Hiragino Sans, macOS Chromium。書体3つとも同じ）
  32 字にした。36 字は閉じるが余りが 4px しかなく、字の段を1つ動かせば溢れる。
  fixture のいちばん重い作品（fit-fixture.mjs）の作品名はこの上限ちょうど。
*/
export const MAX_CHARS = {
  itemTitle: 32,
  itemSummary: 100,
  itemSummaryVisible: 42,
  itemBody: 300,
  itemBodyParagraphs: 3,
  itemTags: 3,
  itemLinks: 3,
  memberBio: 400,
  memberBioParagraphs: 3,
  memberHeadline: 80,
  blockHeading: 10,
} as const

export type BlockType = (typeof BLOCK_TYPES)[number]
export type BlockKey = BlockType['key']
type FixedBlockKey = Extract<BlockType, { kind: 'fixed' }>['key']

export const BLOCK_KEYS = BLOCK_TYPES.map((type) => type.key) as [BlockKey, ...BlockKey[]]

/*
  決まった中身の種類（hero / projects / team / contact）。サイトに1つずつしか置けない。

  「1つだけ」は画面の都合ではなく連なりの前提。同じ種類が2行あると、公開ページの
  画面の列に同じ URL（/projects）が2度並び、ページャの「次」が自分自身を指して
  入口から先へ進めなくなった（二重送信で実際に2行できた）。だから3か所で守る——
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
  種類」として落ち、作品の一覧・入口の帯・/apps と /works の 301 先がどれも 404 に
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

// その種類の1画面あたりの件数。持たない種類（hero・contact・ひとこと）は画面まるごと
export function blockPerScreen(key: BlockKey): number {
  const type = blockType(key)
  return type && 'perScreen' in type ? type.perScreen : 1
}

/*
  ブロックの中身を「画面に割る単位」の列に開く。

  公開ページ（renderBlock）はこの列をそのまま描き、画面の数（blockPages）と字数の
  関門（screenChars）は数えるだけ。同じ式を2か所に書くと、片方だけ直した日に
  管理画面の「N 画面」が静かに古い数を出し続ける（あの表示は「13件目を公開したら
  画面が1枚増えた」と気づかせるためにある）。
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
  説明文に畳むとき（src/routes/public/meta.ts の lineDigest）も字数を数えるとき
  （このファイルの screenChars）も、そこは外す。その規則が2か所に別々に
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

/* ------------------------------------------------------------- 公開の関門 */

// 「字」で数える。絵文字や異体字を2字と数えないように、コードポイントで数える
export const chars = (text: string) => [...text].length

/*
  ひとことの一文の長さ。字数（maxChars）とは別の決まりで、1枚の画面に大きく
  出る一文が 120 字を超えると「大きな一文」ではなく段落になる（収まるかどうか
  とは別の話。実測では 200 字でも弁は開かない）。
*/
export const MAX_STATEMENT_SENTENCE = 120

/*
  1画面ぶんずつの字数。割りかたは公開ページと同じ（chunk と perScreen）で、
  行の開き方も同じ（blockTexts / blockLines）。

  数えるのは画面に文字として出るものだけ。リンク集の URL は href であって
  本文には出ないので、2列目は落とす（URL の長さで書ける説明が減るのはおかしい）。
  形が通らない URL の行は公開ページに出ないので、blockLines が先に落とす。
*/
export function screenChars(type: BlockType, body: string): number[] {
  const perScreen = blockPerScreen(type.key)
  const units =
    type.key === 'note'
      ? blockTexts(body)
      : blockLines(type.key, body).map((parts) => blockVisibleParts(type.key, parts).join(''))
  return chunk(units, perScreen).map((screen) => screen.reduce((sum, text) => sum + chars(text), 0))
}

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
export function droppedLinkLines(body: string): string[] {
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

  1画面に収まる長さは、ここでは見ない。公開になるときだけ（publishErrors）。
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
  いなかった。構成の一覧の「公開する」は検査を通らず、下書きで上限の3倍に
  書き足したメモを、そのまま公開できた（設計サイズで弁が 522px 開いた）。
  一文を空にしたひとことも「公開」になり、公開ページでは節ごと消えた。
  逆に、メンバーの紹介文の長さは下書きの保存でも見ていて、上限より前に
  保存された長い紹介文の人は「公開を外すことすらできない」行き止まりだった。
  検査を入口ではなく状態の変わり目に付ければ、どちらも起きない。

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
      body: string
      imageAlt: string
      // 保存したあとに画像が残るか（新しく選んだ・いまの画像を外さずに残す）
      hasImage: boolean
      tags: number
      links: number
    }
  | { kind: 'member'; headline: string; bio: string; careerText: string }

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

  長さも同じ理由で見る。公開ページで1画面に収まらない中身は公開させない。
  いちばん多い画面の字数を添えるのは、何字削れば通るかが分からないと
  直しようがないため。決まった中身のもの（hero・projects…）は見るものが無い。

  free に絞ってから maxChars を読むのは**安全性のため**。どの種類でも
  `'maxChars' in type ? … : Infinity` と読んでいたころは、maxChars を持たない
  free ブロックを足したときに無制限で公開を通し、弁が開いて「スクロールしない」が
  静かに破れた。いまは同じ足し忘れが TS2339 でその場で落ちる。
*/
function blockPublishErrors(
  type: BlockType,
  values: { title: string; body: string },
): Record<string, string> | null {
  if (type.kind !== 'free') return null
  const invalid = blockValueErrors(type, values)
  if (invalid) return invalid
  const max = type.maxChars
  const errors: Record<string, string> = {}
  /*
    見出し（ひとこと以外）。目次・節の見出し・ページャの行き先（「← 見出し」
    「見出し →」）に出る名前で、ページャでは前後の画面の見出しと1行に並ぶ。
    上限は MAX_CHARS.blockHeading（実測はそこ）
  */
  if (type.key !== 'statement' && chars(values.title) > MAX_CHARS.blockHeading) {
    errors.title = `見出しは ${MAX_CHARS.blockHeading} 字までです（いま ${chars(values.title)} 字）。目次とページャに1行で並ぶ名前です`
  }
  if (type.key === 'statement') {
    if (chars(values.title) > MAX_STATEMENT_SENTENCE) {
      return { title: `大きく出る一文です。${MAX_STATEMENT_SENTENCE} 字までにしてください` }
    }
    const total = chars(values.title) + chars(values.body)
    if (total > max) {
      return { body: `1画面に収まりません。一文と添え書きで ${max} 字までです（いま ${total} 字）` }
    }
    return null
  }
  // 画面の数だけ数が並ぶので、広げずに畳む（行数に上限は無い）
  const worst = screenChars(type, values.body).reduce((most, n) => Math.max(most, n), 0)
  if (worst > max) {
    errors.body = `1画面に収まりません。1画面は ${max} 字までです（いちばん多い画面が ${worst} 字）`
  }
  return errors
}

/*
  作品。作品名はカードの題と作品のページ・Story の見出しに出るので、長さで止める
  （MAX_CHARS.itemTitle）。

  説明文は公開するときは必須。カードの本文で、作品のページの説明文（description）
  でもある——空のまま公開すると、そのページの description が入口と同じサイトの
  紹介文になり、検索結果でも共有カードでもどの作品か見分けられなかった。説明文は
  カードの行数で切られる（--card-lines）。切られても画面からは溢れないが、書いた
  ぶんが黙って消える。上限は 600 以上のカードなら切れずに出る長さ（MAX_CHARS.itemSummary）。

  本文は本文の画面（Story）1枚に全段落が出る。割らないので、字数と段落の数の
  両方で止める（紹介文と同じ形）。字数は打った文字列そのままで数える（空行も字）。
  段落は公開ページと同じ式で開く（itemStory）。タグの数と行き先の本数は、作品の
  1枚目の高さを決める（MAX_CHARS の注記）。

  画像があるのに代替テキストが空なら止める。作品のページではこの画像が
  作品の見た目を伝える唯一の手段で、名前の無い画像は読み上げでは「画像」と
  しか言えない。
*/
function itemPublishErrors(target: Extract<PublishTarget, { kind: 'item' }>) {
  const errors: Record<string, string> = {}
  const title = chars(target.title)
  if (title > MAX_CHARS.itemTitle) {
    errors.title = `1画面に収まりません。作品名は ${MAX_CHARS.itemTitle} 字までです（いま ${title} 字）`
  }
  const summary = chars(target.summary)
  if (!summary) {
    errors.summary = '公開するときは説明文が要ります。カードと作品のページの説明文になります'
  } else if (summary > MAX_CHARS.itemSummary) {
    errors.summary = `カードに収まりません。説明文は ${MAX_CHARS.itemSummary} 字までです（いま ${summary} 字）`
  }
  const body = chars(target.body)
  const parts = itemStory(target.body).length
  if (body > MAX_CHARS.itemBody) {
    errors.body = `1画面に収まりません。本文は ${MAX_CHARS.itemBody} 字までです（いま ${body} 字）`
  } else if (parts > MAX_CHARS.itemBodyParagraphs) {
    errors.body = `1画面に収まりません。段落は ${MAX_CHARS.itemBodyParagraphs} つまでです（いま ${parts} つ）`
  }
  if (target.tags > MAX_CHARS.itemTags) {
    errors.tags = `1画面に収まりません。タグは ${MAX_CHARS.itemTags} つまでです（いま ${target.tags} つ）`
  }
  if (target.links > MAX_CHARS.itemLinks) {
    errors.links = `1画面に収まりません。リンクは ${MAX_CHARS.itemLinks} 本までです（いま ${target.links} 本）`
  }
  if (target.hasImage && !target.imageAlt) {
    errors.imageAlt = '画像を公開するときは、代替テキストが要ります'
  }
  return errors
}

// 経歴を割る・数える相手。できごと（timeline）のブロックと同じ部品・同じ数
export const TIMELINE = BLOCK_TYPES.find(
  (type): type is Extract<BlockType, { key: 'timeline' }> => type.key === 'timeline',
) as Extract<BlockType, { key: 'timeline' }>

/*
  メンバー。紹介文は個人ページの About 1枚に全段落が出る（割る先が無い）。
  段落の数も見るのは、同じ字数でも空行を増やすと高くなるため（実測: 3段落なら
  405 字まで弁が閉じたまま、6段落に割ると 315 字まで下がる @rail 390x844 指,
  Hiragino Sans, macOS Chromium）。

  大見出しは個人ページの1枚目に大きく出る1つの文で、割れない（件数で割れない
  ものは入口で止めるほかに手が無い）。上限は MAX_CHARS.memberHeadline。

  経歴は Career の画面に、できごと（timeline）のブロックと同じ部品（<Timeline>）・
  同じ件数（MEMBER_PER_SCREEN.career = timeline の perScreen）で割って出る。だから
  字数も同じ数で止める——同じ部品を同じ数で割る以上、1画面の字数の上限も同じ。
  数え方も同じ（screenChars。割ったあとの1画面の字数）。以前は経歴だけ上限が
  無く、1行 110 字 × 5行の経歴が黙って保存でき、Career の画面で弁が開いた。

  止める理由は全部まとめて返す（publishErrors の決まり）。
*/
function memberPublishErrors(target: Extract<PublishTarget, { kind: 'member' }>) {
  const errors: Record<string, string> = {}
  const headline = chars(target.headline)
  if (headline > MAX_CHARS.memberHeadline) {
    errors.headline = `1画面に収まりません。大見出しは ${MAX_CHARS.memberHeadline} 字までです（いま ${headline} 字）`
  }
  const total = chars(target.bio)
  const parts = paragraphs(target.bio).length
  if (total > MAX_CHARS.memberBio) {
    errors.bio = `1画面に収まりません。紹介文は ${MAX_CHARS.memberBio} 字までです（いま ${total} 字）`
  } else if (parts > MAX_CHARS.memberBioParagraphs) {
    errors.bio = `1画面に収まりません。段落は ${MAX_CHARS.memberBioParagraphs} つまでです（いま ${parts} つ）`
  }
  const career = screenChars(TIMELINE, target.careerText).reduce((most, n) => Math.max(most, n), 0)
  if (career > TIMELINE.maxChars) {
    errors.careerText = `1画面に収まりません。経歴は1画面（${MEMBER_PER_SCREEN.career} 行）で ${TIMELINE.maxChars} 字までです（いちばん多い画面が ${career} 字）`
  }
  return errors
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
            同じ数にしてある——あの 3 は「3段落・400 字なら弁が1pxも開かない」
            という実測そのものなので、上限を上げた日に画面が割れて追いつく
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
  個人ページの中身を「画面に割る単位」の列に開く。ブロックの blockLines /
  blockTexts と同じ役目で、公開ページ（src/routes/public/member-screens.tsx の memberScreens）は
  この列を描き、管理画面（構成の「N 画面」）は数えるだけ。

  管理画面が数えるようになったのは、1人のサイトでは Team の行がその人の
  プロフィールに置き換わるため（src/routes/public/data.ts の profileOf）。「Team 1 画面」と
  出しているあいだに、公開ページでは4画面が並ぶ——数え方を2か所に書くと、
  いちばん要るときに「N 画面」が嘘をつく。
*/
export function memberUnits(member: Pick<Member, 'bio' | 'skillsText' | 'careerText'>) {
  return {
    bio: paragraphs(member.bio),
    skills: parseSkills(member.skillsText),
    career: parseLines(member.careerText),
  }
}

/*
  作品の本文（items.body）を段落の列に開く。段落が1つでもあれば、その作品は
  本文の画面（/apps/item/<slug>/story）を持つ。

  開く式はこの1本——公開ページ（src/routes/public/ の item.tsx・crawl.ts・
  全体ページの blocks.tsx）が画面を作るかどうかを決めるのも、公開の関門（itemPublishErrors）が
  段落を数えるのも、ここを読む。空白と空行だけの本文は0段落で、画面を作らない。
  「画面はあるのに中身が無い」も「中身があるのに sitemap に無い」も起こさない。

  割らない（本文の画面は作品1件に1枚）。上限（MAX_CHARS.itemBody /
  itemBodyParagraphs）は1枚に収まる数を実測したもの。割ると、Story の何枚目かを
  数える2つ目の数え方が要る——ページャは作品を数えている（src/lib/sequence.ts の
  countKey）ので、そこには置けない。
*/
export function itemStory(body: string): string[] {
  return paragraphs(body)
}

/*
  個人ページが何画面になるか。1枚目（名札）＋ About（空でも1枚。「準備中です」を
  出す）＋ Skills ＋ Career。書いていない Skills / Career は0画面。
*/
export function memberScreenCount(member: Pick<Member, 'bio' | 'skillsText' | 'careerText'>) {
  const { bio, skills, career } = memberUnits(member)
  return (
    1 +
    Math.max(1, screenCount(bio.length, MEMBER_PER_SCREEN.about)) +
    screenCount(skills.length, MEMBER_PER_SCREEN.skills) +
    screenCount(career.length, MEMBER_PER_SCREEN.career)
  )
}

/*
  画面の数を決める、サイトの件数。公開ページは描く中身から、管理画面は DB を
  数えて作る（src/routes/admin/blocks.tsx の siteCounts）。

  items.matched は絞り込んだあとの件数。絞り込みの無い数え方（管理画面・sitemap）
  では total と同じ数。profile は1人のサイトで Team の位置に並ぶプロフィールの
  画面数（memberScreenCount）で、Team を置いた1人のサイトでだけ数、ほかは null。
*/
export type SiteCounts = {
  items: { total: number; matched: number }
  members: number
  profile: number | null
}

/*
  そのブロックが公開ページで何画面になるか。0 なら節ごと出さない（URL も生まれない）。

  **公開ページと管理画面が同じこの1本を読む。** 公開ページ（src/routes/public/blocks.tsx
  の renderBlock）はこの数で節を出すかどうかと画面の枚数を決め、管理画面の構成の
  「N 画面」はこの数をそのまま出す。「節を出す条件」を2本の switch に書いていた
  ころは、片方だけ直した日に「N 画面」が実際の画面数から静かにずれる形だった。

  種類を足し忘れる方向は型が守る（switch に default を置かないので TS2366 で落ちる）。
  行の開き方は blockUnitCount、割り方は screenCount / perScreen。

  - 下書き（published が 1 でない）は 0。公開ページは publishedBlocks が先に落とす
  - Projects は、公開中が0件なら 0、絞り込んで0件になっただけなら 1（ピルを残して
    絞り込みを外す手を画面に置く）
  - 1人のサイトの Team は、その人のプロフィールの画面数（Team の画面は作らず、
    その位置にプロフィールが並ぶ。src/routes/public/site.ts の screenList）
*/
export function blockPages(
  block: Pick<Block, 'type' | 'title' | 'body' | 'published'>,
  counts: SiteCounts,
): number {
  const type = blockType(block.type)
  if (!type || block.published !== 1) return 0
  const perScreen = blockPerScreen(type.key)

  switch (type.key) {
    // 画面まるごとのもの。2画面目は無い
    case 'hero':
    case 'contact':
      return 1
    case 'statement':
      return block.title ? 1 : 0

    // 件数で割れるもの。行は DB に入っている
    case 'projects':
      return counts.items.total ? Math.max(1, screenCount(counts.items.matched, perScreen)) : 0
    case 'team':
      return counts.profile ?? screenCount(counts.members, perScreen)

    // 件数で割れるもの。行は body に入っている（通らない URL は数に入らない）
    case 'links':
    case 'note':
    case 'now':
    case 'numbers':
    case 'timeline':
      return screenCount(blockUnitCount(type.key, block.body), perScreen)
  }
}

/*
  何も置いていないサイトの並び。移行前の index.html と同じ順。

  blocks が空のときは、公開ページはこの並びで描き、管理画面には
  「まだ置いていない」と出す。空のテーブルで真っ白なトップが出るより、
  まず何か見えて、そこから外していけるほうが迷わない。
*/
export const DEFAULT_BLOCKS: FixedBlockKey[] = ['hero', 'projects', 'team', 'contact']
