import type { Child } from 'hono/jsx'
import type { Item, Member } from '../db/schema'
import { initials } from '../lib/format'
import { MarkIcon, PencilIcon } from './icons'

/*
  画面はこの部品だけで組む。新しい見た目が要るときは、まずここに足してから使う。
  ここに無い形をその場で書くと、同じものが少しずつ違う姿で増える。
*/

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
*/
export const SectionHead = ({
  title,
  note,
  h1,
}: {
  title: string
  note?: string
  h1?: boolean
}) => (
  <div class="head">
    {h1 ? <h1>{title}</h1> : <h2>{title}</h2>}
    {note ? <span class="note">{note}</span> : null}
  </div>
)

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

  word-break: auto-phrase が同じことをブラウザにやらせる指定だが、Chromium に
  しか無い。句読点で切るのは粗いが、どのブラウザでも同じ所で折れる。

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

  節は画面の高さの中で中身を上下中央に寄せる（app.css の「画面に収める外枠」）。
  子が4つ（見出し・絞り込み・一覧・0件の知らせ）に散っていると、入りきらなく
  なったときに、どれを縮めるかを毎回選ぶことになる。2つに畳んでおけば、
  手を入れる先は本文の箱ひとつに決まる。

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

export const Tags = ({ tags }: { tags: string[] }) =>
  tags.length ? (
    <ul class="tags">
      {tags.map((tag) => (
        <li key={tag}>{tag}</li>
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

export const ItemCard = ({ item, showMember }: { item: ItemView; showMember?: boolean }) => {
  /*
    題を恒久リンクにする。カード自体をリンクにはできない（中に外へのリンクが
    あり、入れ子の <a> は作れない）ので、名指しできるものの名前そのものを
    リンクにする。見た目は変えない——@media (hover: hover) の .card:hover が
    既にカードごと浮くので、触れる合図はそこで出ている
  */
  const href = itemHref(item)
  return (
    <article class="card">
      <div class="card__head">
        <h3>{href ? <a href={href}>{item.title}</a> : item.title}</h3>
        {item.year ? <span class="year">{item.year}</span> : null}
      </div>
      {item.platformLabel || item.category ? (
        <span class="chip">{item.platformLabel ?? item.category}</span>
      ) : null}
      {item.summary ? <p>{item.summary}</p> : null}
      {item.metricValue ? (
        <div class="metric">
          <span class="metric__value">{item.metricValue}</span>
          {item.metricUnit ? <span class="metric__unit">{item.metricUnit}</span> : null}
          {item.metricNote ? <span class="metric__note">{item.metricNote}</span> : null}
        </div>
      ) : null}
      <Tags tags={item.tags} />
      {showMember && item.memberName && item.memberSlug ? (
        <a class="card__member" href={`/members/${item.memberSlug}`}>
          {item.memberName}
        </a>
      ) : null}
      {item.links.length ? (
        <div class="links">
          {item.links.map((link) => (
            <a key={link.url} href={link.url} rel="noreferrer" target="_blank">
              {link.label}
            </a>
          ))}
        </div>
      ) : null}
    </article>
  )
}

// 1〜2人のときは横長。4列のグリッドに1人だけ置くと、未完成の一覧に見える
/*
  個人ページの1枚目に置く名札。顔・名前・肩書きと所在地を、Team のカード
  （MemberCardWide）と同じ並びで出す——カードを押した先で、同じ顔と名前に着く。

  個人ページの柱はサイトの柱のまま（Team の続きとして読ませる）なので、
  その人の顔と名前はここにしか出ない。heading は「名前がこの画面の見出しか」。
  大見出し（headline）を書いていない人では名前が h1 になる——書いている人では
  大見出しが h1 で、名前は添え。
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
  Team のカード。押すと個人ページ（同じタブ、サイトの枠のまま）へ入る。
  矢印は → にする。↗ はこのサイトでは「外へ出る・別タブ」の印（リンク集・
  作品のリンク・サイトを見る ↗）で、同じサイトの中の続きには使わない。
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
    {/* 日本語のページに素で置いた英語。印を付けないと、読み上げがローマ字読みする */}
    <span class="member__go" lang="en">
      Profile →
    </span>
  </a>
)

export const MemberCardCompact = ({ member }: { member: Member }) => (
  <a class="member member--compact" href={`/members/${member.slug}`}>
    <Avatar src={member.avatarUrl} name={member.name} size={44} />
    <strong>{member.name}</strong>
    <span class="member__role">{member.role}</span>
    <span class="member__go" lang="en">
      Profile →
    </span>
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
*/
export const ScreenPager = ({
  prev,
  prevSection,
  next,
  nextSection,
  section,
  index,
  total,
}: {
  prev: string | null
  prevSection: string | null
  next: string | null
  nextSection: string | null
  section: string | null
  index: number
  total: number
}) => {
  /*
    読み上げに渡す言い方。節の名前があるときは「Projects の 4 画面のうち 2 画面目」、
    無いとき（Hero・ひとこと）は画面が1枚しかないので位置を言わない。
  */
  const spoken = section
    ? total > 1
      ? `${section} の ${total} 画面のうち ${index} 画面目`
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

// URL の形は呼ぶ側（renderBlock）で isSafeUrl を通してある
export const LinkList = ({ rows }: { rows: string[][] }) => (
  <ul class="linklist">
    {rows.map(([label, url, note]) => (
      <li key={url}>
        <a href={url} rel="noreferrer" target={url?.startsWith('/') ? undefined : '_blank'}>
          <span class="linklist__label">{label}</span>
          {note ? <span class="linklist__note">{note}</span> : null}
          <span class="linklist__go">↗</span>
        </a>
      </li>
    ))}
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
