import { raw } from 'hono/html'
import type { Child } from 'hono/jsx'
import adminCss from '../../public/admin.css'
import appCss from '../../public/app.css'
import previewCss from '../../public/preview.css'
import { type CelestialBody, type CelestialMember, normalizeCelestial } from '../celestial'
import type { Item, Member } from '../db/schema'
import {
  ITEM_KIND_KEYS,
  type ItemFilter,
  type ItemImage,
  type ItemKind,
  type ItemView,
  itemImages,
  KIND_LABEL,
  KIND_PATH,
  type KindCounts,
  type StoryPart,
  totalOf,
} from '../domain'
import { initials, isHttpsUrl, isSafeUrl, type SkillGroup, skillRows } from '../lib/format'
import { motionFrames, orbitFlows, orbitHalfClip } from '../lib/orbit-motion'
import {
  CONTACT_FRAME,
  type CosmosMap,
  cosmosMap,
  HERO_FRAME,
  type OrbitFrame,
  type OrbitMap,
  orbitMap,
} from '../lib/orbits'
import { isContactEmail, SITE, type SiteSettings } from '../site'
import { BlackholeFlow } from './BlackholeFlow'
import { CelestialArt, CelestialSymbol, celestialTheme } from './Celestial'
import { ASTRA_CONTACT_ART, ASTRA_COVER_ART } from './celestial-art'
import { GithubIcon, MailIcon, PencilIcon, Wordmark } from './icons'
import { BLACKHOLE_ART } from './logo'

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
  管理プレビューだけは app.css のあとに preview.css を読み、確認用の操作を付ける。

  URL には中身から作った版（?v=…）を付け、public/_headers が CSS を
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
  preview: `/preview.css?v=${cssVersion(previewCss)}`,
} as const

export const Stylesheets = ({
  admin = false,
  preview = false,
}: {
  admin?: boolean
  preview?: boolean
}) => (
  <>
    <link rel="stylesheet" href={STYLESHEETS.app} />
    {admin ? <link rel="stylesheet" href={STYLESHEETS.admin} /> : null}
    {preview ? <link rel="stylesheet" href={STYLESHEETS.preview} /> : null}
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
  ままだと明るいタブの帯では光が消え、黒い点だけになる。公開・管理・404 の
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
  上の帯の左端のロゴ（ワードマーク ΛSTLOG。O はこのページの天体）。押すと入口へ。
  大きさは1つだけ（app.css の --brand-h）。

  絵は aria-hidden で、リンクの名前は .sr-only の字（サイトの名前）が持つ（WCAG 4.1.2。
  絵だけのリンクは名前を持たない）。
*/
export const Brand = ({ href = '/', member }: { href?: string; member?: CelestialMember } = {}) => (
  <a class="brand" href={href}>
    <Wordmark class="brand__word" member={member} />
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

  icon は作品のページの見出しの左に置くアイコン（items.icon_url）。飾りなので alt は空
  （名前はすぐ隣の見出しが言う）。遅延読み込みにしない（開いた画面の頭にある）。
  アイコンのある見出しは、見出しと添えを1つの塊（.head__text）にしてアイコンの隣に置く
  ——見出しと同じ列に並べると、1行に入らない題（電話の 10 字を超える和文）が次の行へ
  落ち、アイコンだけが1行に残った。塊の中で題が折り返す。
*/
export const SectionHead = ({
  title,
  note,
  count,
  h1,
  sub,
  chapter,
  transition,
  icon,
}: {
  title: string
  note?: string
  count?: number
  h1?: boolean
  sub?: 2 | 3
  chapter?: boolean
  // ページを移るときにつなぐ名前（作品のページの h1。itemTransition）
  transition?: string
  icon?: string | null
}) => {
  const text = (
    <>
      {h1 ? <h1 style={transition}>{title}</h1> : sub === 3 ? <h3>{title}</h3> : <h2>{title}</h2>}
      {count === undefined ? null : (
        <span class="head__count">
          {twoDigits(count)}
          <span class="sr-only"> 件</span>
        </span>
      )}
      {note ? <span class="note">{note}</span> : null}
    </>
  )
  const kind = sub ? 'head head--sub' : chapter ? 'head head--chapter' : 'head'
  return icon ? (
    <div class={`${kind} head--icon`}>
      <img class="head__icon" src={icon} alt="" width="64" height="64" decoding="async" />
      <div class="head__text">{text}</div>
    </div>
  ) : (
    <div class={kind}>{text}</div>
  )
}

/*
  読み上げのためだけに置く見出し（.sr-only）。目に見える見出しを持たないページが
  使う——見出しを空けたメモ（段落がページの全部）。Contact の単独ページは
  目に見える h1 を持つ。

  ページは h1 をちょうど1つ持つ決まり（CLAUDE.md「1ページ = 1ドキュメント」、
  WCAG 1.3.1）。見出しの無いページは、見出しで移動する人にとって「何も無い」
  ページになる。全体ページ（/all）では節の見出しの段（h2）。

  目に見える見出しを置かない理由は呼ぶ側にある（メモの注記）。ここは
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

  orbital は Contact の表紙。単独ページでは5天体共通の見出し・連絡先・画像の
  区画を使い、/all では通常の節見出しを使う。旧 ContactOrbits は DOM に残るが、
  表紙では CSS で非表示にする。
*/
export const Screen = ({
  id,
  label,
  orbital,
  celestial,
  children,
}: {
  id?: string
  label?: string
  orbital?: boolean
  celestial?: Member
  children: Child
}) => (
  <section
    id={id}
    class={orbital ? 'orbital' : undefined}
    role={label ? 'region' : undefined}
    aria-label={label}
    data-accent={celestialTheme(celestial)}
  >
    {children}
  </section>
)

/*
  入口のページ（と、個人ページの頭の名札、全体ページの頭）。<header class="hero">。

  profile は個人ページの頭（名札・大見出し）。すぐ下に About・Skills・Career の
  本文が続く読み物の頭で、本文の列と同じ左の軸に立てる。

  orbit は入口の表紙（.hero--orbit）。5天体共通で、大見出し・リード・CTA、
  右側の天体画像、底の件数の帯（Tally）を並べる。旧 OrbitSystem は DOM に残るが
  表紙では非表示。背景の星空（Cosmos）は控えめに残す。
*/
export const Hero = ({
  profile,
  orbit,
  celestial,
  children,
}: {
  profile?: boolean
  orbit?: boolean
  celestial?: Member
  children: Child
}) => (
  <header
    class={profile ? 'hero hero--profile' : orbit ? 'hero hero--orbit' : 'hero'}
    data-accent={celestialTheme(celestial)}
  >
    {orbit ? <Cosmos map={cosmosMap()} id="hero-cosmos" place="hero" /> : null}
    {orbit ? <AstraArt body={normalizeCelestial(celestial).body} place="home" /> : null}
    {orbit ? <AsciiSky /> : null}
    {children}
  </header>
)

// Every celestial body uses one layout; only its decorative image changes.
// The heading, links and project count stay as real HTML above the image.
const AstraArt = ({ body, place }: { body: CelestialBody; place: 'home' | 'contact' }) => {
  const nebula = body === 'black-hole' && place === 'contact'
  const kind = nebula ? 'nebula' : body === 'black-hole' ? 'hole' : body
  return (
    <img
      class={`astra-art astra-art--${kind}`}
      src={nebula ? ASTRA_CONTACT_ART : ASTRA_COVER_ART[body]}
      width="1586"
      height="992"
      alt=""
      aria-hidden="true"
      decoding="sync"
      fetchPriority="high"
    />
  )
}

// ASCII glyphs sit above the cover art, while the heading and actions remain
// above them. Two sparse, uneven rings give the stars motion without a canvas,
// network request, or client-side script. Their initial frame is valid HTML.
const ASCII_RINGS = [
  { name: 'inner', count: 12, radius: 27, offset: 8 },
  { name: 'outer', count: 17, radius: 42, offset: 25 },
] as const
const ASCII_GLYPHS = ['+', '.', '*', ':'] as const

const AsciiSky = () => (
  <div class="ascii-sky" aria-hidden="true">
    {ASCII_RINGS.map((ring) => (
      <div class={`ascii-sky__orbit ascii-sky__orbit--${ring.name}`} key={ring.name}>
        {Array.from({ length: ring.count }, (_, index) => {
          const angle =
            Math.round(
              (((index * 360) / ring.count + ring.offset + ((index % 3) - 1) * 7) % 360) * 100,
            ) / 100
          const radius = ring.radius + ((index % 4) - 1.5) * 2
          const mobileVw = Math.round(radius * 0.96 * 100) / 100
          const mobilePx = Math.round(radius * 3.9 * 100) / 100
          const desktopVw = Math.round(radius * 0.54 * 100) / 100
          const desktopPx = Math.round(radius * 7 * 100) / 100
          return (
            <span
              class="ascii-sky__star"
              key={index}
              style={`--angle:${angle}deg;--r-mobile:min(${mobileVw}vw,${mobilePx}px);--r-desktop:min(${desktopVw}vw,${desktopPx}px);opacity:${index % 5 === 0 ? 0.7 : 0.42}`}
            >
              <span class="ascii-sky__glyph" style={`--phase:-${(index % 7) * 0.8}s`}>
                {ASCII_GLYPHS[(index + ring.offset) % ASCII_GLYPHS.length]}
              </span>
            </span>
          )
        })}
      </div>
    ))}
  </div>
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
  軌道の楕円の枠（orbits.ts の OrbitPath の ellipse）。単位円を、写した楕円へ写す——星屑と
  天体はこの中の単位円の上に居て、回っても楕円（軌道の線）から外れない。unstretch はその逆の
  伸びで、天体の形を楕円の枠で潰さないために戻す
*/
const ellipseFrame = ({ cx, cy, rx, ry, angle }: OrbitMap['orbits'][number]['ellipse']) =>
  `translate(${cx} ${cy})${angle ? ` rotate(${angle})` : ''} scale(${rx} ${ry})`

const unstretch = ({ rx, ry, angle }: OrbitMap['orbits'][number]['ellipse']) =>
  `scale(${Number((1 / rx).toPrecision(5))} ${Number((1 / ry).toPrecision(5))})${angle ? ` rotate(${-angle})` : ''}`

/*
  天体（作品1つ）。光る惑星——中心がいちばん明るく外へ溶ける白い光（orbit-body__core。
  輪の半径の CORE 倍の円を放射の坂で塗る）と、そのまわりのアクセント色のにじみ（__halo。
  輪の半径の HALO 倍）。縁のくっきりした白い円（長さ0の線の丸い線端）で描いていたころは、
  軌道を回る平らな丸い点に見えた（持ち主の「軌道の丸い点が違和感」）。にじみも平らな円で
  描くと、ラジオボタンのような円盤に見えた。光・にじみ・輪はどれも枠の単位で、そろって
  枠の幅に比例し、奥行きの倍率でそろって縮む。

  業務の天体は輪のある惑星。輪は軌道面と同じ角度から見た楕円を少し傾けたもの（orbits.ts の
  OrbitMap の ring）で、奥の半分を点の後ろ、手前の半分を前に描く。区分を色だけで分けない
  （形で分ける）。前は白い点と抜いた輪で、図面の記号に見えた。輪を水平のまま描いていた
  ころは、横長の楕円の真ん中に点が乗った姿が「目」の記号に見えた。

  天体は軌道ごと公転する（持ち主の「軌道の線を星と一緒に動かして」）。軌道の楕円の枠の中で、
  単位円の上の置き場所（OrbitBody の u, v）ごと星屑と同じ速さで回る（orbit-spin）。天体の形は
  回さず潰さない——置き場所の中で回転を打ち消し（orbit-unspin）、楕円の枠の伸びを戻す
  （unstretch）。手前ほど大きい（奥行きの倍率）——止まった姿は OrbitBody の scale、回るあいだは
  軌道の大きさの揺れ（OrbitPath の sway）を段の linear() で渡して orbit-sway が変える
  （app.css の「動き続ける」。keyframes は 0 から 1 の1本で、軌道ごとの量は linear() が持つ）。

  天体だけの SVG に置き（.system__bodies / .orbits__bodies）、BODY_TICK ごとにだけ進める
  （steps()。回転と打ち消しは同じ刻み）。流れる星や吸い込まれる粒と同じ層にあると、天体も
  毎コマ描き直しになる。大きさの揺れも毎コマは変えない（stairs）。

  side は奥と手前の半面（OrbitMap の halves）のどちらで切るか。id は半面と坂の名前の頭（置く
  SVG ごとに変える）。
*/
const HALO = 1.6
/*
  白い光の半径（輪の半径に対する倍率）。坂の内側の 1/4 は真っ白のまま（芯）で、そこから外へ
  溶ける。芯が小さいと、電話や DPR 1 の画面で天体が星屑に埋もれた
*/
const CORE = 0.9

/*
  大きさの揺れ（OrbitPath の sway）を段の linear() にする。点と点のあいだは両端の真ん中の
  大きさのまま止め、次の点で変わる——天体の層は BODY_TICK ごとにしか描き直さないので、揺れも
  毎コマは変えない（内側の軌道でも数秒に1度、ほんの少しだけ変わる）
*/
const stairs = (sway: number[]) => {
  const steps = sway.length - 1
  const at = (k: number) => `${Math.round((k / steps) * 100000) / 1000}%`
  const level = (k: number) => Math.round((((sway[k] ?? 0) + (sway[k + 1] ?? 0)) / 2) * 1000) / 1000
  return `linear(${Array.from({ length: steps }, (_, k) => `${level(k)} ${at(k)} ${at(k + 1)}`).join(',')})`
}

const Bodies = ({ map, side, id }: { map: OrbitMap; side: 'far' | 'near'; id: string }) => {
  const tenth = (value: number) => Math.round(value * 10) / 10
  // 天体が無ければ何も描かない（光とにじみの坂も置かない）
  if (!map.bodies.length) return null
  const { rx, ry, tilt } = map.ring
  // 輪の長軸の端（傾けた向き）
  const dx = tenth(rx * Math.cos((tilt * Math.PI) / 180))
  const dy = tenth(rx * Math.sin((tilt * Math.PI) / 180))
  // 輪の半分。sweep 1 は左の端から上を回って右の端へ（奥の半分）、0 は下を回る（手前の半分）
  const ring = (sweep: 0 | 1) => `M${-dx} ${-dy}A${rx} ${ry} ${tilt} 0 ${sweep} ${dx} ${dy}`
  return (
    <>
      <defs>
        <clipPath id={`${id}-half`} clipPathUnits="userSpaceOnUse">
          <path d={map.halves[side]} />
        </clipPath>
        <radialGradient id={`${id}-core`}>
          <stop class="orbit-body__light" offset="0" stop-opacity="1" />
          <stop class="orbit-body__light" offset="0.25" stop-opacity="1" />
          <stop class="orbit-body__light" offset="0.4" stop-opacity="0.75" />
          <stop class="orbit-body__light" offset="0.55" stop-opacity="0.4" />
          <stop class="orbit-body__light" offset="0.75" stop-opacity="0.12" />
          <stop class="orbit-body__light" offset="1" stop-opacity="0" />
        </radialGradient>
        <radialGradient id={`${id}-halo`}>
          <stop class="orbit-body__glow" offset="0" stop-opacity="1" />
          <stop class="orbit-body__glow" offset="0.3" stop-opacity="0.4" />
          <stop class="orbit-body__glow" offset="1" stop-opacity="0" />
        </radialGradient>
      </defs>
      <g class="orbit-bodies" clip-path={`url(#${id}-half)`}>
        {map.orbits.map((orbit, i) => {
          const riders = map.bodies.filter((body) => body.orbit === i)
          if (!riders.length) return null
          return (
            <g key={orbit.d} transform={ellipseFrame(orbit.ellipse)}>
              <g
                class="orbit-spin"
                style={`--dur:${orbit.period}s;--ticks:${orbit.bodyTicks};--sway:${stairs(orbit.sway)}`}
              >
                {riders.map((body) => (
                  <g key={`${body.u},${body.v}`} transform={`translate(${body.u} ${body.v})`}>
                    <g class="orbit-unspin">
                      <g transform={unstretch(orbit.ellipse)}>
                        {/* 大きさの揺れは、出だしの向き（turn）のぶんだけ先から始める */}
                        <g
                          class={`orbit-body orbit-body--${body.kind}`}
                          style={`scale:${body.scale};--delay:-${tenth((body.turn / 360) * orbit.period)}s`}
                        >
                          <circle
                            class="orbit-body__halo"
                            r={tenth(rx * HALO)}
                            fill={`url(#${id}-halo)`}
                          />
                          {body.kind === 'work' ? (
                            <path class="orbit-body__ring" d={ring(1)} />
                          ) : null}
                          <circle
                            class="orbit-body__core"
                            r={tenth(rx * CORE)}
                            fill={`url(#${id}-core)`}
                          />
                          {body.kind === 'work' ? (
                            <path class="orbit-body__ring" d={ring(0)} />
                          ) : null}
                        </g>
                      </g>
                    </g>
                  </g>
                ))}
              </g>
            </g>
          )
        })}
      </g>
    </>
  )
}

/*
  軌道の線（入口と締め）。奥の半分（side = far。ブラックホールの後ろの層）か手前の半分
  （near。前の層）を描く。

  - 濃さは奥から手前へ続けて変わる坂（orbits.ts の OrbitMap の depth）。奥の半分と手前の
    半分が同じ坂を読むので、継ぎ目で濃さが跳ばない（半分ずつの濃さを変えていたころは、
    楕円の左右の端で線が急に濃くなった）。坂の色と濃さは app.css の .orbit-depth__*。
    グラデーションは層ごとに id を分けて持つ（id は置く部品が渡す）
  - 手前の半分に地の色の縁取りは敷かない。手前の線はブラックホールの光の外を通る
    （いちばん内側の軌道でも、円盤の光の端より外）。光が真っ白に広がっていたころは縁取りで
    線を浮かせていて、それが光を黒い筋で切っていた
  - 線は細い芯（orbit）。その下に光の帯（OrbitBands）を敷き、上に星屑（Stardust。軌道ごと
    回る別の SVG）を重ねる——細い芯だけのころは、製図の線に見えた（持ち主の「線と点が図面
    っぽい」「軌道がださい」）
  - 外の軌道ほど淡い（--reach は内側の 0 から外側の 1 までの位置で、濃さは app.css の
    --orbit-outer まで落ちる）。同じ濃さの輪が5本並んでいたころは、的か年輪のような平らな
    縞に見え、奥行きが付かなかった
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
    {map.orbits.map((orbit, i) => {
      // 内側の 0 から外側の 1 まで
      const reach = Math.round((i / Math.max(1, map.orbits.length - 1)) * 100) / 100
      return (
        <g key={orbit[side]}>
          <path
            class="orbit"
            d={orbit[side]}
            pathLength="100"
            stroke={`url(#${id})`}
            style={`--reach:${reach}`}
          />
        </g>
      )
    })}
  </>
)

/*
  軌道に沿う光の帯（入口と締め。形は orbits.ts の OrbitMap の bands）。区間ごとの折れ線を、
  区間ごとの太さと濃さでぼかして描く——手前ほど太く明るい（透視の手がかり）。色は線と同じ
  アクセント（app.css の .orbit-bands）。奥の半分の区間はブラックホールの後ろの層、手前は前の
  層に描く。ぼかしは動かない層（app.css の .system__orbits）の中だけで掛ける——回る星屑と天体、
  流れる星と粒は別の層なので、フィルタを毎コマ掛け直さない。id はフィルタの名前の頭
*/
const OrbitBands = ({ map, side, id }: { map: OrbitMap; side: 'far' | 'near'; id: string }) => {
  const bands = map.bands.filter((band) => band.side === side)
  if (!bands.length) return null
  return (
    <>
      <defs>
        <filter id={`${id}-blur`} x="-10%" y="-10%" width="120%" height="120%">
          <feGaussianBlur stdDeviation="5" />
        </filter>
      </defs>
      <g class="orbit-bands" filter={`url(#${id}-blur)`}>
        {bands.map((band) => (
          <path key={band.d} d={band.d} stroke-width={band.w} stroke-opacity={band.o} />
        ))}
      </g>
    </>
  )
}

/*
  軌道に沿って散る星屑（入口と締め。形は orbits.ts の OrbitPath の stardust）。明るさの段
  ごとに1本の path（長さ0の線の並びに丸い線端で、点の並び）で、段の太さと濃さは app.css の
  .stardust__0 … が決める。

  - 軌道ごとに楕円の枠（ellipseFrame）の中に置き、天体と同じ速さで回る（orbit-spin）——塊ごと
    回るので、軌道が回って見える。点の太さは画面の px（non-scaling-stroke）なので、楕円の枠で
    潰れない
  - 天体と同じく奥の層と手前の層に1つずつ置き、軌道面の奥と手前の半面（side）で切る
  - 星屑だけの SVG に置く（.system__stardust / .orbits__stardust）。粒は図全体で600まで。流れる星や
    天体と同じ層にあると毎コマ全部を描き直す。星屑はゆっくり回るので、1秒に10回だけ
    進めて（OrbitPath の ticks）、そのあいだは描いた層を使い回す
  - 濃さは回らない外側 SVG の奥・手前ごとに決める（奥ほど淡い）。mask で連続した坂を掛けると、
    アクセラレーションを切った Edge で粒を進めるたびに大きい層を描き直す
  - ぼかし（にじみ）は掛けない。回る層のぼかしは進めるたびに掛け直しになる。にじみのぶんの
    明るさは段の太さと濃さが持つ

  id は半面の名前の頭
*/
const Stardust = ({ map, side, id }: { map: OrbitMap; side: 'far' | 'near'; id: string }) => {
  if (!map.orbits.some((orbit) => orbit.stardust.some(Boolean))) return null
  return (
    <>
      <defs>
        <clipPath id={`${id}-half`} clipPathUnits="userSpaceOnUse">
          <path d={map.halves[side]} />
        </clipPath>
      </defs>
      <g class="stardust" clip-path={`url(#${id}-half)`}>
        {map.orbits.map((orbit) => (
          <g key={orbit.d} transform={ellipseFrame(orbit.ellipse)}>
            <g class="orbit-spin" style={`--dur:${orbit.period}s;--ticks:${orbit.ticks}`}>
              {orbit.stardust.map((d, level) =>
                d ? <path key={level} class={`stardust__${level}`} d={d} /> : null,
              )}
            </g>
          </g>
        ))}
      </g>
    </>
  )
}

/*
  軌道を流れる星（入口と締め）。1本の軌道に1つ、芯と十字の光芒を持つ星が短い尾を引く。
  位置と尾の姿勢は orbit-motion.ts が枠の座標へ写し、literal CSS へ焼く。小さい HTML の箱を
  動かすので、静止した芯と尾の SVG を図全体と一緒に毎コマ描き直さない。

  星は向きと大きさ（軌道の sway の平均）を保つ。尾は楕円の面に沿って細る16度の楔で、
  星を原点とする箱だけを matrix で回す。奥と手前には同じ動きを置き、動かない半面で切る。
  この2層のあいだに Hole を挟む。動きを減らす設定では出さない（app.css）。
*/
const Flows = ({ map, side, id }: { map: OrbitMap; side: 'far' | 'near'; id: string }) => {
  const flows = orbitFlows(map)
  if (!flows.length) return null
  const cqi = (value: number) => Math.round((value / map.width) * 10000000) / 100000
  const five = (value: number) => Math.round(value * 100000) / 100000
  const six = (value: number) => Math.round(value * 1000000) / 1000000
  const motion = flows
    .map((flow, i) => {
      const frames = motionFrames(flow.frames.length, flow.period).map(({ at, steps }) => {
        const sample = at * (flow.frames.length - 1)
        const from = flow.frames[Math.floor(sample)]
        const to = flow.frames[Math.min(Math.floor(sample) + 1, flow.frames.length - 1)]
        if (!from || !to) throw new Error('Missing flow path point')
        const part = sample - Math.floor(sample)
        const mix = (start: number, end: number) => start + (end - start) * part
        return {
          at: at * 100,
          x: mix(from.x, to.x),
          y: mix(from.y, to.y),
          matrix: {
            a: mix(from.matrix.a, to.matrix.a),
            b: mix(from.matrix.b, to.matrix.b),
            c: mix(from.matrix.c, to.matrix.c),
            d: mix(from.matrix.d, to.matrix.d),
          },
          timing: steps ? `animation-timing-function:steps(${steps});` : '',
        }
      })
      const move = frames
        .map(
          ({ at, x, y, timing }) =>
            `${at}%{transform:translate(${five(x)}cqi,${five(y)}cqi);${timing}}`,
        )
        .join('')
      const tail = frames
        .map(
          ({ at, matrix: { a, b, c, d }, timing }) =>
            `${at}%{transform:matrix(${six(a)},${six(b)},${six(c)},${six(d)},0,0);${timing}}`,
        )
        .join('')
      return `@keyframes orbit-flow-move-${id}-${i}{${move}}@keyframes orbit-flow-tail-${id}-${i}{${tail}}`
    })
    .join('')
  return (
    <div class="orbit-flows" aria-hidden="true" style={`clip-path:${orbitHalfClip(map, side)}`}>
      <style>{raw(motion)}</style>
      {flows.map((flow, i) => {
        const name = `${id}-${i}`
        // 星だけが sway の平均の大きさ。光芒の線は静止 SVG の画面pxのまま
        const arm = flow.arm * flow.size
        const core = flow.core * flow.size
        const { box, gradient } = flow.tail
        return (
          <span
            key={i}
            class="orbit-flow"
            style={`--motion:orbit-flow-move-${name};--dur:${flow.period}s`}
          >
            <span class="orbit-flow__tail" style={`--motion:orbit-flow-tail-${name}`}>
              <svg
                class="orbit-flow__tail-art"
                viewBox={flow.tail.viewBox}
                style={`left:${cqi(box.x)}cqi;top:${cqi(box.y)}cqi;width:${cqi(box.width)}cqi;height:${cqi(box.height)}cqi`}
                aria-hidden="true"
                focusable="false"
              >
                <defs>
                  <linearGradient
                    id={`${name}-trail`}
                    gradientUnits="userSpaceOnUse"
                    x1={gradient.x1}
                    y1={gradient.y1}
                    x2={gradient.x2}
                    y2={gradient.y2}
                  >
                    <stop class="orbit-flow__light" offset="0" stop-opacity="0" />
                    <stop class="orbit-flow__fade" offset="1" />
                  </linearGradient>
                </defs>
                <path class="orbit-flow__trail" d={flow.tail.d} fill={`url(#${name}-trail)`} />
              </svg>
            </span>
            <svg
              class="orbit-flow__star"
              viewBox={`${-arm} ${-arm} ${arm * 2} ${arm * 2}`}
              style={`left:${cqi(-arm)}cqi;top:${cqi(-arm)}cqi;width:${cqi(arm * 2)}cqi;height:${cqi(arm * 2)}cqi`}
              aria-hidden="true"
              focusable="false"
            >
              <defs>
                <radialGradient id={`${name}-core`}>
                  <stop class="orbit-flow__light" offset="0" stop-opacity="1" />
                  <stop class="orbit-flow__light" offset="0.2" stop-opacity="1" />
                  <stop class="orbit-flow__light" offset="0.45" stop-opacity="0.55" />
                  <stop class="orbit-flow__light" offset="0.75" stop-opacity="0.15" />
                  <stop class="orbit-flow__light" offset="1" stop-opacity="0" />
                </radialGradient>
                <radialGradient id={`${name}-glint`}>
                  <stop class="orbit-flow__light" offset="0" stop-opacity="1" />
                  <stop class="orbit-flow__light" offset="1" stop-opacity="0" />
                </radialGradient>
              </defs>
              <circle class="orbit-flow__core" r={core} fill={`url(#${name}-core)`} />
              <path
                class="orbit-flow__glint"
                d={`M${-arm} 0h${arm * 2}M0 ${-arm}v${arm * 2}`}
                stroke={`url(#${name}-glint)`}
              />
            </svg>
          </span>
        )
      })}
    </div>
  )
}

/*
  ブラックホールへ吸い込まれる光の粒（入口と締め。orbits.ts の OrbitDust）。枠の座標へ
  写した螺旋をliteral CSSへ焼き、小さい HTML の円の位置と明るさを一緒に動かす。
  移動は幅を基準にしたcqi、点の太さは画面px。SVGの道と線を毎コマ描き直さない。

  奥と手前に分けず、ブラックホールの後ろの層にだけ置く——
  黒い円の上を横切る粒は、ロゴと同じ円を汚す。光の縁に掛かる所で、粒は光に溶けて見えなくなる
*/
const Dust = ({ map, id }: { map: OrbitMap; id: string }) => {
  const cqi = (value: number) => Math.round((value / map.width) * 10000000) / 100000
  const fade = (t: number) => {
    if (t <= 0.1) return t * 3.4
    if (t <= 0.2) return 0.34 + (t - 0.1) * 6.6
    if (t <= 0.8) return 1
    if (t <= 0.9) return 1 - (t - 0.8) * 1.7
    return (1 - t) * 8.3
  }
  const motion = map.dust
    .map((grain, i) => {
      // 各区間の長さも段数も整数コマにそろえる。65点で道を保ち、画面が280Hzでも60Hzで進む。
      const steps = motionFrames(grain.path.length, grain.dur, [0.1, 0.2, 0.8, 0.9])
        .map(({ at: t, steps }) => {
          const at = t * (grain.path.length - 1)
          const from = grain.path[Math.floor(at)]
          const to = grain.path[Math.min(Math.floor(at) + 1, grain.path.length - 1)]
          if (!from || !to) throw new Error('Missing dust path point')
          const part = at - Math.floor(at)
          const x = from.x + (to.x - from.x) * part
          const y = from.y + (to.y - from.y) * part
          const timing = steps ? `animation-timing-function:steps(${steps});` : ''
          return `${t * 100}%{transform:translate(${cqi(x)}cqi,${cqi(y)}cqi);opacity:${Math.round(fade(t) * 100000) / 100000};${timing}}`
        })
        .join('')
      return `@keyframes orbit-grain-fall-${id}-${i}{${steps}}`
    })
    .join('')
  return (
    <div class="orbit-dust" aria-hidden="true">
      <style>{raw(motion)}</style>
      {map.dust.map((grain, i) => (
        <span
          key={i}
          class="orbit-grain__dot"
          style={`--motion:orbit-grain-fall-${id}-${i};--dur:${grain.dur}s;--delay:${grain.delay}s;width:${grain.w}px;height:${grain.w}px;margin-left:${-grain.w / 2}px;margin-top:${-grain.w / 2}px;background:color-mix(in srgb,var(--ink) ${Math.round(grain.o * 100)}%,transparent)`}
        ></span>
      ))}
    </div>
  )
}

/*
  宇宙（入口と締め。形は orbits.ts の cosmosMap）。軌道図のまわりの画面いっぱいに敷く星空で、
  入口と締めのページの本文（main）の幅いっぱいに広がる（app.css の .cosmos。main を
  位置の基準にして inset: 0）。持ち主の「もっと壮大に」——軌道図だけが枠の中の絵に見えた。

  - 星（cosmos__stars）。静止星と光芒は SVG、瞬く星は小さい HTML の円に分ける。
    同じ視野を枠いっぱいに切り取り（slice）、瞬きは明るさだけを動かす。いちばん
    明るい星には十字の光芒（cosmos__glint。長さは
    viewBox の単位で、切り取る倍率と一緒に伸び縮みする）。光芒は真ん中から先へ消える坂
    （-glint。十字の箱に合わせた放射の坂）——同じ明るさの細い十字だったころは、照準か
    カーソルの印に見えた
  - 流れ星（cosmos__meteors）。頭が明るく尾が消える短い筋を、置いた向きのまま流す。
    動きを減らす設定では出さない（止まった筋は流れ星に見えない）
  - 星雲（Nebula）。ブラックホールの位置（図の中の焦点の高さを --cosmos-focus で渡す）に、図の
    幅に比例した大きさで置き、外の雲を画面の端まで広げる（app.css の .cosmos__nebula。place
    ごとに図の位置が違う）
  - 星雲の色の淡い広がりと、底で消える覆いも app.css。字の後ろは、字の塊が自分の後ろに敷く
    暗がりが消す（app.css の「字の暗がり」）

  id は光芒と流れ星の坂の名前の頭。飾りなので読み上げには出さない。
*/
const Cosmos = ({ map, id, place }: { map: CosmosMap; id: string; place: 'hero' | 'contact' }) => {
  const view = `0 0 ${map.width} ${map.height}`
  const pct = (value: number) => `${(value * 100).toFixed(5)}%`
  // 光芒の腕の長さ（viewBox の単位。先は坂で消えるので、見える長さはこれより短い）
  const arm = (star: { w: number }) => Math.round(star.w * 6 * 10) / 10
  // 図の中の焦点（ブラックホール）の高さ（枠の高さに対する割合）。星雲をそこに置く（app.css）
  const frame = place === 'hero' ? HERO_FRAME : CONTACT_FRAME
  const focus = Math.round((frame.focus.y / frame.height) * 1000) / 1000
  const dot = (star: CosmosMap['stars'][number]) => (
    <path
      key={`${star.x},${star.y}`}
      d={`M${star.x} ${star.y}h0`}
      opacity={star.o}
      style={`stroke-width:${star.w}px`}
    />
  )
  return (
    <div class={`cosmos cosmos--${place}`} aria-hidden="true" style={`--cosmos-focus:${focus}`}>
      <svg
        class="cosmos__stars cosmos__stars--still"
        viewBox={view}
        preserveAspectRatio="xMidYMid slice"
        aria-hidden="true"
        focusable="false"
      >
        {map.stars.filter((star) => !star.twinkle).map(dot)}
        <defs>
          <radialGradient id={`${id}-glint`}>
            <stop class="cosmos__spark" offset="0" stop-opacity="1" />
            <stop class="cosmos__spark" offset="1" stop-opacity="0" />
          </radialGradient>
        </defs>
        {map.stars
          .filter((star) => star.glint)
          .map((star) => (
            <path
              key={`glint-${star.x},${star.y}`}
              class="cosmos__glint"
              d={`M${star.x - arm(star)} ${star.y}h${arm(star) * 2}M${star.x} ${star.y - arm(star)}v${arm(star) * 2}`}
              style={`stroke:url(#${id}-glint)`}
            />
          ))}
      </svg>
      <div class="cosmos__stars cosmos__stars--twinkle" aria-hidden="true">
        {map.stars.map((star) =>
          star.twinkle ? (
            <span
              key={`${star.x},${star.y}`}
              class="cosmos__twinkle"
              style={`left:${pct(star.x / map.width)};top:${pct(star.y / map.height)};width:${star.w}px;height:${star.w}px;opacity:${star.o};--dur:${star.twinkle.dur}s;--delay:${star.twinkle.delay}s;--ticks:${star.twinkle.ticks}`}
            ></span>
          ) : null,
        )}
      </div>
      <Nebula />
      <div class="cosmos__meteors" aria-hidden="true">
        {map.meteors.map((meteor) => (
          <span
            key={`${meteor.x},${meteor.y}`}
            class="cosmos__meteor-frame"
            style={`left:${pct(meteor.x / map.width)};top:${pct(meteor.y / map.height)};width:${pct(90 / map.width)};transform:rotate(${meteor.angle}deg)`}
          >
            <span
              class="cosmos__meteor"
              style={`--dur:${meteor.dur}s;--delay:${meteor.delay}s`}
            ></span>
          </span>
        ))}
      </div>
    </div>
  )
}

/*
  星雲。形と4層の模様を scripts/nebula/render.mjs で透過 WebP に焼く。
  配色は app.css の --nebula-art が選び、漂いはこの箱に掛ける。
  ブラウザでノイズの SVG フィルタを処理しないので、アクセラレーションを切っても
  周囲の動きで雲を計算し直さない。飾りなので読み上げには出さない。
*/
const Nebula = () => <div class="cosmos__nebula" aria-hidden="true"></div>

// 2桁にそろえた番号（01・02 …）。一覧の行の番号と件数の帯で同じ書き方
const twoDigits = (value: number) => String(value).padStart(2, '0')

/*
  ブラックホール（入口と締め）。白銀の円盤と回り込む光の弧を描いた絵（logo.ts の
  BLACKHOLE_ART。ロゴの O と同じ1枚）を、影の半径が枠の hole になる大きさで置く。影の黒い円
  （--hole-shadow は円の径の、絵の幅に対する割合）は絵の下に敷く（app.css の .hole::before）。
  黒い円・光の縁・横線の記号を大きく描いていたころは、星雲の中で日食かレンズのフレアに
  見えた（持ち主の「ブラックホールが違和感」）。

  大きさは枠の hole から、置き場所は枠の focus から組んで style で渡す（CSS に写すと、枠を
  変えた日に片方だけ古くなる）。app.css が軌道面と同じ傾き（--system-tilt）で回す。光だけが
  ゆっくり揺らぐ（app.css の「動き続ける」）。飾りなので読み上げには出さない。
*/
const Hole = ({ frame }: { frame: OrbitFrame }) => {
  const pct = (value: number) => `${Math.round(value * 10000) / 100}%`
  // 絵の幅（枠の単位）。絵の影の半径（BLACKHOLE_ART.shadow）が hole になる倍率で
  const width = (BLACKHOLE_ART.width / BLACKHOLE_ART.shadow) * frame.hole
  const shadow = pct((2 * BLACKHOLE_ART.shadow) / BLACKHOLE_ART.width)
  return (
    <span
      class="hole"
      aria-hidden="true"
      style={`--hole-x:${pct(frame.focus.x / frame.width)};--hole-y:${pct(frame.focus.y / frame.height)};--hole-w:${pct(width / frame.width)};--hole-shadow:${shadow}`}
    >
      <img
        class="hole__art"
        src={BLACKHOLE_ART.src}
        width={BLACKHOLE_ART.width}
        height={BLACKHOLE_ART.height}
        alt=""
        decoding="async"
      />
      <BlackholeFlow />
    </span>
  )
}

// Keep the existing black-hole projection intact. Other bodies share its exact focus,
// while their slightly wider stage leaves room for rings and the sun's corona.
const OrbitCenter = ({ frame, member }: { frame: OrbitFrame; member?: Member }) => {
  if (normalizeCelestial(member).body === 'black-hole') return <Hole frame={frame} />
  const pct = (value: number) => `${Math.round(value * 10000) / 100}%`
  return (
    <span
      class="orbit-center"
      aria-hidden="true"
      style={`left:${pct(frame.focus.x / frame.width)};top:${pct(frame.focus.y / frame.height)};width:${pct((frame.hole * 5.4) / frame.width)}`}
    >
      <CelestialArt member={member} />
    </span>
  )
}

/*
  入口の軌道図。真ん中にブラックホールを置き、公開中の作品を1つずつ楕円の軌道に
  載せる（形は src/lib/orbits.ts の orbitMap。件数だけから決まる）。

  - まわりの画面いっぱいに星空と星雲を敷く（Hero の Cosmos）
  - 軌道は水平な面を斜め上の近い所から透視で見た楕円で、手前は大きく広がり、奥はブラック
    ホールの後ろで詰まる。奥の半分はブラックホールの後ろ、手前の半分は前を通る（奥と手前で
    SVG を分け、そのあいだに Hole を挟む）。どの軌道も同じ形の入れ子で交わらず、外ほど間が
    広い。細い線（OrbitLines。奥ほど薄く、外の軌道ほど淡い）に、光の帯（OrbitBands。手前ほど
    太く明るい）と星屑（Stardust）を重ねる。帯と線は動かない SVG（.system__orbits）、星屑は
    自分の SVG（.system__stardust。1秒に数回だけ進める）、天体は別の SVG、流れる星と粒は小さい HTML の箱——帯のぼかしと千を超える星屑を、毎コマ描き直さないため
  - 天体は光る惑星で、業務は輪のある惑星（区分の呼び名は KIND_LABEL）。手前ほど大きい（Bodies）
  - 天体は、ブラックホールのまわりの矩形（HERO_FRAME の clear）の外から回り出す
  - 線と点の色は app.css が --accent と --ink から敷く（見た目のプリセットで変わる）。
    ブラックホールの絵は字の白だけ（BLACKHOLE_ART）
  - 図は全部 aria-hidden の飾り。天体に作品の番号の札（作品のページへのリンク）は添えない
    （持ち主が「いらない」と外した）。作品へはすぐ下の「一覧で見る →」から行く
  - 大きな背景と図は完成形で表示する。文字の登場中も、星屑と天体が軌道ごと
    公転し、軌道を星が流れ、光の粒が渦を巻いて吸い込まれ、ブラックホールの光が揺らぎ、星雲が
    漂い、星が瞬く（Flows・Dust・Hole・Nebula）。止まった姿がそのまま完成形

  呼ぶのは renderBlock の case 'hero' だけで、全体ページ（/all）には置かない
  （印刷・Ctrl-F・翻訳の宛先）。
*/
export const OrbitSystem = ({ counts, member }: { counts: KindCounts; member?: Member }) => {
  const map = orbitMap(counts, HERO_FRAME)
  const view = `0 0 ${map.width} ${map.height}`
  /*
    奥の半分（ブラックホールの後ろ）と手前の半分（前）に、同じ順で層を重ねる——ぼかした光の帯、
    軌道の線、刻んで回る星屑、毎コマ動く流れる星と粒、刻んで回る天体。
    動く光を別の層に分け、帯と線を描き直さない
  */
  const half = (side: 'far' | 'near') => (
    <>
      <svg
        class={`system__bands system__bands--${side}`}
        viewBox={view}
        aria-hidden="true"
        focusable="false"
      >
        <OrbitBands map={map} side={side} id={`system-${side}-bands`} />
      </svg>
      <svg
        class={`system__orbits system__orbits--${side}`}
        viewBox={view}
        aria-hidden="true"
        focusable="false"
      >
        <OrbitLines map={map} side={side} id={`system-${side}-depth`} />
      </svg>
      <svg
        class={`system__stardust system__stardust--${side}`}
        viewBox={view}
        aria-hidden="true"
        focusable="false"
      >
        <Stardust map={map} side={side} id={`system-${side}-stardust`} />
      </svg>
      {side === 'far' ? <Dust map={map} id="system" /> : null}
      <Flows map={map} side={side} id={`system-${side}-flow`} />
      <svg
        class={`system__bodies system__bodies--${side}`}
        viewBox={view}
        aria-hidden="true"
        focusable="false"
      >
        <Bodies map={map} side={side} id={`system-${side}-body`} />
      </svg>
    </>
  )
  return (
    <div class="system">
      {half('far')}
      <OrbitCenter frame={HERO_FRAME} member={member} />
      {half('near')}
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
  （枠は orbits.ts の CONTACT_FRAME）。入口と同じく、天体に作品の札は添えない。

  入口と同じく、軌道の奥の半分はブラックホールの後ろ、手前の半分は前に描く。帯と線は
  動かない SVG（.orbits__still）、星屑は自分の SVG（.orbits__stardust）、天体は別の SVG、流れる星と
  粒は小さい HTML の箱に分ける（入口と同じ理由）。まわりの星空と星雲は Contact が敷く（Cosmos）。動き続けるものも入口と同じ
  （Flows・Dust・Hole・Cosmos）——星屑と天体は軌道ごと公転する。
*/
export const ContactOrbits = ({ counts, member }: { counts: KindCounts; member?: Member }) => {
  const map = orbitMap(counts, CONTACT_FRAME)
  const view = `0 0 ${map.width} ${map.height}`
  // 奥の半分と手前の半分に、同じ順で層を重ねる（入口と同じ。帯と線は動かないので1枚）
  const half = (side: 'far' | 'near') => (
    <>
      <svg class="orbits__still" viewBox={view} aria-hidden="true" focusable="false">
        <OrbitBands map={map} side={side} id={`contact-${side}-bands`} />
        <OrbitLines map={map} side={side} id={`contact-${side}-depth`} />
      </svg>
      <svg
        class={`orbits__stardust orbits__stardust--${side}`}
        viewBox={view}
        aria-hidden="true"
        focusable="false"
      >
        <Stardust map={map} side={side} id={`contact-${side}-stardust`} />
      </svg>
      {side === 'far' ? <Dust map={map} id="contact" /> : null}
      <Flows map={map} side={side} id={`contact-${side}-flow`} />
      <svg class="orbits__bodies" viewBox={view} aria-hidden="true" focusable="false">
        <Bodies map={map} side={side} id={`contact-${side}-body`} />
      </svg>
    </>
  )
  return (
    <div class="orbits">
      {half('far')}
      <OrbitCenter frame={CONTACT_FRAME} member={member} />
      {half('near')}
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
  「一覧の行」）。number は公開中の全件の並びでの番号（1 から。絞り込んでも同じ番号）。

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

  サムネイルは画像のある作品だけで、絵はその作品の顔（メインの画像。無ければほかの
  画像の1枚目。src/domain.ts の itemImages）。飾りなので alt="" と aria-hidden（名前は題の
  リンクが持つ）。loading="lazy" は、一覧が縦に長いため。枠の縦横比は CSS が
  決めているので、読み込みを待っても高さは動かない。

  アイコン（items.icon_url）は題の左に小さく。これも飾り（alt=""）で、h3 の中・題の
  リンクの外に置く（行の面は題のリンクの覆いが受けるので、押せば作品のページへ。
  リンクの名前と、ページを移るときにつなぐ題の字は題だけのまま）。

  画像の無い作品は、絵も枠も置かない。空の枠は読み込みの失敗に見え、代わりの絵（前は
  入口の軌道図を縮めた星図）は、どの行にも同じ図が並ぶだけで作品を見分ける手がかりに
  ならなかった（持ち主が「なんか違う」と外した。作品のページの ItemDetail も同じ）。
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
  const cover = itemImages(item)[0]
  const icon = item.iconUrl ? (
    <img
      class="entry__icon"
      src={item.iconUrl}
      alt=""
      width="40"
      height="40"
      loading="lazy"
      decoding="async"
    />
  ) : null
  return (
    // id は作品のページの「← 一覧に戻る」の着地点（itemCardId）
    <article class="entry" id={itemCardId(item)}>
      <span class="entry__index" aria-hidden="true">
        {twoDigits(number)}
      </span>
      <div class="entry__main">
        <h3 class={icon ? 'entry__title--icon' : undefined}>
          {icon}
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
      {cover ? (
        <span class="entry__thumb" aria-hidden="true">
          <img src={cover.url} alt="" loading="lazy" decoding="async" />
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

  代替テキストは管理画面で書いたもの（items.image_alt か、ほかの画像の1枚目の alt）。
  空のまま公開させない（src/blocks.ts の publishErrors。公開の関門）——このページでは
  この画像がその作品の見た目を伝える手段で、一覧のサムネイル（飾り）とは役目が違う。

  枠の高さは CSS が決め（:root の --shot-h。900 以上では文の列と同じ高さ）、
  絵はその中に object-fit: contain で縮めて収める（切らない）。寸法（items.image_width /
  image_height。この列より前の画像には無い）はこの枠には使わない。絵に合わせて枠を伸び縮みさせると、読み込んだ瞬間に下の
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
  Tags・LinkRow）。足すのは絵（画像の Shot）だけで、本文はこの下の小節（ItemStory）。

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

  画像が1枚の作品は画像だけ——絵は1つにする。画像が2枚以上の作品は、ここには絵を置かず、
  すぐ下のギャラリー（ItemShots）に全部を並べる（同じ画像を2度出さない）。画像の無い作品は
  絵を置かず、文の列だけ（代わりの絵は置かない。一覧の行の ItemRow と同じ）。
*/
export const ItemDetail = ({
  item,
  links,
}: {
  item: ItemView
  links: { label: string; url: string }[]
}) => {
  const images = itemImages(item)
  const only = images.length === 1 ? images[0] : undefined
  return (
    <div class={only ? 'detail detail--shot' : 'detail'}>
      {only ? <Shot src={only.url} alt={only.alt} /> : null}
      <div class="detail__text">
        {item.summary ? <Note paragraphs={[item.summary]} /> : null}
        <Metric item={item} />
        <Tags tags={item.tags} />
        <LinkRow links={links} />
      </div>
    </div>
  )
}

/*
  作品の画像のギャラリー（作品のページの小節「Screenshots」。#screenshots）。画像が
  2枚以上の作品だけ。メインの画像を大きく置き、残りは大小の列に並べる。狭い画面では
  1列になるので、スクリーンショットが小さく潰れず、ページと同じ向きに読み進められる。
  順は itemImages のまま（管理画面で決めた順を、CSS の配置で変えない）。

  枠の比と高さの上限は CSS が先に決め、絵は切らずに収める。原寸は画像のリンクで
  別タブに開ける。操作は HTML のリンクだけなので、JavaScript 無効でも拡大できる。
  各画像の説明は代替テキストをそのまま見せる。リンクの名前が説明と操作を含むため、
  キャプションは読み上げから外し、同じ文を2度読ませない。先頭だけすぐ読み、続きは遅延。
*/
export const ItemShots = ({ images }: { images: ItemImage[] }) =>
  images.length > 1 ? (
    <div class="shots" id="screenshots">
      <SectionHead title="Screenshots" sub={2} />
      <section class="gallery" aria-label="Screenshots">
        {images.map((image, index) => (
          <figure
            class={index === 0 ? 'gallery__item gallery__item--lead' : 'gallery__item'}
            key={image.url}
          >
            <a
              class="gallery__image"
              href={image.url}
              target="_blank"
              rel="noreferrer"
              aria-label={`画像${index + 1}「${image.alt}」を拡大して見る（別タブ）`}
            >
              <span class="gallery__frame">
                <img
                  src={image.url}
                  alt={image.alt}
                  width={image.width ?? undefined}
                  height={image.height ?? undefined}
                  loading={index === 0 ? undefined : 'lazy'}
                  decoding="async"
                />
              </span>
            </a>
            <figcaption class="gallery__caption" aria-hidden="true">
              <span class="gallery__number">{twoDigits(index + 1)}</span>
              <span class="gallery__description">{image.alt}</span>
              <span class="gallery__open">拡大して見る ↗</span>
            </figcaption>
          </figure>
        ))}
      </section>
    </div>
  ) : null

/*
  Story の中身（src/blocks.ts の itemStory が開いた塊の並び）。テンプレートより前に書いた
  本文（見出しの無い段落）が先で、テンプレートの欄（背景・取り組み・工夫・成果）が決まった
  順に続く——個人開発も業務も同じ見出しで並ぶ。

  欄の小見出しは Skills の英字の小見出しと同じ形（.side-head。英語だけなので lang="en"）。
  要素の段は置かれる場所の階層で変わる——作品のページは Story（h2）の下なので h3、
  全体ページは作品名（h3）の下なので h4（SkillGroups の level と同じ）。見た目は同じ。
*/
const StoryParts = ({ parts, level }: { parts: StoryPart[]; level: 3 | 4 }) => (
  <div class="story-parts">
    {parts.map((part) =>
      part.heading ? (
        <div key={part.heading}>
          {level === 3 ? (
            <h3 class="side-head" lang="en">
              {part.heading}
            </h3>
          ) : (
            <h4 class="side-head" lang="en">
              {part.heading}
            </h4>
          )}
          <Note paragraphs={part.paragraphs} />
        </div>
      ) : (
        <Note key="lead" paragraphs={part.paragraphs} />
      ),
    )}
  </div>
)

/*
  作品のページの本文の小節「Story」（#story）。ItemDetail のすぐ下に置く
  （src/routes/public/item.tsx の renderItem）。見出しは h1 の作品名の下の h2。

  本文は「です・ます」の段落で、説明（目録の2文・常体）の続きとして読まれる——文体の
  変わる所が目録と本文の境目（CLAUDE.md「文言」）。中身は StoryParts。
  以前は次の画面（…/story）に分けていて、前の URL はここへ 301 で来る（id="story"）。

  本文の無い作品では出さない（見出しだけ残さない）。
*/
export const ItemStory = ({ parts }: { parts: StoryPart[] }) =>
  parts.length ? (
    <div class="story" id="story">
      <SectionHead title="Story" sub={2} />
      <StoryParts parts={parts} level={3} />
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
  テンプレートの欄の小見出しはその下の h4（StoryParts）。
  本文の無い作品は並べない（見出しだけ残さない）。1つも無ければ列ごと出さない。
*/
export const ItemStories = ({
  stories,
}: {
  stories: { key: number; title: string; parts: StoryPart[] }[]
}) =>
  stories.length ? (
    <div class="stories">
      {stories.map((story) => (
        <div key={story.key}>
          <SectionHead title={story.title} note="Story" sub={3} />
          <StoryParts parts={story.parts} level={4} />
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
    <div class="nameplate__body">
      <div class="nameplate__heading">
        {heading ? (
          <h1 class="nameplate__name">{member.name}</h1>
        ) : (
          <strong class="nameplate__name">{member.name}</strong>
        )}
        <CelestialSymbol member={member} />
      </div>
      {member.role || member.location ? (
        <span class="nameplate__meta">
          {[member.role, member.location].filter(Boolean).join(' · ')}
        </span>
      ) : null}
    </div>
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
        <strong class="member__name">
          {member.name}
          <CelestialSymbol member={member} />
        </strong>
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
    <strong class="member__name">
      {member.name}
      <CelestialSymbol member={member} />
    </strong>
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
    {email && isContactEmail(email) ? (
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
export const OwnSocials = ({ member, site = SITE }: { member: Member; site?: SiteSettings }) => {
  const github = isHttpsUrl(member.github) && member.github !== site.github ? member.github : null
  const email = member.email && member.email !== site.email ? member.email : null
  return github || email ? <Socials github={github} email={email} owner={member.name} /> : null
}

/*
  連絡先のページ。サイトの並びの最後で、入口と対になる締め。

  単独ページでは入口と同じ版面に、天体ごとの画像、誘う1文（サイト設定の
  contactLead）、メールと GitHub の手を置く。ブラックホールだけ締めは星雲画像。
  字は画像より前に置き、リンクの可読性を保つ。

  - 誘いの1文は、何の相談なら送ってよいかを言う唯一の言葉なので、大きく置く
    （句読点の塊を1行ずつ。入口の大見出しと同じ Phrases）
  - メールの手はアドレスそのものを大きな字にしたリンク（押すとメールを書く画面が開く）。
    アドレスは字で読めるので、紙に刷っても宛先が残る。操作の言葉「メールを送る」を
    添える（読み上げの名前にも入る。見た目の字を含む——WCAG 2.5.3）
  - GitHub は外へ出る脇の道なので、小さな札で添える（↗ は外へ出る・別タブの印）
  - どの天体も見える h1「Contact」。ページは h1 を
    ちょうど1つ持つ（WCAG 1.3.1）。全体ページ（/all）では、ほかの節と同じ
    見出しを目に見える形で置く
  - このページでは足元の GitHub / メールを出さない（SiteIdentity の contact。同じ
    行き先が1つのページに2つ並ぶ）

  whole は「全体ページ（/all）の1節として描くか」。全体ページでは見出しを目に見える
  h2 で置き、画像・旧軌道図は置かない（印刷・Ctrl-F・翻訳の宛先）。単独ページの
  旧軌道図は検証用に DOM に残し、表紙では非表示にする。
*/
export const Contact = ({
  lead = SITE.contactLead,
  email,
  github,
  counts,
  whole,
  member,
}: {
  lead?: string
  email: string
  github?: string | null
  counts: KindCounts
  whole?: boolean
  member?: Member
}) => (
  <Screen id="contact" label="Contact" orbital={!whole} celestial={whole ? undefined : member}>
    {whole ? <SectionHead title="Contact" /> : <h1 class="contact__title">Contact</h1>}
    {whole ? null : <Cosmos map={cosmosMap()} id="contact-cosmos" place="contact" />}
    {!whole ? <AstraArt body={normalizeCelestial(member).body} place="contact" /> : null}
    {!whole ? <AsciiSky /> : null}
    {whole ? null : <ContactOrbits counts={counts} member={member} />}
    <div class="contact">
      <p class="contact__lead">
        <Phrases text={lead} />
      </p>
      {email && isContactEmail(email) ? (
        <a class="contact__mail" href={`mailto:${email}`}>
          <span class="contact__address">{email}</span>
          <span class="contact__go">
            <span aria-hidden="true">→ </span>メールを送る
          </span>
        </a>
      ) : null}
      {!email && !github ? <p>連絡先を準備しています</p> : null}
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
export const SiteIdentity = ({
  solo,
  contact,
  site = SITE,
}: {
  solo?: Member
  contact?: boolean
  site?: SiteSettings
}) => (
  <div class="identity">
    <div class="identity__who">
      {solo ? <span class="identity__name">{solo.name}</span> : null}
      {solo?.role ? <span class="identity__role">{solo.role}</span> : null}
      <span class="identity__tagline">{site.tagline}</span>
    </div>
    {contact ? null : <Socials github={site.github} email={site.email} />}
  </div>
)
