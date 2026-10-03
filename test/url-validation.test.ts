import { beforeEach, describe, expect, it } from 'vitest'
import * as schema from '../src/db/schema'
import { db, form, resetDb, signIn } from './helpers'

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
