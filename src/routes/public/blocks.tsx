import type { Child } from 'hono/jsx'
import {
  blockLines,
  blockShown,
  blockTexts,
  blockType,
  itemStory,
  memberUnits,
  PROJECT_COLUMNS,
} from '../../blocks'
import type * as schema from '../../db/schema'
import { KIND_LABEL } from '../../domain'
import { chunk } from '../../lib/format'
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
  わざと2つ持たせてある。全体ページは id で、ページごとの URL は slug で同じ
  節を指すので、どちらか片方だけを変えたくなったときに変える先が見える。

  description はこのページの説明文（<head> に載る）。中身を持っているここで
  作る——呼ぶ側はブロックの中を知らないので、ここで作らないと「サイトの説明」
  しか書けない。
*/
export type Rendered = {
  id: string
  slug: string
  // 節の名前。目次にもこの名前で並ぶ（toc が false なら並ばない）
  nav: string | null
  /*
    目次に行を持つか。見出しを空けたメモは、名前を種類の名前（メモ）で持つが、
    目次には並べない——目次は目に見える見出しの一覧で、ページに「メモ」とは
    書いていない（柱の帯の幅も取らない）
  */
  toc: boolean
  /*
    <title> のうち、このページの名前の部分（pageTitle に渡す）。名前の無いページの
    文の頭（excerpt）もここで作る——中身を持っているのはここだけなので。
    null は入口（サイトの題を使う）
  */
  title: string | null
  description: string
  node: Child
}

/*
  「1行1件」を並べる4つの、列の描き方。ここだけが種類ごとに違う（行の開き方・
  見出し・説明文・目次の名前は同じなので、renderBlock の分岐は1本にまとめてある）。
*/
const ROW_LISTS = {
  now: NowList,
  numbers: Numbers,
  links: LinkList,
  timeline: Timeline,
} as const

/*
  ブロック1つを節に描く。中身が無ければ null を返し、節ごと出さない
  （見出しだけ残さない）。

  決まった中身のもの（projects・team …）は id を type と同じにして、
  #projects のようなアンカーと /projects という URL の1語を保つ。
  打ち込むものは block-<id>（この名前の形は routes.ts の PAGE_NAME も知っている）。

  whole は「全体ページ（/all）の1節として描くか」。false ならブロック1つが1ページ
  （1ページ = 1ドキュメント）で、節の見出しはここで h1 に上がる。全体ページでは
  Hero の h1 に節が h2 でぶら下がる1つの文書になる。

  Projects の行は、呼ぶ側が絞り込んで渡す（ここでは切らない）。ページの並びを
  組むためだけに呼ぶとき（site.ts の pageList）は行が空で、描いた節はそのまま
  捨てられる。節を出すかどうかは blockShown が決める——別々に決めると「節は
  出ないのに URL だけある」ページができる。
*/
export function renderBlock(block: schema.Block, data: TopData, whole: boolean): Rendered | null {
  const type = blockType(block.type)
  if (!type || !blockShown(block, siteCountsOf(data))) return null
  const { members, projects, kinds, filter, showMember, band } = data

  const id = type.kind === 'fixed' ? type.key : `block-${block.id}`
  // 見出しが空なら、フォームの初期値と同じ名前（それも無ければ種類の名前）
  const title = block.title || ('title' in type && type.title) || type.label

  switch (block.type) {
    case 'hero': {
      const solo = soloMember(members)
      return {
        id,
        slug: id,
        nav: null,
        toc: false,
        title: null,
        // 入口はサイトそのもののページ。名乗りと同じ文をそのまま出す
        description: describe(siteDescription(solo)),
        node: (
          <Hero>
            {/*
              背景の月は入口のページにだけ敷く。全体ページ（/all）に出さないのは、
              あそこが印刷と Ctrl-F と翻訳の宛先だから——紙に淡い装飾を刷らせない。

              Hero 部品ではなくここに置くのが要。Hero も .hero クラスも個人ページの
              名乗りと共有していて（member-page.tsx の memberPage）、あちらに
              埋めるとメンバー全員のページに月が出る。
            */}
            {whole ? null : <MoonField />}
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
              一覧への帯。このページには作品が1件も無いので、何件あるかを数で
              見せてから送り出す。帯は id も名前も持たない（目次からは指さない）。
              題は「つくったもの」——右端が「一覧で見る →」なので「一覧」と2度言わない
            */}
            {band ? <Band href={band.href} label="つくったもの" counts={band.counts} /> : null}
            {/*
              全体ページ（/all）への控えめな1本。柱の足元の同じ行き先は 899 以下で
              畳まれるので、入口の本文にも置く（WholeLink）。全体ページの Hero には
              出さない——自分への行き先になる
            */}
            {whole ? null : <WholeLink />}
          </Hero>
        ),
      }
    }

    case 'projects': {
      /*
        個人開発（app）と業務（work）を1つの一覧に並べる。並びは新しい順
        （src/db/queries.ts の itemOrder）。区分はカードの札（プラットフォーム /
        業界）と絞り込みのピルで見分ける。

        公開中の項目が1件も無ければ節ごと出さない。絞り込んで0件になっただけの
        ときは出す（blockShown）——ピルごと消えると、絞り込みを外す手がページから
        無くなる
      */
      // 公開中の項目がある区分が1つだけなら、その区分（見出しの添えになる）
      const soleKind = kinds.length === 1 ? kinds[0] : undefined
      return {
        id,
        slug: id,
        nav: 'Projects',
        toc: true,
        title: 'Projects',
        /*
          件数と区分は、このページに出ている絞り込みのピルそのもの。そのあとに、
          カードの名前を並べる。業務のカードは実績値まで入れる（カードの .metric に
          しか無い一文を、検索結果と共有カードにも出す）。
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
                  h1={!whole}
                />
                <FilterLinks
                  base={`/${id}`}
                  kinds={kinds}
                  members={members.map((member) => ({ slug: member.slug, name: member.name }))}
                  filter={filter}
                />
              </>
            }
          >
            {projects.rows.length ? (
              /*
                列の数はサーバーが決める（src/blocks.ts の PROJECT_COLUMNS）。CSS は
                repeat(var(--cols), …) と書くだけで数を持たない（app.css の「600px 以上」）
              */
              <div class="grid" style={`--cols:${PROJECT_COLUMNS}`}>
                {/*
                  サムネイルの枠は行ごとに決める（ItemCard の framed）。行は
                  PROJECT_COLUMNS 件ずつ——grid が並べる1行と同じ区切り
                */}
                {chunk(projects.rows, PROJECT_COLUMNS).flatMap((row) => {
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
              作品の本文。ページごとの URL では作品のページの小節（#story）にしか
              無いので、全体ページ（中身を全部載せる場所）ではカードの下に並べる
            */}
            {whole ? (
              <ItemStories
                stories={projects.rows.flatMap((item) => {
                  const story = itemStory(item.body)
                  return story.length
                    ? [{ key: item.id, title: item.title, paragraphs: story }]
                    : []
                })}
              />
            ) : null}
          </ScreenSection>
        ),
      }
    }

    case 'team': {
      /*
        1人のサイトのプロフィール。ページとしては描かない——その位置には
        この人のページ（/members/<slug>）が並ぶ（site.ts の pageList）。ここへ
        来るのは全体ページ（/all）だけで、Team のカード1枚の代わりに、プロフィール
        そのものを1つの節として置く。id も目次の名前も Profile にそろえる
        （ページごとの URL の目次と同じ名前で、同じ中身を指す）。
      */
      if (data.profile) {
        if (!whole) return null
        const person = data.profile
        return {
          id: 'profile',
          slug: 'profile',
          nav: 'Profile',
          toc: true,
          title: 'Profile',
          description: describe(`${person.name}のプロフィール`),
          node: (
            <Screen id="profile" label="Profile">
              <SectionHead title="Profile" />
              <ProfileWhole member={person} {...memberUnits(person)}>
                <OwnSocials member={person} />
              </ProfileWhole>
            </Screen>
          ),
        }
      }
      return {
        id,
        slug: id,
        nav: 'Team',
        toc: true,
        title: 'Team',
        // 人数は数えない（「1 member」と数えて告知しない）。名前と職種を並べる
        description: describe(joinParts('メンバー', members.map(nameWithRole).join('、'))),
        node: (
          <Screen id={id} label="Team">
            {/* 添えは置かない。「メンバー」は Team の訳語で、見出しを2度言うだけ */}
            <SectionHead title="Team" h1={!whole} />
            {/*
              2人なら横長、3人以上でグリッド。人数で決める、画面幅では決めない
              （1人のときは上の data.profile に分かれていて、ここへは来ない）
            */}
            {members.length <= 2 ? (
              <div class="team-list">
                {members.map((member) => (
                  <MemberCardWide key={member.id} member={member} />
                ))}
              </div>
            ) : (
              <div class="team-grid">
                {members.map((member) => (
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
        nav: 'Contact',
        toc: true,
        title: 'Contact',
        description: describe(SITE.contactLead),
        node: <Contact email={SITE.email} github={SITE.github} whole={whole} />,
      }

    // ここから打ち込むもの。目次に載せるのは見出しを持つものだけ

    case 'statement':
      return {
        id,
        slug: id,
        nav: null,
        toc: false,
        // 名前を持たないページ。題はその一文の頭（入口と同じ題にしない）
        title: excerpt(block.title),
        // 大きく出る一文が、このページの全部。説明文もそれと添え書きで足りる
        description: describe(joinParts(block.title, blockTexts(block.body).join(' '))),
        node: (
          // 見出しを持たないページなので region の名前も無い（その一文が見出しそのもの）
          <Screen id={id}>
            <Statement text={block.title} notes={blockTexts(block.body)} h1={!whole} />
          </Screen>
        ),
      }

    /*
      ここから下は body を1行1件（メモだけは段落）で持つもの。行の開き方は
      src/blocks.ts の blockLines / blockTexts が正——ページに出るか（blockShown）も
      同じ式を読む。ここで直接 parseLines を書くと、公開側だけ落とす行が
      できた日に、管理画面の「出る / 出ない」だけが静かに古いままになる。

      行を並べるだけの4つは、違うのが列の描き方（ROW_LISTS）1つだけなので、
      分岐を1本にしてある。`default` を置かないのは、ブロックの種類を足したときに
      TS2366 で落ちてほしいから（CLAUDE.md「ブロックの種類を増やす」）。
    */
    case 'now':
    case 'numbers':
    case 'links':
    case 'timeline': {
      const rows = blockLines(type.key, block.body)
      const List = ROW_LISTS[block.type]
      return {
        id,
        slug: id,
        nav: title,
        toc: true,
        title,
        description: describe(joinParts(title, lineDigest(type.key, rows))),
        node: (
          <Screen id={id} label={title}>
            <SectionHead title={title} h1={!whole} />
            <List rows={rows} />
          </Screen>
        ),
      }
    }

    /*
      メモ。見出しは空けてよい（段落だけのページ）——管理画面も「空なら『メモ』」と
      言って保存を通す。

      見出しを空けても、名前は種類の名前（title の控え。「メモ」）で持ち、
      読み上げの h1（HiddenHeading）と region の名前に使う（ページは h1 を
      ちょうど1つ持つ）。目に見える見出しは置かない（書いた人が空けた）ので、
      目次にも並べない（toc）。<title> は最初の段落の頭（「メモ」だと、見出しの
      無いメモどうしが同じ題になる）。
    */
    case 'note': {
      const texts = blockTexts(block.body)
      const headed = block.title !== ''
      return {
        id,
        slug: id,
        nav: title,
        toc: headed,
        title: headed ? title : excerpt(texts[0] ?? title),
        // 段落そのもの。見出しを持たないメモは本文だけで説明になる
        description: describe(joinParts(block.title, texts.join(' '))),
        node: (
          <Screen id={id} label={title}>
            {headed ? (
              <SectionHead title={title} h1={!whole} />
            ) : (
              <HiddenHeading text={title} h1={!whole} />
            )}
            <Note paragraphs={texts} />
          </Screen>
        ),
      }
    }
  }
}
