import { drizzle } from 'drizzle-orm/d1'
import type { Context } from 'hono'
import { getCookie } from 'hono/cookie'
import type { Child } from 'hono/jsx'
import * as schema from '../../db/schema'
import type { AppEnv } from '../../env'
import { getSessionUser, SESSION_COOKIE } from '../../lib/auth'
import type { NavLink, Page } from '../../lib/sequence'
import { SITE } from '../../site'
import type { Theme } from '../../theme'
import { Layout, type OgImage } from '../../ui/Layout'

/*
  管理画面への入口（柱の AdminLink）の行き先。ログインしている人にだけ返し、
  訪問者には undefined——柱は訪問者の姿のまま。

  クッキーが無ければ D1 には聞きに行かない（訪問者のリクエストは1本も増えない）。
  ログインしている人に返すページは、共有のキャッシュに置かせない（private）。
  置かれると、次に来た訪問者に管理画面への入口が出る。公開ページの写し
  （src/lib/page-cache.ts）も、セッションのクッキーを持つ要求と private / no-store の
  応答を通さない——この約束をそちらでも守っている。
*/
export async function adminHref(c: Context<AppEnv>, to: string): Promise<string | undefined> {
  const sessionId = getCookie(c, SESSION_COOKIE)
  if (!sessionId) return undefined
  const user = await getSessionUser(drizzle(c.env.DB, { schema }), sessionId)
  if (!user) return undefined
  c.header('cache-control', 'private, no-store')
  return to
}

/*
  行き先がデータで変わる転送（301）。slug の転送表・区分を変えた作品・1人のサイトの
  /team → プロフィール・個人ページの Contact → サイトの Contact・前の個人ページの
  続き（/members/<slug>/about …）と前の本文の画面（…/story）→ ページの中の小節
  （小節が無くなっていればページの頭）。

  **ブラウザに覚えさせない**（Cache-Control: no-cache）。301 は既定でキャッシュして
  よい応答で、Chromium は期限なしで覚える。行き先は管理画面の保存で変わる——slug を
  mixer2 に変えて前の URL を開いたブラウザは「appmixer → mixer2」を覚え、そのあと
  slug を appmixer に戻すと、サーバーは「mixer2 → appmixer」を返すのに、ブラウザは
  覚えた転送で appmixer から mixer2 へ飛び、リダイレクトの無限ループになった
  （貼ってあった正の URL が「リダイレクトが多すぎます」になる。キャッシュを消すまで直らない）。
  no-cache なら、ブラウザは毎回サーバーに聞き直す。

  301 のままにするのは検索エンジンのため（「移転」として前の URL の評価を継ぐ）。
  検索エンジンは cache-control に関わらず 301 を移転として扱う。公開ページの写し
  （src/lib/page-cache.ts）はこの応答も置き、返すときに no-cache を付け直す——写しは
  管理画面の保存で版ごと外れるので、行き先が変わった日に古い転送は出ない。

  行き先が動かない転送（/apps・/works → /projects、割っていたころの2ページ目以降
  /<ページ>/<n> → /<ページ>）は、素の 301 のままでよい（長く覚えられても、同じ所へ
  送るだけ）。
*/
export function movedTo(c: Context<AppEnv>, to: string) {
  c.header('cache-control', 'no-cache')
  return c.redirect(to, 301)
}

/*
  サイトのページから、その中身を直す管理画面へ。

  打ち込むブロックはその編集画面。決まった中身のブロックは、中身の出どころへ
  ——Projects は項目の一覧、Team はメンバーの一覧、入口の名前と職種は
  メンバー（1人のサイトならその人の編集）。Contact と入口のリード文は
  src/site.ts にあって管理画面からは変えられないので、「構成」のその行へ送る。
*/
export const blockAdminPath = (block: schema.Block, solo?: schema.Member) => {
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
  サイトの1ページを描く。トップ（ブロックのページ）も個人ページも作品のページも
  ここを通る。

  題と canonical は page（src/lib/sequence.ts の Page）が、目次は nav が持つ。ここで
  やるのは、それを Layout に渡すことだけ。ページを組む側が違っても、題の付け方も
  canonical の出し方も名乗りを載せる場所も1つになる。
*/
export async function screenPage(
  c: Context<AppEnv>,
  page: {
    title: string
    canonical: string
    nav: NavLink[]
    node: Child
    description: string
    /*
      このページに載せる構造化データ。載せるかどうかは呼ぶ側が決めて、載せない
      ページでは渡さない。サイトの名乗り（Person / Organization）はサイトの並びの
      先頭のページにだけ（firstOnly）。個人ページの Person と作品のページの
      CreativeWork は「この URL が何か」なので、それぞれのページに載せる。
    */
    jsonLd?: unknown
    theme: Theme
    sidebar: Child
    // このページの中身を直す管理画面（adminHref が、ログインしている人にだけ出す）
    adminPath: string
    // 共有カードの画像。渡さなければサイトの1枚（src/ui/Layout.tsx の OgImage）
    image?: OgImage
  },
) {
  return c.html(
    <Layout
      title={page.title}
      description={page.description}
      canonical={`${SITE.origin}${page.canonical}`}
      jsonLd={page.jsonLd}
      nav={page.nav}
      theme={page.theme}
      sidebar={page.sidebar}
      admin={await adminHref(c, page.adminPath)}
      image={page.image}
    >
      {page.node}
    </Layout>,
  )
}

/*
  サイトの名乗り（構造化データ）はサイトの並びの先頭のページにだけ載せる。ほかの
  ページで同じ人・同じ器をもう一度名乗らない（CLAUDE.md「1ページ = 1ドキュメント」）。
*/
export const firstOnly = (pages: Page[], here: Page, jsonLd: unknown) =>
  pages[0] === here ? jsonLd : undefined
