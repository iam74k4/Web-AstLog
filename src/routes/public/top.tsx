import { drizzle } from 'drizzle-orm/d1'
import type { Context } from 'hono'
import {
  countPublishedByKind,
  listPublishedItems,
  listPublishedMembers,
  loadTheme,
  publishedBlocks,
} from '../../db/queries'
import * as schema from '../../db/schema'
import { ITEM_KIND_KEYS, type KindCounts } from '../../domain'
import type { AppEnv } from '../../env'
import { sequence, stepAt } from '../../lib/sequence'
import { SITE } from '../../site'
import { Empty, SiteIdentity } from '../../ui/components'
import { Layout, type NavItem } from '../../ui/Layout'
import { renderBlock } from './blocks'
import {
  kindsOf,
  NO_FILTER,
  profileOf,
  readFilter,
  showMemberOf,
  soloMember,
  type TopData,
} from './data'
import { memberHref } from './member-screens'
import {
  describe,
  joinParts,
  nameWithRole,
  pageTitle,
  siteDescription,
  siteJsonLd,
  siteTitle,
} from './meta'
import { adminHref, blockAdminPath, firstOnly, screenPage } from './page'
import { screenHref, screenRows, siteScreens, siteSteps, stepQuery } from './site'

/*
  公開ブロックを1つのドキュメントに縦に積んだ「全体ページ」（/all）の描画。

  印刷・Ctrl-F・ブラウザ翻訳の宛先、オーナーが全体を通しで点検する手段、
  そして画面ごとの組み立てが効かない環境での退避先を、これ1本でまかなう。
  だから縦に伸びてよい（body[data-whole]）。画面に収める外枠はここには当てない。
*/
export async function renderWholePage(c: Context<AppEnv>) {
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
  const counts = Object.fromEntries(
    ITEM_KIND_KEYS.map((kind) => [kind, items.filter((item) => item.type === kind).length]),
  ) as KindCounts
  const data: TopData = {
    members,
    kinds: kindsOf(counts),
    filter: NO_FILTER,
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
    .filter((section) => section.nav !== null && section.toc)
    .map((section) => ({ href: `#${section.id}`, label: section.nav ?? '' }))

  const solo = soloMember(members)

  return c.html(
    <Layout
      // 入口と同じ題にしない（履歴と検索結果で、全体版を選び直せるように）
      title={solo ? pageTitle(nameWithRole(solo), '全体') : pageTitle('全体')}
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
        正はこのページ自身。画面ごとの URL がそれぞれ自分を正と名乗っているので、
        中身が全部ある唯一のページも自分を名乗る（/ を正にすると、完全版を
        「作品を1件も含まないトップの複製」と申告することになる）。
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
  画面1つぶんの描画。公開ページの本体。

  want が null ならトップ（列の先頭）。そうでなければ URL が名指しした画面で、
  見つからなければ 404。知らない画面名も、範囲の外のページ数も、
  「その URL は無い」の一言に落とす。絞り込みで画面が減ったあとの続き（業務が
  1画面ぶんしか無いときの /projects/3?kind=work）も同じ扱い。目次にもページャにも
  出てこないので、たどり着くのは URL を手で書いたときだけ。
*/
export async function renderScreen(
  c: Context<AppEnv>,
  want: { slug: string; page: number } | null,
) {
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
  // siteScreens が数えた画面なので、ここで null は返らない
  if (!rendered) return c.notFound()

  /*
    入口の帯（一覧へ送る丸い札）が、ページャの「次 →」と同じ行き先なら、
    入口にはページャを出さない（CLAUDE.md「同じ行き先を1つの画面に2つ置かない」）。
    札のほうを残すのは、件数（個人開発 5 · 業務 2）を添えて何があるかを先に
    見せるから。

    落とすのは「前」が無いとき（入口が連なりの先頭）だけ——入口のページャは
    「前」も数も持たないので、落としても何も失わない。行き先が違うとき（入口と
    Projects の間にひとことを置いた構成）は、ページャが次の画面へ、帯が一覧へ、
    と別の道なので両方出す。作品の1枚目の「くわしく読む →」はページャの「次 →」と
    同じ行き先だが、あちらのページャは作品の数（Projects 3 / 7）を持つので落とさない
    （item.tsx）。
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
      // 入口（Hero）では柱に名乗らない。Contact では柱の GitHub / メールを出さない（SiteIdentity）
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
