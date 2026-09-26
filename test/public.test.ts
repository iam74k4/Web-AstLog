import { env } from 'cloudflare:test'
import markSvg from 'virtual:asset:noctifex-mark.svg'
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { blockPerScreen, MEMBER_PER_SCREEN } from '../src/blocks'
import * as schema from '../src/db/schema'
import { publicRoutes } from '../src/routes/public'
import { SITE } from '../src/site'
import { LinkList, LinkRow, splitPhrases } from '../src/ui/components'
import { MARK_POINTS } from '../src/ui/icons'
import { db, form, get, resetDb, seedItem, seedMember, signIn } from './helpers'

beforeEach(resetDb)

/*
  main の中だけを見る。柱（.rail）には同じ行き先のリンクが常に出ているので、
  ページ全体を見ると「本文にある」ことを確かめられない。
  開きタグを正規表現で読むのは、main が属性（tabindex）を持つため。
*/
const mainOf = (html: string) => html.split(/<main[^>]*>/)[1] ?? ''

// 目次（柱の中）だけを見る。同じ文字列は見出しにもページャにも出る
const tocOf = (html: string) => html.split('<nav class="toc"')[1]?.split('</nav>')[0] ?? ''

// 柱だけを見る。名前や連絡先は本文にも出るので、ページ全体では確かめられない
const railOf = (html: string) =>
  html.slice(html.indexOf('<aside class="rail"'), html.indexOf('</aside>'))

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

    const html = await (await get('/all')).text()
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

    const html = await (await get('/all')).text()
    expect(html).toContain('公開のアプリ')
    expect(html).not.toContain('下書きのアプリ')
  })

  it('区分のピルは、両方の区分に項目があるときだけ並べる', async () => {
    await seedItem({ type: 'app', platformKey: 'web' })

    // 個人開発しか無いサイトで「業務」を置いても、押した先は0件の知らせだけ
    const only = await (await get('/all')).text()
    expect(only).not.toContain('kind=')

    await seedItem({ type: 'work', title: '業務の実績' })
    const both = await (await get('/all')).text()
    expect(both).toContain('href="/projects?kind=app"')
    expect(both).toContain('href="/projects?kind=work"')
    // プラットフォームでは絞らない（カードの札には残る）
    expect(both).not.toContain('platform=')
  })

  it('個人開発と業務を1つの一覧に、新しい順で並べる', async () => {
    await seedItem({ type: 'app', title: '古いアプリ', year: '2023', sortOrder: 10 })
    await seedItem({ type: 'work', title: '続いている業務', year: '2024 — 現在', sortOrder: 10 })
    await seedItem({ type: 'app', title: '新しいアプリ', year: '2026', sortOrder: 20 })
    await seedItem({ type: 'work', title: '年の無い業務', year: '', sortOrder: 20 })

    const html = await (await get('/all')).text()
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
    expect(await (await get('/all')).text()).toContain('member--wide')

    await seedMember({ slug: 'c', name: 'C' })
    expect(await (await get('/all')).text()).toContain('member--compact')
  })

  it('アバターは遅延読み込みにしない（空の丸のまま見えてしまう）', async () => {
    await seedMember({ avatarUrl: '/assets/avatar.png' })
    const html = await (await get('/all')).text()
    expect(html).toContain('src="/assets/avatar.png"')
    expect(html).not.toContain('loading="lazy"')
  })

  it('下書きのメンバーは名前もリンクも出さない', async () => {
    const draft = await seedMember({ slug: 'draft', name: '下書きの人', published: 0 })
    await seedMember({ slug: 'shown', name: '公開の人' })
    await seedMember({ slug: 'shown2', name: 'もう一人' })
    await seedItem({ title: '担当者が下書きのアプリ', memberId: draft.id })

    const html = await (await get('/all')).text()
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

    const html = await (await get('/')).text()
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
      const html = await (await get(path)).text()
      expect(html, path).not.toContain('つくる人たち')
      expect(html, path).not.toContain('メンバーごとに')
    }
  })

  it('2人以上なら器（Organization）に戻る。仕組みは壊していない', async () => {
    await seedMember()
    await seedMember({ slug: 'hoshino', name: '星野' })
    await seedItem()

    const html = await (await get('/')).text()
    expect(html).toContain('"@type":"Organization"')
    // 中の member の列はそのまま。Team ブロックも members テーブルも生きている
    expect(html).toContain('"url":"https://noctifex.dev/members/hoshino"')
  })

  it('Team の見出しに添えを置かない。訳語も人数も', async () => {
    await seedMember()
    await seedMember({ slug: 'hoshino', name: '星野' })
    const html = await (await get('/team')).text()
    // 「メンバー」は Team の訳語でしかなく、見出しを2つの言語で2度言うだけだった
    expect(html).toContain('<div class="head"><h1>Team</h1></div>')
    expect(html).not.toContain('<span class="note">')
    // 複数いる前提の器に1人しか入っていないことを、自分で数えて告知していた
    expect(html).not.toContain('2 members')
  })

  it('名乗りは入口の1画面だけ。めくった先には載せない', async () => {
    await seedMember()
    await seedItem()

    // 同じサイトの名乗りが画面の数だけ並ぶと、どれが本体か決められない
    expect(await (await get('/')).text()).toContain('application/ld+json')
    expect(await (await get('/projects')).text()).not.toContain('application/ld+json')
    /*
      1人のサイトの個人ページは、サイトの連なりの途中（Team の位置）。
      入口と同じ人をもう一度名乗らない
    */
    expect(await (await get('/members/okazaki')).text()).not.toContain('application/ld+json')
    expect(await (await get('/members/okazaki/about')).text()).not.toContain('application/ld+json')

    // 2人以上のサイトの個人ページは、Team から入る脇の連なり。その先頭で名乗る
    await seedMember({ slug: 'hoshino', name: '星野' })
    expect(await (await get('/members/okazaki')).text()).toContain('application/ld+json')
    expect(await (await get('/members/okazaki/about')).text()).not.toContain('application/ld+json')
  })

  it('個人ページは、1人のあいだ worksFor を名乗らない', async () => {
    await seedMember()
    /*
      Team を置かない1人のサイト。個人ページは単独の連なりで、その先頭で
      Person を名乗る（Team を置くと連なりの途中になり、名乗り自体を載せない）
    */
    await db()
      .insert(schema.blocks)
      .values([
        { type: 'hero' as const, published: 1, sortOrder: 10 },
        { type: 'contact' as const, published: 1, sortOrder: 20 },
      ])
    const solo = await (await get('/members/okazaki')).text()
    expect(solo).toContain('"@type":"Person"')
    // トップが同じ URL を Person として名乗っているので、
    // ここで同じ URL の Organization を書くと1つの URL が2つの型を持つ
    expect(solo).not.toContain('worksFor')

    await seedMember({ slug: 'hoshino', name: '星野' })
    expect(await (await get('/members/okazaki')).text()).toContain('worksFor')
  })

  it('ロゴの7点は1か所が正。配り先がずれたら落とす', async () => {
    /*
      三日月の点の列は3か所にある——src/ui/icons.tsx の MARK_POINTS（正）、
      Layout.tsx の favicon（data URI）、public/assets/noctifex-mark.svg。
      前の2つは MARK_POINTS から配るので自動でそろうが、**3つめは別ファイル**
      なので、ここで突き合わせる以外に一致を保つ手が無い。

      ずれても型は黙るし、画面も一見それらしく出る（形が少し違うだけ）。
    */
    const html = await (await get('/')).text()
    // favicon は data URI なので、点の列がそのまま入っている
    expect(html).toContain(MARK_POINTS)

    /*
      配っている素材の SVG も同じ列であること。

      **fetch では確かめられない。** workerd では public/ が配られず 404 に
      なるうえ、その 404 ページ自身がロゴを描いているので、
      `(await get('/assets/…')).text()` を見る書き方は素通りで緑になる
      （実際にそう書いて通ってしまった）。ファイルの中身は
      vitest.config.ts の assetPlugin が渡す。
    */
    expect(markSvg).toContain(MARK_POINTS)
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
    const home = await (await get('/')).text()
    // 1人：サイト自身がその人。url はサイトの origin
    expect(home).toContain(`"@type":"Person","name":"${solo.name}"`)
    expect(home).toContain('"url":"https://noctifex.dev"')
    expect(home).not.toContain('"url":"https://noctifex.dev/members/okazaki"')

    // 2人目が公開されると器に戻り、member[] の中では各自の URL を名乗る
    await seedMember({ slug: 'hoshino', name: '星野' })
    const org = await (await get('/')).text()
    expect(org).toContain('"@type":"Organization"')
    expect(org).toContain('"url":"https://noctifex.dev/members/okazaki"')
    expect(org).toContain('"url":"https://noctifex.dev/members/hoshino"')

    /*
      個人ページ：その人の URL。1人のサイトの個人ページは連なりの途中なので
      名乗り自体を載せない（上の「名乗りは入口の1画面だけ」）。見るのは2人以上のとき
    */
    const mine = await (await get('/members/okazaki')).text()
    expect(mine).toContain('"url":"https://noctifex.dev/members/okazaki"')
  })
})

/*
  入口（/）は、このサイトがいちばん仕事をする画面。名前・職種・数がここに
  無いと、最初の1画面から持ち帰れるものが何も無い。
*/
describe('入口の画面', () => {
  it('句読点の直後でだけ区切る。語の途中（「置いてお / く。」）では切らない', () => {
    expect(splitPhrases('つくったものを、置いておく。')).toEqual([
      'つくったものを、',
      '置いておく。',
    ])
    // 句読点が無ければ1つの塊のまま（英語は塊の中の空白で折れる）
    expect(splitPhrases('Noctifex')).toEqual(['Noctifex'])
    expect(splitPhrases('')).toEqual([''])
  })

  it('見出しは1人なら名前、肩書きを小さく添える。帯は同じ Hero の中に置く', async () => {
    await seedMember({ name: '岡崎 昂功', role: 'System Engineer' })
    await seedItem()

    const html = await (await get('/')).text()
    const hero = html.slice(html.indexOf('<header class="hero"'), html.indexOf('</header>'))
    // 標語は置かない。何も伝えないまま画面でいちばん大きな字になっていた
    expect(hero).not.toContain('つくったものを、置いておく。')
    expect(hero.match(/<h1>(.*?)<\/h1>/)?.[1]?.replace(/<[^>]+>/g, '')).toBe('岡崎 昂功')
    // 英字だけの肩書きには lang="en"（読み上げの発音と、等幅の札にする印）
    expect(hero).toContain('<p class="hero__role" lang="en">System Engineer</p>')
    for (const part of splitPhrases(SITE.heroLead)) {
      expect(hero).toContain(`>${part}</span>`)
    }
    /*
      画面の底に横いっぱいの帯を別の節として置いていたころは、見出しと帯の
      あいだに画面の半分ほどの空白ができていた
    */
    expect(hero).toContain('class="band"')
  })

  it('和文の肩書きには lang を付けない。等幅の札にしない', async () => {
    /*
      等幅は英字の札にだけ掛ける（app.css は .hero__role:lang(en)）。和文の
      肩書きに lang="en" を付けると、読み上げが英語の発音で読み、字も等幅の
      字間で組まれる
    */
    await seedMember({ role: 'システムエンジニア' })

    const html = await (await get('/')).text()
    expect(html).toContain('<p class="hero__role">システムエンジニア</p>')
  })

  it('公開中が2人以上なら、見出しはサイトの名前。肩書きは添えない', async () => {
    await seedMember()
    await seedMember({ slug: 'tanaka', name: '田中 未来', sortOrder: 20 })

    const html = await (await get('/')).text()
    const hero = html.slice(html.indexOf('<header class="hero"'), html.indexOf('</header>'))
    expect(hero.match(/<h1>(.*?)<\/h1>/)?.[1]?.replace(/<[^>]+>/g, '')).toBe(SITE.name)
    expect(hero).not.toContain('hero__role')
  })
})

/*
  柱の名乗り。入口では Hero の h1 が名乗るので柱は黙り、入口の外では柱が名乗る。

  柱に名前を置かないと決めていたころは、奥の画面（検索や貼られたリンクから
  直接着く /projects や /members/… ）を開いた人に、誰のサイトかがどこにも
  出ていなかった。入口だけは今も置かない——同じ名前が2度並ぶ。
*/
describe('入口の名乗り', () => {
  it('入口の柱は名前も職種も出さない。名乗るのは Hero の h1（2度並べない）', async () => {
    await seedMember({ name: '岡崎 昂功', role: 'System Engineer' })
    await seedItem()

    const top = await (await get('/')).text()
    expect(top.match(/<h1>(.*?)<\/h1>/)?.[1]?.replace(/<[^>]+>/g, '')).toBe('岡崎 昂功')

    const rail = railOf(top)
    expect(rail).not.toContain('identity__name')
    expect(rail).not.toContain('岡崎 昂功')
    // 肩書きも Hero の h1 の上に添えてある（.hero__role）
    expect(rail).not.toContain('identity__role')
    // 名乗らない画面ではワードマークを畳まない（帯に場所がある）
    expect(rail).toContain('<div class="identity">')
  })

  it('入口の外では、1人のサイトなら柱が名前と職種を名乗る', async () => {
    await seedMember({
      name: '岡崎 昂功',
      role: 'System Engineer',
      skillsText: 'C# | 3年以上',
      careerText: '2024.03 | 入社 | ある会社',
    })
    await seedItem({ slug: 'appmixer' })

    for (const path of [
      '/projects',
      '/members/okazaki',
      '/members/okazaki/about',
      '/members/okazaki/career',
      '/apps/item/appmixer',
      '/contact',
      '/all',
    ]) {
      const rail = railOf(await (await get(path)).text())
      // 名乗る画面の印。899 以下の帯では、これを目印にワードマークを畳む（app.css）
      expect(rail, path).toContain('<div class="identity identity--named">')
      expect(rail, path).toContain('<span class="identity__name">岡崎 昂功</span>')
      expect(rail, path).toContain('<span class="identity__role">System Engineer</span>')
    }
  })

  it('2人以上のサイトでは、柱に誰の名前も出さない', async () => {
    // 誰か1人の名前を柱に置くと、その人のサイトに見える
    await seedMember()
    await seedMember({ slug: 'hoshino', name: '星野', role: 'Designer' })
    await seedItem({ slug: 'appmixer' })

    for (const path of ['/', '/projects', '/team', '/members/okazaki', '/contact', '/all']) {
      const rail = railOf(await (await get(path)).text())
      expect(rail, path).toContain('<div class="identity">')
      expect(rail, path).not.toContain('identity__name')
      expect(rail, path).not.toContain('identity__role')
    }
  })

  it('Contact の画面では、柱に GitHub / メールを出さない。本文にボタンがある', async () => {
    await seedMember()

    const contact = await (await get('/contact')).text()
    expect(railOf(contact)).not.toContain('class="socials"')
    // 行き先は本文に残っている（同じ行き先を柱と本文に2組並べない）
    expect(mainOf(contact)).toContain(`href="${SITE.github}"`)
    expect(mainOf(contact)).toContain(`href="mailto:${SITE.email}"`)

    // ほかの画面の柱には今までどおり出る。全体ページの Contact は節の1つで、柱は全体のもの
    for (const path of ['/', '/all']) {
      expect(railOf(await (await get(path)).text()), path).toContain('class="socials"')
    }
  })

  it('題と説明にも名前と職種を入れる。共有リンクと検索結果が手ぶらになる', async () => {
    await seedMember({ name: '岡崎 昂功', role: 'System Engineer' })
    await seedItem()

    const html = await (await get('/')).text()
    expect(html).toContain('<title>岡崎 昂功（System Engineer） — Noctifex</title>')
    expect(html).toContain('content="岡崎 昂功（System Engineer）のポートフォリオ。')
  })

  it('入口に一覧への帯を置く。件数は絞り込みを見ない全体の数', async () => {
    await seedMember()
    await seedItem({ type: 'app', title: 'アプリ壱' })
    await seedItem({ type: 'app', title: 'アプリ弐' })
    await seedItem({ type: 'work', title: 'ある仕事' })

    const html = await (await get('/')).text()
    expect(html).toContain('class="band" href="/projects"')
    // 1つの一覧へ送るが、何がどれだけあるかは区分ごとに数えて見せる
    expect(html).toContain('個人開発 2 · 業務 1')
  })

  it('項目の無い区分は帯で数えない', async () => {
    await seedMember()
    await seedItem({ type: 'work' })

    const html = await (await get('/')).text()
    expect(html).toContain('class="band" href="/projects"')
    expect(html).toContain('<span class="band__meta">業務 1</span>')
  })

  it('帯の件数は絞り込みを見ない。入口が見せるのはサイト全体の数', async () => {
    const member = await seedMember()
    await seedMember({ slug: 'hoshino', name: '星野' })
    await seedItem({ type: 'app', memberId: member.id })
    await seedItem({ type: 'work', memberId: member.id })
    await seedItem({ type: 'work', title: 'よその仕事' })

    // 入口で見せたいのは「ここに何件あるか」で、「いま絞り込んだ結果が何件か」ではない
    const html = await (await get(`/?member=${member.slug}`)).text()
    expect(html).toContain('個人開発 1 · 業務 2')
  })

  it('全体ページに帯は置かない。一覧がすぐ下に並ぶので送り出す先が無い', async () => {
    await seedMember()
    await seedItem()

    expect(await (await get('/all')).text()).not.toContain('class="band"')
  })

  it('帯の題は「つくったもの」。右端の「一覧で見る」と「一覧」を重ねない', async () => {
    await seedMember()
    await seedItem()

    const band = mainOf(await (await get('/')).text())
    expect(band).toContain('<strong>つくったもの</strong>')
    // 「つくったものの一覧」のころは、1枚の札の中で「一覧」が2度出ていた
    expect(band).not.toContain('つくったものの一覧')
    expect(band).toContain('一覧で見る')
  })
})

/*
  入口のページャ。帯（一覧へ送る札）とページャの「次」が同じ行き先なら、
  入口にはページャを出さない——同じ /projects へのリンクが画面の中ほどと
  底に2つ並んでいた。行き先が違えば両方出す。
*/
describe('入口のページャ', () => {
  const pagerOf = (html: string) => html.split('<nav class="pager"')[1]?.split('</nav>')[0] ?? null

  it('帯の行き先が「次」と同じなら、入口にページャを出さない', async () => {
    await seedMember()
    await seedItem()

    const html = await (await get('/')).text()
    expect(html).toContain('class="band" href="/projects"')
    expect(pagerOf(html)).toBeNull()
    // めくる先の画面では今までどおり出る。「前」は入口へ
    expect(pagerOf(await (await get('/projects')).text())).toContain('href="/" rel="prev"')
  })

  it('入口と一覧のあいだに画面を置けば、ページャは次の画面へ、帯は一覧へ。両方出す', async () => {
    await seedMember()
    await seedItem()
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
        { type: 'projects' as const, published: 1, sortOrder: 30 },
      ])
      .returning()
    const statement = rows[1]
    if (!statement) throw new Error('ブロックを置けなかった')

    const html = await (await get('/')).text()
    expect(html).toContain('class="band" href="/projects"')
    expect(pagerOf(html)).toContain(`href="/block-${statement.id}" rel="next"`)
  })

  it('一覧が無いサイト（帯が無い）の入口には、今までどおりページャを出す', async () => {
    await seedMember()

    const html = await (await get('/')).text()
    expect(html).not.toContain('class="band"')
    expect(pagerOf(html)).toContain('rel="next"')
  })
})

/*
  全体ページ（/all）への道。柱の足元の1本は 899 以下の帯で畳まれるので、
  入口の本文にも1本置く。/all 自身には置かない（自分への行き先）。
*/
describe('全体ページへの道', () => {
  it('入口の帯の下に「すべてを1ページで読む →」を置く', async () => {
    await seedMember()
    await seedItem()

    const html = await (await get('/')).text()
    const hero = html.slice(html.indexOf('<header class="hero"'), html.indexOf('</header>'))
    expect(hero).toContain(
      '<a class="hero__whole" href="/all">すべてを1ページで読む <span aria-hidden="true">→</span></a>',
    )
    // 帯のすぐ下（帯より後ろ）
    expect(hero.indexOf('class="band"')).toBeLessThan(hero.indexOf('class="hero__whole"'))
  })

  it('一覧が無く帯の出ない入口にも置く。全体ページと、ほかの画面には置かない', async () => {
    await seedMember()
    expect(mainOf(await (await get('/')).text())).toContain('class="hero__whole"')

    await seedItem()
    for (const path of ['/all', '/projects', '/members/okazaki', '/contact']) {
      expect(mainOf(await (await get(path)).text()), path).not.toContain('hero__whole')
    }
  })

  it('柱の足元は著作権表示を箱に包む。中央寄せの上の帯ではそこだけを畳む', async () => {
    const html = await (await get('/')).text()
    const footer = html.slice(html.indexOf('<footer class="rail__footer">'))
    // 区切りの「 · 」も同じ箱。畳んだとき区切りだけが行の頭に残らない
    expect(footer).toMatch(
      /^<footer class="rail__footer"><span class="rail__copy">© \d{4} Noctifex · <\/span><a href="\/all">/,
    )

    // 全体ページには自分への行き先が無いので、区切りも無い
    const whole = await (await get('/all')).text()
    expect(whole).toMatch(
      /<footer class="rail__footer"><span class="rail__copy">© \d{4} Noctifex<\/span><\/footer>/,
    )
  })
})

/*
  画面ごとに URL を分けた以上、1画面 = 1ドキュメント。見出しはその画面の
  中で完結していなければならない（WCAG 1.3.1）。縦に積んだ全体ページ
  （/all）だけは今までどおり、Hero の h1 に節が h2 でぶら下がる。
*/
describe('画面ごとの見出し', () => {
  const h1s = (html: string) => html.match(/<h1[^>]*>/g) ?? []

  it('割られた画面は、どれも h1 をちょうど1つ持つ', async () => {
    await seedMember({ skillsText: 'C# | 3年以上', careerText: '2024.03 | 入社 | ある会社' })
    await seedItem({ type: 'app' })
    await seedItem({ type: 'work' })

    // 1人のサイトなので /team は無い（プロフィールへ 301）。Team の画面は下で2人にして見る
    for (const path of [
      '/',
      '/projects',
      '/contact',
      '/members/okazaki',
      '/members/okazaki/about',
      '/members/okazaki/skills',
      '/members/okazaki/career',
    ]) {
      expect(h1s(await (await get(path)).text()), path).toHaveLength(1)
    }

    await seedMember({ slug: 'hoshino', name: '星野' })
    expect(h1s(await (await get('/team')).text())).toHaveLength(1)
  })

  it('節の見出しが h1 に上がる。/all では h2 のまま', async () => {
    await seedItem({ type: 'app' })

    expect(await (await get('/projects')).text()).toContain('<h1>Projects</h1>')
    // 1つの文書に節が並ぶページでは、h1 は Hero の1つだけ
    const whole = await (await get('/all')).text()
    expect(whole).toContain('<h2>Projects</h2>')
    expect(h1s(whole)).toHaveLength(1)
  })

  it('一文だけの画面では、その一文が h1。/all では段落のまま', async () => {
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

    // 見出しを持たない画面をひとつも残さない。ここは大きな一文が見出しそのもの
    const screen = await (await get(`/block-${statement.id}`)).text()
    expect(screen).toContain('<h1 class="statement__text">つくる速さは、設計で決まる。</h1>')

    const whole = await (await get('/all')).text()
    expect(whole).toContain('<p class="statement__text">つくる速さは、設計で決まる。</p>')
    expect(h1s(whole)).toHaveLength(1)
  })

  it('見出しに訳語だけの添えを置かない（About / Skills / Career）', async () => {
    /*
      「紹介」「技術」「経歴」は見出しの訳語でしかなく、同じ見出しを2つの言語で
      2度言っていた。添えは見出しに無い情報（区分・年）のときだけ置く
    */
    await seedMember({ skillsText: 'C# | 3年以上', careerText: '2024.03 | 入社 | ある会社' })

    for (const [path, title] of [
      ['/members/okazaki/about', 'About'],
      ['/members/okazaki/skills', 'Skills'],
      ['/members/okazaki/career', 'Career'],
    ] as const) {
      const html = await (await get(path)).text()
      expect(html, path).toContain(`<div class="head"><h1>${title}</h1></div>`)
      expect(html, path).not.toContain('<span class="note">')
    }
  })

  it('Projects の添えは、区分のピルが無いときだけ。そのときは区分の名前', async () => {
    // 区分が2つ: すぐ下のピル（すべて / 個人開発 / 業務）が同じ言葉を並べるので添えない
    await seedItem({ type: 'app' })
    await seedItem({ type: 'work', title: '業務の実績' })
    const both = await (await get('/projects')).text()
    expect(both).toContain('<div class="head"><h1>Projects</h1></div>')
    expect(both).toContain('href="/projects?kind=work"')

    // 区分が1つ: ピルが並ばないので、何の一覧かを言うのは添えだけ
    await db().delete(schema.items).where(eq(schema.items.type, 'work'))
    const only = await (await get('/projects')).text()
    expect(only).toContain(
      '<div class="head"><h1>Projects</h1><span class="note">個人開発</span></div>',
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
    const html = await (await get('/works/item/dev')).text()
    expect(html).toContain('<span class="note">金融系 · 2024 — 現在</span>')
  })

  it('個人ページの h1 は本文側。大見出しがあればそれ、無ければ名札の名前', async () => {
    await seedMember({ headline: 'つくる工程そのものを、速くする。' })

    const html = await (await get('/members/okazaki')).text()
    // 顔と名前は本文の名札に出る。大見出しのある人では、名前は見出しではない
    expect(html).toContain('<strong class="nameplate__name">岡崎 昂功</strong>')
    // 見出しは句読点で塊に分けてある（Phrases）。読める文字列としては1文のまま
    const h1 = html.match(/<h1 class="hero__headline">(.*?)<\/h1>/)?.[1] ?? ''
    expect(h1.replace(/<[^>]+>/g, '')).toBe('つくる工程そのものを、速くする。')
    expect(h1s(html)).toHaveLength(1)

    // 2枚目以降も、その画面自身の見出しが h1
    expect(await (await get('/members/okazaki/about')).text()).toContain('<h1>About</h1>')
  })
})

describe('技術の小見出しと、英語の塊', () => {
  it('小見出しは段落ではなく見出し。節見出しが h1 なので h2', async () => {
    await seedMember({ skillsText: 'LANGUAGES:\nC# | 3年以上' })

    const html = await (await get('/members/okazaki/skills')).text()
    expect(html).toContain('class="side-head"')
    expect(html).not.toContain('<p class="side-head"')
    expect(html).toContain('<h1>Skills</h1>')
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

    const html = mainOf(await (await get('/members/okazaki/skills')).text())
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
    const whole = mainOf(await (await get('/all')).text())
    expect(whole.match(/3年以上/g)).toHaveLength(1)
    expect(whole).toContain('<dt class="skill-row__note">3年以上</dt>')
  })

  it('日本語の中の英語の塊に lang="en"。日本語の見出しには付けない', async () => {
    await seedMember({ skillsText: 'LANGUAGES:\nC#\n\n言語:\nSQL' })

    const html = await (await get('/members/okazaki/skills')).text()
    // 印が無いと、日本語の音声エンジンがローマ字読みするか読み飛ばす
    expect(html).toContain('<h2 class="side-head" lang="en">LANGUAGES</h2>')
    // 打ち込んだ見出しなので、日本語のものに付けると今度はそちらが読めなくなる
    expect(html).toContain('<h2 class="side-head">言語</h2>')
  })

  it('タグは英字だけの札にだけ lang="en"。和文のタグ（生成AI）には付けない', async () => {
    /*
      等幅は英字の札にだけ掛ける（app.css の .tags li:lang(en)）。和文のタグに
      印を付けると、読み上げが英語の発音で読み、字も等幅の字間で組まれる。
      カードと作品のページは同じ Tags を使う
    */
    const item = await seedItem({ slug: 'dev', type: 'work' })
    await db()
      .insert(schema.itemTags)
      .values([
        { itemId: item.id, tag: 'C#', sortOrder: 0 },
        { itemId: item.id, tag: '生成AI', sortOrder: 1 },
      ])

    for (const path of ['/projects', '/works/item/dev']) {
      const html = mainOf(await (await get(path)).text())
      expect(html, path).toContain('<ul class="tags"><li lang="en">C#</li><li>生成AI</li></ul>')
    }
  })

  it('Team のカードの押す手は日本語（プロフィール →）。英語の印は要らない', async () => {
    /*
      操作の言葉は日本語、英語で書くのは節の名前だけ（CLAUDE.md「文言」）。
      「Profile →」のころは lang="en" で読み上げを直していたが、同じ画面の
      「一覧で見る →」「メールを送る →」と押す手の言葉だけ言語が違っていた
    */
    await seedMember()
    await seedMember({ slug: 'hoshino', name: '星野' })
    const html = await (await get('/team')).text()
    expect(html).toContain('<span class="member__go">プロフィール →</span>')
    expect(html).not.toContain('Profile →')
  })
})

/*
  柱の GitHub は 899 以下で畳んである（横帯に入らない）。畳んだぶんが
  どこにも無くならないよう、Contact の画面に常設する。
*/
describe('連絡先の行き先', () => {
  it('Contact の画面に GitHub のプロフィールがある', async () => {
    await seedMember()

    for (const path of ['/contact']) {
      const main = mainOf(await (await get(path)).text())
      expect(main, path).toContain('href="https://github.com/iam74k4"')
      // メールは大きなピルにある。同じ行き先を2つ置かない
      expect(main.match(/mailto:/g) ?? [], path).toHaveLength(1)
    }
  })

  it('アドレスの字は全体ページにだけ置く。紙の上ではボタンの行き先が読めない', async () => {
    await seedMember()

    const screen = mainOf(await (await get('/contact')).text())
    expect(screen).toMatch(/<a class="pill-cta" href="mailto:[^"]+">[\s\S]*?メールを送る/)
    expect(screen).not.toContain('contact__address')

    const whole = await (await get('/all')).text()
    const contact = whole.slice(whole.indexOf('<section id="contact"'))
    expect(contact).toContain(`<p class="contact__address">${SITE.email}</p>`)
  })
})

describe('締めの画面（Contact）', () => {
  it('入口と対になる月を敷き、節を月の受け皿にする', async () => {
    await seedMember()

    const main = mainOf(await (await get('/contact')).text())
    expect(main).toContain('<section id="contact" class="moonlit"')
    expect(main).toContain('<div class="moon moon--closing" aria-hidden="true">')
  })

  it('画面に出すのは誘いの1文とボタン2つ。見出しは読み上げのためにだけ置く', async () => {
    /*
      字を1つも置かなかったころは、ボタンが2つあるだけで、何の相談なら
      送ってよいのかを言う言葉が画面のどこにも無かった（description にしか
      無かった）。置くのはその1文だけで、見出しとアドレスは描かない。
      割られた画面は h1 をちょうど1つ持つ決まり（WCAG 1.3.1）なので、
      見出しは .sr-only で残す
    */
    await seedMember()

    const main = mainOf(await (await get('/contact')).text())
    const contact = main.slice(main.indexOf('<div class="contact">'))
    expect(contact.match(/<h1[^>]*>/g)).toEqual(['<h1 class="sr-only">'])
    expect(contact).toContain('<h1 class="sr-only">Contact</h1>')
    // 画面に出る p はリードの1つだけ（札・アドレスは置かない）
    expect(contact.match(/<p\b[^>]*>/g)).toEqual(['<p class="contact__lead">'])
    // 句読点までの塊に分けてある（Phrases）。読める文字列としては site.ts の1文のまま
    const lead = contact.match(/<p class="contact__lead">(.*?)<\/p>/)?.[1] ?? ''
    expect(lead.replace(/<[^>]+>/g, '')).toBe(SITE.contactLead)
    // リードはボタンの上（読んでから押す）
    expect(contact.indexOf('contact__lead')).toBeLessThan(contact.indexOf('contact__actions'))
    expect(main).toContain('aria-label="Contact"')
  })

  it('全体ページの Contact にも同じ誘いの1文を置く', async () => {
    await seedMember()

    const whole = await (await get('/all')).text()
    const contact = whole.slice(whole.indexOf('<section id="contact"'))
    const lead = contact.match(/<p class="contact__lead">(.*?)<\/p>/)?.[1] ?? ''
    expect(lead.replace(/<[^>]+>/g, '')).toBe(SITE.contactLead)
  })

  it('全体ページでは、ほかの節と同じ見出しを目に見える形で置く', async () => {
    await seedMember()

    const whole = await (await get('/all')).text()
    const contact = whole.slice(whole.indexOf('<section id="contact"'))
    expect(contact).toContain('<div class="head"><h2>Contact</h2></div>')
    expect(contact).not.toContain('sr-only')
  })

  it('全体ページには月を敷かない', async () => {
    // 全体ページは印刷・Ctrl-F・翻訳の宛先。紙に淡い装飾を刷らせない
    await seedMember()

    const html = await (await get('/all')).text()
    const contact = html.slice(html.indexOf('<section id="contact"'))
    expect(contact).toContain('<section id="contact"')
    expect(contact).not.toContain('moon--closing')
    expect(contact).not.toMatch(/<section id="contact" class="moonlit"/)
  })
})

/*
  1画面に入らないぶんは次の URL へ送る。何件で割るかは src/blocks.ts の
  perScreen（Apps / Works は2件）が正。
*/
describe('画面を割る', () => {
  it('1画面目へ寄せる 303 は、外のサイトへは飛ばさない', async () => {
    /*
      Location を「パスの一部」から組み立てているので、そこに // や /\ が
      入ると、ブラウザがプロトコル相対の外部 URL として解決する。
      実際に /%2F%2Fevil.com/1 が 303 Location: ///evil.com を返し、
      curl が evil.com まで着弾した。無い URL なので 404 が正しい。
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
    for (const path of ['/ab%0d%0aX/1', '/ab%0aX/1', '/members/a%0d%0aX/about/1']) {
      expect((await get(path)).status, path).toBe(404)
    }
  })

  it('最後の画面の次は無い。1画面目の URL は1つに寄せる', async () => {
    await seedItem({ type: 'app', title: 'アプリ壱' })
    await seedItem({ type: 'app', title: 'アプリ弐' })
    await seedItem({ type: 'app', title: 'アプリ参' })

    const first = await (await get('/projects')).text()
    expect(first).toContain('アプリ壱')
    expect(first).not.toContain('アプリ参')
    expect(await (await get('/projects/2')).text()).toContain('アプリ参')

    // 2画面で終わり。3画面目を指す URL は無い
    expect((await get('/projects/3')).status).toBe(404)

    // /projects と /projects/1 が並ぶと、同じ画面が2つの URL で数えられる
    const one = await get('/projects/1')
    expect(one.status).toBe(303)
    expect(one.headers.get('location')).toBe('/projects')

    // 寄せるときに絞り込みを落とさない
    const filtered = await get('/projects/1?kind=app')
    expect(filtered.headers.get('location')).toBe('/projects?kind=app')
  })

  it('Apps と Works の一覧の URL は、同じ区分で絞った Projects へ寄せる', async () => {
    /*
      2つの節を Projects の1つにまとめた。貼られた一覧の URL を死なせない。
      ページ数は引き継がない（区分を混ぜて並べ直したので、同じ番号に同じ
      カードは居ない）。メンバーの絞り込みは引き継ぐ
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

  it('目次の印は、いま見ている画面にだけ付く', async () => {
    await seedMember()
    await seedItem({ type: 'app' })

    const html = await (await get('/projects')).text()
    expect(html).toContain('href="/projects" aria-current="page"')
    // 1人のサイトなので、Team の位置はプロフィール（目次の名前は Profile）
    expect(tocOf(html)).toContain('<a href="/members/okazaki">Profile</a>')
    // 2つ付くと、どちらが「いま」なのか読み上げでも見た目でも決まらない
    expect(html.match(/aria-current="page"/g)).toHaveLength(1)
  })

  it('入口の月は、入口の画面にだけ出る', async () => {
    await seedMember()
    await seedItem({ type: 'app' })

    // 入口。装飾なので読み上げには流さない
    const home = await (await get('/')).text()
    expect(home).toContain('<div class="moon" aria-hidden="true">')
    /*
      絵は <img> では貼らない。CSS が --accent から色を敷いて、素材を mask として
      抜く（app.css の .moon__mark::after）。こうしてあるので、
      **見た目プリセットで三日月そのものの色も変わる**。

      マークアップに出てくるのは空の span 1つだけ。形式の選択（AVIF / WebP）も
      CSS の image-set が持つので、ここでも JavaScript は要らない。
    */
    expect(home).toContain('<span class="moon__mark">')
    expect(home).not.toContain('/assets/moon.webp')
    expect(home).not.toContain('<picture>')

    /*
      全体ページには出さない。あそこは印刷と Ctrl-F と翻訳の宛先で、
      縦に伸びる唯一の公開 URL。淡い装飾を紙に刷らせない。
    */
    expect(await (await get('/all')).text()).not.toContain('class="moon"')

    /*
      個人ページにも出さない。Hero 部品も .hero クラスも名乗りと共有して
      いるので、月を Hero 側に埋めた瞬間にメンバー全員のページに出る。
      この検査だけがその漏れを見張っている。
    */
    expect(await (await get('/members/okazaki')).text()).not.toContain('class="moon"')
  })

  it('目次の名乗りは、行き先がページ内か別画面かで変わる', async () => {
    await seedMember()
    await seedItem({ type: 'app' })

    // 画面ごとの URL では別ページへ移る
    expect(await (await get('/projects')).text()).toContain('aria-label="画面の移動"')
    // 全体ページの目次だけが本当に #projects を指している
    expect(await (await get('/all')).text()).toContain('aria-label="ページ内の移動"')
  })

  it('Team の形は総人数で決まる。画面を割っても変わらない', async () => {
    // 1画面6人。7人目だけが2画面目に残る
    for (let i = 1; i <= 7; i++) await seedMember({ slug: `m${i}`, name: `メンバー${i}` })

    const second = await (await get('/team/2')).text()
    expect(second).toContain('メンバー7')
    // この画面は1人だが、横長には化けない（めくるたびに形が変わってしまう）
    expect(second).toContain('member--compact')
    expect(second).not.toContain('member--wide')
  })
})

/*
  絞り込みはサーバーが持つ。ピルは URL へのリンクで、押した先はそのブロックの
  1画面目。公開ページに JavaScript は無いので、絞り込みは画面をまたいで効く。
*/
describe('絞り込み', () => {
  it('区分で絞ると、その区分の項目だけになる', async () => {
    await seedItem({ type: 'app', title: '個人のアプリ' })
    await seedItem({ type: 'work', title: 'ある仕事' })

    const html = await (await get('/projects?kind=work')).text()
    expect(html).toContain('ある仕事')
    expect(html).not.toContain('個人のアプリ')
    // 押したピルに印が付く。もう一度押すと外れるので、行き先は絞り込み無しの URL
    expect(html).toContain('<a href="/projects" aria-current="true">業務</a>')
  })

  it('ピルに並ばない区分では絞らない。「すべて」に印を付けたまま全件を出す', async () => {
    // 個人開発しか無いサイト。業務のピルは無いので、効かせると外す手が無くなる
    await seedItem({ type: 'app', title: '個人のアプリ' })

    for (const path of ['/projects?kind=work', '/projects?kind=nope']) {
      const html = await (await get(path)).text()
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

    const mine = await (await get(`/projects?member=${member.slug}`)).text()
    expect(mine).toContain('この人のアプリ')
    expect(mine).toContain('この人の仕事')
    expect(mine).not.toContain('よその人のアプリ')
    expect(mine).not.toContain('よその人の仕事')

    // 2つの軸は重ねて効く
    const both = await (await get(`/projects?kind=work&member=${member.slug}`)).text()
    expect(both).toContain('この人の仕事')
    expect(both).not.toContain('この人のアプリ')
  })

  it('件数は、絞り込みの有無で取り違えない', async () => {
    /*
      件数は2つある——絞り込みを見ない total（節を出すかどうか・入口の帯）と、
      絞り込んだあとの matched（説明文と画面の枚数）。

      絞り込みが付かないときは同じ数なので、**片方をもう片方に取り違えても
      画面は正しく見える**。取り違いが出るのは絞り込んだときだけ。
    */
    const member = await seedMember()
    const other = await seedMember({ slug: 'hoshino', name: '星野' })
    await seedItem({ type: 'work', title: 'この人の仕事', memberId: member.id })
    await seedItem({ type: 'work', title: 'よその人の仕事', memberId: other.id })

    // 絞り込み無し: 2件
    expect(await (await get('/projects')).text()).toContain('つくったもの 2 件')

    // 画面の枚数は絞り込んだあとの数で決まる。その人で絞ると1件＝1画面
    const mine = await (await get(`/projects?member=${member.slug}`)).text()
    expect(mine).toContain('この人の仕事')
    expect(mine).not.toContain('class="pager__of"')

    // 入口の帯は絞り込みを見ないので、絞ったあとも 2 のまま
    expect(await (await get(`/?member=${member.slug}`)).text()).toContain('業務 2')
  })

  it('絞り込みは、めくっても外れない。一覧の無い画面には付けて回らない', async () => {
    const member = await seedMember()
    // 名前のピルは2人以上いるときだけ並ぶ。1人のサイトでは ?member= を読まない
    await seedMember({ slug: 'tanaka', name: '田中 未来', sortOrder: 20 })
    await seedItem({ type: 'app', title: 'アプリ壱', memberId: member.id })
    await seedItem({ type: 'app', title: 'アプリ弐', memberId: member.id })
    await seedItem({ type: 'app', title: 'アプリ参', memberId: member.id })
    await seedItem({ type: 'work', title: 'ある仕事', memberId: member.id })

    const html = await (await get(`/projects?kind=app&member=${member.slug}`)).text()
    // めくる先にも同じ絞り込みが付く。付けないと、移った先で静かに外れる
    expect(html).toContain('href="/projects/2?kind=app&amp;member=okazaki"')
    // 一覧を持たない画面（Team）には付けない。中身が変わらないのに URL だけ増える
    expect(html).toContain('href="/team"')
    expect(html).not.toContain('/team?')
  })

  it('絞り込んで0件でも、ピルを残して1行だけ出す', async () => {
    const member = await seedMember()
    await seedMember({ slug: 'tanaka', name: '田中 未来', sortOrder: 20 })
    await seedItem({ type: 'app', title: 'この人のアプリ', memberId: member.id })
    await seedItem({ type: 'work', title: 'よその仕事' })

    // この人の業務は1件も無い。ここで節ごと消すと、絞り込みを外す手が画面から消える
    const response = await get(`/projects?kind=work&member=${member.slug}`)
    expect(response.status).toBe(200)

    const html = await response.text()
    expect(html).toContain('この条件に当てはまるものはまだありません')
    expect(html).toContain('href="/projects">すべて</a>')
    expect(html).not.toContain('この人のアプリ')
  })

  it('公開ページは JavaScript を1本も読み込まない', async () => {
    await seedMember()
    await seedItem({ platformKey: 'web' })

    for (const path of ['/', '/projects', '/all']) {
      const html = await (await get(path)).text()
      expect(html).not.toContain('<script src')
      expect(html).not.toContain('filter.js')
    }
  })
})

/*
  作品1件の恒久リンク。

  一覧の URL（/apps/3）は「いまの並びの3枚目」でしかない。並べ替え・公開の
  切り替え・追加のたびに、200 のまま別の作品を指す——404 なら気づけるが、
  これは誰にも気づかれない。ここで押さえるのは2つ：slug で名指しした URL は
  何を足しても外しても同じ作品を指し続けること、そしてその画面が
  「1画面 = 1ドキュメント」の作法（h1 ちょうど1つ・弁の tabindex・自分を指す
  canonical）に従うこと。
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

  it('並べ替えても同じ URL が同じ作品を指す（一覧の URL は指す先が変わる）', async () => {
    await seedItem({ title: '一番目', slug: 'ichi', sortOrder: 10 })
    await seedItem({ title: '二番目', slug: 'ni', sortOrder: 20 })
    await seedItem({ title: '三番目', slug: 'san', sortOrder: 30 })

    // 1画面2件。いま3枚目の「三番目」は2画面目に居る
    expect(mainOf(await (await get('/projects/2')).text())).toContain('三番目')

    // 並べ替える（管理画面の「並び順」を変えたのと同じこと）
    await db().update(schema.items).set({ sortOrder: 5 }).where(eq(schema.items.slug, 'san'))

    // 一覧の URL は 200 のまま、別の作品を指すようになった
    expect(mainOf(await (await get('/projects/2')).text())).not.toContain('三番目')
    // 恒久リンクは動かない。これがこの列の全部の理由
    expect(mainOf(await (await get('/apps/item/san')).text())).toContain('三番目')
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

  it('一覧のカードの題から行ける。slug の無い作品はリンクにしない', async () => {
    await seedItem({ title: 'AppMixer', slug: 'appmixer' })
    await seedItem({ title: 'まだ無いほう', sortOrder: 20 })

    const html = mainOf(await (await get('/projects')).text())
    /*
      一覧は1つにまとめたが、恒久リンクは区分の語（/apps/item/…）のまま。貼られた
      URL を変えない。class はカードの面を押せるようにする覆い（app.css の
      .card__link::after）の付け先
    */
    expect(html).toContain('<h3><a class="card__link" href="/apps/item/appmixer">AppMixer</a></h3>')
    // 当てにならない URL を出すくらいなら、リンクそのものを出さない。覆いも付かない
    expect(html).toContain('<h3>まだ無いほう</h3>')
    expect(html.match(/class="card__link"/g) ?? []).toHaveLength(1)
  })

  it('カードは面ごと押せる。リンクは題の1本のままで、入れ子にしない', async () => {
    /*
      カードを <a> で包むと、中の Repository と担当者名が入れ子の <a> になる
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

    const html = mainOf(await (await get('/projects')).text())
    const card = html.slice(html.indexOf('<article class="card">'), html.indexOf('</article>'))
    expect(card).not.toBe('')
    expect(card).not.toContain('<a class="card"')
    // 題のリンクは題だけを包む。その中にほかのリンクは入らない
    const title = card.slice(card.indexOf('<a class="card__link"'), card.indexOf('</a>') + 4)
    expect(title).toBe('<a class="card__link" href="/apps/item/appmixer">AppMixer</a>')
    // ほかの行き先は、覆いの上に出る別のリンクとして残る
    expect(card).toContain('class="card__member" href="/members/okazaki"')
    expect(card).toContain('href="https://example.test/r"')
  })

  it('画像のある作品のカードにはサムネイル。飾りなので名前を持たず、遅延読み込み', async () => {
    await seedItem({
      title: 'AppMixer',
      slug: 'appmixer',
      imageUrl: '/images/items/appmixer-ab12.png',
      imageAlt: '音量ミキサーの画面',
    })

    const card = mainOf(await (await get('/projects')).text())
    /*
      名前は題のリンクが持つ（2つ目の名前を付けると、読み上げが作品を2度名乗る）。
      遅延読み込みは 600 未満で畳んだ画面で取りに行かせないため（app.css の
      .card__thumb。display: none の <img> は、ふつうは隠れていても取得される）
    */
    expect(card).toContain(
      '<span class="card__thumb" aria-hidden="true"><img src="/images/items/appmixer-ab12.png" alt="" loading="lazy" decoding="async"/></span>',
    )
    // 代替テキストは作品のページのもの。カードには出さない
    expect(card).not.toContain('音量ミキサーの画面')
  })

  it('同じ行に画像の有る無しが混ざったら、無いほうにも空の枠。行に1枚も無ければ枠は無い', async () => {
    const per = blockPerScreen('projects')
    // 1画面目: 1枚目だけ画像あり。2画面目: どれも画像なし
    await seedItem({
      title: '画像あり',
      slug: 'with-shot',
      sortOrder: 10,
      imageUrl: '/images/items/a.png',
      imageAlt: '画面',
    })
    for (let at = 1; at < per * 2; at += 1) {
      await seedItem({ title: `画像なし${at}`, slug: `no-shot-${at}`, sortOrder: (at + 1) * 10 })
    }

    const first = mainOf(await (await get('/projects')).text())
    // 行のカードは全部が枠を持ち、画像を持つのは1枚だけ
    expect(first.match(/class="card__thumb"/g) ?? []).toHaveLength(per)
    expect(
      first.match(/<span class="card__thumb" aria-hidden="true"><\/span>/g) ?? [],
    ).toHaveLength(per - 1)

    // 揃える相手の居ない行に空の枠を並べると、読み込みに失敗した一覧に見える
    expect(mainOf(await (await get('/projects/2')).text())).not.toContain('card__thumb')

    // 全体ページ（/all）も同じ grid を perScreen 件ずつの行で数える
    const whole = mainOf(await (await get('/all')).text())
    expect(whole.match(/class="card__thumb"/g) ?? []).toHaveLength(per)
  })

  it('1画面 = 1ドキュメントの作法に従う。作品が1件だけならページャは出ない', async () => {
    await seedItem({ title: 'AppMixer', slug: 'appmixer' })

    const html = await (await get('/apps/item/appmixer')).text()
    expect(html.match(/<h1[^>]*>/g) ?? []).toHaveLength(1)
    // 弁（overflow: auto）を開いたときに中身へ行けること
    expect(mainOf(html)).toContain('tabindex="0"')
    // めくる先の無い1枚に、通し番号もページャも出さない
    expect(html).not.toContain('class="pager"')
  })

  it('目次はサイトの画面のまま。印はその作品が載っている一覧に付く', async () => {
    await seedMember()
    await seedItem({ type: 'app', title: 'AppMixer', slug: 'appmixer' })
    await seedItem({ type: 'work', title: 'ある仕事', slug: 'shigoto' })

    const toc = tocOf(await (await get('/apps/item/appmixer')).text())
    // ここから戻る道は目次しか無いので、トップと同じ行き先を同じ順で出す
    expect(toc).toContain('href="/projects" aria-current="page"')
    expect(toc).toContain('<a href="/members/okazaki">Profile</a>')
    // 業務の作品も同じ一覧（Projects）に印が付く
    expect(tocOf(await (await get('/works/item/shigoto')).text())).toContain(
      'href="/projects" aria-current="page"',
    )
    // 自分の1枚は目次に並ばない（めくって着く先ではない）
    expect(toc).not.toContain('/apps/item/appmixer')
  })

  it('担当は複数人のときだけ出す。カードの showMember と同じ条件', async () => {
    const member = await seedMember({ slug: 'okazaki', name: '岡崎 昂功' })
    await seedItem({ title: 'AppMixer', slug: 'appmixer', memberId: member.id })

    // 1人のサイトでは、どの作品も同じ人のもの。名前を添える意味が無い
    expect(mainOf(await (await get('/apps/item/appmixer')).text())).not.toContain(
      'href="/members/okazaki"',
    )

    await seedMember({ slug: 'futari', name: 'もう一人' })
    const main = mainOf(await (await get('/apps/item/appmixer')).text())
    expect(main).toContain('href="/members/okazaki"')
    expect(main).toContain('担当')
  })

  it('説明文はカードの2行止めに掛からない形で出す', async () => {
    await seedItem({ title: 'AppMixer', slug: 'appmixer', summary: '音を配る常駐アプリ。' })

    // .card p は --card-lines で2行に切られる。この画面は作品1件のためにある
    const main = mainOf(await (await get('/apps/item/appmixer')).text())
    expect(main).toContain('<div class="bio">')
    expect(main).not.toContain('class="card"')
  })

  it('画像と本文があれば、画像は代替テキストつきの figure、本文は説明に続く段落で出る', async () => {
    await seedItem({
      title: 'AppMixer',
      slug: 'appmixer',
      summary: '音を配る常駐アプリ。',
      body: '背景の段落。\n\n結果の段落。',
      imageUrl: '/images/items/appmixer-ab12.png',
      imageAlt: '音量ミキサーの画面',
    })

    const html = await (await get('/apps/item/appmixer')).text()
    const main = mainOf(html)
    // 画像は文の列の横に並ぶ組み方（900 以上。app.css の .detail--shot）
    expect(main).toContain('<div class="detail detail--shot">')
    expect(main).toContain(
      '<figure class="shot"><img src="/images/items/appmixer-ab12.png" alt="音量ミキサーの画面" decoding="async"/></figure>',
    )
    // 説明が頭の1段落、本文がそのあとに続く1つの段落の列
    expect(main).toContain(
      '<div class="bio"><p>音を配る常駐アプリ。</p><p>背景の段落。</p><p>結果の段落。</p></div>',
    )
    // 構造化データの画像は絶対 URL（相対のままでは、この文書の外で読む側が解決できない）
    expect(html).toContain(`"image":"${SITE.origin}/images/items/appmixer-ab12.png"`)
    // 説明文（<meta>）は要約のまま。本文は検索結果の1行には畳めない
    expect(html).toContain('<meta name="description" content="音を配る常駐アプリ。"/>')
  })

  it('画像も本文も無ければ、figure も横に並べる組み方も出さない', async () => {
    await seedItem({ title: 'AppMixer', slug: 'appmixer', summary: '音を配る常駐アプリ。' })

    const html = await (await get('/apps/item/appmixer')).text()
    const main = mainOf(html)
    expect(main).toContain('<div class="detail">')
    expect(main).not.toContain('<figure')
    expect(main).toContain('<div class="bio"><p>音を配る常駐アプリ。</p></div>')
    expect(html).not.toContain('"image"')
  })

  it('この URL が何を指しているかを構造化データにも書く', async () => {
    await seedItem({ title: 'AppMixer', slug: 'appmixer', summary: '音を配る常駐アプリ。' })

    const html = await (await get('/apps/item/appmixer')).text()
    expect(html).toContain('"@type":"CreativeWork"')
    expect(html).toContain('"name":"AppMixer"')
    expect(html).toContain(`"url":"${SITE.origin}/apps/item/appmixer"`)
  })

  it('構造化データは、めくった先の作品にも載る。名乗りと違って連なりの先頭だけではない', async () => {
    /*
      名乗り（Person / Organization）は連なりの先頭にだけ載せる。作品同士を
      めくる列ができたとき、その決まりをそのまま当てると、2件目から先の作品の
      ページが「この URL は何か」を言わなくなる
    */
    await seedItem({ title: 'AppMixer', slug: 'appmixer', sortOrder: 10 })
    await seedItem({ title: 'AllTasks', slug: 'alltasks', sortOrder: 20 })

    const html = await (await get('/apps/item/alltasks')).text()
    expect(html).toContain('"@type":"CreativeWork"')
    expect(html).toContain(`"url":"${SITE.origin}/apps/item/alltasks"`)
  })
})

/*
  作品1件のページの行き来。1枚きりの行き止まりだったころは、戻る道が目次しか
  無かった——目次の Projects は一覧の1画面目へ行くので、4画面目のカードから
  入った人は最初からめくり直し、隣の作品を見るにも一覧へ戻ってカードを
  探し直すしかなかった。
*/
describe('作品1件のページの行き来', () => {
  // ページャだけを見る。「← 前」や数は本文にも柱にも出ないが、行き先の URL は出る
  const pagerOf = (html: string) => html.split('<nav class="pager"')[1]?.split('</nav>')[0] ?? ''

  // 本文の頭の「← 一覧に戻る」の行き先。無ければ null
  const backOf = (html: string) => mainOf(html).match(/<a class="back" href="([^"]*)"/)?.[1] ?? null

  it('作品同士を一覧と同じ並びでめくる。端では手を出さない', async () => {
    await seedItem({ title: '一番目', slug: 'ichi', sortOrder: 10 })
    await seedItem({ title: '二番目', slug: 'ni', sortOrder: 20 })
    await seedItem({ title: '三番目', slug: 'san', sortOrder: 30 })

    const first = pagerOf(await (await get('/apps/item/ichi')).text())
    // 端ではリンクそのものを出さない（ScreenPager の決まり）。サイトの列へも抜けない
    expect(first).not.toContain('rel="prev"')
    expect(first).toContain(
      '<a class="pager__go pager__go--next" href="/apps/item/ni" rel="next">次 →</a>',
    )
    // 数えるのは作品の列の中。読み上げには単位を「件」で渡す（一覧の画面の数と取り違えない）
    expect(first).toContain('<span class="pager__section">Projects</span>')
    expect(first).toContain('<span class="pager__of">1 / 3</span>')
    expect(first).toContain('Projects の 3 件のうち 1 件目')

    const middle = pagerOf(await (await get('/apps/item/ni')).text())
    expect(middle).toContain('<a class="pager__go" href="/apps/item/ichi" rel="prev">← 前</a>')
    expect(middle).toContain('href="/apps/item/san" rel="next">次 →</a>')
    expect(middle).toContain('<span class="pager__of">2 / 3</span>')

    const last = pagerOf(await (await get('/apps/item/san')).text())
    expect(last).toContain('href="/apps/item/ni" rel="prev">← 前</a>')
    expect(last).not.toContain('rel="next"')
    expect(last).toContain('<span class="pager__of">3 / 3</span>')
  })

  it('並びは一覧と同じ（新しい順）。区分をまたいでめくり、恒久リンクの無い作品は飛ばす', async () => {
    await seedItem({ type: 'app', title: '古いアプリ', slug: 'old', year: '2023', sortOrder: 10 })
    await seedItem({ type: 'work', title: '新しい仕事', slug: 'new', year: '2026', sortOrder: 10 })
    // 一覧には載るが、めくって着く URL が無い
    await seedItem({ type: 'app', title: 'まだ無いほう', year: '2025', sortOrder: 10 })

    const newest = pagerOf(await (await get('/works/item/new')).text())
    expect(newest).toContain('href="/apps/item/old" rel="next"')
    expect(newest).toContain('<span class="pager__of">1 / 2</span>')
    expect(pagerOf(await (await get('/apps/item/old')).text())).toContain(
      'href="/works/item/new" rel="prev"',
    )
  })

  it('目次はサイトのまま。作品の列は目次に並ばない', async () => {
    await seedItem({ title: '一番目', slug: 'ichi', sortOrder: 10 })
    await seedItem({ title: '二番目', slug: 'ni', sortOrder: 20 })

    const toc = tocOf(await (await get('/apps/item/ichi')).text())
    expect(toc).toContain('href="/projects" aria-current="page"')
    expect(toc).not.toContain('/apps/item/')
  })

  it('「← 一覧に戻る」は、その作品が載っている Projects の画面へ送る', async () => {
    // 1・2・4画面目に載る作品を作る。1画面の件数は src/blocks.ts の perScreen が正
    const per = blockPerScreen('projects')
    const count = per * 3 + 1
    for (let at = 0; at < count; at += 1) {
      await seedItem({ title: `作品${at}`, slug: `item-${at}`, sortOrder: (at + 1) * 10 })
    }

    // 1画面目は /projects。/projects/1 は 303 で寄せる URL なので出さない
    expect(backOf(await (await get('/apps/item/item-0')).text())).toBe('/projects')
    expect(backOf(await (await get(`/apps/item/item-${per - 1}`)).text())).toBe('/projects')
    expect(backOf(await (await get(`/apps/item/item-${per}`)).text())).toBe('/projects/2')
    const last = await (await get(`/apps/item/item-${per * 3}`)).text()
    expect(backOf(last)).toBe('/projects/4')

    // 戻った先に、その作品のカードが載っている
    expect(mainOf(await (await get('/projects/4')).text())).toContain(`作品${per * 3}`)
  })

  it('戻る先を数えるときは、恒久リンクの無い作品も数に入れる（一覧には載っている）', async () => {
    const per = blockPerScreen('projects')
    // 先頭に slug の無い作品を置く。数え落とすと、戻り先が1枚ずれる
    await seedItem({ title: 'まだ無いほう', sortOrder: 5 })
    for (let at = 1; at <= per; at += 1) {
      await seedItem({ title: `作品${at}`, slug: `item-${at}`, sortOrder: (at + 1) * 10 })
    }
    // 一覧の並びで per 番目（0始まり）＝2画面目の先頭
    const back = backOf(await (await get(`/apps/item/item-${per}`)).text())
    expect(back).toBe('/projects/2')
    expect(mainOf(await (await get('/projects/2')).text())).toContain(`作品${per}`)
  })

  it('一覧の節を置いていなければ、戻る道は出さない（行き先が 404 になる）', async () => {
    await seedItem({ title: 'AppMixer', slug: 'appmixer' })
    await db()
      .insert(schema.blocks)
      .values([
        { type: 'hero' as const, published: 1, sortOrder: 10 },
        { type: 'contact' as const, published: 1, sortOrder: 20 },
      ])

    expect(backOf(await (await get('/apps/item/appmixer')).text())).toBeNull()
  })

  it('一覧を先頭に置いた構成では、1画面目の戻り先は /（連なりの先頭の URL）', async () => {
    await seedItem({ title: 'AppMixer', slug: 'appmixer' })
    await db()
      .insert(schema.blocks)
      .values([
        { type: 'projects' as const, published: 1, sortOrder: 10 },
        { type: 'contact' as const, published: 1, sortOrder: 20 },
      ])

    expect(backOf(await (await get('/apps/item/appmixer')).text())).toBe('/')
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
      作品のページの行き先はカードと同じ1行（LinkRow の .links）。矢印は CSS が
      URL の頭で決める（test/theme.test.ts の「行き先の矢印」）。ここで見るのは、
      同じ条件で別タブかどうかも決まっていること
    */
    const main = mainOf(await (await get('/apps/item/appmixer')).text())
    // 担当は同じタブで開くサイトの中の続き。target も rel も付けない
    expect(main).toContain('<a href="/members/okazaki">担当 岡崎 昂功</a>')
    // 外へ出るリンクは今までどおり別タブで開く
    expect(main).toContain(
      '<a href="https://example.test/r" rel="noreferrer" target="_blank">Repository</a>',
    )
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

    const html = await (await get('/members/okazaki')).text()
    expect(html).toContain('class="band" href="/projects?member=okazaki"')
    // トップへ送っても、そこに一覧は無い（画面ごとの URL に分かれたため）
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

    const html = await (await get('/members/okazaki')).text()
    expect(html).toContain('class="band" href="/projects?member=okazaki"')
    expect(html).toContain('<span class="band__meta">業務 1</span>')
  })
})

/*
  個人ページもトップと同じ規則の連なり。1画面 = 1ドキュメントで、
  /members/<slug>（名乗りと帯）→ /about → /skills → /career → /contact。
  中身の無い画面は作らない——「中身が無ければ節ごと出さない」がそのまま伸びた形。
*/
describe('個人ページを画面に分ける', () => {
  const FULL = { skillsText: 'C# | 3年以上', careerText: '2024.03 | 入社 | ある会社' }

  it('技術と経歴は別の画面になる', async () => {
    await seedMember(FULL)

    const skills = await get('/members/okazaki/skills')
    expect(skills.status).toBe(200)
    expect(await skills.text()).toContain('C#')

    const career = await get('/members/okazaki/career')
    expect(career.status).toBe(200)
    expect(await career.text()).toContain('入社')
  })

  it('下書きのメンバーは、どの画面も 404', async () => {
    await seedMember({ slug: 'hidden', published: 0, ...FULL })

    for (const path of ['/members/hidden', '/members/hidden/skills', '/members/hidden/career']) {
      expect((await get(path)).status).toBe(404)
    }
  })

  it('書いていない画面は作らない。目次にも出さない', async () => {
    await seedMember()

    // 見出しだけの空の画面に URL を与えると、めくった先で行き止まりになる
    expect((await get('/members/okazaki/skills')).status).toBe(404)
    expect((await get('/members/okazaki/career')).status).toBe(404)

    const html = await (await get('/members/okazaki')).text()
    expect(html).not.toContain('/members/okazaki/skills')
    expect(html).toContain('href="/members/okazaki/about"')
  })

  it('知らない画面の名前は 404。1枚目の入口は1つだけ', async () => {
    await seedMember(FULL)

    expect((await get('/members/okazaki/nope')).status).toBe(404)
    // 1枚目は /members/okazaki ひとつ。同じ画面が2つの URL で数えられないように
    expect((await get('/members/okazaki/hero')).status).toBe(404)
  })

  it('2人以上なら、個人ページは Team の続き。← Team から入り、Contact → へ抜ける', async () => {
    /*
      以前は個人ページの中で閉じた連なりで、1枚目には「←」が無く（Team へ
      戻れない）、最後はその人だけの Contact だった。いまはサイトの列の Team の
      直後に差し込んだ列でめくる（1人のサイトは下の「1人のサイトの連なり」）
    */
    await seedMember(FULL)
    await seedMember({ slug: 'hoshino', name: '星野', sortOrder: 20 })

    const first = await (await get('/members/okazaki')).text()
    expect(first).toContain('<a class="pager__go" href="/team" rel="prev">← Team</a>')
    expect(first).toContain('href="/members/okazaki/about" rel="next">About →')

    // 1枚目へ戻る手は「← 前」ではなく名前を名乗る（別の節へ出るので）
    const about = await (await get('/members/okazaki/about')).text()
    expect(about).toContain('rel="prev">← 岡崎 昂功</a>')

    const career = await (await get('/members/okazaki/career')).text()
    expect(career).toContain(
      '<a class="pager__go pager__go--next" href="/contact" rel="next">Contact →</a>',
    )

    // Team の画面自身の「次」は変えない。個人ページはカードから入る脇の道
    const team = await (await get('/team')).text()
    expect(team).toContain('href="/contact" rel="next"')
  })

  it('2人以上なら、柱と目次はサイトのまま。目次は Team に印を付ける', async () => {
    // 個人ページ専用の柱と目次に丸ごと入れ替わると、別のサイトへ飛んだように見える
    await seedMember(FULL)
    await seedMember({ slug: 'hoshino', name: '星野', sortOrder: 20 })

    for (const path of ['/members/okazaki', '/members/okazaki/about', '/members/okazaki/career']) {
      const html = await (await get(path)).text()
      const toc = tocOf(html)
      expect(toc, path).toContain('<a href="/team" aria-current="page">Team</a>')
      expect(toc, path).not.toContain('/members/okazaki')
      expect(html.match(/aria-current="page"/g), path).toHaveLength(1)
      const rail = html.slice(html.indexOf('<aside class="rail"'), html.indexOf('</aside>'))
      expect(rail, path).toContain('<a class="brand" href="/">')
      expect(rail, path).not.toContain('avatar')
    }
  })

  it('個人ページの Contact は外した。貼られた URL はサイトの Contact へ寄せる', async () => {
    await seedMember(FULL)

    const moved = await get('/members/okazaki/contact')
    expect(moved.status).toBe(301)
    expect(moved.headers.get('location')).toBe('/contact')
  })

  it('1枚目の名札は Team のカードと同じ顔と名前。大見出しが無ければ名前が h1', async () => {
    await seedMember({ headline: '' })

    const main = mainOf(await (await get('/members/okazaki')).text())
    expect(main).toContain('<div class="nameplate">')
    expect(main).toContain('<h1 class="nameplate__name">岡崎 昂功</h1>')
    expect(main.match(/<h1[^>]*>/g)).toHaveLength(1)
  })

  it('サイトと違う連絡先を持つ人だけ、1枚目にその行き先を置く', async () => {
    await seedMember({ github: SITE.github, email: SITE.email })
    await seedMember({
      slug: 'tanaka',
      name: '田中 未来',
      sortOrder: 20,
      github: 'https://github.com/tanaka-example',
      email: 'tanaka@example.test',
    })

    // サイトと同じ行き先は2つ置かない
    expect(mainOf(await (await get('/members/okazaki')).text())).not.toContain('class="socials"')

    const other = mainOf(await (await get('/members/tanaka')).text())
    expect(other).toContain('href="https://github.com/tanaka-example"')
    expect(other).toContain('href="mailto:tanaka@example.test"')
  })

  it('画面ごとに canonical と題が変わる', async () => {
    const member = await seedMember()

    const first = await (await get('/members/okazaki')).text()
    expect(first).toContain(`<link rel="canonical" href="${SITE.origin}/members/okazaki"/>`)

    // 同じ題の URL が並ぶと、履歴から選び直せない
    const about = await (await get('/members/okazaki/about')).text()
    expect(about).toContain(`<link rel="canonical" href="${SITE.origin}/members/okazaki/about"/>`)
    expect(about).toContain(`<title>${member.name} · About — ${SITE.name}</title>`)
  })
})

/*
  1人のサイトの連なり。

  公開中のメンバーが1人で Team を置いているとき、Team の画面は作らない。
  その位置にその人の画面（1枚目・About・Skills・Career）がそのまま入り、
  サイトの連なりそのものになる。1枚の細いカードだけの Team の画面は、
  「複数いる前提の器に1人しか入っていない」ことを画面1枚ぶん使って告知していた。
*/
describe('1人のサイトの連なり', () => {
  const FULL = { skillsText: 'C# | 3年以上', careerText: '2024.03 | 入社 | ある会社' }

  // ページャの「次」を辿る。rel="next" のリンクが無くなったら終わり
  const nextOf = (html: string) =>
    html.match(/<a class="pager__go pager__go--next" href="([^"]+)" rel="next">/)?.[1] ?? null

  it('/ から「次」を押し続けると、入口 → Projects → プロフィール → Contact と一周する', async () => {
    await seedMember(FULL)
    await seedItem({ type: 'app' })

    /*
      入口にはページャが無い（帯の行き先がページャの「次」と同じなので出さない）。
      入口から先へ進む手は帯そのもの。そこから先はページャの「次」
    */
    const bandOf = (html: string) => html.match(/<a class="band" href="([^"]+)"/)?.[1] ?? null
    const visited: string[] = []
    for (let path: string | null = '/'; path && visited.length < 20; ) {
      const response = await get(path)
      expect(response.status, path).toBe(200)
      visited.push(path)
      const html = await response.text()
      path = nextOf(html) ?? (path === '/' ? bandOf(html) : null)
    }
    expect(visited).toEqual([
      '/',
      '/projects',
      '/members/okazaki',
      '/members/okazaki/about',
      '/members/okazaki/skills',
      '/members/okazaki/career',
      '/contact',
    ])
  })

  it('ページャは節ごとに名乗る。Projects の次は名前、Career の次は Contact', async () => {
    await seedMember(FULL)
    await seedItem({ type: 'app' })

    const projects = await (await get('/projects')).text()
    expect(projects).toContain('href="/members/okazaki" rel="next">岡崎 昂功 →</a>')

    const first = await (await get('/members/okazaki')).text()
    expect(first).toContain('<a class="pager__go" href="/projects" rel="prev">← Projects</a>')
    expect(first).toContain('href="/members/okazaki/about" rel="next">About →</a>')

    const career = await (await get('/members/okazaki/career')).text()
    expect(career).toContain('href="/contact" rel="next">Contact →</a>')

    const contact = await (await get('/contact')).text()
    expect(contact).toContain('href="/members/okazaki/career" rel="prev">← Career</a>')
  })

  it('目次は「Profile」の1行。行き先は1枚目で、どの画面でもその行に印', async () => {
    await seedMember(FULL)
    await seedItem({ type: 'app' })

    const labels = (html: string) =>
      [...tocOf(html).matchAll(/<a [^>]*>([^<]+)<\/a>/g)].map((match) => match[1])
    expect(labels(await (await get('/')).text())).toEqual(['Projects', 'Profile', 'Contact'])

    for (const path of [
      '/members/okazaki',
      '/members/okazaki/about',
      '/members/okazaki/skills',
      '/members/okazaki/career',
    ]) {
      const html = await (await get(path)).text()
      expect(tocOf(html), path).toContain(
        '<a href="/members/okazaki" aria-current="page">Profile</a>',
      )
      expect(html.match(/aria-current="page"/g), path).toHaveLength(1)
      // Team の行は無い（画面が無いので、指す先も無い）
      expect(tocOf(html), path).not.toContain('Team')
    }
  })

  it('/team は1枚目へ 301。2人目を公開すると Team の画面に戻る', async () => {
    await seedMember()

    for (const path of ['/team', '/team/2', '/team?kind=app']) {
      const response = await get(path)
      expect(response.status, path).toBe(301)
      expect(response.headers.get('location'), path).toBe('/members/okazaki')
    }

    await seedMember({ slug: 'hoshino', name: '星野' })
    expect((await get('/team')).status).toBe(200)
  })

  it('1枚目に帯は出さない。入口の帯と同じ行き先・同じ件数になる', async () => {
    const member = await seedMember()
    await seedItem({ type: 'app', memberId: member.id })

    expect(await (await get('/')).text()).toContain('class="band"')
    expect(mainOf(await (await get('/members/okazaki')).text())).not.toContain('class="band"')
  })

  it('全体ページでは、Team のカードの代わりにプロフィールを1つの節として置く', async () => {
    await seedMember({
      headline: 'つくる工程そのものを、速くする。',
      bio: '紹介の段落。',
      skillsText: 'LANGUAGES:\nC# | 3年以上',
      careerText: '2024.03 | 入社 | ある会社',
    })

    const html = await (await get('/all')).text()
    const profile = html.slice(
      html.indexOf('<section id="profile"'),
      html.indexOf('<section id="contact"'),
    )
    expect(profile).toContain('role="region" aria-label="Profile"')
    expect(html).toContain('<a href="#profile">Profile</a>')
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
    // 名札の名前は添え（見出しは節の h2）。大見出しは大きな一文として出る
    expect(profile).toContain('<strong class="nameplate__name">岡崎 昂功</strong>')
    expect(profile).toContain('<p class="statement__text">つくる工程そのものを、速くする。</p>')
    expect(profile).toContain('紹介の段落。')
    expect(profile).toContain('入社')

    // 2人目を公開すると Team のカードの節に戻る。見出しは h2 のまま、h1 は Hero の1つ
    await seedMember({ slug: 'hoshino', name: '星野' })
    const two = await (await get('/all')).text()
    expect(two).toContain('<div class="head"><h2>Team</h2>')
    expect(two).not.toContain('<section id="profile"')
    expect(two.match(/<h1[^>]*>/g) ?? []).toHaveLength(1)
  })

  it('sitemap にはプロフィールの画面を1度ずつ載せ、/team は載せない', async () => {
    await seedMember(FULL)

    const locs = [
      ...(await (await get('/sitemap.xml')).text()).matchAll(/<loc>([^<]+)<\/loc>/g),
    ].map((match) => match[1])
    expect(new Set(locs).size).toBe(locs.length)
    expect(locs).not.toContain(`${SITE.origin}/team`)
    for (const path of ['', '/about', '/skills', '/career']) {
      expect(locs).toContain(`${SITE.origin}/members/okazaki${path}`)
    }

    // 2人以上なら Team の画面が戻り、個人ページも載ったまま（同じ URL は1度ずつ）
    await seedMember({ slug: 'hoshino', name: '星野' })
    const two = [...(await (await get('/sitemap.xml')).text()).matchAll(/<loc>([^<]+)<\/loc>/g)]
    const twoLocs = two.map((match) => match[1])
    expect(new Set(twoLocs).size).toBe(twoLocs.length)
    expect(twoLocs).toContain(`${SITE.origin}/team`)
    expect(twoLocs).toContain(`${SITE.origin}/members/okazaki/career`)
    expect(twoLocs).toContain(`${SITE.origin}/members/hoshino`)
  })

  it('Team を置かない1人のサイトでは、個人ページは今までどおり単独の連なり', async () => {
    const member = await seedMember(FULL)
    await seedItem({ memberId: member.id })
    await db()
      .insert(schema.blocks)
      .values([
        { type: 'hero' as const, published: 1, sortOrder: 10 },
        { type: 'projects' as const, published: 1, sortOrder: 20 },
        { type: 'contact' as const, published: 1, sortOrder: 30 },
      ])

    const first = await (await get('/members/okazaki')).text()
    // 差し込む先が無いので、前は無く、次はこの人の About
    expect(first).not.toContain('rel="prev"')
    expect(first).toContain('href="/members/okazaki/about" rel="next">About →</a>')
    // 目次はサイトのもの。Profile の行も印も無い
    expect(tocOf(first)).not.toContain('Profile')
    expect(first).not.toContain('aria-current="page"')
    // 帯はこちらでは出る（入口の帯と行き先が同じでも、この連なりはサイトの列の外）
    expect(mainOf(first)).toContain('class="band"')
    // Projects の次は Contact のまま（個人ページはカードの担当者名から入る脇の道）
    expect(await (await get('/projects')).text()).toContain('href="/contact" rel="next"')
  })

  it('Hero を外して Team を先頭に置いたら、/ はプロフィールの1枚目へ送る', async () => {
    await seedMember()
    await db()
      .insert(schema.blocks)
      .values([
        { type: 'team' as const, published: 1, sortOrder: 10 },
        { type: 'contact' as const, published: 1, sortOrder: 20 },
      ])

    // その1枚は /members/<slug> にある。構成しだいで変わる行き先なので 302
    const top = await get('/')
    expect(top.status).toBe(302)
    expect(top.headers.get('location')).toBe('/members/okazaki')

    // 連なりの先頭なので、ここで名乗る
    expect(await (await get('/members/okazaki')).text()).toContain('application/ld+json')
    // 送る元の / は sitemap に載せない
    expect(await (await get('/sitemap.xml')).text()).not.toContain(`<loc>${SITE.origin}/</loc>`)
  })
})

/*
  個人ページも「1画面に何件」の軸を持つ。

  件数は src/blocks.ts の MEMBER_PER_SCREEN が正で、割るのはトップと同じ
  src/lib/paginate.ts。ここに軸が無かったころ、書き足した人に残っていた道は
  「入らなくなったら CSS を縮める」だけだった。
*/
describe('個人ページを件数で割る', () => {
  // 数はテストに書き写さない。上限を変えたら、この列が一緒に伸びる
  const rows = (n: number, make: (i: number) => string) =>
    Array.from({ length: n }, (_, i) => make(i + 1)).join('\n')

  it('経歴は1画面 N 件。入りきらないぶんは次の URL へ', async () => {
    const per = MEMBER_PER_SCREEN.career
    await seedMember({
      careerText: rows(per + 1, (i) => `2024.0${i} | できごと${i} | ある会社`),
    })

    const first = await (await get('/members/okazaki/career')).text()
    expect(first).toContain('できごと1')
    expect(first).not.toContain(`できごと${per + 1}`)

    const second = await get('/members/okazaki/career/2')
    expect(second.status).toBe(200)
    expect(await second.text()).toContain(`できごと${per + 1}`)

    /*
      経歴が2画面に割れる。数えるのは**節の中**なので、Career の 1 / 2。
      連なり全体では3枚目だが、そこは数えない——絞り込みで動く数を
      画面に出さないため（src/lib/sequence.ts）。
    */
    expect(first).toContain('Career の 2 画面のうち 1 画面目')
    // 同じ節の中の移動なので、次は行き先を名乗らない
    expect(first).toContain('次 →')
    // 3画面目は無い
    expect((await get('/members/okazaki/career/3')).status).toBe(404)
  })

  it('1画面目の URL は1つに寄せる。トップと同じ文法', async () => {
    await seedMember({ careerText: '2024.03 | 入社 | ある会社' })

    const one = await get('/members/okazaki/career/1')
    expect(one.status).toBe(303)
    expect(one.headers.get('location')).toBe('/members/okazaki/career')

    // /career/01 のような別の書き方を通すと、同じ画面の URL がまた増える
    expect((await get('/members/okazaki/career/01')).status).toBe(404)
    expect((await get('/members/okazaki/career/abc')).status).toBe(404)
  })

  it('割られた画面でも、節の中で数える。目次の印は Profile に1つだけ', async () => {
    const per = MEMBER_PER_SCREEN.career
    await seedMember({ careerText: rows(per + 1, (i) => `2024.0${i} | できごと${i}`) })

    const html = await (await get('/members/okazaki/career/2')).text()
    expect(html).toContain('<span class="pager__section">Career</span>')
    expect(html).toContain('<span class="pager__of">2 / 2</span>')
    // 目次はサイトのもの。Career の行は無く、印は Profile（1人のサイトの Team の位置）に1つ
    expect(tocOf(html)).not.toContain('Career')
    expect(html).toContain('<a href="/members/okazaki" aria-current="page">Profile</a>')
    expect(html.match(/aria-current="page"/g)).toHaveLength(1)
  })

  it('技術は塊ごとに割る。小見出しの途中では割らない', async () => {
    const per = MEMBER_PER_SCREEN.skills
    await seedMember({
      skillsText: rows(per + 1, (i) => `塊${i}:\n項目${i}`).replaceAll('\n塊', '\n\n塊'),
    })

    const first = await (await get('/members/okazaki/skills')).text()
    expect(first).toContain('項目1')
    expect(first).not.toContain(`項目${per + 1}`)
    expect(await (await get('/members/okazaki/skills/2')).text()).toContain(`項目${per + 1}`)
  })

  it('紹介文は段落で割る。書く側の上限と同じ数', async () => {
    const per = MEMBER_PER_SCREEN.about
    await seedMember({ bio: rows(per + 1, (i) => `紹介の段落${i}`).replaceAll('\n', '\n\n') })

    const first = await (await get('/members/okazaki/about')).text()
    expect(first).toContain('紹介の段落1')
    expect(first).not.toContain(`紹介の段落${per + 1}`)
    expect(await (await get('/members/okazaki/about/2')).text()).toContain(`紹介の段落${per + 1}`)
  })

  it('中身が1画面に収まるうちは、2つ目の URL を作らない', async () => {
    await seedMember({ skillsText: 'C# | 3年以上', careerText: '2024.03 | 入社 | ある会社' })

    for (const path of ['/members/okazaki/about', '/skills', '/career'].map((part) =>
      part.startsWith('/members') ? part : `/members/okazaki${part}`,
    )) {
      expect((await get(`${path}/2`)).status, path).toBe(404)
    }
  })
})

/*
  節そのものが弁（app.css の `main > :is(.hero, section)` の overflow: auto）。
  WebKit ではスクロール箱にキーボードでフォーカスできないので、tabindex が
  無いと、弁が開いた画面の中身に読み手がたどり着けない（WCAG 2.1.1）。
*/
describe('弁をキーボードで操作できる', () => {
  const boxes = (html: string) => mainOf(html).match(/<(?:section|header)[^>]*>/g) ?? []

  it('main の中の箱は、どれも tabindex を持つ', async () => {
    await seedMember({ skillsText: 'C# | 3年以上', careerText: '2024.03 | 入社 | ある会社' })
    await seedItem({ type: 'app' })
    await seedItem({ type: 'work' })

    // 1人のサイトなので /team は無い（プロフィールへ 301）。Team の画面は2人のサイトにだけある
    for (const path of [
      '/',
      '/projects',
      '/contact',
      '/members/okazaki',
      '/members/okazaki/about',
      '/members/okazaki/skills',
      '/members/okazaki/career',
    ]) {
      const found = boxes(await (await get(path)).text())
      expect(found.length, path).toBeGreaterThan(0)
      // 1つでも漏れると、その画面だけキーボードで読めない箱になる
      for (const box of found) expect(box, path).toContain('tabindex="0"')
    }
  })

  it('全体ページには付けない。あちらは弁が無く、ページ自身が動く', async () => {
    await seedMember()
    await seedItem({ type: 'app' })
    await seedItem({ type: 'work' })

    // 止まる理由の無い箱にタブ停止を置くと、いちばん長いページで数だけ増える
    const found = boxes(await (await get('/all')).text())
    expect(found.length).toBeGreaterThan(1)
    for (const box of found) expect(box).not.toContain('tabindex')
  })

  it('見出しのある画面は、その名前の region として出る', async () => {
    await seedItem({ type: 'app' })
    expect(await (await get('/projects')).text()).toContain('role="region" aria-label="Projects"')
  })

  it('main は tabindex="-1"。「本文へスキップ」の行き先', async () => {
    await seedItem()
    const html = await (await get('/')).text()
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

  it('作品のリンクの javascript: と相対 URL は、カードにも作品のページにも全体ページにも出さない', async () => {
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
      const main = mainOf(await (await get(path)).text())
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
    expect(mainOf(await (await get('/apps/item/appmixer')).text())).not.toContain(
      '<div class="links">',
    )
  })

  it('メンバーの GitHub の javascript: と相対 URL は、個人ページにも JSON-LD にも出さない', async () => {
    for (const github of ['javascript:alert(document.cookie)', 'github.com/okazaki']) {
      await resetDb()
      await seedMember({ github })

      // 1人のサイト。個人ページの1枚目にも全体ページにも出さず、名乗りはサイトの GitHub に戻す
      expect(await (await get('/members/okazaki')).text(), github).not.toContain(`href="${github}"`)
      expect(await (await get('/all')).text(), github).not.toContain(`href="${github}"`)
      const top = await (await get('/')).text()
      expect(top, github).not.toContain(github)
      expect(jsonLdOf(top).sameAs, github).toEqual([SITE.github])

      // 2人のサイトでは個人ページが自分の名乗り（Person）を持つ。そこにも載せない
      await seedMember({ slug: 'hoshino', name: '星野', sortOrder: 20 })
      const personal = await (await get('/members/okazaki')).text()
      expect(personal, github).not.toContain(github)
      expect(jsonLdOf(personal), github).toMatchObject({ '@type': 'Person' })
      expect(jsonLdOf(personal), github).not.toHaveProperty('sameAs')
    }
  })

  it('https:// の GitHub はそのまま出る', async () => {
    await seedMember({ github: 'https://github.com/okazaki' })
    await seedMember({ slug: 'hoshino', name: '星野', sortOrder: 20 })
    const personal = await (await get('/members/okazaki')).text()
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

  it('sitemap は公開中の画面をそのまま数え上げる', async () => {
    await seedMember()
    // perScreen は2なので、3件で2画面になる
    await seedItem({ type: 'app', title: 'ひとつめ', slug: 'one' })
    await seedItem({ type: 'app', title: 'ふたつめ', slug: 'two' })
    await seedItem({ type: 'app', title: 'みっつめ', slug: 'three' })

    const response = await get('/sitemap.xml')
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('application/xml')

    const xml = await response.text()
    const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1])

    // 手で並べた表は置かない。画面が増えれば URL も増える
    expect(locs).toContain(`${SITE.origin}/`)
    expect(locs).toContain(`${SITE.origin}/projects`)
    expect(locs).toContain(`${SITE.origin}/projects/2`)
    // 寄せる元の URL（Apps / Works の一覧）は載せない
    expect(locs).not.toContain(`${SITE.origin}/apps`)
    expect(locs).toContain(`${SITE.origin}/all`)
    expect(locs).toContain(`${SITE.origin}/members/okazaki`)
    // 個人ページの Contact は外した（サイトの Contact へ 301）。寄せる元の URL は載せない
    expect(locs).not.toContain(`${SITE.origin}/members/okazaki/contact`)
    expect(locs).toContain(`${SITE.origin}/apps/item/one`)
    // 3件を2画面に割ったので、3画面目は無い
    expect(locs).not.toContain(`${SITE.origin}/projects/3`)
  })

  it('出ない画面は載せない。下書きも、絞り込み付きの URL も', async () => {
    await seedMember({ slug: 'draft', name: '下書きの人', published: 0 })
    await seedMember()
    await seedItem({ type: 'app', title: '下書きのアプリ', slug: 'hidden', published: 0 })
    await seedItem({ type: 'app', slug: 'shown' })

    const xml = await (await get('/sitemap.xml')).text()
    expect(xml).not.toContain('/apps/item/hidden')
    expect(xml).not.toContain('/members/draft')
    // 同じ中身の取り出し方なので、ピルの組み合わせのぶんだけ URL を数えさせない
    expect(xml).not.toContain('?platform=')
    expect(xml).not.toContain('/admin')
    expect(xml).toContain('/apps/item/shown')
  })

  it('同じ URL は1度だけ並べる。全部下書きでも入口は載る', async () => {
    await seedMember()
    await seedItem({ type: 'app' })

    const locs = [...(await (await get('/sitemap.xml')).text()).matchAll(/<loc>([^<]+)<\/loc>/g)]
    expect(new Set(locs.map((match) => match[1])).size).toBe(locs.length)

    // 置いたものが全部下書きでも、入口は 200 のまま（「まだ何も置いていません」）
    await db().insert(schema.blocks).values({ type: 'hero', published: 0, sortOrder: 10 })
    expect((await get('/')).status).toBe(200)
    expect(await (await get('/sitemap.xml')).text()).toContain(`<loc>${SITE.origin}/</loc>`)
  })

  it('1画面目は正の URL ひとつだけ。/<slug> は載せない', async () => {
    await seedItem({ type: 'app' })
    // Hero を置かなければ、先頭の画面は Projects。/ と /projects の2つで開ける
    await db().insert(schema.blocks).values({ type: 'projects', published: 1, sortOrder: 10 })

    const xml = await (await get('/sitemap.xml')).text()
    // 正は / のほう（siteSteps が先頭だけ / に寄せている）
    expect(xml).toContain(`<loc>${SITE.origin}/</loc>`)
    expect(xml).not.toContain(`<loc>${SITE.origin}/projects</loc>`)
  })
})

/*
  全体ページ（/all）へ行く道。公開側にも管理画面にも href が1本も無かった。
  @media print が「全体ページを刷ること」と書いている紙も、2行で切られた
  説明文の全文も、この1本が無いと URL を手で打った人にしか届かない。
*/
describe('全体ページへの導線', () => {
  it('柱の足元から行ける', async () => {
    await seedItem()

    for (const path of ['/', '/projects', '/contact']) {
      const html = await (await get(path)).text()
      /*
        矢印は →。同じタブで開くサイトの中の行き先で、↗（外へ出る・別タブ）
        ではない。管理画面の同じ1本は別タブなので ↗ のまま（admin.test.ts）
      */
      expect(html, path).toContain('<a href="/all">全体を1ページで見る →</a>')
    }
  })

  it('全体ページ自身には出さない（自分への行き先）', async () => {
    await seedItem()
    expect(await (await get('/all')).text()).not.toContain('href="/all"')
  })
})

describe('管理画面への入口', () => {
  it('訪問者には出さない。柱は今までと同じ姿のまま', async () => {
    await seedMember()
    await seedItem({ slug: 'appmixer' })

    for (const path of ['/', '/projects', '/all', '/members/okazaki', '/apps/item/appmixer']) {
      const response = await get(path)
      expect(await response.text(), path).not.toContain('rail__admin')
      expect(response.headers.get('cache-control'), path).toBeNull()
    }
  })

  it('ログインしている人には、いま見ている画面を直す場所へ送る入口を出す', async () => {
    const member = await seedMember()
    const item = await seedItem({ slug: 'appmixer' })
    const signed = await signIn()

    const cases: [string, string][] = [
      ['/', `/admin/members/${member.id}/edit`],
      ['/projects', '/admin/items'],
      // 1人のサイトに Team の画面は無い。その位置のプロフィールは、その人の編集へ
      ['/members/okazaki/about', `/admin/members/${member.id}/edit`],
      // 既定の並び（構成を保存していない）には、指せる行がまだ無い
      ['/contact', '/admin/blocks'],
      ['/all', '/admin/blocks'],
      ['/members/okazaki', `/admin/members/${member.id}/edit`],
      ['/apps/item/appmixer', `/admin/items/${item.id}/edit`],
    ]
    for (const [path, href] of cases) {
      const response = await signed(path)
      expect(await response.text(), path).toContain(`<a class="rail__admin" href="${href}">`)
      // 共有のキャッシュに置かれると、次の訪問者に入口が出る
      expect(response.headers.get('cache-control'), path).toBe('private, no-store')
    }
  })

  it('打ち込むブロックの画面は、そのブロックの編集へ送る', async () => {
    await seedMember()
    const [block] = await db()
      .insert(schema.blocks)
      .values({ type: 'statement', title: 'つくる速さは、設計で決まる。', published: 1 })
      .returning()
    if (!block) throw new Error('ブロックを置けなかった')
    const signed = await signIn()

    const html = await (await signed(`/block-${block.id}`)).text()
    expect(html).toContain(`<a class="rail__admin" href="/admin/blocks/${block.id}/edit">`)
  })

  it('期限の切れたセッションでは出さない', async () => {
    await seedMember()
    const signed = await signIn()
    await db().update(schema.sessions).set({ expiresAt: '2000-01-01T00:00:00.000Z' })

    const response = await signed('/')
    expect(await response.text()).not.toContain('rail__admin')
    expect(response.headers.get('cache-control')).toBeNull()
  })
})

/*
  貼られたリンクのカードと、検索結果の見え方。og:image が無いと LinkedIn は
  灰色の箱、Slack は文字だけの行になり、7つの画面がどれも同じ無地の札になる。
*/
describe('共有カードと画面ごとの説明文', () => {
  const descriptionOf = (html: string) =>
    html.match(/<meta name="description" content="([^"]*)"/)?.[1] ?? ''

  it('og:image はサイトに1枚。実在する素材を絶対 URL で指す', async () => {
    await seedItem()
    const html = await (await get('/')).text()

    expect(html).toContain(`<meta property="og:image" content="${SITE.origin}/assets/avatar.png"/>`)
    // 144x144 は推奨（1200x630）に届かない。だから札は小さな正方形のまま
    expect(html).toContain('<meta property="og:image:width" content="144"/>')
    expect(html).toContain('<meta name="twitter:card" content="summary"/>')
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
    const html = await (await get('/apps/item/appmixer')).text()
    expect(html).toContain(
      `<meta property="og:image" content="${SITE.origin}/images/items/appmixer-ab12cd34.png"/>`,
    )
    expect(html).toContain('<meta property="og:image:type" content="image/png"/>')
    expect(html).toContain('<meta property="og:image:width" content="1200"/>')
    expect(html).toContain('<meta property="og:image:height" content="630"/>')
    expect(html).toContain('<meta property="og:image:alt" content="音量ミキサーの画面"/>')
    expect(html).toContain('<meta name="twitter:card" content="summary_large_image"/>')
    // サイトの1枚は出さない（og:image は1つ）
    expect(html).not.toContain('/assets/avatar.png"/>')
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
    const old = await (await get('/apps/item/old')).text()
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
    const tall = await (await get('/apps/item/tall')).text()
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
    const avifPage = await (await get('/apps/item/avif')).text()
    expect(avifPage).toContain(
      `<meta property="og:image" content="${SITE.origin}/assets/avatar.png"/>`,
    )
  })

  it('画像の無い作品のページと、ほかの画面はサイトの1枚のまま', async () => {
    await seedItem({ title: 'AppMixer', slug: 'appmixer' })
    for (const path of ['/apps/item/appmixer', '/projects', '/all']) {
      const html = await (await get(path)).text()
      expect(html, path).toContain(
        `<meta property="og:image" content="${SITE.origin}/assets/avatar.png"/>`,
      )
      expect(html, path).toContain('<meta name="twitter:card" content="summary"/>')
    }
  })

  it('画面ごとに違う説明文を出す。同じ1文を配らない', async () => {
    await seedMember({ skillsText: 'C# | 3年以上', careerText: '2024.03 | 入社 | ある会社' })
    await seedItem({ type: 'app' })
    await seedItem({ type: 'work' })

    // 1人のサイトなので /team は無い（プロフィールへ 301）
    const paths = [
      '/',
      '/projects',
      '/contact',
      '/all',
      '/members/okazaki',
      '/members/okazaki/about',
      '/members/okazaki/skills',
      '/members/okazaki/career',
    ]
    const found = await Promise.all(
      paths.map(async (path) => descriptionOf(await (await get(path)).text())),
    )

    for (const [index, text] of found.entries()) expect(text, paths[index]).not.toBe('')
    expect(new Set(found).size).toBe(paths.length)
  })

  it('一覧の説明文は、件数とピルと、その画面に出ているカードから作る', async () => {
    await seedItem({ type: 'app', title: 'ひとつめ', sortOrder: 10 })
    await seedItem({ type: 'app', title: 'ふたつめ', sortOrder: 20 })
    await seedItem({ type: 'work', title: 'みっつめ', sortOrder: 30 })

    const first = descriptionOf(await (await get('/projects')).text())
    const second = descriptionOf(await (await get('/projects/2')).text())

    expect(first).toBe('つくったもの 3 件。個人開発 / 業務。ひとつめ、ふたつめ')
    // 割った先が同じ説明文だと、2画面目は1画面目の準重複になる
    expect(second).toBe('つくったもの 3 件。個人開発 / 業務。みっつめ')
  })

  it('業務の説明文には、カードに出ている実績値も入る', async () => {
    await seedItem({
      type: 'work',
      title: '開発工程の効率化',
      metricValue: '20',
      metricUnit: '人日',
      metricNote: '見込み 40人日から半減',
    })

    /*
      このサイトでいちばん強い一文は .metric にしかなく、検索結果にも貼られた
      カードにも1文字も出ていなかった。並べる順はカードのまま（値・単位・添え）。
      添えは値のあとに続けて読まれる——「見込み 40人日 → 実績」のころは、→ が
      値より前を指して逆に読めた（添えの書き方は管理画面のヒントが言う）
    */
    expect(descriptionOf(await (await get('/projects')).text())).toBe(
      'つくったもの 1 件。業務。開発工程の効率化（20 人日 見込み 40人日から半減）',
    )
  })

  it('打ち込んだブロックは、その画面に出ている文字から作る', async () => {
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

    const html = await (await get(`/block-${block?.id}`)).text()
    expect(descriptionOf(html)).toBe('年表。2026 出した 補足')
  })

  it('説明文は長すぎたら切る。どこで切れるかはこちらで決める', async () => {
    await seedMember({ bio: 'あ'.repeat(400) })

    const text = descriptionOf(await (await get('/members/okazaki/about')).text())
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
  「登録順」という決まり自体を守らせるものは、これまで CLAUDE.md・
  public.tsx のコメント・docs/screens.md という散文3か所しか無かった。

  Hono は登録した順のまま `.routes` を公開しているので、そこを読めばよい。
  CSS を文字列で読む test/theme.test.ts の契約テストと同じ手口——実装の
  かたちそのものを1本で固定する。
*/
describe('URL の登録順', () => {
  const paths = () => publicRoutes.routes.map((route) => route.path)

  it('catch-all は最後の2本だけ。固定の URL は必ずその前', () => {
    expect(paths().slice(-2)).toEqual(['/:screen', '/:screen/:page'])
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
      '/admin/appearance',
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
      expect(html, path).toContain('URL が変わったか、打ち間違えているかもしれません。')
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
        const html = await (await get(path)).text()
        expect(html, path).toContain(`© 2032 ${SITE.name}`)
      }
    } finally {
      vi.useRealTimers()
    }
  })
})

/*
  サイトを「置けるものを全部置いた」姿にする。sitemap の全 URL を回す検査
  （h1・<title>・ページャ）が、手で並べた URL ではなく実物の連なりを見るため。
  書くブロックは全種類、メモは見出しを空けたもの、Projects と経歴は2画面に割れる数。
*/
async function seedEverything() {
  await seedMember({
    skillsText: 'LANGUAGES:\nC# | 3年以上',
    careerText: Array.from(
      { length: MEMBER_PER_SCREEN.career + 1 },
      (_, i) => `20${10 + i}.04 | 仕事${i} | 会社`,
    ).join('\n'),
  })
  for (let i = 0; i < blockPerScreen('projects') + 1; i += 1) {
    await seedItem({ title: `作品${i}`, slug: `item-${i}`, year: `20${20 + i}`, sortOrder: i })
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
      // 見出しを空けたメモ（段落だけの画面）。perScreen を超えて2画面に割れる
      {
        type: 'note',
        title: '',
        body: Array.from(
          { length: blockPerScreen('note') + 1 },
          (_, i) => `メモの段落 ${i} です。`,
        ).join('\n\n'),
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
  const xml = await (await get('/sitemap.xml')).text()
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => new URL(match[1] ?? '').pathname)
}

const titleOf = (html: string) => html.match(/<title>([^<]*)<\/title>/)?.[1] ?? ''

/*
  見出しの無いメモ（PUB-3）と、画面ごとの題（PUB-2）。どちらも sitemap の全 URL で見る
  ——固定のブロックと個人ページだけを並べていた検査は、管理画面が許す「見出しを
  空けたメモ」の画面に h1 が1つも無いことを見逃していた。
*/
describe('連なりの全画面', () => {
  it('割られた画面は、どれも h1 をちょうど1つ持つ（sitemap の全 URL、書くブロックの全種類）', async () => {
    await seedEverything()
    const paths = (await sitemapPaths()).filter((path) => path !== '/all')
    expect(paths.length).toBeGreaterThan(15)
    for (const path of paths) {
      const html = await (await get(path)).text()
      expect(html.match(/<h1[^>]*>/g) ?? [], path).toHaveLength(1)
    }
  })

  it('見出しを空けたメモは、種類の名前（メモ）を読み上げの h1・region の名前・ページャに使う。目次には並べない', async () => {
    await seedEverything()
    const note = await db().query.blocks.findFirst({
      where: (t, { and, eq }) => and(eq(t.type, 'note'), eq(t.title, '')),
    })
    const html = await (await get(`/block-${note?.id}`)).text()
    expect(mainOf(html)).toContain('<h1 class="sr-only">メモ</h1>')
    expect(mainOf(html)).toContain('aria-label="メモ"')
    expect(html).toContain('<span class="pager__section">メモ</span>')
    expect(tocOf(html)).not.toContain('メモ')
    // 見出しのあるメモは今までどおり目に見える h1 で、目次にも並ぶ
    const titled = await db().query.blocks.findFirst({
      where: (t, { eq }) => eq(t.title, 'あとがき'),
    })
    const other = await (await get(`/block-${titled?.id}`)).text()
    expect(other).toContain('<h1>あとがき</h1>')
    expect(tocOf(other)).toContain('あとがき')
  })

  it('sitemap の URL はどれも違う <title> を持つ。割った2画面目以降は数え方を添える', async () => {
    await seedEverything()
    const titles = new Map<string, string>()
    for (const path of await sitemapPaths()) {
      titles.set(path, titleOf(await (await get(path)).text()))
    }
    const seen = new Map<string, string>()
    for (const [path, title] of titles) {
      expect(seen.get(title), `${path} と ${seen.get(title)} が同じ題「${title}」`).toBeUndefined()
      seen.set(title, path)
    }
    expect(titles.get('/projects')).toBe(`Projects 1 / 2 — ${SITE.name}`)
    expect(titles.get('/projects/2')).toBe(`Projects 2 / 2 — ${SITE.name}`)
    expect(titles.get('/members/okazaki/career/2')).toBe(`岡崎 昂功 · Career 2 / 2 — ${SITE.name}`)
    // 1画面しかない節には数を添えない
    expect(titles.get('/contact')).toBe(`Contact — ${SITE.name}`)
    expect(titles.get('/members/okazaki/about')).toBe(`岡崎 昂功 · About — ${SITE.name}`)
    // 名前の無い画面は、その画面の文の頭（入口と同じ題にしない）
    expect([...titles.values()]).toContain(`つくる速さは、設計で決まる。 — ${SITE.name}`)
  })

  it('全体ページの題は入口と違う', async () => {
    await seedMember()
    expect(titleOf(await (await get('/all')).text())).not.toBe(
      titleOf(await (await get('/')).text()),
    )
  })
})

describe('肩書きの無い人', () => {
  it('題にも説明にも「（）」を出さない。jobTitle も名乗らない（PUB-6）', async () => {
    await seedMember({ role: '', headline: '', bio: '' })
    for (const path of ['/', '/members/okazaki', '/all']) {
      const html = await (await get(path)).text()
      expect(html, path).not.toContain('（）')
    }
    const entrance = await (await get('/')).text()
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
    const html = await (await get('/all')).text()
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
    const html = await (await get('/all')).text()
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
      body: form({ type: 'app', title: 'AppMixer', slug: 'app-mixer', published: '1' }),
    })
    const moved = await get('/apps/item/appmixer')
    expect(moved.status).toBe(301)
    expect(moved.headers.get('location')).toBe('/apps/item/app-mixer')
    // 前の区分の URL でも、いまの URL へ
    expect((await get('/works/item/appmixer')).headers.get('location')).toBe('/apps/item/app-mixer')
    // 下書きにしたら、送る先ごと無い
    await db().update(schema.items).set({ published: 0 })
    expect((await get('/apps/item/appmixer')).status).toBe(404)
  })

  it('slug を変えたメンバーの前の URL は、同じ画面のいまの URL へ 301', async () => {
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
  固定のブロックが2行ある D1（PUB-1）。いまは DB の部分一意索引が2行目を拒むが、
  索引より前に二重送信でできた重複は残りうる。読む側（publishedBlocks）でも1行に
  絞り、ページャが自分自身を指して先へ進めない、を起こさない。
*/
describe('固定のブロックの重複', () => {
  it('2組ある構成でも、ページャは自分自身を指さず、全体ページの節も1つずつ', async () => {
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

      const nextOf = (html: string) =>
        html.match(/<a class="pager__go pager__go--next" href="([^"]+)" rel="next">/)?.[1] ?? null
      const visited: string[] = []
      for (let path: string | null = '/projects'; path && visited.length < 20; ) {
        visited.push(path)
        const next = nextOf(await (await get(path)).text())
        expect(next, `${path} の「次」が自分自身`).not.toBe(path)
        path = next
      }
      expect(visited).toEqual(['/projects', '/team', '/contact'])

      const whole = await (await get('/all')).text()
      for (const id of ['projects', 'team', 'contact']) {
        expect(whole.match(new RegExp(`id="${id}"`, 'g')), id).toHaveLength(1)
      }
    } finally {
      await db().delete(schema.blocks)
      await env.DB.prepare(index).run()
    }
  })
})
