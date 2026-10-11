import type { Child } from 'hono/jsx'
import { memberUnits } from '../../blocks'
import type * as schema from '../../db/schema'
import { SITE, type SiteSettings } from '../../site'
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
import { describe, nameWithRole } from './meta'

/*
  個人ページ（/members/<slug>）の中身。1ページに縦に並べる。

    名札・大見出し（Hero）      h1 は大見出し、無ければ名札の名前
    About   #about              紹介文（h2）
    Skills  #skills             技術（h2。塊の小見出しは h3）
    Career  #career             経歴（h2）

  以前は4つを別々の URL（/members/<slug>/about …）に割り、画面の底の左右の手で
  めくっていた。持ち主が触って「面倒すぎる」と判断したので1ページにまとめた
  （CLAUDE.md の「公開ページは縦に読む」）。前の URL は member.tsx が
  #about などへ 301 で送る（MEMBER_SECTIONS）。

  個人ページはサイトの並びの一部（上の帯と足元はサイトのまま）。1人のサイトでは
  サイトの並びに「Profile」として入り、2人以上のサイトでは Team の続き（目次の印は
  Team）。組み方は member.tsx の renderMemberScreen と site.ts の pageList。ここは
  中身と説明文だけを作る。

  中身の無い小節は作らない（Skills と Career）。トップの「中身が無ければ節ごと
  出さない」と同じで、見出しだけ残さない。About だけは空でも置く（「準備中です」）
  ——名札の下に何も無いと、まだ書いていないのか読み込みに失敗したのかが分からない。
*/

// 個人ページの URL。前の続き（/about …）はもう無いので、slug だけで決まる
export const memberHref = (slug: string) => `/members/${slug}`

// 前の個人ページの続きの名前。どれもいまはページの中の小節の id
export const MEMBER_SECTIONS = ['about', 'skills', 'career'] as const
export type MemberSection = (typeof MEMBER_SECTIONS)[number]

/*
  前の続きの URL の行き先。小節があれば #about など、無くなっていれば（技術を
  消した人の /skills）ページの頭。どちらもそのページの中にある。
*/
export function memberSectionHref(member: schema.Member, section: MemberSection) {
  const { skills, career } = memberUnits(member)
  const present = section === 'about' || (section === 'skills' ? skills.length : career.length) > 0
  return `${memberHref(member.slug)}${present ? `#${section}` : ''}`
}

// band は名札の下に置く一覧への帯（呼ぶ側が決める。1人のサイトのプロフィールでは null）
/*
  titled は「この人の大見出しを入口がもう出しているか」（1人のサイトのその人。入口の大見出しは
  その人の headline）。そのときは大見出しを置かず、名札の名前を大きな h1 にする——入口と
  個人ページの h1 が同じ一文になり、2つのページが同じ頭を持った
*/
export function memberPage(
  member: schema.Member,
  band: Child,
  site: SiteSettings = SITE,
  titled = false,
) {
  // 開き方は src/blocks.ts の memberUnits が正（全体ページの Profile の節も同じ式を読む）
  const { bio, skills, career } = memberUnits(member)

  /*
    説明文は大見出し（無ければ紹介文の1段落目）。ページの頭に出ている文で、
    検索結果と共有カードにもそれが出る
  */
  const description = describe(member.headline || bio[0] || `${nameWithRole(member)}のプロフィール`)

  const node = (
    <>
      <Hero profile>
        {/*
          名札（顔・名前・肩書きと所在地）。足元はサイトのままなので、その人の
          顔はここにしか出ない。Team のカードと同じ並びにして、カードを押した
          先で同じ顔に着くようにする。

          見出し（h1）は大見出しがあればそれ、無ければ名札の名前。どちらでも
          このページの中で完結する1つの h1 になる
        */}
        <Nameplate member={member} heading={titled || !member.headline} title={titled} />
        {member.headline && !titled ? (
          <h1 class="hero__headline">
            <Phrases text={member.headline} />
          </h1>
        ) : null}
        {/*
          この人だけの連絡先。個人ページの Contact は持たずサイトの Contact に
          合流させたので、サイトと違う行き先を持つ人のぶんはここに置く
        */}
        <OwnSocials member={member} site={site} />
        {/* 帯は id も名前も持たない。目次からは指さないので、指すための名前が要らない */}
        {band}
      </Hero>
      {/* 添えは置かない。訳語（紹介）は見出しを2度言うだけ */}
      <Screen id="about" label="About">
        <SectionHead title="About" chapter />
        <Note paragraphs={bio}>{bio.length ? null : <Empty>準備中です</Empty>}</Note>
      </Screen>
      {skills.length ? (
        <Screen id="skills" label="Skills">
          <SectionHead title="Skills" chapter />
          {/* 小節の見出しが h2 なので、塊の小見出しは h3 */}
          <SkillGroups groups={skills} level={3} />
        </Screen>
      ) : null}
      {career.length ? (
        <Screen id="career" label="Career">
          <SectionHead title="Career" chapter />
          {/* トップの「できごと」と同じ部品。同じ形のものを2度書かない */}
          <Timeline rows={career} />
        </Screen>
      ) : null}
    </>
  )

  return { node, description }
}
