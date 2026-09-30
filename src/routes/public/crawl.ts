import { drizzle } from 'drizzle-orm/d1'
import type { Context } from 'hono'
import { listPublishedItemKeys, listPublishedMembers, publishedBlocks } from '../../db/queries'
import * as schema from '../../db/schema'
import type { AppEnv } from '../../env'
import { SITE } from '../../site'
import { itemHref } from '../../ui/components'
import { NO_FILTER } from './data'
import { memberHref } from './member-page'
import { sitePageLinks, sitePages } from './site'

/*
  クローラ向けの2本（robots.txt と sitemap.xml）。

  手で URL を並べた表は置かない——構成を並べ替えたり、作品を1件足したり
  した日に、実物と表が静かにずれる。公開ページのページの並びをそのまま数え上げる
  （site.ts の sitePages。公開ページが節を出すかどうかを決めているのと同じ式）。
  check:fit も測る URL をここから引く。

  転送するだけの URL（/team の 301・前の続き /members/<slug>/about・前の本文の
  画面 …/story・割っていたころの /projects/2）は載せない。

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
  // 作品は URL を組むぶん（区分・slug）だけ。一覧の行の子（タグ・リンク・担当・
  // プラットフォーム）は要らないので、全件ぶんを引かない
  const [members, blocks, items] = await Promise.all([
    listPublishedMembers(db),
    publishedBlocks(db),
    listPublishedItemKeys(db),
  ])

  // 絞り込みを付けない素のサイト。?kind= 付きの URL は正ではないので載せない
  const { pages } = await sitePages(db, blocks, members, NO_FILTER)

  const paths = [
    /*
      入口。置いたものが全部下書きでも 200 で「まだ何も置いていません」を出す
      （オーナーが自分のサイトから締め出されないための分岐）ので、並びが
      空でもここは在る。例外は並びの先頭がプロフィールのとき（1人のサイトで
      Hero を外し Team を先頭に置いた構成）で、/ はそのページへ送るだけなので
      載せない——送る元の URL を並べない（/apps や /team と同じ）。
    */
    ...(pages[0]?.kind === 'profile' ? [] : ['/']),
    /*
      トップのページ。並べるのは href ではなく canonical——先頭は / と /<slug> の
      2つの URL で開けるので、正の1つだけを出す（重なりは下で落とす）。1人の
      サイトではプロフィールのページ（/members/<slug>）もここに入り、/team は
      入らない（301 で寄せる元）。
    */
    ...sitePageLinks(pages, NO_FILTER).map((link) => link.canonical),
    // 縦に積んだ全体版。正が自分自身なので、ここに並ぶ資格がある
    '/all',
    /*
      個人ページ。1人のサイトのプロフィールは上のサイトのページと同じ URL に
      なる（重なりは下で落とす）。Team を置いていないサイトや2人以上のサイトでは、
      ここにしか出てこない
    */
    ...members.map((member) => memberHref(member.slug)),
    // 作品1件の恒久リンク。slug の無い行（列より前からある作品）は URL を持たない
    ...items.map(itemHref).filter((path) => path !== null),
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
