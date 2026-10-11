import { env } from 'cloudflare:test'
import wordmarkFile from 'virtual:asset:astlog-wordmark.svg'
import faviconFile from 'virtual:asset:favicon.svg'
import skyFile from 'virtual:asset:sky.svg'
import assetFiles from 'virtual:assets'
import seedSql from 'virtual:repo:seed.sql'
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import css from '../public/app.css'
import * as schema from '../src/db/schema'
import { ITEM_KINDS } from '../src/domain'
import { publicRoutes } from '../src/routes/public/routes'
import { skySvg } from '../src/ui/astra'
import { itemHref, LinkList, LinkRow, splitPhrases } from '../src/ui/components'
import { cardSvg, iconSvg, WORDMARK, wordmarkSvg } from '../src/ui/logo'
import {
  db,
  form,
  get,
  okText,
  resetDb,
  TEST_SITE as SITE,
  seedItem,
  seedMember,
  signIn,
  touch,
} from './helpers'

beforeEach(resetDb)

/*
  main の中だけを見る。上の帯と足元には同じ行き先のリンクが常に出ているので、
  ページ全体を見ると「本文にある」ことを確かめられない（足元は main の後ろにあるので、
  </main> で切る）。開きタグを正規表現で読むのは、main が属性（id と tabindex="-1"）を持つため。
*/
const mainOf = (html: string) => (html.split(/<main[^>]*>/)[1] ?? '').split('</main>')[0] ?? ''

// 目次（上の帯の中）だけを見る。同じ文字列は見出しにも本文のリンクにも出る
const tocOf = (html: string) => html.split('<nav class="toc"')[1]?.split('</nav>')[0] ?? ''

// 上の帯だけを見る（ロゴと目次）。最初の </header> は上の帯のもの（入口の Hero はその後ろ）
const topOf = (html: string) =>
  html.slice(html.indexOf('<header class="top"'), html.indexOf('</header>'))

// 足元だけを見る。名前や連絡先は本文にも出るので、ページ全体では確かめられない
const footOf = (html: string) =>
  html.slice(html.indexOf('<footer class="foot"'), html.indexOf('</footer>'))

// 入口の Hero（本文の中の <header class="hero…">）だけを見る
const heroOf = (html: string) => {
  const main = mainOf(html)
  return main.slice(main.indexOf('<header class="hero'), main.indexOf('</header>'))
}

describe('全体ページ', () => {
  it('置いたブロックを1ページに出す。canonical は自分自身', async () => {
    await seedMember()
    await seedItem({ type: 'app' })

    const response = await get('/all')
    expect(response.status).toBe(200)

    const html = await response.text()
    expect(html).toContain('class="hero"')
    expect(html).toContain('<section id="projects"')
    expect(html).toContain('<section id="contact"')
    /*
      正は自分自身。ここを / にしていたころは、中身が全部ある唯一のページを
      「作品を1件も含まないトップの複製」として申告していた——載るのが中身の
      薄い準重複の画面ばかりで、載らないのが完全版、という逆の形になる。
    */
    expect(html).toContain(`<link rel="canonical" href="${SITE.origin}/all"/>`)
    expect(html).not.toContain(`<link rel="canonical" href="${SITE.origin}/"/>`)
  })

  it('説明文で全体版だと言う。並べるのは実際に描いた節の名前', async () => {
    await seedMember()
    await seedItem({ type: 'app' })

    const html = await okText('/all')
    /*
      固定の一覧を書くと、節を1つ外した日にここだけ古い名前を出し続ける。
      公開中が1人なので、Team の位置はプロフィール（Profile）
    */
    expect(html).toContain('content="Projects · Profile · Contact を1ページにまとめた全体版です。')
  })
})

/*
  中身の出し分け（何が出て何が出ないか）は `/all` で見る。
  公開中のブロックが全部1ページに出る唯一の URL で、1回の取得で確かめられる。
*/
describe('トップページ', () => {
  it('公開中のものだけを出す', async () => {
    const member = await seedMember()
    await seedItem({ title: '公開のアプリ', memberId: member.id, platformKey: 'web' })
    await seedItem({ title: '下書きのアプリ', memberId: member.id, published: 0 })

    const html = await okText('/all')
    expect(html).toContain('公開のアプリ')
    expect(html).not.toContain('下書きのアプリ')
  })

  it('区分の絞り込みは、両方の区分に項目があるときだけ並べる', async () => {
    await seedItem({ type: 'app', platformKey: 'web' })

    // 個人開発しか無いサイトで「業務」を置いても、押した先は0件の知らせだけ
    const only = await okText('/projects')
    expect(only).not.toContain('kind=')

    await seedItem({ type: 'work', title: '業務の実績' })
    const both = await okText('/projects')
    expect(both).toContain('href="/projects?kind=app"')
    expect(both).toContain('href="/projects?kind=work"')
    // プラットフォームでは絞らない（一覧の行の札には残る）
    expect(both).not.toContain('platform=')
  })

  it('個人開発と業務を1つの一覧に、新しい順で並べる', async () => {
    await seedItem({ type: 'app', title: '古いアプリ', year: '2023', sortOrder: 10 })
    await seedItem({ type: 'work', title: '続いている業務', year: '2024 — 現在', sortOrder: 10 })
    await seedItem({ type: 'app', title: '新しいアプリ', year: '2026', sortOrder: 20 })
    await seedItem({ type: 'work', title: '年の無い業務', year: '', sortOrder: 20 })

    const html = await okText('/all')
    const order = ['新しいアプリ', '続いている業務', '古いアプリ', '年の無い業務'].map((title) =>
      html.indexOf(title),
    )
    expect(order.every((at) => at > 0)).toBe(true)
    /*
      年は頭の4桁で比べる（「2024 — 現在」は 2024）。続いているものを経歴と
      同じ「— 現在」で書くようにしても、並びは変わらない。年を書いていない行は最後
    */
    expect(order).toEqual([...order].sort((a, b) => a - b))
  })

  it('メンバーが2人なら横長、3人以上ならグリッドにする', async () => {
    // 1人のサイトでは Team そのものが無い（プロフィールに置き換わる）
    await seedMember()
    await seedMember({ slug: 'b', name: 'B' })
    expect(await okText('/all')).toContain('member--wide')

    await seedMember({ slug: 'c', name: 'C' })
    expect(await okText('/all')).toContain('member--compact')
  })

  it('アバターは遅延読み込みにしない（空の丸のまま見えてしまう）', async () => {
    await seedMember({ avatarUrl: '/assets/avatar.png' })
    const html = await okText('/all')
    expect(html).toContain('src="/assets/avatar.png"')
    expect(html).not.toContain('loading="lazy"')
  })

  it('下書きのメンバーは名前もリンクも出さない', async () => {
    const draft = await seedMember({ slug: 'draft', name: '下書きの人', published: 0 })
    await seedMember({ slug: 'shown', name: '公開の人' })
    await seedMember({ slug: 'shown2', name: 'もう一人' })
    await seedItem({ title: '担当者が下書きのアプリ', memberId: draft.id })

    const html = await okText('/all')
    expect(html).toContain('担当者が下書きのアプリ')
    expect(html).not.toContain('/members/draft')
    expect(html).not.toContain('下書きの人')
  })
})

/*
  1人として名乗る。

  実体は1人なのに、文言も構造化データも「複数いる前提の器」で書いてあった。
  採る側は「誰を採るのか」を探しに来ているので、器の名前しか出ないページは
  その問いから遠ざかる。人数で決めるので、2人目を公開した日に器へ戻る。
*/
describe('名乗り', () => {
  it('公開中が1人なら、入口は Person として名乗る', async () => {
    await seedMember({ name: '岡崎 昂功', role: 'System Engineer' })
    await seedItem()

    const html = await okText('/')
    expect(html).toContain('"@type":"Person"')
    expect(html).toContain('"jobTitle":"System Engineer"')
    // 器として名乗ると、人の名前も職種も構造化データに1つも出ない
    expect(html).not.toContain('"@type":"Organization"')
  })

  it('文言に複数形の名乗りが残っていない', async () => {
    await seedMember()
    await seedItem()

    // 「つくる人たちの、置き場所。」「メンバーごとにまとめています」は、
    // 1人のサイトが自分を器として紹介していた言い方。src/site.ts が正
    for (const path of ['/', '/all']) {
      const html = await okText(path)
      expect(html, path).not.toContain('つくる人たち')
      expect(html, path).not.toContain('メンバーごとに')
    }
  })

  it('2人以上なら器（Organization）に戻る。仕組みは壊していない', async () => {
    await seedMember()
    await seedMember({ slug: 'hoshino', name: '星野' })
    await seedItem()

    const html = await okText('/')
    expect(html).toContain('"@type":"Organization"')
    // 中の member の列はそのまま。Team ブロックも members テーブルも生きている
    expect(html).toContain('"url":"https://astlog.dev/members/hoshino"')
  })

  it('Team の見出しに添えを置かない。訳語も人数も', async () => {
    await seedMember()
    await seedMember({ slug: 'hoshino', name: '星野' })
    const html = await okText('/team')
    // 「メンバー」は Team の訳語でしかなく、見出しを2つの言語で2度言うだけだった
    expect(html).toContain('<div class="head"><h1>Team</h1></div>')
    expect(html).not.toContain('<span class="note">')
    // 複数いる前提の器に1人しか入っていないことを、自分で数えて告知していた
    expect(html).not.toContain('2 members')
  })

  it('名乗りは入口のページだけ。ほかのページには載せない', async () => {
    await seedMember()
    await seedItem()

    // 同じサイトの名乗りがページの数だけ並ぶと、どれが本体か決められない
    expect(await okText('/')).toContain('application/ld+json')
    expect(await okText('/projects')).not.toContain('application/ld+json')
    /*
      1人のサイトの個人ページは、サイトの並びの途中（Team の位置）。
      入口と同じ人をもう一度名乗らない
    */
    expect(await okText('/members/okazaki')).not.toContain('application/ld+json')

    // 2人以上のサイトの個人ページは、Team から入る脇のページ。その人の Person を名乗る
    await seedMember({ slug: 'hoshino', name: '星野' })
    expect(await okText('/members/okazaki')).toContain('application/ld+json')
  })

  it('個人ページは、1人のあいだ worksFor を名乗らない', async () => {
    await seedMember()
    /*
      Team を置かない1人のサイト。個人ページは並びの外のページで、Person を
      名乗る（Team を置くと並びの途中になり、名乗り自体を載せない）
    */
    await db()
      .insert(schema.blocks)
      .values([
        { type: 'hero' as const, published: 1, sortOrder: 10 },
        { type: 'contact' as const, published: 1, sortOrder: 20 },
      ])
    const solo = await okText('/members/okazaki')
    expect(solo).toContain('"@type":"Person"')
    // トップが同じ URL を Person として名乗っているので、
    // ここで同じ URL の Organization を書くと1つの URL が2つの型を持つ
    expect(solo).not.toContain('worksFor')

    await seedMember({ slug: 'hoshino', name: '星野' })
    expect(await okText('/members/okazaki')).toContain('worksFor')
  })

  it('ロゴの形は1か所が正。素材のファイルがずれたら落とす', () => {
    /*
      ロゴの形の正は src/ui/logo.ts で、ページはそこから直に描く。素材のファイル
      （ワードマークと favicon の SVG）は scripts/logo/export.mjs が同じ形から書くが、
      別ファイルなので、ここで突き合わせる以外に一致を保つ手が無い。ずれても型は
      黙るし、画面も一見それらしく出る（形か色を変えたら export.mjs で書き直す）。

      **fetch では確かめられない。** workerd では public/ が配られず 404 に
      なるうえ、その 404 ページ自身がロゴを描いているので、
      `(await get('/assets/…')).text()` を見る書き方は素通りで緑になる
      （実際にそう書いて通ってしまった）。ファイルの中身は
      vitest.config.ts の assetPlugin が渡す。

      どちらも輪郭の path だけで、絵も外のものも抱えない（public/_headers の CSP は
      何も読み込ませない）
    */
    expect(wordmarkFile).toBe(wordmarkSvg())
    expect(faviconFile).toBe(iconSvg())
    for (const file of [wordmarkFile, faviconFile]) {
      expect(file).not.toMatch(/<image|data:|href=/)
    }
  })

  it('夜明けの窓の素材（空）は astra.ts が正。点だけで色相を持たない', () => {
    /*
      ロゴと同じく、ファイルは scripts/logo/export.mjs が src/ui/astra.ts から書く。
      app.css が夜明けの窓の星の形（mask）として読む（HTML には置かない）。ファイルの色は
      窓の星と同じ白（LOGO_COLORS.ink）を不透明度で薄めるだけ——前に試した橙の星は、
      モノクロの中で1つだけ色を持ち、目がそこへ寄り道した
    */
    expect(skyFile).toBe(skySvg())
    expect(skyFile).not.toMatch(/<image|data:|href=|<filter|Gradient/)
    const colors = new Set(
      [...skyFile.matchAll(/(?:fill|stroke)="(#[0-9a-f]+)"/g)].map((m) => m[1]),
    )
    expect([...colors]).toEqual(['#ffffff'])
  })

  it('ページと CSS が読む素材は、どれも public/assets にある', async () => {
    /*
      favicon と apple-touch-icon（scripts/logo/export.mjs）は素材のファイル。名前を
      1字違えても型もテストも黙り、ブラウザでだけ黙って欠ける。
      workerd では public/ が配られないので、ファイルの名前の一覧（assetPlugin）と
      突き合わせる。逆に、ページも CSS も読まないファイルは、外で使う理由を持つもの
      だけを置く（読まれない素材が黙って配られ続けない）
    */
    const member = await seedMember()
    await seedItem({ type: 'app' })
    const html = await okText('/')
    const signed = await signIn()
    const admin = await signed('/admin/members/new')
    expect(admin.status).toBe(200)
    const pages = [
      html,
      await okText('/contact'),
      await okText(`/members/${member.slug}`),
      await admin.text(),
    ]
    // CSS はコメントを落として読む（コメントに書いた素材の名前を、読む素材と数えない）
    const rules = css.replace(/\/\*[\s\S]*?\*\//g, '')
    const read = new Set(
      [...`${pages.join('\n')}\n${rules}`.matchAll(/\/assets\/([\w.-]+)/g)].map(
        (found) => found[1],
      ),
    )
    for (const file of [
      'favicon.svg',
      'favicon-32.png',
      'apple-touch-icon.png',
      'astlog-card.png',
      'sky.svg',
      'poppins-400.woff2',
      'poppins-500.woff2',
      'poppins-600.woff2',
      'poppins-700.woff2',
    ]) {
      expect(read, file).toContain(file)
    }
    for (const file of read) expect(assetFiles, file).toContain(file)
    const OUTSIDE = new Set([
      // ページの外で使うワードマーク（ページはインラインの SVG で描く）
      'astlog-wordmark.svg',
      // 同梱した書体（Poppins）に添えるライセンス（SIL OFL は書体と一緒に配ることを求める）
      'poppins-OFL.txt',
    ])
    // 作品の検査素材はローカル KV に投入し、本番の public/ に同梱しない。
    expect(seedSql.replace(/--.*$/gm, '')).not.toMatch(/\/assets\/(?:appmixer-|avatar)/)
    expect(assetFiles).not.toContain('avatar.png')
    expect(assetFiles.some((file) => file.startsWith('appmixer-'))).toBe(false)
    for (const file of assetFiles) {
      expect(read.has(file) || OUTSIDE.has(file), `${file} を読む所が無い`).toBe(true)
    }
    // favicon は画像ファイル（data URI の SVG はやめた。CSP の img-src は 'self' だけ）
    expect(html).toContain('<link rel="icon" type="image/svg+xml" href="/assets/favicon.svg"/>')
    expect(html).toContain(
      '<link rel="icon" type="image/png" sizes="32x32" href="/assets/favicon-32.png"/>',
    )
    expect(html).toContain('<link rel="apple-touch-icon" href="/assets/apple-touch-icon.png"/>')
    expect(html).not.toContain('data:image')
  })

  it('ロゴはどのページでも同じ形。メンバーや作品で変えない', async () => {
    const member = await seedMember()
    await seedMember({ slug: 'second', name: '星野' })
    const item = await seedItem({ memberId: member.id, type: 'app', slug: 'wordmark-member' })
    const marks = new Set<string>()
    for (const path of [
      '/',
      '/projects',
      '/contact',
      '/all',
      `/members/${member.slug}`,
      `/apps/item/${item.slug}`,
    ]) {
      const html = await okText(path)
      marks.add(html.match(/<svg class="brand__word"[\s\S]*?<\/svg>/)?.[0] ?? '')
    }
    expect([...marks]).toHaveLength(1)
    expect([...marks][0]).toContain(`viewBox="${WORDMARK.viewBox}"`)
    /*
      O は軌道と衛星。上の帯・ログイン・共有カード・素材で同じ1つの形（大きさで形を変えない）。
      衛星を共有カードだけに置いていたころは、ロゴが2つの形を持っていた
    */
    expect([...marks][0]).toContain(`<path d="${WORDMARK.satellite}"`)
    expect(wordmarkFile).toContain(WORDMARK.satellite)
    expect(cardSvg()).toContain(WORDMARK.satellite)
    expect(WORDMARK.strokes).not.toMatch(/Z/)
  })

  it('上の帯のロゴはワードマークと、リンクの名前の字。絵は読み上げに出さない', async () => {
    /*
      ワードマーク（ΛSTLOG）は aria-hidden なので、リンクの名前は .sr-only の
      字が持つ——名前の無いリンクにならない（WCAG 4.1.2）
    */
    const top = topOf(await okText('/'))
    const brand = top.slice(
      top.indexOf('<a class="brand"'),
      top.indexOf('</a>', top.indexOf('<a class="brand"')),
    )
    expect(brand).toContain('<svg class="brand__word"')
    // 字の輪郭だけ（絵は持たない）。img は置かない（名前は字が持つ）
    expect(brand).not.toMatch(/<image|<img/)
    expect(brand.match(/aria-hidden="true"/g)).toHaveLength(1)
    expect(brand).toContain(`<span class="sr-only">${SITE.name}</span>`)
  })

  it('Person の url は、名乗る場所で変わる', async () => {
    /*
      同じ Person が3か所に出る——1人のときのサイト自身、器の中の member[]、
      個人ページ。url だけがそれぞれ違い、**1人ならサイトの origin**（その人が
      サイト本体）、そうでなければ /members/<slug>。

      「1人なら器は要らない」という設計の要点がこの1行に乗っているのに、
      取り違えても型は黙るし、@type も name も jobTitle も同じなので
      見た目でも気づけない。3か所を1本の関数に寄せたので、その1本が
      正しい url を受け取っているかをここで留める。
    */
    const solo = await seedMember()
    const home = await okText('/')
    // 1人：サイト自身がその人。url はサイトの origin
    expect(home).toContain(`"@type":"Person","name":"${solo.name}"`)
    expect(home).toContain('"url":"https://astlog.dev"')
    expect(home).not.toContain('"url":"https://astlog.dev/members/okazaki"')

    // 2人目が公開されると器に戻り、member[] の中では各自の URL を名乗る
    await seedMember({ slug: 'hoshino', name: '星野' })
    const org = await okText('/')
    expect(org).toContain('"@type":"Organization"')
    expect(org).toContain('"url":"https://astlog.dev/members/okazaki"')
    expect(org).toContain('"url":"https://astlog.dev/members/hoshino"')

    /*
      個人ページ：その人の URL。1人のサイトの個人ページは並びの途中なので
      名乗り自体を載せない（上の「名乗りは入口のページだけ」）。見るのは2人以上のとき
    */
    const mine = await okText('/members/okazaki')
    expect(mine).toContain('"url":"https://astlog.dev/members/okazaki"')
  })
})

/*
  入口（/）は、このサイトがいちばん仕事をするページ。名前・職種・数がここに
  無いと、最初に開いたページから持ち帰れるものが何も無い。
*/
describe('入口の画面', () => {
  it('句読点の直後でだけ区切る。語の途中（「置いてお / く。」）では切らない', () => {
    expect(splitPhrases('つくったものを、置いておく。')).toEqual([
      'つくったものを、',
      '置いておく。',
    ])
    // 句読点が無ければ1つの塊のまま（英語は塊の中の空白で折れる）
    expect(splitPhrases('AstLog')).toEqual(['AstLog'])
    expect(splitPhrases('')).toEqual([''])
  })

  it('入口の大見出しは、その人の大見出し。名前は大見出しの上の札。押し手も Hero の中', async () => {
    /*
      名前を真ん中に据えていたころ、持ち主が「中央に自分の名前があるのはださい。
      Profile で出る」と外した。入口の大見出しはその人の一文（members.headline）で、
      名前は大見出しの上の小さな札（「名前・職種・所在地」）と足元（SiteIdentity）が持つ——
      札にも名前が無かったころは、最初の画面のどこにも誰のサイトかが出ていなかった
    */
    await seedMember({
      name: '岡崎 昂功',
      role: 'System Engineer',
      location: '神奈川',
      headline: 'つくる工程そのものを、速くする。',
    })
    await seedItem()

    const hero = heroOf(await okText('/'))
    expect(hero.match(/<h1>(.*?)<\/h1>/)?.[1]?.replace(/<[^>]+>/g, '')).toBe(
      'つくる工程そのものを、速くする。',
    )
    // 札は「名前・職種・所在地」。部分ごとに、英字だけのものにだけ lang="en"
    expect(hero).toContain(
      '<p class="eyebrow"><span>岡崎 昂功</span><span lang="en">System Engineer</span><span>神奈川</span></p>',
    )
    for (const part of splitPhrases(SITE.heroLead)) {
      expect(hero).toContain(`>${part}</span>`)
    }
    // 一覧が主、プロフィールは枠線だけの2本目。絵も件数の帯も置かない
    expect(hero).toContain(
      '<div class="hero__actions"><a class="cta" href="/projects">作品を見る<span class="cta__arrow" aria-hidden="true">→</span></a><a class="cta cta--quiet" href="/members/okazaki">プロフィール<span class="cta__arrow" aria-hidden="true">→</span></a></div>',
    )
    expect(hero).not.toMatch(/<img|<svg|class="tally/)
  })

  it('大見出しを書いていない人の入口は、名前を大見出しにする', async () => {
    await seedMember({ name: '岡崎 昂功', headline: '' })
    const hero = heroOf(await okText('/'))
    expect(hero.match(/<h1>(.*?)<\/h1>/)?.[1]?.replace(/<[^>]+>/g, '')).toBe('岡崎 昂功')
  })

  it('全体ページの頭は名前を目に見える h1 で置き、肩書きを添える。和文の肩書きには lang を付けない', async () => {
    /*
      全体ページ（/all）は印刷と Ctrl-F の宛先なので、名前を目に見える字で置く。
      等幅は英字の札にだけ掛ける（app.css は .eyebrow :lang(en)）。和文の
      肩書きに lang="en" を付けると、読み上げが英語の発音で読み、字も等幅の
      字間で組まれる
    */
    await seedMember({ name: '岡崎 昂功', role: 'システムエンジニア' })

    const hero = heroOf(await okText('/all'))
    expect(hero.match(/<h1>(.*?)<\/h1>/)?.[1]?.replace(/<[^>]+>/g, '')).toBe('岡崎 昂功')
    expect(hero).toContain('<p class="eyebrow"><span>システムエンジニア</span></p>')
    // 押し手は置かない（一覧はすぐ下に並ぶ）
    expect(hero).not.toContain('class="cta')
  })

  it('全体ページの英字だけの肩書きには lang="en"（読み上げの発音と、等幅の札にする印）', async () => {
    await seedMember({ name: '岡崎 昂功', role: 'System Engineer' })
    const whole = await okText('/all')
    expect(whole).toContain('<p class="eyebrow"><span lang="en">System Engineer</span></p>')
  })

  it('公開中が2人以上なら、大見出しはサイトの一言。札は添えない', async () => {
    await seedMember()
    await seedMember({ slug: 'tanaka', name: '田中 未来', sortOrder: 20 })

    const hero = heroOf(await okText('/'))
    expect(hero.match(/<h1>(.*?)<\/h1>/)?.[1]?.replace(/<[^>]+>/g, '')).toBe(SITE.tagline)
    expect(hero).not.toContain('class="eyebrow"')
  })
})

/*
  足元。著作権表示とサイトの行き先（GitHub・Instagram・X・メール）だけ——持ち主の
  「シンプルに」。名前・職種・一言は置かない（誰のサイトかは入口の札と Profile が言う）。
*/
describe('足元', () => {
  it('著作権表示とサイトの行き先だけ。名前・職種・一言は、1人のサイトでも置かない', async () => {
    await seedMember({
      name: '岡崎 昂功',
      role: 'System Engineer',
      skillsText: 'C# | 3年以上',
      careerText: '2024.03 | 入社 | ある会社',
    })
    await seedItem({ slug: 'appmixer' })

    for (const path of [
      '/',
      '/projects',
      '/members/okazaki',
      '/apps/item/appmixer',
      '/contact',
      '/all',
    ]) {
      const foot = footOf(await okText(path))
      expect(foot, path).toMatch(/<p class="foot__meta">© \d{4} AstLog<\/p>/)
      expect(foot, path).not.toContain('岡崎 昂功')
      expect(foot, path).not.toContain('System Engineer')
      expect(foot, path).not.toContain(SITE.tagline)
    }
    // 上の帯にも名前を置かない（ロゴと目次だけ）
    expect(topOf(await okText('/projects'))).not.toContain('岡崎 昂功')
  })

  it('2人以上のサイトでも同じ足元', async () => {
    await seedMember()
    await seedMember({ slug: 'hoshino', name: '星野', role: 'Designer' })
    await seedItem({ slug: 'appmixer' })

    for (const path of ['/', '/projects', '/team', '/members/okazaki', '/contact', '/all']) {
      const foot = footOf(await okText(path))
      expect(foot, path).toMatch(/<p class="foot__meta">© \d{4} AstLog<\/p>/)
      expect(foot, path).not.toContain('星野')
    }
  })

  it('Contact の画面では、足元に GitHub / メールを出さない。本文に同じ手がある', async () => {
    await seedMember()

    const contact = await okText('/contact')
    expect(footOf(contact)).not.toContain('GitHub')
    expect(footOf(contact)).not.toContain('mailto:')
    // 行き先は本文に残っている（同じ行き先を足元と本文に2組並べない）
    expect(mainOf(contact)).toContain(`href="${SITE.github}"`)
    expect(mainOf(contact)).toContain(`href="mailto:${SITE.email}"`)

    // ほかの画面の足元には今までどおり出る。全体ページの Contact は節の1つで、足元は全体のもの
    for (const path of ['/', '/all']) {
      expect(footOf(await okText(path)), path).toContain('GitHub')
      expect(footOf(await okText(path)), path).toContain('mailto:')
    }
  })

  it('題と説明にも名前と職種を入れる。共有リンクと検索結果が手ぶらになる', async () => {
    await seedMember({ name: '岡崎 昂功', role: 'System Engineer' })
    await seedItem()

    const html = await okText('/')
    expect(html).toContain('<title>岡崎 昂功（System Engineer） — AstLog</title>')
    expect(html).toContain('content="岡崎 昂功（System Engineer）のポートフォリオ。')
  })
})

/*
  入口の押し手（「作品を見る →」と「プロフィール →」）。作品そのものは一覧（Projects）の
  ページにあり、その人のことは個人ページにある。件数の帯（「07 Projects」「Since 2024」）は
  置かない——数の少なさを目立たせるだけだった（components.tsx の Hero）。
*/
describe('入口の押し手', () => {
  it('一覧への1本が主で、プロフィールは枠線だけの2本目。件数は数えない', async () => {
    await seedMember()
    await seedItem({ type: 'app', title: 'アプリ壱' })
    await seedItem({ type: 'work', title: 'ある仕事' })

    const hero = heroOf(await okText('/'))
    expect(hero).toContain('<a class="cta" href="/projects">')
    expect(hero).toContain('<a class="cta cta--quiet" href="/members/okazaki">')
    expect(hero).not.toContain('class="tally')
    expect(hero).not.toContain('Since')
  })

  it('全体ページには押し手を置かない。一覧がすぐ下に並ぶ', async () => {
    await seedMember()
    await seedItem()

    const whole = mainOf(await okText('/all'))
    expect(whole).not.toContain('class="cta')
  })

  it('全体ページの Projects には絞り込みを置かない。Projects のページには置く', async () => {
    /*
      全体ページの絞り込みは /projects?kind=… へ移るリンクで、「すべて」の印（aria-current）が
      別のページを「いまのページ」と名乗っていた。全体ページは中身を全部載せる場所
    */
    await seedMember()
    await seedItem({ type: 'app', slug: 'a' })
    await seedItem({ type: 'work', slug: 'w', sortOrder: 20 })

    expect(mainOf(await okText('/all'))).not.toContain('class="filters"')
    expect(mainOf(await okText('/projects'))).toContain('class="filters"')
  })

  it('一覧のページが無ければ一覧への1本を置かず、プロフィールが主の1本になる', async () => {
    await seedMember()
    await seedItem()
    await db()
      .insert(schema.blocks)
      .values([
        { type: 'hero' as const, published: 1, sortOrder: 10 },
        { type: 'team' as const, published: 1, sortOrder: 20 },
        { type: 'contact' as const, published: 1, sortOrder: 30 },
      ])

    const hero = heroOf(await okText('/'))
    expect(hero).not.toContain('href="/projects"')
    expect(hero).toContain('<a class="cta" href="/members/okazaki">プロフィール')
  })

  it('一覧もプロフィールも並びに無ければ、押し手の並びごと置かない', async () => {
    await seedMember()
    await seedItem()
    await db()
      .insert(schema.blocks)
      .values([
        { type: 'hero' as const, published: 1, sortOrder: 10 },
        { type: 'contact' as const, published: 1, sortOrder: 20 },
      ])

    expect(heroOf(await okText('/'))).not.toContain('hero__actions')
  })
})

/*
  ページの移動。公開ページは節ごとに1ページで、行き来するのは目次（上の帯）と
  ページの中のリンク（入口の一覧への1本・一覧の行・「← 一覧に戻る」）だけ。画面の底の左右の手
  （ページャ）は外した——持ち主が触って「スクロールできず、底の左右の手でしか
  めくれないのが面倒すぎる」と判断した（CLAUDE.md の「公開ページは縦に読む」）。
*/
describe('ページの移動', () => {
  it('どのページにも画面の底のページャを出さない。前後の rel も置かない', async () => {
    await seedMember({ skillsText: 'C# | 3年以上', careerText: '2024.03 | 入社 | ある会社' })
    await seedItem({ slug: 'appmixer', body: '背景です。' })
    await seedItem({ slug: 'second', title: '二つ目' })
    const [note] = await db()
      .insert(schema.blocks)
      .values([
        { type: 'hero' as const, published: 1, sortOrder: 10 },
        { type: 'projects' as const, published: 1, sortOrder: 20 },
        { type: 'note' as const, title: 'メモ', body: '段落。', published: 1, sortOrder: 30 },
        { type: 'team' as const, published: 1, sortOrder: 40 },
        { type: 'contact' as const, published: 1, sortOrder: 50 },
      ])
      .returning()
      .then((rows) => rows.filter((row) => row.type === 'note'))
    if (!note) throw new Error('ブロックを置けなかった')

    for (const path of [
      '/',
      '/projects',
      `/block-${note.id}`,
      '/members/okazaki',
      '/apps/item/appmixer',
      '/contact',
    ]) {
      const html = await okText(path)
      expect(html, path).not.toContain('class="pager')
      expect(html, path).not.toMatch(/rel="(prev|next)"/)
      // 行き来の手は目次。どのページでも、名前のある節が全部並ぶ
      expect(tocOf(html), path).toContain('href="/projects"')
      expect(tocOf(html), path).toContain('href="/members/okazaki"')
      expect(tocOf(html), path).toContain('href="/contact"')
    }
  })

  it('入口と一覧のあいだにページを置いても、入口の1本は一覧へ送る', async () => {
    await seedMember()
    await seedItem()
    await db()
      .insert(schema.blocks)
      .values([
        { type: 'hero' as const, published: 1, sortOrder: 10 },
        {
          type: 'statement' as const,
          title: 'つくる速さは、設計で決まる。',
          published: 1,
          sortOrder: 20,
        },
        { type: 'projects' as const, published: 1, sortOrder: 30 },
      ])

    const html = await okText('/')
    expect(html).toContain('class="cta" href="/projects"')
  })
})

/*
  全体ページ（/all）は公開ページからリンクしない。足元は著作権表示と行き先だけにした
  （持ち主の「シンプルに」）。行き先は sitemap.xml と管理画面の1本（admin.test.ts）。
*/
describe('全体ページへの道', () => {
  it('公開ページの足元にも本文にも置かない', async () => {
    await seedMember()
    await seedItem()
    for (const path of ['/', '/projects', '/members/okazaki', '/contact']) {
      expect(await okText(path), path).not.toContain('href="/all"')
    }
  })

  it('sitemap.xml には載る（印刷・Ctrl-F・ブラウザ翻訳の宛先）', async () => {
    await seedItem()
    expect(await okText('/sitemap.xml')).toContain(`<loc>${SITE.origin}/all</loc>`)
  })
})

/*
  ページごとに URL を分けた以上、1ページ = 1ドキュメント。見出しはそのページの
  中で完結していなければならない（WCAG 1.3.1）。縦に積んだ全体ページ
  （/all）だけは今までどおり、Hero の h1 に節が h2 でぶら下がる。
*/
describe('ページごとの見出し', () => {
  const h1s = (html: string) => html.match(/<h1[^>]*>/g) ?? []

  it('ページごとの URL は、どれも h1 をちょうど1つ持つ', async () => {
    await seedMember({ skillsText: 'C# | 3年以上', careerText: '2024.03 | 入社 | ある会社' })
    await seedItem({ type: 'app', slug: 'appmixer', body: '背景です。' })
    await seedItem({ type: 'work' })

    // 1人のサイトなので /team は無い（プロフィールへ 301）。Team のページは下で2人にして見る
    for (const path of ['/', '/projects', '/contact', '/members/okazaki', '/apps/item/appmixer']) {
      expect(h1s(await okText(path)), path).toHaveLength(1)
    }

    await seedMember({ slug: 'hoshino', name: '星野' })
    expect(h1s(await okText('/team'))).toHaveLength(1)
  })

  it('節の見出しが h1 に上がる。/all では h2 のまま', async () => {
    await seedItem({ type: 'app' })

    expect(await okText('/projects')).toContain('<h1>Projects</h1>')
    // 1つの文書に節が並ぶページでは、h1 は Hero の1つだけ
    const whole = await okText('/all')
    expect(whole).toContain('<h2>Projects</h2>')
    expect(h1s(whole)).toHaveLength(1)
  })

  it('一文だけのページでは、その一文が h1。/all では段落のまま', async () => {
    const rows = await db()
      .insert(schema.blocks)
      .values([
        { type: 'hero' as const, published: 1, sortOrder: 10 },
        {
          type: 'statement' as const,
          title: 'つくる速さは、設計で決まる。',
          published: 1,
          sortOrder: 20,
        },
      ])
      .returning()
    const statement = rows[1]
    if (!statement) throw new Error('ブロックを置けなかった')

    // 見出しを持たないページをひとつも残さない。ここは大きな一文が見出しそのもの
    const screen = await okText(`/block-${statement.id}`)
    expect(screen).toContain('<h1 class="statement__text">つくる速さは、設計で決まる。</h1>')

    const whole = await okText('/all')
    expect(whole).toContain('<p class="statement__text">つくる速さは、設計で決まる。</p>')
    expect(h1s(whole)).toHaveLength(1)
  })

  it('見出しに訳語だけの添えを置かない（About / Skills / Career）', async () => {
    /*
      「紹介」「技術」「経歴」は見出しの訳語でしかなく、同じ見出しを2つの言語で
      2度言っていた。添えは見出しに無い情報（区分・年）のときだけ置く
    */
    await seedMember({ skillsText: 'C# | 3年以上', careerText: '2024.03 | 入社 | ある会社' })

    const html = await okText('/members/okazaki')
    for (const title of ['About', 'Skills', 'Career']) {
      expect(html, title).toContain(`<div class="head head--chapter"><h2>${title}</h2></div>`)
    }
    expect(html).not.toContain('<span class="note">')
  })

  it('Projects の添えは、区分の絞り込みが無いときだけ。そのときは区分の名前', async () => {
    // 区分が2つ: 見出しに並ぶ絞り込み（すべて / 個人開発 / 業務）が同じ言葉を並べるので添えない
    await seedItem({ type: 'app' })
    await seedItem({ type: 'work', title: '業務の実績' })
    // 見出しのすぐ後ろは件数（いま並んでいる行の数。2桁と、読み上げの「件」）
    const count = (n: number) =>
      `<span class="head__count">${String(n).padStart(2, '0')}<span class="sr-only"> 件</span></span>`
    const both = await okText('/projects')
    expect(both).toContain(`<div class="head"><h1>Projects</h1>${count(2)}</div>`)
    expect(both).toContain('href="/projects?kind=work"')

    // 区分が1つ: 絞り込みが並ばないので、何の一覧かを言うのは添えだけ
    await db().delete(schema.items).where(eq(schema.items.type, 'work'))
    await touch()
    const only = await okText('/projects')
    expect(only).toContain(
      `<div class="head"><h1>Projects</h1>${count(1)}<span class="note">個人開発</span></div>`,
    )
    expect(only).not.toContain('kind=')
  })

  it('作品のページの添え（区分の札・年）は残す。見出しに無い情報なので', async () => {
    await seedItem({
      type: 'work',
      title: '開発工程の効率化',
      slug: 'dev',
      category: '金融系',
      year: '2024 — 現在',
    })
    const html = await okText('/works/item/dev')
    expect(html).toContain('<span class="note">金融系 · 2024 — 現在</span>')
  })

  it('1人のサイトの個人ページは名前が題（h1）。大見出しは入口が出すので、2度並べない', async () => {
    await seedMember({ headline: 'つくる工程そのものを、速くする。' })

    const html = await okText('/members/okazaki')
    expect(html).toContain('<div class="nameplate nameplate--title">')
    expect(html).toContain('<h1 class="nameplate__name">岡崎 昂功</h1>')
    expect(mainOf(html)).not.toContain('つくる工程そのものを')
    expect(h1s(html)).toHaveLength(1)
    // 大見出しは入口の h1
    expect(heroOf(await okText('/'))).toContain('つくる工程そのものを')
  })

  it('2人以上のサイトの個人ページの h1 は大見出し。無ければ名札の名前', async () => {
    await seedMember({ headline: 'つくる工程そのものを、速くする。' })
    await seedMember({ slug: 'hoshino', name: '星野', sortOrder: 20 })

    const html = await okText('/members/okazaki')
    // 顔と名前は本文の名札に出る。大見出しのある人では、名前は見出しではない
    expect(html).toContain('<strong class="nameplate__name">岡崎 昂功</strong>')
    // 見出しは句読点で塊に分けてある（Phrases）。読める文字列としては1文のまま
    const h1 = html.match(/<h1 class="hero__headline">(.*?)<\/h1>/)?.[1] ?? ''
    expect(h1.replace(/<[^>]+>/g, '')).toBe('つくる工程そのものを、速くする。')
    expect(h1s(html)).toHaveLength(1)

    // About / Skills / Career は同じページの小節なので h2（h1 はページに1つ）
    expect(html).toContain('<h2>About</h2>')
  })
})

describe('技術の小見出しと、英語の塊', () => {
  it('小見出しは段落ではなく見出し。Skills が h2 なので h3', async () => {
    await seedMember({ skillsText: 'LANGUAGES:\nC# | 3年以上' })

    const html = await okText('/members/okazaki')
    expect(html).toContain('<h3 class="side-head" lang="en">LANGUAGES</h3>')
    expect(html).not.toContain('<p class="side-head"')
    expect(html).toContain('<h2>Skills</h2>')
  })

  it('塊の中は添えごとの行。添えは行に1度だけで、項目の列と dt / dd で結ぶ', async () => {
    /*
      項目ごとに添えを出していたころは、seed の技術で「3年以上」が11回並んでいた。
      添えは行の頭に1度だけ。読み上げで添えがその行の項目に結び付くよう、
      dt（添え）と dd（項目の列）の組にする。添えの無い項目は dl の外の最後の行
    */
    await seedMember({
      skillsText: 'LANGUAGES:\nC# | 3年以上\nSQL | 3年以上\nPython | 1年以上\nTypeScript\nSwift',
    })

    const html = mainOf(await okText('/members/okazaki'))
    expect(html.match(/3年以上/g)).toHaveLength(1)
    expect(html).toContain(
      '<div class="skill-row"><dt class="skill-row__note">3年以上</dt><dd><ul class="skill-list"><li>C#</li><li>SQL</li></ul></dd></div>',
    )
    expect(html).toContain(
      '<div class="skill-row"><dt class="skill-row__note">1年以上</dt><dd><ul class="skill-list"><li>Python</li></ul></dd></div>',
    )
    // 添えの無い行は最後。dt を持たない dd は置けないので dl の外
    expect(html).toContain('</dl><ul class="skill-list"><li>TypeScript</li><li>Swift</li></ul>')
    // 項目の中に添えを重ねて出さない（前の .exp）
    expect(html).not.toContain('class="exp"')

    // 全体ページ（/all）のプロフィールも同じ部品
    const whole = mainOf(await okText('/all'))
    expect(whole.match(/3年以上/g)).toHaveLength(1)
    expect(whole).toContain('<dt class="skill-row__note">3年以上</dt>')
  })

  it('日本語の中の英語の塊に lang="en"。日本語の見出しには付けない', async () => {
    await seedMember({ skillsText: 'LANGUAGES:\nC#\n\n言語:\nSQL' })

    const html = await okText('/members/okazaki')
    // 印が無いと、日本語の音声エンジンがローマ字読みするか読み飛ばす
    expect(html).toContain('<h3 class="side-head" lang="en">LANGUAGES</h3>')
    // 打ち込んだ見出しなので、日本語のものに付けると今度はそちらが読めなくなる
    expect(html).toContain('<h3 class="side-head">言語</h3>')
  })

  it('タグは英字だけの札にだけ lang="en"。和文のタグ（生成AI）には付けない', async () => {
    /*
      等幅は英字の札にだけ掛ける（app.css の .tags li:lang(en)）。和文のタグに
      印を付けると、読み上げが英語の発音で読み、字も等幅の字間で組まれる。
      一覧の行と作品のページは同じ Tags を使う
    */
    const item = await seedItem({ slug: 'dev', type: 'work' })
    await db()
      .insert(schema.itemTags)
      .values([
        { itemId: item.id, tag: 'C#', sortOrder: 0 },
        { itemId: item.id, tag: '生成AI', sortOrder: 1 },
      ])

    for (const path of ['/projects', '/works/item/dev']) {
      const html = mainOf(await okText(path))
      expect(html, path).toContain('<ul class="tags"><li lang="en">C#</li><li>生成AI</li></ul>')
    }
  })

  it('Team のカードの押す手は日本語（プロフィール →）。英語の印は要らない', async () => {
    /*
      操作の言葉は日本語、英語で書くのは節の名前だけ（CLAUDE.md「文言」）。
      「Profile →」のころは lang="en" で読み上げを直していたが、同じページの
      「一覧で見る →」「メールを送る →」と押す手の言葉だけ言語が違っていた
    */
    await seedMember()
    await seedMember({ slug: 'hoshino', name: '星野' })
    const html = await okText('/team')
    expect(html).toContain('<span class="member__go">プロフィール →</span>')
    expect(html).not.toContain('Profile →')
  })
})

/*
  Contact のページは足元の GitHub / メールを出さない（本文に同じ手がある）ので、
  本文に GitHub のプロフィールを常設する。
*/
describe('連絡先の行き先', () => {
  it('Contact のページに GitHub のプロフィールがある', async () => {
    await seedMember()

    for (const path of ['/contact']) {
      const main = mainOf(await okText(path))
      expect(main, path).toContain(`href="${SITE.github}"`)
      // メールはアドレスの手の1つだけ。同じ行き先を2つ置かない
      expect(main.match(/mailto:/g) ?? [], path).toHaveLength(1)
    }
  })

  it('メールの手はアドレスそのもの。紙に刷っても宛先が字で残る', async () => {
    await seedMember()

    const mail = `<a class="contact__mail" href="mailto:${SITE.email}"><span class="contact__address">${SITE.email}</span><span class="contact__go"><span aria-hidden="true">→ </span>メールを送る</span></a>`
    expect(mainOf(await okText('/contact'))).toContain(mail)
    // 全体ページ（印刷の宛先）も同じ手
    const whole = await okText('/all')
    expect(whole.slice(whole.indexOf('<section id="contact"'))).toContain(mail)
  })
})

describe('締めのページ（Contact）', () => {
  it('HTML に絵も図も置かない。見出しと誘いの1文と手だけの節（軌道は CSS の背景が描く）', async () => {
    await seedMember()
    await seedItem({ type: 'app' })
    await seedItem({ type: 'work' })

    const main = mainOf(await okText('/contact'))
    // ほかのページと同じ節（見出しの錨を持つ）。表紙の印は持たない
    expect(main).toContain('<section id="contact" role="region" aria-label="Contact">')
    expect(main).not.toMatch(/<img|<svg|<style|<script/)
  })

  it('Contact の見出し、誘いの1文、メールと GitHub の手を並べる', async () => {
    /*
      字を1つも置かなかったころは、ボタンが2つあるだけで、何の相談なら
      送ってよいのかを言う言葉がページのどこにも無かった（description にしか
      無かった）。入口と対になるページとして、見出しを見せたうえで誘いの文を置く。
      ページは h1 をちょうど1つ持つ決まり（WCAG 1.3.1）も保つ。
    */
    await seedMember()

    const main = mainOf(await okText('/contact'))
    expect(main.match(/<h1[^>]*>/g)).toEqual(['<h1>'])
    expect(main).toContain('<div class="head"><h1>Contact</h1></div>')
    const contact = main.slice(main.indexOf('<div class="contact">'))
    // ページに出る p はリードの1つだけ（札は置かない）
    expect(contact.match(/<p\b[^>]*>/g)).toEqual(['<p class="contact__lead">'])
    // 句読点までの塊に分けてある（Phrases）。読める文字列としては site.ts の1文のまま
    const lead = contact.match(/<p class="contact__lead">(.*?)<\/p>/)?.[1] ?? ''
    expect(lead.replace(/<[^>]+>/g, '')).toBe(SITE.contactLead)
    // リードは手の上（読んでから押す）。GitHub は脇の道なので最後
    expect(contact.indexOf('contact__lead')).toBeLessThan(contact.indexOf('contact__mail'))
    expect(contact.indexOf('contact__mail')).toBeLessThan(contact.indexOf('contact__sub'))
    // GitHub は外へ出る・別タブ（↗ は読み上げに流さない）
    expect(contact).toContain(
      `<a class="contact__sub" href="${SITE.github}" rel="me noreferrer" target="_blank"><span lang="en">GitHub</span><span aria-hidden="true"> ↗</span></a>`,
    )
    expect(main).toContain('aria-label="Contact"')
  })

  it('全体ページの Contact にも同じ誘いの1文を置く', async () => {
    await seedMember()

    const whole = await okText('/all')
    const contact = whole.slice(whole.indexOf('<section id="contact"'))
    const lead = contact.match(/<p class="contact__lead">(.*?)<\/p>/)?.[1] ?? ''
    expect(lead.replace(/<[^>]+>/g, '')).toBe(SITE.contactLead)
  })

  it('全体ページでは、ほかの節と同じ見出しを目に見える形で置く', async () => {
    await seedMember()

    const whole = await okText('/all')
    const contact = whole.slice(whole.indexOf('<section id="contact"'))
    expect(contact).toContain('<div class="head"><h2>Contact</h2></div>')
    expect(contact).not.toContain('sr-only')
  })
})

/*
  ブロック1つが1ページ。以前は1画面に入らないぶんを次の URL（/projects/2）に
  割っていた。貼られたその URL は、同じページへ送る。
*/
describe('ページの URL', () => {
  it('割っていたころの続きの URL は、同じページへ寄せる 301。絞り込みは付けたまま', async () => {
    await seedItem({ type: 'app', title: 'アプリ壱' })
    await seedItem({ type: 'app', title: 'アプリ弐' })
    await seedItem({ type: 'app', title: 'アプリ参' })

    // 全件が1ページに出る
    const all = await okText('/projects')
    for (const title of ['アプリ壱', 'アプリ弐', 'アプリ参']) expect(all).toContain(title)

    for (const [path, to] of [
      ['/projects/2', '/projects'],
      ['/projects/1', '/projects'],
      ['/projects/9', '/projects'],
      ['/projects/2?kind=app', '/projects?kind=app'],
      ['/contact/2', '/contact'],
    ] as const) {
      const response = await get(path)
      expect(response.status, path).toBe(301)
      expect(response.headers.get('location'), path).toBe(to)
    }

    // 番号の形でない続き（01・0・abc）は、割っていたころにも無かった URL
    for (const path of ['/projects/01', '/projects/0', '/projects/abc']) {
      expect((await get(path)).status, path).toBe(404)
    }
  })

  it('続きの URL の 301 は、外のサイトへは飛ばさない', async () => {
    /*
      Location を「パスの一部」から組み立てているので、そこに // や /\ が
      入ると、ブラウザがプロトコル相対の外部 URL として解決する。
      実際に /%2F%2Fevil.com/1 が Location: ///evil.com を返し、curl が
      evil.com まで着弾した。1語目はページの名前の形だけを通すので、無い URL の 404
    */
    for (const path of [
      '/%2F%2Fevil.com/1',
      '/%2Fevil.com/1',
      '/%5Cevil.com/1',
      '/%5C%5Cevil.com/1',
    ]) {
      const response = await get(path)
      expect(response.status, path).toBe(404)
      expect(response.headers.get('location'), path).toBeNull()
    }
  })

  it('改行の入った URL は 500 ではなく 404', async () => {
    // CR/LF が Location に入ると workerd の Headers.set が例外を投げ、
    // それが 500 になっていた。走査されるたびにエラーログが汚れる
    for (const path of [
      '/ab%0d%0aX/1',
      '/ab%0aX/1',
      '/members/a%0d%0aX/about/1',
      '/members/a/%0d%0aX',
    ]) {
      expect((await get(path)).status, path).toBe(404)
    }
  })

  it('Apps と Works の一覧の URL は、同じ区分で絞った Projects へ寄せる', async () => {
    /*
      2つの節を Projects の1つにまとめた。貼られた一覧の URL を死なせない。
      ページ数は引き継がない（区分を混ぜて並べ直したので、同じ番号に同じ
      行は居ない）。メンバーの絞り込みは引き継ぐ
    */
    const moved: [string, string][] = [
      ['/apps', '/projects?kind=app'],
      ['/apps/3', '/projects?kind=app'],
      ['/works', '/projects?kind=work'],
      ['/works?member=okazaki', '/projects?kind=work&member=okazaki'],
    ]
    for (const [path, to] of moved) {
      const response = await get(path)
      expect(response.status, path).toBe(301)
      expect(response.headers.get('location'), path).toBe(to)
    }
  })

  it('目次の印は、いま見ているページにだけ付く', async () => {
    await seedMember()
    await seedItem({ type: 'app' })

    const html = await okText('/projects')
    expect(html).toContain('href="/projects" aria-current="page"')
    // 1人のサイトなので、Team の位置はプロフィール（目次の名前は Profile）
    // 英字だけの行き先には lang="en"（等幅の小さな大文字の札にする印）
    expect(tocOf(html)).toContain('<a href="/members/okazaki" lang="en">Profile</a>')
    // 2つ付くと、どちらが「いま」なのか読み上げでも見た目でも決まらない
    expect(html.match(/aria-current="page"/g)).toHaveLength(1)
  })

  it('公開ページの HTML は装飾の絵を持たない。本文の画像は作品とアバターだけ', async () => {
    /*
      入口・締め・個人ページに天体の絵・星空・軌道図を置いていたころは、最初の画面の6割を
      装飾が占め、HTML の半分以上が見えない層の動き（keyframes）だった。いまは字が主役で、
      天体の飾り（惑星の縁・空・軌道・星）は線と点だけを CSS の背景と疑似要素が描く
      （app.css の「天体の飾り」）。HTML には1つも置かない
    */
    const member = await seedMember()
    await seedItem({ type: 'app' })
    await seedItem({ type: 'work' })
    for (const path of ['/', '/contact', `/members/${member.slug}`, '/all']) {
      const main = mainOf(await okText(path))
      expect(main, path).not.toMatch(/class="(?:system|orbits|cosmos|hole|celestial|astra-art)/)
      expect(main, path).not.toMatch(/<style|<svg/)
    }
    // 作品が0件でも入口は字だけで成り立つ（一覧への1本は数える作品が無いので出さない）
    await db().delete(schema.items)
    await touch()
    const home = mainOf(await okText('/'))
    expect(home).toContain('<header class="hero hero--cover">')
    expect(home).not.toContain('href="/projects"')
  })

  it('目次の名乗りは、行き先がページ内か別ページかで変わる', async () => {
    await seedMember()
    await seedItem({ type: 'app' })

    // ページごとの URL では別ページへ移る
    expect(await okText('/projects')).toContain('aria-label="ページの移動"')
    // 全体ページの目次だけが本当に #projects を指している
    expect(await okText('/all')).toContain('aria-label="ページ内の移動"')
  })

  it('Team は全員を1ページに並べる。形は総人数で決まる', async () => {
    for (let i = 1; i <= 7; i++) await seedMember({ slug: `m${i}`, name: `メンバー${i}` })

    const team = await okText('/team')
    for (let i = 1; i <= 7; i++) expect(team).toContain(`メンバー${i}`)
    expect(team).toContain('member--compact')
    expect(team).not.toContain('member--wide')
  })
})

/*
  絞り込みはサーバーが持つ。絞り込みの手は URL へのリンクで、押した先は絞り込んだ一覧の
  ページ。公開ページは JavaScript を持たず、絞り込みは URL の query で持つ。
*/
describe('絞り込み', () => {
  it('区分で絞ると、その区分の項目だけになる', async () => {
    await seedItem({ type: 'app', title: '個人のアプリ' })
    await seedItem({ type: 'work', title: 'ある仕事' })

    const html = await okText('/projects?kind=work')
    expect(html).toContain('ある仕事')
    expect(html).not.toContain('個人のアプリ')
    // 押した手に印が付く。もう一度押すと外れるので、行き先は絞り込み無しの URL
    expect(html).toContain('<a href="/projects" aria-current="true">業務</a>')
  })

  it('絞り込みに並ばない区分では絞らない。「すべて」に印を付けたまま全件を出す', async () => {
    // 個人開発しか無いサイト。業務の手は無いので、効かせると外す手が無くなる
    await seedItem({ type: 'app', title: '個人のアプリ' })

    for (const path of ['/projects?kind=work', '/projects?kind=nope']) {
      const html = await okText(path)
      expect(html, path).toContain('個人のアプリ')
      expect(html, path).toContain('href="/projects" aria-current="true">すべて</a>')
    }
  })

  it('メンバーで絞ると、個人開発にも業務にも効く', async () => {
    const member = await seedMember()
    const other = await seedMember({ slug: 'hoshino', name: '星野' })
    await seedItem({ type: 'app', title: 'この人のアプリ', memberId: member.id })
    await seedItem({ type: 'app', title: 'よその人のアプリ', memberId: other.id })
    await seedItem({ type: 'work', title: 'この人の仕事', memberId: member.id })
    await seedItem({ type: 'work', title: 'よその人の仕事', memberId: other.id })

    const mine = await okText(`/projects?member=${member.slug}`)
    expect(mine).toContain('この人のアプリ')
    expect(mine).toContain('この人の仕事')
    expect(mine).not.toContain('よその人のアプリ')
    expect(mine).not.toContain('よその人の仕事')

    // 2つの軸は重ねて効く
    const both = await okText(`/projects?kind=work&member=${member.slug}`)
    expect(both).toContain('この人の仕事')
    expect(both).not.toContain('この人のアプリ')
  })

  it('件数は、絞り込みの有無で取り違えない', async () => {
    /*
      件数は2つある——絞り込みを見ない total（節を出すかどうか・入口の件数・説明文）と、
      絞り込んだあとの行（一覧に並ぶ行）。

      絞り込みが付かないときは同じ数なので、**片方をもう片方に取り違えても
      ページは正しく見える**。取り違いが出るのは絞り込んだときだけ。
    */
    const member = await seedMember()
    const other = await seedMember({ slug: 'hoshino', name: '星野' })
    await seedItem({ type: 'work', title: 'この人の仕事', memberId: member.id })
    await seedItem({ type: 'work', title: 'よその人の仕事', memberId: other.id })

    // 絞り込み無し: 2件
    expect(await okText('/projects')).toContain('つくったもの 2 件')

    // 並ぶ行は絞り込んだあとの行。その人で絞ると1件
    const mine = await okText(`/projects?member=${member.slug}`)
    expect(mine).toContain('この人の仕事')
    expect(mainOf(mine)).not.toContain('よその人の仕事')

    // 入口の一覧への1本は絞り込みを見ない（入口から送るのはいつも一覧の全件）
    expect(heroOf(await okText(`/?member=${member.slug}`))).toContain(
      '<a class="cta" href="/projects">',
    )
  })

  it('絞り込みは、目次の行き先にも残る。一覧の無いページには付けて回らない', async () => {
    const member = await seedMember()
    // 名前の絞り込みは2人以上いるときだけ並ぶ。1人のサイトでは ?member= を読まない
    await seedMember({ slug: 'tanaka', name: '田中 未来', sortOrder: 20 })
    await seedItem({ type: 'app', title: 'アプリ壱', memberId: member.id })
    await seedItem({ type: 'work', title: 'ある仕事', memberId: member.id })

    const toc = tocOf(await okText(`/projects?kind=app&member=${member.slug}`))
    // 目次の Projects にも同じ絞り込みが付く。付けないと、押した瞬間に静かに外れる
    expect(toc).toContain('href="/projects?kind=app&amp;member=okazaki"')
    // 一覧を持たないページ（Team）には付けない。中身が変わらないのに URL だけ増える
    expect(toc).toContain('href="/team"')
    expect(toc).not.toContain('/team?')
  })

  it('絞り込んで0件でも、絞り込みの手を残して1行だけ出す', async () => {
    const member = await seedMember()
    await seedMember({ slug: 'tanaka', name: '田中 未来', sortOrder: 20 })
    await seedItem({ type: 'app', title: 'この人のアプリ', memberId: member.id })
    await seedItem({ type: 'work', title: 'よその仕事' })

    // この人の業務は1件も無い。ここで節ごと消すと、絞り込みを外す手がページから消える
    const response = await get(`/projects?kind=work&member=${member.slug}`)
    expect(response.status).toBe(200)

    const html = await response.text()
    expect(html).toContain('この条件に当てはまるものはまだありません')
    expect(html).toContain('href="/projects">すべて</a>')
    expect(html).not.toContain('この人のアプリ')
  })

  it('公開ページの script は JSON-LD（データ）だけ。内容と移動と絞り込みは SSR で成立する', async () => {
    await seedMember()
    await seedItem({ platformKey: 'web' })

    for (const path of ['/', '/projects', '/contact', '/all']) {
      const html = await okText(path)
      expect(html).not.toContain('<script src')
      const scripts = [...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/gi)]
      expect(
        scripts.filter((script) => !/type="application\/ld\+json"/i.test(script[1] ?? '')),
        path,
      ).toEqual([])
    }
  })
})

/*
  作品1件の恒久リンク。

  一覧の中の位置は、並べ替え・公開の切り替え・追加のたびに変わる。ここで
  押さえるのは2つ：slug で名指しした URL は何を足しても外しても同じ作品を
  指し続けること、そしてそのページが「1ページ = 1ドキュメント」の作法
  （h1 ちょうど1つ・自分を指す canonical）に従うこと。
*/
describe('作品1件の恒久リンク', () => {
  it('slug で開ける。題と og:title と canonical に作品名が入る', async () => {
    await seedItem({
      title: 'AppMixer',
      slug: 'appmixer',
      platformKey: 'web',
      summary: '音を配る常駐アプリ。',
    })

    const response = await get('/apps/item/appmixer')
    expect(response.status).toBe(200)

    const html = await response.text()
    // 作品名の入った URL がサイトに1つも無かった（「AppMixer 見て」と貼れない）
    expect(html).toContain(`<title>AppMixer — ${SITE.name}</title>`)
    expect(html).toContain(`<meta property="og:title" content="AppMixer — ${SITE.name}"/>`)
    expect(html).toContain(`<link rel="canonical" href="${SITE.origin}/apps/item/appmixer"/>`)
    expect(html).toContain('content="音を配る常駐アプリ。"')
    expect(mainOf(html)).toContain('AppMixer')
  })

  it('並べ替えても同じ URL が同じ作品を指す', async () => {
    await seedItem({ title: '一番目', slug: 'ichi', sortOrder: 10 })
    await seedItem({ title: '二番目', slug: 'ni', sortOrder: 20 })
    await seedItem({ title: '三番目', slug: 'san', sortOrder: 30 })

    const at = (html: string, title: string) => mainOf(html).indexOf(title)
    const before = await okText('/projects')
    expect(at(before, '三番目')).toBeGreaterThan(at(before, '一番目'))

    // 並べ替える（管理画面の「並び順」を変えたのと同じこと）
    await db().update(schema.items).set({ sortOrder: 5 }).where(eq(schema.items.slug, 'san'))
    await touch()

    // 一覧の中の位置は動いた
    const after = await okText('/projects')
    expect(at(after, '三番目')).toBeLessThan(at(after, '一番目'))
    // 恒久リンクは動かない。これがこの列の全部の理由
    expect(mainOf(await okText('/apps/item/san'))).toContain('三番目')
  })

  it('一覧の節を外しても、貼られた作品のリンクは死なない', async () => {
    await seedItem({ title: 'AppMixer', slug: 'appmixer' })
    // Projects の節を置かない構成にする（トップから /projects が消える）
    await db()
      .insert(schema.blocks)
      .values([
        { type: 'hero' as const, published: 1, sortOrder: 10 },
        { type: 'contact' as const, published: 1, sortOrder: 20 },
      ])

    expect((await get('/projects')).status).toBe(404)
    // 出る条件は「作品が公開中」の1つだけ。トップの構成には依らない
    expect((await get('/apps/item/appmixer')).status).toBe(200)
  })

  it('下書きの作品は 404。URL を知っている人にだけ見える下書きを作らない', async () => {
    await seedItem({ title: '下書きのアプリ', slug: 'draft-one', published: 0 })
    expect((await get('/apps/item/draft-one')).status).toBe(404)
  })

  it('知らない slug は 404。1語目と種類の食い違いは、いまの区分の URL へ 301', async () => {
    await seedItem({ type: 'app', title: 'AppMixer', slug: 'appmixer' })
    expect((await get('/apps/item/nosuch')).status).toBe(404)
    /*
      区分を変えた作品の、前の区分の URL（SYS-6）。以前は 404 で、区分を直すと
      貼られたリンクが切れた。200 で2つ目の URL を作るのではなく、いまの1つへ寄せる
    */
    const moved = await get('/works/item/appmixer')
    expect(moved.status).toBe(301)
    expect(moved.headers.get('location')).toBe('/apps/item/appmixer')
  })

  it('一覧の行の題から行ける。slug の無い作品はリンクにしない', async () => {
    await seedItem({ title: 'AppMixer', slug: 'appmixer' })
    await seedItem({ title: 'まだ無いほう', sortOrder: 20 })

    const html = mainOf(await okText('/projects'))
    /*
      一覧は1つにまとめたが、恒久リンクは区分の語（/apps/item/…）のまま。貼られた
      URL を変えない。class は行の面を押せるようにする覆い（app.css の
      .entry__link::after）の付け先。style はページの切り替えでつなぐ名前
    */
    expect(html).toContain(
      '<h3><a class="entry__link" href="/apps/item/appmixer" style="view-transition-name:item-appmixer">AppMixer</a></h3>',
    )
    // 当てにならない URL を出すくらいなら、リンクそのものを出さない。覆いも矢印も付かない
    expect(html).toContain('<h3>まだ無いほう</h3>')
    expect(html.match(/class="entry__link"/g) ?? []).toHaveLength(1)
    expect(html.match(/class="entry__go"/g) ?? []).toHaveLength(1)
  })

  it('一覧の行は面ごと押せる。リンクは題の1本のままで、入れ子にしない', async () => {
    /*
      行を <a> で包むと、中の Repository と担当者名が入れ子の <a> になる
      （HTML として壊れていて、ブラウザは外側を途中で閉じる）。押せる面は題の
      リンクの ::after で広げ、マークアップ上のリンクは今までどおり別々に並ぶ
    */
    const member = await seedMember()
    await seedMember({ slug: 'futari', name: 'もう一人', sortOrder: 20 })
    const item = await seedItem({ title: 'AppMixer', slug: 'appmixer', memberId: member.id })
    await db().insert(schema.itemLinks).values({
      itemId: item.id,
      label: 'Repository',
      url: 'https://example.test/r',
      sortOrder: 10,
    })

    const html = mainOf(await okText('/projects'))
    const entry = html.slice(html.indexOf('<article class="entry"'), html.indexOf('</article>'))
    expect(entry).not.toBe('')
    expect(entry).not.toContain('<a class="entry"')
    // 題のリンクは題だけを包む。その中にほかのリンクは入らない
    const start = entry.indexOf('<a class="entry__link"')
    const title = entry.slice(start, entry.indexOf('</a>', start) + 4)
    expect(title).toBe(
      '<a class="entry__link" href="/apps/item/appmixer" style="view-transition-name:item-appmixer">AppMixer</a>',
    )
    // ほかの行き先は、覆いの上に出る別のリンクとして残る
    expect(entry).toContain('class="entry__member" href="/members/okazaki"')
    expect(entry).toContain('href="https://example.test/r"')
  })

  it('一覧は全件を1ページに並べる。行は id を持ち、作品のページから戻る的になる', async () => {
    /*
      以前は1画面2件で /projects/2 … に割っていた。いまは全件が1ページに並び、
      作品のページの「← 一覧に戻る」はその行（#item-<slug>）へ戻る。番号は振らない
      （並び順でしかなく、行を見分ける手がかりにならなかった。components.tsx の ItemRow）
    */
    for (const [index, title] of ['A', 'B', 'C', 'D', 'E'].entries()) {
      await seedItem({ title, slug: title.toLowerCase(), sortOrder: (index + 1) * 10 })
    }
    await seedItem({ title: 'まだ無いほう', sortOrder: 90 })

    const html = mainOf(await okText('/projects'))
    for (const slug of ['a', 'b', 'c', 'd', 'e']) {
      expect(html, slug).toContain(
        `<article class="entry" id="item-${slug}"><ul class="entry__meta"><li>個人開発</li>`,
      )
    }
    // slug の無い作品は、戻ってくる作品のページが無いので id も持たない
    expect(html).toContain('<article class="entry"><ul class="entry__meta">')
    expect(html).toContain('<h3>まだ無いほう</h3>')
    expect(html).not.toMatch(/card--lean|entry__index/)
  })

  it('一覧の行には絵を置かない。絵は作品のページが受ける', async () => {
    /*
      サムネイルは画像のある作品にしか付かず、行の高さと右の列がそろわなかった
      （components.tsx の ItemRow）。作品のページでは同じ画像を代替テキストつきで出す
    */
    await seedItem({
      title: 'AppMixer',
      slug: 'appmixer',
      imageUrl: '/images/items/appmixer-ab12.png',
      imageAlt: '音量ミキサーの画面',
    })

    const list = mainOf(await okText('/projects'))
    expect(list).not.toMatch(/<img|entry__thumb/)
    expect(mainOf(await okText('/apps/item/appmixer'))).toContain(
      '<img src="/images/items/appmixer-ab12.png" alt="音量ミキサーの画面"',
    )
  })

  it('1ページ = 1ドキュメントの作法に従う。h1 は作品名の1つ', async () => {
    await seedItem({ title: 'AppMixer', slug: 'appmixer', body: '背景です。' })

    const html = await okText('/apps/item/appmixer')
    expect(html.match(/<h1[^>]*>/g) ?? []).toEqual([
      '<h1 style="view-transition-name:item-appmixer">',
    ])
    expect(html).toContain('<h1 style="view-transition-name:item-appmixer">AppMixer</h1>')
  })

  it('一覧の行の題と作品のページの見出しは、同じ名前でつなぐ。名前はページの中で1つだけ', async () => {
    /*
      ページを移るときの切り替え（app.css の @view-transition）で、行の題がそのまま
      見出しへ動く。同じ名前が1つのページに2つあると、そのページの切り替えごと
      捨てられる——一覧でも全体ページでも、名前は作品ごとに1つ
    */
    await seedMember()
    await seedItem({ title: 'AppMixer', slug: 'appmixer', body: '背景です。' })
    await seedItem({ title: 'AllTasks', slug: 'alltasks', body: '背景です。' })
    const name = 'view-transition-name:item-appmixer'
    for (const path of ['/projects', '/all', '/apps/item/appmixer']) {
      expect((await okText(path)).split(name).length - 1, path).toBe(1)
    }
    // 入口には付けない（入口に作品の題は無い）
    expect(await okText('/')).not.toContain(name)
  })

  it('目次はサイトのページのまま。印はその作品が載っている一覧に付く', async () => {
    await seedMember()
    await seedItem({ type: 'app', title: 'AppMixer', slug: 'appmixer' })
    await seedItem({ type: 'work', title: 'ある仕事', slug: 'shigoto' })

    const toc = tocOf(await okText('/apps/item/appmixer'))
    // 行き来の手は目次なので、トップと同じ行き先を同じ順で出す
    expect(toc).toContain('href="/projects" aria-current="page"')
    expect(toc).toContain('<a href="/members/okazaki" lang="en">Profile</a>')
    // 業務の作品も同じ一覧（Projects）に印が付く
    expect(tocOf(await okText('/works/item/shigoto'))).toContain(
      'href="/projects" aria-current="page"',
    )
    // 作品のページは目次に並ばない（一覧の行から着く先）
    expect(toc).not.toContain('/apps/item/appmixer')
  })

  it('担当は複数人のときだけ出す。一覧の行の showMember と同じ条件', async () => {
    const member = await seedMember({ slug: 'okazaki', name: '岡崎 昂功' })
    await seedItem({ title: 'AppMixer', slug: 'appmixer', memberId: member.id })

    // 1人のサイトでは、どの作品も同じ人のもの。名前を添える意味が無い
    expect(mainOf(await okText('/apps/item/appmixer'))).not.toContain('href="/members/okazaki"')

    await seedMember({ slug: 'futari', name: 'もう一人' })
    const main = mainOf(await okText('/apps/item/appmixer'))
    expect(main).toContain('href="/members/okazaki"')
    expect(main).toContain('担当')
  })

  it('説明文は段落（Note）で出す。一覧の行の部品を丸ごとは使わない', async () => {
    await seedItem({ title: 'AppMixer', slug: 'appmixer', summary: '音を配る常駐アプリ。' })

    // 一覧の行は面ごと作品のページへのリンク。このページは作品1件のためにある
    const main = mainOf(await okText('/apps/item/appmixer'))
    expect(main).toContain('<div class="bio">')
    expect(main).not.toContain('class="entry"')
  })

  it('画像と本文があれば、画像は代替テキストつきの figure。本文は説明の下の小節「Story」', async () => {
    await seedItem({
      title: 'AppMixer',
      slug: 'appmixer',
      summary: '音を配る常駐アプリ。',
      body: '背景の段落。\n\n結果の段落。',
      imageUrl: '/images/items/appmixer-ab12.png',
      imageAlt: '音量ミキサーの画面',
    })

    const html = await okText('/apps/item/appmixer')
    const main = mainOf(html)
    // 画像は文の列の横に並ぶ組み方（900 以上。app.css の .detail--shot）
    expect(main).toContain('<div class="detail detail--shot">')
    expect(main).toContain(
      '<figure class="shot"><img src="/images/items/appmixer-ab12.png" alt="音量ミキサーの画面" decoding="async"/></figure>',
    )
    /*
      説明（目録の2文）のあとに、本文の小節。以前は本文を次の画面（…/story）に分け、
      説明の下に「くわしく読む →」を置いていた。同じページのすぐ下に続くので、
      入口の札は外した
    */
    expect(main).toContain('<div class="bio"><p>音を配る常駐アプリ。</p></div>')
    expect(main).not.toContain('class="more"')
    expect(main).toContain(
      '<div class="story" id="story"><div class="head head--sub"><h2>Story</h2></div><div class="story-parts"><div class="bio"><p>背景の段落。</p><p>結果の段落。</p></div></div></div>',
    )
    // 本文は説明・画像・行き先（.detail）のあと
    expect(main.indexOf('id="story"')).toBeGreaterThan(main.indexOf('class="detail'))
    // 構造化データの画像は絶対 URL（相対のままでは、この文書の外で読む側が解決できない）
    expect(html).toContain(`"image":"${SITE.origin}/images/items/appmixer-ab12.png"`)
    // 説明文（<meta>）は要約のまま。本文は検索結果の1行には畳めない
    expect(html).toContain('<meta name="description" content="音を配る常駐アプリ。"/>')
  })

  it('画像も本文も無ければ、figure も本文の小節も出さない。代わりの絵も置かない', async () => {
    await seedItem({ title: 'AppMixer', slug: 'appmixer', summary: '音を配る常駐アプリ。' })

    const html = await okText('/apps/item/appmixer')
    const main = mainOf(html)
    // 文の列だけ（前は画像の位置に入口の軌道図を縮めた星図を置いていた。持ち主の「開くとまだある」）
    expect(main).toContain('<div class="detail"><div class="detail__text">')
    expect(main).not.toMatch(/class="(chart|hole|orbit)/)
    expect(main).not.toContain('<figure')
    expect(main).toContain('<div class="bio"><p>音を配る常駐アプリ。</p></div>')
    expect(main).not.toContain('id="story"')
    expect(main).not.toContain('Story')
    expect(html).not.toContain('"image"')
  })

  it('この URL が何を指しているかを構造化データにも書く', async () => {
    await seedItem({ title: 'AppMixer', slug: 'appmixer', summary: '音を配る常駐アプリ。' })

    const html = await okText('/apps/item/appmixer')
    expect(html).toContain('"@type":"CreativeWork"')
    expect(html).toContain('"name":"AppMixer"')
    expect(html).toContain(`"url":"${SITE.origin}/apps/item/appmixer"`)
  })

  it('構造化データは、どの作品のページにも載る。名乗りと違って並びの先頭だけではない', async () => {
    /*
      名乗り（Person / Organization）はサイトの並びの先頭にだけ載せる。その決まりを
      作品のページにも当てると、どの作品のページも「この URL は何か」を言わなくなる
    */
    await seedItem({ title: 'AppMixer', slug: 'appmixer', sortOrder: 10 })
    await seedItem({ title: 'AllTasks', slug: 'alltasks', sortOrder: 20 })

    const html = await okText('/apps/item/alltasks')
    expect(html).toContain('"@type":"CreativeWork"')
    expect(html).toContain(`"url":"${SITE.origin}/apps/item/alltasks"`)
  })
})

/*
  作品1件のページの行き来。行き来の手は目次と「← 一覧に戻る」。作品同士を画面の底の
  左右の手でめくっていたころのページャは外した（一覧は全件を1ページに並べるので、
  隣の作品は戻った一覧のすぐ隣の行にある）。
*/
/*
  作品の画像の見せ方（メインの画像・ほかの画像・アイコン）。見せる順はメインの画像が先で、
  ほかの画像が並び順で続く（src/domain.ts の itemImages）。先頭の1枚がその作品の顔
  （一覧のサムネイル・共有カード）。作品のページは1枚なら説明の組の絵、2枚以上なら
  全部をギャラリー（小節「Screenshots」）に並べる——同じ画像を2度出さない。
*/
describe('作品の画像の見せ方', () => {
  const ldOf = (html: string) =>
    JSON.parse(html.match(/<script type="application\/ld\+json">(.*?)<\/script>/)?.[1] ?? 'null')

  it('画像が1枚の作品は、今までどおり説明の組の絵。ギャラリーは出さない', async () => {
    await seedItem({
      slug: 'one',
      summary: '説明。',
      imageUrl: '/images/items/one-aaaaaaaa.png',
      imageAlt: '一枚の画面',
    })
    const main = mainOf(await okText('/apps/item/one'))
    expect(main).toContain(
      '<figure class="shot"><img src="/images/items/one-aaaaaaaa.png" alt="一枚の画面" decoding="async"/></figure>',
    )
    expect(main).not.toContain('class="gallery"')
    expect(main).not.toContain('id="screenshots"')
  })

  it('メインの画像が無い作品は、ほかの画像の1枚目がその作品の顔（共有カード・説明の組の絵）', async () => {
    const item = await seedItem({ slug: 'face', summary: '説明。' })
    await db().insert(schema.itemShots).values({
      itemId: item.id,
      url: '/images/items/face-aaaaaaaa.png',
      alt: 'ほかの画像の1枚目',
      width: 1200,
      height: 630,
      sortOrder: 10,
    })
    await touch()
    const page = await okText('/apps/item/face')
    expect(mainOf(page)).toContain(
      '<figure class="shot"><img src="/images/items/face-aaaaaaaa.png" alt="ほかの画像の1枚目" decoding="async"/></figure>',
    )
    expect(page).toContain(
      `<meta property="og:image" content="${SITE.origin}/images/items/face-aaaaaaaa.png"/>`,
    )
    expect(page).toContain('<meta property="og:image:width" content="1200"/>')
    // 一覧の行には絵も星図も置かない（画像の有無によらず）
    const list = mainOf(await okText('/projects'))
    expect(list).not.toMatch(/<img|class="chart/)
  })

  it('2枚以上ならギャラリーに見せる順で並べ、構造化データの image も同じ並び。寸法の分からない画像は寸法を名乗らない', async () => {
    const item = await seedItem({
      slug: 'many',
      summary: '説明。',
      imageUrl: '/images/items/many-aaaaaaaa.png',
      imageAlt: 'メイン',
      imageWidth: 1440,
      imageHeight: 900,
    })
    // 並び順で並ぶ（入れた順ではなく）
    await db()
      .insert(schema.itemShots)
      .values([
        { itemId: item.id, url: '/images/items/many-cccccccc.png', alt: '三', sortOrder: 20 },
        {
          itemId: item.id,
          url: '/images/items/many-bbbbbbbb.png',
          alt: '二',
          width: 1440,
          height: 900,
          sortOrder: 10,
        },
      ])
    await touch()
    const html = await okText('/apps/item/many')
    expect(html).toContain(
      '<div class="shots" id="screenshots"><div class="head head--sub"><h2>Screenshots</h2></div>',
    )
    // 先頭は作品の顔として大きく、残りはページを読んで近づくまで遅延読み込み
    expect(html).toContain('class="gallery__item gallery__item--lead"')
    expect(html).toContain(
      '<img src="/images/items/many-aaaaaaaa.png" alt="メイン" width="1440" height="900" decoding="async"/>',
    )
    expect(html).toContain(
      '<img src="/images/items/many-bbbbbbbb.png" alt="二" width="1440" height="900" loading="lazy" decoding="async"/>',
    )
    expect(html).toContain(
      '<img src="/images/items/many-cccccccc.png" alt="三" loading="lazy" decoding="async"/>',
    )
    expect(html).toContain('aria-label="画像1「メイン」を拡大して見る（別タブ）"')
    expect(html).toContain('aria-label="画像2「二」を拡大して見る（別タブ）"')
    expect(html).toContain(
      'href="/images/items/many-aaaaaaaa.png" target="_blank" rel="noreferrer"',
    )
    expect(html).toContain('<figcaption class="gallery__caption" aria-hidden="true">')
    const shown = [...mainOf(html).matchAll(/<img src="([^"]+)" alt="([^"]*)"/g)]
    expect(shown.map((one) => one[2])).toEqual(['メイン', '二', '三'])
    expect(ldOf(html).image).toEqual(
      ['many-aaaaaaaa', 'many-bbbbbbbb', 'many-cccccccc'].map(
        (name) => `${SITE.origin}/images/items/${name}.png`,
      ),
    )
    // 説明の組には絵を置かない（ギャラリーに全部ある）
    expect(mainOf(html)).not.toContain('<figure class="shot">')
  })
})

describe('作品1件のページの行き来', () => {
  // 本文の頭の「← 一覧に戻る」の行き先。無ければ null
  const backOf = (html: string) => mainOf(html).match(/<a class="back" href="([^"]*)"/)?.[1] ?? null

  it('作品同士をめくる手は置かない。目次はサイトのまま、作品のページは目次に並ばない', async () => {
    await seedItem({ title: '一番目', slug: 'ichi', sortOrder: 10 })
    await seedItem({ title: '二番目', slug: 'ni', sortOrder: 20 })

    const html = await okText('/apps/item/ichi')
    expect(html).not.toContain('class="pager')
    expect(mainOf(html)).not.toContain('/apps/item/ni')
    const toc = tocOf(html)
    expect(toc).toContain('href="/projects" aria-current="page"')
    expect(toc).not.toContain('/apps/item/')
  })

  it('「← 一覧に戻る」は、一覧のその作品の行へ送る', async () => {
    /*
      一覧の頭へ戻すと、何件目の行から入った人も最初から探し直すことになる。
      行は id="item-<slug>" を持っている（components.tsx の itemCardId）
    */
    for (let at = 0; at < 7; at += 1) {
      await seedItem({ title: `作品${at}`, slug: `work-${at}`, sortOrder: (at + 1) * 10 })
    }

    expect(backOf(await okText('/apps/item/work-0'))).toBe('/projects#item-work-0')
    expect(backOf(await okText('/apps/item/work-6'))).toBe('/projects#item-work-6')
    // 戻った先に、その id の行が載っている
    expect(mainOf(await okText('/projects'))).toContain('<article class="entry" id="item-work-6">')
  })

  it('一覧の節を置いていなければ、戻る道は出さない（行き先が 404 になる）', async () => {
    await seedItem({ title: 'AppMixer', slug: 'appmixer' })
    await db()
      .insert(schema.blocks)
      .values([
        { type: 'hero' as const, published: 1, sortOrder: 10 },
        { type: 'contact' as const, published: 1, sortOrder: 20 },
      ])

    expect(backOf(await okText('/apps/item/appmixer'))).toBeNull()
  })

  it('一覧を先頭に置いた構成では、戻り先は /（並びの先頭の URL）の行', async () => {
    await seedItem({ title: 'AppMixer', slug: 'appmixer' })
    await db()
      .insert(schema.blocks)
      .values([
        { type: 'projects' as const, published: 1, sortOrder: 10 },
        { type: 'contact' as const, published: 1, sortOrder: 20 },
      ])

    expect(backOf(await okText('/apps/item/appmixer'))).toBe('/#item-appmixer')
  })

  it('サイトの中の行き先（担当）には ↗ を付けない。↗ は外へ出る・別タブの印だけ', async () => {
    const member = await seedMember()
    await seedMember({ slug: 'futari', name: 'もう一人', sortOrder: 20 })
    const item = await seedItem({ title: 'AppMixer', slug: 'appmixer', memberId: member.id })
    await db().insert(schema.itemLinks).values({
      itemId: item.id,
      label: 'Repository',
      url: 'https://example.test/r',
      sortOrder: 10,
    })

    /*
      作品のページの行き先は一覧の行と同じ1行（LinkRow の .links）。矢印は CSS が
      URL の頭で決める（test/theme.test.ts の「行き先の矢印」）。ここで見るのは、
      同じ条件で別タブかどうかも決まっていること
    */
    const main = mainOf(await okText('/apps/item/appmixer'))
    // 担当は同じタブで開くサイトの中の続き。target も rel も付けない
    expect(main).toContain('<a href="/members/okazaki">担当 岡崎 昂功</a>')
    // 外へ出るリンクは今までどおり別タブで開く
    expect(main).toContain(
      '<a href="https://example.test/r" rel="noreferrer" target="_blank">Repository</a>',
    )
  })
})

/*
  作品の本文（Story）。以前は1枚目の次の画面（…/story）に分けていた——1枚目に
  置くと、説明・画像・実績値・行き先と同じ1画面に収めるために 60 字・1段落しか
  書けなかったから。ページが縦に読めるようになったので、作品のページの説明の下の
  小節（#story）に戻した。貼られた …/story は #story へ送る。
*/
describe('作品の本文（Story）', () => {
  const STORY = '背景の段落です。\n\nやったことの段落です。\n\n結果の段落です。'

  it('本文は作品のページの小節。h1 は作品名の1つで、Story は h2', async () => {
    await seedItem({
      title: 'AppMixer',
      slug: 'appmixer',
      summary: '音を配る常駐アプリ。',
      body: STORY,
    })

    const html = await okText('/apps/item/appmixer')
    const main = mainOf(html)
    expect(html.match(/<h1[^>]*>/g) ?? []).toHaveLength(1)
    expect(main).toContain('<h2>Story</h2>')
    expect(main).toContain(
      '<div class="bio"><p>背景の段落です。</p><p>やったことの段落です。</p><p>結果の段落です。</p></div>',
    )
    // 説明（目録の2文）は小節の前にある
    expect(main.indexOf('音を配る常駐アプリ。')).toBeLessThan(main.indexOf('背景の段落です。'))
    // 説明文（<meta>）は要約のまま。構造化データは作品の1つ
    expect(html).toContain('<meta name="description" content="音を配る常駐アプリ。"/>')
    expect(html.match(/"@type":"CreativeWork"/g)).toHaveLength(1)
  })

  it('空白と空行だけの本文は小節を作らない（見出しだけ残さない）', async () => {
    await seedItem({ title: '空白だけ', slug: 'blank', body: '  \n\n \n' })
    const main = mainOf(await okText('/apps/item/blank'))
    expect(main).not.toContain('id="story"')
    expect(main).not.toContain('<h2>Story</h2>')
  })

  it('前の本文の画面（…/story）は、作品のページの #story へ 301。本文が無ければページの頭へ', async () => {
    await seedItem({ title: 'AppMixer', slug: 'appmixer', body: STORY, sortOrder: 10 })
    await seedItem({ title: 'AllTasks', slug: 'alltasks', sortOrder: 20 })
    await seedItem({ title: '下書き', slug: 'draft', body: STORY, published: 0, sortOrder: 30 })

    const told = await get('/apps/item/appmixer/story')
    expect(told.status).toBe(301)
    expect(told.headers.get('location')).toBe('/apps/item/appmixer#story')
    // 本文を消した作品の …/story を 404 にしない。貼られたリンクを殺さない
    const plain = await get('/apps/item/alltasks/story')
    expect(plain.status).toBe(301)
    expect(plain.headers.get('location')).toBe('/apps/item/alltasks')
    // 下書きの作品は、転送もしない
    expect((await get('/apps/item/draft/story')).status).toBe(404)
    // 行き先は本文の有無で変わるので、ブラウザには覚えさせない
    expect(told.headers.get('cache-control')).toBe('no-cache')
  })

  it('前の slug・前の区分の本文の画面も、いまの URL の #story へ届く', async () => {
    const item = await seedItem({ type: 'app', title: 'AppMixer', slug: 'appmixer', body: STORY })
    await db().insert(schema.itemSlugRedirects).values({ oldSlug: 'old-mixer', itemId: item.id })

    // 前の slug はいまの URL の …/story へ（そこで #story へ）
    const moved = await get('/apps/item/old-mixer/story')
    expect(moved.status).toBe(301)
    expect(moved.headers.get('location')).toBe('/apps/item/appmixer/story')
    // 前の区分の URL は1回で #story へ
    const kind = await get('/works/item/appmixer/story')
    expect(kind.status).toBe(301)
    expect(kind.headers.get('location')).toBe('/apps/item/appmixer#story')
  })

  it('sitemap には作品のページだけを載せる。転送するだけの …/story は載せない', async () => {
    await seedItem({ title: 'AppMixer', slug: 'appmixer', body: STORY, sortOrder: 10 })
    await seedItem({ title: 'AllTasks', slug: 'alltasks', sortOrder: 20 })

    const xml = await okText('/sitemap.xml')
    expect(xml).toContain(`<loc>${SITE.origin}/apps/item/appmixer</loc>`)
    expect(xml).toContain(`<loc>${SITE.origin}/apps/item/alltasks</loc>`)
    expect(xml).not.toContain('/story')
  })

  it('全体ページは本文も載せる。一覧の行の下に、作品名と Story の添えの小節で', async () => {
    await seedItem({ title: 'AppMixer', slug: 'appmixer', body: STORY, sortOrder: 10 })
    await seedItem({ title: 'AllTasks', slug: 'alltasks', sortOrder: 20 })

    const whole = mainOf(await okText('/all'))
    expect(whole).toContain(
      '<div class="stories"><div><div class="head head--sub"><h3>AppMixer</h3><span class="note">Story</span></div><div class="story-parts"><div class="bio"><p>背景の段落です。</p>',
    )
    // 一覧の行のあと（行の中には入れない。行は面ごと作品のページへのリンク）
    expect(whole.indexOf('class="entries"')).toBeGreaterThan(-1)
    expect(whole.indexOf('class="entries"')).toBeLessThan(whole.indexOf('class="stories"'))
    // 本文の無い作品は並べない（見出しだけ残さない）
    expect(whole).not.toContain('<h3>AllTasks</h3>')
    // ページごとの一覧には出さない（本文は作品のページの小節）
    expect(mainOf(await okText('/projects'))).not.toContain('class="stories"')
  })

  /*
    本文のテンプレート（src/domain.ts の STORY_SECTIONS）。個人開発も業務も同じ欄で、
    Story に決まった順で英語の小見出しを付けて出す（持ち主の「個人開発と業務で内容を
    統一するテンプレート」）。テンプレートより前に書いた本文（body）は見出しなしで先頭
  */
  const headingsOf = (html: string, level: 3 | 4) =>
    [
      ...html.matchAll(
        new RegExp(`<h${level} class="side-head" lang="en">(\\w+)</h${level}>`, 'g'),
      ),
    ].map((match) => match[1])

  it('テンプレートの欄は決まった順に小見出し（h3）を付けて出す。空の欄は出さない。区分によらず同じ形', async () => {
    for (const [type, slug] of [
      ['app', 'mixer'],
      ['work', 'support'],
    ] as const) {
      await seedItem({
        type,
        title: slug,
        slug,
        storyResults: '成果の段落です。',
        storyBackground: '背景の1段落目です。\n\n背景の2段落目です。',
        storyHighlights: '  \n\n ',
        storyApproach: '取り組みの段落です。',
        sortOrder: type === 'app' ? 10 : 20,
      })
    }
    const pages = await Promise.all(
      ['/apps/item/mixer', '/works/item/support'].map(async (path) => mainOf(await okText(path))),
    )
    for (const main of pages) {
      const story = main.slice(main.indexOf('<div class="story" id="story">'))
      // 書いた欄の順ではなく、テンプレートの順。空白だけの欄（工夫）は出さない
      expect(headingsOf(story, 3)).toEqual(['BACKGROUND', 'APPROACH', 'RESULTS'])
      expect(story).toContain(
        '<div class="story-parts"><div><h3 class="side-head" lang="en">BACKGROUND</h3><div class="bio"><p>背景の1段落目です。</p><p>背景の2段落目です。</p></div></div>',
      )
    }
    // 個人開発と業務で、Story の形は1字も違わない
    const storyOf = (main: string) => main.slice(main.indexOf('<div class="story" id="story">'))
    expect(storyOf(pages[0] ?? '')).toBe(storyOf(pages[1] ?? ''))
  })

  it('テンプレートより前の本文は、見出しなしで先頭。テンプレートの欄だけでも小節と #story が付く', async () => {
    await seedItem({
      title: 'AppMixer',
      slug: 'appmixer',
      body: '前に書いた本文です。',
      storyBackground: '背景の段落です。',
      sortOrder: 10,
    })
    await seedItem({
      title: 'AllTasks',
      slug: 'alltasks',
      storyResults: '成果の段落です。',
      sortOrder: 20,
    })
    expect(mainOf(await okText('/apps/item/appmixer'))).toContain(
      '<div class="story-parts"><div class="bio"><p>前に書いた本文です。</p></div><div><h3 class="side-head" lang="en">BACKGROUND</h3>',
    )
    // 前の本文の画面（…/story）は、テンプレートの欄だけの作品でも小節へ
    const told = await get('/apps/item/alltasks/story')
    expect(told.status).toBe(301)
    expect(told.headers.get('location')).toBe('/apps/item/alltasks#story')
  })

  it('全体ページでは、テンプレートの欄の小見出しは作品名（h3）の下の h4', async () => {
    await seedItem({
      title: 'AppMixer',
      slug: 'appmixer',
      storyBackground: '背景の段落です。',
      storyResults: '成果の段落です。',
    })
    const whole = mainOf(await okText('/all'))
    const stories = whole.slice(whole.indexOf('<div class="stories">'))
    expect(headingsOf(stories, 4)).toEqual(['BACKGROUND', 'RESULTS'])
    expect(headingsOf(stories, 3)).toEqual([])
  })
})

describe('メンバーページ', () => {
  it('公開中なら出る', async () => {
    await seedMember({ headline: 'つくる工程そのものを、速くする。' })
    const response = await get('/members/okazaki')
    expect(response.status).toBe(200)
    expect(await response.text()).toContain('つくる工程そのものを、速くする。')
  })

  it('下書きなら 404', async () => {
    await seedMember({ slug: 'hidden', published: 0 })
    expect((await get('/members/hidden')).status).toBe(404)
  })

  it('一覧への導線は、その人で絞り込んだ Projects へ送る', async () => {
    const member = await seedMember()
    await seedMember({ slug: 'tanaka', name: '田中 未来', sortOrder: 20 })
    await seedItem({ memberId: member.id })

    const html = await okText('/members/okazaki')
    expect(html).toContain('class="band" href="/projects?member=okazaki"')
    // トップへ送っても、そこに一覧は無い（節ごとのページに分かれたため）
    expect(html).not.toContain('/?member=')

    /*
      目次はサイトのもの。個人ページ専用の「Apps · Works」は置かない——
      サイトの目次に Projects がそのまま並んでいる
    */
    const toc = tocOf(html)
    expect(toc).not.toContain('Apps · Works')
    expect(toc).toContain('href="/projects"')
  })

  it('業務しか無い人も、同じ Projects へ送る。帯は業務だけを数える', async () => {
    const member = await seedMember()
    await seedMember({ slug: 'tanaka', name: '田中 未来', sortOrder: 20 })
    await seedItem({ type: 'work', memberId: member.id })

    const html = await okText('/members/okazaki')
    expect(html).toContain('class="band" href="/projects?member=okazaki"')
    expect(html).toContain('<span class="band__meta">業務 1</span>')
  })
})

/*
  個人ページは1ページ。/members/<slug> に 名札 → 大見出し → About → Skills → Career を
  縦に並べる。以前は4つの URL（/about・/skills・/career）に割り、画面の底の左右の手で
  めくっていた（持ち主が「面倒すぎる」と判断してまとめた）。中身の無い小節は作らない
  ——「中身が無ければ節ごと出さない」がそのまま伸びた形。
*/
describe('個人ページは1ページ', () => {
  const FULL = { skillsText: 'C# | 3年以上', careerText: '2024.03 | 入社 | ある会社' }

  it('名札・About・Skills・Career を1ページに、その順で並べる。小節は id で指せる', async () => {
    await seedMember({ ...FULL, bio: '紹介の段落。' })

    const main = mainOf(await okText('/members/okazaki'))
    const at = (text: string) => main.indexOf(text)
    for (const text of [
      '<div class="nameplate',
      '<section id="about" role="region" aria-label="About">',
      '<section id="skills" role="region" aria-label="Skills">',
      '<section id="career" role="region" aria-label="Career">',
    ]) {
      expect(at(text), text).toBeGreaterThan(-1)
    }
    expect(at('id="about"')).toBeGreaterThan(at('class="nameplate"'))
    expect(at('id="skills"')).toBeGreaterThan(at('id="about"'))
    expect(at('id="career"')).toBeGreaterThan(at('id="skills"'))
    expect(main).toContain('紹介の段落。')
    expect(main).toContain('C#')
    expect(main).toContain('入社')
    // 見出しの段: ページの h1（名札の名前）→ 小節の h2 → 技術の小見出しは無し（塊に見出しが無い）
    expect(main.match(/<h[1-6][^>]*>[^<]*/g)).toEqual([
      '<h1 class="nameplate__name">岡崎 昂功',
      '<h2>About',
      '<h2>Skills',
      '<h2>Career',
    ])
    // めくる手は置かない
    expect(main).not.toContain('class="pager')
  })

  it('経歴のいまの行（期間が「現在」で終わる）にだけ印を付ける。並びの先頭をいまと見なさない', async () => {
    /*
      app.css の「天体の飾り」は、経歴の行ごとに星を置き、.career__now の行だけを
      四芒星にする。先頭の行で決めていたら、卒業だけの経歴やできごとの一覧でも、先頭が
      「いま」として光った
    */
    await seedMember({
      careerText: [
        '2020.03 卒業 | 学科 | ある大学',
        '2024.03 — 現在 | 入社 | ある会社',
        '2020.04 — 2024.03 | 前の職 | 別の会社',
      ].join('\n'),
    })
    const main = mainOf(await okText('/members/okazaki'))
    expect(main).toContain('<li class="career__now"><span class="period">2024.03 — 現在</span>')
    expect(main).toContain('<li><span class="period">2020.03 卒業</span>')
    expect(main).toContain('<li><span class="period">2020.04 — 2024.03</span>')
    expect(main.match(/career__now/g)).toHaveLength(1)
  })

  it('書いていない小節は作らない。About だけは空でも「準備中です」で置く', async () => {
    await seedMember()

    const main = mainOf(await okText('/members/okazaki'))
    expect(main).toContain('id="about"')
    expect(main).toContain('準備中です')
    // 見出しだけの空の小節を置くと、読みに来た先で行き止まりになる
    expect(main).not.toContain('id="skills"')
    expect(main).not.toContain('id="career"')
  })

  it('下書きのメンバーは、ページも前の続きの URL も 404', async () => {
    await seedMember({ slug: 'hidden', published: 0, ...FULL })

    for (const path of ['/members/hidden', '/members/hidden/skills', '/members/hidden/career/2']) {
      expect((await get(path)).status, path).toBe(404)
    }
  })

  it('知らない続きの名前は 404。/hero のような2つ目の入口も作らない', async () => {
    await seedMember(FULL)

    expect((await get('/members/okazaki/nope')).status).toBe(404)
    expect((await get('/members/okazaki/hero')).status).toBe(404)
    expect((await get('/members/okazaki/career/01')).status).toBe(404)
  })

  it('2人以上なら、上の帯と目次と足元はサイトのまま。目次は Team に印を付ける', async () => {
    // 個人ページ専用の帯と目次に丸ごと入れ替わると、別のサイトへ飛んだように見える
    await seedMember(FULL)
    await seedMember({ slug: 'hoshino', name: '星野', sortOrder: 20 })

    const html = await okText('/members/okazaki')
    const toc = tocOf(html)
    expect(toc).toContain('<a href="/team" aria-current="page" lang="en">Team</a>')
    expect(toc).not.toContain('/members/okazaki')
    expect(html.match(/aria-current="page"/g)).toHaveLength(1)
    expect(topOf(html)).toContain('<a class="brand" href="/">')
    // 顔は本文の名札にだけ（足元はサイトのもの）
    expect(footOf(html)).not.toContain('avatar')
  })

  it('個人ページの Contact は外した。貼られた URL はサイトの Contact へ寄せる', async () => {
    await seedMember(FULL)

    const moved = await get('/members/okazaki/contact')
    expect(moved.status).toBe(301)
    expect(moved.headers.get('location')).toBe('/contact')
  })

  it('名札は Team のカードと同じ顔と名前。大見出しが無ければ名前が h1', async () => {
    await seedMember({ headline: '' })
    await seedMember({ slug: 'hoshino', name: '星野', sortOrder: 20 })

    const main = mainOf(await okText('/members/okazaki'))
    expect(main).toContain('<div class="nameplate">')
    expect(main).toContain('<h1 class="nameplate__name">岡崎 昂功</h1>')
    expect(main.match(/<h1[^>]*>/g)).toHaveLength(1)
  })

  it('サイトと違う連絡先を持つ人だけ、名札の下にその行き先を置く', async () => {
    await seedMember({ github: SITE.github, email: SITE.email })
    await seedMember({
      slug: 'tanaka',
      name: '田中 未来',
      sortOrder: 20,
      github: 'https://github.com/tanaka-example',
      email: 'tanaka@example.test',
    })

    // サイトと同じ行き先は2つ置かない
    expect(mainOf(await okText('/members/okazaki'))).not.toContain('class="socials"')

    const other = mainOf(await okText('/members/tanaka'))
    expect(other).toContain('href="https://github.com/tanaka-example"')
    expect(other).toContain('href="mailto:tanaka@example.test"')
  })

  it('その人の GitHub / メールは、読み上げの名前でその人のものだと名乗る', async () => {
    /*
      2人以上のサイトの個人ページには、足元にサイトの GitHub / メール、Hero に
      その人の GitHub / メールが並ぶ。同じ「GitHub」の名前が別の行き先を指すと、
      読み上げのリンクの一覧ではどちらがこの人のものか分からない。見た目の札の
      字（GitHub / メール）は名前に含める（WCAG 2.5.3）
    */
    await seedMember()
    await seedMember({
      slug: 'tanaka',
      name: '田中 未来',
      sortOrder: 20,
      github: 'https://github.com/tanaka-example',
      email: 'tanaka@example.test',
    })

    const html = await okText('/members/tanaka')
    const own = mainOf(html)
    expect(own).toMatch(
      /<a href="https:\/\/github.com\/tanaka-example"[^>]* aria-label="田中 未来の GitHub">/,
    )
    expect(own).toContain('<a href="mailto:tanaka@example.test" aria-label="田中 未来のメール">')
    // 足元のサイトの行き先は名乗らない（サイトの行き先で、誰か1人のものではない）
    const foot = footOf(html)
    const siteSocials = foot.slice(foot.indexOf('<div class="socials">'))
    expect(siteSocials.slice(0, siteSocials.indexOf('</div>'))).toContain(`href="${SITE.github}"`)
    expect(siteSocials.slice(0, siteSocials.indexOf('</div>'))).not.toContain('aria-label="')
  })

  it('canonical はそのページ自身。題は人の名前', async () => {
    const member = await seedMember()

    const html = await okText('/members/okazaki')
    expect(html).toContain(`<link rel="canonical" href="${SITE.origin}/members/okazaki"/>`)
    expect(html).toContain(`<title>${member.name} — ${SITE.name}</title>`)
  })
})

/*
  前の個人ページの続きの URL（/members/<slug>/about・/skills・/career と、割って
  いたころの /career/2）。貼られたリンクを殺さず、同じページの中の小節へ送る。
*/
describe('前の個人ページの URL', () => {
  const FULL = { skillsText: 'C# | 3年以上', careerText: '2024.03 | 入社 | ある会社' }

  it('/about・/skills・/career（とその続き）は、ページの中の小節へ 301', async () => {
    await seedMember(FULL)

    for (const [path, to] of [
      ['/members/okazaki/about', '/members/okazaki#about'],
      ['/members/okazaki/skills', '/members/okazaki#skills'],
      ['/members/okazaki/career', '/members/okazaki#career'],
      ['/members/okazaki/career/2', '/members/okazaki#career'],
      ['/members/okazaki/about/1', '/members/okazaki#about'],
    ] as const) {
      const response = await get(path)
      expect(response.status, path).toBe(301)
      expect(response.headers.get('location'), path).toBe(to)
      // 行き先は中身しだい（小節を消すと頭へ）なので、ブラウザに覚えさせない
      expect(response.headers.get('cache-control'), path).toBe('no-cache')
    }
  })

  it('書いていない小節の URL は、ページの頭へ（404 にしない）', async () => {
    await seedMember()

    for (const path of ['/members/okazaki/skills', '/members/okazaki/career/2']) {
      const response = await get(path)
      expect(response.status, path).toBe(301)
      expect(response.headers.get('location'), path).toBe('/members/okazaki')
    }
  })

  it('slug を変えたメンバーの前の続きは、いまの slug の続きを経て小節へ届く', async () => {
    const member = await seedMember(FULL)
    await db().insert(schema.memberSlugRedirects).values({ oldSlug: 'old', memberId: member.id })

    const first = await get('/members/old/career/2?x=1')
    expect(first.status).toBe(301)
    expect(first.headers.get('location')).toBe('/members/okazaki/career?x=1')
    const second = await get('/members/okazaki/career?x=1')
    expect(second.headers.get('location')).toBe('/members/okazaki#career')
  })
})

/*
  1人のサイトのプロフィール。

  公開中のメンバーが1人で Team を置いているとき、Team のページは作らない。
  その位置にその人のページが入り、目次には「Profile」の1行で並ぶ。1枚の細い
  カードだけの Team のページは、「複数いる前提の器に1人しか入っていない」ことを
  ページ1枚ぶん使って告知していた。
*/
describe('1人のサイトのプロフィール', () => {
  const FULL = { skillsText: 'C# | 3年以上', careerText: '2024.03 | 入社 | ある会社' }

  it('目次は「Profile」の1行。行き先はプロフィールのページで、そのページでその行に印', async () => {
    await seedMember(FULL)
    await seedItem({ type: 'app' })

    const labels = (html: string) =>
      [...tocOf(html).matchAll(/<a [^>]*>([^<]+)<\/a>/g)].map((match) => match[1])
    expect(labels(await okText('/'))).toEqual(['Projects', 'Profile', 'Contact'])

    const html = await okText('/members/okazaki')
    expect(tocOf(html)).toContain(
      '<a href="/members/okazaki" aria-current="page" lang="en">Profile</a>',
    )
    expect(html.match(/aria-current="page"/g)).toHaveLength(1)
    // Team の行は無い（ページが無いので、指す先も無い）。About などの小節も目次には並ばない
    for (const name of ['Team', 'About', 'Skills', 'Career']) {
      expect(tocOf(html), name).not.toContain(name)
    }
  })

  it('/team はプロフィールへ 301。2人目を公開すると Team のページに戻る', async () => {
    await seedMember()

    for (const path of ['/team', '/team?kind=app']) {
      const response = await get(path)
      expect(response.status, path).toBe(301)
      expect(response.headers.get('location'), path).toBe('/members/okazaki')
    }
    // 割っていたころの /team/2 は、まず /team へ（そこからプロフィールへ）
    const second = await get('/team/2')
    expect(second.status).toBe(301)
    expect(second.headers.get('location')).toBe('/team')

    await seedMember({ slug: 'hoshino', name: '星野' })
    expect((await get('/team')).status).toBe(200)
  })

  it('/profile は目次の Profile の行き先へ 301。プロフィールの無いサイトでは 404', async () => {
    await seedMember()
    const response = await get('/profile')
    expect(response.status).toBe(301)
    expect(response.headers.get('location')).toBe('/members/okazaki')

    // 2人目を公開すると、目次に Profile の行は無い（Team に戻る）
    await seedMember({ slug: 'hoshino', name: '星野' })
    expect((await get('/profile')).status).toBe(404)
  })

  it('プロフィールに帯は出さない。入口の一覧への1本と同じ行き先・同じ件数になる', async () => {
    const member = await seedMember()
    await seedItem({ type: 'app', memberId: member.id })

    expect(mainOf(await okText('/'))).toContain('class="cta" href="/projects"')
    expect(mainOf(await okText('/members/okazaki'))).not.toContain('class="band"')
  })

  it('全体ページでは、Team のカードの代わりにプロフィールを1つの節として置く', async () => {
    await seedMember({
      headline: 'つくる工程そのものを、速くする。',
      bio: '紹介の段落。',
      skillsText: 'LANGUAGES:\nC# | 3年以上',
      careerText: '2024.03 | 入社 | ある会社',
    })

    const html = await okText('/all')
    const profile = html.slice(
      html.indexOf('<section id="profile"'),
      html.indexOf('<section id="contact"'),
    )
    expect(profile).toContain('role="region" aria-label="Profile"')
    expect(html).toContain('<a href="#profile" lang="en">Profile</a>')
    // カード1枚の Team は置かない
    expect(html).not.toContain('member--wide')
    expect(html).not.toContain('<section id="team"')

    /*
      見出しの段: Hero の h1 → Profile の h2 → About / Skills / Career の h3 →
      技術の小見出しの h4。段を飛ばすと、見出しで移動する人が骨格を掴めない
    */
    expect(profile.match(/<h[1-6][^>]*>[^<]*/g)).toEqual([
      '<h2>Profile',
      '<h3>About',
      '<h3>Skills',
      '<h4 class="side-head" lang="en">LANGUAGES',
      '<h3>Career',
    ])
    expect(html.match(/<h1[^>]*>/g) ?? []).toHaveLength(1)
    // 名札の名前は添え（見出しは節の h2）。大見出しは個人ページの h1 と同じ太さの1文
    expect(profile).toContain('<strong class="nameplate__name">岡崎 昂功</strong>')
    expect(profile).toContain(
      '<p class="profile__headline"><span class="phrase">つくる工程そのものを、</span><span class="phrase">速くする。</span></p>',
    )
    expect(profile).toContain('紹介の段落。')
    expect(profile).toContain('入社')

    // 2人目を公開すると Team のカードの節に戻る。見出しは h2 のまま、h1 は Hero の1つ
    await seedMember({ slug: 'hoshino', name: '星野' })
    const two = await okText('/all')
    expect(two).toContain('<div class="head"><h2>Team</h2>')
    expect(two).not.toContain('<section id="profile"')
    expect(two.match(/<h1[^>]*>/g) ?? []).toHaveLength(1)
  })

  it('sitemap にはプロフィールを1度だけ載せ、/team と前の続きの URL は載せない', async () => {
    await seedMember(FULL)

    const locsOf = async () =>
      [...(await okText('/sitemap.xml')).matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1])
    const locs = await locsOf()
    expect(new Set(locs).size).toBe(locs.length)
    expect(locs).toContain(`${SITE.origin}/members/okazaki`)
    expect(locs).not.toContain(`${SITE.origin}/team`)
    for (const path of ['/about', '/skills', '/career']) {
      expect(locs).not.toContain(`${SITE.origin}/members/okazaki${path}`)
    }

    // 2人以上なら Team のページが戻り、個人ページも載ったまま（同じ URL は1度ずつ）
    await seedMember({ slug: 'hoshino', name: '星野' })
    const two = await locsOf()
    expect(new Set(two).size).toBe(two.length)
    expect(two).toContain(`${SITE.origin}/team`)
    expect(two).toContain(`${SITE.origin}/members/okazaki`)
    expect(two).toContain(`${SITE.origin}/members/hoshino`)
  })

  it('Team を置かない1人のサイトでは、個人ページは並びの外。目次に印は付かない', async () => {
    const member = await seedMember(FULL)
    await seedItem({ memberId: member.id })
    await db()
      .insert(schema.blocks)
      .values([
        { type: 'hero' as const, published: 1, sortOrder: 10 },
        { type: 'projects' as const, published: 1, sortOrder: 20 },
        { type: 'contact' as const, published: 1, sortOrder: 30 },
      ])

    const html = await okText('/members/okazaki')
    // 目次はサイトのもの。Profile の行も印も無い
    expect(tocOf(html)).not.toContain('Profile')
    expect(html).not.toContain('aria-current="page"')
    // 帯はこちらでは出る（入口の「作品を見る →」と行き先が同じでも、このページはサイトの並びの外）
    expect(mainOf(html)).toContain('class="band"')
    // カードの担当者名から入る（Team が無いので、個人ページへの道はそこだけ）
    expect(mainOf(await okText('/projects'))).toContain('href="/members/okazaki"')
  })

  it('Hero を外して Team を先頭に置いたら、/ はプロフィールへ送る', async () => {
    await seedMember()
    await db()
      .insert(schema.blocks)
      .values([
        { type: 'team' as const, published: 1, sortOrder: 10 },
        { type: 'contact' as const, published: 1, sortOrder: 20 },
      ])

    // そのページは /members/<slug> にある。構成しだいで変わる行き先なので 302
    const top = await get('/')
    expect(top.status).toBe(302)
    expect(top.headers.get('location')).toBe('/members/okazaki')

    // 並びの先頭なので、ここで名乗る
    expect(await okText('/members/okazaki')).toContain('application/ld+json')
    // 送る元の / は sitemap に載せない
    expect(await okText('/sitemap.xml')).not.toContain(`<loc>${SITE.origin}/</loc>`)
  })
})

/*
  ページそのものが縦にスクロールする（CLAUDE.md の「公開ページは縦に読む」）ので、
  main の中の箱はスクロール箱ではなく、Tab で止まる先でもない。以前は節が溢れの弁
  （overflow: auto）で、WebKit では弁にフォーカスできないために tabindex="0" を
  付けていた。弁を外したあとに残すと、止まっても何も起きないタブ停止が節ごとに
  1つずつ増える。
*/
describe('キーボードで読む', () => {
  const boxes = (html: string) => mainOf(html).match(/<(?:section|header)[^>]*>/g) ?? []

  it('main の中の箱は tabindex を持たない', async () => {
    await seedMember({ skillsText: 'C# | 3年以上', careerText: '2024.03 | 入社 | ある会社' })
    await seedItem({ type: 'app', slug: 'appmixer', body: '背景です。' })
    await seedItem({ type: 'work' })

    for (const path of [
      '/',
      '/projects',
      '/contact',
      '/all',
      '/members/okazaki',
      '/apps/item/appmixer',
    ]) {
      const found = boxes(await okText(path))
      expect(found.length, path).toBeGreaterThan(0)
      for (const box of found) expect(box, path).not.toContain('tabindex')
    }
  })

  it('見出しのあるページは、その名前の region として出る', async () => {
    await seedItem({ type: 'app' })
    expect(await okText('/projects')).toContain('role="region" aria-label="Projects"')
  })

  it('main は tabindex="-1"。「本文へスキップ」の行き先', async () => {
    await seedItem()
    const html = await okText('/')
    expect(html).toContain('<main id="main" tabindex="-1">')
    // 迂回路はこの1本しか無い
    expect(html).toContain('<a class="skip" href="#main">')
  })
})

describe('/images', () => {
  it('avatars 配下だけを返す', async () => {
    await env.MEDIA.put('avatars/ok.png', 'image-bytes', {
      metadata: { contentType: 'image/png' },
    })
    expect((await get('/images/avatars/ok.png')).status).toBe(200)
  })

  it('置き場の外のキーは読ませない', async () => {
    /*
      いまの KV には画像しか無いが、この URL は KV のキーを外に開く口。
      あとから同じ KV に置いたもの（以前はログイン試行の記録 login:<メール> が
      同居していた）が黙って読み出せないよう、キーの形で縛る
    */
    await env.MEDIA.put('login:someone@example.com', '3')
    expect((await get('/images/login:someone@example.com')).status).toBe(404)
  })

  it('items 配下（作品の画像）も返す。置き場の外を指す形は、どの書き方でも 404', async () => {
    await env.MEDIA.put('items/shot-ab12.png', 'image-bytes', {
      metadata: { contentType: 'image/png' },
    })
    /*
      下の URL が読みに行くキーに、実際に値を置いておく。置かないと、形の検査を
      外しても KV に何も無くて 404 になり、この検査は素通りで緑になる
    */
    for (const key of [
      'login:someone@example.com',
      'items/login:someone@example.com',
      'other/shot-ab12.png',
      'items/sub/shot-ab12.png',
      'items/.shot',
    ]) {
      await env.MEDIA.put(key, 'secret')
    }

    const ok = await get('/images/items/shot-ab12.png')
    expect(ok.status).toBe(200)
    expect(ok.headers.get('content-type')).toBe('image/png')

    for (const path of [
      // 置き場の中から外へ出る。../ は URL の段で畳まれ、%2F は畳まれずに届く
      '/images/items/../login:someone@example.com',
      '/images/items/..%2Flogin:someone@example.com',
      '/images/items/%2E%2E%2Flogin:someone@example.com',
      // 置き場の名前のあとに、記録のキーそのものを書く（: は名前に使えない）
      '/images/items/login:someone@example.com',
      // 知らない置き場・置き場の中の階層・. で始まる名前
      '/images/other/shot-ab12.png',
      '/images/items/sub/shot-ab12.png',
      '/images/items/.shot',
      '/images/items/',
    ]) {
      expect((await get(path)).status, path).toBe(404)
    }
  })

  /*
    SEC-2 / ADM-4。/images/* はサイトと同じオリジンで配る。画像のふりをした
    文書（SVG の <script>）が直に開かれても走らないよう、嗅ぎ分けを止め、
    スクリプトも読み込みも持たない sandbox の文書として返す
  */
  it('nosniff と sandbox の CSP を付けて返す', async () => {
    await env.MEDIA.put('items/shot-cd34.png', 'image-bytes', {
      metadata: { contentType: 'image/png' },
    })
    const response = await get('/images/items/shot-cd34.png')
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('image/png')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(response.headers.get('content-security-policy')).toBe("default-src 'none'; sandbox")
    expect(response.headers.get('content-disposition')).toBeNull()
  })

  it('5種類に無い型で残っている画像（以前の SVG・HEIC）は、画像としてではなく添付で返す', async () => {
    for (const [key, type] of [
      ['avatars/eve-9cf5750a.svgxml', 'image/svg+xml'],
      ['avatars/eve-1234abcd.heic', 'image/heic'],
      ['items/old-1234abcd.bin', undefined],
    ] as const) {
      await env.MEDIA.put(
        key,
        '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
        type ? { metadata: { contentType: type } } : {},
      )
      const response = await get(`/images/${key}`)
      expect(response.status, key).toBe(200)
      expect(response.headers.get('content-type'), key).toBe('application/octet-stream')
      expect(response.headers.get('content-disposition'), key).toBe('attachment')
      expect(response.headers.get('x-content-type-options'), key).toBe('nosniff')
      expect(response.headers.get('content-security-policy'), key).toBe(
        "default-src 'none'; sandbox",
      )
    }
  })
})

/*
  URL の検査の描画の側（ADM-3 / PUB-5 / SEC-4）。保存の側は test/admin.test.ts の
  「URL の検査（保存）」。こちらは、その検査より前に入った行（や手で DB に入れた行）
  が公開ページで落ちることを見る。以前は作品のリンクもメンバーの GitHub も、
  javascript: のまま href と JSON-LD に出ていた。
*/
describe('URL の検査（描画）', () => {
  const jsonLdOf = (html: string) =>
    JSON.parse(html.match(/<script type="application\/ld\+json">(.*?)<\/script>/)?.[1] ?? 'null')

  it('作品のリンクの javascript: と相対 URL は、一覧の行にも作品のページにも全体ページにも出さない', async () => {
    const item = await seedItem({ title: 'AppMixer', slug: 'appmixer' })
    await db()
      .insert(schema.itemLinks)
      .values([
        { itemId: item.id, label: 'XSS', url: 'javascript:alert(document.domain)', sortOrder: 0 },
        { itemId: item.id, label: '相対', url: 'github.com/iam74k4', sortOrder: 1 },
        { itemId: item.id, label: 'タブ', url: '/\t/evil.example', sortOrder: 2 },
        { itemId: item.id, label: 'Repository', url: 'https://example.test/r', sortOrder: 3 },
      ])

    for (const path of ['/projects', '/apps/item/appmixer', '/all']) {
      const main = mainOf(await okText(path))
      expect(main, path).not.toContain('javascript:')
      expect(main, path).not.toContain('href="github.com')
      expect(main, path).not.toContain('evil.example')
      // 通る行はそのまま残る
      expect(main, path).toContain('href="https://example.test/r"')
    }
  })

  it('リンクが全部落ちたら、行き先の行ごと出さない', async () => {
    const item = await seedItem({ title: 'AppMixer', slug: 'appmixer' })
    await db()
      .insert(schema.itemLinks)
      .values({ itemId: item.id, label: 'XSS', url: 'javascript:alert(1)', sortOrder: 0 })
    expect(mainOf(await okText('/apps/item/appmixer'))).not.toContain('<div class="links">')
  })

  it('メンバーの GitHub の javascript: と相対 URL は、個人ページにも JSON-LD にも出さない', async () => {
    for (const github of ['javascript:alert(document.cookie)', 'github.com/okazaki']) {
      await resetDb()
      await seedMember({ github })

      // 1人のサイト。個人ページの名札の下にも全体ページにも出さず、名乗りはサイトの GitHub に戻す
      expect(await okText('/members/okazaki'), github).not.toContain(`href="${github}"`)
      expect(await okText('/all'), github).not.toContain(`href="${github}"`)
      const top = await okText('/')
      expect(top, github).not.toContain(github)
      expect(jsonLdOf(top).sameAs, github).toEqual([SITE.github])

      // 2人のサイトでは個人ページが自分の名乗り（Person）を持つ。そこにも載せない
      await seedMember({ slug: 'hoshino', name: '星野', sortOrder: 20 })
      const personal = await okText('/members/okazaki')
      expect(personal, github).not.toContain(github)
      expect(jsonLdOf(personal), github).toMatchObject({ '@type': 'Person' })
      expect(jsonLdOf(personal), github).not.toHaveProperty('sameAs')
    }
  })

  it('https:// の GitHub はそのまま出る', async () => {
    await seedMember({ github: 'https://github.com/okazaki' })
    await seedMember({ slug: 'hoshino', name: '星野', sortOrder: 20 })
    const personal = await okText('/members/okazaki')
    expect(mainOf(personal)).toContain('href="https://github.com/okazaki"')
    expect(jsonLdOf(personal).sameAs).toEqual(['https://github.com/okazaki'])
  })

  it('部品が自分で落とす（呼ぶ側の検査に頼らない）', () => {
    const row = String(
      LinkRow({
        links: [
          { label: 'XSS', url: 'javascript:alert(1)' },
          { label: 'OK', url: 'https://example.test' },
        ],
      }),
    )
    expect(row).not.toContain('javascript:')
    expect(row).toContain('href="https://example.test"')

    const list = String(
      LinkList({
        rows: [
          ['XSS', 'javascript:alert(1)'],
          ['OK', '/projects'],
        ],
      }),
    )
    expect(list).not.toContain('javascript:')
    expect(list).toContain('href="/projects"')
  })
})

/*
  機械に読ませる2本。どちらも無いと、画面を7つに分けたぶんだけ取りこぼす
  （分けた先は互いにリンクで繋がっているが、全体版と作品の恒久リンクは
  目次からは指されない）。
*/
describe('robots.txt と sitemap.xml', () => {
  it('robots.txt は読んでよいと言い、sitemap の在り処を教える', async () => {
    const response = await get('/robots.txt')
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/plain')

    const text = await response.text()
    expect(text).toContain('User-agent: *')
    expect(text).toContain('Allow: /')
    // 管理画面は壁の内側だが、URL を拾わせる理由が無い
    expect(text).toContain('Disallow: /admin/')
    // 相対では書けない。絶対 URL でなければクローラは読まない
    expect(text).toContain(`Sitemap: ${SITE.origin}/sitemap.xml`)
  })

  it('sitemap は公開中のページをそのまま数え上げる', async () => {
    await seedMember()
    await seedItem({ type: 'app', title: 'ひとつめ', slug: 'one' })
    await seedItem({ type: 'app', title: 'ふたつめ', slug: 'two' })
    await seedItem({ type: 'app', title: 'みっつめ', slug: 'three' })

    const response = await get('/sitemap.xml')
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('application/xml')

    const xml = await response.text()
    const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1])

    // 手で並べた表は置かない。ページが増えれば URL も増える
    expect(locs).toContain(`${SITE.origin}/`)
    expect(locs).toContain(`${SITE.origin}/projects`)
    // 寄せる元の URL（Apps / Works の一覧）は載せない
    expect(locs).not.toContain(`${SITE.origin}/apps`)
    expect(locs).toContain(`${SITE.origin}/all`)
    expect(locs).toContain(`${SITE.origin}/members/okazaki`)
    // 個人ページの Contact は外した（サイトの Contact へ 301）。寄せる元の URL は載せない
    expect(locs).not.toContain(`${SITE.origin}/members/okazaki/contact`)
    expect(locs).toContain(`${SITE.origin}/apps/item/one`)
    // 一覧は1ページ。割っていたころの続き（転送するだけの URL）は載せない
    expect(locs.filter((loc) => loc?.startsWith(`${SITE.origin}/projects/`))).toEqual([])
  })

  it('出ないページは載せない。下書きも、絞り込み付きの URL も', async () => {
    await seedMember({ slug: 'draft', name: '下書きの人', published: 0 })
    await seedMember()
    await seedItem({ type: 'app', title: '下書きのアプリ', slug: 'hidden', published: 0 })
    await seedItem({ type: 'app', slug: 'shown' })

    const xml = await okText('/sitemap.xml')
    expect(xml).not.toContain('/apps/item/hidden')
    expect(xml).not.toContain('/members/draft')
    // 同じ中身の取り出し方なので、絞り込みの組み合わせのぶんだけ URL を数えさせない
    expect(xml).not.toContain('?platform=')
    expect(xml).not.toContain('/admin')
    expect(xml).toContain('/apps/item/shown')
  })

  it('同じ URL は1度だけ並べる。全部下書きでも入口は載る', async () => {
    await seedMember()
    await seedItem({ type: 'app' })

    const locs = [...(await okText('/sitemap.xml')).matchAll(/<loc>([^<]+)<\/loc>/g)]
    expect(new Set(locs.map((match) => match[1])).size).toBe(locs.length)

    // 置いたものが全部下書きでも、入口は 200 のまま（「まだ何も置いていません」）
    await db().insert(schema.blocks).values({ type: 'hero', published: 0, sortOrder: 10 })
    expect((await get('/')).status).toBe(200)
    expect(await okText('/sitemap.xml')).toContain(`<loc>${SITE.origin}/</loc>`)
  })

  it('先頭のページは正の URL ひとつだけ。/<slug> は載せない', async () => {
    await seedItem({ type: 'app' })
    // Hero を置かなければ、先頭のページは Projects。/ と /projects の2つで開ける
    await db().insert(schema.blocks).values({ type: 'projects', published: 1, sortOrder: 10 })

    const xml = await okText('/sitemap.xml')
    // 正は / のほう（sitePageLinks が先頭だけ / に寄せている）
    expect(xml).toContain(`<loc>${SITE.origin}/</loc>`)
    expect(xml).not.toContain(`<loc>${SITE.origin}/projects</loc>`)
  })
})

describe('全体ページへの導線', () => {
  it('全体ページ自身には出さない（自分への行き先）', async () => {
    await seedItem()
    expect(await okText('/all')).not.toContain('href="/all"')
  })
})

describe('管理画面への入口', () => {
  it('訪問者には出さない。上の帯は今までと同じ姿のまま', async () => {
    await seedMember()
    await seedItem({ slug: 'appmixer' })

    for (const path of ['/', '/projects', '/all', '/members/okazaki', '/apps/item/appmixer']) {
      const response = await get(path)
      // 404 の空の本文で「含まない」が緑にならないように（okText と同じ見張り）
      expect(response.status, path).toBe(200)
      expect(await response.text(), path).not.toContain('top__admin')
      expect(response.headers.get('cache-control'), path).toBeNull()
    }
  })

  it('ログインしている人には、いま見ているページを直す場所へ送る入口を出す', async () => {
    const member = await seedMember()
    const item = await seedItem({ slug: 'appmixer' })
    const signed = await signIn()

    const cases: [string, string][] = [
      ['/', `/admin/members/${member.id}/edit`],
      ['/projects', '/admin/items'],
      // 1人のサイトに Team のページは無い。その位置のプロフィールは、その人の編集へ
      // Contact の文言と宛先はサイト設定から編集する
      ['/contact', '/admin/site'],
      ['/all', '/admin/blocks'],
      ['/members/okazaki', `/admin/members/${member.id}/edit`],
      ['/apps/item/appmixer', `/admin/items/${item.id}/edit`],
    ]
    for (const [path, href] of cases) {
      const response = await signed(path)
      expect(await response.text(), path).toContain(`<a class="top__admin" href="${href}">`)
      // 共有のキャッシュに置かれると、次の訪問者に入口が出る
      expect(response.headers.get('cache-control'), path).toBe('private, no-store')
    }
  })

  it('打ち込むブロックのページは、そのブロックの編集へ送る', async () => {
    await seedMember()
    const [block] = await db()
      .insert(schema.blocks)
      .values({ type: 'statement', title: 'つくる速さは、設計で決まる。', published: 1 })
      .returning()
    if (!block) throw new Error('ブロックを置けなかった')
    const signed = await signIn()

    const html = await (await signed(`/block-${block.id}`)).text()
    expect(html).toContain(`<a class="top__admin" href="/admin/blocks/${block.id}/edit">`)
  })

  it('期限の切れたセッションでは出さない', async () => {
    await seedMember()
    const signed = await signIn()
    await db().update(schema.sessions).set({ expiresAt: '2000-01-01T00:00:00.000Z' })

    const response = await signed('/')
    expect(response.status).toBe(200)
    expect(await response.text()).not.toContain('top__admin')
    expect(response.headers.get('cache-control')).toBeNull()
  })
})

/*
  貼られたリンクのカードと、検索結果の見え方。og:image が無いと LinkedIn は
  灰色の箱、Slack は文字だけの行になり、どのページも同じ無地の札になる。
*/
describe('共有カードとページごとの説明文', () => {
  const descriptionOf = (html: string) =>
    html.match(/<meta name="description" content="([^"]*)"/)?.[1] ?? ''

  it('og:image はサイトに1枚。実在する素材を絶対 URL で指す', async () => {
    await seedItem()
    const html = await okText('/')

    expect(html).toContain(
      `<meta property="og:image" content="${SITE.origin}/assets/astlog-card.png"/>`,
    )
    // サイトの1枚は横長（1200×630）なので、貼り先では大きい札になる
    expect(html).toContain('<meta property="og:image:width" content="1200"/>')
    expect(html).toContain('<meta property="og:image:height" content="630"/>')
    expect(html).toContain('<meta name="twitter:card" content="summary_large_image"/>')
    expect(html).toContain('<meta property="og:image:alt"')
  })

  /*
    作品のページは、画像があればその作品の画像を共有カードに出す。種類は経路の
    拡張子から、寸法は上げたときに読んだもの（items.image_width / image_height）。
    分からないものは名乗らない。twitter:card は横長で 300x157 以上なら大きい札
  */
  it('画像のある作品のページは、その作品の画像を og:image にする（絶対 URL・種類・寸法）', async () => {
    await seedItem({
      title: 'AppMixer',
      slug: 'appmixer',
      imageUrl: '/images/items/appmixer-ab12cd34.png',
      imageAlt: '音量ミキサーの画面',
      imageWidth: 1200,
      imageHeight: 630,
    })
    const html = await okText('/apps/item/appmixer')
    expect(html).toContain(
      `<meta property="og:image" content="${SITE.origin}/images/items/appmixer-ab12cd34.png"/>`,
    )
    expect(html).toContain('<meta property="og:image:type" content="image/png"/>')
    expect(html).toContain('<meta property="og:image:width" content="1200"/>')
    expect(html).toContain('<meta property="og:image:height" content="630"/>')
    expect(html).toContain('<meta property="og:image:alt" content="音量ミキサーの画面"/>')
    expect(html).toContain('<meta name="twitter:card" content="summary_large_image"/>')
    // サイトの1枚は出さない（og:image は1つ）
    expect(html).not.toContain('/assets/astlog-card.png"/>')
    expect(html.match(/property="og:image"/g) ?? []).toHaveLength(1)
  })

  it('寸法が分からない・縦長・AVIF なら、名乗り方と札を変える', async () => {
    // この列より前に上げた画像。寸法は名乗らず、札は小さいまま
    await seedItem({
      title: '古い画像',
      slug: 'old',
      imageUrl: '/images/items/old-ab12cd34.jpeg',
      imageAlt: '古い画面',
    })
    const old = await okText('/apps/item/old')
    expect(old).toContain(`content="${SITE.origin}/images/items/old-ab12cd34.jpeg"`)
    expect(old).toContain('<meta property="og:image:type" content="image/jpeg"/>')
    expect(old).not.toContain('og:image:width')
    expect(old).toContain('<meta name="twitter:card" content="summary"/>')

    // 縦長のスクリーンショット。大きい札は横長に切り抜くので、小さい札のまま
    await seedItem({
      title: '縦長',
      slug: 'tall',
      imageUrl: '/images/items/tall-ab12cd34.png',
      imageAlt: '縦長の画面',
      imageWidth: 1170,
      imageHeight: 2532,
    })
    const tall = await okText('/apps/item/tall')
    expect(tall).toContain('<meta property="og:image:width" content="1170"/>')
    expect(tall).toContain('<meta name="twitter:card" content="summary"/>')

    // AVIF は貼り先が読まないので、サイトの1枚に戻す
    await seedItem({
      title: 'AVIF',
      slug: 'avif',
      imageUrl: '/images/items/avif-ab12cd34.avif',
      imageAlt: 'AVIF の画面',
      imageWidth: 1600,
      imageHeight: 900,
    })
    const avifPage = await okText('/apps/item/avif')
    expect(avifPage).toContain(
      `<meta property="og:image" content="${SITE.origin}/assets/astlog-card.png"/>`,
    )
  })

  it('同梱の素材（seed.sql の AppMixer の画像）も、その作品の共有カードになる', async () => {
    await seedItem({
      title: 'AppMixer',
      slug: 'appmixer',
      imageUrl: '/assets/appmixer-01-per-app-volume.jpg',
      imageAlt: 'ミキサーの画面',
      imageWidth: 1440,
      imageHeight: 900,
    })
    const html = await okText('/apps/item/appmixer')
    expect(html).toContain(
      `<meta property="og:image" content="${SITE.origin}/assets/appmixer-01-per-app-volume.jpg"/>`,
    )
    expect(html).toContain('<meta property="og:image:type" content="image/jpeg"/>')
    expect(html).toContain('<meta name="twitter:card" content="summary_large_image"/>')
  })

  it('画像の無い作品のページと、ほかのページはサイトの1枚のまま', async () => {
    await seedItem({ title: 'AppMixer', slug: 'appmixer' })
    for (const path of ['/apps/item/appmixer', '/projects', '/all']) {
      const html = await okText(path)
      expect(html, path).toContain(
        `<meta property="og:image" content="${SITE.origin}/assets/astlog-card.png"/>`,
      )
      expect(html, path).toContain('<meta name="twitter:card" content="summary_large_image"/>')
    }
  })

  it('ページごとに違う説明文を出す。同じ1文を配らない', async () => {
    await seedMember({ skillsText: 'C# | 3年以上', careerText: '2024.03 | 入社 | ある会社' })
    await seedItem({ type: 'app', slug: 'appmixer', summary: '音を配る常駐アプリ。' })
    await seedItem({ type: 'work' })

    // 1人のサイトなので /team は無い（プロフィールへ 301）
    const paths = ['/', '/projects', '/contact', '/all', '/members/okazaki', '/apps/item/appmixer']
    const found = await Promise.all(paths.map(async (path) => descriptionOf(await okText(path))))

    for (const [index, text] of found.entries()) expect(text, paths[index]).not.toBe('')
    expect(new Set(found).size).toBe(paths.length)
  })

  /*
    COR-5。説明の無い作品（関門が説明を求める前に公開した作品）の説明文は、入口の
    サイトの紹介文に戻さず、作品の事実から組む。戻していたころは、説明の無い作品の
    ページが入口と同じ説明文になり、そうした作品どうしも同じ文になった
  */
  it('説明の無い作品の説明文は、入口とも、ほかの説明の無い作品とも重ならない', async () => {
    await seedMember()
    await seedItem({
      type: 'work',
      title: 'NoSumA',
      slug: 'nosuma',
      summary: '',
      category: '製造業',
      year: '2024',
    })
    await seedItem({ type: 'work', title: 'NoSumB', slug: 'nosumb', summary: '', year: '2025' })

    const top = descriptionOf(await okText('/'))
    const a = descriptionOf(await okText('/works/item/nosuma'))
    const b = descriptionOf(await okText('/works/item/nosumb'))
    expect(a).toBe('NoSumA（業務 · 製造業 · 2024）')
    expect(b).toBe('NoSumB（業務 · 2025）')
    expect(new Set([top, a, b]).size).toBe(3)
  })

  it('一覧の説明文は、件数と絞り込みと、そのページに出ている行から作る', async () => {
    await seedItem({ type: 'app', title: 'ひとつめ', sortOrder: 10 })
    await seedItem({ type: 'app', title: 'ふたつめ', sortOrder: 20 })
    await seedItem({ type: 'work', title: 'みっつめ', sortOrder: 30 })

    expect(descriptionOf(await okText('/projects'))).toBe(
      'つくったもの 3 件。個人開発 / 業務。ひとつめ、ふたつめ、みっつめ',
    )
    // 絞り込んだページは、そこに出ている行だけを並べる
    expect(descriptionOf(await okText('/projects?kind=work'))).toBe(
      'つくったもの 3 件。個人開発 / 業務。みっつめ',
    )
  })

  it('業務の説明文には、一覧の行に出ている実績値も入る', async () => {
    await seedItem({
      type: 'work',
      title: '開発工程の効率化',
      metricValue: '20',
      metricUnit: '人日',
      metricNote: '見込み 40人日から半減',
    })

    /*
      このサイトでいちばん強い一文は .metric にしかなく、検索結果にも貼られた
      カードにも1文字も出ていなかった。並べる順は一覧の行のまま（値・単位・添え）。
      添えは値のあとに続けて読まれる——「見込み 40人日 → 実績」のころは、→ が
      値より前を指して逆に読めた（添えの書き方は管理画面のヒントが言う）
    */
    expect(descriptionOf(await okText('/projects'))).toBe(
      'つくったもの 1 件。業務。開発工程の効率化（20 人日 見込み 40人日から半減）',
    )
  })

  it('打ち込んだブロックは、そのページに出ている文字から作る', async () => {
    const [block] = await db()
      .insert(schema.blocks)
      .values({
        type: 'timeline',
        title: '年表',
        body: '2026 | 出した | 補足',
        published: 1,
        sortOrder: 10,
      })
      .returning()

    const html = await okText(`/block-${block?.id}`)
    expect(descriptionOf(html)).toBe('年表。2026 出した 補足')
  })

  it('説明文は長すぎたら切る。どこで切れるかはこちらで決める', async () => {
    await seedMember({ headline: 'あ'.repeat(80) })
    await db()
      .insert(schema.blocks)
      .values({
        type: 'note',
        title: 'メモ',
        body: 'あ'.repeat(400),
        published: 1,
        sortOrder: 10,
      })

    // 個人ページの説明文（大見出し）は短いので、長い段落を持つメモのページで見る
    const [note] = await db().select().from(schema.blocks)
    const text = descriptionOf(await okText(`/block-${note?.id}`))
    expect([...text]).toHaveLength(110)
    expect(text.endsWith('…')).toBe(true)
  })
})

/*
  登録順そのものを押さえる。

  `/:screen` と `/:screen/:page` は1語・2語の URL を何でも拾う catch-all で、
  いちばん最後に置いてある。あとから固定のルート（`/all` や `/robots.txt` の
  たぐい）をその下に足すと、一致が catch-all に吸われて**そのページだけが
  静かに 404 になる**。足した本人はその URL のテストを書くので気づけるが、
  「登録順」という決まり自体は散文（CLAUDE.md・src/routes/public/routes.ts の
  コメント・docs/screens.md）だけでは守れない。

  Hono は登録した順のまま `.routes` を公開しているので、そこを読めばよい。
  CSS を文字列で読む test/theme.test.ts の契約テストと同じ手口——実装の
  かたちそのものを1本で固定する。
*/
describe('URL の登録順', () => {
  const paths = () => publicRoutes.routes.map((route) => route.path)

  it('catch-all は最後の2本だけ。固定の URL は必ずその前', () => {
    expect(paths().slice(-2)).toEqual(['/:screen', '/:screen/:page'])
  })

  /*
    区分の URL の語は src/domain.ts の ITEM_KINDS から作る。区分を1つ足した日に、
    恒久リンク（itemHref が組む URL）と前の一覧の 301 が、その区分のぶんだけ
    黙って欠けないこと（URL の組み方とルートが同じ表を読んでいること）。
  */
  it('区分ごとに、恒久リンク・前の本文の画面・前の一覧のルートがある', () => {
    for (const kind of ITEM_KINDS) {
      expect(paths()).toEqual(
        expect.arrayContaining([
          `/${kind.path}/item/:slug`,
          `/${kind.path}/item/:slug/story`,
          `/${kind.path}`,
          `/${kind.path}/:page`,
        ]),
      )
      expect(itemHref({ type: kind.key, slug: 'x' })).toBe(`/${kind.path}/item/x`)
    }
  })

  it('1語目が可変のルートは、この2本のほかに作らない', () => {
    // 3本目を足すと、どれが先に当たるかが登録順の暗黙知になる
    expect(paths().filter((path) => path.startsWith('/:'))).toEqual(['/:screen', '/:screen/:page'])
  })
})

it('知らない URL は 404 ページを返す', async () => {
  const response = await get('/nope')
  expect(response.status).toBe(404)
  expect(await response.text()).toContain('ページが見つかりません')
})

/*
  文書の外枠。DOCTYPE・404 の説明・足元の年。

  4つの外枠（公開ページ・管理画面の壁の中と外・404 と 500）は、どれも
  <!DOCTYPE html> を持たずに互換モードで組まれていた。JSX は DOCTYPE を
  書けないので、書かないまま誰も気づかない種類の抜けで、外枠を1つ足せば
  また起きる。だから本文の先頭を見る。500 は 404 と同じ ErrorPage から出る。
*/
describe('文書の外枠', () => {
  const expectDoctype = (html: string, path: string) => {
    expect(html.startsWith('<!DOCTYPE html><html lang="ja">'), path).toBe(true)
    // 外枠を入れ子にすると2つ出る。先頭の1つだけであること
    expect(html.match(/<!DOCTYPE/gi)?.length, path).toBe(1)
  }

  it('公開ページ・管理画面の入口・404 の本文は <!DOCTYPE html> から始まる', async () => {
    await seedMember()
    await seedItem({ slug: 'appmixer' })

    const paths = [
      '/',
      '/projects',
      '/all',
      '/members/okazaki',
      '/apps/item/appmixer',
      '/admin/login', // 壁の外（AdminBare）
      '/no-such-page', // 404（ErrorPage）
    ]
    for (const path of paths) {
      const response = await get(path)
      expect(response.headers.get('content-type'), path).toContain('text/html')
      expectDoctype(await response.text(), path)
    }
  })

  it('ログインした先の管理画面（AdminLayout）も', async () => {
    const signed = await signIn()
    for (const path of [
      '/admin/members',
      '/admin/items',
      '/admin/blocks',
      '/admin/site',
      '/admin/account',
    ]) {
      const response = await signed(path)
      expect(response.status, path).toBe(200)
      expectDoctype(await response.text(), path)
    }
  })

  it('404 は訪問者の言葉で説明する。管理画面の言葉（slug）を出さない', async () => {
    // 404 になる道はメンバーのページに限らない。どの道でも同じ説明が出る
    for (const path of ['/members/nosuch', '/apps/item/nosuch', '/no-such-page']) {
      const response = await get(path)
      expect(response.status, path).toBe(404)
      const html = await response.text()
      // 句読点ごとの塊（Phrases）に分けてある。読める文字列としては1文のまま
      expect(html.replace(/<[^>]+>/g, ''), path).toContain(
        'URL が変わったか、打ち間違えているかもしれません。',
      )
      expect(html, path).not.toMatch(/slug/i)
    }
  })

  it('足元の年は描いたときの年（日本時間）。字で固定しない', async () => {
    await seedItem()
    /*
      時計を先の年へ進めて描かせる。今年のままだと「© 2026」と字で書いてあっても
      通ってしまう。UTC ではまだ大晦日、日本ではもう元日の時刻にしてあるので、
      日本時間へずらし忘れても落ちる。
    */
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      vi.setSystemTime(new Date('2031-12-31T15:30:00Z'))
      for (const path of ['/', '/projects', '/all']) {
        const html = await okText(path)
        expect(html, path).toContain(`© 2032 ${SITE.name}`)
      }
    } finally {
      vi.useRealTimers()
    }
  })
})

/*
  サイトを「置けるものを全部置いた」姿にする。sitemap の全 URL を回す検査
  （h1・<title>）が、手で並べた URL ではなく実物の並びを見るため。
  書くブロックは全種類、メモは見出しを空けたもの。
*/
async function seedEverything() {
  await seedMember({
    skillsText: 'LANGUAGES:\nC# | 3年以上',
    careerText: Array.from({ length: 6 }, (_, i) => `20${10 + i}.04 | 仕事${i} | 会社`).join('\n'),
  })
  for (let i = 0; i < 3; i += 1) {
    await seedItem({
      title: `作品${i}`,
      slug: `item-${i}`,
      year: `20${20 + i}`,
      sortOrder: i,
      // 1件目だけ本文を持つ（作品のページに小節 #story が付く）
      body: i === 0 ? '背景の段落です。\n\n結果の段落です。' : '',
    })
  }
  await db()
    .insert(schema.blocks)
    .values([
      { type: 'hero', published: 1, sortOrder: 10 },
      { type: 'statement', title: 'つくる速さは、設計で決まる。', published: 1, sortOrder: 20 },
      { type: 'projects', published: 1, sortOrder: 30 },
      {
        type: 'now',
        title: 'Now',
        body: 'ポートフォリオ | 作り直し中',
        published: 1,
        sortOrder: 40,
      },
      {
        type: 'numbers',
        title: '数字で見る',
        body: '20 | 人日 | 半減',
        published: 1,
        sortOrder: 50,
      },
      {
        type: 'links',
        title: 'Links',
        body: 'GitHub | https://github.com/iam74k4',
        published: 1,
        sortOrder: 60,
      },
      {
        type: 'timeline',
        title: 'Timeline',
        body: '2024.03 | 入社 | 会社',
        published: 1,
        sortOrder: 70,
      },
      // 見出しを空けたメモ（段落だけのページ）
      {
        type: 'note',
        title: '',
        body: Array.from({ length: 4 }, (_, i) => `メモの段落 ${i} です。`).join('\n\n'),
        published: 1,
        sortOrder: 80,
      },
      {
        type: 'note',
        title: 'あとがき',
        body: '見出しのあるメモです。',
        published: 1,
        sortOrder: 90,
      },
      { type: 'team', published: 1, sortOrder: 100 },
      { type: 'contact', published: 1, sortOrder: 110 },
    ])
}

const sitemapPaths = async () => {
  const xml = await okText('/sitemap.xml')
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => new URL(match[1] ?? '').pathname)
}

const titleOf = (html: string) => html.match(/<title>([^<]*)<\/title>/)?.[1] ?? ''

/*
  見出しの無いメモ（PUB-3）と、ページごとの題（PUB-2）。どちらも sitemap の全 URL で見る
  ——固定のブロックと個人ページだけを並べていた検査は、管理画面が許す「見出しを
  空けたメモ」のページに h1 が1つも無いことを見逃していた。
*/
describe('サイトの全ページ', () => {
  it('ページごとの URL は、どれも h1 をちょうど1つ持つ（sitemap の全 URL、書くブロックの全種類）', async () => {
    await seedEverything()
    const paths = (await sitemapPaths()).filter((path) => path !== '/all')
    expect(paths.length).toBeGreaterThan(10)
    for (const path of paths) {
      const html = await okText(path)
      expect(html.match(/<h1[^>]*>/g) ?? [], path).toHaveLength(1)
    }
  })

  it('見出しを空けたメモは、種類の名前（メモ）を読み上げの h1・region と独立ページの目次に使う', async () => {
    await seedEverything()
    const note = await db().query.blocks.findFirst({
      where: (t, { and, eq }) => and(eq(t.type, 'note'), eq(t.title, '')),
    })
    const html = await okText(`/block-${note?.id}`)
    expect(mainOf(html)).toContain('<h1 class="sr-only">メモ</h1>')
    expect(mainOf(html)).toContain('aria-label="メモ"')
    expect(tocOf(html)).toContain(`href="/block-${note?.id}" aria-current="page">メモ</a>`)
    expect(tocOf(await okText('/all'))).not.toContain(`href="#block-${note?.id}"`)
    // 見出しのあるメモは今までどおり目に見える h1 で、目次にも並ぶ
    const titled = await db().query.blocks.findFirst({
      where: (t, { eq }) => eq(t.title, 'あとがき'),
    })
    const other = await okText(`/block-${titled?.id}`)
    expect(other).toContain('<h1>あとがき</h1>')
    expect(tocOf(other)).toContain('あとがき')
  })

  it('sitemap の URL はどれも違う <title> を持つ。数え方（2 / 4）はもう添えない', async () => {
    await seedEverything()
    const titles = new Map<string, string>()
    for (const path of await sitemapPaths()) {
      titles.set(path, titleOf(await okText(path)))
    }
    const seen = new Map<string, string>()
    for (const [path, title] of titles) {
      expect(seen.get(title), `${path} と ${seen.get(title)} が同じ題「${title}」`).toBeUndefined()
      seen.set(title, path)
    }
    expect(titles.get('/projects')).toBe(`Projects — ${SITE.name}`)
    expect(titles.get('/contact')).toBe(`Contact — ${SITE.name}`)
    expect(titles.get('/members/okazaki')).toBe(`岡崎 昂功 — ${SITE.name}`)
    expect(titles.get('/apps/item/item-0')).toBe(`作品0 — ${SITE.name}`)
    // 割っていたころの続き・前の本文の画面は、転送するだけなので sitemap に無い
    expect([...titles.keys()].filter((path) => /\/\d+$|\/story$|\/about$/.test(path))).toEqual([])
    // 名前の無いページは、そのページの文の頭（入口と同じ題にしない）
    expect([...titles.values()]).toContain(`つくる速さは、設計で決まる。 — ${SITE.name}`)
  })

  it('全体ページの題は入口と違う', async () => {
    await seedMember()
    expect(titleOf(await okText('/all'))).not.toBe(titleOf(await okText('/')))
  })
})

describe('肩書きの無い人', () => {
  it('題にも説明にも「（）」を出さない。jobTitle も名乗らない（PUB-6）', async () => {
    await seedMember({ role: '', headline: '', bio: '' })
    for (const path of ['/', '/members/okazaki', '/all']) {
      const html = await okText(path)
      expect(html, path).not.toContain('（）')
    }
    const entrance = await okText('/')
    expect(titleOf(entrance)).toBe(`岡崎 昂功 — ${SITE.name}`)
    expect(entrance).not.toContain('"jobTitle"')
  })
})

/*
  作品の並び（PUB-4）。year の頭の4文字を文字列のまま比べていたころは、数字で
  始まらない年が文字の大小で 2026 より上、一覧の先頭に来た。
*/
describe('作品の並び', () => {
  it('年の頭が数字4桁でない作品は、年のある作品より後ろ。そのあいだは並び順', async () => {
    const years = ['令和6', '〜2023', 'FY2024', '24', '2026', '2019.04 — 2021', '']
    for (const [index, year] of years.entries()) {
      await seedItem({ title: `年「${year}」`, slug: `y${index}`, year, sortOrder: index * 10 })
    }
    const html = await okText('/all')
    const order = years
      .map((year) => ({ year, at: html.indexOf(`年「${year}」`) }))
      .sort((a, b) => a.at - b.at)
      .map((one) => one.year)
    expect(order).toEqual(['2026', '2019.04 — 2021', '令和6', '〜2023', 'FY2024', '24', ''])
  })

  it('同じ年の中では、区分をまたいで並び順を比べる', async () => {
    await seedItem({ type: 'work', title: '業務の20', slug: 'w', year: '2026', sortOrder: 20 })
    await seedItem({ type: 'app', title: '個人の10', slug: 'a', year: '2026', sortOrder: 10 })
    await seedItem({ type: 'app', title: '個人の30', slug: 'b', year: '2026', sortOrder: 30 })
    const html = await okText('/all')
    const at = (title: string) => html.indexOf(title)
    expect(at('個人の10')).toBeLessThan(at('業務の20'))
    expect(at('業務の20')).toBeLessThan(at('個人の30'))
  })
})

/*
  前の URL（ADM-7 / SYS-6）。slug を変えた作品・メンバーの前の URL は、いまの URL へ
  301。以前は変えた日から 404 で、名刺や SNS に貼ったリンクが切れた。
*/
describe('前の URL', () => {
  it('slug を変えた作品の前の URL は、いまの URL へ 301', async () => {
    const item = await seedItem({ title: 'AppMixer', slug: 'appmixer' })
    const signed = await signIn()
    await signed(`/admin/items/${item.id}`, {
      method: 'POST',
      body: form({
        type: 'app',
        title: 'AppMixer',
        slug: 'app-mixer',
        summary: '説明。',
        published: '1',
      }),
    })
    const moved = await get('/apps/item/appmixer')
    expect(moved.status).toBe(301)
    expect(moved.headers.get('location')).toBe('/apps/item/app-mixer')
    // 前の区分の URL でも、いまの URL へ
    expect((await get('/works/item/appmixer')).headers.get('location')).toBe('/apps/item/app-mixer')
    // 下書きにしたら、送る先ごと無い
    await db().update(schema.items).set({ published: 0 })
    await touch()
    expect((await get('/apps/item/appmixer')).status).toBe(404)
  })

  it('slug を変えたメンバーの前の URL は、いまの URL（続きの名前も継ぐ）へ 301', async () => {
    const member = await seedMember({ careerText: '2024.03 | 入社 | ある会社' })
    const signed = await signIn()
    await signed(`/admin/members/${member.id}`, {
      method: 'POST',
      body: form({ name: member.name, slug: 'okazaki-k', published: '1' }),
    })
    for (const [from, to] of [
      ['/members/okazaki', '/members/okazaki-k'],
      ['/members/okazaki/career', '/members/okazaki-k/career'],
    ] as const) {
      const response = await get(from)
      expect(response.status, from).toBe(301)
      expect(response.headers.get('location'), from).toBe(to)
    }
    expect((await get('/members/nobody')).status).toBe(404)
  })
})

/*
  作品の星図（入口の軌道図を縮めて、その作品の天体を灯した図）は、画像の無い作品の絵として
  一覧の行と作品のページに置いていたが、どちらからも外した（持ち主の「なんか違う」「開くと
  まだある」）。画像の無い作品は、一覧では字だけの行、作品のページでは文の列だけ
*/
describe('作品の星図を置かない', () => {
  // 一覧の行（id="item-<slug>"）の中
  const rowOf = (html: string, slug: string) =>
    html.split(`id="item-${slug}"`)[1]?.split('</article>')[0] ?? ''

  it('画像のある作品はそのページに画像だけ。一覧の行と画像の無い作品には代わりの絵を置かない', async () => {
    await seedItem({
      title: 'A',
      slug: 'a',
      imageUrl: '/images/items/a-ab12.png',
      imageAlt: '画面',
    })
    await seedItem({ title: 'B', slug: 'b', type: 'work', sortOrder: 20 })
    const list = mainOf(await okText('/projects'))
    // 一覧の行には絵を置かない（画像のある作品でも。絵は作品のページが受ける）
    for (const slug of ['a', 'b']) expect(rowOf(list, slug)).not.toMatch(/<img|class="chart/)
    const shot = mainOf(await okText('/apps/item/a'))
    expect(shot).toContain('<div class="detail detail--shot">')
    const bare = mainOf(await okText('/works/item/b'))
    expect(bare).toContain('<div class="detail"><div class="detail__text">')
    for (const main of [list, shot, bare, mainOf(await okText('/all'))]) {
      expect(main).not.toMatch(/class="chart|chart__|detail--chart/)
    }
  })
})

/*
  COR-1。行き先がデータで変わる転送（slug の転送表・区分を変えた作品・1人のサイトの
  /team・個人ページの Contact）は、ブラウザに覚えさせない（Cache-Control: no-cache）。
  覚えさせていたころは、slug を変えて前の URL を開いたブラウザが「前 → 新」を覚え、
  slug を元に戻すと「新 → 前」とのあいだでリダイレクトの無限ループになった。
  行き先が動かない転送（/apps → /projects）は素の 301 のまま（長く覚えてよい）。
*/
describe('転送をブラウザに覚えさせるか', () => {
  const noCache = async (path: string, location: string) => {
    for (const round of ['miss', 'hit']) {
      const response = await get(path)
      expect(response.status, `${path} ${round}`).toBe(301)
      expect(response.headers.get('location'), `${path} ${round}`).toBe(location)
      // 写しから返すとき（hit）も、同じ cache-control を付け直す
      expect(response.headers.get('cache-control'), `${path} ${round}`).toBe('no-cache')
      expect(response.headers.get('x-astlog-cache'), path).toBe(round)
    }
  }

  it('slug の転送・区分を変えた作品の転送は no-cache。戻したあとは前の URL が 200', async () => {
    const item = await seedItem({ title: 'AppMixer', slug: 'appmixer', summary: '説明。' })
    const signed = await signIn()
    const rename = (slug: string) =>
      signed(`/admin/items/${item.id}`, {
        method: 'POST',
        body: form({ type: 'app', title: 'AppMixer', slug, summary: '説明。', published: '1' }),
      })
    await rename('mixer2')
    await noCache('/apps/item/appmixer', '/apps/item/mixer2')
    await noCache('/works/item/mixer2', '/apps/item/mixer2')

    // 元に戻す。サーバーは逆向きに送る（ブラウザが前の転送を覚えていなければループしない）
    await rename('appmixer')
    expect((await get('/apps/item/appmixer')).status).toBe(200)
    await noCache('/apps/item/mixer2', '/apps/item/appmixer')
  })

  it('メンバーの slug の転送・1人のサイトの /team と /profile・個人ページの Contact も no-cache', async () => {
    const member = await seedMember()
    await noCache('/team', '/members/okazaki')
    await noCache('/profile', '/members/okazaki')
    await noCache('/members/okazaki/contact', '/contact')
    const signed = await signIn()
    await signed(`/admin/members/${member.id}`, {
      method: 'POST',
      body: form({ name: member.name, slug: 'okazaki-k', published: '1' }),
    })
    await noCache('/members/okazaki', '/members/okazaki-k')
  })

  it('行き先が動かない転送（/apps → /projects）は素の 301 のまま', async () => {
    const response = await get('/apps')
    expect(response.status).toBe(301)
    expect(response.headers.get('cache-control')).toBeNull()
  })
})

/*
  固定のブロックが2行ある D1（PUB-1）。いまは DB の部分一意索引が2行目を拒むが、
  索引より前に二重送信でできた重複は残りうる。読む側（publishedBlocks）でも1行に
  絞り、同じ URL が並びに2度並ぶ（目次に同じ行き先が2行出る。当時は画面の底の
  「次」が自分自身を指して先へ進めなかった）を起こさない。
*/
describe('固定のブロックの重複', () => {
  it('2組ある構成でも、目次の行き先は1つずつで、全体ページの節も1つずつ', async () => {
    const index = env.TEST_MIGRATIONS.flatMap((one) => one.queries).find((query) =>
      query.includes('blocks_fixed_once'),
    )
    if (!index) throw new Error('blocks_fixed_once の移行が無い')
    await env.DB.prepare('DROP INDEX blocks_fixed_once').run()
    try {
      await seedMember({ slug: 'hoshino', name: '星野' })
      await seedMember()
      await seedItem({ title: 'AppMixer', slug: 'appmixer' })
      await db()
        .insert(schema.blocks)
        .values(
          (['hero', 'projects', 'team', 'contact'] as const).flatMap((type, at) => [
            { type, published: 1, sortOrder: (at + 1) * 10 },
            { type, published: 1, sortOrder: (at + 1) * 10 + 100 },
          ]),
        )

      for (const path of ['/', '/projects', '/team', '/contact']) {
        const hrefs = [...tocOf(await okText(path)).matchAll(/href="([^"]+)"/g)].map(
          (match) => match[1],
        )
        expect(hrefs, path).toEqual(['/projects', '/team', '/contact'])
      }

      const whole = await okText('/all')
      for (const id of ['projects', 'team', 'contact']) {
        expect(whole.match(new RegExp(`id="${id}"`, 'g')), id).toHaveLength(1)
      }
    } finally {
      await db().delete(schema.blocks)
      await env.DB.prepare(index).run()
    }
  })
})
