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
  memberUnits,
} from '../blocks'
import {
  countPublishedByKind,
  countPublishedItems,
  type Db,
  findPublishedItem,
  findPublishedMember,
  listPublishedItemKeys,
  listPublishedItems,
  listPublishedMembers,
  loadTheme,
  publishedBlocks,
} from '../db/queries'
import * as schema from '../db/schema'
import type { AppEnv } from '../env'
import { getSessionUser, SESSION_COOKIE } from '../lib/auth'
import { isHttpsUrl, isSafeRedirect } from '../lib/format'
import { IMAGE_FORMATS, imageTypeOfPath, isImageType } from '../lib/image'
import { chunk, screenCount } from '../lib/paginate'
import { type Sequence, type Step, sequence, stepAt } from '../lib/sequence'
import { SITE } from '../site'
import type { Theme } from '../theme'
import {
  BackLink,
  Band,
  Brand,
  Empty,
  FilterLinks,
  filterQuery,
  Hero,
  ItemCard,
  ItemDetail,
  type ItemFilter,
  type ItemKind,
  type ItemView,
  itemHref,
  KIND_LABEL,
  LinkList,
  langOf,
  MemberCardCompact,
  MemberCardWide,
  MoonField,
  Nameplate,
  Note,
  NowList,
  Numbers,
  Phrases,
  ProfileWhole,
  Screen,
  ScreenPager,
  ScreenSection,
  SectionHead,
  SkillGroups,
  Statement,
  shotRow,
  Timeline,
  WholeLink,
} from '../ui/components'
import { GithubIcon, MailIcon } from '../ui/icons'
import { Layout, type NavItem, type OgImage } from '../ui/Layout'

export const publicRoutes = new Hono<AppEnv>()

/*
  GitHub は https:// の絶対 URL だけを描く（isHttpsUrl。保存でも同じ検査で弾いて
  いる——admin.tsx の memberErrors）。部品の側でも見るのは、その検査より前に
  保存された行を呼ぶ側の検査に頼らずに落とすため。
*/
const Socials = ({ github, email }: { github?: string | null; email?: string | null }) => (
  <div class="socials">
    {isHttpsUrl(github) ? (
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
  その人だけの連絡先。サイトと違う行き先を持つ人のぶんだけ出す（同じ行き先を
  2つ置かない）。個人ページの1枚目と、全体ページ（/all）のプロフィールの節で使う。
*/
const OwnSocials = ({ member }: { member: schema.Member }) => {
  const github = isHttpsUrl(member.github) && member.github !== SITE.github ? member.github : null
  const email = member.email && member.email !== SITE.email ? member.email : null
  return github || email ? <Socials github={github} email={email} /> : null
}

/*
  連絡先の画面。連なりの最後の1枚で、入口と対になる締め。

  画面に出すのは月と、誘う1文（SITE.contactLead）と、ボタン2つ（メール・GitHub）。
  月を右上に、字とボタンを画面の下に寄せる（入口と同じ組み方）。月は入口の
  三日月を左右に返し、ひとまわり小さく置く（MoonField の closing）。

  **1文だけは置く。** 字を1つも置かなかったころは、ボタンが2つあるだけで、
  何の相談なら送ってよいのか・送ってほしいのかを言う言葉が画面のどこにも
  無かった（その1文は description にしか無く、検索結果でしか読めなかった）。
  連なりを最後までめくってきた人に最後に掛ける言葉なので、これが要る。
  見出しを目に見える形で置かないのは今までどおり——「Contact」と大きく書いても
  ボタンの言葉（メールを送る）と同じことを言うだけで、誘いにはならない。

  リードの字は --ink-mid。締めの月の光暈の上に乗る小さい字なので 4.5:1 が要り、
  npm run check:contrast がこの1文も測っている。

  **見出しは読み上げのためにだけ置く**（.sr-only の h1「Contact」）。割られた
  画面はどれも h1 をちょうど1つ持つ決まり（WCAG 1.3.1）で、見出しの無い画面は
  見出しで移動する人にとって「何も無い」画面になる。全体ページ（/all）では
  ほかの節と同じ見出し（SectionHead）を目に見える形で置き、アドレスも字で
  残す——あそこは印刷の宛先で、紙の上ではボタンの行き先が読めない。リードは
  どちらにも置く（同じ誘いの1文）。

  メールは「送る」操作なので塗りのピル、GitHub は外へ出る脇の道なので柱と
  同じ .socials。同じ行き先を2つ置かない。

  GitHub のプロフィールはここに常設する。柱の .socials は 899 以下で畳んで
  あり（横帯に入らない）、プロフィールへの道はそこ1本しか無かった——つまり
  スマホで開いた人には、このサイトの一次動線が外枠の都合で消えていた
  （WCAG 1.4.10 の「機能の損失」）。逆にこの画面では、柱の GitHub / Mail を
  出さない（SiteIdentity の contact）。同じ行き先が柱と本文に2組並ぶため。

  split は「割られた画面（1画面 = 1ドキュメント）か」。見出しが h1 に上がるのも、
  弁のための tabindex が付くのも同じ条件なので、2つの旗を持たせない。

  締めの月も split のときだけ敷く。全体ページ（/all）には敷かない（入口と
  同じ理由。印刷・Ctrl-F・翻訳の宛先）。呼ぶのはサイトの Contact ブロックだけ
  ——個人ページの Contact は外してサイトの Contact に合流させた。
*/
const Contact = ({
  email,
  github,
  split,
}: {
  email: string
  github?: string | null
  split?: boolean
}) => (
  <Screen id="contact" label="Contact" whole={!split} moonlit={split}>
    {split ? <MoonField closing /> : null}
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
      {/* 句読点までの塊で折る（入口のリード文と同じ Phrases）。語の途中で折らない */}
      <p class="contact__lead">
        <Phrases text={SITE.contactLead} />
      </p>
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
  1人のサイトで Team を置いているなら、その人。Team の画面の代わりに、
  この人の画面（1枚目・About・Skills・Career）がサイトの連なりに入る。

  1人のサイトの Team は、細いカードが1枚だけ置かれた画面だった——複数いる
  前提の器に1人しか入っていないことを、画面1枚ぶん使って告知する形になる。
  中身はカードを押した先の個人ページのほうにあるので、Team の位置に中身
  そのものを置く。目次には「Profile」の1行で載り（src/lib/sequence.ts の
  tocKey）、/ から「次」を押し続ければ 入口 → Projects → 1枚目 → About →
  Skills → Career → Contact と一周できる。/team は1枚目へ 301。

  2人目を公開した日に Team の画面へ戻る（soloMember が人数で決めているので、
  ここでは何もしない）。Team を置いていない1人のサイトでは undefined——
  個人ページは今までどおり、カードの担当者名から入る単独の連なり。
*/
const profileOf = (blocks: schema.Block[], members: schema.Member[]) =>
  blocks.some((block) => block.type === 'team') ? soloMember(members) : undefined

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
        // 通らない GitHub（相対 URL・javascript:）は名乗らず、サイトのものに戻す
        sameAs: [isHttpsUrl(solo.github) ? solo.github : SITE.github],
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

  ここが「Noctifex — Projects」だけだと、共有リンクのカードにも検索の
  スニペットにも、誰のサイトなのかが1文字も出ない。画面に出ている名乗りと
  同じものを head にも置く。
*/
const siteTitle = (solo?: schema.Member) =>
  solo ? `${solo.name}（${solo.role}） — ${SITE.name}` : `${SITE.name} — Projects`

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
  割った2画面目には2画面目に出ているものが入るので、/projects と /projects/2 も
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
  なる（「見込み 40人日から半減」は 20 の添えであって、20 の言い換えではない）。

  だから添えは「値のあとに続けて読んで意味が通る」ように書く決まり（管理画面の
  実績値のヒント）。「20 人日 見込み 40人日 → 実績」と書いていたころは、添えの
  → が値より前を指していて、「実績が見込みの 40人日」と逆に読めた。いまは
  「20 人日 見込み 40人日から半減」——左から右へ1回読めば済む。
*/
const metricDigest = (item: ItemView) =>
  item.metricValue
    ? `（${[item.metricValue, item.metricUnit, item.metricNote].filter(Boolean).join(' ')}）`
    : ''

/*
  サイトの柱（名札）。どの画面にも出るので、ここに載せたものは全画面に載る。

  1人のサイトなら名前と職種を載せる。**ただし入口（Hero の画面）では載せない。**
    - 入口は Hero の h1 が名乗り、肩書きもその上に添えてある。柱にも置くと
      同じ名前が2度並ぶ。899 以下では柱が上の帯に畳まれるので、ロゴのすぐ隣に
      名前が来て、見出しの前置きのように重なっていた
    - 入口の外（Projects・個人ページ・作品・Contact・/all）には名乗りが無い。
      柱に名前を置かないと決めていたころは、奥の画面——検索や貼られたリンク
      から直接着く画面——を開いた人には、誰のサイトかがどこにも出ていなかった
  entrance は「Hero の画面か」。連なりの何枚目かでは決めない——名乗っている
  のは Hero の h1 なので、Hero を2枚目に置いた構成でも、そこでだけ外す。

  899 以下の帯では名前を残し、ワードマーク（NOCTIFEX）を畳む（app.css の
  .identity--named）。帯は 390 の電話で 358px しかなく、ロゴの印・名前・目次
  （Projects / Profile / Contact）で埋まる。畳むのは見た目だけで、ロゴの
  リンクの読み上げには「NOCTIFEX」が残る。職種は今までどおり帯では畳む。

  2人以上のサイトでは名前を出さない。誰か1人の名前を柱に置くと、その人の
  サイトに見える。

  contact は「Contact の画面か」。本文にメールと GitHub のボタンがあるので、
  柱の GitHub / Mail は出さない——同じ行き先が柱と本文に2組並んでいた。
  全体ページ（/all）では出す（あそこの Contact は節の1つで、柱は全体の柱）。
*/
const SiteIdentity = ({
  solo,
  entrance,
  contact,
}: {
  solo?: schema.Member
  entrance?: boolean
  contact?: boolean
}) => {
  const named = entrance ? undefined : solo
  return (
    <div class={named ? 'identity identity--named' : 'identity'}>
      <Brand />
      {named ? <span class="identity__name">{named.name}</span> : null}
      {named?.role ? <span class="identity__role">{named.role}</span> : null}
      <span class="identity__tagline">{SITE.tagline}</span>
      {contact ? null : <Socials github={SITE.github} email={SITE.email} />}
    </div>
  )
}

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
  ——Projects は項目の一覧、Team はメンバーの一覧、入口の名前と職種は
  メンバー（1人のサイトならその人の編集）。Contact と入口のリード文は
  src/site.ts にあって管理画面からは変えられないので、「構成」のその行へ送る。
*/
const blockAdminPath = (block: schema.Block, solo?: schema.Member) => {
  switch (block.type) {
    case 'projects':
      return '/admin/items'
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

  送る先は Projects の1画面目。その節を置いていないサイトでは、そもそも
  その URL が無い（404）ので、置いてあるかどうかも見る。

  件数は区分ごと（個人開発 5 · 業務 2）。Projects を置いていないサイトでは、
  どこを探しても見つからない件数になるので帯ごと出さない。項目が1件も無い
  ときも同じ（0件の知らせだけの画面へ送らない）。
*/
const bandOf = (blocks: schema.Block[], counts: KindCounts, query = '') => {
  const placed = blocks.some((block) => block.type === 'projects')
  return placed && counts.app + counts.work > 0 ? { href: `/projects${query}`, ...counts } : null
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
  matched が0でも節は出す（ピルを残して1行だけ出す）ので、2つに分けて持つ。
*/
type ItemSlice = {
  total: number
  matched: number
  // いま描く画面に出す行だけ。画面の数を数えるためだけに呼ぶときは空
  rows: ItemView[]
}

// 区分ごとの公開中の件数（queries.ts の countPublishedByKind）
type KindCounts = { app: number; work: number }

// 区分のピルに並べるもの。公開中の項目が実在する区分だけ（FilterLinks を見ること）
const kindsOf = (counts: KindCounts): ItemKind[] =>
  (['app', 'work'] as const).filter((kind) => counts[kind] > 0)

type TopData = {
  members: schema.Member[]
  // Projects（個人開発と業務を1つにした一覧）
  projects: ItemSlice
  // 区分のピルに並べるぶん（公開中の項目が実在する区分だけ）
  kinds: ItemKind[]
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
  /*
    1人のサイトで Team を置いているなら、その人（profileOf）。Team のブロックは
    画面を作らず、その位置にこの人の画面が並ぶ（screenList）。全体ページでは
    Team のカードの代わりに、この人のプロフィールを1つの節として置く。
  */
  profile?: schema.Member
}

// 一覧を持つブロック（Projects）だけ、DB から行を引く
const hasList = (key: string) => key === 'projects'

/*
  ブロック1つを描いた結果。

  id は DOM のアンカー（#projects）、slug は URL の1語（/projects）。同じ文字列を
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

  決まった中身のもの（projects・team …）は id を type と同じにして、
  #projects のようなアンカーと /projects という URL の1語を保つ。
  打ち込むものは block-<id>。

  page は「このブロックの何画面目か」（1始まり）。null なら割らずに全件を出す
  ——全体ページ（/all）はこちら。

  Projects の行は、呼ぶ側が limit / offset で切って渡す（ここでは切らない）。
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
  const { members, projects, kinds, filter, showMember, band } = data
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
                肩書きも、入口ではここで読める。英字だけの肩書きには lang="en" を
                付ける（読み上げの発音と、等幅の札にする印。components.tsx の langOf）
              */}
              {solo?.role ? (
                <p class="hero__role" lang={langOf(solo.role)}>
                  {solo.role}
                </p>
              ) : null}
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

                題は「つくったもの」。「つくったものの一覧」と書いていたころは、
                右端の「一覧で見る →」と「一覧」が1枚の札の中で2度出ていた。
                題は何が入っているか、右端はどうするか、で言葉を分ける
              */}
              {band ? (
                <Band href={band.href} label="つくったもの" app={band.app} work={band.work} />
              ) : null}
              {/*
                全体ページ（/all）への控えめな1本。柱の足元の同じ行き先は 899 以下で
                畳まれるので、入口の本文にも置く（WholeLink）。全体ページの Hero
                （split でない）には出さない——自分への行き先になる
              */}
              {split ? <WholeLink /> : null}
            </Hero>
          </>
        ),
      }
    }

    case 'projects': {
      /*
        個人開発（app）と業務（work）を1つの一覧に並べる。並びは新しい順
        （queries.ts の publicOrder）。区分はカードの札（プラットフォーム /
        業界）と絞り込みのピルで見分ける。

        公開中の項目が1件も無ければ節ごと出さない。絞り込んで0件になっただけの
        ときは出す——ピルごと消えると、絞り込みを外す手が画面から無くなる
      */
      if (!projects.total) return null
      // 公開中の項目がある区分が1つだけなら、その区分（見出しの添えになる）
      const soleKind = kinds.length === 1 ? kinds[0] : undefined
      const pages = Math.max(1, screenCount(projects.matched, perScreen))
      if (page !== null && page > pages) return null
      return {
        id,
        slug: id,
        pages,
        nav: 'Projects',
        /*
          件数と区分は、この画面に出ている絞り込みのピルそのもの。そのあとに、
          いまの画面に載っているカードの名前を並べる——ここが画面ごとに変わるので、
          /projects と /projects/2 が同じ説明にならない。

          業務のカードは実績値まで入れる。このサイトでいちばん強い一文（20 人日
          見込み 40人日から半減）はカードの .metric にしか無く、検索結果にも
          貼られたカードにも1文字も出ていなかった。並べる順はカードの並び順
          そのまま（値・単位・添え）——言い換えると、書いた人の数字がこちらの
          都合で別の意味になる。
        */
        description: describe(
          joinParts(
            `つくったもの ${projects.total} 件`,
            kinds.map((kind) => KIND_LABEL[kind]).join(' / '),
            projects.rows.map((row) => `${row.title}${metricDigest(row)}`).join('、'),
          ),
        ),
        node: (
          <ScreenSection
            id={id}
            label="Projects"
            whole={!split}
            head={
              <>
                {/*
                  添えは、区分のピルが無いときだけ。区分が2つあるサイトでは
                  すぐ下のピル（すべて / 個人開発 / 業務）が同じ言葉を並べるので、
                  見出しに「個人開発 · 業務」と添えると同じ語が2段続く。区分が
                  1つのサイトではピルが並ばない（FilterLinks）ので、何の一覧かを
                  言うのはこの添えだけになる
                */}
                <SectionHead
                  title="Projects"
                  note={soleKind ? KIND_LABEL[soleKind] : undefined}
                  h1={split}
                />
                {/* 行き先はこのブロックの1画面目。いま何画面目に居ても同じ */}
                <FilterLinks
                  base={`/${id}`}
                  kinds={kinds}
                  members={members.map((member) => ({ slug: member.slug, name: member.name }))}
                  filter={filter}
                />
              </>
            }
          >
            {projects.matched ? (
              /*
                列の数は1画面ぶんの件数そのもの。CSS は repeat(var(--cols), …)
                と書くだけで数を持たない（app.css の「600px 以上」）。perScreen を
                変えれば列も一緒に変わるので、件数と見た目が二重にならない
              */
              <div class="grid" style={`--cols:${perScreen}`}>
                {/*
                  サムネイルの枠は行ごとに決める（ItemCard の framed）。行は
                  perScreen 件ずつ——割られた画面では1画面がちょうど1行、
                  全体ページ（/all）では同じ grid に perScreen 件ずつの行が並ぶ
                */}
                {chunk(projects.rows, perScreen).flatMap((row) => {
                  const framed = shotRow(row)
                  return row.map((item) => (
                    <ItemCard key={item.id} item={item} showMember={showMember} framed={framed} />
                  ))
                })}
              </div>
            ) : (
              <p class="filter-empty">この条件に当てはまるものはまだありません</p>
            )}
          </ScreenSection>
        ),
      }
    }

    case 'team': {
      if (!members.length) return null
      /*
        1人のサイトのプロフィール。割られた画面としては描かない——その位置には
        この人の画面（/members/<slug> …）が並ぶ（screenList）。ここへ来るのは
        全体ページ（/all）だけで、Team のカード1枚の代わりに、プロフィール
        そのものを1つの節として置く。id も目次の名前も Profile にそろえる
        （画面ごとの URL の目次と同じ名前で、同じ中身を指す）。
      */
      if (data.profile) {
        if (split) return null
        const person = data.profile
        return {
          id: 'profile',
          slug: 'profile',
          pages: 1,
          nav: 'Profile',
          description: describe(`${person.name}のプロフィール`),
          node: (
            <Screen id="profile" label="Profile" whole>
              <SectionHead title="Profile" />
              <ProfileWhole member={person} {...memberUnits(person)}>
                <OwnSocials member={person} />
              </ProfileWhole>
            </Screen>
          ),
        }
      }
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
              添えは置かない。「メンバー」は Team の訳語でしかなく、見出しを
              2つの言語で2度言うだけだった（About の「紹介」、Skills の「技術」、
              Career の「経歴」も同じ理由で外した）。「1 member」と人数を数えて
              出すのはもっと前にやめた——複数いる前提の器に1人しか入っていない
              ことを、自分で数えて告知していた
            */}
            <SectionHead title="Team" h1={split} />
            {/*
              2人なら横長、3人以上でグリッド。人数で決める、画面幅では決めない
              （1人のときは上の data.profile に分かれていて、ここへは来ない）。
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
        node: <Contact email={SITE.email} github={SITE.github} split={split} />,
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
  const [members, items, theme, blocks] = await Promise.all([
    listPublishedMembers(db),
    listPublishedItems(db),
    loadTheme(db),
    publishedBlocks(db),
  ])

  /*
    このページだけは絞り込まない。全部を1ページに載せるのが役目なので、
    ?kind= も ?member= も読まない（ピルは画面ごとの URL へのリンクとして
    残る）。
  */
  const data: TopData = {
    members,
    kinds: kindsOf({
      app: items.filter((item) => item.type === 'app').length,
      work: items.filter((item) => item.type === 'work').length,
    }),
    filter: { kind: null, member: null },
    showMember: showMemberOf(blocks, members),
    projects: { total: items.length, matched: items.length, rows: items },
    // このページには一覧そのものがすぐ下に並ぶ。送り出す先が無いので帯は置かない
    band: null,
    // 1人のサイトなら、Team の節の代わりにプロフィールを置く
    profile: profileOf(blocks, members),
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
      /*
        入口ではないので名乗る。Hero の h1 は同じページにあるが、印刷した紙の
        2枚目から先、Ctrl-F で飛んだ先では柱だけが誰のサイトかを言う
      */
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
  だから Projects の最後の画面の「次」は、次のブロックの1画面目になる。目次に
  載らない画面（Hero・ひとこと）も列には並ぶので、めくれば必ずたどり着ける。
*/
type BlockScreen = {
  kind: 'block'
  block: schema.Block
  slug: string
  nav: string | null
  page: number
}

/*
  1人のサイトのプロフィールの1枚（profileOf）。Team のブロックの位置に、
  その人の画面がそのまま並ぶ。URL は /members/<slug> …のままで、描くのも
  個人ページの経路（renderMemberScreen）。サイトの列に入っているのは、
  前後・目次・通し番号をサイトの連なりとして数えるため。

  描くもの（node・説明文）は memberScreens が作ったものをそのまま持つ。
  1枚目の帯（このメンバーのつくったもの）は付けない——入口の帯と同じ行き先・
  同じ件数になり、同じ札が連なりに2度出る。
*/
type ProfileScreen = {
  kind: 'profile'
  member: schema.Member
  screen: MemberScreen
}

type SiteScreen = BlockScreen | ProfileScreen

function screenList(blocks: schema.Block[], data: TopData): SiteScreen[] {
  const screens: SiteScreen[] = []
  for (const block of blocks) {
    // 1人のサイトの Team は、その人の画面に置き換わる
    const person = block.type === 'team' ? data.profile : undefined
    if (person) {
      for (const screen of memberScreens(person, null)) {
        screens.push({ kind: 'profile', member: person, screen })
      }
      continue
    }
    /*
      1画面目を描いて、そのブロックが何画面になるかを聞く。中身が無ければ
      null が返り、画面は1つも生まれない——未配置・下書き・0件のブロックに
      URL が無いのは、renderBlock の「節ごと出さない」がそのまま伸びた結果。
      画面の数え方をここで別に書くと、いつか節の有無とずれる。
    */
    const first = renderBlock(block, data, 1)
    if (!first) continue
    for (let page = 1; page <= first.pages; page += 1) {
      screens.push({ kind: 'block', block, slug: first.slug, nav: first.nav, page })
    }
  }
  return screens
}

/*
  1画面目は /projects、2画面目からは /projects/2。同じ画面に URL を2つ作らない。

  query は絞り込み（?kind=… / ?member=…）。めくる先にも目次の行き先にも
  同じものを付ける。付けないと、次の画面へ移った瞬間に絞り込みだけが外れ、
  通し番号（07 · 23）だけが絞り込んだままの数で残る。
*/
const screenHref = (screen: { slug: string; page: number }, query = '') =>
  `/${screen.slug}${screen.page === 1 ? '' : `/${screen.page}`}${query}`

/*
  URL の絞り込みを読む。

  知らない区分も、ピルに並んでいない区分（項目が片方の区分にしか無いサイト）も、
  公開中に居ないメンバーの slug も、絞り込みとして扱わない（絞り込まずに全件を
  出す）。ピルに並ばないもので絞り込むと、画面のどこにも印が出ず、外す手が
  無くなる。

  1人のサイトでは ?member= を読まない。名前のピルは2人以上いるときにしか
  並ばない（FilterLinks）ので、効かせると「すべて」にも名前にも印が付かない
  まま一覧だけが絞られる。
*/
function readFilter(c: Context<AppEnv>, kinds: ItemKind[], members: schema.Member[]) {
  const asked = c.req.query('kind')
  // 区分のピルは両方の区分に項目があるときだけ並ぶ（FilterLinks）
  const kind = kinds.length > 1 ? (kinds.find((one) => one === asked) ?? null) : null
  const member =
    members.length > 1 ? (members.find((row) => row.slug === c.req.query('member')) ?? null) : null
  const filter: ItemFilter = { kind, member: member?.slug ?? null }
  return { filter, memberId: member?.id ?? null }
}

// その一覧に効く条件。区分もメンバーも Projects の1つの一覧に効く
const scopeOf = (filter: ItemFilter, memberId: number | null) => ({ kind: filter.kind, memberId })

/*
  いま出す画面のぶんだけを引く。Projects 以外の画面では1件も引かない
  ——その画面に一覧は無い。絞り込みが画面をまたいで効くのは、どの画面でも
  同じ絞り込みから条件を作っているから。
*/
async function screenRows(
  db: Db,
  screen: BlockScreen,
  filter: ItemFilter,
  memberId: number | null,
): Promise<ItemView[]> {
  const type = blockType(screen.block.type)
  if (!hasList(screen.block.type) || !type) return []
  const perScreen = blockPerScreen(type.key)
  return listPublishedItems(db, {
    ...scopeOf(filter, memberId),
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
    /*
      この画面に載せる構造化データ。載せるかどうかは呼ぶ側が決めて、載せない
      画面では渡さない。

      名乗り（サイトの Person / Organization、個人ページの Person）は連なりに
      1つあれば足りるので、呼ぶ側が先頭の画面（seq.index === 0）でだけ渡す。
      作品1件のページの CreativeWork は名乗りではなく「この URL が何か」なので、
      どの作品のページにも渡す——作品同士をめくる列ができたとき、ここで
      index === 0 を見ていたせいで、先頭の作品にしか載らなくなるところだった。
    */
    jsonLd?: unknown
    theme: Theme
    sidebar: Child
    // この画面の中身を直す管理画面（adminHref が、ログインしている人にだけ出す）
    adminPath: string
    // ページャが数える単位（ScreenPager の unit）。作品同士をめくるときだけ「件」
    unit?: '画面' | '件'
    // 共有カードの画像。渡さなければサイトの1枚（src/ui/Layout.tsx の OgImage）
    image?: OgImage
  },
) {
  return c.html(
    <Layout
      title={seq.current.title}
      description={page.description}
      canonical={`${SITE.origin}${seq.current.canonical}`}
      jsonLd={page.jsonLd}
      nav={seq.nav}
      theme={page.theme}
      sidebar={page.sidebar}
      admin={await adminHref(c, page.adminPath)}
      image={page.image}
    >
      {/* 1画面しか無いなら、めくる先が無いのでページャは出さない */}
      {seq.pager ? (
        <>
          {page.node}
          <ScreenPager {...seq.pager} unit={page.unit} />
        </>
      ) : (
        page.node
      )}
    </Layout>,
  )
}

/*
  名乗り（構造化データ）は連なりの先頭の画面にだけ載せる。めくった先で同じ
  人・同じ器をもう一度名乗らない（CLAUDE.md「1画面 = 1ドキュメント」）。
*/
const firstOnly = (seq: Sequence, jsonLd: unknown) => (seq.index === 0 ? jsonLd : undefined)

/*
  サイトの中の経路（/images/items/… や /assets/…）を絶対 URL にする。
  構造化データは貼られた先や検索エンジンがこの文書の外で読むので、相対の
  ままでは何も指さない。管理画面から入る画像の URL はいつも / で始まるが、
  既に絶対のもの（手で DB に入れた外の URL）はそのまま通す。
*/
const absoluteUrl = (path: string) => (path.startsWith('/') ? `${SITE.origin}${path}` : path)

/*
  作品のページの共有カードの画像（src/ui/Layout.tsx の OgImage）。

  使うのは、こちらが上げた画像（/images/items/…）で、種類が貼り先に読まれる
  もの（AVIF 以外の4種類）だけ。種類は拡張子から（putImage が判定の結果から
  付けたもの）、寸法は上げたときに読んだもの。どちらも分からなければ名乗らない。
  使えなければ undefined を返し、サイトの1枚に戻る。
*/
const SHARE_TYPES = new Set(
  IMAGE_FORMATS.map((format) => format.type).filter((type) => type !== 'image/avif'),
)

function itemOgImage(item: ItemView): OgImage | undefined {
  if (!item.imageUrl?.startsWith('/images/items/')) return undefined
  const type = imageTypeOfPath(item.imageUrl)
  if (!type || !SHARE_TYPES.has(type)) return undefined
  return {
    url: absoluteUrl(item.imageUrl),
    alt: item.imageAlt || item.title,
    type,
    ...(item.imageWidth && item.imageHeight
      ? { width: item.imageWidth, height: item.imageHeight }
      : {}),
  }
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
  // 区分ごとの件数。呼ぶ側が絞り込みを読むのに先に引いていれば渡す（二度引かない）
  byKind?: KindCounts,
): Promise<{ screens: SiteScreen[]; counted: TopData }> {
  const counts = byKind ?? (await countPublishedByKind(db))
  const total = counts.app + counts.work
  // 絞り込みが効いていないときは数え直さない（同じ数になる）
  const matched =
    filter.kind || memberId ? await countPublishedItems(db, scopeOf(filter, memberId)) : total

  const counted: TopData = {
    members,
    kinds: kindsOf(counts),
    filter,
    showMember: showMemberOf(blocks, members),
    projects: { total, matched, rows: [] },
    band: bandOf(blocks, counts),
    profile: profileOf(blocks, members),
  }

  return { screens: screenList(blocks, counted), counted }
}

/*
  その画面に**効く絞り込みだけ**を残す。

  絞り込みを全画面に配っていたころ、Hero にも Contact にも ?platform= が
  付いて回っていた。中身は1文字も変わらないのに URL だけが増え、実測で
  20画面のサイトに対して辿れる URL が 58本あった（/hero?platform=macos、
  /contact?member=okazaki のたぐい）。

  効くのは一覧を持つ画面（Projects）だけで、区分もメンバーもそこに効く
  （scopeOf）。ここはその写しなので、scopeOf を変えるときは一緒に直すこと。

  絞り込みが画面をまたいで残ること自体は意図どおり（test/public.test.ts の
  「絞り込みは、めくっても目次から移っても外れない」）。落とすのは、
  その画面では何の意味も持たない項目だけ。
*/
const stepQuery = (slug: string, filter: ItemFilter): string =>
  hasList(slug) ? filterQuery(filter) : ''

/*
  サイトの画面の列を、連なりの1枚ずつに写す。

  目次に並ぶのは slug ごとに1行（sequence が同じ tocKey——省けば navKey——の
  最初の1枚だけを採る）。だからブロックの2画面目以降でも、その見出しに印が残る。

  canonical: 先頭の画面は / と /<slug> の2つの URL で開けるので、正は / の
  ほうにそろえる（全体ページ /all と同じ扱い）。2つ目からは、その画面の URL
  が正。絞り込みは付けない——同じ中身の取り出し方なので、ピルの組み合わせの
  ぶんだけ URL が数えられると、どれが本体か分からなくなる。

  href も先頭だけは / に寄せる。ここが /<slug>（＝/hero）だったころ、
  ページャの「前」だけがそこを指していて、入口と**バイト単位で同一の URL** が
  リンクを辿れる場所に1つ増えていた。/hero を直接開いた人のために
  ルートは残してあるが（下の renderScreen で読み替える）、こちらから
  案内はしない。

  1人のサイトのプロフィールの画面（ProfileScreen）は、個人ページと同じ1枚
  （memberStep）に写す。目次では「Profile」の1行にまとめ（PROFILE_TOC）、
  ページャでは節ごとに名乗る。先頭に来ても / には寄せない——その1枚を描くのは
  個人ページの経路で、/ は renderScreen がそこへ送る。
*/
const siteSteps = (screens: SiteScreen[], filter: ItemFilter, solo?: schema.Member): Step[] =>
  screens.map((screen, position) =>
    screen.kind === 'profile'
      ? memberStep(screen.member, screen.screen, PROFILE_TOC)
      : {
          navKey: screen.slug,
          href:
            position === 0
              ? `/${stepQuery(screen.slug, filter)}`
              : screenHref(screen, stepQuery(screen.slug, filter)),
          canonical: position === 0 ? '/' : screenHref(screen),
          nav: screen.nav,
          title: screen.nav ? `${screen.nav} — ${SITE.name}` : siteTitle(solo),
        },
  )

/*
  画面1つぶんの描画。公開ページの本体。

  want が null ならトップ（列の先頭）。そうでなければ URL が名指しした画面で、
  見つからなければ 404。知らない画面名も、範囲の外のページ数も、
  「その URL は無い」の一言に落とす。絞り込みで画面が減ったあとの続き（業務が
  1画面ぶんしか無いときの /projects/3?kind=work）も同じ扱い。目次にもページャにも
  出てこないので、たどり着くのは URL を手で書いたときだけ。
*/
async function renderScreen(c: Context<AppEnv>, want: { slug: string; page: number } | null) {
  const db = drizzle(c.env.DB, { schema })
  const [members, byKind, theme, blocks] = await Promise.all([
    listPublishedMembers(db),
    countPublishedByKind(db),
    loadTheme(db),
    publishedBlocks(db),
  ])

  const solo = soloMember(members)
  /*
    1人のサイトで Team を置いているあいだ、Team の画面は無い——その位置には
    その人のプロフィールが並ぶ（profileOf）。貼られた /team と /team/<n> は
    死なせずにその人の1枚目へ寄せる。

    2人目を公開した日に /team はまた 200 に戻る。301 はブラウザに覚えられる
    ので、その日までに一度でも寄せられた人は、しばらくプロフィールへ運ばれ
    続ける（行き先は生きているので行き止まりにはならない）。
  */
  const profile = profileOf(blocks, members)
  if (want?.slug === 'team' && profile) {
    return c.redirect(memberHref(profile.slug, ''), 301)
  }

  const { filter, memberId } = readFilter(c, kindsOf(byKind), members)
  const { screens, counted } = await siteScreens(db, blocks, members, filter, memberId, byKind)

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
        sidebar={<SiteIdentity solo={solo} />}
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
    連なりの先頭がプロフィール（1人のサイトで Hero を外し、Team を先頭に
    置いた構成）。その1枚は /members/<slug> にあり、描くのも個人ページの経路
    なので、入口はそこへ送る。構成しだいで変わる行き先なので 302。
  */
  const head = steps[0]
  if (!want && first?.kind === 'profile' && head) return c.redirect(head.href, 302)
  /*
    引くときも stepQuery を通す。その画面に効かない絞り込みを付けて来た URL
    （手で打った /contact?kind=work など）は、余分なぶんを落として同じ1枚に
    当てる——列の href には付いていないので、素通しすると 404 になる。
    中身は絞り込み無しと同じで、canonical も素の URL を指す。
  */
  const asked = want ? screenHref(want, stepQuery(want.slug, filter)) : null
  const entry = first?.kind === 'block' && want && want.slug === first.slug && want.page === 1
  const seq = sequence(steps, stepAt(steps, entry ? `/${stepQuery(first.slug, filter)}` : asked))
  const current = seq && screens[seq.index]
  // プロフィールの画面は /members/<slug> …にしか無いので、ここでは当たらない
  if (!seq || current?.kind !== 'block') return c.notFound()

  // ここで初めてカードを引く。出す画面に載らない行は、1件も取ってこない
  const rows = await screenRows(db, current, filter, memberId)
  const data: TopData = { ...counted, projects: { ...counted.projects, rows } }

  const rendered = renderBlock(current.block, data, current.page)
  // screenList が数えた画面なので、ここで null は返らない
  if (!rendered) return c.notFound()

  /*
    入口の帯（一覧へ送る丸い札）が、ページャの「次 →」と同じ行き先なら、
    入口にはページャを出さない。既定の並び（入口 → Projects …）ではいつもそう
    なり、同じ /projects へのリンクが画面の中ほどの札と画面の底の手に2つ並んで
    いた。どちらを押せばよいかを読み手に選ばせるだけで、行き先は同じ。札のほうを
    残すのは、件数（個人開発 5 · 業務 2）を添えて何があるかを先に見せるから。

    落とすのは「前」が無いとき（入口が連なりの先頭）だけ。入口より前に画面を
    置いた構成でページャごと落とすと、前へ戻る手まで消える。行き先が違うとき
    （入口と Projects の間にひとことを置いた構成）は、ページャが次の画面へ、
    帯が一覧へ、と別の道なので両方出す。
  */
  const band = current.block.type === 'hero' ? data.band : null
  const pager =
    seq.pager && band && seq.pager.prev === null && seq.pager.next === band.href ? null : seq.pager

  return screenPage(
    c,
    { ...seq, pager },
    {
      node: rendered.node,
      // 説明文はこの画面に出ているものから作る（renderBlock が持っている）
      description: rendered.description,
      jsonLd: firstOnly(seq, siteJsonLd(members)),
      theme,
      /*
      入口（Hero）では柱に名乗らない（Hero の h1 が名乗る）。Contact では柱の
      GitHub / Mail を出さない（本文にボタンがある）。理由は SiteIdentity
    */
      sidebar: (
        <SiteIdentity
          solo={solo}
          entrance={current.block.type === 'hero'}
          contact={current.block.type === 'contact'}
        />
      ),
      adminPath: blockAdminPath(current.block, solo),
    },
  )
}

/*
  作品1件のページ。作品同士を横にめくる、自分たちだけの連なり。

  一覧の URL（/apps/3）は「いまの並びの3枚目」でしかない。並べ替えても公開を
  切り替えても 200 のまま別の作品を指すので、貼られたリンクの中身が誰にも
  気づかれずに入れ替わる。こちらは slug で1件を名指しするので、何を足しても
  外しても指す先が動かない。作品名が <title> と og:title に入るのも、
  「AppMixer 見て」と貼れる URL がサイトに1つも無かったのを閉じるため。

  トップの構成（どのブロックを置いているか）には依らない。Projects の節を外した
  日に、貼られた作品のリンクまで死んではいけない——それでは一覧の URL と
  同じ壊れ方を、名前を変えて持ち込むことになる。出る条件は「作品が公開中」の
  1つだけ。

  行き来は2本。
    - ページャ（画面の底）: 作品同士を一覧と同じ並びでめくる。「← 前」
      「Projects 3 / 7」「次 →」。数えるのは恒久リンクを持つ作品だけ
    - 「← 一覧に戻る」（本文の頭）: その作品が載っている Projects の画面へ
  1枚きりの行き止まりだったころは、戻る道が目次しか無かった。目次の Projects は
  一覧の1画面目へ行くので、4画面目のカードから入った人は最初からめくり直し、
  隣の作品を見るにも一覧へ戻ってカードを探し直すしかなかった。
*/
async function renderItem(c: Context<AppEnv>, type: 'app' | 'work', slug: string) {
  const db = drizzle(c.env.DB, { schema })
  const [item, order, members, theme, blocks] = await Promise.all([
    findPublishedItem(db, slug),
    listPublishedItemKeys(db),
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
  const { screens } = await siteScreens(db, blocks, members, { kind: null, member: null }, null)
  const steps = siteSteps(screens, { kind: null, member: null }, solo)

  /*
    作品の列。並びは一覧と同じ（listPublishedItemKeys が publicOrder で引く）で、
    恒久リンクを持つ作品だけ——slug の無い作品にはめくって着く URL が無い。

    navKey はどれも同じ 'item' なので、sequence は列ぜんぶを1つの節として
    数え（3 / 7）、手は節をまたがないので行き先を名乗らず「← 前」「次 →」の
    まま。節の名前（nav）は一覧の名前そのもので、ページャの真ん中に
    「Projects」と出る。

    目次の単位（tocKey）は一覧の 'projects'。目次に行は持たず（tocLabel: null）、
    印だけがこの作品の載っている一覧（Projects）に付く——個人ページが Team に
    印を付けるのと同じ借り方で、印を付ける手続きは sequence に任せる。
  */
  const own: Step[] = order.flatMap((row) => {
    const at = itemHref(row)
    return at
      ? [
          {
            navKey: 'item',
            tocKey: 'projects',
            tocLabel: null,
            href: at,
            canonical: at,
            nav: 'Projects',
            title: `${row.title} — ${SITE.name}`,
          },
        ]
      : []
  })
  const index = stepAt(own, href)
  const step = own[index]
  if (!step) return c.notFound()

  /*
    目次とページャは別の列から取る（renderMemberScreen と同じ2回呼び）。
    目次はサイトの画面の列に作品の列を継いで聞く——作品の行は目次に並ばない
    ので、並ぶのはトップと同じ行き先で、印は Projects に付く。ページャは
    作品の列だけで聞く。サイトの列と継いだままめくると、最初の作品の「←」が
    Contact を指してしまう。

    index は作品の列の中の位置。構造化データ（CreativeWork）はどの作品にも
    載せるので、firstOnly は通さない。
  */
  const seq: Sequence = {
    index,
    current: step,
    nav: sequence([...steps, ...own], steps.length + index)?.nav ?? [],
    pager: sequence(own, index)?.pager ?? null,
  }

  /*
    「← 一覧に戻る」の行き先。この作品が一覧の何画面目に載っているかを、
    一覧と同じ並び（order。slug の無い作品も一覧には載るので数に入れる）の
    中の位置と perScreen から出す。1画面目なら /projects、ほかは /projects/N。

    URL は自分で組まず、サイトの画面の列から Projects の N 枚目を引く。
    Projects を先頭に置いた構成では1枚目が / になり、Projects を置いて
    いない構成ではそもそも一覧が無い（そのときは戻る道を出さない。
    目次にも Projects は無い）。
  */
  const position = order.findIndex((row) => row.id === item.id)
  const listPage = Math.floor(position / blockPerScreen('projects')) + 1
  const listSteps = steps.filter((_, at) => {
    const screen = screens[at]
    return screen?.kind === 'block' && screen.block.type === 'projects'
  })
  const back = listSteps[listPage - 1]?.href ?? null

  /*
    見出しと添え（SectionHead）の下は ItemDetail——カードを開いたもの。説明
    （Note = .bio）・実績値（Metric）・タグ（Tags）・行き先（LinkRow）はカードと
    同じ部品で、足すのは画像（Shot）と本文（Note）だけ。なぜカードの部品かは
    ItemDetail に書いてある（高さ）。足した見た目は「← 一覧に戻る」の札と、
    画像の枠（.shot）と、列の組み方（.detail）。

    説明文にカードの <p> を使わないのは、あちらが行数で切られるため
    （app.css の --card-lines。電話の幅では2行）。この画面は作品1件のためだけにあるので、
    書いたぶんが全部出る形にする。本文と画像はここにしか出ない（カードには
    出さない。サムネイルは同じ画像の飾り）。
  */
  const note = [item.platformLabel ?? item.category, item.year].filter(Boolean).join(' · ')
  const links = [
    ...item.links,
    /*
      担当を出す条件はカードと同じ（showMemberOf）。サイトの中の行き先なので、
      矢印は →・同じタブ（LinkRow が URL の頭の / で決める）
    */
    ...(showMemberOf(blocks, members) && item.memberName && item.memberSlug
      ? [{ label: `担当 ${item.memberName}`, url: `/members/${item.memberSlug}` }]
      : []),
  ]

  return screenPage(c, seq, {
    node: (
      <Screen id="item" label={item.title}>
        {back ? <BackLink href={back} label="一覧に戻る" /> : null}
        <SectionHead title={item.title} note={note || undefined} h1 />
        <ItemDetail item={item} links={links} />
      </Screen>
    ),
    // 説明文は要約（summary）のまま。本文は長く、検索結果の1行には畳めない
    description: item.summary || siteDescription(solo),
    /*
      この URL が何を名指ししているかを、貼った先にも検索にも1つだけ置く。
      サイトの名乗り（Person / Organization）はトップが持っているので、
      ここに載せるのは作品そのもの。画像は絶対 URL で（相対のままでは、
      この文書の外で読む側が解決できない）。
    */
    jsonLd: {
      '@context': 'https://schema.org',
      '@type': 'CreativeWork',
      name: item.title,
      url: `${SITE.origin}${href}`,
      ...(item.summary ? { description: item.summary } : {}),
      ...(item.imageUrl ? { image: absoluteUrl(item.imageUrl) } : {}),
    },
    theme,
    sidebar: <SiteIdentity solo={solo} />,
    adminPath: `/admin/items/${item.id}/edit`,
    // 1枚が作品1件。読み上げは「Projects の 7 件のうち 3 件目」
    unit: '件',
    // 貼られたときの札は、この作品の画像（あれば）
    image: itemOgImage(item),
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

    /members/<slug>          名札と大見出しと、この人の一覧への帯
    /members/<slug>/about    紹介文
    /members/<slug>/skills   技術
    /members/<slug>/career   経歴

  **個人ページはサイトの連なりの一部。** 柱と目次はサイトのままで、個人ページ
  専用のものに入れ替えない。入れ替えていたころ（柱に顔・名前・所在地、目次に
  About / Skills / Career / Contact / Apps · Works）は、Team のカードを押すと
  別のサイトへ飛んだように見え、戻る道もロゴ（入口まで戻る）しか無かった。
  どう連なるかは人数で2つに分かれる。

    1人のサイト（Team を置いているとき。profileOf）
      Team の画面は作らず、その位置にこの人の画面がそのまま並ぶ。サイトの
      連なりそのものなので、/ から「次」を押し続けると
      入口 → Projects … → 1枚目 → About → Skills → Career → Contact と一周する。
      目次は「Profile」の1行（どの画面でもそこに印）。/team は1枚目へ 301。
      1枚目の帯（このメンバーのつくったもの）は出さない——入口の帯と同じ行き先・
      同じ件数の札が、連なりに2度出る。構造化データも載せない（連なりの途中）
    2人以上のサイト
      Team の続き。目次はサイトのもの（Team に印）で、ページャはサイトの列の
      Team の直後にこの人の画面を差し込んだ列でめくる——
      ← Team → 1枚目 → About → Skills → Career → Contact →。Team の画面自身の
      「次」は Contact のまま（個人ページはカードから入る脇の道）

  Team を置いていないサイトでは、差し込む先が無いので、この人の画面だけで
  連ねる（カードの担当者名から入る単独の連なり）。

  連絡先はサイトの Contact に合流させた（/members/<slug>/contact はそこへ 301）。

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
  個人ページの1枚を、連なりの1枚（Step）に写す。1人のサイトのプロフィール
  （siteSteps）も、2人以上のサイトの個人ページ（renderMemberScreen）も同じ形。

  navKey は画面ごと（割られた /career/2 も同じ節）。サイトの画面の navKey
  （ブロックの slug）と取り合わないよう、頭に印を付ける。nav はページャが
  名乗る名前で、1枚目は人の名前——About から戻る手が「← 前」ではなく
  「← 岡崎 昂功」になり、Projects の最後の「次」は「岡崎 昂功 →」になる。

  目次の単位（toc）だけが連なり方で変わる。1人のサイトでは「Profile」の1行に
  まとまり、2人以上では行を持たずに Team に印（下の PROFILE_TOC / TEAM_TOC）。
*/
const memberStep = (
  member: schema.Member,
  screen: MemberScreen,
  toc: Pick<Step, 'tocKey' | 'tocLabel'>,
): Step => ({
  navKey: `member:${screen.key}`,
  href: memberHref(member.slug, screen.key, screen.page),
  // 個人ページに絞り込みは無いので、正の URL は開いた URL と同じ
  canonical: memberHref(member.slug, screen.key, screen.page),
  nav: screen.nav ?? member.name,
  title: screen.nav
    ? `${member.name} · ${screen.nav} — ${SITE.name}`
    : `${member.name} — ${SITE.name}`,
  ...toc,
})

// 1人のサイト。目次は「Profile」の1行で、行き先は1枚目
const PROFILE_TOC = { tocKey: 'profile', tocLabel: 'Profile' }
// 2人以上のサイト。目次に行を持たず、印は Team に付く（Team を置いていなければ無印）
const TEAM_TOC = { tocKey: 'team', tocLabel: null }

function memberScreens(member: schema.Member, band: Child): MemberScreen[] {
  // 開き方は src/blocks.ts の memberUnits が正（管理画面の「N 画面」も同じ式を数える）
  const { bio, skills, career } = memberUnits(member)

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
        <Hero>
          {/*
            名札（顔・名前・肩書きと所在地）。柱はサイトのままなので、その人の
            顔はここにしか出ない（1人のサイトなら名前と職種は柱にも出る）。
            Team のカードと同じ並びにして、カードを押した先で同じ顔に着くようにする。

            見出し（h1）は大見出しがあればそれ、無ければ名札の名前。どちらでも
            この画面の中で完結する1つの h1 になる
          */}
          <Nameplate member={member} heading={!member.headline} />
          {member.headline ? (
            <h1 class="hero__headline">
              <Phrases text={member.headline} />
            </h1>
          ) : null}
          {/*
            この人だけの連絡先。個人ページの Contact の画面は外してサイトの
            Contact に合流させたので、サイトと違う行き先を持つ人のぶんはここに
            置く。サイトと同じ行き先なら出さない（同じ行き先を2つ置かない）
          */}
          <OwnSocials member={member} />
          {/*
            帯は id も名前も持たない。この画面に同居するだけで、目次からも
            ページャからも指さないので、指すための名前が要らない
          */}
          {band}
        </Hero>
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
          {/* 添えは置かない。訳語（紹介）は見出しを2度言うだけ（Team を見ること） */}
          <SectionHead title="About" h1 />
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
          <SectionHead title="Skills" h1 />
          {/* 節見出しが h1 なので、塊の小見出しは h2 */}
          <SkillGroups groups={part} level={2} />
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
          <SectionHead title="Career" h1 />
          {/* トップの「できごと」と同じ部品。同じ形のものを2度書かない */}
          <Timeline rows={part} />
        </Screen>
      ),
    })),
  )

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

  const solo = soloMember(members)
  // サイトの画面の列。1人のサイトならこの人の画面はもう入っている（profileOf）
  const none: ItemFilter = { kind: null, member: null }
  const [counts, { screens: site, counted }] = await Promise.all([
    countPublishedByKind(db, member.id),
    siteScreens(db, blocks, members, none, null),
  ])
  const siteList = siteSteps(site, none, solo)

  /*
    個人ページの Contact は外して、サイトの Contact に合流させた。貼られた
    URL は死なせずにそちらへ寄せる（恒久的な移動なので 301）。サイトに
    Contact を置いていなければ、寄せる先が無いので「その URL は無い」
  */
  if (want?.key === 'contact' && want.page === 1) {
    const contact = siteList.find((step) => step.navKey === 'contact')
    return contact ? c.redirect(contact.canonical, 301) : c.notFound()
  }

  /*
    1枚目は /members/<slug> だけで開く。1枚目の key は空文字なので、名指し
    （3語目。/members/<slug>/hero のような）では当たらない
  */
  const asked =
    want === null ? memberHref(member.slug, '') : memberHref(member.slug, want.key, want.page)

  /*
    1人のサイトのプロフィール。この人の画面はサイトの列そのものに並んでいる
    （screenList）ので、そこから引いてそのまま連ねる——前後も目次も通し番号も
    サイトの連なりのもの。帯は付けない（ProfileScreen を見ること）。

    構造化データは列の先頭にだけ載せる（firstOnly）。プロフィールは入口より
    後ろに並ぶので、ふつうは載らない——サイトの名乗り（入口の Person）と同じ
    人を、連なりの途中でもう一度名乗らない。
  */
  if (counted.profile) {
    const at = stepAt(siteList, asked)
    const seq = sequence(siteList, at)
    const current = site[at]
    if (!seq || current?.kind !== 'profile') return c.notFound()
    return screenPage(c, seq, {
      node: current.screen.node,
      description: current.screen.description,
      jsonLd: firstOnly(seq, siteJsonLd(members)),
      theme,
      sidebar: <SiteIdentity solo={solo} />,
      adminPath: `/admin/members/${member.id}/edit`,
    })
  }

  /*
    この人の一覧への帯。カードをここに複製せず、絞り込んだ一覧の1画面目へ送る。
    行き先と件数の決め方は bandOf を見ること。

    1人のサイトでは ?member= を付けない。readFilter が読まない（名前のピルが
    無い）ので、付けても効かない URL が1本増えるだけになる。
  */
  const band = bandOf(
    blocks,
    counts,
    filterQuery({ kind: null, member: members.length > 1 ? member.slug : null }),
  )

  const screens = memberScreens(
    member,
    band ? (
      <Band href={band.href} label="このメンバーのつくったもの" app={band.app} work={band.work} />
    ) : null,
  )
  const own = screens.map((screen) => memberStep(member, screen, TEAM_TOC))

  const index = stepAt(own, asked)
  const step = own[index]
  const current = screens[index]
  if (!step || !current) return c.notFound()

  /*
    めくる列。サイトの列の Team（割られていれば最後の画面）の直後に、この人の
    画面を差し込む。1枚目の「←」は Team へ、最後の画面の「→」は Team の次の
    節（ふつうは Contact）へ出る。Team の画面自身の「次」は変えない——個人
    ページはカードから入る脇の道で、何人いても Team の次は Contact のまま。

    目次もこの列から取る。この人の画面は目次に行を持たず（TEAM_TOC）、印は
    Team に付く——作品1件のページが「載っている一覧」に印を付けるのと同じ
    借り方で、印を付ける手続きは sequence に任せる。

    Team を置いていないサイト（カードの担当者名から入る）では差し込む先が
    無いので、めくるのはこの人の画面だけ。目次はサイトのまま（印は無い）。
  */
  const teamEnd = siteList.map((one) => one.navKey).lastIndexOf('team')
  const around =
    teamEnd < 0
      ? [...siteList, ...own]
      : [...siteList.slice(0, teamEnd + 1), ...own, ...siteList.slice(teamEnd + 1)]
  const spliced = sequence(around, (teamEnd < 0 ? siteList.length : teamEnd + 1) + index)
  const pager = teamEnd < 0 ? (sequence(own, index)?.pager ?? null) : (spliced?.pager ?? null)

  // index は個人ページの中での位置。0（1枚目）にだけ構造化データが載る
  const seq: Sequence = { index, current: step, nav: spliced?.nav ?? [], pager }

  return screenPage(c, seq, {
    node: current.node,
    // 説明文もその画面のもの（memberScreens が画面ごとに持っている）
    description: current.description,
    jsonLd: firstOnly(seq, {
      '@context': 'https://schema.org',
      ...personJsonLd(member, `${SITE.origin}/members/${member.slug}`, {
        // sameAs はこの文書の外で読まれる。相対の URL や javascript: は載せない
        ...(isHttpsUrl(member.github) ? { sameAs: [member.github] } : {}),
        // 1人のサイトなら器は無い。2人目が公開された日に戻る
        ...(solo
          ? {}
          : { worksFor: { '@type': 'Organization', name: SITE.name, url: SITE.origin } }),
      }),
    }),
    theme,
    // 柱はサイトのもの。個人ページだけの柱に入れ替えると、別のサイトへ飛んだように見える
    sidebar: <SiteIdentity solo={solo} />,
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
  Apps と Works は Projects の1つの一覧にまとめた。貼られた一覧の URL は
  死なせずに、同じ区分で絞り込んだ Projects の1画面目へ寄せる（恒久的な移動
  なので 301）。

  ページ数（/apps/3）は引き継がない。区分を混ぜて新しい順に並べ直したので、
  同じ番号の画面に同じカードは載っていない。メンバーの絞り込み（?member=）は
  引き継ぐ——個人ページの帯から貼られた URL がそれを持っている。

  作品1件の恒久リンク（/apps/item/<slug>）は上の2本がそのまま受けるので、
  ここでは寄せない。catch-all（/:screen）より前に置くこと。
*/
for (const [list, kind] of [
  ['apps', 'app'],
  ['works', 'work'],
] as const) {
  const moved = (c: Context<AppEnv>) =>
    c.redirect(`/projects${filterQuery({ kind, member: c.req.query('member') ?? null })}`, 301)
  publicRoutes.get(`/${list}`, moved)
  publicRoutes.get(`/${list}/:page`, moved)
}

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
  const [members, blocks, items] = await Promise.all([
    listPublishedMembers(db),
    publishedBlocks(db),
    listPublishedItems(db),
  ])

  // 絞り込みを付けない素のサイト。?kind= 付きの URL は正ではないので載せない
  const { screens } = await siteScreens(db, blocks, members, { kind: null, member: null }, null)

  const paths = [
    /*
      入口。置いたものが全部下書きでも 200 で「まだ何も置いていません」を出す
      （オーナーが自分のサイトから締め出されないための分岐）ので、画面の列が
      空でもここは在る。例外は列の先頭がプロフィールのとき（1人のサイトで
      Hero を外し Team を先頭に置いた構成）で、/ はその1枚目へ送るだけなので
      載せない——送る元の URL を並べない（/apps や /team と同じ）。
    */
    ...(screens[0]?.kind === 'profile' ? [] : ['/']),
    /*
      トップの画面。並べるのは href ではなく canonical——1枚目は / と /<slug> の
      2つの URL で開けるので、正の1つだけを出す（その1枚目の正は上の / と
      同じ文字列になる。重なりは下で落とす）。1人のサイトではプロフィールの
      画面（/members/<slug> …）もここに入り、/team は入らない（301 で寄せる元）。
    */
    ...siteSteps(screens, { kind: null, member: null }).map((step) => step.canonical),
    // 縦に積んだ全体版。正が自分自身になったので、ここに並ぶ資格がある
    '/all',
    /*
      個人ページ。1人のサイトのプロフィールは上のサイトの画面と同じ URL に
      なる（重なりは下で落とす）。Team を置いていないサイトや2人以上のサイトでは、
      ここにしか出てこない
    */
    ...members.flatMap((member) =>
      memberScreens(member, null).map((screen) => memberHref(member.slug, screen.key, screen.page)),
    ),
    // 作品1件の恒久リンク。slug の無い行（列より前からある作品）は URL を持たない
    ...items.flatMap((item) => itemHref(item) ?? []),
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

  いまの KV には画像しか無い（ログイン試行の記録は、パスワードのログインと
  一緒に無くなった）。それでもキーの形は縛る。この URL は KV のキーを
  そのまま外に開く口で、縛らないと、あとから同じ KV に何かを置いた日に
  それが黙って読み出せるようになる（実際、以前は login:<メールアドレス> が
  同居していた）。
  通すのは、こちらが付けた名前の2つの置き場だけ——avatars/（メンバーの顔）と
  items/（作品のスクリーンショット）。名前は src/routes/admin.tsx の putImage が
  付ける形（英数字で始まり、英数字と . _ - だけ）。

  置き場を足すときは、ここの ( | ) に1語足すだけにすること。形の検査
  （名前の文字の種類と、/ を1つしか含まないこと）を緩めて通すと、
  置き場の外のキーや、../ で置き場の外を指すキーが届くようになる。

  **この URL はサイトと同じオリジンで配る。** だから中身が画像のふりをした
  文書（SVG の <script>、HTML）だったときに、開いた人のブラウザで走らせない
  ことをここで決める。受け入れは先頭のバイトで5種類に絞ってある
  （src/lib/image.ts）が、それより前に上げたものが KV に残っている。

  - X-Content-Type-Options: nosniff——中身を嗅いで型を読み替えさせない
  - Content-Security-Policy: default-src 'none'; sandbox——直に開かれても
    スクリプトも読み込みも走らない（<img> で埋め込む分には効かず、邪魔もしない）
  - 5種類に無い content-type（以前の image/svg+xml や image/heic）は
    application/octet-stream の添付として返す。画像としては描かせない
*/
const IMAGE_KEY = /^(?:avatars|items)\/[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/

publicRoutes.get('/images/*', async (c) => {
  const key = c.req.path.replace(/^\/images\//, '')
  if (!IMAGE_KEY.test(key)) return c.notFound()

  const object = await c.env.MEDIA.getWithMetadata<{ contentType?: string }>(key, 'arrayBuffer')
  if (!object.value) return c.notFound()

  const type = object.metadata?.contentType
  return new Response(object.value, {
    headers: {
      ...(isImageType(type)
        ? { 'content-type': type }
        : { 'content-type': 'application/octet-stream', 'content-disposition': 'attachment' }),
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'; sandbox",
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
