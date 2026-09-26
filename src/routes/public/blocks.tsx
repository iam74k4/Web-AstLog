import type { Child } from 'hono/jsx'
import {
  blockLines,
  blockPages,
  blockPerScreen,
  blockTexts,
  blockType,
  itemStory,
  memberUnits,
} from '../../blocks'
import type * as schema from '../../db/schema'
import { KIND_LABEL } from '../../domain'
import { chunk } from '../../lib/paginate'
import { SITE } from '../../site'
import {
  Band,
  Contact,
  FilterLinks,
  Hero,
  HiddenHeading,
  ItemCard,
  ItemStories,
  LinkList,
  langOf,
  MemberCardCompact,
  MemberCardWide,
  MoonField,
  Note,
  NowList,
  Numbers,
  OwnSocials,
  Phrases,
  ProfileWhole,
  Screen,
  ScreenSection,
  SectionHead,
  Statement,
  shotRow,
  Timeline,
  WholeLink,
} from '../../ui/components'
import { siteCountsOf, soloMember, type TopData } from './data'
import {
  countOf,
  describe,
  excerpt,
  joinParts,
  lineDigest,
  metricDigest,
  nameWithRole,
  siteDescription,
} from './meta'

/*
  ブロック1つを描いた結果。

  id は DOM のアンカー（#projects）、slug は URL の1語（/projects）。同じ文字列を
  わざと2つ持たせてある。全体ページは id で、画面ごとの URL は slug で同じ
  節を指すので、どちらか片方だけを変えたくなったときに変える先が見える。

  pages はこのブロックが何画面になるか（src/blocks.ts の blockPages。管理画面の
  「N 画面」と同じ1本）。

  description はこの画面の説明文（<head> に載る）。中身を持っているここで
  作る——呼ぶ側はブロックの中を知らないので、ここで作らないと「サイトの説明」
  しか書けない。
*/
export type Rendered = {
  id: string
  slug: string
  pages: number
  // ページャが名乗る節の名前。目次にもこの名前で並ぶ（toc が false なら並ばない）
  nav: string | null
  /*
    目次に行を持つか。見出しを空けたメモは、ページャでは種類の名前（メモ）で
    名乗るが、目次には並べない——目次は目に見える見出しの一覧で、画面に
    「メモ」とは書いていない（柱の帯の幅も取らない）
  */
  toc: boolean
  /*
    <title> のうち、この画面の名前の部分（pageTitle に渡す）。割られた画面の
    数え方（countOf）も、名前の無い画面の文の頭（excerpt）もここで作る——
    中身を持っているのはここだけなので。null は入口（サイトの題を使う）
  */
  title: string | null
  description: string
  node: Child
}

/*
  「1行1件」を並べる4つの、列の描き方。ここだけが種類ごとに違う（行の開き方・
  画面への割り方・見出し・説明文・目次の名前は同じなので、renderBlock の分岐は
  1本にまとめてある）。
*/
const ROW_LISTS = {
  now: NowList,
  numbers: Numbers,
  links: LinkList,
  timeline: Timeline,
} as const

// その画面に出す行。page が null（全体ページ）なら割らずに全部
const rowsOn = <T,>(rows: T[], perScreen: number, page: number | null): T[] =>
  page === null ? rows : (chunk(rows, perScreen)[page - 1] ?? [])

/*
  ブロック1つを節に描く。中身が無ければ null を返し、節ごと出さない
  （見出しだけ残さない）。

  決まった中身のもの（projects・team …）は id を type と同じにして、
  #projects のようなアンカーと /projects という URL の1語を保つ。
  打ち込むものは block-<id>（この名前の形は routes.ts の SCREEN_NAME も知っている）。

  page は「このブロックの何画面目か」（1始まり）。null なら割らずに全件を出す
  ——全体ページ（/all）はこちら。範囲の外なら null（呼ぶ側はそれを404 にする）。

  Projects の行は、呼ぶ側が limit / offset で切って渡す（ここでは切らない）。
  画面の枚数を数えるためだけに呼ぶとき（site.ts の screenList）は行が空で、
  描いた節はそのまま捨てられる。枚数は blockPages が決め、節の有無もその数で
  決める——別々に数えると「節は出ないのに URL だけある」画面ができる。
*/
export function renderBlock(
  block: schema.Block,
  data: TopData,
  page: number | null,
): Rendered | null {
  const type = blockType(block.type)
  if (!type) return null
  const { members, projects, kinds, filter, showMember, band } = data
  const pages = blockPages(block, siteCountsOf(data))
  if (pages === 0 || (page !== null && page > pages)) return null

  const id = type.kind === 'fixed' ? type.key : `block-${block.id}`
  // 見出しが空なら、フォームの初期値と同じ名前（それも無ければ種類の名前）
  const title = block.title || ('title' in type && type.title) || type.label
  // 画面まるごとのブロック（hero・contact・ひとこと）は perScreen を持たない
  const perScreen = blockPerScreen(type.key)
  /*
    割られた画面（1画面 = 1ドキュメント）かどうか。節の見出しはここで h1 に
    上がる。全体ページ（/all）だけが page === null で、そちらは Hero の h1 に
    節が h2 でぶら下がる1つの文書のまま。
  */
  const split = page !== null

  // この画面の番号（全体ページでは割らないので 1 として数える）
  const at = page ?? 1

  switch (block.type) {
    case 'hero': {
      const solo = soloMember(members)
      return {
        id,
        slug: id,
        pages,
        nav: null,
        toc: false,
        title: null,
        // 入口はサイトそのものの画面。名乗りと同じ文をそのまま出す
        description: describe(siteDescription(solo)),
        node: (
          <>
            <Hero whole={!split}>
              {/*
                背景の月は割られた画面にだけ敷く。全体ページ（/all）に出さないのは、
                あそこが印刷と Ctrl-F と翻訳の宛先だから——紙に淡い装飾を刷らせない。

                Hero 部品ではなくここに置くのが要。Hero も .hero クラスも個人ページの
                名乗りと共有していて（member-screens.tsx の memberScreens）、あちらに
                埋めるとメンバー全員のページに月が出る。
              */}
              {split ? <MoonField /> : null}
              {/*
                名乗り。1人のサイトならその人の名前と肩書き、そうでなければ
                サイトの名前だけ。標語は置かない（採る側が探しに来るのは人の
                名前と職種）。肩書きは名前の上に小さく添える札で、899 以下で柱から
                畳まれる肩書きも、入口ではここで読める。英字だけの肩書きには
                lang="en"（読み上げの発音と、等幅の札にする印。components.tsx の langOf）
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
                一覧への帯。この画面には作品が1件も無いので、何件あるかを数で
                見せてから送り出す。帯は id も名前も持たない（目次からもページャ
                からも指さない）。題は「つくったもの」——右端が「一覧で見る →」
                なので「一覧」と2度言わない
              */}
              {band ? <Band href={band.href} label="つくったもの" counts={band.counts} /> : null}
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
        （src/db/queries.ts の itemOrder）。区分はカードの札（プラットフォーム /
        業界）と絞り込みのピルで見分ける。

        公開中の項目が1件も無ければ節ごと出さない。絞り込んで0件になっただけの
        ときは出す（blockPages）——ピルごと消えると、絞り込みを外す手が画面から
        無くなる
      */
      // 公開中の項目がある区分が1つだけなら、その区分（見出しの添えになる）
      const soleKind = kinds.length === 1 ? kinds[0] : undefined
      return {
        id,
        slug: id,
        pages,
        nav: 'Projects',
        toc: true,
        title: `Projects${countOf(at, pages)}`,
        /*
          件数と区分は、この画面に出ている絞り込みのピルそのもの。そのあとに、
          いまの画面に載っているカードの名前を並べる——ここが画面ごとに変わるので、
          /projects と /projects/2 が同じ説明にならない。業務のカードは実績値まで
          入れる（カードの .metric にしか無い一文を、検索結果と共有カードにも出す）。
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
                  すぐ下のピル（すべて / 個人開発 / 業務）が同じ言葉を並べる。
                  区分が1つのサイトではピルが並ばない（FilterLinks）ので、何の
                  一覧かを言うのはこの添えだけになる
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
            {/*
              作品の本文。割られた画面では作品ごとの本文の画面（…/story）にしか
              無いので、全体ページ（中身を全部載せる場所）ではカードの下に並べる
            */}
            {split ? null : (
              <ItemStories
                stories={projects.rows.flatMap((item) => {
                  const story = itemStory(item.body)
                  return story.length
                    ? [{ key: item.id, title: item.title, paragraphs: story }]
                    : []
                })}
              />
            )}
          </ScreenSection>
        ),
      }
    }

    case 'team': {
      /*
        1人のサイトのプロフィール。割られた画面としては描かない——その位置には
        この人の画面（/members/<slug> …）が並ぶ（site.ts の screenList）。ここへ
        来るのは全体ページ（/all）だけで、Team のカード1枚の代わりに、プロフィール
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
          toc: true,
          title: 'Profile',
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
      const shown = rowsOn(members, perScreen, page)
      return {
        id,
        slug: id,
        pages,
        nav: 'Team',
        toc: true,
        title: `Team${countOf(at, pages)}`,
        // 人数は数えない（「1 member」と数えて告知しない）。名前と職種を並べる
        description: describe(joinParts('メンバー', shown.map(nameWithRole).join('、'))),
        node: (
          <Screen id={id} label="Team" whole={!split}>
            {/* 添えは置かない。「メンバー」は Team の訳語で、見出しを2度言うだけ */}
            <SectionHead title="Team" h1={split} />
            {/*
              2人なら横長、3人以上でグリッド。人数で決める、画面幅では決めない
              （1人のときは上の data.profile に分かれていて、ここへは来ない）。
              数えるのは総人数で、この画面に載っている人数ではない——7人を2画面に
              割った2画面目が1人だからといって横長に化けると、めくるたびに形が変わる
            */}
            {members.length <= 2 ? (
              <div class="team-list">
                {shown.map((member) => (
                  <MemberCardWide key={member.id} member={member} />
                ))}
              </div>
            ) : (
              <div class="team-grid">
                {shown.map((member) => (
                  <MemberCardCompact key={member.id} member={member} />
                ))}
              </div>
            )}
          </Screen>
        ),
      }
    }

    case 'contact':
      return {
        id,
        slug: id,
        pages,
        nav: 'Contact',
        toc: true,
        title: 'Contact',
        description: describe(SITE.contactLead),
        node: <Contact email={SITE.email} github={SITE.github} split={split} />,
      }

    // ここから打ち込むもの。目次に載せるのは見出しを持つものだけ

    case 'statement':
      return {
        id,
        slug: id,
        pages,
        nav: null,
        toc: false,
        // 名前を持たない画面。題はその一文の頭（入口と同じ題にしない）
        title: excerpt(block.title),
        // 大きく出る一文が、この画面の全部。説明文もそれと添え書きで足りる
        description: describe(joinParts(block.title, blockTexts(block.body).join(' '))),
        node: (
          // 見出しを持たない画面なので region の名前も無い（その一文が見出しそのもの）
          <Screen id={id} whole={!split}>
            <Statement text={block.title} notes={blockTexts(block.body)} h1={split} />
          </Screen>
        ),
      }

    /*
      ここから下は body を1行1件（メモだけは段落）で持つもの。行の開き方は
      src/blocks.ts の blockLines / blockTexts が正——画面の数（blockPages）も
      同じ式を読む。ここで直接 parseLines を書くと、公開側だけ落とす行が
      できた日に、画面の数だけが静かに古いままになる。

      行を並べるだけの4つは、違うのが列の描き方（ROW_LISTS）1つだけなので、
      分岐を1本にしてある。`default` を置かないのは、ブロックの種類を足したときに
      TS2366 で落ちてほしいから（CLAUDE.md「ブロックの種類を増やす」）。
    */
    case 'now':
    case 'numbers':
    case 'links':
    case 'timeline': {
      const rows = rowsOn(blockLines(type.key, block.body), perScreen, page)
      const List = ROW_LISTS[block.type]
      return {
        id,
        slug: id,
        pages,
        nav: title,
        toc: true,
        title: `${title}${countOf(at, pages)}`,
        description: describe(joinParts(title, lineDigest(type.key, rows))),
        node: (
          <Screen id={id} label={title} whole={!split}>
            <SectionHead title={title} h1={split} />
            <List rows={rows} />
          </Screen>
        ),
      }
    }

    /*
      メモ。見出しは空けてよい（段落だけの画面）——管理画面も「空なら『メモ』」と
      言って保存を通す。

      見出しを空けても、名前は種類の名前（title の控え。「メモ」）で持ち、
      読み上げの h1（HiddenHeading）・region の名前・ページャに使う（割られた画面は
      h1 をちょうど1つ持つ）。目に見える見出しは置かない（書いた人が空けた）ので、
      目次にも並べない（toc）。<title> はその画面の最初の段落の頭（「メモ」だと、
      見出しの無いメモどうしが同じ題になる）。
    */
    case 'note': {
      const texts = rowsOn(blockTexts(block.body), perScreen, page)
      const headed = block.title !== ''
      return {
        id,
        slug: id,
        pages,
        nav: title,
        toc: headed,
        title: headed ? `${title}${countOf(at, pages)}` : excerpt(texts[0] ?? title),
        // 段落そのもの。見出しを持たないメモは本文だけで説明になる
        description: describe(joinParts(block.title, texts.join(' '))),
        node: (
          <Screen id={id} label={title} whole={!split}>
            {headed ? (
              <SectionHead title={title} h1={split} />
            ) : (
              <HiddenHeading text={title} h1={split} />
            )}
            <Note paragraphs={texts} />
          </Screen>
        ),
      }
    }
  }
}
