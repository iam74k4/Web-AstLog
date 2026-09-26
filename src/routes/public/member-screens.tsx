import type { Child } from 'hono/jsx'
import { MEMBER_PER_SCREEN, memberUnits } from '../../blocks'
import type * as schema from '../../db/schema'
import { chunk } from '../../lib/paginate'
import type { Step } from '../../lib/sequence'
import {
  Empty,
  Hero,
  Nameplate,
  Note,
  OwnSocials,
  Phrases,
  Screen,
  SectionHead,
  SkillGroups,
  Timeline,
} from '../../ui/components'
import { countOf, describe, joinParts, nameWithRole, pageTitle } from './meta'

/*
  個人ページの画面ひとそろい。トップと同じ規則で、1画面 = 1ドキュメント。

    /members/<slug>          名札と大見出しと、この人の一覧への帯
    /members/<slug>/about    紹介文
    /members/<slug>/skills   技術
    /members/<slug>/career   経歴

  個人ページはサイトの連なりの一部（柱と目次はサイトのまま）。どう連なるかは
  人数で分かれ、組み方は member.tsx の renderMemberScreen と site.ts の
  screenList。ここは画面そのもの（中身・説明文・URL）だけを作る。

  中身の無い画面は作らない（Skills と Career）。トップの「中身が無ければ節ごと
  出さない」がそのまま伸びた形で、URL も目次もページャも一度に消える。
  1画面に入りきらないぶんは次の URL に送る（/members/<slug>/career/2）。
  1画面あたりの件数は src/blocks.ts の MEMBER_PER_SCREEN が正で、割るのは
  src/lib/paginate.ts——トップの perScreen と同じ置き場・同じ割りかた。

  1枚目の key だけが空文字。入口は /members/<slug> ひとつに寄せて、
  /members/<slug>/hero のような2つ目の URL を作らないため。
*/
export type MemberScreen = {
  key: string
  page: number
  // その画面の節（About・Career…）が何画面に割れたか。<title> の数え方に使う
  pages: number
  nav: string | null
  // トップの画面と同じく、画面ごとに違う説明文（同じ1文を配ると検索で見分けられない）
  description: string
  node: Child
}

export const memberHref = (slug: string, key: string, page = 1) =>
  `/members/${slug}${key ? `/${key}` : ''}${page === 1 ? '' : `/${page}`}`

/*
  個人ページの1枚を、連なりの1枚（Step）に写す。1人のサイトのプロフィール
  （site.ts の siteSteps）も、2人以上のサイトの個人ページ（member.tsx）も同じ形。

  navKey は画面ごと（割られた /career/2 も同じ節）。サイトの画面の navKey
  （ブロックの slug）と取り合わないよう、頭に印を付ける。nav はページャが
  名乗る名前で、1枚目は人の名前——About から戻る手が「← 岡崎 昂功」になり、
  Projects の最後の「次」は「岡崎 昂功 →」になる。

  目次の単位（toc）だけが連なり方で変わる。1人のサイトでは「Profile」の1行に
  まとまり、2人以上では行を持たずに Team に印（PROFILE_TOC / TEAM_TOC）。
*/
export const memberStep = (
  member: schema.Member,
  screen: MemberScreen,
  toc: Pick<Step, 'tocKey' | 'tocLabel'>,
): Step => ({
  navKey: `member:${screen.key}`,
  href: memberHref(member.slug, screen.key, screen.page),
  // 個人ページに絞り込みは無いので、正の URL は開いた URL と同じ
  canonical: memberHref(member.slug, screen.key, screen.page),
  nav: screen.nav ?? member.name,
  // 「岡崎 昂功 · About 2 / 2 — Noctifex」。1枚目は名前だけ（pageTitle）
  title: screen.nav
    ? pageTitle(member.name, `${screen.nav}${countOf(screen.page, screen.pages)}`)
    : pageTitle(member.name),
  ...toc,
})

// 1人のサイト。目次は「Profile」の1行で、行き先は1枚目
export const PROFILE_TOC = { tocKey: 'profile', tocLabel: 'Profile' }
// 2人以上のサイト。目次に行を持たず、印は Team に付く（Team を置いていなければ無印）
export const TEAM_TOC = { tocKey: 'team', tocLabel: null }

// band は1枚目に置く一覧への帯（呼ぶ側が決める。1人のサイトのプロフィールでは null）
export function memberScreens(member: schema.Member, band: Child): MemberScreen[] {
  // 開き方は src/blocks.ts の memberUnits が正（管理画面の「N 画面」も同じ式を数える）
  const { bio, skills, career } = memberUnits(member)

  const screens: MemberScreen[] = [
    {
      key: '',
      page: 1,
      pages: 1,
      nav: null,
      // 入口は大見出し（無ければ紹介文の1段落目）
      description: describe(member.headline || bio[0] || `${nameWithRole(member)}のプロフィール`),
      node: (
        <Hero>
          {/*
            名札（顔・名前・肩書きと所在地）。柱はサイトのままなので、その人の
            顔はここにしか出ない。Team のカードと同じ並びにして、カードを押した
            先で同じ顔に着くようにする。

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
            この人だけの連絡先。個人ページの Contact は持たずサイトの Contact に
            合流させたので、サイトと違う行き先を持つ人のぶんはここに置く
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
      screens.push({ key, page: index + 1, pages: parts.length, nav, ...part })
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
          {/* 添えは置かない。訳語（紹介）は見出しを2度言うだけ */}
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
