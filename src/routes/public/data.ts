import type { Context } from 'hono'
import { memberScreenCount, type SiteCounts } from '../../blocks'
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
  公開ページを組むのに使う「サイトの今の姿」。どの画面を描く側（top・member・item・
  sitemap）も、ここの式で同じ答えを出す。描くもの（JSX）は置かない。
*/

/*
  公開中のメンバーがちょうど1人なら、サイトはその人のもの。

  1人か器かを人数だけで決める。Team の横長/グリッドや、絞り込みに名前の
  ピルを出すかどうかと同じ数え方なので、2人目を公開した日に自動で器へ戻る
  （文言 src/site.ts だけは手で複数形に書き直す）。
*/
export const soloMember = (members: schema.Member[]) =>
  members.length === 1 ? members[0] : undefined

/*
  1人のサイトで Team を置いているなら、その人。Team の画面の代わりに、
  この人の画面（1枚目・About・Skills・Career）がサイトの連なりに入る
  （site.ts の screenList）。目次には「Profile」の1行で載り（src/lib/sequence.ts の
  tocKey）、/team は1枚目へ 301。

  2人目を公開した日に Team の画面へ戻る（soloMember が人数で決める）。Team を
  置いていない1人のサイトでは undefined——個人ページはカードの担当者名から入る
  単独の連なり。
*/
export const profileOf = (blocks: schema.Block[], members: schema.Member[]) =>
  blocks.some((block) => block.type === 'team') ? soloMember(members) : undefined

/*
  カードに担当者の名前（個人ページへのリンク）を出すか。

  2人以上いるときは出す。1人のサイトで全部のカードに同じ名前を並べても
  何も見分けられないので、ふだんは出さない。ただし Team の節を置いていない
  ときは人数に関わらず出す——トップから個人ページへ行く道が、カードの
  名前のほかに1本も無くなる。作品1件のページの「担当」も同じ条件。
*/
export const showMemberOf = (blocks: schema.Block[], members: schema.Member[]) =>
  members.length > 1 || !blocks.some((block) => block.type === 'team')

// 区分のピルに並べるもの。公開中の項目が実在する区分だけ（FilterLinks を見ること）
export const kindsOf = (counts: KindCounts): ItemKind[] =>
  ITEM_KIND_KEYS.filter((kind) => counts[kind] > 0)

// 一覧への帯（入口と個人ページの1枚目。components.tsx の Band）
export type BandData = { href: string; counts: KindCounts }

/*
  一覧への帯（行き先と件数）。

  送る先は Projects の1画面目。その節を置いていないサイトでは、そもそも
  その URL が無い（404）ので、置いてあるかどうかも見る。項目が1件も無い
  ときも出さない（0件の知らせだけの画面へ送らない）。
*/
export const bandOf = (blocks: schema.Block[], counts: KindCounts, query = ''): BandData | null => {
  const placed = blocks.some((block) => block.type === 'projects')
  return placed && totalOf(counts) > 0 ? { href: `/projects${query}`, counts } : null
}

/*
  一覧1つぶん。全件をメモリに載せず、画面を組むのに要る数と、いま描く画面の
  行だけを持つ。

  total は絞り込みを外したときの件数で、節を出すかどうかを決める。
  matched は絞り込んだあとの件数で、画面が何枚になるかを決める
  （src/blocks.ts の blockPages）。
*/
export type ItemListData = {
  total: number
  matched: number
  // いま描く画面に出す行だけ。画面の数を数えるためだけに呼ぶときは空
  rows: ItemView[]
}

export type TopData = {
  members: schema.Member[]
  // Projects（個人開発と業務を1つにした一覧）
  projects: ItemListData
  // 区分のピルに並べるぶん（公開中の項目が実在する区分だけ）
  kinds: ItemKind[]
  filter: ItemFilter
  // カードに担当者を出すか（showMemberOf）
  showMember: boolean
  /*
    入口（Hero の画面）に置く一覧への帯。件数は絞り込みを見ないサイト全体の数
    （入口で見せたいのは「ここに何件あるか」）。全体ページ（/all）では null——
    全部が同じ文書に並ぶので、送り出す先が無い。
  */
  band: BandData | null
  /*
    1人のサイトで Team を置いているなら、その人（profileOf）。Team のブロックは
    画面を作らず、その位置にこの人の画面が並ぶ。全体ページでは Team のカードの
    代わりに、この人のプロフィールを1つの節として置く。
  */
  profile?: schema.Member
}

// 画面の数を決める件数（src/blocks.ts の blockPages が読む形）
export const siteCountsOf = (data: TopData): SiteCounts => ({
  items: { total: data.projects.total, matched: data.projects.matched },
  members: data.members.length,
  profile: data.profile ? memberScreenCount(data.profile) : null,
})

/*
  絞り込み（?kind= / ?member=）が効く画面か。一覧を持つ画面（Projects）だけで、
  区分もメンバーもそこに効く（scopeOf）。

  めくる先・目次の行き先に絞り込みを付けるか（site.ts の stepQuery）、DB から
  行を引くか（screenRows）は、どちらもこの1本に聞く。効かない画面に付けると、
  中身は1文字も変わらないのに URL だけが増える（/contact?member=… のたぐい）。
*/
export const filterApplies = (key: string) => key === 'projects'

// 効く画面での問い合わせの条件。区分もメンバーも Projects の1つの一覧に効く
export const scopeOf = (filter: ItemFilter, memberId: number | null) => ({
  kind: filter.kind,
  memberId,
})

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
export function readFilter(c: Context<AppEnv>, kinds: ItemKind[], members: schema.Member[]) {
  const asked = c.req.query('kind')
  // 区分のピルは両方の区分に項目があるときだけ並ぶ（FilterLinks）
  const kind = kinds.length > 1 ? (kinds.find((one) => one === asked) ?? null) : null
  const member =
    members.length > 1 ? (members.find((row) => row.slug === c.req.query('member')) ?? null) : null
  const filter: ItemFilter = { kind, member: member?.slug ?? null }
  return { filter, memberId: member?.id ?? null }
}

// 絞り込みの無い素のサイト（作品・個人ページ・sitemap が目次とめくる先に使う）
export const NO_FILTER: ItemFilter = { kind: null, member: null }
