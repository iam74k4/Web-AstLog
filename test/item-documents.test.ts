import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import { itemDocument } from '../src/blocks'
import { saveSiteSettings } from '../src/db/queries'
import * as schema from '../src/db/schema'
import { documentBlocks, documentLanguages } from '../src/lib/markdown'
import {
  db,
  form,
  get,
  okText,
  resetDb,
  TEST_SITE as SITE,
  seedItem,
  signIn,
  touch,
} from './helpers'

/*
  作品の文書のページ（プライバシーポリシー・サポート。src/domain.ts の ITEM_DOCUMENTS）。
  /apps/item/<slug>/privacy と …/support は、販売するアプリのバイナリと App Store Connect に
  登録する URL。書いた作品にだけ在り、空・下書きなら 404、前の URL は今の URL へ 301。
*/

beforeEach(resetDb)

const mainOf = (html: string) => (html.split(/<main[^>]*>/)[1] ?? '').split('</main>')[0] ?? ''
const footerOf = (html: string) => html.split('</main>')[1] ?? ''
const titleOf = (html: string) => html.match(/<title>([^<]*)<\/title>/)?.[1] ?? ''

const PRIVACY = [
  '最終更新日 / Last updated: 2026-10-20',
  '## 日本語',
  '### 収集する情報\n**AppMixer は、いかなる個人情報も収集、保存、送信しません。**',
  '### お問い合わせ\n本ポリシーに関するご質問は、[サポートのページ](/apps/item/appmixer/support)までお寄せください。',
  '## English',
  '### Information We Collect',
  '**AppMixer does not collect, store, or transmit any personal information.**',
].join('\n\n')

const SUPPORT = [
  'AppMixer についてのご質問・不具合の報告は、下のメールアドレスまでお寄せください。',
  '## よくある質問',
  '### 音量が変わらないアプリがあります\n- macOS 14.4 以降か確かめてください',
].join('\n\n')

const seedAppMixer = (overrides: Partial<typeof schema.items.$inferInsert> = {}) =>
  seedItem({
    title: 'AppMixer',
    slug: 'appmixer',
    summary: 'アプリごとに音量を変える常駐アプリ。',
    privacy: PRIVACY,
    support: SUPPORT,
    ...overrides,
  })

describe('文書の書き方', () => {
  it('行頭の ## は h2、### は h3。見出しの行は空行が無くても段落を切る', () => {
    expect(documentBlocks('## 日本語\n### 収集する情報\n本文です。\n\n- 一つ目\n- 二つ目')).toEqual(
      [
        { kind: 'heading', level: 2, text: '日本語' },
        { kind: 'heading', level: 3, text: '収集する情報' },
        {
          kind: 'part',
          blocks: [{ kind: 'paragraph', inlines: [{ kind: 'text', text: '本文です。' }] }],
        },
        {
          kind: 'part',
          blocks: [
            {
              kind: 'list',
              items: [[{ kind: 'text', text: '一つ目' }], [{ kind: 'text', text: '二つ目' }]],
            },
          ],
        },
      ],
    )
  })

  it('# の行と #### 以下、記号の後に空きの無い行は字のまま（h1 はページが持つ）', () => {
    for (const line of ['# 題', '#### 深い見出し', '##見出し', '#タグ']) {
      expect(documentBlocks(line), line).toEqual([
        { kind: 'part', blocks: [{ kind: 'paragraph', inlines: [{ kind: 'text', text: line }] }] },
      ])
    }
  })

  it('## が全部「日本語」「English」の文書だけを言語の節に分ける。前置きはどの言語でも', () => {
    const split = documentLanguages(
      documentBlocks('更新日\n\n## 日本語\n\n本文。\n\n## English\n\n### Heading\n\nBody.'),
    )
    expect(split?.preamble).toEqual([
      {
        kind: 'part',
        blocks: [{ kind: 'paragraph', inlines: [{ kind: 'text', text: '更新日' }] }],
      },
    ])
    expect(split?.sections.map((section) => [section.code, section.blocks.length])).toEqual([
      ['ja', 2],
      ['en', 3],
    ])
    // 言語の名前でない ## が混じる・1つの言語だけ・同じ言語が2度・字の違う「english」は分けない
    for (const text of [
      '## 日本語\n\nあ\n\n## English\n\nb\n\n## よくある質問\n\nc',
      '## 日本語\n\nあ',
      '## 日本語\n\nあ\n\n## English\n\nb\n\n## 日本語\n\nい',
      '## 日本語\n\nあ\n\n## english\n\nb',
    ]) {
      expect(documentLanguages(documentBlocks(text)), text).toBeNull()
    }
  })

  it('空白と空行だけの欄と、見出しだけの欄は、書いていないのと同じ', () => {
    const empty = { privacy: '', support: '' }
    expect(itemDocument({ ...empty, privacy: '  \n\n \n' }, 'privacy')).toEqual([])
    expect(itemDocument({ ...empty, privacy: '## 日本語\n\n### 節' }, 'privacy')).toEqual([])
    expect(itemDocument({ ...empty, support: '本文。' }, 'support')).toHaveLength(1)
    expect(itemDocument({ ...empty, support: '本文。' }, 'privacy')).toEqual([])
  })
})

describe('プライバシーポリシーのページ', () => {
  it('作品の URL の下に1ページ。h1 は文書の名前の1つで、作品名を添える', async () => {
    await seedAppMixer()
    const response = await get('/apps/item/appmixer/privacy')
    expect(response.status).toBe(200)
    // 公開ページの決まり（script なし）のまま
    expect(response.headers.get('content-security-policy')).toContain("script-src 'none'")
    const html = await response.text()
    const main = mainOf(html)

    expect(html.match(/<h1[^>]*>/g) ?? []).toHaveLength(1)
    expect(main).toContain(
      '<div class="head"><h1>Privacy Policy</h1><span class="note" lang="en">AppMixer</span></div>',
    )
    // 戻る手は作品のページへ
    expect(main).toContain('<a class="back" href="/apps/item/appmixer" lang="en">')
    expect(titleOf(html)).toBe(`AppMixer · Privacy Policy — ${SITE.name}`)
    expect(html).toContain(
      `<link rel="canonical" href="${SITE.origin}/apps/item/appmixer/privacy"/>`,
    )
    expect(html).toContain(
      '<meta name="description" content="AppMixer のプライバシーポリシーです。"/>',
    )
    // 構造化データは作品のページだけが持つ。このページは script を1本も持たない
    expect(html).not.toContain('<script')
  })

  it('「## 日本語」「## English」で分けた文書は、素の URL で日本語の節だけ。頭に切り替え', async () => {
    await seedAppMixer()
    const html = await okText('/apps/item/appmixer/privacy')
    const main = mainOf(html)
    // 切り替えは見出しのすぐ下。日本語は素の URL（アプリと App Store Connect の URL）、英語は ?lang=en
    expect(main).toContain(
      '<nav class="filters doc-languages" aria-label="Language"><a href="/apps/item/appmixer/privacy" hreflang="ja" lang="ja" aria-current="true">日本語</a><a href="/apps/item/appmixer/privacy?lang=en" hreflang="en" lang="en">English</a></nav>',
    )
    expect(main.indexOf('<h1>')).toBeLessThan(main.indexOf('doc-languages'))
    // 最初の言語の見出しより前（最終更新日）はどの言語でも出る
    expect(main).toContain('<div class="bio doc"><p>最終更新日 / Last updated: 2026-10-20</p>')
    // 言語の節の見出しは切り替えと同じ字なので、読み上げにだけ残す（h1 → h2 → h3 の段を保つ）
    expect(main).toContain('<h2 class="sr-only">日本語</h2>')
    expect(main).toContain('<h3 class="doc__head">収集する情報</h3>')
    expect(main).toContain(
      '<p><strong>AppMixer は、いかなる個人情報も収集、保存、送信しません。</strong></p>',
    )
    expect(main).toContain('<a href="/apps/item/appmixer/support">サポートのページ</a>')
    // 英語の節は出さない
    expect(main).not.toContain('Information We Collect')
    // プライバシーポリシーには連絡先の表を足さない（本文が問い合わせ先を言う）
    expect(main).not.toContain('contact-list')
  })

  it('?lang=en は英語の節だけ。本文に lang="en"。canonical は素の URL のまま', async () => {
    await seedAppMixer()
    const html = await okText('/apps/item/appmixer/privacy?lang=en')
    const main = mainOf(html)
    expect(main).toContain(
      '<a href="/apps/item/appmixer/privacy?lang=en" hreflang="en" lang="en" aria-current="true">English</a>',
    )
    expect(main).toContain(
      '<div class="bio doc" lang="en"><p>最終更新日 / Last updated: 2026-10-20</p>',
    )
    expect(main).toContain('<h2 class="sr-only">English</h2>')
    expect(main).toContain('<h3 class="doc__head" lang="en">Information We Collect</h3>')
    expect(main).toContain(
      '<p lang="en"><strong>AppMixer does not collect, store, or transmit any personal information.</strong></p>',
    )
    expect(main).not.toContain('収集する情報')
    expect(html.match(/<h1[^>]*>/g) ?? []).toHaveLength(1)
    expect(html).toContain(
      `<link rel="canonical" href="${SITE.origin}/apps/item/appmixer/privacy"/>`,
    )
    // 知らない言語は最初の節
    const unknown = mainOf(await okText('/apps/item/appmixer/privacy?lang=fr'))
    expect(unknown).toContain('収集する情報')
    expect(unknown).not.toContain('Information We Collect')
  })

  it('言語で分けていない文書は切り替えを置かず、全部をそのまま出す。## は目に見える h2', async () => {
    await seedAppMixer({
      privacy:
        '## 日本語\n\n本文です。\n\n## English\n\nBody.\n\n## よくある質問\n\n### 節\n答えです。',
    })
    const main = mainOf(await okText('/apps/item/appmixer/privacy'))
    expect(main).not.toContain('doc-languages')
    expect(main).toContain('<div class="head head--sub"><h2>日本語</h2></div>')
    expect(main).toContain('<div class="head head--sub"><h2 lang="en">English</h2></div>')
    expect(main).toContain('<p lang="en">Body.</p>')
    expect(main).toContain('<div class="head head--sub"><h2>よくある質問</h2></div>')
    expect(main).toContain('<h3 class="doc__head">節</h3>')
  })

  it('HTML は字のまま。受け取れない URL のリンクも字のまま', async () => {
    await seedAppMixer({ privacy: '<script>alert(1)</script>\n\n[押して](javascript:alert(1))' })
    const main = mainOf(await okText('/apps/item/appmixer/privacy'))
    expect(main).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(main).not.toContain('href="javascript:')
  })
})

describe('サポートのページ', () => {
  it('本文の下に、サイト設定の連絡先の表を必ず置く。足元には同じ行き先を出さない', async () => {
    await seedAppMixer()
    const html = await okText('/apps/item/appmixer/support')
    const main = mainOf(html)
    expect(html.match(/<h1[^>]*>/g) ?? []).toHaveLength(1)
    expect(main).toContain('<h1>Support</h1>')
    expect(main).toContain('<h3 class="doc__head">音量が変わらないアプリがあります</h3>')
    expect(main).toContain('<ul><li>macOS 14.4 以降か確かめてください</li></ul>')
    // 連絡先は本文のあと。Contact のページと同じ表
    expect(main).toContain('<div class="head head--sub"><h2>Contact</h2></div>')
    expect(main).toContain(
      `<a class="contact-list__link" href="mailto:${SITE.email}"><span class="contact-list__to">${SITE.email}</span></a>`,
    )
    // 誘いの1文は Contact のページだけ（サポートの表は本文の続き）
    expect(main).not.toContain('contact__lead')
    expect(main.indexOf('よくある質問')).toBeLessThan(main.indexOf('mailto:'))
    expect(main).toContain(`href="${SITE.github}"`)
    // 同じ行き先を1つのページに2つ置かない（Contact のページと同じ）
    expect(footerOf(html)).not.toContain('mailto:')
    expect(titleOf(html)).toBe(`AppMixer · Support — ${SITE.name}`)
    // 言語で分けたサポートは、どの言語でも本文の下に同じ表
    await seedAppMixer({
      slug: 'two',
      title: 'Two',
      support: '## 日本語\n\nメールでどうぞ。\n\n## English\n\nPlease email us.',
      sortOrder: 20,
    })
    for (const path of ['/apps/item/two/support', '/apps/item/two/support?lang=en']) {
      const two = mainOf(await okText(path))
      expect(two, path).toContain(`href="mailto:${SITE.email}"`)
      expect(two.indexOf('doc__'), path).toBeLessThan(two.indexOf('contact-list'))
    }
    expect(html).toContain(
      '<meta name="description" content="AppMixer のサポートと問い合わせ先です。"/>',
    )
  })

  it('連絡先が1つも無いサイトでは、表も見出しも置かない。足元はいつもどおり', async () => {
    await saveSiteSettings(db(), { ...SITE, email: '', github: '', x: '', discord: '' })
    await seedAppMixer()
    const html = await okText('/apps/item/appmixer/support')
    expect(mainOf(html)).not.toContain('<h2>Contact</h2>')
    expect(mainOf(html)).not.toContain('contact-list')
  })
})

describe('文書のページが無いとき・動いたとき', () => {
  it('欄が空の作品・下書きの作品・知らない slug は 404', async () => {
    await seedItem({ title: '空の作品', slug: 'empty', sortOrder: 10 })
    await seedAppMixer({ slug: 'draft', published: 0, sortOrder: 20 })
    await seedItem({ title: '片方だけ', slug: 'half', support: '本文です。', sortOrder: 30 })
    for (const path of [
      '/apps/item/empty/privacy',
      '/apps/item/empty/support',
      '/apps/item/draft/privacy',
      '/apps/item/draft/support',
      '/apps/item/nope/privacy',
      '/apps/item/half/privacy',
    ]) {
      expect((await get(path)).status, path).toBe(404)
    }
    expect((await get('/apps/item/half/support')).status).toBe(200)
  })

  it('前の slug はいまの URL の同じ文書へ、前の区分は1回でいまの文書へ 301（覚えさせない）', async () => {
    const item = await seedAppMixer()
    await db().insert(schema.itemSlugRedirects).values({ oldSlug: 'old-mixer', itemId: item.id })

    const moved = await get('/apps/item/old-mixer/privacy')
    expect(moved.status).toBe(301)
    expect(moved.headers.get('location')).toBe('/apps/item/appmixer/privacy')
    expect(moved.headers.get('cache-control')).toBe('no-cache')
    const kind = await get('/works/item/appmixer/support')
    expect(kind.status).toBe(301)
    expect(kind.headers.get('location')).toBe('/apps/item/appmixer/support')
    expect(kind.headers.get('cache-control')).toBe('no-cache')
    // 言語の切り替えは付けたまま送る
    expect((await get('/apps/item/old-mixer/privacy?lang=en')).headers.get('location')).toBe(
      '/apps/item/appmixer/privacy?lang=en',
    )
    expect((await get('/works/item/appmixer/support?lang=en')).headers.get('location')).toBe(
      '/apps/item/appmixer/support?lang=en',
    )
  })

  it('区分違いの URL でも、文書が空なら 404（書いていないページへ送らない）', async () => {
    await seedItem({ title: '空の作品', slug: 'empty' })
    expect((await get('/works/item/empty/privacy')).status).toBe(404)
  })

  it('下書きの作品の前の slug は、文書のページへも転送しない', async () => {
    const item = await seedAppMixer({ published: 0 })
    await db().insert(schema.itemSlugRedirects).values({ oldSlug: 'old-mixer', itemId: item.id })
    expect((await get('/apps/item/old-mixer/privacy')).status).toBe(404)
  })
})

describe('作品のページと sitemap', () => {
  it('作品のページの行き先に、書いた文書だけを並べる（サイトの中なので → 、別タブにしない）', async () => {
    await seedAppMixer({ support: '' })
    const main = mainOf(await okText('/apps/item/appmixer'))
    expect(main).toContain('<a href="/apps/item/appmixer/privacy">Privacy Policy</a>')
    expect(main).not.toContain('/apps/item/appmixer/support')

    await seedItem({ title: '文書の無い作品', slug: 'plain', sortOrder: 20 })
    const plain = mainOf(await okText('/apps/item/plain'))
    expect(plain).not.toContain('/privacy')
    expect(plain).not.toContain('Privacy Policy')
  })

  it('作品のリンクのあとに文書が並ぶ', async () => {
    const item = await seedAppMixer()
    await db()
      .insert(schema.itemLinks)
      .values({ itemId: item.id, label: 'App Store', url: 'https://apps.apple.com/app/id1' })
    await touch()
    const main = mainOf(await okText('/apps/item/appmixer'))
    expect(main.indexOf('App Store')).toBeLessThan(main.indexOf('Privacy Policy'))
    expect(main.indexOf('Privacy Policy')).toBeLessThan(main.indexOf('>Support<'))
  })

  it('sitemap には書いた文書のページだけを載せる', async () => {
    await seedAppMixer({ support: '  \n' })
    await seedItem({ title: '空の作品', slug: 'empty', sortOrder: 20 })
    await seedAppMixer({ title: '下書き', slug: 'draft', published: 0, sortOrder: 30 })
    const xml = await okText('/sitemap.xml')
    expect(xml).toContain(`<loc>${SITE.origin}/apps/item/appmixer/privacy</loc>`)
    expect(xml).not.toContain('/apps/item/appmixer/support')
    expect(xml).not.toContain('/apps/item/empty/')
    expect(xml).not.toContain('/apps/item/draft')
  })
})

describe('管理画面の欄', () => {
  it('どの作品の編集画面にも2つの欄がある。ヒントは貼るための絶対 URL', async () => {
    const item = await seedAppMixer({ support: '' })
    const signed = await signIn()
    const html = await (await signed(`/admin/items/${item.id}/edit`)).text()
    expect(html).toContain('プライバシーポリシーとサポートを書く')
    expect(html).toMatch(/<textarea[^>]*name="privacy"[^>]*>最終更新日/)
    expect(html).toMatch(/<textarea[^>]*name="support"[^>]*><\/textarea>/)
    expect(html).toContain(`${SITE.origin}/apps/item/appmixer/privacy に出る`)
    expect(html).toContain(`${SITE.origin}/apps/item/appmixer/support に出る`)
    expect(html).toContain(`サイト設定の連絡先（${SITE.email} など）が必ず出る`)
    // 書いた文書の数
    expect(html).toContain('<span class="form-details__status">1 ページ</span>')

    const work = await seedItem({ type: 'work', title: '業務', slug: 'job', sortOrder: 20 })
    const workHtml = await (await signed(`/admin/items/${work.id}/edit`)).text()
    expect(workHtml).toContain(`${SITE.origin}/works/item/job/privacy に出る`)
    // 新しい作品は slug がまだ無い
    const fresh = await (await signed('/admin/items/new?type=app')).text()
    expect(fresh).toContain(`${SITE.origin}/apps/item/&lt;slug&gt;/privacy に出る`)
  })

  it('保存すると文書のページができる。前に 404 を見ていても、保存の日から出る', async () => {
    const item = await seedItem({ title: 'SaifuLog', slug: 'saifulog', summary: '家計簿。' })
    expect((await get('/apps/item/saifulog/privacy')).status).toBe(404)

    const signed = await signIn()
    const saved = await signed(`/admin/items/${item.id}`, {
      method: 'POST',
      body: form({
        type: 'app',
        title: 'SaifuLog',
        summary: '家計簿。',
        privacy: '## 日本語\n\n個人情報を集めません。',
        support: 'ご質問はメールでどうぞ。',
        published: '1',
      }),
    })
    expect(saved.status).toBe(303)
    const row = await db().query.items.findFirst({ where: eq(schema.items.id, item.id) })
    expect(row?.privacy).toBe('## 日本語\n\n個人情報を集めません。')
    expect(row?.support).toBe('ご質問はメールでどうぞ。')
    expect(mainOf(await okText('/apps/item/saifulog/privacy'))).toContain('個人情報を集めません。')
    expect(mainOf(await okText('/apps/item/saifulog/support'))).toContain(`mailto:${SITE.email}`)

    // 空にして保存すると、ページは無くなる
    await signed(`/admin/items/${item.id}`, {
      method: 'POST',
      body: form({ type: 'app', title: 'SaifuLog', summary: '家計簿。', published: '1' }),
    })
    expect((await get('/apps/item/saifulog/privacy')).status).toBe(404)
  })

  it('弾かれた保存でも、打った文書は欄に残る', async () => {
    const item = await seedItem({ title: 'SaifuLog', slug: 'saifulog' })
    const signed = await signIn()
    const back = await signed(`/admin/items/${item.id}`, {
      method: 'POST',
      // 説明が空のまま公開しようとして止まる
      body: form({ type: 'app', title: 'SaifuLog', privacy: '残す文書です。', published: '1' }),
    })
    expect(back.status).toBe(400)
    expect(await back.text()).toMatch(
      /<textarea[^>]*name="privacy"[^>]*>残す文書です。<\/textarea>/,
    )
  })

  it('サイト設定にメールが無いままサポートを書いたら、欄で知らせる（保存は止めない）', async () => {
    await saveSiteSettings(db(), { ...SITE, email: '' })
    const item = await seedAppMixer()
    const signed = await signIn()
    const html = await (await signed(`/admin/items/${item.id}/edit`)).text()
    expect(html).toContain('サイト設定にメールアドレスがありません')
    expect(html).toContain('id="field-support-warning"')
  })
})

describe('管理プレビュー', () => {
  it('保存した作品のプレビューから文書のプレビューへ。下書きでも見える', async () => {
    const item = await seedAppMixer({ published: 0 })
    const signed = await signIn()
    const page = await (await signed(`/admin/preview/items/${item.id}`)).text()
    expect(page).toContain(`href="/admin/preview/items/${item.id}/privacy"`)
    expect(page).toContain(`href="/admin/preview/items/${item.id}/support"`)

    const privacy = await signed(`/admin/preview/items/${item.id}/privacy`)
    expect(privacy.status).toBe(200)
    expect(privacy.headers.get('cache-control')).toBe('private, no-store')
    const html = await privacy.text()
    expect(html).toContain('<h1>Privacy Policy</h1>')
    expect(html).toContain(`<a class="back" href="/admin/preview/items/${item.id}" lang="en">`)
    expect(html).not.toContain('<script')

    // 言語の切り替えはプレビューの URL のまま
    expect(html).toContain(`href="/admin/preview/items/${item.id}/privacy?lang=en"`)
    const english = await (await signed(`/admin/preview/items/${item.id}/privacy?lang=en`)).text()
    expect(english).toContain('Information We Collect')

    const support = await (await signed(`/admin/preview/items/${item.id}/support`)).text()
    expect(support).toContain(`mailto:${SITE.email}`)
  })

  it('空の文書のプレビューは 404。ログインしていなければ入れない', async () => {
    const item = await seedItem({ title: '空の作品', slug: 'empty' })
    const signed = await signIn()
    expect((await signed(`/admin/preview/items/${item.id}/privacy`)).status).toBe(404)
    const outside = await get(`/admin/preview/items/${item.id}/privacy`)
    expect(outside.status).not.toBe(200)
  })

  it('保存前の入力のプレビューには、文書の行き先を置かない', async () => {
    const item = await seedAppMixer()
    const signed = await signIn()
    const html = await (
      await signed(`/admin/preview/items/${item.id}`, {
        method: 'POST',
        body: form({ type: 'app', title: 'AppMixer', privacy: '本文です。' }),
      })
    ).text()
    expect(html).not.toContain('/privacy"')
  })
})
