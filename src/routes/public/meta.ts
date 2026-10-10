import { type BlockKey, blockVisibleParts } from '../../blocks'
import type * as schema from '../../db/schema'
import type { ItemView } from '../../domain'
import { isHttpsUrl } from '../../lib/format'
import { SITE, type SiteSettings } from '../../site'
import { soloMember } from './data'

/*
  <head> に載せるもの——題・説明文・構造化データ。組み方はここの関数だけで、
  ページを描く側はこれを呼ぶ（ページごとに手で組むと、同じ名前がページごとに違う形で出る）。
*/

/*
  名前と肩書きの組み方。肩書きがあれば「名前（肩書き）」、無ければ名前だけ
  （肩書きを空で保存した人で「岡崎 昂功（）」を出さない）。題・説明文・Team の
  説明文がどれもこれを通る。
*/
export const nameWithRole = (member: Pick<schema.Member, 'name' | 'role'>) =>
  member.role ? `${member.name}（${member.role}）` : member.name

/*
  <title> の組み方。ページの名前を「 · 」でつなぎ、最後にサイトの名前を置く。

  ページごとに違う題にする（CLAUDE.md「1ページ = 1ドキュメント」。履歴・タブ・
  検索結果から選び直せるように）。
    - 名前の無いページ（ひとこと・見出しの無いメモ）は、そのページに出ている文の
      頭を抜き出す（excerpt。入口と同じ題にしない）
    - 個人ページは人の名前（「岡崎 昂功 — AstLog」）、作品のページは作品名
*/
export const pageTitle = (...parts: string[]) =>
  `${parts.filter((part) => part !== '').join(' · ')} — ${SITE.name}`

// 題に使う文の頭。説明文（describe）と同じく1行に畳んで、字で数えて切る
const TITLE_EXCERPT = 30

export const excerpt = (text: string) => {
  const letters = [...text.replace(/\s+/g, ' ').trim()]
  return letters.length > TITLE_EXCERPT
    ? `${letters.slice(0, TITLE_EXCERPT - 1).join('')}…`
    : letters.join('')
}

/*
  入口の題と説明。1人なら名前と職種を載せる——共有リンクのカードにも検索の
  スニペットにも、誰のサイトなのかが出るように。画面に出ている名乗りと同じ
  ものを head にも置く。
*/
export const siteTitle = (solo?: schema.Member) =>
  solo ? pageTitle(nameWithRole(solo)) : `${SITE.name} — Projects`

export const siteDescription = (solo?: schema.Member, site: SiteSettings = SITE) =>
  solo ? `${nameWithRole(solo)}のポートフォリオ。${site.heroLead}` : site.heroLead

/*
  ページごとの説明文（<meta name="description"> と og:description）。

  作るのは「そのページに実際に出ている文字」から。数と名前を並べ替えるだけなので、
  中身を足した日に説明文だけ古くなることが無い。
*/
// 検索結果は日本語なら 110 字あたりで切られる。どこで切れるかはこちらで決める
const DESCRIPTION_MAX = 110

// 中身の無い節を落として「。」でつなぐ。0件のページで「。。」を残さないため
export const joinParts = (...parts: string[]) => parts.filter((part) => part !== '').join('。')

export const describe = (text: string) => {
  // 打ち込んだ中身には改行が入る。1行に畳んでから数える
  const one = text.replace(/\s+/g, ' ').trim()
  const letters = [...one]
  return letters.length > DESCRIPTION_MAX
    ? `${letters.slice(0, DESCRIPTION_MAX - 1).join('')}…`
    : one
}

/*
  1行1件のものを説明文に畳む。リンク集の URL（2列目）は落とす——href で
  あって本文には出ない（どの列が本文かは src/blocks.ts の blockVisibleParts）。
*/
export const lineDigest = (key: BlockKey, rows: string[][]) =>
  rows.map((parts) => blockVisibleParts(key, parts).join(' ')).join('、')

/*
  一覧の行の実績値（.metric）を説明文に畳む。値・単位・添えの順は、行に
  出ている順そのもの。並べ替えると、書いた人の数字がこちらの都合で別の意味に
  なる（「見込み 40人日から半減」は 20 の添えであって、20 の言い換えではない）。
  添えを「値のあとに続けて読んで意味が通る」形で書く決まりは、管理画面の
  実績値のヒントが言っている。
*/
export const metricDigest = (item: ItemView) =>
  item.metricValue
    ? `（${[item.metricValue, item.metricUnit, item.metricNote].filter(Boolean).join(' ')}）`
    : ''

/*
  JSON-LD の Person。name / jobTitle / url の3つが本体で、1人のときのサイト自身・
  器の中の member[]・個人ページの3か所がどれもこれを通る。

  **url は既定値を置かず、呼ぶ側が毎回書く。** 1人のときだけ SITE.origin
  （その人がサイト本体）、それ以外は /members/<slug>。これは「1人なら器は
  要らない」という設計の要点そのものなので、既定に隠すと取り違えても
  気づけない。

  extra は description / sameAs / worksFor。渡さなければキーごと出ない
  （空の配列を名乗らない）。
*/
export const personJsonLd = (
  member: Pick<schema.Member, 'name' | 'role'>,
  url: string,
  extra?: Record<string, unknown>,
) => ({
  '@type': 'Person' as const,
  name: member.name,
  // 肩書きを書いていない人は jobTitle を名乗らない（空文字を名乗らない）
  ...(member.role ? { jobTitle: member.role } : {}),
  url,
  ...extra,
})

/*
  サイト全体の名乗り。1人なら Person、0人・2人以上なら器としての Organization。
  採る側は「誰を採るのか」を探しに来ているので、実体が1人のあいだはその人として
  名乗る（Organization では人の名前も職種も構造化データに1つも出ない）。
*/
export const siteJsonLd = (members: schema.Member[], site: SiteSettings = SITE) => {
  const solo = soloMember(members)
  // 足元に出すサイトの Instagram と X も、同じ名乗りの別の口として並べる（通らない URL は名乗らない）
  const elsewhere = [site.instagram, site.x].filter((url) => isHttpsUrl(url))
  if (solo) {
    // 通らない GitHub（相対 URL・javascript:）は名乗らず、サイトのものに戻す
    const github = isHttpsUrl(solo.github) ? solo.github : site.github
    const sameAs = [...(github ? [github] : []), ...elsewhere]
    return {
      '@context': 'https://schema.org',
      ...personJsonLd(solo, SITE.origin, {
        description: site.heroLead,
        ...(sameAs.length ? { sameAs } : {}),
      }),
    }
  }
  const sameAs = [...(site.github ? [site.github] : []), ...elsewhere]
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: SITE.name,
    url: SITE.origin,
    description: site.heroLead,
    ...(sameAs.length ? { sameAs } : {}),
    member: members.map((member) => personJsonLd(member, `${SITE.origin}/members/${member.slug}`)),
  }
}

/*
  サイトの中の経路（/images/items/… や /assets/…）を絶対 URL にする。
  構造化データと共有カードは、この文書の外で読まれるので、相対のままでは何も
  指さない。既に絶対のもの（手で DB に入れた外の URL）はそのまま通す。
*/
export const absoluteUrl = (path: string) => (path.startsWith('/') ? `${SITE.origin}${path}` : path)
