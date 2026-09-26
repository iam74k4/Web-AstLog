import { raw } from 'hono/html'
import type { Child } from 'hono/jsx'
import adminCss from '../../public/admin.css'
import appCss from '../../public/app.css'
import type { Item, Member } from '../db/schema'
import { initials, isSafeUrl, type SkillGroup, skillRows } from '../lib/format'
import { MarkIcon, PencilIcon } from './icons'

/*
  画面はこの部品だけで組む。新しい見た目が要るときは、まずここに足してから使う。
  ここに無い形をその場で書くと、同じものが少しずつ違う姿で増える。
*/

/*
  HTML の文書そのもの。<!DOCTYPE html> と <html lang="ja"> の2つだけを持つ。

  このサイトが返す HTML は4つの外枠から出る——公開ページ（Layout）、
  管理画面の壁の中と外（AdminLayout / AdminBare）、404 と 500（src/index.tsx の
  ErrorPage）。どれも自分で <html> を書いていて、4つとも DOCTYPE が無かった。
  JSX は <!DOCTYPE> を書けないので、書かないまま誰も気づかなかった。

  DOCTYPE が無いと、ブラウザは**互換モード（quirks mode）**で組む。
  CSS はそのつもりで書いていないのに、互換モードの挙動に黙って合わせていた——
    - document.scrollingElement が html ではなく body になり、
      documentElement.clientHeight が画面の高さではなく中身の高さを返す
      （check:fit を documentElement で書いていたら、/all でさえ差が 0 と出た）
    - form に下の余白 1em が付く
    - 字を持たない行（アイコンだけの行など）が、行の高さの支え（strut）を持たない
    - 表の中で書体の大きさが継がれない、など
  どれも「今日はたまたま崩れていない」だけで、足した規則が標準の挙動と違う
  姿で出たときに、原因を CSS の側から辿れない。

  標準モードへ移した日に測った差（Chromium）——
    - 公開ページ: 19 URL × 3骨格 × 5寸法のどの要素も 1px も動かなかった
    - 管理画面: form の余白 14px ぶん詰まった。構成の行では、隣の form の
      余白に引き伸ばされて 50px になっていた編集・外すのアイコンボタンが
      36px に戻った（= 構成 @1440x900）
    - 404: ロゴの箱だけが strut で 28 → 35.8px に伸びた（.oops__mark を
      flex にして 28px に戻した）

  hono/jsx には <!DOCTYPE> を出す構文が無いので、hono/html の raw で1行だけ
  前置きする（jsx-renderer の docType と同じやり方。あちらはミドルウェア1つの
  ために c.html の呼び方を全部変えることになるので使わない）。

  外枠はこの部品を通して <html> を開く。<html> を直に書く外枠を1つ足すと、
  その画面だけが互換モードに戻る——test/public.test.ts の「文書の外枠」が
  公開・管理・404 の本文の先頭を見ている。
*/
export const HtmlDocument = ({ children }: { children: Child }) => (
  <>
    {raw('<!DOCTYPE html>')}
    <html lang="ja">{children}</html>
  </>
)

/*
  スタイルシートの <link>。公開ページ（Layout）と 404（ErrorPage）は app.css だけ、
  管理画面（AdminLayout / AdminBare）は app.css のあとに admin.css を読む
  （管理画面の部品の規則は admin.css にしか無い。公開ページの訪問者に配らない）。

  URL には中身から作った版（?v=…）を付け、public/_headers が2つの CSS を
  1年・immutable で配る。ブラウザは同じ版のあいだ一度も取り直さず、CSS を
  1字でも変えてデプロイすれば URL が変わるので、新しい HTML は新しい CSS を読む。
  既定（max-age=0, must-revalidate）のままだったころは、ページャを押すたびに
  描画を止めて CSS を条件付き GET で取り直していた（画面の移動は普通の
  フルページ遷移なので、1画面ごとに1往復）。

  版は Worker に同梱した CSS の文字列から、読み込みのときに1度だけ作る
  （wrangler.toml の [[rules]] が *.css を文字列として同梱する。テストでは
  vitest.config.ts の cssTextPlugin が同じ形で渡す）。デプロイの版（Worker の
  version id）にしないのは、CSS を変えていないデプロイで全員に取り直させない
  ためと、wrangler dev で CSS を直した瞬間に URL が変わる（開発中に immutable の
  古い写しを掴まない）ため。静的なファイルの配り手は query を見ずにパスで
  返すので、?v= は URL を分けるためだけのもの。
*/
const cssVersion = (text: string) => {
  // FNV-1a（32bit）。改ざんを見る値ではなく、変わったかどうかの印
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(36)
}

export const STYLESHEETS = {
  app: `/app.css?v=${cssVersion(appCss)}`,
  admin: `/admin.css?v=${cssVersion(adminCss)}`,
} as const

export const Stylesheets = ({ admin = false }: { admin?: boolean }) => (
  <>
    <link rel="stylesheet" href={STYLESHEETS.app} />
    {admin ? <link rel="stylesheet" href={STYLESHEETS.admin} /> : null}
  </>
)

/*
  柱の頭のロゴ。大きさは1つだけ。

  小さい段（sm）は個人ページの柱のためにあったが、個人ページもサイトの柱を
  使うようになって出番が無くなった。段を足すときは、修飾子（.brand--xx）と
  その規則を app.css に一緒に足すこと。
*/
export const Brand = () => (
  <a class="brand" href="/">
    <MarkIcon size={27} />
    <span class="brand__word">NOCTIFEX</span>
  </a>
)

/*
  公開ページから管理画面への入口。ログインしている人にだけ柱に出る
  （出すかどうかと行き先は src/routes/public.tsx の adminHref が決める）。
  行き先は「いま見ている画面を直す場所」——/projects なら項目の一覧、
  作品1件のページならその作品の編集。

  同じタブで開く。管理画面の側には「サイトを見る ↗」が別タブで付いているので、
  行き来の片方は同じタブ、片方は別タブになる。こちらまで別タブにすると、
  直して見に来るたびにタブが1枚ずつ増えていく。
*/
export const AdminLink = ({ href }: { href: string }) => (
  <a class="rail__admin" href={href}>
    <PencilIcon />
    管理画面
  </a>
)

/*
  size は必須。既定値を置くと、渡し忘れが --avatar-size:undefinedpx として
  静かに出ていく——CSS 側のフォールバックが拾うので、画面も型もテストも通る。
*/
export const Avatar = ({
  src,
  name,
  size,
}: {
  src?: string | null
  name: string
  size: number
}) => (
  <span class="avatar" style={`--avatar-size:${size}px`}>
    {/*
      遅延読み込みにしない。1ページに数枚しか無く、どれも小さい。
      待たせる利得より、Team の欄が空の丸のまま見える時間のほうが痛い
      （印刷とスクリーンショットでは、そのまま空で焼き付く）
    */}
    {src ? (
      <img src={src} alt="" width={size} height={size} />
    ) : (
      <span class="avatar__fallback" aria-hidden="true">
        {initials(name)}
      </span>
    )}
  </span>
)

/*
  節の見出しと添え。

  h1 は「この節だけで1つの画面（= 1つのドキュメント）になっている」とき。
  画面ごとに URL を分けた以上、見出しはその画面の中で完結していなければ
  ならない——h2 から始まるドキュメントでは、読み上げの見出し移動で骨格を
  掴めず、検索から直接着いた人も「ここは何のページか」を見出しから取れない。
  縦に積んだ全体ページ（/all）だけは1つのドキュメントに節が並ぶので、
  そちらは今までどおり h2（h1 は Hero が1つ持つ）。

  出し分けの元は renderBlock が受け取る page: number | null で、
  page !== null が「割られた画面」を意味する。ここで数えない。

  note（添え）は見出しに無い情報のときだけ渡す——作品のページの「業界 · 年」、
  区分のピルが並ばない Projects の区分名。見出しの訳語（About の「紹介」、Team の
  「メンバー」…）は渡さない。同じ見出しを2つの言語で2度言うだけになる
  （CLAUDE.md「文言」）。

  sub は「節の中の小節」で h3。いまは全体ページ（/all）の Profile の節だけが
  使う——1人のサイトでは Team の代わりにその人のプロフィールを1つの節として
  置き、About / Skills / Career をその中の小節にする（Hero の h1 → Profile の
  h2 → About の h3）。割られた画面では About も Skills も1枚ずつの画面で h1 に
  なるので、sub は要らない。
*/
export const SectionHead = ({
  title,
  note,
  h1,
  sub,
}: {
  title: string
  note?: string
  h1?: boolean
  sub?: boolean
}) => (
  <div class={sub ? 'head head--sub' : 'head'}>
    {h1 ? <h1>{title}</h1> : sub ? <h3>{title}</h3> : <h2>{title}</h2>}
    {note ? <span class="note">{note}</span> : null}
  </div>
)

/*
  読み上げのためだけに置く見出し（.sr-only）。目に見える見出しを持たない画面が
  使う——締めの Contact（ボタンの言葉が見出しの代わり）と、見出しを空けた
  メモ（段落が画面の全部）。

  割られた画面は h1 をちょうど1つ持つ決まり（CLAUDE.md「1画面 = 1ドキュメント」、
  WCAG 1.3.1）。見出しの無い画面は、見出しで移動する人にとって「何も無い」
  画面になる。全体ページ（/all）では節の見出しの段（h2）。

  目に見える見出しを置かない理由は呼ぶ側にある（Contact・メモの注記）。ここは
  見出しの段と見えなさだけを持つ。月の節（.moonlit）の直下には置かないこと
  ——「中身を月より前に出す」規則（position: relative）に .sr-only の
  position: absolute が負けて、1px の段が1つ増える（Contact は .contact の中に置く）。
*/
export const HiddenHeading = ({ text, h1 }: { text: string; h1?: boolean }) =>
  h1 ? <h1 class="sr-only">{text}</h1> : <h2 class="sr-only">{text}</h2>

/*
  画面1枚ぶんの箱。main の直接の子になるものは、ここか Hero が作る。

  この箱そのものが「弁」——app.css の `main > :is(.hero, section)` に付いた
  `overflow: auto` で、拡大 200% 以上・画面高 400px 未満・書体差の3つでだけ
  開く最後の受け。開いたときに中身を読む手段が要るのに、WebKit（macOS Safari と
  iOS の全ブラウザ）ではスクロール箱そのものにキーボードでフォーカスできない。
  逃げ道は「箱の中のフォーカス可能な要素へ Tab すれば scroll-into-view が働く」
  ことだが、紹介・技術・経歴・ひとこと・メモの画面には止まれる子が1つも無い。
  だから tabindex を明示する（WCAG 2.1.1）。

  1画面あたりタブ停止が1つ増えるのは承知のうえ。どの節が「止まれる子を持つか」を
  1つずつ判断すると、これから足す節が必ず漏れるので、例外は作らない。
  （弁を節そのものに付ける判断も同じ形で、クラスを列挙していない）

  whole は「縦に積んだ全体ページ（/all）の節」。あちらは body[data-whole] で
  外枠ごと外れていて弁が無い（ページ自身が動く）ので、tabindex も付けない
  ——止まる理由が無い箱にタブ停止を置くと、いちばん長いページで数だけ増える。
  出し分けの元は renderBlock の split（page !== null）1つで、節ごとの判断ではない。

  label を渡すと、その名前の付いた region として読み上げに出る。名前の無い
  region は読み上げに現れないので、見出しを持たない箱（ひとこと・帯）には
  付けない。渡す文字列は見出しと同じ変数から取ること。

  moonlit は「背景に月（MoonField）を敷く節」。月は節いっぱいに絶対配置で
  貼るので、節が位置の基準になり、中身は入口と同じく画面の下に寄る
  （app.css の .moonlit）。月を置くときは必ず一緒に立てること——立てないと
  月の基準が外枠まで抜け、ページ全体に光暈が広がる。
*/
export const Screen = ({
  id,
  label,
  whole,
  moonlit,
  children,
}: {
  id?: string
  label?: string
  whole?: boolean
  moonlit?: boolean
  children: Child
}) => (
  <section
    id={id}
    class={moonlit ? 'moonlit' : undefined}
    tabindex={whole ? undefined : 0}
    role={label ? 'region' : undefined}
    aria-label={label}
  >
    {children}
  </section>
)

/*
  入口の画面。<header class="hero">。

  節と同じく弁の付く箱なので、tabindex はこちらにも要る——大見出しとリードしか
  無く、Tab で止まれる子が1つも無い画面の代表がこれ。
*/
export const Hero = ({ whole, children }: { whole?: boolean; children: Child }) => (
  <header class="hero" tabindex={whole ? undefined : 0}>
    {children}
  </header>
)

/*
  文を句読点（、。！？）の直後でだけ折れるようにする。

  日本語は既定だとどの字の間でも折れるので、幅しだいで「置いてお / く。」や、
  段落の最後の「す。」だけが次の行に落ちる、が起きる。句読点までを1つの塊に
  して inline-block にし、塊の中では折らせない。塊が行より長いときだけ、その
  中で折れる（inline-block は行の幅を超えない）。

  使うのは短い一文だけ——入口の大見出しとリード文、個人ページの大見出し、
  締めの誘いの1文。どれもどのブラウザでも同じ所で折れてほしい場所（大見出しは
  塊を1行ずつに積み、リード文と誘いの1文は月の光暈の上の位置を
  npm run check:contrast が測る）。

  打ち込む中身（節の見出し・カードの説明・段落）には使わない。長い段落を
  句読点の塊に切ると、行に入りきらない塊が丸ごと次の行へ落ちて、行末に大きな
  空きが残る。あちらは CSS の word-break: auto-phrase（ブラウザが文節で折る。
  いまは Chromium だけで、知らないブラウザは字の間で折る）に任せてある
  （app.css の .phrase のすぐ下）。大見出しには両方が掛かっていて、塊が1行より
  長くなったときだけ、塊の中を文節で折る。

  --i は塊の順番。入口の大見出しは、これで1塊ずつ遅らせて浮かび上がる
  （app.css の .hero h1 .phrase）。
*/
export const splitPhrases = (text: string): string[] =>
  text.match(/[^、。！？]+[、。！？]*|[、。！？]+/g) ?? [text]

export const Phrases = ({ text }: { text: string }) => (
  <>
    {splitPhrases(text).map((part, order) => (
      <span key={part} class="phrase" style={`--i:${order}`}>
        {part}
      </span>
    ))}
  </>
)

/*
  入口の背景に敷く月。ロゴの三日月を立体にして粒子を散らし、Blender で
  焼いた1枚（作り直しは scripts/moon/render.py → scripts/moon/pack.py）。

  ここだけが、このサイトで唯一のラスターの装飾。CSS の幾何では出せない
  ものを持っているから、その代償として置いている——粒の立ち方と、縁が
  粒に散っていくこと。

  **絵は色も光暈も持たない。** 運ぶのはアルファ1面だけで、そこに
  「どこがどれだけ光っているか」が入っている。色は app.css が --accent から
  作って敷き、この絵を mask として抜く（.moon__mark::after）。光暈も同じく
  CSS の radial-gradient（--moon-glow）。

  こうしてあるので、見た目プリセットを変えると**光暈だけでなく三日月そのものの
  色も変わる**。焼き込んでいたころは、(a) 紫が固定されてアクセントの色の
  多くと喧嘩し、(b) 光と形を別々に動かせないのでリード文が明るい縁に載って
  読めず（実測 1.00:1）、(c) 760x760 の画布のうち三日月は 4.3% しか無かった。

  **マークアップに出るのは空の span 1つだけ。** 形式の選択（AVIF が本命・
  WebP が控え）も CSS の image-set が持つ。<picture> をやめたのは、
  .moon を display: none にしても <img> は取得を止めないため——隠す場面で
  取りに行かせないために、以前はここに透明 1x1 の GIF を置いていた。
  CSS の mask なら、隠れている要素の分は最初から取りに行かない。

  aria-hidden を置く。意味を持たない装飾なので、読み上げに流さない
  （<img> が無いので alt は要らなくなった）。

  置く側（renderBlock の case 'hero'）が Hero の先頭の子として渡す。Hero 自身に
  埋めないのは、この部品を個人ページの名乗りでも使っているため——埋めると
  全員のページに月が出る。

  closing は連なりの最後の画面（Contact）に置く月。入口の月を左右に返し、
  ひとまわり小さく、動かさずに置く（app.css の .moon--closing）。最初と最後の
  画面が同じ構図の裏表になる。置く側は Contact 部品で、受ける節には
  Screen の moonlit を立てる。
*/
export const MoonField = ({ closing }: { closing?: boolean }) => (
  <div class={closing ? 'moon moon--closing' : 'moon'} aria-hidden="true">
    <span class="moon__mark" />
  </div>
)

/*
  画面1つぶんの節。中身を「見出しの箱」と「本文の箱」の2つに畳む。

  節は中身を画面の上端から置く（上揃え。めくっても見出しが動かない錨。app.css の
  「画面に収める外枠」）。子が4つ（見出し・絞り込み・一覧・0件の知らせ）に散って
  いると、入りきらなくなったときに、どれを縮めるかを毎回選ぶことになる。2つに
  畳んでおけば、手を入れる先は本文の箱ひとつに決まる。

  見出し側には、めくっても動かないもの（見出しと絞り込みのピル）を入れる。
*/
export const ScreenSection = ({
  id,
  label,
  whole,
  head,
  children,
}: {
  id: string
  label?: string
  whole?: boolean
  head: Child
  children: Child
}) => (
  <Screen id={id} label={label} whole={whole}>
    <div class="screen-head">{head}</div>
    <div class="screen-body">{children}</div>
  </Screen>
)

/*
  日本語のページ（<html lang="ja">）に素で置いた英語の塊に印を付ける。

  LANGUAGES や PRACTICE のような普通名詞は、印が無いと日本語の音声エンジンが
  ローマ字読みするか読み飛ばす。ただし小見出しは打ち込んだ文字列なので、
  日本語が1文字も混じっていないものだけを英語と見なす——「言語」と書いた人の
  見出しに lang="en" を付けると、今度はそちらが読めなくなる。

  見た目もこの印で分ける。等幅の書体は英字の札（技術の小見出し・タグ・入口の
  肩書き）にだけ掛け、app.css はそれを :lang(en) で選ぶ——打ち込んだ字が
  和文なら、等幅の字間も 11px の段も付かない（app.css の :root の --font-mono）。
  使うのは SkillGroups・Tags と、入口の肩書き（src/routes/public.tsx）。
*/
const LATIN_ONLY = /^[ -~]+$/
export const langOf = (text: string) => (LATIN_ONLY.test(text) ? 'en' : undefined)

// タグ。英字だけの札にだけ lang="en"（等幅になる。langOf を見ること）
export const Tags = ({ tags }: { tags: string[] }) =>
  tags.length ? (
    <ul class="tags">
      {tags.map((tag) => (
        <li key={tag} lang={langOf(tag)}>
          {tag}
        </li>
      ))}
    </ul>
  ) : null

export type ItemView = Item & {
  tags: string[]
  links: { label: string; url: string }[]
  platformLabel: string | null
  memberName: string | null
  memberSlug: string | null
}

/*
  作品1件の恒久リンク。1語目は種類（apps / works）、3語目が slug。

  3語にしてあるのは、1語・2語の URL を何でも拾う catch-all（/:screen と
  /:screen/:page）と取り合わせないため。/apps/2 は数字だけの2語のまま残る。

  slug の無い行（この列より前からある作品）は null を返す。呼ぶ側は
  「恒久リンクがまだ無い」として、リンクそのものを出さない——中身の当てに
  ならない URL を出すくらいなら、出さないほうがよい。
*/
export const itemHref = (item: { type: 'app' | 'work'; slug: string | null }) =>
  item.slug ? `/${item.type === 'app' ? 'apps' : 'works'}/item/${item.slug}` : null

/*
  作品の本文の画面（Story）。恒久リンクの続きの4語目で、本文を持つ作品にだけある
  （持つかどうかは呼ぶ側が src/blocks.ts の itemStory で決める。ここは URL の
  形だけ）。

  名前の語（story）にしてあるのは、数（/2）だと「作品の2枚目」としか言わず、
  1枚目と本文のあいだに画面を1枚足した日に、貼られた URL が別の画面を指すため。
  個人ページの /members/<slug>/about と同じ文法でもある（名前の画面・数は続き）。
  4語なので catch-all（1語・2語）とも /members/:slug/:screen とも取り合わない。
*/
export const itemStoryHref = (item: { type: 'app' | 'work'; slug: string | null }) => {
  const at = itemHref(item)
  return at ? `${at}/story` : null
}

/*
  カードのサムネイルの枠を取るか。作品に画像があるか、同じ行（1画面ぶんの
  カードの並び）のどれかに画像があるときに取る——呼ぶ側（public.tsx の
  projects）が行ごとに数えて渡す。

  画像の無いカードにも枠だけを置くのは、同じ行のカードの題をそろえるため。
  行のカードは grid の既定（stretch）でいちばん高いカードの高さにそろうので、
  枠を置かなくても行の高さは1pxも縮まない。変わるのは空きの置き場所だけで、
  置かないと画像の無いカードの題が上に浮き、空きがカードの真ん中に残る
  （左は画像の下から、右は上端から字が始まる行になる）。枠を置けば、
  空きは画像の場所に集まり、題・札・説明が行の中で同じ高さに並ぶ。

  行に1枚も画像が無ければ枠を取らない。そろえる相手が居ないのに空の枠を
  並べると、画像の読み込みに失敗した一覧に見える。
*/
const hasShot = (item: Pick<Item, 'imageUrl'>) => Boolean(item.imageUrl)

export const shotRow = (items: Pick<Item, 'imageUrl'>[]) => items.some(hasShot)

export const ItemCard = ({
  item,
  showMember,
  framed,
}: {
  item: ItemView
  showMember?: boolean
  framed?: boolean
}) => {
  /*
    カードのどこを押しても、その作品のページ（恒久リンク）へ行く。

    カードそのものを <a> にはできない。中に外へのリンク（.links の Repository ↗
    など）と担当者名（.card__member）があり、<a> は入れ子にできない。click を
    拾う JavaScript も公開ページには置かない。だから題のリンク（.card__link）の
    ::after をカードいっぱい（inset: 0）に広げ、カードの面を押すと題のリンクを
    押したことになるようにする（stretched link。規則は app.css の .card__link）。
    カードの中のほかのリンクは重ねの順でその上に出してあるので、押せばそれぞれの
    行き先へ行く。

    以前は題の字だけがリンクで、見た目は本文と同じだった。そのうえ
    @media (hover: hover) の .card:hover がカードごと浮かせていたので、浮いた
    カードの説明を押しても何も起きなかった——触れる合図はカード全体に出して
    おきながら、押せる場所は題の字幅しか無かった。

    リンクの数は増やさない。読み上げでもキーボードでも、止まるのは題の1本で、
    名前は作品名のまま（::after は字を持たない）。フォーカスの輪郭はその ::after
    に描くので、カード全体を囲む。

    slug の無い行（恒久リンクがまだ無い作品）は題を素の字のまま出し、押せる面も
    浮きも付かない——ホバーで持ち上げるのは題にリンクを持つカードだけ
    （app.css の .card:has(.card__link)）。押しても何も起きないカードを浮かせない。
  */
  const href = itemHref(item)
  return (
    <article class="card">
      {/*
        サムネイル。600 以上でだけ出す（app.css の .card__thumb）。狭い画面では
        カードが1列に縦に積まれ、1画面の高さの予算に画像1枚ぶんの余りが無い。
        畳んでも「どこにも無くなる」ものではない——同じ画像が作品のページに
        代替テキストつきで出ている（Shot）。

        ここの画像は飾り（alt=""・aria-hidden）。カードの名前は題のリンクが
        持っていて、同じ絵に2つ目の名前を付けると読み上げが作品を2度名乗る。

        loading="lazy" は、畳んだ画面で取りに行かせないため。display: none の
        <img> は、ふつうの読み込みでは隠れていても取得される（入口の月の
        <picture> をやめた理由と同じ）。遅延読み込みの画像は画面に入るまで
        取りに行かず、display: none の要素は画面に入らない。枠の縦横比は
        CSS が決めているので、読み込みを待っても高さは動かない。
      */}
      {item.imageUrl || framed ? (
        <span class="card__thumb" aria-hidden="true">
          {item.imageUrl ? (
            <img src={item.imageUrl} alt="" loading="lazy" decoding="async" />
          ) : null}
        </span>
      ) : null}
      <div class="card__head">
        <h3>
          {href ? (
            <a class="card__link" href={href}>
              {item.title}
            </a>
          ) : (
            item.title
          )}
        </h3>
        {item.year ? <span class="year">{item.year}</span> : null}
      </div>
      {item.platformLabel || item.category ? (
        <span class="chip">{item.platformLabel ?? item.category}</span>
      ) : null}
      {item.summary ? <p>{item.summary}</p> : null}
      <Metric item={item} />
      {/*
        タグと行き先は、1画面に収めるページでは 600 未満と、900 以上で画像の枠を
        持つ行で畳む（app.css の --card-extras。全体ページではいつも出す）。
        どちらも作品のページ（カードを押した先）に同じものが出ている。いちばん
        重いカード2枚の行が、電話で 197px、1440 の中央寄せで 83px 溢れていた
      */}
      <Tags tags={item.tags} />
      {showMember && item.memberName && item.memberSlug ? (
        <a class="card__member" href={`/members/${item.memberSlug}`}>
          {item.memberName}
        </a>
      ) : null}
      <LinkRow links={item.links} />
    </article>
  )
}

/*
  実績値（値・単位・添え）を1行に。カードと作品のページで同じものを描く。
  トップの「数字」ブロック（Numbers）の箱とは別物——あちらは数字そのものが
  主役の節で、こちらは作品の中の1行。

  並びは値・単位・添えのまま。書いた人の数字の意味を並べ替えで変えない
  （public.tsx の metricDigest と同じ決まり）。添えは値のあとに続けて読まれる
  ので、そう読んで意味が通る形で書いてもらう（「20 人日 見込み 40人日から半減」。
  管理画面の実績値の欄にヒントがある）。
*/
export const Metric = ({
  item,
}: {
  item: Pick<Item, 'metricValue' | 'metricUnit' | 'metricNote'>
}) =>
  item.metricValue ? (
    <div class="metric">
      <span class="metric__value">{item.metricValue}</span>
      {item.metricUnit ? <span class="metric__unit">{item.metricUnit}</span> : null}
      {item.metricNote ? <span class="metric__note">{item.metricNote}</span> : null}
    </div>
  ) : null

/*
  行き先を1行に並べる（.links）。カードの底と、作品のページの行き先。

  矢印は CSS が付ける——外へ出る行き先は ↗、サイトの中（/ で始まる URL。
  作品のページの「担当」）は →（app.css の .links a）。別タブで開くか（target）
  と rel も同じ1つの条件で決める（LinkList と同じ決まり。↗ は「外へ出る・
  別タブで開く」の印で、同じタブで開くサイトの中の続きには付けない）。

  URL の形はこの部品が自分で見る（isSafeUrl）。通らない行は描かない。保存でも
  弾いている（admin.tsx の readLinks）が、その検査より前に入った行を呼ぶ側の
  検査に頼らずに落とす。javascript: が同じオリジンの href に載るのを、
  target="_blank" の副作用で止まっているだけにしない。
*/
export const LinkRow = ({ links }: { links: { label: string; url: string }[] }) => {
  const safe = links.filter((link) => link.label && isSafeUrl(link.url))
  return safe.length ? (
    <div class="links">
      {safe.map((link) => {
        const inside = link.url.startsWith('/')
        return (
          <a
            key={link.url}
            href={link.url}
            rel={inside ? undefined : 'noreferrer'}
            target={inside ? undefined : '_blank'}
          >
            {link.label}
          </a>
        )
      })}
    </div>
  ) : null
}

/*
  作品のスクリーンショット。作品1件のページの figure。

  代替テキストは管理画面で書いたもの（items.image_alt）。空のまま公開させない
  （src/blocks.ts の publishErrors。公開の関門）——このページではこの画像がその作品の
  見た目を伝える唯一の手段で、カードのサムネイル（飾り）とは役目が違う。

  枠の高さは CSS が決め（:root の --shot-h。900 以上では文の列と同じ高さ）、
  絵はその中に object-fit: contain で縮めて収める（切らない）。寸法は共有カードの
  ためにだけ持っていて（items.image_width / image_height。この列より前の画像には
  無い）、枠には使わない。絵に合わせて枠を伸び縮みさせると、読み込んだ瞬間に下の
  文の列が押し下げられ、1画面に収まるかどうかが絵の縦横比しだいになる。枠を
  決めておけば、どんな絵でも高さは同じで、1枚目の上限（src/blocks.ts の
  MAX_CHARS の説明・タグ・リンク）を1つの数で決められる。

  遅延読み込みにしない。この画面の主役で、開いた時点で画面の中にある。
*/
export const Shot = ({ src, alt }: { src: string; alt: string }) => (
  <figure class="shot">
    <img src={src} alt={alt} decoding="async" />
  </figure>
)

/*
  作品1件のページの1枚目の、見出し（SectionHead）の下。**カードを開いたもの**として
  組む——説明・実績値・タグ・行き先はカードと同じ部品（Note の段落・Metric・
  Tags・LinkRow）で、行止め（--card-lines）を外した全文。足すのは画像（Shot）と、
  本文の画面への入口（StoryLink）の2つだけ。

  カードと同じ部品にしたのは高さのため。以前は実績値をトップの「数字」の箱
  （Numbers）で、行き先をリンク集の行（LinkList）で出していて、説明 100 字・
  実績値・行き先3本の作品では、それだけで画面が埋まっていた——画像を置くと、
  本文が1字も無くても弁が 82px 開いた（= center @1440x900, Hiragino Sans,
  macOS Chromium）。箱を1行に、3行を1行にすると、画像の入る場所が空く。
  カードから開いた先で同じ形に着く、という続き方にもなる。

  並びは 画像 → 文の列（説明・入口・実績値・タグ・行き先）。900 未満では
  縦に、900 以上では文の列を左・画像を右に並べる（app.css の .detail--shot）。
  画像を先に置くのは、縦に積んだとき見出しのすぐ下に来るように。横に並べた
  ときは左から読み始める文の頭を見出しにそろえたいので、画像は右へ回す。

  **本文（背景・やったこと・結果）はここに置かない。** 次の画面（Story。
  story に渡す URL）に1枚まるごと取ってある。この画面に置いていたころは、説明・
  画像・実績値・行き先4本と同じ1画面に収めるために、本文が 60 字・1段落まで
  縮んでいた——「背景・やったこと・結果」が書けない長さで、作品のページが
  カードを大きくしただけになっていた。入りきらないぶんは次の URL へ、の決まりの
  とおりに送る。入口は説明のすぐ下——説明を読み終えた所で、続きがあると分かる。

  links は行き先（作品のリンクと、複数人のサイトなら「担当」）。呼ぶ側が
  組む——担当を出す条件（showMemberOf）はサイトの構成を知っている側にしかない。
  story も呼ぶ側が決める（本文があるときだけ URL。無ければ入口を出さない）。
*/
export const ItemDetail = ({
  item,
  links,
  story,
}: {
  item: ItemView
  links: { label: string; url: string }[]
  story?: string | null
}) => (
  <div class={item.imageUrl ? 'detail detail--shot' : 'detail'}>
    {item.imageUrl ? <Shot src={item.imageUrl} alt={item.imageAlt} /> : null}
    <div class="detail__text">
      {item.summary ? <Note paragraphs={[item.summary]} /> : null}
      {story ? <StoryLink href={story} /> : null}
      <Metric item={item} />
      <Tags tags={item.tags} />
      <LinkRow links={links} />
    </div>
  </div>
)

/*
  作品の1枚目から、本文の画面（Story）への入口。「← 一覧に戻る」（BackLink）と
  対の丸い札で、見た目も当たり判定（--tap）も同じ（app.css の .back, .more）。
  向きだけが逆——あちらは1つ上の一覧へ戻る手、こちらは同じ作品の続きへ進む手。

  ページャの「次 →」も同じ行き先を指す。それでも置くのは、ページャの手は
  行き先を言わない（同じ作品の中なので名乗らない。src/lib/sequence.ts の
  countKey）から——説明を読み終えた所に「続きがある」と言う手が無いと、
  本文の画面があることは押してみるまで分からない。ページャの側を落とさない
  理由は CLAUDE.md の「同じ行き先を1つの画面に2つ置かない」。

  矢印は飾りなので読み上げに流さない（BackLink・帯と同じ）。
*/
export const StoryLink = ({ href }: { href: string }) => (
  <a class="more" href={href}>
    くわしく読む
    <span aria-hidden="true">→</span>
  </a>
)

/*
  全体ページ（/all）の Projects の節に置く、作品の本文の列。カードの grid の下。

  全体ページは中身を全部載せる場所（印刷・Ctrl-F・翻訳の宛先）なので、割られた
  画面では Story の画面にしか無い本文も、ここで読めなければならない。カードの
  中には入れない——カードは面ごと作品のページへのリンクで（題の ::after が
  覆う）、覆いの下の段落は選べも読み上げの移動もしにくい。2列の grid の片方だけが
  本文の長さぶん伸びるのも避ける。

  見出しは Story の画面と同じ組（作品名に「Story」の添え）で、段は節の中の小節の
  h3（SectionHead の sub。/all の Profile の About と同じ段）。本文の無い作品は
  並べない（見出しだけ残さない）。1つも無ければ列ごと出さない。
*/
export const ItemStories = ({
  stories,
}: {
  stories: { key: number; title: string; paragraphs: string[] }[]
}) =>
  stories.length ? (
    <div class="stories">
      {stories.map((story) => (
        <div key={story.key}>
          <SectionHead title={story.title} note="Story" sub />
          <Note paragraphs={story.paragraphs} />
        </div>
      ))}
    </div>
  ) : null

/*
  個人ページの1枚目に置く名札。顔・名前・肩書きと所在地を、Team のカード
  （MemberCardWide）と同じ並びで出す——カードを押した先で、同じ顔と名前に着く。

  個人ページの柱はサイトの柱のまま。1人のサイトなら柱にも名前は出る
  （入口以外のどの画面でも。src/routes/public.tsx の SiteIdentity）が、
  顔が出るのはここだけ。heading は「名前がこの画面の見出しか」。
  大見出し（headline）を書いていない人では名前が h1 になる——書いている人では
  大見出しが h1 で、名前は添え。全体ページ（/all）の Profile の節でも使い、
  そこでは見出しは節の h2 なので、名前は添えのまま。
*/
export const Nameplate = ({ member, heading }: { member: Member; heading?: boolean }) => (
  <div class="nameplate">
    <Avatar src={member.avatarUrl} name={member.name} size={56} />
    <span class="nameplate__body">
      {heading ? (
        <h1 class="nameplate__name">{member.name}</h1>
      ) : (
        <strong class="nameplate__name">{member.name}</strong>
      )}
      {member.role || member.location ? (
        <span class="nameplate__meta">
          {[member.role, member.location].filter(Boolean).join(' · ')}
        </span>
      ) : null}
    </span>
  </div>
)

/*
  技術の塊（小見出しひとそろい）の列。個人ページの Skills の画面と、全体ページ
  （/all）の Profile の節の2か所で描く。

  小見出しは段落ではなく見出し。見た目は mono の小見出しとして組んであるのに
  要素が <p> だと、読み上げの見出し移動で塊に降りられない（この画面は個人ページで
  いちばん密度が高い）。要素の段は置かれる場所の階層で変わる——Skills の画面では
  節見出しが h1 なので h2、/all では Profile（h2）→ Skills（h3）の下なので h4。
  見た目はどちらも同じ .side-head。

  塊の途中では割らない（割る単位は塊。src/blocks.ts の MEMBER_PER_SCREEN.skills）。

  塊の中は、経験の添え（「3年以上」）ごとの行に並べる（src/lib/format.ts の
  skillRows）。添えは行の頭に1度だけ置く——項目ごとに付けていたころは、同じ
  「3年以上」が画面に11回並び、項目の名前より添えのほうが目に入っていた。

  添えのある行は <dl> の1組（dt が添え、dd がその行の項目の列）。読み上げで
  「3年以上」が項目の列に結び付くのは、この2つが dt / dd の組だから。見た目だけ
  横に並べた span と ul では、添えは直前の字として読まれて終わり、どの項目の
  添えなのかが耳からは分からない。行ごとに <div> で包むのは、1行を1つの
  flex の行にするため（dl の子に div を置くのは HTML の許す形）。

  添えの無い項目は最後の1行で、dl の外の素の ul。dt を持たない dd は置けず、
  無い添えを字で埋める（「その他」）と、書いた人が付けていない分類をこちらが
  足すことになる。
*/
const SkillList = ({ labels }: { labels: string[] }) => (
  <ul class="skill-list">
    {labels.map((label) => (
      <li key={label}>{label}</li>
    ))}
  </ul>
)

export const SkillGroups = ({ groups, level }: { groups: SkillGroup[]; level: 2 | 4 }) => (
  <div class="skills">
    {groups.map((group) => {
      const rows = skillRows(group.skills)
      const noted = rows.filter((row) => row.note !== '')
      const bare = rows.find((row) => row.note === '')
      return (
        <div class="skill-group" key={group.heading}>
          {group.heading ? (
            level === 2 ? (
              <h2 class="side-head" lang={langOf(group.heading)}>
                {group.heading}
              </h2>
            ) : (
              <h4 class="side-head" lang={langOf(group.heading)}>
                {group.heading}
              </h4>
            )
          ) : null}
          {noted.length ? (
            <dl class="skill-rows">
              {noted.map((row) => (
                <div class="skill-row" key={row.note}>
                  <dt class="skill-row__note">{row.note}</dt>
                  <dd>
                    <SkillList labels={row.labels} />
                  </dd>
                </div>
              ))}
            </dl>
          ) : null}
          {bare ? <SkillList labels={bare.labels} /> : null}
        </div>
      )
    })}
  </div>
)

// 2人のときは横長。4列のグリッドに2人だけ置くと、未完成の一覧に見える（1人なら Team そのものが無い）
/*
  Team のカード。押すと個人ページ（同じタブ、サイトの枠のまま）へ入る。
  矢印は → にする。↗ はこのサイトでは「外へ出る・別タブ」の印（リンク集・
  作品のリンク・サイトを見る ↗）で、同じサイトの中の続きには使わない。

  「プロフィール →」は操作の言葉なので日本語（CLAUDE.md「文言」）。英語で
  書くのは節の名前（目次・見出し・ページャの行き先の Profile / About …）だけ。
  「Profile →」と英語で書いていたころは、同じ画面の「一覧で見る →」
  「メールを送る →」と押す手の言葉だけが言語を変えていた（lang="en" を
  付けて読み上げを直していたが、印を要する英語そのものが要らなかった）。
*/
export const MemberCardWide = ({ member }: { member: Member }) => (
  <a class="member member--wide" href={`/members/${member.slug}`}>
    <Avatar src={member.avatarUrl} name={member.name} size={52} />
    <span class="member__body">
      <span class="member__line">
        <strong>{member.name}</strong>
        <span class="member__role">
          {member.role}
          {member.location ? ` · ${member.location}` : ''}
        </span>
      </span>
      {member.headline ? <span class="member__lead">{member.headline}</span> : null}
    </span>
    <span class="member__go">プロフィール →</span>
  </a>
)

export const MemberCardCompact = ({ member }: { member: Member }) => (
  <a class="member member--compact" href={`/members/${member.slug}`}>
    <Avatar src={member.avatarUrl} name={member.name} size={44} />
    <strong>{member.name}</strong>
    <span class="member__role">{member.role}</span>
    <span class="member__go">プロフィール →</span>
  </a>
)

/*
  一覧への帯。件数を添えて、めくる前に「ここに何件あるか」を見せる。

  使うのは2か所——トップの入口（Hero の画面）と、個人ページの1枚目。どちらも
  「作品そのものは別の URL にある」画面なので、そこに何があるかを数で示して
  から送り出す。行き先は呼ぶ側が決める（項目のある側へ送ること。0件の側へ
  送ると、0件の知らせだけの画面に着く）。

  置く先は Hero の中、リード文のすぐ下。画面の底に横いっぱいの帯として置いて
  いたころは、見出しと帯のあいだに画面の半分ほどの空白ができ、帯そのものも
  入力欄のように見えていた。大見出しから続けて読める位置に、押せる形で置く。

  題（label）は「何が入っているか」、右端は「どうするか（一覧で見る）」で、言葉を
  分ける。「つくったものの一覧」と書くと、1枚の札の中で「一覧」を2度言う。
  入口では、帯の行き先がページャの「次」と同じならページャのほうを出さない
  （src/routes/public.tsx の renderScreen。同じ行き先を2つ置かない）。
*/
export const Band = ({
  href,
  label,
  app,
  work,
}: {
  href: string
  label: string
  app: number
  work: number
}) => (
  <a class="band" href={href}>
    <span class="band__body">
      <strong>{label}</strong>
      {/* 0件の区分は数えない。呼ぶ側は、一覧を置いていないサイトでは帯ごと出さない */}
      <span class="band__meta">
        {[app ? `${KIND_LABEL.app} ${app}` : null, work ? `${KIND_LABEL.work} ${work}` : null]
          .filter((part) => part !== null)
          .join(' · ')}
      </span>
    </span>
    {/* 矢印は飾り。読み上げには「一覧で見る」だけを流す */}
    <span class="band__go">
      一覧で見る{' '}
      <span class="band__arrow" aria-hidden="true">
        →
      </span>
    </span>
  </a>
)

/*
  入口から全体ページ（/all）への控えめな1本。Hero の帯のすぐ下に置く
  （src/routes/public.tsx の case 'hero'。割られた入口にだけ出し、/all 自身には
  出さない——自分への行き先になる）。

  柱の足元の「全体を1ページで見る →」は 899 以下の帯で畳まれる（.rail__footer は
  帯に入らない）。電話で開いた人には全体ページへの道がどこにも無く、印刷・
  Ctrl-F・翻訳の宛先に辿り着けなかった。入口の本文に1本置けば、幅で消えない。

  控えめに置く。この画面の主役は名乗りと帯（一覧へ送る手）で、こちらは脇の道。
  丸い札にせず、柱の足元と同じ下線の文字リンクにする——札を2つ並べると、
  どちらが本筋か分からなくなる。字は --ink-mid（月の光暈の上に乗るので、
  小さい字の 4.5:1 が要る。npm run check:contrast が測っている）。

  矢印は飾りなので読み上げには流さない（帯の → と同じ）。サイトの中の続きなので
  ↗ ではなく →。
*/
export const WholeLink = () => (
  <a class="hero__whole" href="/all">
    すべてを1ページで読む <span aria-hidden="true">→</span>
  </a>
)

/*
  項目の区分。データでは app / work、画面では「個人開発 / 業務」。
  Projects の絞り込みのピルと、一覧への帯の件数で同じ言葉を使う。
*/
export type ItemKind = 'app' | 'work'
export const KIND_LABEL: Record<ItemKind, string> = { app: '個人開発', work: '業務' }
const KINDS: ItemKind[] = ['app', 'work']

/*
  いま効いている絞り込み。区分（個人開発 / 業務）とメンバーの2軸で、
  効いていない軸は null。
*/
export type ItemFilter = { kind: ItemKind | null; member: string | null }

/*
  絞り込みを URL の query にする。付けるのは効いている軸だけ。

  絞り込みは画面をまたいで効くので、ピルだけでなく、めくる先（ページャ）と
  目次の行き先にも同じものを付ける。付け忘れると、次の画面へ移った瞬間に
  絞り込みだけが静かに外れる。
*/
export const filterQuery = (filter: ItemFilter) => {
  const params = new URLSearchParams()
  if (filter.kind) params.set('kind', filter.kind)
  if (filter.member) params.set('member', filter.member)
  const query = params.toString()
  return query ? `?${query}` : ''
}

/*
  絞り込みのピル。

  ボタンではなくリンクで、押すと絞り込んだ一覧の1画面目へ移る。絞り込みを
  持っているのはサーバーで、公開ページは JavaScript を1バイトも持たない。

  行き先は必ずそのブロックの1画面目。3画面目で絞り込むと、絞ったあとの
  3画面目が無いことがある。

  2つの軸は独立に効く。いま効いているピルをもう一度押すと、その軸だけ外れる。
  「すべて」は両方外す。

  区分のピルは、公開中の項目が両方の区分にあるときだけ並べる（kinds は
  絞り込む前に実在する区分）。片方しか無いサイトで「業務」を置いても、押した
  先は0件の知らせだけになる。以前はプラットフォーム（macOS / iOS …）で絞って
  いたが、Apps と Works を1つにしたときに区分の軸へ替えた。プラットフォームは
  カードの札に残っている。
*/
export const FilterLinks = ({
  base,
  kinds,
  members,
  filter,
}: {
  base: string
  kinds: ItemKind[]
  members: { slug: string; name: string }[]
  filter: ItemFilter
}) => {
  const href = (next: ItemFilter) => `${base}${filterQuery(next)}`
  return (
    <nav class="filters" aria-label="一覧を絞り込む">
      <a
        href={href({ kind: null, member: null })}
        aria-current={!filter.kind && !filter.member ? 'true' : undefined}
      >
        すべて
      </a>
      {kinds.length > 1
        ? KINDS.filter((kind) => kinds.includes(kind)).map((kind) => {
            const on = filter.kind === kind
            return (
              <a
                key={kind}
                href={href({ kind: on ? null : kind, member: filter.member })}
                aria-current={on ? 'true' : undefined}
              >
                {KIND_LABEL[kind]}
              </a>
            )
          })
        : null}
      {/* 1人しか居ないサイトで名前のピルを1つ置いても、絞り込む先が無い */}
      {members.length > 1
        ? members.map((member) => {
            const on = filter.member === member.slug
            return (
              <a
                key={member.slug}
                href={href({ kind: filter.kind, member: on ? null : member.slug })}
                aria-current={on ? 'true' : undefined}
              >
                {member.name}
              </a>
            )
          })
        : null}
    </nav>
  )
}

export const Empty = ({ children }: { children: Child }) => <p class="empty">{children}</p>

/*
  画面と画面を行き来する帯。main の2行目（本文の下）に置く。

  数えるのは**節の中**（Projects 2 / 4）。全体の通し番号にしない理由は
  src/lib/sequence.ts の Sequence.pager に書いてある。

  節をまたぐ手は、行き先を名乗る（「Team →」）。兼ねていたころは
  /apps/3 で「次」を押すと予告なく Works に出ていた。名乗らせるだけで
  驚きが消え、押す前に決められる。

  数はサーバーが数えて渡す。CSS の counter で数えると、印刷にも読み上げにも
  数が出ず、「いま何枚目か」だけが落ちる。

  端（最初と最後）ではリンクそのものを出さない。押しても何も起きない
  リンクを置くと、キーボードで送る手が1回空振りする。ますだけは残すので、
  めくっても真ん中の数字が左右に動かない。

  unit は数える単位で、読み上げにだけ出る（目に見えるのは「3 / 7」だけ）。
  ふつうは「画面」。作品1件のページ同士をめくるときは作品1件（1枚目と本文の
  画面 Story の2枚でも1件）を数えるので「件」——「Projects の 7 画面のうち
  3 画面目」と読むと、一覧の画面の数と取り違える（一覧は同じ7件を4画面に
  割っている）。
*/
export const ScreenPager = ({
  prev,
  prevSection,
  next,
  nextSection,
  section,
  index,
  total,
  unit = '画面',
}: {
  prev: string | null
  prevSection: string | null
  next: string | null
  nextSection: string | null
  section: string | null
  index: number
  total: number
  unit?: '画面' | '件'
}) => {
  /*
    読み上げに渡す言い方。節の名前があるときは「Projects の 4 画面のうち 2 画面目」、
    無いとき（Hero・ひとこと）は画面が1枚しかないので位置を言わない。
  */
  const spoken = section
    ? total > 1
      ? `${section} の ${total} ${unit}のうち ${index} ${unit}目`
      : section
    : null

  return (
    <nav class="pager" aria-label="画面の移動">
      {prev ? (
        <a class="pager__go" href={prev} rel="prev">
          {prevSection ? `← ${prevSection}` : '← 前'}
        </a>
      ) : (
        <span class="pager__end" />
      )}
      {/*
        名前を持たない節（Hero・ひとこと）では言うことが無い。それでも枠は
        残す——3つの枡で組んであるので、落とすと左右の手が真ん中へ寄り、
        めくるたびにボタンの位置が動く。
      */}
      {spoken ? (
        <span class="pager__count">
          <span class="sr-only">{spoken}</span>
          <span aria-hidden="true">
            <span class="pager__section">{section}</span>
            {total > 1 ? (
              <span class="pager__of">
                {index} / {total}
              </span>
            ) : null}
          </span>
        </span>
      ) : (
        <span class="pager__count" />
      )}
      {next ? (
        <a class="pager__go pager__go--next" href={next} rel="next">
          {nextSection ? `${nextSection} →` : '次 →'}
        </a>
      ) : (
        <span class="pager__end" />
      )}
    </nav>
  )
}

/*
  一覧へ戻る道。作品1件のページの2つの画面（1枚目と本文の画面 Story）の頭に
  1本ずつ置く（src/routes/public.tsx の renderItem）。行き先はどちらも同じ一覧の画面。

  作品のページから戻る道は、目次の「Projects」しか無かった。目次は一覧の
  1画面目へ行くので、4画面目のカードから入った人は、戻ると最初からめくり
  直すことになる。行き先は呼ぶ側が「その作品が載っている画面」を数えて渡す
  （一覧の並びの中の位置を perScreen で割る）。

  ページャとは役目が違うので、ページャに入れない。ページャは作品同士を
  横にめくる手（← 前 / 次 →）で、こちらは一覧という1つ上の階層へ上がる手。
  置き場所も分ける——ページャは画面の底、こちらは見出しの上。

  見た目はページャの手（.pager__go）と同じ丸い札で、当たり判定も同じ --tap
  （pointer: coarse では 44px）。矢印は飾りなので読み上げには流さない
  （帯の → と同じ）。
*/
export const BackLink = ({ href, label }: { href: string; label: string }) => (
  <a class="back" href={href}>
    <span aria-hidden="true">←</span>
    {label}
  </a>
)

export const StatusPill = ({ published }: { published: number }) =>
  published ? (
    <span class="status status--published">公開</span>
  ) : (
    <span class="status status--draft">下書き</span>
  )

/* ------------------------------------------------ トップに置くブロックの中身 */

/*
  ブロック（src/blocks.ts）の「打ち込むもの」を描く部品。
  どれも1行1件の body を parseLines で開いた列を受け取る。列が足りない行は
  足りないまま出す（空欄で落とさない）。書いた人が一覧で気づけるように。
*/

// 一文だけの画面。その一文がその画面の見出しなので、割られた画面では h1
export const Statement = ({ text, notes, h1 }: { text: string; notes: string[]; h1?: boolean }) => (
  <div class="statement">
    {h1 ? <h1 class="statement__text">{text}</h1> : <p class="statement__text">{text}</p>}
    {notes.map((note) => (
      <p class="statement__note" key={note}>
        {note}
      </p>
    ))}
  </div>
)

export const NowList = ({ rows }: { rows: string[][] }) => (
  <ul class="now">
    {rows.map(([what, note]) => (
      <li key={what}>
        <span>{what}</span>
        {note ? <span class="exp">{note}</span> : null}
      </li>
    ))}
  </ul>
)

export const Numbers = ({ rows }: { rows: string[][] }) => (
  <ul class="numbers">
    {rows.map(([value, unit, note]) => (
      <li class="numbers__item" key={`${value}${unit}`}>
        <span class="metric">
          <span class="metric__value">{value}</span>
          {unit ? <span class="metric__unit">{unit}</span> : null}
        </span>
        {note ? <span class="numbers__note">{note}</span> : null}
      </li>
    ))}
  </ul>
)

/*
  行き先を並べる列。トップのリンク集で使う。URL の形はこの部品でも見る
  （isSafeUrl。通らない行は描かない）。呼ぶ側（blockLines）も同じ検査で
  落としていて、画面の数はそちらの行数で決まる——ここで落とすのは、呼ぶ側が
  掛け忘れたときの最後の受け。作品1件のページの行き先は、カードと同じ1行の
  LinkRow に移した（1画面に説明と画像を入れる高さのため。ItemDetail を見ること）。

  矢印は行き先で変える。↗ はこのサイトでは「外へ出る・別タブで開く」の印
  （カードの .links、管理画面の「サイトを見る ↗」）で、サイトの中の続き——
  / で始まる URL——には → を付ける（Team のカードの「プロフィール →」、帯の
  「一覧で見る →」、LinkRow の「担当」と同じ）。
  中の行き先にも ↗ を付けていたころは、同じタブで開くのに「外へ出る」と
  言っていた。別タブで開くか（target）と rel も同じ1つの条件で決める。
*/
export const LinkList = ({ rows }: { rows: string[][] }) => (
  <ul class="linklist">
    {rows.map(([label, url, note]) => {
      if (!isSafeUrl(url)) return null
      const inside = url.startsWith('/')
      return (
        <li key={url}>
          <a
            href={url}
            rel={inside ? undefined : 'noreferrer'}
            target={inside ? undefined : '_blank'}
          >
            <span class="linklist__label">{label}</span>
            {note ? <span class="linklist__note">{note}</span> : null}
            <span class="linklist__go">{inside ? '→' : '↗'}</span>
          </a>
        </li>
      )
    })}
  </ul>
)

// 年月・何を・補足。個人ページの経歴もこれで描く
export const Timeline = ({ rows }: { rows: string[][] }) => (
  <ul class="career">
    {rows.map(([period, title, org]) => (
      <li key={`${period}${title}`}>
        <span class="period">{period}</span>
        <span class="title">{title}</span>
        {org ? <span class="org">{org}</span> : null}
      </li>
    ))}
  </ul>
)

/*
  文章の列。段落のあとに、同じ列へ続けたいもの（個人ページのスキル）を
  children で受ける。受けないと、呼ぶ側が同じ列をもう1枚作ることになる
*/
export const Note = ({ paragraphs, children }: { paragraphs: string[]; children?: Child }) => (
  <div class="bio">
    {paragraphs.map((text) => (
      <p key={text}>{text}</p>
    ))}
    {children}
  </div>
)

/*
  全体ページ（/all）に置く、1人のサイトのプロフィールの節の中身。

  1人のサイトでは Team の画面を作らず、その人の画面（1枚目・About・Skills・
  Career）がサイトの連なりに入る（src/routes/public.tsx の profileOf）。/all は
  その連なりを1つの文書に積んだものなので、Team のカード1枚ではなく、
  プロフィールそのものを1つの節として置く。見出しの段は
  Hero の h1 → Profile の h2（節の SectionHead）→ About / Skills / Career の h3
  （SectionHead の sub）→ 技術の小見出しの h4（SkillGroups の level）。

  新しい見た目はほとんど持たない——名札（Nameplate）、大見出しは大きな一文
  （Statement）、紹介（Note）、技術（SkillGroups）、経歴（Timeline）。どれも割られた
  画面と同じ部品。足したのは小節を縦に並べる .profile の間隔と、h3 の段だけ。

  中身の無い小節は出さない（見出しだけ残さない）。割られた画面の About は空でも
  「準備中です」を出すが、あれは URL を間違えたのかを見分けるためで、1つの
  文書の中では要らない。children はその人だけの連絡先（サイトと違う行き先を
  持つ人のぶん。呼ぶ側が決める）。
*/
export const ProfileWhole = ({
  member,
  bio,
  skills,
  career,
  children,
}: {
  member: Member
  bio: string[]
  skills: SkillGroup[]
  career: string[][]
  children?: Child
}) => (
  <div class="profile">
    <Nameplate member={member} />
    {member.headline ? <Statement text={member.headline} notes={[]} /> : null}
    {children}
    {bio.length ? (
      <div>
        <SectionHead title="About" sub />
        <Note paragraphs={bio} />
      </div>
    ) : null}
    {skills.length ? (
      <div>
        <SectionHead title="Skills" sub />
        <SkillGroups groups={skills} level={4} />
      </div>
    ) : null}
    {career.length ? (
      <div>
        <SectionHead title="Career" sub />
        <Timeline rows={career} />
      </div>
    ) : null}
  </div>
)
