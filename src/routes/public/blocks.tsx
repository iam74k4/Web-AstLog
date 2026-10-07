import type { Child } from 'hono/jsx'
import { blockLines, blockShown, blockTexts, blockType, itemStory, memberUnits } from '../../blocks'
import type * as schema from '../../db/schema'
import { KIND_LABEL } from '../../domain'
import { SITE } from '../../site'
import {
  Contact,
  Cta,
  Eyebrow,
  FilterLinks,
  Hero,
  HiddenHeading,
  ItemRow,
  ItemStories,
  LinkList,
  MemberCardCompact,
  MemberCardWide,
  Note,
  NowList,
  Numbers,
  OrbitSystem,
  OwnSocials,
  Phrases,
  ProfileWhole,
  Screen,
  ScreenSection,
  SectionHead,
  Statement,
  Tally,
  Timeline,
} from '../../ui/components'
import { rowNumber, siteCountsOf, soloMember, type TopData } from './data'
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
  // 独立ページの目次に出す名前。入口だけはロゴがその役目を持つ
  nav: string | null
  /*
    全体ページの目次に行を持つか。1つの文書では目に見える見出しだけを並べる。
    独立ページの目次は、見出しの有無に関わらず行き先を持つ
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
export function renderBlock(
  block: schema.Block,
  data: TopData,
  whole: boolean,
  options: { projectsBase?: string } = {},
): Rendered | null {
  const type = blockType(block.type)
  if (!type || !blockShown(block, siteCountsOf(data))) return null
  const { members, projects, kinds, filter, showMember, band } = data
  const site = data.site ?? SITE

  const id = type.kind === 'fixed' ? type.key : `block-${block.id}`
  // 見出しが空なら、フォームの初期値と同じ名前（それも無ければ種類の名前）
  const title = block.title || ('title' in type && type.title) || type.label

  switch (block.type) {
    case 'hero': {
      const solo = soloMember(members)
      const name = solo?.name ?? SITE.name
      /*
        全体ページ（/all）の頭。印刷・Ctrl-F・翻訳の宛先なので、誰のサイトかを
        目に見える h1 で置く——1人のサイトならその人の名前と肩書き、そうでなければ
        サイトの名前だけ。軌道図は置かない（紙に装飾を刷らせない）。英字だけの
        肩書きには lang="en"（読み上げの発音と、等幅の札にする印。langOf）。
      */
      if (whole) {
        return {
          id,
          slug: id,
          nav: null,
          toc: false,
          title: null,
          description: describe(siteDescription(solo, site)),
          node: (
            <Hero>
              {solo?.role ? <Eyebrow parts={[solo.role]} /> : null}
              <h1>
                <Phrases text={name} />
              </h1>
              <p class="hero__lead">
                <Phrases text={site.heroLead} />
              </p>
            </Hero>
          ),
        }
      }
      /*
        入口。5天体共通で左に大見出しとリード文と一覧への1本、右に天体の画像、
        底に件数の帯。旧軌道図は DOM に残るが表紙では非表示。

        大見出しは1人のサイトならその人の大見出し（members.headline。無ければ名前）、
        2人以上ならサイトの一言。名前を真ん中に据えた前の入口は、持ち主が「ださい。
        Profile で出る」と外した——名乗りは足元（SiteIdentity）と Profile が受ける。
        大見出しの上の札は「職種 — 所在地」（採る側が最初に探すもの）。

        一覧への1本と件数の帯は、一覧（Projects）のページがあって作品があるときだけ
        （data.ts の bandOf。0件の知らせだけのページへ送らない）。件数の帯のいちばん古い年
        （Since）は、公開中の作品の年を DB で集約した値（site.ts の pageRows）から。
        作品へは「一覧で見る →」から。
      */
      const statement = solo ? solo.headline || solo.name : site.tagline
      const eyebrow = solo ? [solo.role, solo.location].filter(Boolean) : []
      return {
        id,
        slug: id,
        nav: type.label,
        toc: false,
        title: null,
        // 入口はサイトそのもののページ。名乗りと同じ文をそのまま出す
        description: describe(siteDescription(solo, site)),
        node: (
          <Hero orbit celestial={solo ?? undefined}>
            <div class="hero__copy">
              {eyebrow.length ? <Eyebrow parts={eyebrow} /> : null}
              <h1>
                <Phrases text={statement} />
              </h1>
              <p class="hero__lead">
                <Phrases text={site.heroLead} />
              </p>
              {band ? <Cta href={band.href}>一覧で見る</Cta> : null}
            </div>
            <OrbitSystem counts={data.counts} member={solo ?? undefined} />
            {band ? <Tally counts={band.counts} since={projects.since ?? null} /> : null}
          </Hero>
        ),
      }
    }

    case 'projects': {
      /*
        個人開発（app）と業務（work）を1つの一覧に並べる。並びは新しい順
        （src/db/queries.ts の itemOrder）。区分は行の札（プラットフォーム /
        業界・区分）と絞り込みで見分ける。

        公開中の項目が1件も無ければ節ごと出さない。絞り込んで0件になっただけの
        ときは出す（blockShown）——絞り込みごと消えると、それを外す手がページから
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
          件数と区分は、このページに出ている絞り込みそのもの。そのあとに、
          行の名前を並べる。実績値のある行は実績値まで入れる（行の .metric に
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
                  添えは、区分の絞り込みが無いときだけ。区分が2つあるサイトでは
                  隣の絞り込み（すべて / 個人開発 / 業務）が同じ言葉を並べる。
                  区分が1つのサイトでは絞り込みが並ばない（FilterLinks）ので、何の
                  一覧かを言うのはこの添えだけになる。見出しのすぐ後ろには、
                  いま並んでいる行の数（count）
                */}
                <SectionHead
                  title="Projects"
                  note={soleKind ? KIND_LABEL[soleKind] : undefined}
                  count={projects.rows.length}
                  h1={!whole}
                />
                {/*
                  全体ページには絞り込みを置かない。中身を全部載せる場所で、絞り込みの手は
                  Projects のページ（/projects?kind=…）へ移るリンクになり、「すべて」の印
                  （aria-current）が別のページを「いまのページ」と名乗っていた
                */}
                {whole ? null : (
                  <FilterLinks
                    base={options.projectsBase ?? `/${id}`}
                    kinds={kinds}
                    members={members.map((member) => ({ slug: member.slug, name: member.name }))}
                    filter={filter}
                  />
                )}
              </>
            }
          >
            {projects.rows.length ? (
              /*
                番号付きの行を縦に並べる（索引）。番号は公開中の全件の並びでの位置で、
                絞り込んでも絞り込む前の番号のまま（rowNumber。同じ作品がどの絞り込みでも同じ番号）
              */
              <div class="entries">
                {projects.rows.map((item, order) => (
                  <ItemRow
                    key={item.id}
                    item={item}
                    number={rowNumber(projects, item, order)}
                    showMember={showMember}
                  />
                ))}
              </div>
            ) : (
              <p class="filter-empty">この条件に当てはまるものはまだありません</p>
            )}
            {/*
              作品の本文。ページごとの URL では作品のページの小節（#story）にしか
              無いので、全体ページ（中身を全部載せる場所）では一覧の行の下に並べる
            */}
            {whole ? (
              <ItemStories
                stories={projects.rows.flatMap((item) => {
                  const parts = itemStory(item)
                  return parts.length ? [{ key: item.id, title: item.title, parts }] : []
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
                <OwnSocials member={person} site={site} />
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
        description: describe(site.contactLead),
        node: (
          <Contact
            lead={site.contactLead}
            email={site.email}
            github={site.github}
            counts={data.counts}
            whole={whole}
            member={soloMember(members) ?? undefined}
          />
        ),
      }

    // 打ち込むもの。独立ページには必ず目次の行き先を持たせる

    case 'statement':
      return {
        id,
        slug: id,
        nav: type.label,
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
      全体ページの目次には並べない（toc）。<title> は最初の段落の頭（「メモ」だと、見出しの
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
