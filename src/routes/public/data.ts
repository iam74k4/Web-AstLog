import type { Context } from 'hono'
import type { SiteCounts } from '../../blocks'
import type * as schema from '../../db/schema'
import {
  ITEM_KIND_KEYS,
  type ItemFilter,
  type ItemKind,
  type ItemView,
  type KindCounts,
  totalOf,
} from '../../domain'
import type { AppEnv } from '../../env'

/*
  公開ページを組むのに使う「サイトの今の姿」。どのページを描く側（top・member・item・
  sitemap）も、ここの式で同じ答えを出す。描くもの（JSX）は置かない。
*/

/*
  公開中のメンバーがちょうど1人なら、サイトはその人のもの。

  1人か器かを人数だけで決める。Team の横長/グリッドや、絞り込みに名前の
  手を出すかどうかと同じ数え方なので、2人目を公開した日に自動で器へ戻る
  （文言 src/site.ts だけは手で複数形に書き直す）。
*/
export const soloMember = (members: schema.Member[]) =>
  members.length === 1 ? members[0] : undefined

/*
  1人のサイトで Team を置いているなら、その人。Team のページの代わりに、
  この人のページ（/members/<slug>。名札・大見出し・About・Skills・Career）がサイトの
  並びに入る（site.ts の pageList）。目次には「Profile」の1行で載り、/team は
  そのページへ 301。

  2人目を公開した日に Team のページへ戻る（soloMember が人数で決める）。Team を
  置いていない1人のサイトでは undefined——個人ページは一覧の行の担当者名から入る
  並びの外のページ。
*/
export const profileOf = (blocks: schema.Block[], members: schema.Member[]) =>
  blocks.some((block) => block.type === 'team') ? soloMember(members) : undefined

/*
  一覧の行に担当者の名前（個人ページへのリンク）を出すか。

  2人以上いるときは出す。1人のサイトで全部の行に同じ名前を並べても
  何も見分けられないので、ふだんは出さない。ただし Team の節を置いていない
  ときは人数に関わらず出す——トップから個人ページへ行く道が、行の
  名前のほかに1本も無くなる。作品1件のページの「担当」も同じ条件。
*/
export const showMemberOf = (blocks: schema.Block[], members: schema.Member[]) =>
  members.length > 1 || !blocks.some((block) => block.type === 'team')

// 区分の絞り込みに並べるもの。公開中の項目が実在する区分だけ（FilterLinks を見ること）
export const kindsOf = (counts: KindCounts): ItemKind[] =>
  ITEM_KIND_KEYS.filter((kind) => counts[kind] > 0)

// 一覧への1本（入口の「一覧で見る →」と件数、2人以上のサイトの個人ページの帯。components.tsx の Cta / Tally / Band）
export type BandData = { href: string; counts: KindCounts }

/*
  一覧への1本の行き先と件数（入口の Cta と Tally、個人ページの Band が読む）。

  送る先は Projects のページ。その節を置いていないサイトでは、そもそも
  その URL が無い（404）ので、置いてあるかどうかも見る。項目が1件も無い
  ときも出さない（0件の知らせだけのページへ送らない）。
*/
export const bandOf = (blocks: schema.Block[], counts: KindCounts, query = ''): BandData | null => {
  const placed = blocks.some((block) => block.type === 'projects')
  return placed && totalOf(counts) > 0 ? { href: `/projects${query}`, counts } : null
}

/*
  一覧1つぶん。ページを組むのに要る数と、いま描くページの行を持つ。

  total は絞り込みを外したときの件数で、節を出すかどうかを決める
  （src/blocks.ts の blockShown）。行は絞り込んだあとの全件（Projects のページと
  全体ページ）と、入口では軌道図の札のための公開中の全件。ほかのページを描くときは
  空——作品の行は、それを描くページでだけ引く（site.ts の pageRows）。

  numbers は絞り込んだ一覧の行の番号（作品の id → 絞り込む前の並びでの位置。1 から）。
  番号は入口の軌道図の札と同じ番号で結ぶので、業務だけに絞っても 03 の作品は 03。
  絞り込まない一覧では持たず、行の順がそのまま番号（rowNumber）。
*/
export type ItemListData = {
  total: number
  rows: ItemView[]
  numbers?: ReadonlyMap<number, number>
}

// 一覧の行の番号（1 から）。絞り込んだ一覧では、絞り込む前の並びでの位置
export const rowNumber = (list: ItemListData, item: ItemView, order: number) =>
  list.numbers?.get(item.id) ?? order + 1

export type TopData = {
  members: schema.Member[]
  // Projects（個人開発と業務を1つにした一覧）
  projects: ItemListData
  /*
    公開中の作品の区分ごとの件数（絞り込みを見ない、サイト全体の数）。入口と締めの
    軌道図に載せる天体の数（src/lib/orbits.ts の orbitMap）
  */
  counts: KindCounts
  // 区分の絞り込みに並べるぶん（公開中の項目が実在する区分だけ）
  kinds: ItemKind[]
  filter: ItemFilter
  // 一覧の行に担当者を出すか（showMemberOf）
  showMember: boolean
  /*
    入口（Hero のページ）に置く一覧への1本（「一覧で見る →」）と件数の帯（Tally）の
    もと。件数は絞り込みを見ないサイト全体の数（入口で見せたいのは「ここに何件あるか」）。
    全体ページ（/all）では null——全部が同じ文書に並ぶので、送り出す先が無い。
  */
  band: BandData | null
  /*
    1人のサイトで Team を置いているなら、その人（profileOf）。Team のブロックは
    ページを作らず、その位置にこの人のページが並ぶ。全体ページでは Team のカードの
    代わりに、この人のプロフィールを1つの節として置く。
  */
  profile?: schema.Member
}

// ページに出るかを決める件数（src/blocks.ts の blockShown が読む形）
export const siteCountsOf = (data: TopData): SiteCounts => ({
  items: data.projects.total,
  members: data.members.length,
})

/*
  絞り込み（?kind= / ?member=）が効くページか。一覧を持つページ（Projects）だけで、
  区分もメンバーもそこに効く（scopeOf）。

  目次の行き先に絞り込みを付けるか（site.ts の pageQuery）、DB から絞り込んだ行を
  引くか（pageRows。入口だけは軌道図の札のために絞り込まずに全件を引く）は、どちらも
  この1本に聞く。効かないページに付けると、中身は1文字も変わらないのに URL だけが
  増える（/contact?member=… のたぐい）。
*/
export const filterApplies = (key: string) => key === 'projects'

// 効くページでの問い合わせの条件。区分もメンバーも Projects の1つの一覧に効く
export const scopeOf = (filter: ItemFilter, memberId: number | null) => ({
  kind: filter.kind,
  memberId,
})

/*
  URL の絞り込みを読む。

  知らない区分も、絞り込みに並んでいない区分（項目が片方の区分にしか無いサイト）も、
  公開中に居ないメンバーの slug も、絞り込みとして扱わない（絞り込まずに全件を
  出す）。並ばないもので絞り込むと、ページのどこにも印が出ず、外す手が
  無くなる。

  1人のサイトでは ?member= を読まない。名前の絞り込みは2人以上いるときにしか
  並ばない（FilterLinks）ので、効かせると「すべて」にも名前にも印が付かない
  まま一覧だけが絞られる。
*/
export function readFilter(c: Context<AppEnv>, kinds: ItemKind[], members: schema.Member[]) {
  const asked = c.req.query('kind')
  // 区分の絞り込みは両方の区分に項目があるときだけ並ぶ（FilterLinks）
  const kind = kinds.length > 1 ? (kinds.find((one) => one === asked) ?? null) : null
  const member =
    members.length > 1 ? (members.find((row) => row.slug === c.req.query('member')) ?? null) : null
  const filter: ItemFilter = { kind, member: member?.slug ?? null }
  return { filter, memberId: member?.id ?? null }
}

// 絞り込みの無い素のサイト（作品・個人ページ・sitemap が目次に使う）
export const NO_FILTER: ItemFilter = { kind: null, member: null }
