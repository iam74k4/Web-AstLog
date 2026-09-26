import { drizzle } from 'drizzle-orm/d1'
import type { Context } from 'hono'
import { getCookie } from 'hono/cookie'
import type { Child } from 'hono/jsx'
import * as schema from '../../db/schema'
import type { AppEnv } from '../../env'
import { getSessionUser, SESSION_COOKIE } from '../../lib/auth'
import type { Sequence } from '../../lib/sequence'
import { SITE } from '../../site'
import type { Theme } from '../../theme'
import { ScreenPager } from '../../ui/components'
import { Layout, type OgImage } from '../../ui/Layout'

/*
  管理画面への入口（柱の AdminLink）の行き先。ログインしている人にだけ返し、
  訪問者には undefined——柱は訪問者の姿のまま。

  クッキーが無ければ D1 には聞きに行かない（訪問者のリクエストは1本も増えない）。
  ログインしている人に返すページは、共有のキャッシュに置かせない（private）。
  置かれると、次に来た訪問者に管理画面への入口が出る。公開ページの写し
  （src/lib/page-cache.ts）も、セッションのクッキーを持つ要求と cache-control を
  持つ応答を通さない——この約束をそちらでも守っている。
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
  サイトの画面から、その中身を直す管理画面へ。

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
  連なりの1枚をページにする。トップも個人ページも作品のページもここを通る。

  連ね方（添字・前後・目次・ページャ）は src/lib/sequence.ts が持つ。ここで
  やるのは、その結果を Layout に渡すことだけ。画面の列を作る側が違っても、
  題の付け方も canonical の出し方も名乗りを載せる場所も1つになる。
*/
export async function screenPage(
  c: Context<AppEnv>,
  seq: Sequence,
  page: {
    node: Child
    description: string
    /*
      この画面に載せる構造化データ。載せるかどうかは呼ぶ側が決めて、載せない
      画面では渡さない。名乗り（サイトの Person / Organization、個人ページの
      Person）は連なりの先頭の画面にだけ（firstOnly）。作品1件のページの
      CreativeWork は名乗りではなく「この URL が何か」なので、どの作品の1枚目にも
      渡す（src/routes/public/item.tsx）。
    */
    jsonLd?: unknown
    theme: Theme
    sidebar: Child
    // この画面の中身を直す管理画面（adminHref が、ログインしている人にだけ出す）
    adminPath: string
    // ページャが数える単位（ScreenPager の unit）。作品同士をめくるときだけ「件」
    unit?: '画面' | '件'
    // 共有カードの画像。渡さなければサイトの1枚（src/ui/Layout.tsx の OgImage）
    image?: OgImage
  },
) {
  return c.html(
    <Layout
      title={seq.current.title}
      description={page.description}
      canonical={`${SITE.origin}${seq.current.canonical}`}
      jsonLd={page.jsonLd}
      nav={seq.nav}
      theme={page.theme}
      sidebar={page.sidebar}
      admin={await adminHref(c, page.adminPath)}
      image={page.image}
    >
      {/* 1画面しか無いなら、めくる先が無いのでページャは出さない */}
      {seq.pager ? (
        <>
          {page.node}
          <ScreenPager {...seq.pager} unit={page.unit} />
        </>
      ) : (
        page.node
      )}
    </Layout>,
  )
}

/*
  名乗り（構造化データ）は連なりの先頭の画面にだけ載せる。めくった先で同じ
  人・同じ器をもう一度名乗らない（CLAUDE.md「1画面 = 1ドキュメント」）。
*/
export const firstOnly = (seq: Sequence, jsonLd: unknown) => (seq.index === 0 ? jsonLd : undefined)
