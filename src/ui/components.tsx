import { raw } from 'hono/html'
import type { Child } from 'hono/jsx'
import adminCss from '../../public/admin.css'
import appCss from '../../public/app.css'
import type { Item, Member } from '../db/schema'
import {
  ITEM_KIND_KEYS,
  type ItemFilter,
  type ItemKind,
  type ItemView,
  KIND_LABEL,
  KIND_PATH,
  type KindCounts,
  totalOf,
} from '../domain'
import { initials, isHttpsUrl, isSafeUrl, type SkillGroup, skillRows } from '../lib/format'
import {
  bodyItems,
  CONTACT_FRAME,
  HERO_FRAME,
  type LabelSide,
  labelRoom,
  type OrbitBody,
  type OrbitFrame,
  type OrbitMap,
  orbitMap,
  placeLabels,
} from '../lib/orbits'
import { SITE } from '../site'
import { GithubIcon, HoleCore, HoleLight, HoleSpot, MailIcon, PencilIcon, Wordmark } from './icons'
import { HOLE, MARK_HALF, MARK_VIEWBOX } from './logo'

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
  既定（max-age=0, must-revalidate）のままだったころは、ページを移るたびに
  描画を止めて CSS を条件付き GET で取り直していた（ページの移動は普通の
  フルページ遷移なので、1ページごとに1往復）。

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

const STYLESHEETS = {
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
  このページの配色（黒基調の1つ。OS がライトでも切り替えない）。app.css の :root の
  color-scheme と同じ値で、CSS より先に読まれるので、CSS が届くまでの一瞬の地も
  暗い側で出る（白い地が一瞬光らない）。公開・管理・404 の外枠がどれもこれを置く。
*/
export const ColorSchemeMeta = () => <meta name="color-scheme" content="dark" />

/*
  favicon。ロゴの印（ブラックホールの O を1つで）を地の色の正方形に載せたもの
  （src/ui/logo.ts の iconSvg）を SVG のまま読ませ、読めない環境には同じ絵の PNG を渡す
  （どちらも scripts/logo/export.mjs が書き出す）。地を敷くのは、光が白いから——透明の
  ままだと明るいタブの帯では輪も横線も消え、黒い点だけになる。公開・管理・404 の
  外枠がどれも置く。
*/
export const FaviconLinks = () => (
  <>
    <link rel="icon" type="image/svg+xml" href="/assets/favicon.svg" />
    <link rel="icon" type="image/png" sizes="32x32" href="/assets/favicon-32.png" />
    <link rel="apple-touch-icon" href="/assets/apple-touch-icon.png" />
  </>
)

/*
  上の帯の左端のロゴ（ワードマーク ΛSTLOG。O がブラックホール）。押すと入口へ。
  大きさは1つだけ（app.css の --brand-h）。

  絵は aria-hidden で、リンクの名前は .sr-only の字（サイトの名前）が持つ（WCAG 4.1.2。
  絵だけのリンクは名前を持たない）。
*/
export const Brand = () => (
  <a class="brand" href="/">
    <Wordmark class="brand__word" />
    <span class="sr-only">{SITE.name}</span>
  </a>
)

/*
  公開ページから管理画面への入口。ログインしている人にだけ上の帯に出る
  （出すかどうかと行き先は src/routes/public/page.tsx の adminHref が決める）。
  行き先は「いま見ているページを直す場所」——/projects なら項目の一覧、
  作品1件のページならその作品の編集。

  同じタブで開く。管理画面の側には「サイトを見る ↗」が別タブで付いているので、
  行き来の片方は同じタブ、片方は別タブになる。こちらまで別タブにすると、
  直して見に来るたびにタブが1枚ずつ増えていく。
*/
export const AdminLink = ({ href }: { href: string }) => (
  <a class="top__admin" href={href}>
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

  h1 は「この節が1つのページ（= 1つのドキュメント）になっている」とき。
  ページごとに URL を分けた以上、見出しはそのページの中で完結していなければ
  ならない——h2 から始まるドキュメントでは、読み上げの見出し移動で骨格を
  掴めず、検索から直接着いた人も「ここは何のページか」を見出しから取れない。
  縦に積んだ全体ページ（/all）だけは1つのドキュメントに節が並ぶので、
  そちらは h2（h1 は Hero が1つ持つ）。

  出し分けの元は renderBlock が受け取る whole（全体ページの節として描くか）で、
  ここでは数えない。

  note（添え）は見出しに無い情報のときだけ渡す——作品のページの「業界 · 年」、
  全体ページの作品の本文の「Story」、区分の絞り込みが並ばない Projects の区分名。
  見出しの訳語（About の「紹介」、Team の「メンバー」…）は渡さない。同じ見出しを
  2つの言語で2度言うだけになる（CLAUDE.md「文言」）。

  count は見出しのすぐ後ろに添える件数（Projects の「07」。いま並んでいる行の数）。
  2桁にそろえた数字で、読み上げには「7 件」と数える言葉を添える。

  sub は「ページの中の小節」で、その段（2 か 3）の見出しを小さい組（.head--sub）で
  出す。作品のページの本文の小節「Story」（h1 の作品名の下の h2。ItemStory）と、
  全体ページの Profile の節の中の About / Skills / Career と作品の本文（Profile・
  Projects の h2 の下の h3）。

  chapter は個人ページの About / Skills / Career（.head--chapter）。ページの中の
  章で、main の子の section の h2。節の見出しと同じ線で章の切れ目を見せるが、字は
  頭の大見出し（h1。--fs-display）より小さい --fs-display-sm に下げる（同じ大きさ
  だと、章が h1 と同じ格に見える）。章の上は1段空ける（前の章の本文と地続きに見せない）。
*/
export const SectionHead = ({
  title,
  note,
  count,
  h1,
  sub,
  chapter,
  transition,
}: {
  title: string
  note?: string
  count?: number
  h1?: boolean
  sub?: 2 | 3
  chapter?: boolean
  // ページを移るときにつなぐ名前（作品のページの h1。itemTransition）
  transition?: string
}) => (
  <div class={sub ? 'head head--sub' : chapter ? 'head head--chapter' : 'head'}>
    {h1 ? <h1 style={transition}>{title}</h1> : sub === 3 ? <h3>{title}</h3> : <h2>{title}</h2>}
    {count === undefined ? null : (
      <span class="head__count">
        {twoDigits(count)}
        <span class="sr-only"> 件</span>
      </span>
    )}
    {note ? <span class="note">{note}</span> : null}
  </div>
)

/*
  読み上げのためだけに置く見出し（.sr-only）。目に見える見出しを持たないページが
  使う——締めの Contact（ボタンの言葉が見出しの代わり）と、見出しを空けた
  メモ（段落がページの全部）。

  ページは h1 をちょうど1つ持つ決まり（CLAUDE.md「1ページ = 1ドキュメント」、
  WCAG 1.3.1）。見出しの無いページは、見出しで移動する人にとって「何も無い」
  ページになる。全体ページ（/all）では節の見出しの段（h2）。

  目に見える見出しを置かない理由は呼ぶ側にある（Contact・メモの注記）。ここは
  見出しの段と見えなさだけを持つ。
*/
export const HiddenHeading = ({ text, h1 }: { text: string; h1?: boolean }) =>
  h1 ? <h1 class="sr-only">{text}</h1> : <h2 class="sr-only">{text}</h2>

/*
  節1つぶんの箱。main の直接の子になるものは、ここか Hero が作る。

  tabindex は付けない。ページそのものが縦にスクロールするので、節は
  スクロール箱ではなく、キーボードではページごと動かせる（以前は節そのものが
  溢れの弁で、WebKit では弁にフォーカスできないために tabindex="0" を付けていた）。
  「本文へスキップ」の行き先は main（Layout.tsx の tabindex="-1"）。

  label を渡すと、その名前の付いた region として読み上げに出る。名前の無い
  region は読み上げに現れないので、見出しを持たない箱（ひとこと・帯）には
  付けない。渡す文字列は見出しと同じ変数から取ること。

  orbital は「軌道図を置く締めの節」（Contact。ContactOrbits）。見出しの錨（節は
  上揃え）を持たない表紙で、図を上の帯の罫線に寄せ、字は残りの高さの真ん中
  （900 以上は表紙の底）に置く（app.css の「締めの軌道図」と .contact。表紙の高さは
  「ページの外枠」の main > .orbital）。
*/
export const Screen = ({
  id,
  label,
  orbital,
  children,
}: {
  id?: string
  label?: string
  orbital?: boolean
  children: Child
}) => (
  <section
    id={id}
    class={orbital ? 'orbital' : undefined}
    role={label ? 'region' : undefined}
    aria-label={label}
  >
    {children}
  </section>
)

/*
  入口のページ（と、個人ページの頭の名札、全体ページの頭）。<header class="hero">。

  profile は個人ページの頭（名札・大見出し）。すぐ下に About・Skills・Career の
  本文が続く読み物の頭で、本文の列と同じ左の軸に立てる。

  orbit は入口の表紙（.hero--orbit）。左に大見出しの列、右に作品の軌道図
  （OrbitSystem）、底に件数の帯（Tally）を区画に並べる（app.css の「入口」）。
*/
export const Hero = ({
  profile,
  orbit,
  children,
}: {
  profile?: boolean
  orbit?: boolean
  children: Child
}) => (
  <header class={profile ? 'hero hero--profile' : orbit ? 'hero hero--orbit' : 'hero'}>
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
  締めの誘いの1文。どれもどのブラウザでも同じ所で折れてほしい場所（大見出しと
  締めの1文は塊を1行ずつに積む。軌道図のまわりの字の位置は npm run check:contrast
  が測る）。

  打ち込む中身（節の見出し・一覧の行の説明・段落）には使わない。長い段落を
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
  天体（作品1つ）の点。長さ0の線に丸い線端を付けて点にする——線の太さは
  vector-effect: non-scaling-stroke（app.css の .orbit-body）で画面の px のまま
  保たれるので、軌道図がどの大きさに縮んでも点の大きさが変わらない（circle の r は
  viewBox と一緒に縮み、電話では 2px ほどまで潰れた）。

  業務の天体は輪。同じ点を2回描き、2回目を地の色で小さく抜く。
*/
const Bodies = ({ bodies }: { bodies: OrbitBody[] }) => (
  <>
    {bodies.map((body) => (
      <g key={`${body.x},${body.y}`} class={`orbit-body orbit-body--${body.kind}`}>
        <path d={`M${body.x} ${body.y}h0`} />
        {body.kind === 'work' ? (
          <path class="orbit-body__hole" d={`M${body.x} ${body.y}h0`} />
        ) : null}
      </g>
    ))}
  </>
)

/*
  軌道の線（入口と締め）。奥の半分（side = far。ブラックホールの後ろの層）か手前の半分
  （near。前の層）を描く。

  - 濃さは奥から手前へ続けて変わる坂（orbits.ts の OrbitMap の depth）。奥の半分と手前の
    半分が同じ坂を読むので、継ぎ目で濃さが跳ばない（半分ずつの濃さを変えていたころは、
    楕円の左右の端で線が急に濃くなった）。坂の色と濃さは app.css の .orbit-depth__*。
    グラデーションは層ごとに id を分けて持つ（id は置く部品が渡す）
  - 手前の半分の下には地の色の縁取り（.orbit__casing）を敷く。ブラックホールの光の縁の
    前を通る所で白い線が白い光に溶けず、前を横切るのが見える。縁取りを先に全部描いてから
    線を描く（隣の軌道の縁取りが線を削らない）
*/
const OrbitLines = ({ map, side, id }: { map: OrbitMap; side: 'far' | 'near'; id: string }) => (
  <>
    <defs>
      <linearGradient
        id={id}
        gradientUnits="userSpaceOnUse"
        x1={map.depth.x1}
        y1={map.depth.y1}
        x2={map.depth.x2}
        y2={map.depth.y2}
      >
        <stop class="orbit-depth__far" offset="0" />
        <stop class="orbit-depth__near" offset="1" />
      </linearGradient>
    </defs>
    {side === 'near'
      ? map.orbits.map((orbit) => (
          <path key={`casing-${orbit.near}`} class="orbit__casing" d={orbit.near} />
        ))
      : null}
    {map.orbits.map((orbit) => (
      <path
        key={orbit[side]}
        class={`orbit orbit--${orbit.kind}`}
        d={orbit[side]}
        stroke={`url(#${id})`}
      />
    ))}
  </>
)

/*
  動き続けるもの（入口と締め）のうち、軌道に沿うもの。軌道を流れる光（orbit-flow）と、
  公転する天体（orbit-mover）。どちらも同じものを奥の層と手前の層に1つずつ置き、それぞれを
  軌道面の奥と手前の半面で切る（orbits.ts の OrbitMap の halves）——ブラックホールの向こうを
  回るあいだは後ろに、こちらへ来るあいだは前に見える。動かし方は app.css の「動き続ける」。
  動きを減らす設定では隠し、止まった天体（Bodies）と札だけが残る。

  天体は、動かない親（orbits.ts の OrbitMover の at。SVG の transform 属性）が単位円を
  軌道へ写し、動く子は単位円を1周回るだけ——keyframes に天体ごとの数を持たせない
  （app.css の「動き続ける」の、var() を keyframes に書かない話）
*/
const Motion = ({ map, side, id }: { map: OrbitMap; side: 'far' | 'near'; id: string }) => {
  const clip = `url(#${id})`
  return (
    <>
      <defs>
        <clipPath id={id} clipPathUnits="userSpaceOnUse">
          <path d={map.halves[side]} />
        </clipPath>
      </defs>
      <g class="orbit-flows" clip-path={clip}>
        {map.orbits.map((orbit, i) => (
          <path
            key={orbit.d}
            class="orbit-flow"
            d={orbit.d}
            pathLength="100"
            style={`--dur:${map.flows[i]}s;--delay:-${Math.round((map.flows[i] ?? 0) * ((i * 0.618) % 1) * 10) / 10}s`}
          />
        ))}
      </g>
      <g class="orbit-movers" clip-path={clip}>
        {map.movers.map((mover, i) => (
          <g key={i} transform={mover.at}>
            <g
              class={`orbit-mover orbit-body orbit-body--${mover.kind}`}
              style={`--period:${mover.period}s`}
            >
              <path d="M1 0h0" />
              {mover.kind === 'work' ? <path class="orbit-body__hole" d="M1 0h0" /> : null}
            </g>
          </g>
        ))}
      </g>
    </>
  )
}

/*
  ブラックホールへ吸い込まれる光の粒（入口と締め。orbits.ts の OrbitDust）。軌道面
  （plane）の上で、粒ごとの向き（a）に回した所から1周渦を巻いて落ちる。

  動くのは粒ごとに2つ——回る子（orbit-grain。1周）と、その中で外から内へ寄る点
  （orbit-grain__dot。明るさの出入りも）。落ちる幅は動かない親の transform（r1 へ寄せて
  r0 − r1 倍に伸ばす）が持ち、点は keyframes の中で 1 から 0 へ動くだけ。

  奥と手前に分けず、ブラックホールの後ろの層にだけ置く——黒い円の上を横切る粒は、ロゴと
  同じ円を汚す。光の縁に掛かる所で、粒は光に溶けて見えなくなる
*/
const Dust = ({ map }: { map: OrbitMap }) => (
  <g class="orbit-dust" transform={map.plane}>
    {map.dust.map((grain, i) => (
      <g key={i} transform={`rotate(${grain.a})`}>
        <g class="orbit-grain" style={`--dur:${grain.dur}s;--delay:${grain.delay}s`}>
          <g
            transform={`translate(${grain.r1} 0) scale(${Math.round((grain.r0 - grain.r1) * 10) / 10})`}
            opacity={grain.o}
          >
            <path class="orbit-grain__dot" d="M0 0h0" style={`stroke-width:${grain.w}px`} />
          </g>
        </g>
      </g>
    ))}
  </g>
)

// 2桁にそろえた番号（01・02 …）。入口の軌道図の札と件数の帯で同じ書き方
const twoDigits = (value: number) => String(value).padStart(2, '0')

/*
  ブラックホール（入口と締め）。ロゴの O と同じ絵——黒い円（影）、縁でくっきり光って外へ
  消える輪、その後ろを通る横線（真横から見た円盤）——を、軌道図の焦点に大きく置く（形は
  src/ui/logo.ts、描き方は icons.tsx の HoleLight / HoleCore）。ロゴと同じ1つのものに
  見せるため、比も色（字の白と --hole-core）も変えない。横線は軌道面の傾きに合わせて回す
  （app.css の .hole の --system-tilt。輪と円は回しても同じ）。

  大きさは枠の hole（黒い円の半径）から、置き場所は枠の focus から組んで style で渡す
  （CSS に写すと、枠を変えた日に片方だけ古くなる）。

  3枚の SVG を重ねる: 光（横線と輪。明るさがゆっくり揺らぐ）→ 縁を回る光の点（HoleSpot。
  回り続ける）→ 黒い円。動くのは SVG ごとの明るさと回転だけで、中を描き直さない。
  id はグラデーションの名前の頭（入口と締めは別のページだが、ロゴの wm / mk とは分ける）。
  飾りなので読み上げには出さない。
*/
const Hole = ({ frame, id }: { frame: OrbitFrame; id: string }) => {
  const pct = (value: number) => `${Math.round(value * 10000) / 100}%`
  // 印の枠（±MARK_HALF）が黒い円の半径（HOLE.core）の何倍か
  const width = (2 * MARK_HALF * frame.hole) / HOLE.core
  return (
    <span
      class="hole"
      aria-hidden="true"
      style={`--hole-x:${pct(frame.focus.x / frame.width)};--hole-y:${pct(frame.focus.y / frame.height)};--hole-w:${pct(width / frame.width)}`}
    >
      <svg class="hole__light" viewBox={MARK_VIEWBOX} aria-hidden="true" focusable="false">
        <HoleLight cx={0} cy={0} id={id} />
      </svg>
      <svg class="hole__spin" viewBox={MARK_VIEWBOX} aria-hidden="true" focusable="false">
        <HoleSpot id={id} />
      </svg>
      <svg class="hole__core" viewBox={MARK_VIEWBOX} aria-hidden="true" focusable="false">
        <HoleCore cx={0} cy={0} />
      </svg>
    </span>
  )
}

/*
  入口の軌道図の札に載せる作品。number は一覧（Projects）の並びでの番号（1 から）で、
  札と一覧の行が同じ番号で結ばれる。
*/
export type OrbitItem = { type: ItemKind; title: string; href: string | null; number: number }

/*
  入口の軌道図。真ん中にブラックホールを置き、公開中の作品を1つずつ楕円の軌道に
  載せる（形は src/lib/orbits.ts の orbitMap。件数だけから決まる）。

  - 軌道はブラックホールの円盤と同じ面にあり、奥の半分はブラックホールの後ろ、手前の
    半分は前を通る（奥と手前で SVG を分け、そのあいだに Hole を挟む）。どの軌道も同じ形の
    入れ子で交わらず、線は奥ほど薄い（OrbitLines）
  - 天体に作品の番号の札を添える（作品のページへのリンク）。名前は札の中にあり、
    マウスを重ねたときとキーボードで選んだときに見える（app.css の .system__name。
    読み上げとリンクの名前にはいつも入る）。札を出すのは枠が十分に広いときだけ
    （app.css の @container。orbits.ts の LABEL_MIN_WIDTH）で、狭い枠では点だけに
    なる——作品の名前はすぐ下の「一覧で見る →」の先に全部ある
  - 札の置き場所は、重ならない向きを orbits.ts の placeLabels が選ぶ
  - 個人開発は塗りの点、業務は輪と破線の軌道（区分の呼び名は KIND_LABEL）
  - 天体はブラックホールのまわりの矩形（HERO_FRAME の clear）の外にだけ置く
  - 線と点の色は app.css が --accent と --ink から敷く（見た目のプリセットで変わる）。
    ブラックホールだけはロゴの O と同じ色（字の白と --hole-core）
  - 軌道・天体・ブラックホールは aria-hidden。札（リンク）だけが読み上げに出る
  - 着いたときに一度だけ、ブラックホールが灯り、軌道と天体が渦を巻いて収まる
    （app.css の「入口に着いたとき」）。そのあとも動き続ける——天体がゆっくり公転し、軌道を
    光が流れ、光の粒が渦を巻いて吸い込まれ、ブラックホールの縁を光の点が回り、光が揺らぐ
    （Motion・Dust・Hole。動いているあいだは札を隠し、札を選ぶかマウスを重ねると止まった
    天体と札に戻る）。止まった姿がそのまま完成形

  呼ぶのは renderBlock の case 'hero' だけで、全体ページ（/all）には置かない
  （印刷・Ctrl-F・翻訳の宛先）。
*/
export const OrbitSystem = ({ counts, items }: { counts: KindCounts; items: OrbitItem[] }) => {
  const map = orbitMap(counts, HERO_FRAME)
  const onBody = bodyItems(map.bodies, items)
  const sides = placeLabels(HERO_FRAME, map.bodies)
  // 札は番号の順に並べる（位置は style で決まるので、並びは読み上げと Tab の順だけ）
  const labels = map.bodies
    .map((body, i) => ({ body, item: onBody[i], side: sides[i] }))
    .filter((label): label is { body: OrbitBody; item: OrbitItem; side: LabelSide } =>
      Boolean(label.item && label.side),
    )
    .sort((a, b) => a.item.number - b.item.number)
  const at = (value: number, whole: number) => `${Math.round((value / whole) * 10000) / 100}%`
  const view = `0 0 ${map.width} ${map.height}`
  return (
    <div class="system">
      <svg
        class="system__orbits system__orbits--far"
        viewBox={view}
        aria-hidden="true"
        focusable="false"
      >
        <OrbitLines map={map} side="far" id="system-far-depth" />
        <Motion map={map} side="far" id="system-far" />
        <Dust map={map} />
      </svg>
      <Hole frame={HERO_FRAME} id="system-hole" />
      <svg
        class="system__orbits system__orbits--near"
        viewBox={view}
        aria-hidden="true"
        focusable="false"
      >
        <OrbitLines map={map} side="near" id="system-near-depth" />
        <Motion map={map} side="near" id="system-near" />
      </svg>
      <svg class="system__bodies" viewBox={view} aria-hidden="true" focusable="false">
        <Bodies bodies={map.bodies} />
      </svg>
      {labels.length ? (
        <ol class="system__labels" aria-label="つくったもの">
          {labels.map(({ body, item, side }, order) => {
            const text = (
              <>
                <span class="system__number">{twoDigits(item.number)}</span>
                <span class="system__name" lang={langOf(item.title)}>
                  {item.title}
                </span>
              </>
            )
            return (
              <li
                key={item.number}
                class={`system__label system__label--${side}`}
                style={`--x:${at(body.x, map.width)};--y:${at(body.y, map.height)};--room:${labelRoom(HERO_FRAME, body, side)}cqi;--i:${order}`}
              >
                {item.href ? <a href={item.href}>{text}</a> : <span>{text}</span>}
              </li>
            )
          })}
        </ol>
      ) : null}
    </div>
  )
}

/*
  入口の件数の帯（軌道図の下、表紙の底）。作品の数と、区分ごとの数（両方の区分に
  作品があるときだけ。区分の絞り込みと同じ決まり）と、いちばん古い作品の年。

  数は2桁にそろえる（07）。着いたときに 00 から数え上がる（app.css の .tally__num。
  止まった姿は字のまま——数え上げは ::after の counter() が上に重なるだけで、
  字そのものはページにあり、読み上げも Ctrl-F もこちらを読む）。

  見出しと値の組なので <dl>。見た目は値が上・見出しが下（app.css が並べ替える）。
*/
export const Tally = ({ counts, since }: { counts: KindCounts; since: number | null }) => {
  const kinds = ITEM_KIND_KEYS.filter((kind) => counts[kind] > 0)
  const cells = [
    { label: 'Projects', value: totalOf(counts) },
    ...(kinds.length > 1
      ? kinds.map((kind) => ({ label: KIND_LABEL[kind], value: counts[kind] }))
      : []),
  ]
  return (
    <dl class="tally">
      {cells.map((cell, order) => (
        <div class="tally__cell" key={cell.label} style={`--i:${order}`}>
          <dt lang={langOf(cell.label)}>{cell.label}</dt>
          <dd class="tally__num" style={`--to:${cell.value}`}>
            {twoDigits(cell.value)}
          </dd>
        </div>
      ))}
      {since ? (
        <div class="tally__cell" style={`--i:${cells.length}`}>
          <dt lang="en">Since</dt>
          <dd class="tally__year">{since}</dd>
        </div>
      ) : null}
    </dl>
  )
}

/*
  見出しの上に添える小さな札（入口の「職種 — 所在地」、全体ページの頭の職種）。
  部分ごとに、英字だけなら等幅の小さな大文字（lang="en"。langOf）、和文を含めば
  本文の書体のまま——「System Engineer」と「神奈川」を並べても、それぞれの字で組む。
  部分のあいだの「—」は CSS が置く（app.css の .eyebrow。読み上げには流さない）。
*/
export const Eyebrow = ({ parts }: { parts: string[] }) => (
  <p class="eyebrow">
    {parts.map((part) => (
      <span key={part} lang={langOf(part)}>
        {part}
      </span>
    ))}
  </p>
)

/*
  塗りの押し手（入口の「一覧で見る →」）。ページでいちばん強い1本にだけ使う。
  矢印は飾りなので読み上げには流さない。サイトの中の続きなので ↗ ではなく →。
*/
export const Cta = ({ href, children }: { href: string; children: Child }) => (
  <a class="cta" href={href}>
    {children}
    <span class="cta__arrow" aria-hidden="true">
      →
    </span>
  </a>
)

/*
  締めの軌道図。入口と同じ件数の星系（同じブラックホール）を、横長の帯の真ん中に置く
  （枠は orbits.ts の CONTACT_FRAME）。番号の札は持たない——作品へは目次と入口から行く。

  入口と同じく、軌道の奥の半分はブラックホールの後ろ、手前の半分は前に描き、止まった天体
  （.orbit-rest）はいちばん上。動き続けるものも入口と同じ（Motion・Dust・Hole。動いている
  あいだは止まった天体を隠す）。着いたときの一度きりの動きは持たない——入口で一度動けば
  足りる。
*/
export const ContactOrbits = ({ counts }: { counts: KindCounts }) => {
  const map = orbitMap(counts, CONTACT_FRAME)
  const view = `0 0 ${map.width} ${map.height}`
  return (
    <div class="orbits">
      <svg viewBox={view} aria-hidden="true" focusable="false">
        <OrbitLines map={map} side="far" id="contact-far-depth" />
        <Motion map={map} side="far" id="contact-far" />
        <Dust map={map} />
      </svg>
      <Hole frame={CONTACT_FRAME} id="contact-hole" />
      <svg viewBox={view} aria-hidden="true" focusable="false">
        <OrbitLines map={map} side="near" id="contact-near-depth" />
        <Motion map={map} side="near" id="contact-near" />
        <g class="orbit-rest">
          <Bodies bodies={map.bodies} />
        </g>
      </svg>
    </div>
  )
}

/*
  見出しの下に絞り込みを持つ節（Projects）。中身を「見出しの箱」と「本文の箱」の
  2つに畳む。

  節は中身を上端から置く（上揃え。どのページでも見出しが同じ高さに居る錨。app.css の
  「ページの外枠」）。子を2つに畳んでおけば、見出しの側と本文の側の境目が1つに
  決まる。見出し側には、見出しと絞り込みを入れる。
*/
export const ScreenSection = ({
  id,
  label,
  head,
  children,
}: {
  id: string
  label?: string
  head: Child
  children: Child
}) => (
  <Screen id={id} label={label}>
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
  使うのは SkillGroups・Tags と、入口の肩書き（src/routes/public/blocks.tsx の case 'hero'）。
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

/*
  作品1件の恒久リンク。1語目は区分の URL の語（src/domain.ts の ITEM_KINDS。
  apps / works）、3語目が slug。

  3語にしてあるのは、1語・2語の URL を何でも拾う catch-all（/:screen と
  /:screen/:page）と取り合わせないため（前の一覧の /apps/2 は、routes.ts が 301 で寄せる2語）。

  slug の無い行（この列より前からある作品）は null を返す。呼ぶ側は
  「恒久リンクがまだ無い」として、リンクそのものを出さない——中身の当てに
  ならない URL を出すくらいなら、出さないほうがよい。
*/
export const itemHref = (item: { type: ItemKind; slug: string | null }) =>
  item.slug ? `/${KIND_PATH[item.type]}/item/${item.slug}` : null

/*
  一覧の行の id（/projects#item-<slug>）。作品のページの「← 一覧に戻る」が、
  一覧の頭ではなくその行へ戻る的（src/routes/public/item.tsx の renderItem）。
  一覧は全件を1ページに並べるので、戻った人は開いた行の所から読み続けられる。

  頭に item- を付けるのは、同じページの節の id（projects・block-3 …）と取り合わない
  ため。slug の無い行（恒久リンクがまだ無い作品）は id を持たない——戻ってくる
  作品のページが無い。
*/
export const itemCardId = (item: { slug: string | null }) =>
  item.slug ? `item-${item.slug}` : undefined

/*
  ページを移るときに、一覧の行の題と作品のページの見出し（h1）を1つのものとして
  つなぐ名前（view-transition-name。app.css の「ページの切り替え」）。一覧の題が
  そのまま作品のページの見出しへ動いて大きくなる。

  名前は1つのページの中でただ1つでなければならない（同じ名前が2つあると、その
  ページの切り替えごと捨てられる）。slug は作品ごとにただ1つで、字は a-z0-9 と
  - だけ（format.ts の toSlug）なので、そのまま CSS の名前になる。付けるのは一覧の
  行の題と作品のページの h1 だけ（全体ページの本文の小節には付けない）。
*/
export const itemTransition = (item: { slug: string | null }) =>
  item.slug ? `view-transition-name:item-${item.slug}` : undefined

/*
  一覧（Projects）の1行。番号・題と説明・札（プラットフォームか業界・区分・年・
  担当）・技術・サムネイル・矢印を横に並べる（狭い画面では縦に積む。app.css の
  「一覧の行」）。number は一覧での番号（1 から）で、入口の軌道図の札と同じ番号。

  行のどこを押しても、その作品のページ（恒久リンク）へ行く。

  行そのものを <a> にはできない。中に外へのリンク（.links の Repository ↗ など）と
  担当者名（.entry__member）があり、<a> は入れ子にできない。click を拾う JavaScript も
  公開ページには置かない。だから題のリンク（.entry__link）の ::after を行いっぱい
  （inset: 0）に広げ、行の面を押すと題のリンクを押したことになるようにする
  （stretched link。規則は app.css の .entry__link）。行の中のほかのリンクは重ねの順で
  その上に出してあるので、押せばそれぞれの行き先へ行く。

  リンクの数は増やさない。読み上げでもキーボードでも、止まるのは題の1本で、
  名前は作品名のまま（::after は字を持たない）。フォーカスの輪郭はその ::after
  に描くので、行全体を囲む。

  slug の無い行（恒久リンクがまだ無い作品）は題を素の字のまま出し、押せる面も
  矢印も付かない——押しても何も起きない行に、押せる合図を出さない。

  サムネイルは画像のある作品だけ（飾りなので alt="" と aria-hidden。名前は題の
  リンクが持つ）。loading="lazy" は、一覧が縦に長いため。枠の縦横比は CSS が
  決めているので、読み込みを待っても高さは動かない。
*/
export const ItemRow = ({
  item,
  number,
  showMember,
}: {
  item: ItemView
  number: number
  showMember?: boolean
}) => {
  const href = itemHref(item)
  const where = item.platformLabel ?? item.category
  return (
    // id は作品のページの「← 一覧に戻る」の着地点（itemCardId）
    <article class="entry" id={itemCardId(item)}>
      <span class="entry__index" aria-hidden="true">
        {twoDigits(number)}
      </span>
      <div class="entry__main">
        <h3>
          {href ? (
            <a class="entry__link" href={href} style={itemTransition(item)}>
              {item.title}
            </a>
          ) : (
            item.title
          )}
        </h3>
        {item.summary ? <p>{item.summary}</p> : null}
        <Metric item={item} />
        <LinkRow links={item.links} />
      </div>
      <ul class="entry__meta">
        {where ? <li lang={langOf(where)}>{where}</li> : null}
        <li>{KIND_LABEL[item.type]}</li>
        {item.year ? <li class="entry__year">{item.year}</li> : null}
        {showMember && item.memberName && item.memberSlug ? (
          <li>
            <a class="entry__member" href={`/members/${item.memberSlug}`}>
              {item.memberName}
            </a>
          </li>
        ) : null}
      </ul>
      <Tags tags={item.tags} />
      {item.imageUrl ? (
        <span class="entry__thumb" aria-hidden="true">
          <img src={item.imageUrl} alt="" loading="lazy" decoding="async" />
        </span>
      ) : null}
      {href ? (
        <span class="entry__go" aria-hidden="true">
          →
        </span>
      ) : null}
    </article>
  )
}

/*
  実績値（値・単位・添え）を1行に。一覧の行と作品のページで同じものを描く。
  トップの「数字」ブロック（Numbers）の箱とは別物——あちらは数字そのものが
  主役の節で、こちらは作品の中の1行。

  並びは値・単位・添えのまま。書いた人の数字の意味を並べ替えで変えない
  （src/routes/public/meta.ts の metricDigest と同じ決まり）。添えは値のあとに続けて読まれる
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
  行き先を1行に並べる（.links）。一覧の行の本文の下と、作品のページの行き先。

  矢印は CSS が付ける——外へ出る行き先は ↗、サイトの中（/ で始まる URL。
  作品のページの「担当」）は →（app.css の .links a）。別タブで開くか（target）
  と rel も同じ1つの条件で決める（LinkList と同じ決まり。↗ は「外へ出る・
  別タブで開く」の印で、同じタブで開くサイトの中の続きには付けない）。

  URL の形はこの部品が自分で見る（isSafeUrl）。通らない行は描かない。保存でも
  弾いている（src/routes/admin/items.tsx の readLinks）が、その検査より前に入った行を呼ぶ側の
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
  見た目を伝える唯一の手段で、一覧のサムネイル（飾り）とは役目が違う。

  枠の高さは CSS が決め（:root の --shot-h。900 以上では文の列と同じ高さ）、
  絵はその中に object-fit: contain で縮めて収める（切らない）。寸法は共有カードの
  ためにだけ持っていて（items.image_width / image_height。この列より前の画像には
  無い）、枠には使わない。絵に合わせて枠を伸び縮みさせると、読み込んだ瞬間に下の
  文の列が押し下げられ（読み始めた字が動く）、縦長の絵が1枚でページの頭を
  何画面ぶんも食う。

  遅延読み込みにしない。このページの主役で、開いた時点で画面の中にある。
*/
export const Shot = ({ src, alt }: { src: string; alt: string }) => (
  <figure class="shot">
    <img src={src} alt={alt} decoding="async" />
  </figure>
)

/*
  作品1件のページの、見出し（SectionHead）の下。**一覧の行を開いたもの**として
  組む——説明・実績値・タグ・行き先は行と同じ部品（Note の段落・Metric・
  Tags・LinkRow）。足すのは画像（Shot）だけで、本文はこの下の小節（ItemStory）。

  行と同じ部品にしたのは、行から開いた先で同じ形に着く続き方のため。
  以前は実績値をトップの「数字」の箱（Numbers）で、行き先をリンク集の行
  （LinkList）で出していて、説明 100 字・実績値・行き先3本の作品では、それだけで
  画像の上に画面1枚ぶんの高さを取っていた。

  並びは 画像 → 文の列（説明・実績値・タグ・行き先）。900 未満では縦に、900 以上
  では文の列を左・画像を右に並べる（app.css の .detail--shot）。画像を先に置くのは、
  縦に積んだとき見出しのすぐ下に来るように。横に並べたときは左から読み始める
  文の頭を見出しにそろえたいので、画像は右へ回す。

  links は行き先（作品のリンクと、複数人のサイトなら「担当」）。呼ぶ側が
  組む——担当を出す条件（showMemberOf）はサイトの構成を知っている側にしかない。
*/
export const ItemDetail = ({
  item,
  links,
}: {
  item: ItemView
  links: { label: string; url: string }[]
}) => (
  <div class={item.imageUrl ? 'detail detail--shot' : 'detail'}>
    {item.imageUrl ? <Shot src={item.imageUrl} alt={item.imageAlt} /> : null}
    <div class="detail__text">
      {item.summary ? <Note paragraphs={[item.summary]} /> : null}
      <Metric item={item} />
      <Tags tags={item.tags} />
      <LinkRow links={links} />
    </div>
  </div>
)

/*
  作品のページの本文の小節「Story」（#story）。ItemDetail のすぐ下に置く
  （src/routes/public/item.tsx の renderItem）。見出しは h1 の作品名の下の h2。

  本文（背景・やったこと・結果）は「です・ます」の段落で、説明（目録の2文・常体）の
  続きとして読まれる——文体の変わる所が目録と本文の境目（CLAUDE.md「文言」）。
  以前は次の画面（…/story）に分けていて、前の URL はここへ 301 で来る（id="story"）。

  本文の無い作品では出さない（見出しだけ残さない）。
*/
export const ItemStory = ({ paragraphs }: { paragraphs: string[] }) =>
  paragraphs.length ? (
    <div class="story" id="story">
      <SectionHead title="Story" sub={2} />
      <Note paragraphs={paragraphs} />
    </div>
  ) : null

/*
  全体ページ（/all）の Projects の節に置く、作品の本文の列。一覧の行の下。

  全体ページは中身を全部載せる場所（印刷・Ctrl-F・翻訳の宛先）なので、作品の
  ページの小節にある本文も、ここで読めなければならない。行の中には入れない
  ——行は面ごと作品のページへのリンクで（題の ::after が覆う）、覆いの下の
  段落は選べも読み上げの移動もしにくい。

  見出しは作品名に「Story」の添え（全体ページには作品名の見出しがほかに無い）で、
  段は節の中の小節の h3（SectionHead の sub。/all の Profile の About と同じ段）。
  本文の無い作品は並べない（見出しだけ残さない）。1つも無ければ列ごと出さない。
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
          <SectionHead title={story.title} note="Story" sub={3} />
          <Note paragraphs={story.paragraphs} />
        </div>
      ))}
    </div>
  ) : null

/*
  個人ページの頭に置く名札。顔・名前・肩書きと所在地を、Team のカード
  （MemberCardWide）と同じ並びで出す——カードを押した先で、同じ顔と名前に着く。

  個人ページの足元はサイトの足元のまま。1人のサイトなら足元にも名前は出る
  （どのページでも。SiteIdentity）が、顔が出るのはここだけ。heading は「名前がこのページの見出しか」。
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
  技術の塊（小見出しひとそろい）の列。個人ページの Skills の節と、全体ページ
  （/all）の Profile の節の2か所で描く。

  小見出しは段落ではなく見出し。見た目は mono の小見出しとして組んであるのに
  要素が <p> だと、読み上げの見出し移動で塊に降りられない（個人ページでいちばん
  密度が高い節）。要素の段は置かれる場所の階層で変わる——個人ページでは
  ページの h1 → Skills の h2 の下なので h3、/all では Profile（h2）→ Skills（h3）の
  下なので h4。見た目はどちらも同じ .side-head。

  塊の中は、経験の添え（「3年以上」）ごとの行に並べる（src/lib/format.ts の
  skillRows）。添えは行の頭に1度だけ置く——項目ごとに付けていたころは、同じ
  「3年以上」がページに11回並び、項目の名前より添えのほうが目に入っていた。

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

export const SkillGroups = ({ groups, level }: { groups: SkillGroup[]; level: 3 | 4 }) => (
  <div class="skills">
    {groups.map((group) => {
      const rows = skillRows(group.skills)
      const noted = rows.filter((row) => row.note !== '')
      const bare = rows.find((row) => row.note === '')
      return (
        <div class="skill-group" key={group.heading}>
          {group.heading ? (
            level === 3 ? (
              <h3 class="side-head" lang={langOf(group.heading)}>
                {group.heading}
              </h3>
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
  書くのは節の名前（目次・見出しの Profile / About …）だけ。
  「Profile →」と英語で書いていたころは、同じページの「一覧で見る →」
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
  一覧への帯。件数を添えて、押す前に「ここに何件あるか」を見せる。

  使うのは、2人以上のサイトの個人ページの名札の下（入口は同じことを「一覧で見る →」
  と件数の帯 Tally で言う）。作品そのものは別の URL（その人で絞った一覧）にあるので、
  そこに何があるかを数で示してから送り出す。行き先は呼ぶ側が決める（項目のある側へ
  送ること。0件の側へ送ると、0件の知らせだけのページに着く）。

  題（label）は「何が入っているか」、右端は「どうするか（一覧で見る）」で、言葉を
  分ける。「つくったものの一覧」と書くと、1枚の札の中で「一覧」を2度言う。
*/
export const Band = ({
  href,
  label,
  counts,
}: {
  href: string
  label: string
  counts: KindCounts
}) => (
  <a class="band" href={href}>
    <span class="band__body">
      <strong>{label}</strong>
      {/* 0件の区分は数えない。呼ぶ側は、一覧を置いていないサイトでは帯ごと出さない */}
      <span class="band__meta">
        {ITEM_KIND_KEYS.filter((kind) => counts[kind] > 0)
          .map((kind) => `${KIND_LABEL[kind]} ${counts[kind]}`)
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
  絞り込みを URL の query にする。付けるのは効いている軸だけ。

  絞り込みはページをまたいで残るので、絞り込みの手だけでなく目次の行き先（Projects）にも
  同じものを付ける。付け忘れると、目次から一覧へ戻った瞬間に絞り込みだけが
  静かに外れる。
*/
export const filterQuery = (filter: ItemFilter) => {
  const params = new URLSearchParams()
  if (filter.kind) params.set('kind', filter.kind)
  if (filter.member) params.set('member', filter.member)
  const query = params.toString()
  return query ? `?${query}` : ''
}

/*
  絞り込み（字の手。いま効いているものに下線）。

  ボタンではなくリンクで、押すと絞り込んだ一覧のページへ移る。絞り込みを
  持っているのはサーバーで、公開ページは JavaScript を1バイトも持たない。

  2つの軸は独立に効く。いま効いている手をもう一度押すと、その軸だけ外れる。
  「すべて」は両方外す。

  区分の手は、公開中の項目が両方の区分にあるときだけ並べる（kinds は
  絞り込む前に実在する区分）。片方しか無いサイトで「業務」を置いても、押した
  先は0件の知らせだけになる。プラットフォーム（macOS / iOS …）は絞り込みの
  軸ではなく、一覧の行の札。
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
        ? ITEM_KIND_KEYS.filter((kind) => kinds.includes(kind)).map((kind) => {
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
      {/* 1人しか居ないサイトで名前の手を1つ置いても、絞り込む先が無い */}
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
  一覧へ戻る道。作品1件のページの頭（見出しの上）に1本置く
  （src/routes/public/item.tsx の renderItem）。行き先は一覧のその作品の行
  （/projects#item-<slug>。itemCardId）。

  作品のページから戻る道が目次の「Projects」しか無いと、一覧の頭へ戻ってしまい、
  開いた行の所から読み続けられない。ブラウザの「戻る」は、検索や貼られた
  リンクから直接着いた人には一覧へ戻る手にならない。

  見た目は面を持たない字の手で、当たり判定は --tap（pointer: coarse では 44px）。
  矢印は飾りなので読み上げには流さない（入口の「一覧で見る →」と同じ）。
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

// 一文だけのページ。その一文がそのページの見出しなので、ページごとの URL では h1
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
  落としていて、ページに出るかはそちらの行数で決まる——ここで落とすのは、呼ぶ側が
  掛け忘れたときの最後の受け。作品1件のページの行き先は、一覧の行と同じ1行の
  LinkRow（ItemDetail を見ること）。

  矢印は行き先で変える。↗ はこのサイトでは「外へ出る・別タブで開く」の印
  （一覧の行の .links、管理画面の「サイトを見る ↗」）で、サイトの中の続き——
  / で始まる URL——には → を付ける（Team のカードの「プロフィール →」、入口の
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

  1人のサイトでは Team のページを作らず、その人のページ（/members/<slug>）が
  サイトの並びに入る（src/routes/public/data.ts の profileOf）。/all は並びを
  1つの文書に積んだものなので、Team のカード1枚ではなく、プロフィールそのものを
  1つの節として置く。見出しの段は
  Hero の h1 → Profile の h2（節の SectionHead）→ About / Skills / Career の h3
  （SectionHead の sub）→ 技術の小見出しの h4（SkillGroups の level）。

  新しい見た目はほとんど持たない——名札（Nameplate）、大見出しは大きな一文
  （Statement）、紹介（Note）、技術（SkillGroups）、経歴（Timeline）。どれも個人
  ページと同じ部品。足したのは小節を縦に並べる .profile の間隔と、h3 の段だけ。

  中身の無い小節は出さない（見出しだけ残さない）。個人ページの About は空でも
  「準備中です」を出すが、あれは名札の下に何も無いページを作らないためで、
  ほかの節が続く1つの文書の中では要らない。children はその人だけの連絡先
  （サイトと違う行き先を持つ人のぶん。呼ぶ側が決める）。
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
        <SectionHead title="About" sub={3} />
        <Note paragraphs={bio} />
      </div>
    ) : null}
    {skills.length ? (
      <div>
        <SectionHead title="Skills" sub={3} />
        <SkillGroups groups={skills} level={4} />
      </div>
    ) : null}
    {career.length ? (
      <div>
        <SectionHead title="Career" sub={3} />
        <Timeline rows={career} />
      </div>
    ) : null}
  </div>
)

/* ------------------------------------------------------------ 連絡先と足元 */

/*
  GitHub とメールの行き先。GitHub は https:// の絶対 URL だけを描く（isHttpsUrl。
  保存でも同じ検査で弾いている——src/routes/admin/members.tsx の memberErrors）。
  部品の側でも見るのは、その検査より前に保存された行を、呼ぶ側に頼らずに落とすため。

  メールの札は「メール」。押す手の言葉は日本語（CLAUDE.md「文言」）で、GitHub は
  サービスの固有名なのでそのまま。

  owner は「誰の行き先か」。サイトの行き先（足元と Contact）は渡さず、その人だけの
  行き先（OwnSocials）が名前を渡す。読み上げの名前が「青木 春香の GitHub」になる
  （見た目の札は「GitHub」のまま。名前は見た目の字を含む——WCAG 2.5.3）。
*/
export const Socials = ({
  github,
  email,
  owner,
}: {
  github?: string | null
  email?: string | null
  owner?: string
}) => (
  <div class="socials">
    {isHttpsUrl(github) ? (
      <a
        href={github}
        rel="me noreferrer"
        target="_blank"
        aria-label={owner ? `${owner}の GitHub` : undefined}
      >
        <GithubIcon /> GitHub
      </a>
    ) : null}
    {email ? (
      <a href={`mailto:${email}`} aria-label={owner ? `${owner}のメール` : undefined}>
        <MailIcon /> メール
      </a>
    ) : null}
  </div>
)

/*
  その人だけの連絡先。サイトと違う行き先を持つ人のぶんだけ出す（同じ行き先を
  2つ置かない）。個人ページの名札の下と、全体ページ（/all）のプロフィールの節で使う。

  札にはその人の名前を添える（読み上げの名前「青木 春香の GitHub」）。2人以上の
  サイトの個人ページには、足元のサイトの GitHub / メールと、この人の GitHub / メールが
  同じページに並ぶ——同じ名前の札が別の行き先を指すと、読み上げの一覧では
  どちらがこの人のものか分からない（同じ行き先を2つ置かない、の裏返し）。足元の
  ほうを外さないのは、足元がどのページでも同じサイトの足元だから（個人ページ専用の
  ものに入れ替えない。CLAUDE.md「個人ページは1ページで、サイトの並びの一部」）。
*/
export const OwnSocials = ({ member }: { member: Member }) => {
  const github = isHttpsUrl(member.github) && member.github !== SITE.github ? member.github : null
  const email = member.email && member.email !== SITE.email ? member.email : null
  return github || email ? <Socials github={github} email={email} owner={member.name} /> : null
}

/*
  連絡先のページ。サイトの並びの最後で、入口と対になる締め。

  ページに出すのは軌道図と、誘う1文（SITE.contactLead）と、メールと GitHub の手。
  軌道図は入口と同じ星系を、帯の真ん中に置く（ContactOrbits）。字は図の下に置き、
  図の上には乗せない。

  - 誘いの1文は、何の相談なら送ってよいかを言う唯一の言葉なので、大きく置く
    （句読点の塊を1行ずつ。入口の大見出しと同じ Phrases）。目に見える見出しは
    置かない（「Contact」と書いても目次と同じことを言うだけ）
  - メールの手はアドレスそのものを大きな字にしたリンク（押すとメールを書く画面が開く）。
    アドレスは字で読めるので、紙に刷っても宛先が残る。操作の言葉「メールを送る」を
    添える（読み上げの名前にも入る。見た目の字を含む——WCAG 2.5.3）
  - GitHub は外へ出る脇の道なので、小さな札で添える（↗ は外へ出る・別タブの印）
  - 見出しは読み上げ用の h1「Contact」（HiddenHeading）。ページは h1 を
    ちょうど1つ持つ（WCAG 1.3.1）。全体ページ（/all）では、ほかの節と同じ
    見出しを目に見える形で置く
  - このページでは足元の GitHub / メールを出さない（SiteIdentity の contact。同じ
    行き先が1つのページに2つ並ぶ）

  whole は「全体ページ（/all）の1節として描くか」。全体ページでは見出しを目に見える
  h2 で置き、軌道図は置かない（印刷・Ctrl-F・翻訳の宛先）。counts は軌道図に載せる
  作品の件数（入口と同じ星系にする）。
*/
export const Contact = ({
  email,
  github,
  counts,
  whole,
}: {
  email: string
  github?: string | null
  counts: KindCounts
  whole?: boolean
}) => (
  <Screen id="contact" label="Contact" orbital={!whole}>
    {whole ? <SectionHead title="Contact" /> : <HiddenHeading text="Contact" h1 />}
    {whole ? null : <ContactOrbits counts={counts} />}
    <div class="contact">
      <p class="contact__lead">
        <Phrases text={SITE.contactLead} />
      </p>
      <a class="contact__mail" href={`mailto:${email}`}>
        <span class="contact__address">{email}</span>
        <span class="contact__go">
          <span aria-hidden="true">→ </span>メールを送る
        </span>
      </a>
      {isHttpsUrl(github) ? (
        <a class="contact__sub" href={github} rel="me noreferrer" target="_blank">
          <span lang="en">GitHub</span>
          <span aria-hidden="true"> ↗</span>
        </a>
      ) : null}
    </div>
  </Screen>
)

/*
  足元の名乗り（Layout.tsx の footer）。どのページにも出るので、ここに載せたものは
  全ページに載る。

  solo は1人のサイトのその人（src/routes/public/data.ts の soloMember）。1人の
  サイトなら、どのページでも名前と職種を載せる——入口の大見出しはその人の
  一文で、名前ではない。Projects・作品・Contact は検索や貼られたリンクから直接着く
  ページで、誰のサイトかを目に見える字で言うのはここになる。

  2人以上のサイトでは名前を出さない。誰か1人の名前を置くと、その人の
  サイトに見える。

  contact は「Contact のページか」。本文にメールと GitHub の手があるので、
  足元の GitHub / メールは出さない（同じ行き先を1つのページに2つ置かない）。
  全体ページ（/all）では出す（あそこの Contact は節の1つで、足元は全体の足元）。
*/
export const SiteIdentity = ({ solo, contact }: { solo?: Member; contact?: boolean }) => (
  <div class="identity">
    <div class="identity__who">
      {solo ? <span class="identity__name">{solo.name}</span> : null}
      {solo?.role ? <span class="identity__role">{solo.role}</span> : null}
      <span class="identity__tagline">{SITE.tagline}</span>
    </div>
    {contact ? null : <Socials github={SITE.github} email={SITE.email} />}
  </div>
)
