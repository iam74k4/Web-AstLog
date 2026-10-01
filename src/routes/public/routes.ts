import type { Context } from 'hono'
import { Hono } from 'hono'
import { FIXED_BLOCK_KEYS } from '../../blocks'
import { ITEM_KINDS } from '../../domain'
import type { AppEnv } from '../../env'
import { filterQuery } from '../../ui/components'
import { robotsTxt, sitemapXml } from './crawl'
import { serveImage } from './images'
import { renderItem } from './item'
import { renderMemberScreen } from './member'
import { renderProfileAlias, renderScreen, renderWholePage } from './top'

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
  割っていたころの2ページ目以降（/projects/2・/members/<slug>/career/2）の番号の形。
  1始まりの数だけ。01・abc・0 は、割っていたころにも無かった URL なので 404。
*/
const PAGE_NUMBER = /^[1-9][0-9]*$/

/*
  `all` はページの名前としての予約語。catch-all が通すページの名前（PAGE_NAME——
  決まった中身のブロックの種類と block-<id>）とは衝突しないので、ガードは
  要らない——`/all` が先にあれば、`/:screen` はこの1語を見ない。
*/
publicRoutes.get('/all', (c) => renderWholePage(c))

/*
  目次の「Profile」の名前のとおりの URL。1人のサイトのプロフィール（/members/<slug>）へ
  送るだけ（top.tsx の renderProfileAlias）。`profile` も catch-all のページの名前
  （PAGE_NAME）とは衝突しない1語で、ここに置けば `/:screen` はこの1語を見ない。
*/
publicRoutes.get('/profile', (c) => renderProfileAlias(c))

publicRoutes.get('/', (c) => renderScreen(c, null))

/*
  個人ページ。`/members/okazaki` は2語なので、catch-all の `/:screen/:page` と
  本当に取り合う。3語・4語は前の続き（/about・/skills・/career・/contact と、割って
  いたころの /career/2）で、どれも転送するだけ（member.tsx）。同じページの仲間
  なので隣に置く。
*/
publicRoutes.get('/members/:slug', (c) => renderMemberScreen(c, c.req.param('slug'), null))

publicRoutes.get('/members/:slug/:rest', (c) =>
  renderMemberScreen(c, c.req.param('slug'), c.req.param('rest')),
)

publicRoutes.get('/members/:slug/:rest/:page', (c) =>
  PAGE_NUMBER.test(c.req.param('page'))
    ? renderMemberScreen(c, c.req.param('slug'), c.req.param('rest'))
    : c.notFound(),
)

/*
  作品1件の恒久リンク。1語目が区分の URL の語（src/domain.ts の ITEM_KINDS。
  apps / works）、3語目が slug。4語目の story は前の本文の画面で、いまは作品の
  ページの小節（#story）へ 301。URL の組み方は src/ui/components.tsx の itemHref で、
  ここと同じ表から作る。

  3語にしてあるのは catch-all（1語・2語）と取り合わないため。2語（`/apps/<slug>`）に
  すると、割っていたころの番号と作品の名前が同じ位置で取り合い、slug が数字の作品を
  作れなかった。

  区分ごとに1本ずつ登録する（`/:list/item/:slug` の1本にしない）。URL の語と
  区分の対応を ITEM_KINDS の表から作るので、知らない1語目はどこにも当たらない。
*/
for (const kind of ITEM_KINDS) {
  publicRoutes.get(`/${kind.path}/item/:slug`, (c) =>
    renderItem(c, kind.key, c.req.param('slug'), false),
  )
  publicRoutes.get(`/${kind.path}/item/:slug/story`, (c) =>
    renderItem(c, kind.key, c.req.param('slug'), true),
  )
}

/*
  前の一覧の URL（/apps・/works とその続き）。区分ごとの節だったころに貼られた
  URL を、同じ区分で絞り込んだ Projects へ寄せる（301）。

  ページ数（/apps/3）は引き継がない（Projects は1ページ）。メンバーの絞り込み
  （?member=）は引き継ぐ——個人ページの帯から貼られた URL がそれを持っている。
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
  ページの名前の形。ページの URL の1語目はコードが付ける名前だけ——決まった中身の
  ブロックの種類（/projects …）か、打ち込むブロックの block-<id>（blocks.tsx の
  renderBlock の id）。形の合わない名前（/wp-login.php・/.env を探し回る要求）は
  D1 に聞く前に 404 にする（どのページの名前にもならないので、答えは聞いても同じ）。
  名前の付け方を変えたら、ここも一緒に変えること。
*/
const PAGE_NAME = new RegExp(`^(?:${FIXED_BLOCK_KEYS.join('|')}|block-[1-9][0-9]*)$`)

/*
  ページごとの URL。上の「登録順の決まり」のとおり、固定の URL を全部登録した
  あとの、いちばん最後に置く。ここから下に固定ルートを足してはいけない。
*/
publicRoutes.get('/:screen', (c) => {
  const screen = c.req.param('screen')
  if (!PAGE_NAME.test(screen)) return c.notFound()
  return renderScreen(c, screen)
})

/*
  割っていたころの2ページ目以降（/projects/2）。いまはブロック1つが1ページなので、
  そのページへ 301。絞り込み（?kind= …）は付けたまま送る——ここで落とすと、貼られた
  絞り込みだけが外れる。行き先は URL の1語目だけで決まる（データで変わらない）ので、
  素の 301。1語目は PAGE_NAME で形を確かめてから Location に入れる。
*/
publicRoutes.get('/:screen/:page', (c) => {
  const screen = c.req.param('screen')
  if (!PAGE_NAME.test(screen) || !PAGE_NUMBER.test(c.req.param('page'))) return c.notFound()
  return c.redirect(`/${screen}${new URL(c.req.url).search}`, 301)
})
