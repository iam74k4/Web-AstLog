import { env } from 'cloudflare:test'
import markSvg from 'virtual:asset:noctifex-mark.svg'
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import { MEMBER_PER_SCREEN } from '../src/blocks'
import * as schema from '../src/db/schema'
import { publicRoutes } from '../src/routes/public'
import { SITE } from '../src/site'
import { splitPhrases } from '../src/ui/components'
import { MARK_POINTS } from '../src/ui/icons'
import { db, get, resetDb, seedItem, seedMember, signIn } from './helpers'

beforeEach(resetDb)

/*
  main の中だけを見る。柱（.rail）には同じ行き先のリンクが常に出ているので、
  ページ全体を見ると「本文にある」ことを確かめられない。
  開きタグを正規表現で読むのは、main が属性（tabindex）を持つため。
*/
const mainOf = (html: string) => html.split(/<main[^>]*>/)[1] ?? ''

// 目次（柱の中）だけを見る。同じ文字列は見出しにもページャにも出る
const tocOf = (html: string) => html.split('<nav class="toc"')[1]?.split('</nav>')[0] ?? ''

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
    // 固定の一覧を書くと、節を1つ外した日にここだけ古い名前を出し続ける
    expect(html).toContain('content="Projects · Team · Contact を1ページにまとめた全体版です。')
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
    await seedItem({ type: 'work', title: '続いている業務', year: '2024 —', sortOrder: 10 })
    await seedItem({ type: 'app', title: '新しいアプリ', year: '2026', sortOrder: 20 })
    await seedItem({ type: 'work', title: '年の無い業務', year: '', sortOrder: 20 })

    const html = await (await get('/all')).text()
    const order = ['新しいアプリ', '続いている業務', '古いアプリ', '年の無い業務'].map((title) =>
      html.indexOf(title),
    )
    expect(order.every((at) => at > 0)).toBe(true)
    // 年は頭の4桁で比べる（「2024 —」は 2024）。年を書いていない行は最後
    expect(order).toEqual([...order].sort((a, b) => a - b))
  })

  it('メンバーが1〜2人なら横長、3人以上ならグリッドにする', async () => {
    await seedMember()
    expect(await (await get('/all')).text()).toContain('member--wide')

    await seedMember({ slug: 'b', name: 'B' })
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

  it('Team の添えは分類の名詞ひとつ。人数は数えない', async () => {
    await seedMember()
    const one = await (await get('/team')).text()
    expect(one).toContain('<span class="note">メンバー</span>')
    // 複数いる前提の器に1人しか入っていないことを、自分で数えて告知していた
    expect(one).not.toContain('1 member')

    await seedMember({ slug: 'hoshino', name: '星野' })
    expect(await (await get('/team')).text()).not.toContain('2 members')
  })

  it('名乗りは入口の1画面だけ。めくった先には載せない', async () => {
    await seedMember()
    await seedItem()

    // 同じサイトの名乗りが画面の数だけ並ぶと、どれが本体か決められない
    expect(await (await get('/')).text()).toContain('application/ld+json')
    expect(await (await get('/apps')).text()).not.toContain('application/ld+json')
    expect(await (await get('/members/okazaki')).text()).toContain('application/ld+json')
    expect(await (await get('/members/okazaki/about')).text()).not.toContain('application/ld+json')
  })

  it('個人ページは、1人のあいだ worksFor を名乗らない', async () => {
    await seedMember()
    // トップが同じ URL を Person として名乗っているので、
    // ここで同じ URL の Organization を書くと1つの URL が2つの型を持つ
    expect(await (await get('/members/okazaki')).text()).not.toContain('worksFor')

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

    // 個人ページ：その人の URL
    const mine = await (await get('/members/okazaki')).text()
    expect(mine).toContain('"url":"https://noctifex.dev/members/okazaki"')

    // 2人目が公開されると器に戻り、member[] の中では各自の URL を名乗る
    await seedMember({ slug: 'hoshino', name: '星野' })
    const org = await (await get('/')).text()
    expect(org).toContain('"@type":"Organization"')
    expect(org).toContain('"url":"https://noctifex.dev/members/okazaki"')
    expect(org).toContain('"url":"https://noctifex.dev/members/hoshino"')
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
    expect(hero).toContain('<p class="hero__role">System Engineer</p>')
    for (const part of splitPhrases(SITE.heroLead)) {
      expect(hero).toContain(`>${part}</span>`)
    }
    /*
      画面の底に横いっぱいの帯を別の節として置いていたころは、見出しと帯の
      あいだに画面の半分ほどの空白ができていた
    */
    expect(hero).toContain('class="band"')
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

describe('入口の名乗り', () => {
  it('名乗るのは入口の見出しだけ。柱に名前を置かない（入口で2度並ぶ）', async () => {
    await seedMember({ name: '岡崎 昂功', role: 'System Engineer' })
    await seedItem()

    const top = await (await get('/')).text()
    expect(top.match(/<h1>(.*?)<\/h1>/)?.[1]?.replace(/<[^>]+>/g, '')).toBe('岡崎 昂功')

    // 柱はどの画面にも出る。職種は残し、名前だけを外す
    for (const path of ['/', '/projects', '/team', '/contact', '/all']) {
      const html = await (await get(path)).text()
      const rail = html.slice(html.indexOf('<aside class="rail"'), html.indexOf('</aside>'))
      expect(rail, path).not.toContain('identity__name')
      expect(rail, path).not.toContain('岡崎 昂功')
      expect(rail, path).toContain('<span class="identity__role">System Engineer</span>')
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

    for (const path of [
      '/',
      '/projects',
      '/team',
      '/contact',
      '/members/okazaki',
      '/members/okazaki/about',
      '/members/okazaki/skills',
      '/members/okazaki/career',
    ]) {
      expect(h1s(await (await get(path)).text()), path).toHaveLength(1)
    }
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

  it('日本語の中の英語の塊に lang="en"。日本語の見出しには付けない', async () => {
    await seedMember({ skillsText: 'LANGUAGES:\nC#\n\n言語:\nSQL' })

    const html = await (await get('/members/okazaki/skills')).text()
    // 印が無いと、日本語の音声エンジンがローマ字読みするか読み飛ばす
    expect(html).toContain('<h2 class="side-head" lang="en">LANGUAGES</h2>')
    // 打ち込んだ見出しなので、日本語のものに付けると今度はそちらが読めなくなる
    expect(html).toContain('<h2 class="side-head">言語</h2>')
  })

  it('一覧のカードの Profile ↗ にも印を付ける', async () => {
    await seedMember()
    expect(await (await get('/team')).text()).toContain('<span class="member__go" lang="en">')
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

  it('画面に出すのはボタン2つだけ。見出しは読み上げのためにだけ置く', async () => {
    /*
      字（見出し・リード文・アドレス）は描かない。ただし割られた画面は h1 を
      ちょうど1つ持つ決まり（WCAG 1.3.1）なので、見出しは .sr-only で残す。
      外すと、見出しで移動する人にはこの画面が「何も無い」画面になる
    */
    await seedMember()

    for (const path of ['/contact']) {
      const main = mainOf(await (await get(path)).text())
      const contact = main.slice(main.indexOf('<div class="contact">'))
      expect(contact.match(/<h1[^>]*>/g), path).toEqual(['<h1 class="sr-only">'])
      expect(contact, path).toContain('<h1 class="sr-only">Contact</h1>')
      // 画面に出る p は1つも無い（札・リード文・アドレスを置かない）
      expect(contact, path).not.toMatch(/<p\b/)
      expect(main, path).toContain('aria-label="Contact"')
    }
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
    expect(html).toContain('href="/team"')
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

  it('知らない slug は 404。1語目と種類の食い違いも 404', async () => {
    await seedItem({ type: 'app', title: 'AppMixer', slug: 'appmixer' })
    expect((await get('/apps/item/nosuch')).status).toBe(404)
    // 同じ作品に2つの URL を作らない（どちらが正かを canonical で名指し直すことになる）
    expect((await get('/works/item/appmixer')).status).toBe(404)
  })

  it('一覧のカードの題から行ける。slug の無い作品はリンクにしない', async () => {
    await seedItem({ title: 'AppMixer', slug: 'appmixer' })
    await seedItem({ title: 'まだ無いほう', sortOrder: 20 })

    const html = mainOf(await (await get('/projects')).text())
    // 一覧は1つにまとめたが、恒久リンクは区分の語（/apps/item/…）のまま。貼られた URL を変えない
    expect(html).toContain('<h3><a href="/apps/item/appmixer">AppMixer</a></h3>')
    // 当てにならない URL を出すくらいなら、リンクそのものを出さない
    expect(html).toContain('<h3>まだ無いほう</h3>')
  })

  it('1画面 = 1ドキュメントの作法に従う。連なりの外なのでページャは出ない', async () => {
    await seedItem({ title: 'AppMixer', slug: 'appmixer' })
    await seedItem({ title: 'AllTasks', slug: 'alltasks', sortOrder: 20 })
    await seedItem({ title: '三番目', slug: 'san', sortOrder: 30 })

    const html = await (await get('/apps/item/appmixer')).text()
    expect(html.match(/<h1[^>]*>/g) ?? []).toHaveLength(1)
    // 弁（overflow: auto）を開いたときに中身へ行けること
    expect(mainOf(html)).toContain('tabindex="0"')
    // めくる先が無い1枚に、通し番号もページャも出さない
    expect(html).not.toContain('class="pager"')
  })

  it('目次はサイトの画面のまま。印はその作品が載っている一覧に付く', async () => {
    await seedMember()
    await seedItem({ type: 'app', title: 'AppMixer', slug: 'appmixer' })
    await seedItem({ type: 'work', title: 'ある仕事', slug: 'shigoto' })

    const toc = tocOf(await (await get('/apps/item/appmixer')).text())
    // ここから戻る道は目次しか無いので、トップと同じ行き先を同じ順で出す
    expect(toc).toContain('href="/projects" aria-current="page"')
    expect(toc).toContain('href="/team"')
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

  it('この URL が何を指しているかを構造化データにも書く', async () => {
    await seedItem({ title: 'AppMixer', slug: 'appmixer', summary: '音を配る常駐アプリ。' })

    const html = await (await get('/apps/item/appmixer')).text()
    expect(html).toContain('"@type":"CreativeWork"')
    expect(html).toContain('"name":"AppMixer"')
    expect(html).toContain(`"url":"${SITE.origin}/apps/item/appmixer"`)
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

  it('個人ページは Team の続き。← Team から入り、Contact → へ抜ける', async () => {
    /*
      以前は個人ページの中で閉じた連なりで、1枚目には「←」が無く（Team へ
      戻れない）、最後はその人だけの Contact だった。いまはサイトの列の Team の
      直後に差し込んだ列でめくる
    */
    await seedMember(FULL)

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

  it('柱と目次はサイトのまま。目次は Team に印を付ける', async () => {
    // 個人ページ専用の柱と目次に丸ごと入れ替わると、別のサイトへ飛んだように見える
    await seedMember(FULL)

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

  it('割られた画面でも、節の中で数える。目次の印は Team に1つだけ', async () => {
    const per = MEMBER_PER_SCREEN.career
    await seedMember({ careerText: rows(per + 1, (i) => `2024.0${i} | できごと${i}`) })

    const html = await (await get('/members/okazaki/career/2')).text()
    expect(html).toContain('<span class="pager__section">Career</span>')
    expect(html).toContain('<span class="pager__of">2 / 2</span>')
    // 目次はサイトのもの。Career の行は無く、印は Team に1つ
    expect(tocOf(html)).not.toContain('Career')
    expect(html).toContain('<a href="/team" aria-current="page">Team</a>')
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

    for (const path of [
      '/',
      '/projects',
      '/team',
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

  it('ログイン試行の記録は読ませない', async () => {
    // 同じ KV に置いているので、キーの形を縛らないと漏れる
    await env.MEDIA.put('login:someone@example.com', '3')
    expect((await get('/images/login:someone@example.com')).status).toBe(404)
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
      expect(html, path).toContain('<a href="/all">全体を1ページで見る ↗</a>')
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
      ['/team', '/admin/members'],
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

  it('画面ごとに違う説明文を出す。同じ1文を配らない', async () => {
    await seedMember({ skillsText: 'C# | 3年以上', careerText: '2024.03 | 入社 | ある会社' })
    await seedItem({ type: 'app' })
    await seedItem({ type: 'work' })

    const paths = [
      '/',
      '/projects',
      '/team',
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
      metricNote: '見込み 40人日 → 実績',
    })

    /*
      このサイトでいちばん強い一文は .metric にしかなく、検索結果にも貼られた
      カードにも1文字も出ていなかった。並べる順はカードのまま（値・単位・添え）
    */
    expect(descriptionOf(await (await get('/projects')).text())).toBe(
      'つくったもの 1 件。業務。開発工程の効率化（20 人日 見込み 40人日 → 実績）',
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
