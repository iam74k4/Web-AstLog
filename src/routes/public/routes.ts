import type { Context } from 'hono'
import { Hono } from 'hono'
import { FIXED_BLOCK_KEYS } from '../../blocks'
import { ITEM_KINDS } from '../../domain'
import type { AppEnv } from '../../env'
import { isSafeRedirect } from '../../lib/format'
import { filterQuery } from '../../ui/components'
import { robotsTxt, sitemapXml } from './crawl'
import { serveImage } from './images'
import { renderItem } from './item'
import { renderMemberScreen } from './member'
import { memberHref } from './member-screens'
import { renderScreen, renderWholePage } from './top'

/*
  公開ページの URL の登録。ここは登録だけを持ち、描くのはそれぞれのモジュール
  （top・member・item・crawl・images）。

  **登録順の決まり:** `/:screen` と `/:screen/:page` は1語・2語の URL を何でも
  拾う catch-all。だから固定の URL（`/all`・`/members/:slug`・`/images/*` の
  たぐい）は、必ずこの2つより先に登録する。あとから固定ルートを下に足すと、
  一致が `/:screen` 側に吸われて、そのページだけが静かに 404 になる。
  test/public.test.ts の「URL の登録順」が publicRoutes.routes を読んでこれを
  守っている。docs/screens.md の URL 表もこの順に並べてある。
*/
export const publicRoutes = new Hono<AppEnv>()

/*
  2語目（ページ数）の読み方。トップも個人ページも同じ文法にする。

  '1' は1画面目の2つ目の URL なので、素の URL へ寄せる（303）。それ以外の
  書き方（01・abc・0）は無い URL。絞り込みは付けたまま送る——ここで落とすと、
  URL を手で直した人だけ絞り込みが外れる。
*/
type PageWant = { redirect: string } | { page: number } | null

function readPage(raw: string, url: string, bare: string): PageWant {
  if (raw === '1') {
    /*
      bare は呼ぶ側がパスの一部から組み立てた文字列なので、そのまま
      Location に入れない。`//evil.com` や CR/LF がここまで来る
      （isSafeRedirect のコメントに実際の URL と症状が書いてある）。
      通らないものは無い URL なので 404 に落とす。
    */
    return isSafeRedirect(bare) ? { redirect: `${bare}${new URL(url).search}` } : null
  }
  return /^[1-9][0-9]*$/.test(raw) ? { page: Number(raw) } : null
}

/*
  `all` は画面の名前としての予約語。catch-all が通す画面の名前（SCREEN_NAME——
  決まった中身のブロックの種類と block-<id>）とは衝突しないので、ガードは
  要らない——`/all` が先にあれば、`/:screen` はこの1語を見ない。
*/
publicRoutes.get('/all', (c) => renderWholePage(c))

publicRoutes.get('/', (c) => renderScreen(c, null))

/*
  個人ページ。`/members/okazaki` は2語なので、catch-all の `/:screen/:page` と
  本当に取り合う。画面の続き（3語・4語）は取り合わないが、同じ連なりの仲間
  なので隣に置く。
*/
publicRoutes.get('/members/:slug', (c) => renderMemberScreen(c, c.req.param('slug'), null))

publicRoutes.get('/members/:slug/:screen', (c) =>
  renderMemberScreen(c, c.req.param('slug'), { key: c.req.param('screen'), page: 1 }),
)

publicRoutes.get('/members/:slug/:screen/:page', (c) => {
  const slug = c.req.param('slug')
  const key = c.req.param('screen')
  const want = readPage(c.req.param('page'), c.req.url, memberHref(slug, key))
  if (!want) return c.notFound()
  if ('redirect' in want) return c.redirect(want.redirect, 303)
  return renderMemberScreen(c, slug, { key, page: want.page })
})

/*
  作品1件の恒久リンク。1語目が区分の URL の語（src/domain.ts の ITEM_KINDS。
  apps / works）、3語目が slug。4語目の story は本文の画面。URL の組み方は
  src/ui/components.tsx の itemHref / itemStoryHref で、ここと同じ表から作る。

  3語にしてあるのは catch-all（1語・2語）と取り合わないため。2語（`/apps/<slug>`）に
  すると、めくる先の番号と作品の名前が同じ位置で取り合うので、slug が数字の作品を
  作れなくなる。本文の画面を数（`/2`）ではなく名前の語にした理由は itemStoryHref。

  区分ごとに1本ずつ登録する（`/:list/item/:slug` の1本にしない）。URL の語と
  区分の対応を ITEM_KINDS の表から作るので、知らない1語目はどこにも当たらない。
*/
for (const kind of ITEM_KINDS) {
  publicRoutes.get(`/${kind.path}/item/:slug`, (c) =>
    renderItem(c, kind.key, c.req.param('slug'), 'first'),
  )
  publicRoutes.get(`/${kind.path}/item/:slug/story`, (c) =>
    renderItem(c, kind.key, c.req.param('slug'), 'story'),
  )
}

/*
  前の一覧の URL（/apps・/works とその続き）。区分ごとの節だったころに貼られた
  URL を、同じ区分で絞り込んだ Projects の1画面目へ寄せる（301）。

  ページ数（/apps/3）は引き継がない。区分を混ぜて新しい順に並べ直したので、
  同じ番号の画面に同じカードは載っていない。メンバーの絞り込み（?member=）は
  引き継ぐ——個人ページの帯から貼られた URL がそれを持っている。
*/
for (const kind of ITEM_KINDS) {
  const moved = (c: Context<AppEnv>) =>
    c.redirect(
      `/projects${filterQuery({ kind: kind.key, member: c.req.query('member') ?? null })}`,
      301,
    )
  publicRoutes.get(`/${kind.path}`, moved)
  publicRoutes.get(`/${kind.path}/:page`, moved)
}

publicRoutes.get('/robots.txt', robotsTxt)

publicRoutes.get('/sitemap.xml', sitemapXml)

publicRoutes.get('/images/*', serveImage)

/*
  画面の名前の形。画面の URL の1語目はコードが付ける名前だけ——決まった中身の
  ブロックの種類（/projects …）か、打ち込むブロックの block-<id>（blocks.tsx の
  renderBlock の id）。形の合わない名前（/wp-login.php・/.env を探し回る要求）は
  D1 に聞く前に 404 にする（どの画面の名前にもならないので、答えは聞いても同じ）。
  名前の付け方を変えたら、ここも一緒に変えること。
*/
const SCREEN_NAME = new RegExp(`^(?:${FIXED_BLOCK_KEYS.join('|')}|block-[1-9][0-9]*)$`)

/*
  画面ごとの URL。上の「登録順の決まり」のとおり、固定の URL を全部登録した
  あとの、いちばん最後に置く。ここから下に固定ルートを足してはいけない。
*/
publicRoutes.get('/:screen', (c) => {
  const screen = c.req.param('screen')
  if (!SCREEN_NAME.test(screen)) return c.notFound()
  return renderScreen(c, { slug: screen, page: 1 })
})

publicRoutes.get('/:screen/:page', (c) => {
  const screen = c.req.param('screen')
  if (!SCREEN_NAME.test(screen)) return c.notFound()
  // ページ数の読み方は個人ページと同じ（readPage）。文法を2つ持たない
  const want = readPage(c.req.param('page'), c.req.url, `/${screen}`)
  if (!want) return c.notFound()
  if ('redirect' in want) return c.redirect(want.redirect, 303)
  return renderScreen(c, { slug: screen, page: want.page })
})
