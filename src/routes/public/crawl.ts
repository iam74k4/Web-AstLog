import { drizzle } from 'drizzle-orm/d1'
import type { Context } from 'hono'
import { itemStory } from '../../blocks'
import { listPublishedItemKeys, listPublishedMembers, publishedBlocks } from '../../db/queries'
import * as schema from '../../db/schema'
import type { AppEnv } from '../../env'
import { SITE } from '../../site'
import { itemHref, itemStoryHref } from '../../ui/components'
import { NO_FILTER } from './data'
import { memberHref, memberScreens } from './member-screens'
import { siteScreens, siteSteps } from './site'

/*
  クローラ向けの2本（robots.txt と sitemap.xml）。

  手で URL を並べた表は置かない——構成を並べ替えたり、作品を1件足したり
  した日に、実物と表が静かにずれる。公開ページの画面の列をそのまま数え上げる
  （site.ts の siteScreens と member-screens.tsx の memberScreens。公開ページが
  節を出すかどうかを決めているのと同じ式）。check:fit も測る URL をここから引く。

  robots.txt は「読んでよい」と sitemap の在り処を言うだけ。管理画面は認証の
  壁の内側だが、URL を拾わせる理由が無いので外す。
*/
export const robotsTxt = (c: Context<AppEnv>) =>
  c.text(
    [
      'User-agent: *',
      'Allow: /',
      'Disallow: /admin/',
      '',
      `Sitemap: ${SITE.origin}/sitemap.xml`,
      '',
    ].join('\n'),
  )

/*
  XML に入れる文字を落とす。slug は英数字とハイフンに畳んであり、いまのところ
  当たる文字は1つも無い——それでも通すのは、「たぶん安全」を前提にした
  組み立てを1つも残さないため。
*/
const xmlText = (text: string) =>
  text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')

export async function sitemapXml(c: Context<AppEnv>) {
  const db = drizzle(c.env.DB, { schema })
  // 作品は URL を組むぶん（区分・slug・本文の有無）だけ。カードの子（タグ・リンク・
  // 担当・プラットフォーム）は要らないので、全件ぶんを引かない
  const [members, blocks, items] = await Promise.all([
    listPublishedMembers(db),
    publishedBlocks(db),
    listPublishedItemKeys(db),
  ])

  // 絞り込みを付けない素のサイト。?kind= 付きの URL は正ではないので載せない
  const { screens } = await siteScreens(db, blocks, members, NO_FILTER, null)

  const paths = [
    /*
      入口。置いたものが全部下書きでも 200 で「まだ何も置いていません」を出す
      （オーナーが自分のサイトから締め出されないための分岐）ので、画面の列が
      空でもここは在る。例外は列の先頭がプロフィールのとき（1人のサイトで
      Hero を外し Team を先頭に置いた構成）で、/ はその1枚目へ送るだけなので
      載せない——送る元の URL を並べない（/apps や /team と同じ）。
    */
    ...(screens[0]?.kind === 'profile' ? [] : ['/']),
    /*
      トップの画面。並べるのは href ではなく canonical——1枚目は / と /<slug> の
      2つの URL で開けるので、正の1つだけを出す（重なりは下で落とす）。1人の
      サイトではプロフィールの画面（/members/<slug> …）もここに入り、/team は
      入らない（301 で寄せる元）。
    */
    ...siteSteps(screens, NO_FILTER).map((step) => step.canonical),
    // 縦に積んだ全体版。正が自分自身なので、ここに並ぶ資格がある
    '/all',
    /*
      個人ページ。1人のサイトのプロフィールは上のサイトの画面と同じ URL に
      なる（重なりは下で落とす）。Team を置いていないサイトや2人以上のサイトでは、
      ここにしか出てこない
    */
    ...members.flatMap((member) =>
      memberScreens(member, null).map((screen) => memberHref(member.slug, screen.key, screen.page)),
    ),
    /*
      作品1件の恒久リンクと、本文のある作品の本文の画面（…/story）。slug の無い行
      （列より前からある作品）は URL を持たない
    */
    ...items.flatMap((item) =>
      [itemHref(item), itemStory(item.body).length ? itemStoryHref(item) : null].filter(
        (path) => path !== null,
      ),
    ),
  ]

  const body = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    // 同じ URL は1度だけ。2度出すと「どちらが正か」を自分で曖昧にする
    ...[...new Set(paths)].map(
      (path) => `  <url><loc>${xmlText(`${SITE.origin}${path}`)}</loc></url>`,
    ),
    '</urlset>',
    '',
  ].join('\n')

  return c.body(body, 200, { 'content-type': 'application/xml; charset=UTF-8' })
}
