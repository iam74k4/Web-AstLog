import type { Child } from 'hono/jsx'
import type { Item, Member, Platform } from '../db/schema'
import { initials } from '../lib/format'
import { MarkIcon } from './icons'

/*
  画面はこの部品だけで組む。新しい見た目が要るときは、まずここに足してから使う。
  ここに無い形をその場で書くと、同じものが少しずつ違う姿で増える。
*/

export const Brand = ({ size = 'md', href = '/' }: { size?: 'sm' | 'md'; href?: string }) => (
  <a class={`brand brand--${size}`} href={href}>
    <MarkIcon size={size === 'sm' ? 17 : 27} />
    <span class="brand__word">NOCTIFEX</span>
  </a>
)

export const Avatar = ({
  src,
  name,
  size = 72,
}: {
  src?: string | null
  name: string
  size?: number
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
  id,
  title,
  note,
  h1,
}: {
  id?: string
  title: string
  note?: string
  h1?: boolean
}) => (
  <div class="head">
    {h1 ? <h1 id={id}>{title}</h1> : <h2 id={id}>{title}</h2>}
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
*/
export const Screen = ({
  id,
  label,
  whole,
  children,
}: {
  id?: string
  label?: string
  whole?: boolean
  children: Child
}) => (
  <section
    id={id}
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
  色も変わる**。焼き込んでいたころは、(a) 紫が固定されてアクセント5色のうち
  3色と喧嘩し、(b) 光と形を別々に動かせないのでリード文が明るい縁に載って
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
*/
export const MoonField = () => (
  <div class="moon" aria-hidden="true">
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
      Profile ↗
    </span>
  </a>
)

export const MemberCardCompact = ({ member }: { member: Member }) => (
  <a class="member member--compact" href={`/members/${member.slug}`}>
    <Avatar src={member.avatarUrl} name={member.name} size={44} />
    <strong>{member.name}</strong>
    <span class="member__role">{member.role}</span>
    <span class="member__go" lang="en">
      Profile ↗
    </span>
  </a>
)

/*
  一覧への帯。件数を添えて、めくる前に「ここに何件あるか」を見せる。

  使うのは2か所——トップの入口（Hero の画面）と、個人ページの1枚目。どちらも
  「作品そのものは別の URL にある」画面なので、そこに何があるかを数で示して
  から送り出す。行き先は呼ぶ側が決める（項目のある側へ送ること。0件の側へ
  送ると、0件の知らせだけの画面に着く）。
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
      <span class="band__meta">
        Apps {app} · Works {work}
      </span>
    </span>
    <span class="band__go">一覧で見る →</span>
  </a>
)

/*
  いま効いている絞り込み。プラットフォーム（Apps だけ）とメンバー（Apps と
  Works の両方）の2軸で、効いていない軸は null。
*/
export type ItemFilter = { platform: string | null; member: string | null }

/*
  絞り込みを URL の query にする。付けるのは効いている軸だけ。

  絞り込みは画面をまたいで効くので、ピルだけでなく、めくる先（ページャ）と
  目次の行き先にも同じものを付ける。付け忘れると、次の画面へ移った瞬間に
  絞り込みだけが静かに外れる。
*/
export const filterQuery = (filter: ItemFilter) => {
  const params = new URLSearchParams()
  if (filter.platform) params.set('platform', filter.platform)
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
*/
export const FilterLinks = ({
  base,
  platforms,
  members,
  filter,
}: {
  base: string
  platforms: Platform[]
  members: { slug: string; name: string }[]
  filter: ItemFilter
}) => {
  const href = (next: ItemFilter) => `${base}${filterQuery(next)}`
  return (
    <nav class="filters" aria-label="一覧を絞り込む">
      <a
        href={href({ platform: null, member: null })}
        aria-current={!filter.platform && !filter.member ? 'true' : undefined}
      >
        すべて
      </a>
      {platforms.map((platform) => {
        const on = filter.platform === platform.key
        return (
          <a
            key={platform.key}
            href={href({ platform: on ? null : platform.key, member: filter.member })}
            aria-current={on ? 'true' : undefined}
          >
            {platform.label}
          </a>
        )
      })}
      {/* 1人しか居ないサイトで名前のピルを1つ置いても、絞り込む先が無い */}
      {members.length > 1
        ? members.map((member) => {
            const on = filter.member === member.slug
            return (
              <a
                key={member.slug}
                href={href({ platform: filter.platform, member: on ? null : member.slug })}
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

  通し番号はサーバーが数えて渡す。CSS の counter で数えると、印刷にも
  読み上げにも数が出ず、「いま何枚目か」だけが落ちる。

  端（最初と最後）ではリンクそのものを出さない。押しても何も起きない
  リンクを置くと、キーボードで送る手が1回空振りする。ますだけは残すので、
  めくっても真ん中の数字が左右に動かない。
*/
export const ScreenPager = ({
  prev,
  next,
  index,
  total,
}: {
  prev: string | null
  next: string | null
  index: number
  total: number
}) => {
  const pad = (n: number) => String(n).padStart(2, '0')
  return (
    <nav class="pager" aria-label="画面の移動">
      {prev ? (
        <a class="pager__go" href={prev} rel="prev">
          ← 前
        </a>
      ) : (
        <span class="pager__end" />
      )}
      <span class="pager__count">
        <span class="sr-only">{`${total} 画面のうち ${index} 画面目`}</span>
        <span aria-hidden="true">
          {pad(index)} · {pad(total)}
        </span>
      </span>
      {next ? (
        <a class="pager__go pager__go--next" href={next} rel="next">
          次 →
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
