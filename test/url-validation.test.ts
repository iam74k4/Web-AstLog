import { beforeEach, describe, expect, it } from 'vitest'
import * as schema from '../src/db/schema'
import { isContactEmail } from '../src/site'
import { itemTransition } from '../src/ui/components'
import { isGalleryPage } from '../src/ui/gallery-behavior'
import { db, form, okText, resetDb, seedItem, signIn, touch } from './helpers'

beforeEach(resetDb)

// リンク欄はサイト内 URL を受けるため type=text。絶対 URL の形も保存側で確かめる。
describe('絶対 URL の形を保存側で検査する', () => {
  it.each(['https://', 'https://?q', 'https://:443', 'https://exa mple.test'])(
    '作品のリンク %s は、行を示して拒否し、作品とリンクを保存しない',
    async (url) => {
      const signed = await signIn()
      const response = await signed('/admin/items', {
        method: 'POST',
        body: form({
          type: 'app',
          title: 'URL の検査',
          slug: 'url-check',
          summary: 'リンクを確かめる。',
          published: '1',
          linkLabel: ['通るリンク', '読めないリンク'],
          linkUrl: ['/projects', url],
        }),
      })
      expect(response.status).toBe(400)
      expect(await response.text()).toContain('2 行目の URL')
      expect(await db().select().from(schema.items)).toHaveLength(0)
      expect(await db().select().from(schema.itemLinks)).toHaveLength(0)
    },
  )

  it('リンク集も同じ検査を使い、読めない絶対 URL の行を保存しない', async () => {
    const signed = await signIn()
    const response = await signed('/admin/blocks', {
      method: 'POST',
      body: form({
        type: 'links',
        title: 'Links',
        body: '通るリンク | /projects\n読めないリンク | https://?q',
        published: '1',
      }),
    })
    expect(response.status).toBe(400)
    expect(await response.text()).toContain('2 行目（読めないリンク）の URL')
    expect(await db().select().from(schema.blocks)).toHaveLength(0)
  })

  it('クエリ付き mailto と相対 URL は保存できる', async () => {
    const signed = await signIn()
    const urls = ['mailto:a@example.test?subject=Hello&body=Hi', '/projects?kind=app#item-appmixer']
    const response = await signed('/admin/items', {
      method: 'POST',
      body: form({
        type: 'app',
        title: 'URL の検査',
        slug: 'url-check',
        linkLabel: ['メール', '一覧'],
        linkUrl: urls,
      }),
    })
    expect(response.status).toBe(303)
    expect((await db().select().from(schema.itemLinks)).map((row) => row.url)).toEqual(urls)
  })
})

/*
  保存の口を通らずに入った値（D1 を手で直した行）でも、描く側が形を見る。どれも
  保存の検査では受け取らない値なので、ここでは D1 に直に書いて確かめる。
*/
describe('描く側でも形を見る', () => {
  it('原寸へのリンクは、画像の URL の形が通るときだけ行き先を持つ', async () => {
    const item = await seedItem({ title: '画像の作品', slug: 'shots', published: 1 })
    await db()
      .insert(schema.itemShots)
      .values([
        { itemId: item.id, url: '/images/items/shots-0000aaaa.png', alt: '正しい', sortOrder: 0 },
        { itemId: item.id, url: 'javascript:alert(1)', alt: '手で直した', sortOrder: 1 },
      ])
    await touch()
    const html = await okText('/apps/item/shots')
    expect(html).toContain('href="/images/items/shots-0000aaaa.png"')
    expect(html).not.toContain('href="javascript:')
  })

  it('slug は style 属性に入れる前に字の形を見る', () => {
    expect(itemTransition({ slug: 'astlog-app' })).toBe('view-transition-name:item-astlog-app')
    expect(itemTransition({ slug: 'x;background:red' })).toBeUndefined()
  })

  it('ショーケースのスクリプトを許すのは、作品のページの URL だけ', () => {
    expect(isGalleryPage('/apps/item/astlog')).toBe(true)
    expect(isGalleryPage('https://astlog.dev/works/item/astlog')).toBe(true)
    expect(isGalleryPage('/members/apps/item/astlog')).toBe(false)
    expect(isGalleryPage('/apps/item/astlog/privacy')).toBe(false)
  })
})

describe('連絡先のメールアドレス', () => {
  it('ふつうのアドレスは通す', () => {
    for (const email of ['me@example.com', 'a.b+tag@mail.example.co.jp']) {
      expect(isContactEmail(email), email).toBe(true)
    }
  })

  it('宛先やヘッダを足せる形は、% で書いたものも通さない', () => {
    for (const email of [
      'me,other@example.com',
      'me%2Cother@example.com',
      'a%3Fcc%3Dx@example.com',
      'me@example.com?cc=x',
      'me@example..com',
      'me@.example.com',
    ]) {
      expect(isContactEmail(email), email).toBe(false)
    }
  })

  it('長い入力でも、読むのに時間がかからない', () => {
    const started = performance.now()
    expect(isContactEmail(`a@${'.a'.repeat(20_000)}!`)).toBe(false)
    expect(isContactEmail(`a@${'a.'.repeat(20_000)}`)).toBe(false)
    expect(performance.now() - started).toBeLessThan(200)
  })
})
