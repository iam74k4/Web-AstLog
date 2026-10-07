import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import { loadSiteSettings, loadTheme } from '../src/db/queries'
import * as schema from '../src/db/schema'
import { SITE_VERSION_KEY } from '../src/lib/page-cache'
import {
  db,
  form,
  get,
  okText,
  resetDb,
  seedItem,
  seedMember,
  signIn,
  TEST_SITE,
  touch,
} from './helpers'
import { file, png, svg } from './images'

beforeEach(resetDb)

const mainOf = (html: string) => html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/)?.[1]

async function previewText(response: Response) {
  expect(response.status).toBe(200)
  expect(response.headers.get('cache-control')).toBe('private, no-store')
  expect(response.headers.get('x-robots-tag')).toContain('noindex')
  expect(response.headers.get('content-security-policy')).toContain("script-src 'none'")
  const html = await response.text()
  expect(html).toContain('<meta name="robots" content="noindex, nofollow, noarchive"')
  expect(html).toContain('/preview.css?v=')
  expect(html).not.toContain('<script')
  expect(html).not.toContain('<iframe')
  expect(html).not.toContain('rel="canonical"')
  expect(html).not.toContain('property="og:')
  return html
}

// 行数や画像キーだけでなく、アプリの全行・KVの中身も保存前後で比べる。
// _cf_ はD1内部の管理表で、アプリからの読み取りを許されていない。
async function previewStorageState() {
  const tables = await env.DB.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT GLOB 'sqlite_*' AND name NOT GLOB '_cf_*' ORDER BY name",
  ).all<{ name: string }>()
  const database = await Promise.all(
    tables.results.map(async ({ name }) => ({
      name,
      rows: (await env.DB.prepare(`SELECT * FROM "${name.replaceAll('"', '""')}"`).all()).results
        .map((row) => JSON.stringify(row))
        .sort(),
    })),
  )
  const keys = (await env.MEDIA.list()).keys.sort((a, b) => a.name.localeCompare(b.name))
  const media = await Promise.all(
    keys.map(async (key) => ({
      ...key,
      bytes: Array.from(
        new Uint8Array((await env.MEDIA.get(key.name, 'arrayBuffer')) ?? new ArrayBuffer(0)),
      ),
    })),
  )
  return { database, media }
}

describe('管理プレビューの認証と非公開', () => {
  it('Cookieやqueryだけでは下書きを読めず、ログインへ送る', async () => {
    const member = await seedMember({ published: 0, name: '下書きの人' })
    const item = await seedItem({ published: 0, slug: 'private-item', title: '下書きの作品' })
    const [block] = await db()
      .insert(schema.blocks)
      .values({ type: 'note', body: '秘密のメモ', published: 0 })
      .returning()
    const paths = [
      '/admin/preview?screen=hero',
      `/admin/preview/members/${member.id}`,
      `/admin/preview/items/${item.id}`,
      `/admin/preview/blocks/${block?.id}?published=1`,
    ]
    for (const path of paths) {
      const response = await get(path)
      expect(response.status).toBe(303)
      expect(response.headers.get('location')).toMatch(/^\/admin\/login\?next=/)
      expect(response.headers.get('cache-control')).toBe('private, no-store')
      expect(await response.text()).not.toContain('下書き')
    }
    const unauthenticatedPost = await get('/admin/preview/site', {
      method: 'POST',
      body: form(TEST_SITE),
    })
    expect(unauthenticatedPost.status).toBe(303)
  })

  it('認証後も外部サイトからのPOSTは拒否する', async () => {
    const fetch = await signIn()
    const response = await fetch('/admin/preview/appearance', {
      method: 'POST',
      body: form({ accent: 'rose', typeface: 'mono' }),
      headers: { origin: 'https://other.example' },
    })
    expect(response.status).toBe(403)
  })

  it.each(['members', 'items', 'blocks'])(
    '%sの不正なIDは別の行へ丸めず404にする',
    async (resource) => {
      const fetch = await signIn()
      for (const id of ['0', '01', '1x', '-1', '9007199254740992']) {
        const response = await fetch(`/admin/preview/${resource}/${id}`)
        expect(response.status).toBe(404)
      }
    },
  )
})

describe('保存済みの公開画面と下書き', () => {
  it('全体の本文は公開/allと一致し、下書きは混ざらずDB初期化もしない', async () => {
    await seedMember({ bio: '公開プロフィール' })
    await seedItem({ slug: 'public-item', summary: '公開の作品' })
    await seedItem({ slug: 'private-item', title: '秘密の作品', published: 0 })
    await seedMember({ slug: 'private-person', name: '秘密の人', published: 0 })
    const publicHtml = await okText('/all')
    const fetch = await signIn()
    const version = await env.MEDIA.get(SITE_VERSION_KEY)
    const html = await previewText(await fetch('/admin/preview'))
    expect(mainOf(html)).toBe(mainOf(publicHtml))
    expect(mainOf(html)).toBeTruthy()
    expect(html).not.toContain('秘密の作品')
    expect(html).not.toContain('秘密の人')
    expect(await db().select().from(schema.blocks)).toEqual([])
    expect(await env.MEDIA.get(SITE_VERSION_KEY)).toBe(version)
  })

  it('下書きのメンバーを表示しても公開URLには出ない', async () => {
    const member = await seedMember({
      published: 0,
      name: '未公開の名前',
      slug: 'draft-person',
      headline: '保存済みの見出し',
      bio: '保存済みの自己紹介',
    })
    const fetch = await signIn()
    const html = await previewText(await fetch(`/admin/preview/members/${member.id}`))
    expect(html).toContain('未公開の名前')
    expect(html).toContain('保存済みの自己紹介')
    expect(html).toContain('保存済みの下書きです')
    expect(html).not.toContain('href="/members/draft-person"')
    expect((await get('/members/draft-person')).status).toBe(404)
    expect((await db().select().from(schema.members))[0]?.published).toBe(0)
  })

  it('下書きの作品も公開と共有の本文・Storyで描く', async () => {
    const item = await seedItem({
      slug: 'draft-item',
      published: 0,
      title: '未公開作品',
      summary: '保存した要約',
      body: 'まだ公開しない本文',
    })
    const fetch = await signIn()
    const html = await previewText(await fetch(`/admin/preview/items/${item.id}`))
    expect(html).toContain('未公開作品')
    expect(html).toContain('保存した要約')
    expect(html).toContain('まだ公開しない本文')
    expect(html).toContain('id="story"')
    expect(html).not.toContain('href="/apps/item/draft-item"')
    expect((await get('/apps/item/draft-item')).status).toBe(404)
  })

  it('2人以上のプロフィールは公開と同じ担当作品のBandを描き、目次も管理プレビューに留まる', async () => {
    const member = await seedMember()
    await seedMember({ slug: 'second', name: '二人目' })
    await seedItem({ memberId: member.id, slug: 'member-app' })
    const fetch = await signIn()
    const html = await previewText(await fetch(`/admin/preview/members/${member.id}`))
    expect(html).toContain('このメンバーのつくったもの')
    expect(html).toContain('href="/admin/preview?screen=team"')
    expect((await fetch('/admin/preview?screen=team')).status).toBe(200)
    expect(await okText(`/members/${member.slug}`)).toContain('このメンバーのつくったもの')
  })

  it('下書きのブロックは単体だけで表示し、全体には混ぜない', async () => {
    const [block] = await db()
      .insert(schema.blocks)
      .values({ type: 'note', title: '非公開メモ', body: 'メモの本文', published: 0 })
      .returning()
    await touch()
    const fetch = await signIn()
    const version = await env.MEDIA.get(SITE_VERSION_KEY)
    const html = await previewText(await fetch(`/admin/preview/blocks/${block?.id}`))
    expect(html).toContain('非公開メモ')
    expect(html).toContain('メモの本文')
    const whole = await previewText(await fetch('/admin/preview'))
    expect(whole).not.toContain('メモの本文')
    expect((await get(`/block-${block?.id}`)).status).toBe(404)
    expect((await db().select().from(schema.blocks))[0]?.published).toBe(0)
    expect(await env.MEDIA.get(SITE_VERSION_KEY)).toBe(version)
  })

  it('空のブロックにも公開されない理由を出す', async () => {
    const [block] = await db()
      .insert(schema.blocks)
      .values({ type: 'links', published: 0 })
      .returning()
    const fetch = await signIn()
    const html = await previewText(await fetch(`/admin/preview/blocks/${block?.id}`))
    expect(html).toContain('公開対象の内容がありません')
  })
})

describe('保存前のサイト設定・見た目', () => {
  it.each(['multipart', 'urlencoded'])(
    '%sのサイト設定をContactに反映し、DBと内容の版は変えない',
    async (encoding) => {
      const fetch = await signIn()
      const version = await env.MEDIA.get(SITE_VERSION_KEY)
      const savedSite = await loadSiteSettings(db())
      const values = {
        ...TEST_SITE,
        contactLead: '編集中のContactです',
        email: 'preview@example.test',
        previewScreen: 'contact',
      }
      const response = await fetch('/admin/preview/site', {
        method: 'POST',
        body: encoding === 'multipart' ? form(values) : new URLSearchParams(values),
      })
      const html = await previewText(response)
      expect(html).toContain('編集中のContactです')
      expect(html).toContain('mailto:preview@example.test')
      expect(html).toContain('class="orbital')
      expect(html).toContain('このプレビューでは保存されません')
      expect(await loadSiteSettings(db())).toEqual(savedSite)
      expect(await env.MEDIA.get(SITE_VERSION_KEY)).toBe(version)
      expect(await okText('/contact')).not.toContain('編集中のContactです')
    },
  )

  it('見た目の保存前プレビューは既定の入口で軌道図と選択色・書体を描く', async () => {
    await seedItem({ slug: 'app' })
    const fetch = await signIn()
    const version = await env.MEDIA.get(SITE_VERSION_KEY)
    const response = await fetch('/admin/preview/appearance', {
      method: 'POST',
      body: form({ accent: 'rose', typeface: 'mono' }),
    })
    const html = await previewText(response)
    expect(html).toContain('data-accent="rose"')
    expect(html).toContain('data-typeface="mono"')
    expect(html).toContain('class="hero hero--orbit"')
    expect(html).not.toContain('data-whole=')
    expect(await loadTheme(db())).toEqual({ accent: 'mono', typeface: 'sans' })
    expect(await env.MEDIA.get(SITE_VERSION_KEY)).toBe(version)
  })

  it.each(['hero', 'projects', 'team', 'contact', 'all'])(
    '保存前プレビューの%s表示を選択できる',
    async (screen) => {
      await seedItem({ slug: 'app' })
      const fetch = await signIn()
      const html = await previewText(
        await fetch('/admin/preview/appearance', {
          method: 'POST',
          body: form({ accent: 'mint', typeface: 'serif', previewScreen: screen }),
        }),
      )
      expect(html).toContain('data-accent="mint"')
      expect(html.includes('data-whole=""')).toBe(screen === 'all')
      expect((await fetch(`/admin/preview?screen=${screen}`)).status).toBe(200)
    },
  )

  it('見た目とサイト設定の両方にProfile / Teamと表示人数の説明を出す', async () => {
    const fetch = await signIn()
    for (const path of ['/admin/appearance', '/admin/site']) {
      const response = await fetch(path)
      expect(response.status).toBe(200)
      const html = await response.text()
      expect(html).toContain('<option value="team">Profile / Team</option>')
      expect(html).toContain('公開中のメンバーが1人ならプロフィール、複数ならメンバー一覧です')
      expect(html).toContain('画面の選択は設定として保存されません')
    }
  })

  const previewValues = (target: string): Record<string, string> =>
    target === 'appearance'
      ? { accent: 'rose', typeface: 'serif', previewScreen: 'team' }
      : {
          ...TEST_SITE,
          tagline: '保存前のサイト紹介',
          email: 'preview-profile@example.test',
          previewScreen: 'team',
        }

  it.each(['appearance', 'site'])(
    '%sのProfileプレビューは大きな天体と未保存設定を反映し、DB・KV全体を変えない',
    async (target) => {
      await seedMember({
        headline: 'プロフィールの表紙',
        bio: '公開中の自己紹介',
        celestialBody: 'saturn',
        celestialAccent: 'inherit',
      })
      await seedMember({ slug: 'draft-person', name: '未公開の人', published: 0 })
      await env.MEDIA.put('avatars/profile-kept.png', png(), {
        metadata: { contentType: 'image/png' },
      })
      const fetch = await signIn()
      const before = await previewStorageState()
      const html = await previewText(
        await fetch(`/admin/preview/${target}`, {
          method: 'POST',
          body: form(previewValues(target)),
        }),
      )
      expect(html).toContain('プレビュー · Profile')
      expect(html).toContain('hero--profile')
      expect(html).toContain('class="celestial celestial--art"')
      expect(html).toContain('data-celestial-body="saturn"')
      expect(html).toContain('プロフィールの表紙')
      expect(html).toContain('公開中の自己紹介')
      expect(html).not.toContain('未公開の人')
      expect(html).toContain('このプレビューでは保存されません')
      if (target === 'appearance') {
        expect(html).toContain('data-accent="rose"')
        expect(html).toContain('data-typeface="serif"')
      } else {
        expect(html).toContain('保存前のサイト紹介')
        expect(html).toContain('mailto:preview-profile@example.test')
      }
      expect(await previewStorageState()).toEqual(before)
      const saved = await previewText(await fetch('/admin/preview?screen=team'))
      expect(saved).toContain('data-accent="mono"')
      expect(saved).toContain('data-typeface="sans"')
      expect(saved).not.toContain('保存前のサイト紹介')
      expect(saved).not.toContain('mailto:preview-profile@example.test')
    },
  )

  it.each(['appearance', 'site'])(
    '%sのTeamプレビューは公開中の複数人を表示し、下書きや永続設定を変えない',
    async (target) => {
      await seedMember({ name: '公開の一人目', celestialBody: 'moon' })
      await seedMember({ slug: 'second', name: '公開の二人目', celestialBody: 'sun' })
      await seedMember({ slug: 'draft-person', name: '未公開の人', published: 0 })
      const fetch = await signIn()
      const before = await previewStorageState()
      const html = await previewText(
        await fetch(`/admin/preview/${target}`, {
          method: 'POST',
          body: form(previewValues(target)),
        }),
      )
      expect(html).toContain('プレビュー · Team')
      expect(html).toContain('id="team"')
      expect(html).toContain('class="team-list"')
      expect(html).toContain('公開の一人目')
      expect(html).toContain('公開の二人目')
      expect(html).not.toContain('未公開の人')
      expect(html).not.toContain('celestial--art')
      if (target === 'appearance') {
        expect(html).toContain('data-accent="rose"')
        expect(html).toContain('data-typeface="serif"')
      } else {
        expect(html).toContain('保存前のサイト紹介')
        expect(html).toContain('mailto:preview-profile@example.test')
      }
      expect(await previewStorageState()).toEqual(before)
    },
  )

  it.each(['empty', 'disabled'])(
    '%sのProfile / Teamには表示対象がない理由を示し、DB・KVを変えない',
    async (state) => {
      if (state === 'empty') {
        await seedMember({ published: 0, name: '未公開の人' })
      } else {
        await seedMember({ name: '公開の人' })
        await db().insert(schema.blocks).values({ type: 'team', published: 0 })
      }
      const fetch = await signIn()
      const before = await previewStorageState()
      for (const target of ['appearance', 'site']) {
        const html = await previewText(
          await fetch(`/admin/preview/${target}`, {
            method: 'POST',
            body: form(previewValues(target)),
          }),
        )
        expect(mainOf(html)).toContain('公開対象の内容がありません')
        expect(mainOf(html)).not.toContain('公開の人')
        expect(mainOf(html)).not.toContain('未公開の人')
        expect(html).not.toContain('celestial--art')
      }
      expect(await previewStorageState()).toEqual(before)
    },
  )

  it('不正な宛先・プリセット・表示対象・壊れた本文を400で返し、保存しない', async () => {
    const fetch = await signIn()
    const version = await env.MEDIA.get(SITE_VERSION_KEY)
    const savedSite = await loadSiteSettings(db())
    const invalid = [
      { path: '/admin/preview/site', body: form({ ...TEST_SITE, github: 'javascript:alert(1)' }) },
      {
        path: '/admin/preview/site',
        body: form({ ...TEST_SITE, email: 'a@example.test?subject=bad' }),
      },
      { path: '/admin/preview/appearance', body: form({ accent: 'unknown', typeface: 'sans' }) },
      {
        path: '/admin/preview/appearance',
        body: form({ accent: 'mono', typeface: 'sans', previewScreen: 'unknown' }),
      },
    ]
    for (const { path, body } of invalid) {
      const response = await fetch(path, { method: 'POST', body })
      expect(response.status).toBe(400)
      expect(response.headers.get('cache-control')).toBe('private, no-store')
    }
    const malformed = await fetch('/admin/preview/site', {
      method: 'POST',
      headers: { 'content-type': 'multipart/form-data; boundary=broken' },
      body: 'invalid',
    })
    expect(malformed.status).toBe(400)
    const json = await fetch('/admin/preview/site', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    })
    expect(json.status).toBe(400)
    expect(await loadTheme(db())).toEqual({ accent: 'mono', typeface: 'sans' })
    expect(await loadSiteSettings(db())).toEqual(savedSite)
    expect(await env.MEDIA.get(SITE_VERSION_KEY)).toBe(version)
  })
})

describe('保存前プレビューから編集を続ける案内', () => {
  it('未保存の入力は元のタブで続け、保存済みのプレビューには編集リンクを出す', async () => {
    const fetch = await signIn()
    const unsaved = await previewText(
      await fetch('/admin/preview/site', {
        method: 'POST',
        body: form({ ...TEST_SITE, tagline: '保存前だけの紹介' }),
      }),
    )
    expect(unsaved).toContain('編集を続けるにはプレビューを閉じてください')
    expect(unsaved).not.toContain('編集画面を開く ↗')
    expect(unsaved).not.toContain('href="/admin/site"')
    expect(unsaved).toContain('保存前だけの紹介')
    expect(unsaved).toContain('ほかの画面へ移動すると保存済みの内容を表示します')
    expect(unsaved).toContain(
      '<a href="/admin/preview" target="_blank" rel="noreferrer">保存済みの全体プレビュー ↗</a>',
    )
    const saved = await previewText(await fetch('/admin/preview'))
    expect(saved).toContain('編集画面を開く ↗')
    expect(saved).toContain('href="/admin"')
    expect(saved).not.toContain('保存前だけの紹介')
    expect(saved).not.toContain('保存済みの全体プレビュー ↗')
    const savedScreen = await previewText(await fetch('/admin/preview?screen=hero'))
    expect(savedScreen).toContain('<a href="/admin/preview">全体を1ページで見る →</a>')
  })

  it('設定の入力エラーは欄ごとの理由と元のタブへの案内を示し、設定を変えない', async () => {
    const fetch = await signIn()
    const site = await loadSiteSettings(db())
    const theme = await loadTheme(db())
    const version = await env.MEDIA.get(SITE_VERSION_KEY)
    const cases = [
      {
        path: '/admin/preview/site',
        body: form({ ...TEST_SITE, tagline: '', heroLead: '' }),
        messages: ['サイトの一言: 文を入れてください', '入口の紹介文: 文を入れてください'],
      },
      {
        path: '/admin/preview/appearance',
        body: form({ accent: 'unknown', typeface: 'sans' }),
        messages: ['アクセント色を選び直してください'],
      },
      {
        path: '/admin/preview/appearance',
        body: form({ accent: 'mono', typeface: 'sans', previewScreen: 'unknown' }),
        messages: ['プレビューする画面を選び直してください'],
      },
    ]
    for (const { path, body, messages } of cases) {
      const response = await fetch(path, { method: 'POST', body })
      expect(response.status).toBe(400)
      expect(response.headers.get('cache-control')).toBe('private, no-store')
      const html = await response.text()
      expect(html).toContain('編集していたタブに戻り、入力を修正してください')
      expect(html).toContain('編集を続けるにはプレビューを閉じてください')
      expect(html).not.toContain('編集画面を開く ↗')
      for (const message of messages) expect(html).toContain(message)
    }
    expect(await loadSiteSettings(db())).toEqual(site)
    expect(await loadTheme(db())).toEqual(theme)
    expect(await env.MEDIA.get(SITE_VERSION_KEY)).toBe(version)
  })
})

const mediaNames = async () => (await env.MEDIA.list()).keys.map((key) => key.name).sort()

describe('プロフィールのプレビューと公開予定の文脈', () => {
  it('担当作品のBandは担当者のprivate一覧へ移り、絞り込みのUIと目次も同じ条件を保つ', async () => {
    const member = await seedMember()
    const other = await seedMember({ slug: 'other', name: '別の担当者' })
    await seedItem({ slug: 'own-app', title: '本人の個人開発', memberId: member.id })
    await seedItem({ slug: 'own-work', type: 'work', title: '本人の業務', memberId: member.id })
    await seedItem({ slug: 'other-app', title: '別担当の作品', memberId: other.id })
    await seedItem({ slug: 'draft-app', title: '未公開の作品', published: 0, memberId: member.id })
    const fetch = await signIn()
    const profile = await previewText(await fetch(`/admin/preview/members/${member.id}`))
    const href = `/admin/preview/projects?member=${member.slug}`
    expect(profile).toContain(`href="${href}"`)
    const listed = await previewText(await fetch(href))
    expect(listed).toContain('本人の個人開発')
    expect(listed).toContain('本人の業務')
    expect(listed).not.toContain('別担当の作品')
    expect(listed).not.toContain('未公開の作品')
    expect(listed).toContain('href="/admin/preview/projects?kind=work&amp;member=okazaki"')
    expect(listed).toContain(`href="${href}"`)
    const work = await previewText(await fetch(`${href}&kind=work`))
    expect(work).toContain('本人の業務')
    expect(work).not.toContain('本人の個人開発')
    expect(work).toContain('href="/admin/preview/projects?kind=work&amp;member=okazaki"')
    const whole = await previewText(await fetch(`/admin/preview?member=${member.slug}&kind=work`))
    expect(whole).toContain('本人の個人開発')
    expect(whole).toContain('別担当の作品')
    expect(whole).not.toContain('未公開の作品')
  })

  it('未保存メンバーの名前・肩書き・公開チェックに合わせて足元を描き、他のGETは保存内容だけを表示する', async () => {
    const member = await seedMember({ name: '現在の名前', role: '現在の肩書き' })
    const fetch = await signIn()
    const version = await env.MEDIA.get(SITE_VERSION_KEY)
    const values = { name: '保存前の名前', role: '保存前の肩書き', slug: member.slug }
    const checked = await previewText(
      await fetch(`/admin/preview/members/${member.id}`, {
        method: 'POST',
        body: form({ ...values, published: '1' }),
      }),
    )
    const checkedFooter = checked.match(/<footer\b[^>]*>([\s\S]*?)<\/footer>/)?.[1]
    expect(checkedFooter).toContain('保存前の名前')
    expect(checkedFooter).toContain('保存前の肩書き')
    expect(checkedFooter).not.toContain('現在の名前')
    const draft = await previewText(
      await fetch(`/admin/preview/members/${member.id}`, { method: 'POST', body: form(values) }),
    )
    const draftFooter = draft.match(/<footer\b[^>]*>([\s\S]*?)<\/footer>/)?.[1]
    expect(draftFooter).not.toContain('保存前の名前')
    expect(draftFooter).not.toContain('現在の名前')
    expect(draftFooter).toContain('AstLog')
    const saved = await previewText(await fetch('/admin/preview'))
    expect(saved).toContain('現在の名前')
    expect(saved).not.toContain('保存前の名前')
    const publicHtml = await okText(`/members/${member.slug}`)
    expect(publicHtml).toContain('現在の名前')
    expect(publicHtml).not.toContain('保存前の名前')
    expect(await db().select().from(schema.members)).toEqual([member])
    expect(await env.MEDIA.get(SITE_VERSION_KEY)).toBe(version)
  })
})

describe('メンバーと作品の保存前プレビュー', () => {
  it('新規メンバーの未保存文と画像を表示し、フォームの札も消費しない', async () => {
    const fetch = await signIn()
    const version = await env.MEDIA.get(SITE_VERSION_KEY)
    const keys = await mediaNames()
    const body = form({
      name: '編集中の人',
      headline: 'まだ保存していない見出し',
      bio: 'まだ保存していない自己紹介',
      formKey: '1234567890abcdef',
      published: '1',
    })
    body.set('avatar', file(png(100, 100), 'avatar.png', 'image/png'))
    const response = await fetch('/admin/preview/members', { method: 'POST', body })
    expect(response.headers.get('content-security-policy')).toContain("img-src 'self' data:")
    const html = await previewText(response)
    expect(html).toContain('まだ保存していない自己紹介')
    expect(html).toContain('src="data:image/png;base64,')
    expect(html).not.toContain('公開中の画面を見る')
    expect(await db().select().from(schema.members)).toEqual([])
    expect(await db().select().from(schema.memberSlugRedirects)).toEqual([])
    expect(await mediaNames()).toEqual(keys)
    expect(await env.MEDIA.get(SITE_VERSION_KEY)).toBe(version)
  })

  it('公開中メンバーの変更を保存せず、公開プロフィールと画像を維持する', async () => {
    const member = await seedMember({
      bio: '公開中の自己紹介',
      avatarUrl: '/images/avatars/existing.png',
    })
    const fetch = await signIn()
    const version = await env.MEDIA.get(SITE_VERSION_KEY)
    const html = await previewText(
      await fetch(`/admin/preview/members/${member.id}`, {
        method: 'POST',
        body: form({ name: member.name, slug: 'changed', bio: '保存前の自己紹介', published: '1' }),
      }),
    )
    expect(html).toContain('保存前の自己紹介')
    expect(html).toContain('/images/avatars/existing.png')
    expect(await db().select().from(schema.members)).toEqual([member])
    expect(await db().select().from(schema.memberSlugRedirects)).toEqual([])
    expect(await env.MEDIA.get(SITE_VERSION_KEY)).toBe(version)
    expect(await okText(`/members/${member.slug}`)).toContain('公開中の自己紹介')
  })

  it('新規作品は見出し・リンク・Story・複数画像を同じ公開部品で表示し、保存しない', async () => {
    const fetch = await signIn()
    const keys = await mediaNames()
    const version = await env.MEDIA.get(SITE_VERSION_KEY)
    const body = form({
      type: 'work',
      title: '保存前の業務',
      summary: '保存前の説明',
      category: 'Web開発',
      year: '２０２６',
      storyApproach: '保存前の取り組み',
      tags: 'TypeScript, SQL',
      linkLabel: 'Repository',
      linkUrl: 'https://github.com/example/project',
      imageAlt: '画面の説明',
      newShotAlt: '追加画像の説明',
      published: '1',
      formKey: 'abcdef1234567890',
    })
    body.set('image', file(png(600, 400), 'main.png', 'image/png'))
    body.set('icon', file(png(100, 100), 'icon.png', 'image/png'))
    body.set('newShot', file(png(400, 600), 'new.png', 'image/png'))
    const html = await previewText(await fetch('/admin/preview/items', { method: 'POST', body }))
    expect(html).toContain('保存前の業務')
    expect(html).toContain('保存前の取り組み')
    expect(html).toContain('https://github.com/example/project')
    expect(html).toContain('追加画像の説明')
    expect(html).toContain('2026')
    expect(html.match(/src="data:image\/png;base64,/g)?.length).toBeGreaterThanOrEqual(3)
    expect(html).not.toContain('公開中の画面を見る')
    for (const table of [
      schema.items,
      schema.itemShots,
      schema.itemLinks,
      schema.itemTags,
      schema.itemSlugRedirects,
    ]) {
      expect(await db().select().from(table)).toEqual([])
    }
    expect(await mediaNames()).toEqual(keys)
    expect(await env.MEDIA.get(SITE_VERSION_KEY)).toBe(version)
  })

  it('画像の削除・追加・並べ替えは保存と同じ計画で描き、既存ファイルを消さない', async () => {
    const item = await seedItem({
      slug: 'existing',
      imageUrl: '/images/items/main.png',
      iconUrl: '/images/items/icon.png',
    })
    const shots = await db()
      .insert(schema.itemShots)
      .values([
        { itemId: item.id, url: '/images/items/first.png', alt: '最初', sortOrder: 10 },
        { itemId: item.id, url: '/images/items/second.png', alt: '二番目', sortOrder: 20 },
        { itemId: item.id, url: '/images/items/third.png', alt: '三番目', sortOrder: 30 },
      ])
      .returning()
    const fetch = await signIn()
    const beforeKeys = await mediaNames()
    const version = await env.MEDIA.get(SITE_VERSION_KEY)
    const body = form({
      title: item.title,
      type: item.type,
      slug: item.slug ?? '',
      removeImage: '1',
      removeIcon: '1',
      [`shotRemove-${shots[0]?.id}`]: '1',
      [`shotOrder-${shots[1]?.id}`]: '30',
      [`shotOrder-${shots[2]?.id}`]: '10',
      [`shotAlt-${shots[2]?.id}`]: '変えた代替テキスト',
      newShotAlt: '新規の画像',
    })
    body.set('newShot', file(png(), 'new.png', 'image/png'))
    const html = await previewText(
      await fetch(`/admin/preview/items/${item.id}`, { method: 'POST', body }),
    )
    expect(html).not.toContain('/images/items/main.png')
    expect(html).not.toContain('/images/items/icon.png')
    expect(html).not.toContain('/images/items/first.png')
    expect(html).toContain('変えた代替テキスト')
    expect(html.indexOf('/images/items/third.png')).toBeLessThan(
      html.indexOf('/images/items/second.png'),
    )
    expect(await db().select().from(schema.items)).toEqual([item])
    expect(await db().select().from(schema.itemShots)).toEqual(shots)
    expect(await mediaNames()).toEqual(beforeKeys)
    expect(await env.MEDIA.get(SITE_VERSION_KEY)).toBe(version)
  })

  it('新画像の選択が削除チェックより優先され、種類は実バイトから決める', async () => {
    const item = await seedItem({ imageUrl: '/images/items/old.png' })
    const fetch = await signIn()
    const body = form({ type: 'app', title: item.title, removeImage: '1' })
    body.set('image', file(png(), 'misleading.svg', 'image/svg+xml'))
    const html = await previewText(
      await fetch(`/admin/preview/items/${item.id}`, { method: 'POST', body }),
    )
    expect(html).toContain('src="data:image/png;base64,')
    expect(html).not.toContain('/images/items/old.png')
    expect(html).not.toContain('data:image/svg+xml')
  })

  it('公開条件をまだ満たさない入力も非保存で描き、確認事項を伝える', async () => {
    const fetch = await signIn()
    const html = await previewText(
      await fetch('/admin/preview/items', {
        method: 'POST',
        body: form({ type: 'app', title: '準備中の作品', published: '1' }),
      }),
    )
    expect(html).toContain('準備中の作品')
    expect(html).toContain('公開する前に確認してください')
    expect(await db().select().from(schema.items)).toEqual([])
  })

  it('不正なURL・外部キー・SVG・容量超過の画像は保存せず400で止める', async () => {
    const fetch = await signIn()
    const keys = await mediaNames()
    const version = await env.MEDIA.get(SITE_VERSION_KEY)
    const badImage = form({ name: '安全な名前' })
    badImage.set('avatar', file(svg(), 'avatar.png', 'image/png'))
    const bigImage = form({ type: 'app', title: '安全な題' })
    bigImage.set('image', file(new Uint8Array(1_000_001), 'large.png', 'image/png'))
    const cases = [
      { path: '/admin/preview/members', body: form({ name: '人', github: 'javascript:alert(1)' }) },
      { path: '/admin/preview/members', body: badImage },
      { path: '/admin/preview/items', body: bigImage },
      {
        path: '/admin/preview/items',
        body: form({ type: 'app', title: '題', linkLabel: '危険', linkUrl: 'javascript:alert(1)' }),
      },
      { path: '/admin/preview/items', body: form({ type: 'app', title: '題', memberId: '99999' }) },
    ]
    for (const { path, body } of cases) {
      const response = await fetch(path, { method: 'POST', body })
      expect(response.status).toBe(400)
      expect(response.headers.get('cache-control')).toBe('private, no-store')
      const html = await response.text()
      expect(html).toContain('編集していたタブに戻り')
      expect(html).not.toContain('src="data:')
      expect(html).not.toContain('<script')
    }
    expect(await db().select().from(schema.members)).toEqual([])
    expect(await db().select().from(schema.items)).toEqual([])
    expect(await mediaNames()).toEqual(keys)
    expect(await env.MEDIA.get(SITE_VERSION_KEY)).toBe(version)
  })

  it('新規フォームの再送でも既存行を読み、slugの自衝突と画像の二重追加を避ける', async () => {
    const member = await seedMember({
      formKey: '1234567890abcdef',
      avatarUrl: '/images/avatars/kept.png',
    })
    const item = await seedItem({ formKey: 'abcdef1234567890', slug: 'existing' })
    const [shot] = await db()
      .insert(schema.itemShots)
      .values({ itemId: item.id, url: '/images/items/kept.png', alt: '保存済み画像' })
      .returning()
    const fetch = await signIn()
    const memberHtml = await previewText(
      await fetch('/admin/preview/members', {
        method: 'POST',
        body: form({ formKey: member.formKey ?? '', name: member.name, slug: member.slug }),
      }),
    )
    expect(memberHtml).toContain('/images/avatars/kept.png')
    const body = form({
      formKey: item.formKey ?? '',
      type: 'app',
      title: item.title,
      slug: item.slug ?? '',
      newShotAlt: '二度目の追加',
    })
    body.set('newShot', file(png(), 'repeat.png', 'image/png'))
    const html = await previewText(await fetch('/admin/preview/items', { method: 'POST', body }))
    expect(html).toContain('/images/items/kept.png')
    expect(html).not.toContain('二度目の追加')
    expect(html).not.toContain('src="data:')
    expect(await db().select().from(schema.members)).toEqual([member])
    expect(await db().select().from(schema.items)).toEqual([item])
    expect(await db().select().from(schema.itemShots)).toEqual([shot])
  })

  it('新規POSTも匿名・跨Originからは利用できず、private CSPは公開画面へ広がらない', async () => {
    expect(
      (await get('/admin/preview/items', { method: 'POST', body: form({ title: '侵入' }) })).status,
    ).toBe(303)
    const fetch = await signIn()
    expect(
      (
        await fetch('/admin/preview/members', {
          method: 'POST',
          body: form({ name: '侵入' }),
          headers: { origin: 'https://other.example' },
        })
      ).status,
    ).toBe(403)
    expect((await get('/')).headers.get('content-security-policy')).not.toContain(
      "img-src 'self' data:",
    )
  })
})
