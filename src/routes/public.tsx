import { drizzle } from 'drizzle-orm/d1'
import type { Context } from 'hono'
import { Hono } from 'hono'
import { getCookie } from 'hono/cookie'
import type { Child } from 'hono/jsx'
import {
  type BlockKey,
  blockLines,
  blockPerScreen,
  blockTexts,
  blockType,
  blockVisibleParts,
  MEMBER_PER_SCREEN,
} from '../blocks'
import {
  countMemberItems,
  countPublishedItems,
  type Db,
  findPublishedItem,
  findPublishedMember,
  type ItemScope,
  listPlatforms,
  listPublishedItems,
  listPublishedMembers,
  loadTheme,
  publishedBlocks,
  usedPlatforms,
} from '../db/queries'
import * as schema from '../db/schema'
import type { AppEnv } from '../env'
import { getSessionUser, SESSION_COOKIE } from '../lib/auth'
import { isSafeRedirect, paragraphs, parseLines, parseSkills } from '../lib/format'
import { chunk, screenCount } from '../lib/paginate'
import { type NavLink, type Sequence, type Step, sequence, stepAt } from '../lib/sequence'
import { SITE } from '../site'
import type { Theme } from '../theme'
import {
  Avatar,
  Band,
  Brand,
  Empty,
  FilterLinks,
  filterQuery,
  Hero,
  ItemCard,
  type ItemFilter,
  type ItemView,
  itemHref,
  LinkList,
  MemberCardCompact,
  MemberCardWide,
  MoonField,
  Note,
  NowList,
  Numbers,
  Phrases,
  Screen,
  ScreenPager,
  ScreenSection,
  SectionHead,
  Statement,
  Tags,
  Timeline,
} from '../ui/components'
import { GithubIcon, MailIcon } from '../ui/icons'
import { Layout, type NavItem } from '../ui/Layout'

export const publicRoutes = new Hono<AppEnv>()

const Socials = ({ github, email }: { github?: string | null; email?: string | null }) => (
  <div class="socials">
    {github ? (
      <a href={github} rel="me noreferrer" target="_blank">
        <GithubIcon /> GitHub
      </a>
    ) : null}
    {email ? (
      <a href={`mailto:${email}`}>
        <MailIcon /> Mail
      </a>
    ) : null}
  </div>
)

/*
  連絡先の画面。連なりの最後の1枚で、入口と対になる締め。

  画面に出すのは月とボタン2つ（メール・GitHub）だけ。字は置かない——
  見出しもリード文もアドレスも、この画面では月の下で言葉を重ねるだけだった。
  月を右上に、ボタンを画面の下に寄せる（入口と同じ組み方）。月は入口の
  三日月を左右に返し、ひとまわり小さく置く（MoonField の closing）。

  **見出しは読み上げのためにだけ置く**（.sr-only の h1「Contact」）。割られた
  画面はどれも h1 をちょうど1つ持つ決まり（WCAG 1.3.1）で、見出しの無い画面は
  見出しで移動する人にとって「何も無い」画面になる。全体ページ（/all）では
  ほかの節と同じ見出し（SectionHead）を目に見える形で置き、アドレスも字で
  残す——あそこは印刷の宛先で、紙の上ではボタンの行き先が読めない。

  メールは「送る」操作なので塗りのピル、GitHub は外へ出る脇の道なので柱と
  同じ .socials。同じ行き先を2つ置かない。

  GitHub のプロフィールはここに常設する。柱の .socials は 899 以下で畳んで
  あり（横帯に入らない）、プロフィールへの道はそこ1本しか無かった——つまり
  スマホで開いた人には、このサイトの一次動線が外枠の都合で消えていた
  （WCAG 1.4.10 の「機能の損失」）。

  split は「割られた画面（1画面 = 1ドキュメント）か」。見出しが h1 に上がるのも、
  弁のための tabindex が付くのも同じ条件なので、2つの旗を持たせない。

  moon は締めの月を敷くか。サイトの連なりの Contact（入口に月がある）だけが
  立てる。個人ページの Contact には敷かない——あちらの1枚目には月が無いので、
  締めだけに月を置くと「対」にならない。全体ページ（/all）にも敷かない
  （入口と同じ理由。印刷・Ctrl-F・翻訳の宛先）ので、split が偽なら立っていても
  敷かない。
*/
const Contact = ({
  email,
  github,
  split,
  moon,
}: {
  email: string
  github?: string | null
  split?: boolean
  moon?: boolean
}) => (
  <Screen id="contact" label="Contact" whole={!split} moonlit={split && moon}>
    {split && moon ? <MoonField closing /> : null}
    {/*
      全体ページの見出しは節の直下に置く（ほかの節と同じ位置）。.contact の中に
      入れると、左寄せの縦積みに縮められて下線が「Contact」の字幅で切れる。
      読み上げ用の h1 は .contact の中——節の直下に置くと、月の受け皿の
      「中身を月より前に出す」規則（position: relative）に .sr-only の
      position: absolute が負けて、1px の段が1つ増える
    */}
    {split ? null : <SectionHead title="Contact" />}
    <div class="contact">
      {split ? <h1 class="sr-only">Contact</h1> : null}
      <div class="contact__actions">
        <a class="pill-cta" href={`mailto:${email}`}>
          <MailIcon /> メールを送る →
        </a>
        <Socials github={github} />
      </div>
      {split ? null : <p class="contact__address">{email}</p>}
    </div>
  </Screen>
)

/*
  公開中のメンバーがちょうど1人なら、サイトはその人のもの。

  1人か器かを人数だけで決める。Team の横長/グリッドや、絞り込みに名前の
  ピルを出すかどうかと同じ数え方なので、2人目を公開した日に自動で器へ戻る
  （文言 src/site.ts だけは手で複数形に書き直す）。
*/
const soloMember = (members: schema.Member[]) => (members.length === 1 ? members[0] : undefined)

/*
  サイト全体の名乗り。1人なら Person、0人・2人以上なら器としての Organization。

  Organization で名乗ると、人の名前も職種も構造化データに1つも出ない。
  採る側は「誰を採るのか」を探しに来ているので、実体が1人のあいだは
  その人として名乗る。
*/
/*
  JSON-LD の Person。name / jobTitle / url の3つが本体。

  同じ形が3か所に手で書いてあった——1人のときのサイト自身、器の中の
  member[]、個人ページ。CLAUDE.md は肩書きが「Team のカード・<title>・
  description・JSON-LD の jobTitle に残る」と4か所を守らせているのに、
  その JSON-LD 側がさらに3つに割れていた。

  **url は既定値を置かず、呼ぶ側が毎回書く。** 1人のときだけ SITE.origin
  （その人がサイト本体）、それ以外は /members/<slug>。これは「1人なら器は
  要らない」という設計の要点そのものなので、既定に隠すと取り違えても
  気づけない。

  extra は description / sameAs / worksFor。渡さなければキーごと出ない
  （空の配列を名乗らない）。
*/
const personJsonLd = (
  member: Pick<schema.Member, 'name' | 'role'>,
  url: string,
  extra?: Record<string, unknown>,
) => ({
  '@type': 'Person' as const,
  name: member.name,
  jobTitle: member.role,
  url,
  ...extra,
})

const siteJsonLd = (members: schema.Member[]) => {
  const solo = soloMember(members)
  if (solo) {
    return {
      '@context': 'https://schema.org',
      ...personJsonLd(solo, SITE.origin, {
        description: SITE.heroLead,
        sameAs: [solo.github ?? SITE.github],
      }),
    }
  }
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: SITE.name,
    url: SITE.origin,
    description: SITE.heroLead,
    sameAs: [SITE.github],
    member: members.map((member) => personJsonLd(member, `${SITE.origin}/members/${member.slug}`)),
  }
}

/*
  入口の題と説明。1人なら名前と職種を載せる。

  ここが「Noctifex — Apps & Works」だけだと、共有リンクのカードにも検索の
  スニペットにも、誰のサイトなのかが1文字も出ない。画面に出ている名乗りと
  同じものを head にも置く。
*/
const siteTitle = (solo?: schema.Member) =>
  solo ? `${solo.name}（${solo.role}） — ${SITE.name}` : `${SITE.name} — Apps & Works`

const siteDescription = (solo?: schema.Member) =>
  solo ? `${solo.name}（${solo.role}）のポートフォリオ。${SITE.heroLead}` : SITE.heroLead

/*
  画面ごとの説明文（<meta name="description"> と og:description）。

  画面を分ける前は1つのページに全部あったので、サイトの説明が1つで足りた。
  分けたあとも同じ1文を12 URL に配ったままで、検索結果にも貼られたカードにも
  「どの画面か」が1文字も出ない——中身の薄い準重複ドキュメントが並ぶ形になる。
  どれを開けばよいかを決めるのは読む側なので、決める材料をこちらが持っている。

  作るのは「その画面に実際に出ている文字」から。数と名前を並べ替えるだけなので、
  中身を足した日に説明文だけ古くなることが無い（固定の文を書くと必ずそうなる）。
  割った2画面目には2画面目に出ているものが入るので、/apps と /apps/2 も
  同じ文にならない。
*/
// 検索結果は日本語なら 110 字あたりで切られる。どこで切れるかはこちらで決める
const DESCRIPTION_MAX = 110

// 中身の無い節を落として「。」でつなぐ。0件の画面で「。。」を残さないため
const joinParts = (...parts: string[]) => parts.filter((part) => part !== '').join('。')

const describe = (text: string) => {
  // 打ち込んだ中身には改行が入る。1行に畳んでから数える
  const one = text.replace(/\s+/g, ' ').trim()
  const letters = [...one]
  return letters.length > DESCRIPTION_MAX
    ? `${letters.slice(0, DESCRIPTION_MAX - 1).join('')}…`
    : one
}

/*
  1行1件のものを説明文に畳む。リンク集の URL（2列目）は落とす——href で
  あって本文には出ないので、字数の検査（admin.tsx の screenChars）と
  同じ数え方にそろえる。
*/
const lineDigest = (key: BlockKey, rows: string[][]) =>
  rows.map((parts) => blockVisibleParts(key, parts).join(' ')).join('、')

/*
  カードの実績値（.metric）を説明文に畳む。値・単位・添えの順は、カードに
  出ている順そのもの。並べ替えると、書いた人の数字がこちらの都合で別の意味に
  なる（「見込み 40人日 → 実績」は 20 の添えであって、20 の言い換えではない）。
*/
const metricDigest = (item: ItemView) =>
  item.metricValue
    ? `（${[item.metricValue, item.metricUnit, item.metricNote].filter(Boolean).join(' ')}）`
    : ''

/*
  サイトの柱（名札）。どの画面にも出るので、ここに載せたものは全画面に載る。

  名前は載せない。名乗るのは入口の大見出し（Hero の h1）で、柱にも置くと
  入口では同じ名前が上と下に2度並ぶ。899 以下では柱が上の帯に畳まれるので、
  ロゴのすぐ隣に名前が来て、見出しの前置きのように重なっていた。
  名前は入口の <title>・description と JSON-LD にも残る。

  職種は残す。.identity__role は個人ページの名札と同じ部品で、
  新しい見た目は足していない。
*/
const SiteIdentity = ({ solo }: { solo?: schema.Member }) => (
  <div class="identity">
    <Brand />
    {solo?.role ? <span class="identity__role">{solo.role}</span> : null}
    <span class="identity__tagline">{SITE.tagline}</span>
    <Socials github={SITE.github} email={SITE.email} />
  </div>
)

/*
  管理画面への入口（柱の AdminLink）の行き先。ログインしている人にだけ返し、
  訪問者には undefined——柱は今までと同じ姿のまま。

  クッキーが無ければ D1 には聞きに行かない。訪問者のリクエストは1本も
  増えない。ログインしている人に返すページは、共有のキャッシュに置かせない
  （private）。置かれると、次に来た訪問者に管理画面への入口が出る。
*/
async function adminHref(c: Context<AppEnv>, to: string): Promise<string | undefined> {
  const sessionId = getCookie(c, SESSION_COOKIE)
  if (!sessionId) return undefined
  const user = await getSessionUser(drizzle(c.env.DB, { schema }), sessionId)
  if (!user) return undefined
  c.header('cache-control', 'private, no-store')
  return to
}

/*
  サイトの画面から、その中身を直す管理画面へ。

  打ち込むブロックはその編集画面。決まった中身のブロックは、中身の出どころへ
  ——Apps / Works は項目の一覧、Team はメンバーの一覧、入口の名前と職種は
  メンバー（1人のサイトならその人の編集）。Contact と入口のリード文は
  src/site.ts にあって管理画面からは変えられないので、「構成」のその行へ送る。
*/
const blockAdminPath = (block: schema.Block, solo?: schema.Member) => {
  switch (block.type) {
    case 'apps':
      return '/admin/items?type=app'
    case 'works':
      return '/admin/items?type=work'
    case 'team':
      return '/admin/members'
    case 'hero':
      return solo ? `/admin/members/${solo.id}/edit` : '/admin/members'
    case 'contact':
      // 既定の並び（まだ構成を保存していない）では id が 0 で、指す行が無い
      return block.id ? `/admin/blocks#block-${block.id}` : '/admin/blocks'
    default:
      return `/admin/blocks/${block.id}/edit`
  }
}

/*
  一覧への帯（行き先と件数）。

  項目のある側へ送ること。Apps が0件の人を /apps へ送ると、0件の知らせ
  だけの画面に着く。その節を置いていないサイトでは、そもそもその URL が
  無い（404）ので、置いてあるかどうかも見る。

  件数も、置いてある節のぶんだけ数える。Works を外したサイトで「Works 3」と
  出すと、どこを探しても見つからない3件になる。送る先が無ければ null
  （帯ごと出さない）。
*/
const bandOf = (blocks: schema.Block[], app: number, work: number, query = '') => {
  const placed = (key: string) => blocks.some((block) => block.type === key)
  const counts = { app: placed('apps') ? app : 0, work: placed('works') ? work : 0 }
  const href = counts.app > 0 ? `/apps${query}` : counts.work > 0 ? `/works${query}` : null
  return href ? { href, ...counts } : null
}

/*
  カードに担当者の名前（個人ページへのリンク）を出すか。

  2人以上いるときは出す。1人のサイトで全部のカードに同じ名前を並べても
  何も見分けられないので、ふだんは出さない。ただし Team の節を置いていない
  ときは人数に関わらず出す——トップから個人ページへ行く道が、カードの
  名前のほかに1本も無くなる。作品1件のページの「担当」も同じ条件。
*/
const showMemberOf = (blocks: schema.Block[], members: schema.Member[]) =>
  members.length > 1 || !blocks.some((block) => block.type === 'team')

/*
  一覧1つぶん。全件をメモリに載せず、画面を組むのに要る数と、いま描く画面の
  行だけを持つ。

  total は絞り込みを外したときの件数で、節を出すかどうかを決める。
  matched は絞り込んだあとの件数で、画面が何枚になるかを決める。
  Apps は matched が0でも節を出す（ピルを残して1行だけ出す）ので、2つに
  分けて持つ。Works にはピルが無く、0件なら節ごと消えるので、
  Works の total には絞り込んだあとの件数が入る。
*/
type ItemSlice = {
  total: number
  matched: number
  // いま描く画面に出す行だけ。画面の数を数えるためだけに呼ぶときは空
  rows: ItemView[]
}

type TopData = {
  members: schema.Member[]
  apps: ItemSlice
  works: ItemSlice
  // ピルに並べるぶん（公開中の Apps に実在するものだけ）
  platforms: schema.Platform[]
  filter: ItemFilter
  // カードに担当者を出すか（showMemberOf）
  showMember: boolean
  /*
    入口（Hero の画面）に置く一覧への帯。行き先と件数は呼ぶ側が決める——
    どの節を置いてあるかは、ブロックの並びを持っている側にしか分からない。

    件数は絞り込みを見ないサイト全体の数。入口で見せたいのは「ここに何件
    あるか」であって「いま絞り込んだ結果が何件か」ではない。全体ページ
    （/all）では null——全部が同じ文書に並ぶので、送り出す先が無い。
  */
  band: { href: string; app: number; work: number } | null
}

// 一覧を持つブロックだけ、DB から行を引く
const itemTypeOf = (key: string): 'app' | 'work' | null =>
  key === 'apps' ? 'app' : key === 'works' ? 'work' : null

/*
  ブロック1つを描いた結果。

  id は DOM のアンカー（#apps）、slug は URL の1語（/apps）。同じ文字列を
  わざと2つ持たせてある。全体ページは id で、画面ごとの URL は slug で同じ
  節を指すので、どちらか片方だけを変えたくなったときに変える先が見える。

  pages はこのブロックが何画面になるか。1画面あたりの件数は src/blocks.ts の
  perScreen が正で、割るのは src/lib/paginate.ts。

  description はこの画面の説明文（<head> に載る）。中身を持っているここで
  作る——呼ぶ側はブロックの中を知らないので、ここで作らないと「サイトの説明」
  しか書けない。
*/
type Rendered = {
  id: string
  slug: string
  pages: number
  nav: string | null
  description: string
  node: Child
}

/*
  一覧を1画面ぶんに切る。page が null なら切らない（全体ページ用）。

  範囲の外を指されたら null。呼ぶ側はそれをそのまま「この URL は無い」に
  変える。中身の無いブロックに URL が無いのと同じ扱いにするため。
*/
function screenOf<T>(rows: T[], perScreen: number, page: number | null) {
  const pages = screenCount(rows.length, perScreen)
  if (page === null) return { rows, pages }
  const one = chunk(rows, perScreen)[page - 1]
  return one ? { rows: one, pages } : null
}

/*
  ブロック1つを節に描く。中身が無ければ null を返し、節ごと出さない
  （見出しだけ残さない）。

  決まった中身のもの（apps・team …）は id を type と同じにして、
  #apps のようなアンカーと /apps という URL の1語を保つ。
  打ち込むものは block-<id>。

  page は「このブロックの何画面目か」（1始まり）。null なら割らずに全件を出す
  ——全体ページ（/all）はこちら。

  Apps / Works の行は、呼ぶ側が limit / offset で切って渡す（ここでは切らない）。
  画面の枚数を数えるためだけに呼ぶとき（screenList）は行が空で、描いた節は
  そのまま捨てられる。枚数と中身を同じ関数から出す形は変えないこと——別々に
  数えると、いつか「節は出ないのに URL だけある」画面ができる。
*/
/*
  「1行1件」を並べる4つの、列の描き方。ここだけが種類ごとに違う。

  表で持つのは、renderBlock の分岐を1本にするため——行の開き方も画面への
  割り方も同じものが4本に写っていて、割り方を直すたびに4回直す必要があった。
*/
const ROW_LISTS = {
  now: NowList,
  numbers: Numbers,
  links: LinkList,
  timeline: Timeline,
} as const

function renderBlock(block: schema.Block, data: TopData, page: number | null): Rendered | null {
  const type = blockType(block.type)
  if (!type) return null
  const { members, apps, works, platforms, filter, showMember, band } = data
  const id = type.kind === 'fixed' ? type.key : `block-${block.id}`
  // 見出しが空なら、フォームの初期値と同じ名前（それも無ければ種類の名前）
  const title = block.title || ('title' in type && type.title) || type.label
  // 画面まるごとのブロック（hero・contact・ひとこと）は perScreen を持たない
  const perScreen = blockPerScreen(type.key)
  // その画面まるごとのブロックに、2画面目は無い
  const once = page === null || page === 1
  /*
    割られた画面（1画面 = 1ドキュメント）かどうか。節の見出しはここで h1 に
    上がる。全体ページ（/all）だけが page === null で、そちらは今までどおり
    Hero の h1 に節が h2 でぶら下がる、1つの文書のままでよい。
  */
  const split = page !== null

  switch (block.type) {
    case 'hero': {
      if (!once) return null
      const solo = soloMember(members)
      return {
        id,
        slug: id,
        pages: 1,
        nav: null,
        // 入口はサイトそのものの画面。名乗りと同じ文をそのまま出す
        description: describe(siteDescription(solo)),
        node: (
          <>
            <Hero whole={!split}>
              {/*
                背景の月は割られた画面にだけ敷く。全体ページ（/all）に出さないのは、
                あそこが印刷と Ctrl-F と翻訳の宛先だから——紙に淡い装飾を刷らせない。

                Hero 部品ではなくここに置くのが要。Hero も .hero クラスも個人ページの
                名乗りと共有していて（下の renderMemberScreen）、あちらに埋めると
                メンバー全員のページに月が出る。ブロック単位で確実に分けられるのは
                この case の中だけ。
              */}
              {split ? <MoonField /> : null}
              {/*
                名乗り。1人のサイトならその人の名前と肩書き、そうでなければ
                サイトの名前だけ。

                標語は置かない。「つくったものを、置いておく。」を大見出しにして
                いたころは、何も伝えないまま画面でいちばん大きな字になっていた。
                採る側が探しに来るのは人の名前と職種なので、それをそのまま出す。
                肩書きは名前の上に小さく添える札で、899 以下で柱から畳まれる
                肩書きも、入口ではここで読める。
              */}
              {solo?.role ? <p class="hero__role">{solo.role}</p> : null}
              <h1>
                <Phrases text={solo?.name ?? SITE.name} />
              </h1>
              <p>
                <Phrases text={SITE.heroLead} />
              </p>
              {/*
                入口に置く一覧への帯。個人ページの1枚目と同じ形で、同じ理由で
                置く——この画面には作品が1件も無いので、何件あるかを数で見せて
                から送り出す。帯は id も名前も持たない（目次からもページャからも
                指さないので、指すための名前が要らない）
              */}
              {band ? (
                <Band href={band.href} label="つくったものの一覧" app={band.app} work={band.work} />
              ) : null}
            </Hero>
          </>
        ),
      }
    }

    case 'apps': {
      // 公開中の app が1件も無ければ節ごと出さない。絞り込んで0件になっただけの
      // ときは出す——ピルごと消えると、絞り込みを外す手が画面から無くなる
      if (!apps.total) return null
      const pages = Math.max(1, screenCount(apps.matched, perScreen))
      if (page !== null && page > pages) return null
      return {
        id,
        slug: id,
        pages,
        nav: 'Apps',
        /*
          件数とプラットフォームは、この画面に出ている絞り込みのピルそのもの。
          そのあとに、いまの画面に載っているカードの名前を並べる——ここが
          画面ごとに変わるので、/apps と /apps/2 が同じ説明にならない
        */
        description: describe(
          joinParts(
            `個人開発 ${apps.total} 件`,
            platforms.map((row) => row.label).join(' / '),
            apps.rows.map((row) => row.title).join('、'),
          ),
        ),
        node: (
          <ScreenSection
            id={id}
            label="Apps"
            whole={!split}
            head={
              <>
                <SectionHead title="Apps" note="個人開発" h1={split} />
                {/* 行き先はこのブロックの1画面目。いま何画面目に居ても同じ */}
                <FilterLinks
                  base={`/${id}`}
                  platforms={platforms}
                  members={members.map((member) => ({ slug: member.slug, name: member.name }))}
                  filter={filter}
                />
              </>
            }
          >
            {apps.matched ? (
              /*
                列の数は1画面ぶんの件数そのもの。CSS は repeat(var(--cols), …)
                と書くだけで数を持たない（app.css の「600px 以上」）。perScreen を
                変えれば列も一緒に変わるので、件数と見た目が二重にならない
              */
              <div class="grid" style={`--cols:${perScreen}`}>
                {apps.rows.map((item) => (
                  <ItemCard key={item.id} item={item} showMember={showMember} />
                ))}
              </div>
            ) : (
              <p class="filter-empty">この条件に当てはまるものはまだありません</p>
            )}
          </ScreenSection>
        ),
      }
    }

    case 'works': {
      // Works にはピルが無い。絞り込んで0件になったら節ごと消す——0件の知らせ
      // だけが残っても、そこから絞り込みを外す手が無い（total は絞り込み後の件数）
      if (!works.total) return null
      const pages = screenCount(works.matched, perScreen)
      if (page !== null && page > pages) return null
      return {
        id,
        slug: id,
        pages,
        nav: 'Works',
        /*
          実績値まで入れる。このサイトでいちばん強い一文（見込み 40人日 →
          実績 20人日）はカードの .metric にしか無く、検索結果にも貼られた
          カードにも1文字も出ていなかった。並べる順はカードの並び順そのまま
          （値・単位・添え）にする——言い換えると、書いた人の数字が
          こちらの都合で別の意味になる。
        */
        description: describe(
          joinParts(
            `業務での開発 ${works.total} 件`,
            works.rows.map((row) => `${row.title}${metricDigest(row)}`).join('、'),
          ),
        ),
        node: (
          <Screen id={id} label="Works" whole={!split}>
            <SectionHead title="Works" note="業務" h1={split} />
            <div class="grid" style={`--cols:${perScreen}`}>
              {works.rows.map((item) => (
                <ItemCard key={item.id} item={item} showMember={showMember} />
              ))}
            </div>
          </Screen>
        ),
      }
    }

    case 'team': {
      if (!members.length) return null
      const screen = screenOf(members, perScreen, page)
      if (!screen) return null
      return {
        id,
        slug: id,
        pages: screen.pages,
        nav: 'Team',
        // 人数は数えない（「1 member」をやめたのと同じ理由）。名前と職種を並べる
        description: describe(
          joinParts(
            'メンバー',
            screen.rows
              .map((member) => (member.role ? `${member.name}（${member.role}）` : member.name))
              .join('、'),
          ),
        ),
        node: (
          <Screen id={id} label="Team" whole={!split}>
            {/*
              添えは分類の名詞ひとつ（個人開発 / 業務 / 紹介 …と同じ）。
              「1 member」と人数を数えて出すのはやめた。複数いる前提の器に
              1人しか入っていないことを、自分で数えて告知していた
            */}
            <SectionHead title="Team" note="メンバー" h1={split} />
            {/*
              1〜2人なら横長、3人以上でグリッド。人数で決める、画面幅では決めない。
              数えるのは総人数で、この画面に載っている人数ではない——7人を2画面に
              割った2画面目が1人だからといって横長に化けると、めくるたびに形が変わる
            */}
            {members.length <= 2 ? (
              <div class="team-list">
                {screen.rows.map((member) => (
                  <MemberCardWide key={member.id} member={member} />
                ))}
              </div>
            ) : (
              <div class="team-grid">
                {screen.rows.map((member) => (
                  <MemberCardCompact key={member.id} member={member} />
                ))}
              </div>
            )}
          </Screen>
        ),
      }
    }

    case 'contact':
      if (!once) return null
      return {
        id,
        slug: id,
        pages: 1,
        nav: 'Contact',
        description: describe(SITE.contactLead),
        node: (
          <Contact
            email={SITE.email}
            github={SITE.github}
            split={split}
            // サイトの連なりの締め。入口の月と対になる月を敷く
            moon
          />
        ),
      }

    // ここから打ち込むもの。目次に載せるのは見出しを持つものだけ

    case 'statement': {
      if (!block.title) return null
      if (!once) return null
      return {
        id,
        slug: id,
        pages: 1,
        nav: null,
        // 大きく出る一文が、この画面の全部。説明文もそれと添え書きで足りる
        description: describe(joinParts(block.title, blockTexts(block.body).join(' '))),
        node: (
          // 見出しを持たない画面なので region の名前も無い（その一文が見出しそのもの）
          <Screen id={id} whole={!split}>
            <Statement text={block.title} notes={blockTexts(block.body)} h1={split} />
          </Screen>
        ),
      }
    }

    /*
      ここから下は body を1行1件（メモだけは段落）で持つもの。行の開き方は
      src/blocks.ts の blockLines / blockTexts が正——管理画面の「N 画面」も
      同じ式を読む。ここで直接 parseLines を書くと、公開側だけ落とす行が
      できた日に、管理画面の数だけが静かに古いままになる。
    */

    /*
      行を並べるだけの4つ。違うのは**列の描き方1つ**（NowList / Numbers /
      LinkList / Timeline）で、行の開き方・画面への割り方・見出し・説明文・
      目次の名前はどれも同じだった。4本に写してあったころは、画面の割り方を
      直すのに同じ直しを4回する必要があり、1つ忘れれば**その節だけ**が
      古い割り方のまま残る（見た目では分からない）。

      ここに `default` を置かないのは、ブロックの種類を足したときに TS2366 で
      落ちてほしいから（CLAUDE.md「ブロックの種類を増やす」）。列挙を1か所に
      まとめても、その性質は変わらない。
    */
    case 'now':
    case 'numbers':
    case 'links':
    case 'timeline': {
      const rows = blockLines(type.key, block.body)
      if (!rows.length) return null
      const screen = screenOf(rows, perScreen, page)
      if (!screen) return null
      const List = ROW_LISTS[block.type]
      return {
        id,
        slug: id,
        pages: screen.pages,
        nav: title,
        description: describe(joinParts(title, lineDigest(type.key, screen.rows))),
        node: (
          <Screen id={id} label={title} whole={!split}>
            <SectionHead title={title} h1={split} />
            <List rows={screen.rows} />
          </Screen>
        ),
      }
    }

    case 'note': {
      const texts = blockTexts(block.body)
      if (!texts.length) return null
      const screen = screenOf(texts, perScreen, page)
      if (!screen) return null
      return {
        id,
        slug: id,
        pages: screen.pages,
        nav: block.title || null,
        // 段落そのもの。見出しを持たないメモは本文だけで説明になる
        description: describe(joinParts(block.title, screen.rows.join(' '))),
        node: (
          <Screen id={id} label={block.title || undefined} whole={!split}>
            {block.title ? <SectionHead title={block.title} h1={split} /> : null}
            <Note paragraphs={screen.rows} />
          </Screen>
        ),
      }
    }
  }
}

/*
  公開ブロックを1つのドキュメントに縦に積んだ「全体ページ」の描画。

  画面ごとの URL に分けたあとも、この1本だけは全部を1ページに載せたまま残す。
  印刷・Ctrl-F・ブラウザ翻訳の宛先、オーナーが全体を通しで点検する手段、
  そして画面ごとの組み立てが効かない環境での退避先を、これ1本でまかなう。
  だから縦に伸びてよい。画面に収める外枠はここには当てない。
*/
async function renderWholePage(c: Context<AppEnv>) {
  const db = drizzle(c.env.DB, { schema })
  const [members, apps, works, platforms, theme, blocks] = await Promise.all([
    listPublishedMembers(db),
    listPublishedItems(db, 'app'),
    listPublishedItems(db, 'work'),
    usedPlatforms(db, 'app'),
    loadTheme(db),
    publishedBlocks(db),
  ])

  /*
    このページだけは絞り込まない。全部を1ページに載せるのが役目なので、
    ?platform= も ?member= も読まない（ピルは画面ごとの URL へのリンクとして
    残る）。
  */
  const data: TopData = {
    members,
    platforms,
    filter: { platform: null, member: null },
    showMember: showMemberOf(blocks, members),
    apps: { total: apps.length, matched: apps.length, rows: apps },
    works: { total: works.length, matched: works.length, rows: works },
    // このページには一覧そのものがすぐ下に並ぶ。送り出す先が無いので帯は置かない
    band: null,
  }

  // 管理の「構成」で置いた順に描く。中身の無い節は落ちる。
  // page に null を渡すと、一覧を画面ぶんに割らずに全件出す（このページだけ）
  const sections = blocks
    .map((block) => renderBlock(block, data, null))
    .filter((section) => section !== null)
  const nav: NavItem[] = sections
    .filter((section) => section.nav !== null)
    .map((section) => ({ href: `#${section.id}`, label: section.nav ?? '' }))

  const solo = soloMember(members)

  return c.html(
    <Layout
      title={siteTitle(solo)}
      /*
        中身が全部ある唯一のページなので、説明文もそれを言う。並べるのは
        実際に描いた節の名前——固定の一覧を書くと、節を1つ外した日にここだけ
        古い名前を出し続ける
      */
      description={describe(
        joinParts(
          nav.length
            ? `${nav.map((item) => item.label).join(' · ')} を1ページにまとめた全体版です`
            : '',
          siteDescription(solo),
        ),
      )}
      /*
        正はこのページ自身。ここを / にしていたころは、中身が全部ある唯一の
        ページを「作品を1件も含まないトップの複製」として申告していた——
        index に載るのが中身の薄い準重複の画面ばかりで、載らないのが完全版、
        というちょうど逆の形になる。画面ごとの URL はそれぞれ自分を正と
        名乗っているので、こちらも自分を名乗る。
      */
      canonical={`${SITE.origin}/all`}
      jsonLd={siteJsonLd(members)}
      nav={nav}
      theme={theme}
      // 縦に伸びてよい唯一の公開ページ。app.css の「画面に収める外枠」を外す印
      whole
      sidebar={<SiteIdentity solo={solo} />}
      // 全部の節が並ぶページなので、節の並び（構成）へ送る
      admin={await adminHref(c, '/admin/blocks')}
    >
      {sections.map((section) => section.node)}
    </Layout>,
  )
}

/*
  画面1つ。管理の「構成」で置いた順に、ブロックを画面へほどいた列の1要素。

  通し番号（「07 · 23」の 07）はこの列の添字で、ブロック単位ではなく画面単位。
  だから Apps の最後の画面の「次」は、次のブロックの1画面目になる。目次に
  載らない画面（Hero・ひとこと）も列には並ぶので、めくれば必ずたどり着ける。
*/
type BlockScreen = {
  block: schema.Block
  slug: string
  nav: string | null
  page: number
}

function screenList(blocks: schema.Block[], data: TopData): BlockScreen[] {
  const screens: BlockScreen[] = []
  for (const block of blocks) {
    /*
      1画面目を描いて、そのブロックが何画面になるかを聞く。中身が無ければ
      null が返り、画面は1つも生まれない——未配置・下書き・0件のブロックに
      URL が無いのは、renderBlock の「節ごと出さない」がそのまま伸びた結果。
      画面の数え方をここで別に書くと、いつか節の有無とずれる。
    */
    const first = renderBlock(block, data, 1)
    if (!first) continue
    for (let page = 1; page <= first.pages; page += 1) {
      screens.push({ block, slug: first.slug, nav: first.nav, page })
    }
  }
  return screens
}

/*
  1画面目は /apps、2画面目からは /apps/2。同じ画面に URL を2つ作らない。

  query は絞り込み（?platform=… / ?member=…）。めくる先にも目次の行き先にも
  同じものを付ける。付けないと、次の画面へ移った瞬間に絞り込みだけが外れ、
  通し番号（07 · 23）だけが絞り込んだままの数で残る。
*/
const screenHref = (screen: { slug: string; page: number }, query = '') =>
  `/${screen.slug}${screen.page === 1 ? '' : `/${screen.page}`}${query}`

/*
  URL の絞り込みを読む。

  知らないプラットフォームの key も、公開中に居ないメンバーの slug も、
  絞り込みとして扱わない（絞り込まずに全件を出す）。ピルに並ばないもので
  絞り込むと、画面のどこにも印が出ず、外す手が無くなる。

  1人のサイトでは ?member= を読まない。名前のピルは2人以上いるときにしか
  並ばない（FilterLinks）ので、効かせると「すべて」にも名前にも印が付かない
  まま一覧だけが絞られる。
*/
function readFilter(c: Context<AppEnv>, platforms: schema.Platform[], members: schema.Member[]) {
  const platform = c.req.query('platform') ?? ''
  const member =
    members.length > 1 ? (members.find((row) => row.slug === c.req.query('member')) ?? null) : null
  const filter: ItemFilter = {
    platform: platforms.some((row) => row.key === platform) ? platform : null,
    member: member?.slug ?? null,
  }
  return { filter, memberId: member?.id ?? null }
}

/*
  その一覧に効く条件。

  プラットフォームは Apps だけの軸。Works は platform_key を持たない（区分で
  分ける）ので、そのまま渡すと Works が丸ごと0件になり、目次から節ごと消える。
  メンバーは両方に効く——個人ページから来た人に、Works だけ全員ぶんを見せない
  ため。
*/
const scopeOf = (type: 'app' | 'work', filter: ItemFilter, memberId: number | null): ItemScope => ({
  platformKey: type === 'app' ? filter.platform : null,
  memberId,
})

/*
  いま出す画面のぶんだけを引く。Apps / Works 以外の画面では1件も引かない
  ——その画面に一覧は無い。絞り込みが画面をまたいで効くのは、どの画面でも
  同じ絞り込みから条件を作っているから。
*/
async function screenRows(
  db: Db,
  screen: BlockScreen,
  filter: ItemFilter,
  memberId: number | null,
): Promise<ItemView[]> {
  const type = itemTypeOf(screen.block.type)
  const kind = blockType(screen.block.type)
  if (!type || !kind) return []
  const perScreen = blockPerScreen(kind.key)
  return listPublishedItems(db, type, {
    ...scopeOf(type, filter, memberId),
    limit: perScreen,
    offset: (screen.page - 1) * perScreen,
  })
}

/*
  連なりの1枚をページにする。トップも個人ページもここを通る。

  連ね方（添字・前後・目次・ページャ）は src/lib/sequence.ts が持つ。ここで
  やるのは、その結果を Layout に渡すことだけ。画面の列を作る側が違っても、
  題の付け方も canonical の出し方も名乗りを載せる場所も1つになる。
*/
async function screenPage(
  c: Context<AppEnv>,
  seq: Sequence,
  page: {
    node: Child
    description: string
    jsonLd?: unknown
    theme: Theme
    sidebar: Child
    // この画面の中身を直す管理画面（adminHref が、ログインしている人にだけ出す）
    adminPath: string
  },
) {
  return c.html(
    <Layout
      title={seq.current.title}
      description={page.description}
      canonical={`${SITE.origin}${seq.current.canonical}`}
      // 名乗りはこの連なりに1つあれば足りる。入口（先頭の画面）にだけ載せる
      jsonLd={seq.index === 0 ? page.jsonLd : undefined}
      nav={seq.nav}
      theme={page.theme}
      sidebar={page.sidebar}
      admin={await adminHref(c, page.adminPath)}
    >
      {/* 1画面しか無いなら、めくる先が無いのでページャは出さない */}
      {seq.pager ? (
        <>
          {page.node}
          <ScreenPager {...seq.pager} />
        </>
      ) : (
        page.node
      )}
    </Layout>,
  )
}

/*
  サイトの画面の列と、それを組むのに使った数。

  トップ（renderScreen）と作品1件のページ（renderItem）が同じものを読む。
  作品のページに出る目次は、トップの目次そのものでなければならない——別に
  組むと、節が1つ増えた日に片方だけ古い並びを出し続ける。

  ここで引くのは数だけ。カードそのものは、どの画面を出すかが決まってから
  1画面ぶんだけ引く。絞り込みが効いていないときは、絞り込み後の件数を
  数え直さない（同じ数になる）。
*/
async function siteScreens(
  db: Db,
  blocks: schema.Block[],
  members: schema.Member[],
  filter: ItemFilter,
  memberId: number | null,
): Promise<{ screens: BlockScreen[]; counted: TopData }> {
  const [pills, appTotal, appMatched, workTotal, workMatched] = await Promise.all([
    usedPlatforms(db, 'app'),
    countPublishedItems(db, 'app'),
    filter.platform || memberId
      ? countPublishedItems(db, 'app', scopeOf('app', filter, memberId))
      : null,
    /*
      入口の帯に出す、絞り込みを見ない Works の件数。works.total とは別に
      持つ——あちらには「絞り込んだあとの件数」が入っていて、0になったら
      Works の節ごと消すのに使っている。同じ名前で兼ねると、絞り込みで
      節を消す仕組みか、入口の数のどちらかが必ず狂う。
    */
    countPublishedItems(db, 'work'),
    /*
      絞り込んだあとの Works の件数。**memberId が無いときは引かない。**

      scopeOf は Works に platformKey を渡さない（type === 'app' のときだけ
      渡す）ので、Works に効く絞り込みは memberId だけ。?member= の付かない
      全リクエスト——トップ・各画面・/sitemap.xml・作品1件ページ——で、
      すぐ上と同じ SQL を2回投げていた。

      **このガードは「scopeOf が Works に platformKey を渡さない」ことに
      依存している。** Works に2つ目の絞り込み軸を足すなら、ここも一緒に
      直すこと。直さないと件数が全件に化ける。
    */
    memberId ? countPublishedItems(db, 'work', scopeOf('work', filter, memberId)) : null,
  ])

  const counted: TopData = {
    members,
    platforms: pills,
    filter,
    showMember: showMemberOf(blocks, members),
    apps: { total: appTotal, matched: appMatched ?? appTotal, rows: [] },
    works: { total: workMatched ?? workTotal, matched: workMatched ?? workTotal, rows: [] },
    band: bandOf(blocks, appTotal, workTotal),
  }

  return { screens: screenList(blocks, counted), counted }
}

/*
  ブロックをほどいた列を、連なりの1枚ずつに写す。

  目次に並ぶのは slug ごとに1行（sequence が同じ navKey の最初の1枚だけを
  採る）。だからブロックの2画面目以降でも、その見出しに印が残る。

  canonical: 先頭の画面は / と /<slug> の2つの URL で開けるので、正は / の
  ほうにそろえる（全体ページ /all と同じ扱い）。2つ目からは、その画面の URL
  が正。絞り込みは付けない——同じ中身の取り出し方なので、ピルの組み合わせの
  ぶんだけ URL が数えられると、どれが本体か分からなくなる。

  href も先頭だけは / に寄せる。ここが /<slug>（＝/hero）だったころ、
  ページャの「前」だけがそこを指していて、入口と**バイト単位で同一の URL** が
  リンクを辿れる場所に1つ増えていた。/hero を直接開いた人のために
  ルートは残してあるが（下の renderScreen で読み替える）、こちらから
  案内はしない。
*/
/*
  その画面に**効く絞り込みだけ**を残す。

  絞り込みを全画面に配っていたころ、Hero にも Contact にも ?platform= が
  付いて回っていた。中身は1文字も変わらないのに URL だけが増え、実測で
  20画面のサイトに対して辿れる URL が 58本あった（/hero?platform=macos、
  /contact?member=okazaki のたぐい）。

  どれが効くかは scopeOf が正——platform は Apps にしか渡らず（Works には
  必ず null）、member は Apps と Works の両方に渡る。ここはその写しなので、
  scopeOf を変えるときは一緒に直すこと。

  絞り込みが画面をまたいで残ること自体は意図どおり（test/public.test.ts の
  「絞り込みは、めくっても目次から移っても外れない」）。落とすのは、
  その画面では何の意味も持たない項目だけ。
*/
const stepQuery = (slug: string, filter: ItemFilter): string =>
  filterQuery({
    platform: slug === 'apps' ? filter.platform : null,
    member: slug === 'apps' || slug === 'works' ? filter.member : null,
  })

const siteSteps = (screens: BlockScreen[], filter: ItemFilter, solo?: schema.Member): Step[] =>
  screens.map((screen, position) => ({
    navKey: screen.slug,
    href:
      position === 0
        ? `/${stepQuery(screen.slug, filter)}`
        : screenHref(screen, stepQuery(screen.slug, filter)),
    canonical: position === 0 ? '/' : screenHref(screen),
    nav: screen.nav,
    title: screen.nav ? `${screen.nav} — ${SITE.name}` : siteTitle(solo),
  }))

/*
  画面1つぶんの描画。公開ページの本体。

  want が null ならトップ（列の先頭）。そうでなければ URL が名指しした画面で、
  見つからなければ 404。知らない画面名も、範囲の外のページ数も、
  「その URL は無い」の一言に落とす。絞り込みで中身が無くなった画面（その人の
  Works が0件のときの /works?member=…）も同じ扱い。目次にもページャにも
  出てこないので、たどり着くのは URL を手で書いたときだけ。
*/
async function renderScreen(c: Context<AppEnv>, want: { slug: string; page: number } | null) {
  const db = drizzle(c.env.DB, { schema })
  const [members, platforms, theme, blocks] = await Promise.all([
    listPublishedMembers(db),
    listPlatforms(db),
    loadTheme(db),
    publishedBlocks(db),
  ])

  const { filter, memberId } = readFilter(c, platforms, members)
  const { screens, counted } = await siteScreens(db, blocks, members, filter, memberId)

  const solo = soloMember(members)
  const sidebar = <SiteIdentity solo={solo} />

  /*
    出せる画面が1つも無いとき（置いたブロックが全部下書き、など）。
    トップだけは 200 で「まだ何もありません」を出す。サイトの入口まで 404 に
    すると、管理画面に入って直す前に手詰まりになる。ほかの URL は素直に 404。
  */
  if (!screens.length) {
    if (want) return c.notFound()
    return c.html(
      <Layout
        title={siteTitle(solo)}
        description={siteDescription(solo)}
        canonical={`${SITE.origin}/`}
        nav={[]}
        theme={theme}
        sidebar={sidebar}
        // 何も出ていないのは、構成に公開中のブロックが無いから。直す場所はそこ
        admin={await adminHref(c, '/admin/blocks')}
      >
        <Empty>まだ何も置いていません</Empty>
      </Layout>,
    )
  }

  const steps = siteSteps(screens, filter, solo)
  /*
    入口は / と /<slug>（いまなら /hero）の2つで開ける。列の中では / に
    寄せてあるので、/<slug> で来たぶんはここで読み替える——同じ1枚なので、
    404 にはしない。canonical は siteSteps が / を指している。
  */
  const first = screens[0]
  /*
    引くときも stepQuery を通す。その画面に効かない絞り込みを付けて来た URL
    （手で打った /works?platform=web など）は、余分なぶんを落として同じ1枚に
    当てる——列の href には付いていないので、素通しすると 404 になる。
    中身は絞り込み無しと同じで、canonical も素の URL を指す。
  */
  const asked = want ? screenHref(want, stepQuery(want.slug, filter)) : null
  const entry = first && want && want.slug === first.slug && want.page === 1
  const seq = sequence(steps, stepAt(steps, entry ? `/${stepQuery(first.slug, filter)}` : asked))
  const current = seq && screens[seq.index]
  if (!seq || !current) return c.notFound()

  // ここで初めてカードを引く。出す画面に載らない行は、1件も取ってこない
  const rows = await screenRows(db, current, filter, memberId)
  const type = itemTypeOf(current.block.type)
  const data: TopData = {
    ...counted,
    apps: { ...counted.apps, rows: type === 'app' ? rows : [] },
    works: { ...counted.works, rows: type === 'work' ? rows : [] },
  }

  const rendered = renderBlock(current.block, data, current.page)
  // screenList が数えた画面なので、ここで null は返らない
  if (!rendered) return c.notFound()

  return screenPage(c, seq, {
    node: rendered.node,
    // 説明文はこの画面に出ているものから作る（renderBlock が持っている）
    description: rendered.description,
    jsonLd: siteJsonLd(members),
    theme,
    sidebar,
    adminPath: blockAdminPath(current.block, solo),
  })
}

/*
  作品1件のページ。連なりの外にある、1枚きりの画面。

  一覧の URL（/apps/3）は「いまの並びの3枚目」でしかない。並べ替えても公開を
  切り替えても 200 のまま別の作品を指すので、貼られたリンクの中身が誰にも
  気づかれずに入れ替わる。こちらは slug で1件を名指しするので、何を足しても
  外しても指す先が動かない。作品名が <title> と og:title に入るのも、
  「AppMixer 見て」と貼れる URL がサイトに1つも無かったのを閉じるため。

  トップの構成（どのブロックを置いているか）には依らない。Apps の節を外した
  日に、貼られた作品のリンクまで死んではいけない——それでは一覧の URL と
  同じ壊れ方を、名前を変えて持ち込むことになる。出る条件は「作品が公開中」の
  1つだけ。
*/
async function renderItem(c: Context<AppEnv>, type: 'app' | 'work', slug: string) {
  const db = drizzle(c.env.DB, { schema })
  const [item, members, theme, blocks] = await Promise.all([
    findPublishedItem(db, slug),
    listPublishedMembers(db),
    loadTheme(db),
    publishedBlocks(db),
  ])

  /*
    種類は URL の1語目が持つ。/works/item/<app の slug> は「別の URL」ではなく
    「無い URL」——同じ作品に2つの URL を作ると、どちらが正かを canonical で
    名指しし直すことになる。
  */
  const href = item && item.type === type ? itemHref(item) : null
  if (!item || !href) return c.notFound()

  const solo = soloMember(members)
  // 目次はサイトの画面のまま。この画面に絞り込みは無いので、素の並びを聞く
  const { screens } = await siteScreens(db, blocks, members, { platform: null, member: null }, null)
  const steps = siteSteps(screens, { platform: null, member: null }, solo)

  const step: Step = {
    // 印は、この作品が載っている一覧に付く（この画面は目次に並ばない）
    navKey: item.type === 'app' ? 'apps' : 'works',
    href,
    canonical: href,
    // 目次には出さない。めくって着く先ではないので、連なりの行として並べない
    nav: null,
    title: `${item.title} — ${SITE.name}`,
  }

  /*
    この作品の連なりは1枚きり。めくる先が無いのでページャは出ない
    （sequence が1枚のときに返すものと同じ形）。目次だけはサイトの画面の列から
    借りる——ここから戻る道は目次しか無いので、トップと同じ行き先を同じ順で
    並べる。自分の1枚を列の末尾に足して聞くのは、連ね方（目次の重複除けと
    印の付け方）を src/lib/sequence.ts の1本に任せたままにするため。
  */
  const seq: Sequence = {
    index: 0,
    current: step,
    nav: sequence([...steps, step], steps.length)?.nav ?? [],
    pager: null,
  }

  /*
    新しい見た目は足さない。見出しと添え（SectionHead）、本文（Note = .bio）、
    実績値（Numbers）、タグ（Tags）、行き先（LinkList）——どれもトップの
    ブロックが使っている部品で、カードの中と同じものが切られずに1画面ぶんの
    大きさで並ぶ。

    説明文にカードの <p> を使わないのは、あちらが2行で切られるため
    （app.css の --card-lines）。この画面は作品1件のためだけにあるので、
    書いたぶんが全部出る形にする。
  */
  const note = [item.platformLabel ?? item.category, item.year].filter(Boolean).join(' · ')
  const links: string[][] = [
    ...item.links.map((link) => [link.label, link.url]),
    // 担当を出す条件はカードと同じ（showMemberOf）
    ...(showMemberOf(blocks, members) && item.memberName && item.memberSlug
      ? [[item.memberName, `/members/${item.memberSlug}`, '担当']]
      : []),
  ]

  return screenPage(c, seq, {
    node: (
      <Screen id="item" label={item.title}>
        <SectionHead title={item.title} note={note || undefined} h1 />
        {item.summary ? <Note paragraphs={[item.summary]} /> : null}
        {item.metricValue ? (
          <Numbers rows={[[item.metricValue, item.metricUnit ?? '', item.metricNote ?? '']]} />
        ) : null}
        <Tags tags={item.tags} />
        {links.length ? <LinkList rows={links} /> : null}
      </Screen>
    ),
    description: item.summary || siteDescription(solo),
    /*
      この URL が何を名指ししているかを、貼った先にも検索にも1つだけ置く。
      サイトの名乗り（Person / Organization）はトップが持っているので、
      ここに載せるのは作品そのもの。
    */
    jsonLd: {
      '@context': 'https://schema.org',
      '@type': 'CreativeWork',
      name: item.title,
      url: `${SITE.origin}${href}`,
      ...(item.summary ? { description: item.summary } : {}),
    },
    theme,
    sidebar: <SiteIdentity solo={solo} />,
    adminPath: `/admin/items/${item.id}/edit`,
  })
}

/*
  登録順の決まり: `/:screen` と `/:screen/:page` は1語・2語の URL を何でも拾う
  catch-all。だから固定の URL（`/all`・`/members/:slug`・`/images/*`）は、
  必ずこの2つより先に登録する。あとから固定ルートを下に足すと、一致が
  `/:screen` 側に吸われて、そのページだけが静かに 404 になる。
  （`/members/okazaki` は2語なので、`/:screen/:page` と本当に取り合う。
  個人ページの画面 `/members/:slug/:screen` は3語なので取り合わないが、
  取り合う `/members/:slug` の隣に置いておく）

  `all` は画面の名前としての予約語で、決まった中身のブロックの key
  （hero / apps / works / team / contact）とも、打ち込むブロックの block-<id>
  とも衝突しない。だからガードは要らない——`/all` が先にあれば、
  `/:screen` はこの1語を見ない。
*/
publicRoutes.get('/all', (c) => renderWholePage(c))

publicRoutes.get('/', (c) => renderScreen(c, null))

/*
  個人ページの画面ひとそろい。トップと同じ規則で、1画面 = 1ドキュメント。

    /members/<slug>          名乗りと、この人の一覧への帯
    /members/<slug>/about    紹介文
    /members/<slug>/skills   技術
    /members/<slug>/career   経歴
    /members/<slug>/contact  連絡先

  中身の無い画面は作らない（Skills と Career）。トップの「中身が無ければ節ごと
  出さない」がそのまま伸びた形で、URL も目次もページャも一度に消える。

  1画面に入りきらないぶんは、トップと同じく次の URL に送る
  （/members/<slug>/career/2）。1画面あたりの件数は src/blocks.ts の
  MEMBER_PER_SCREEN が正で、割るのは src/lib/paginate.ts——トップの perScreen と
  同じ置き場・同じ割りかたにしてある。ここに軸が無かったころは、書き足した人が
  「入らなくなったら CSS を縮める」以外の道を見つけられなかった。

  1枚目の key だけが空文字。入口は /members/<slug> ひとつに寄せて、
  /members/<slug>/hero のような2つ目の URL を作らないため。
*/
type MemberScreen = {
  key: string
  page: number
  nav: string | null
  // トップの画面と同じ扱い。5枚が同じ1文を配ると、どれも同じ顔で検索に並ぶ
  description: string
  node: Child
}

const memberHref = (slug: string, key: string, page = 1) =>
  `/members/${slug}${key ? `/${key}` : ''}${page === 1 ? '' : `/${page}`}`

/*
  日本語のページ（<html lang="ja">）に素で置いた英語の塊に印を付ける。

  LANGUAGES や PRACTICE のような普通名詞は、印が無いと日本語の音声エンジンが
  ローマ字読みするか読み飛ばす。ただし小見出しは打ち込んだ文字列なので、
  日本語が1文字も混じっていないものだけを英語と見なす——「言語」と書いた人の
  見出しに lang="en" を付けると、今度はそちらが読めなくなる。
*/
const LATIN_ONLY = /^[ -~]+$/
const langOf = (text: string) => (LATIN_ONLY.test(text) ? 'en' : undefined)

function memberScreens(member: schema.Member, band: Child): MemberScreen[] {
  const bio = paragraphs(member.bio)
  const skills = parseSkills(member.skillsText)
  const career = parseLines(member.careerText)

  const screens: MemberScreen[] = [
    {
      key: '',
      page: 1,
      nav: null,
      // 入口は今までどおり大見出し（無ければ紹介文の1段落目）
      description: describe(
        member.headline || bio[0] || `${member.name}（${member.role}）のプロフィール`,
      ),
      node: (
        <>
          {/*
            この画面のいちばん上の見出し。名札（柱）の名前ではなくこちらが h1
            ——柱はどの画面にも同じ文字列で出るので、5画面ぶんの h1 が全部
            同じになってしまう。見出しはその画面の中で完結させる
          */}
          <Hero>
            <h1 class="hero__headline">
              <Phrases text={member.headline || member.name} />
            </h1>
            {/*
              帯は id も名前も持たない。この画面に同居するだけで、目次からも
              ページャからも指さないので、指すための名前が要らない
            */}
            {band}
          </Hero>
        </>
      ),
    },
  ]

  /*
    1つの画面を、入る件数ずつに割って列へ積む。key は割っても同じ
    （/career と /career/2 は同じ見出しの続き）なので、目次の印もまとめて付く。
  */
  const add = (key: string, nav: string, parts: { description: string; node: Child }[]) => {
    for (const [index, part] of parts.entries()) {
      screens.push({ key, page: index + 1, nav, ...part })
    }
  }

  /*
    紹介文が空でも、この画面だけは残す。「準備中です」ごと消すと、
    まだ書いていないのか URL を間違えたのかが読み手に分からない
    （chunk は0件なら空配列を返すので、空のときだけ1画面ぶんを自分で置く）。
  */
  const bioScreens = bio.length ? chunk(bio, MEMBER_PER_SCREEN.about) : [[]]
  add(
    'about',
    'About',
    bioScreens.map((part) => ({
      description: describe(
        joinParts(`${member.name}の紹介`, part.join(' ') || 'まだ書いていません'),
      ),
      node: (
        <Screen id="about" label="About">
          <SectionHead title="About" note="紹介" h1 />
          <Note paragraphs={part}>{part.length ? null : <Empty>準備中です</Empty>}</Note>
        </Screen>
      ),
    })),
  )

  /*
    技術は塊（小見出しひとそろい）を単位に割る。塊の途中では割らない——
    同じ小見出しが2画面に出ると、続きなのか別の塊なのかが読み手に分からない。
  */
  add(
    'skills',
    'Skills',
    chunk(skills, MEMBER_PER_SCREEN.skills).map((part) => ({
      // 塊の小見出しと、その中の表示名。この画面に出ている語をそのまま並べる
      description: describe(
        joinParts(
          `${member.name}の技術`,
          part
            .map((group) =>
              [group.heading, group.skills.map((skill) => skill.label).join('、')]
                .filter(Boolean)
                .join(' '),
            )
            .join('、'),
        ),
      ),
      node: (
        <Screen id="skills" label="Skills">
          <SectionHead title="Skills" note="技術" h1 />
          <div class="skills">
            {part.map((group) => (
              <div class="skill-group" key={group.heading}>
                {/*
                小見出しは段落ではなく見出し。見た目は mono の小見出しとして
                組んであるのに要素が <p> だと、読み上げの見出し移動でこの
                画面の3つの塊に降りられない（この画面は個人ページでいちばん
                密度が高い）。節見出しが h1 なので、こちらは h2
              */}
                {group.heading ? (
                  <h2 class="side-head" lang={langOf(group.heading)}>
                    {group.heading}
                  </h2>
                ) : null}
                <ul>
                  {group.skills.map((skill) => (
                    <li key={skill.label}>
                      {skill.label}
                      {skill.note ? <span class="exp">{skill.note}</span> : null}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </Screen>
      ),
    })),
  )

  add(
    'career',
    'Career',
    chunk(career, MEMBER_PER_SCREEN.career).map((part) => ({
      description: describe(
        joinParts(`${member.name}の経歴`, part.map((row) => row.join(' ')).join('、')),
      ),
      node: (
        <Screen id="career" label="Career">
          <SectionHead title="Career" note="経歴" h1 />
          {/* トップの「できごと」と同じ部品。同じ形のものを2度書かない */}
          <Timeline rows={part} />
        </Screen>
      ),
    })),
  )

  screens.push({
    key: 'contact',
    page: 1,
    nav: 'Contact',
    /*
      トップの Contact と同じ文言の画面なので、誰あての連絡先かを頭に置く。
      置かないと、この2つの URL だけが同じ説明文のまま残る
    */
    description: describe(joinParts(`${member.name}への連絡先`, SITE.contactLead)),
    node: (
      <Contact email={member.email ?? SITE.email} github={member.github ?? SITE.github} split />
    ),
  })

  return screens
}

/*
  個人ページの画面1つ。want が null なら1枚目（/members/<slug>）。

  下書きのメンバーも、その人が持たない画面（技術も経歴も書いていない）も、
  知らない画面の名前も、まとめて「その URL は無い」に落とす。
*/
async function renderMemberScreen(
  c: Context<AppEnv>,
  slug: string,
  want: { key: string; page: number } | null,
) {
  const db = drizzle(c.env.DB, { schema })
  const [member, members, theme, blocks] = await Promise.all([
    findPublishedMember(db, slug),
    /*
      人数だけを見る。サイトが1人として名乗っているあいだ（soloMember）は、
      この人が所属する「Noctifex という組織」は存在しない——トップの
      構造化データは同じ URL を Person として名乗っているので、ここで
      worksFor に同じ URL の Organization を書くと、1つの URL が2つの型を
      持つことになる。
    */
    listPublishedMembers(db),
    loadTheme(db),
    publishedBlocks(db),
  ])
  if (!member) return c.notFound()

  const counts = await countMemberItems(db, member.id)

  /*
    この人の一覧への帯。カードをここに複製せず、絞り込んだ一覧の1画面目へ送る。
    行き先と件数の決め方は bandOf を見ること。

    1人のサイトでは ?member= を付けない。readFilter が読まない（名前のピルが
    無い）ので、付けても効かない URL が1本増えるだけになる。
  */
  const band = bandOf(
    blocks,
    counts.app,
    counts.work,
    filterQuery({ platform: null, member: members.length > 1 ? member.slug : null }),
  )

  const screens = memberScreens(
    member,
    band ? (
      <Band href={band.href} label="このメンバーの Apps · Works" app={band.app} work={band.work} />
    ) : null,
  )

  const steps: Step[] = screens.map((screen) => ({
    // 割られた画面（/career/2）でも Career の見出しに印が残る
    navKey: screen.key,
    href: memberHref(member.slug, screen.key, screen.page),
    // 個人ページに絞り込みは無いので、正の URL は開いた URL と同じ
    canonical: memberHref(member.slug, screen.key, screen.page),
    nav: screen.nav,
    title: screen.nav
      ? `${member.name} · ${screen.nav} — ${SITE.name}`
      : `${member.name} — ${SITE.name}`,
  }))

  /*
    一覧はこの人の連なりの外にある。目次の最後に置いて、めくって着く先
    （ページャ）とは別のものだと分かるようにする。
  */
  const tail: NavLink[] = band ? [{ href: band.href, label: 'Apps · Works' }] : []

  // 1枚目は /members/<slug> だけで開く。名指し（3語目）では当たらない
  const seq = sequence(
    steps,
    stepAt(steps, want === null ? null : memberHref(member.slug, want.key, want.page)),
    tail,
  )
  const current = seq && screens[seq.index]
  if (!seq || !current) return c.notFound()

  return screenPage(c, seq, {
    node: current.node,
    // 説明文もその画面のもの（memberScreens が画面ごとに持っている）
    description: current.description,
    jsonLd: {
      '@context': 'https://schema.org',
      ...personJsonLd(member, `${SITE.origin}/members/${member.slug}`, {
        ...(member.github ? { sameAs: [member.github] } : {}),
        // 1人のサイトなら器は無い。2人目が公開された日に戻る
        ...(soloMember(members)
          ? {}
          : { worksFor: { '@type': 'Organization', name: SITE.name, url: SITE.origin } }),
      }),
    },
    theme,
    sidebar: (
      <div class="identity">
        <Brand size="sm" />
        <Avatar src={member.avatarUrl} name={member.name} size={72} />
        {/*
          名札は h1 ではない。どの画面にも同じ文字列で出るので、h1 にすると
          5画面ぶんの見出しが全部同じになる。各画面の h1 は main の側にある
        */}
        <p class="identity__name">{member.name}</p>
        {member.role ? <span class="identity__role">{member.role}</span> : null}
        {member.location ? <span class="identity__place">{member.location}</span> : null}
        <Socials github={member.github} email={member.email ?? SITE.email} />
      </div>
    ),
    adminPath: `/admin/members/${member.id}/edit`,
  })
}

/*
  2語目（ページ数）の読み方。トップも個人ページも同じ文法にする。

  '1' は1画面目の2つ目の URL なので、素の URL へ寄せる（303）。それ以外の
  書き方（01・abc・0）は無い URL。絞り込みは付けたまま送る——ここで落とすと、
  URL を手で直した人だけ絞り込みが外れる。
*/
type PageWant = { redirect: string } | { page: number } | null

function readPage(raw: string, url: string, bare: string): PageWant {
  if (raw === '1') {
    /*
      bare は呼ぶ側がパスの一部から組み立てた文字列なので、そのまま
      Location に入れない。`//evil.com` や CR/LF がここまで来る
      （isSafeRedirect のコメントに実際の URL と症状が書いてある）。
      通らないものは無い URL なので 404 に落とす。
    */
    return isSafeRedirect(bare) ? { redirect: `${bare}${new URL(url).search}` } : null
  }
  return /^[1-9][0-9]*$/.test(raw) ? { page: Number(raw) } : null
}

publicRoutes.get('/members/:slug', (c) => renderMemberScreen(c, c.req.param('slug'), null))

publicRoutes.get('/members/:slug/:screen', (c) =>
  renderMemberScreen(c, c.req.param('slug'), { key: c.req.param('screen'), page: 1 }),
)

/*
  個人ページの画面も、入りきらないぶんは次の URL へ。4語なので catch-all
  （`/:screen/:page`）とは取り合わないが、同じ連なりの仲間なので隣に置く。
*/
publicRoutes.get('/members/:slug/:screen/:page', (c) => {
  const slug = c.req.param('slug')
  const key = c.req.param('screen')
  const want = readPage(c.req.param('page'), c.req.url, memberHref(slug, key))
  if (!want) return c.notFound()
  if ('redirect' in want) return c.redirect(want.redirect, 303)
  return renderMemberScreen(c, slug, { key, page: want.page })
})

/*
  作品1件の恒久リンク。1語目が種類、3語目が slug。

  3語にしてあるのは catch-all（`/:screen` と `/:screen/:page`）と取り合わない
  ため——`/apps/2` は数字だけの2語のまま残り、`/apps/item/appmixer` はこの2本
  だけが拾う。2語（`/apps/<slug>`）にすると、めくる先の番号と作品の名前が
  同じ位置で取り合うので、slug が数字の作品を作れなくなる。

  1語目を `:list` の1本にまとめないのは、URL の語と作品の種類がここで結び
  ついていることを、読む人にも型にも見せておくため。
*/
publicRoutes.get('/apps/item/:slug', (c) => renderItem(c, 'app', c.req.param('slug')))

publicRoutes.get('/works/item/:slug', (c) => renderItem(c, 'work', c.req.param('slug')))

/*
  クローラ向けの2本。どちらも 404 だった。

  画面が7つに分かれたので、sitemap の有無がそのまま「どれだけ拾われるか」に
  効く。手で URL を並べた表は置かない——構成を並べ替えたり、作品を1件足したり
  した日に、実物と表が静かにずれる。公開ページの画面の列をそのまま数え上げる
  （数えているのは screenList と memberScreens で、公開ページが節を出すかどうかを
  決めているのと同じ式）。

  robots.txt は「読んでよい」と sitemap の在り処を言うだけ。管理画面は認証の
  壁の内側だが、URL を拾わせる理由が無いので外す。
*/
publicRoutes.get('/robots.txt', (c) =>
  c.text(
    [
      'User-agent: *',
      'Allow: /',
      'Disallow: /admin/',
      '',
      `Sitemap: ${SITE.origin}/sitemap.xml`,
      '',
    ].join('\n'),
  ),
)

/*
  XML に入れる文字を落とす。slug は英数字とハイフンに畳んであり、いまのところ
  当たる文字は1つも無い——それでも通すのは、「たぶん安全」を前提にした
  組み立てを1つも残さないため。
*/
const xmlText = (text: string) =>
  text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')

publicRoutes.get('/sitemap.xml', async (c) => {
  const db = drizzle(c.env.DB, { schema })
  const [members, blocks, apps, works] = await Promise.all([
    listPublishedMembers(db),
    publishedBlocks(db),
    listPublishedItems(db, 'app'),
    listPublishedItems(db, 'work'),
  ])

  // 絞り込みを付けない素のサイト。?platform= 付きの URL は正ではないので載せない
  const { screens } = await siteScreens(db, blocks, members, { platform: null, member: null }, null)

  const paths = [
    /*
      入口。置いたものが全部下書きでも 200 で「まだ何も置いていません」を出す
      （オーナーが自分のサイトから締め出されないための分岐）ので、画面の列が
      空でもここは在る。
    */
    '/',
    /*
      トップの画面。並べるのは href ではなく canonical——1枚目は / と /<slug> の
      2つの URL で開けるので、正の1つだけを出す（その1枚目の正は上の / と
      同じ文字列になる。重なりは下で落とす）。
    */
    ...siteSteps(screens, { platform: null, member: null }).map((step) => step.canonical),
    // 縦に積んだ全体版。正が自分自身になったので、ここに並ぶ資格がある
    '/all',
    ...members.flatMap((member) =>
      memberScreens(member, null).map((screen) => memberHref(member.slug, screen.key, screen.page)),
    ),
    // 作品1件の恒久リンク。slug の無い行（列より前からある作品）は URL を持たない
    ...[...apps, ...works].flatMap((item) => itemHref(item) ?? []),
  ]

  const body = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    // 同じ URL は1度だけ。2度出すと「どちらが正か」を自分で曖昧にする
    ...[...new Set(paths)].map(
      (path) => `  <url><loc>${xmlText(`${SITE.origin}${path}`)}</loc></url>`,
    ),
    '</urlset>',
    '',
  ].join('\n')

  return c.body(body, 200, { 'content-type': 'application/xml; charset=UTF-8' })
})

/*
  管理画面からアップロードした画像。KV から出す。

  同じ KV にはログイン試行回数（login:<メールアドレス>）も入っている。
  ここでキーの形を縛らないと、そのまま読み出せてしまう。
  avatars/ 配下の、こちらが付けた名前だけを通す。
*/
const AVATAR_KEY = /^avatars\/[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/

publicRoutes.get('/images/*', async (c) => {
  const key = c.req.path.replace(/^\/images\//, '')
  if (!AVATAR_KEY.test(key)) return c.notFound()

  const object = await c.env.MEDIA.getWithMetadata<{ contentType?: string }>(key, 'arrayBuffer')
  if (!object.value) return c.notFound()

  return new Response(object.value, {
    headers: {
      'content-type': object.metadata?.contentType ?? 'application/octet-stream',
      'cache-control': 'public, max-age=31536000, immutable',
    },
  })
})

/*
  画面ごとの URL。上の「登録順の決まり」のとおり、固定の URL を全部登録した
  あとの、いちばん最後に置く。ここから下に固定ルートを足してはいけない。
*/
publicRoutes.get('/:screen', (c) => renderScreen(c, { slug: c.req.param('screen'), page: 1 }))

publicRoutes.get('/:screen/:page', (c) => {
  const screen = c.req.param('screen')
  // ページ数の読み方は個人ページと同じ（readPage）。文法を2つ持たない
  const want = readPage(c.req.param('page'), c.req.url, `/${screen}`)
  if (!want) return c.notFound()
  if ('redirect' in want) return c.redirect(want.redirect, 303)
  return renderScreen(c, { slug: screen, page: want.page })
})
