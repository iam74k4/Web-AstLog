import { beforeEach, describe, expect, it } from 'vitest'
import * as schema from '../src/db/schema'
import { db, form, get, resetDb, seedItem, seedMember, signIn } from './helpers'

beforeEach(resetDb)

// 節が出た順に id を拾う。並びのテストはこれで見る
const sectionIds = (html: string) => [...html.matchAll(/<section id="([^"]+)"/g)].map((m) => m[1])

const place = (rows: Partial<typeof schema.blocks.$inferInsert>[]) =>
  db()
    .insert(schema.blocks)
    .values(
      rows.map((row, index) => ({
        type: 'note' as const,
        published: 1,
        sortOrder: (index + 1) * 10,
        ...row,
      })),
    )

describe('トップの構成', () => {
  it('何も置いていなければ既定の並びで出す', async () => {
    await seedMember()
    await seedItem({ type: 'app' })
    await seedItem({ type: 'work', title: '業務の実績' })

    const html = await (await get('/')).text()
    expect(html).toContain('class="hero"')
    expect(sectionIds(html)).toEqual(['apps', 'works', 'team', 'contact'])
  })

  it('置いた順に出る', async () => {
    await seedMember()
    await seedItem({ type: 'app' })
    await place([{ type: 'team' }, { type: 'contact' }, { type: 'apps' }])

    expect(sectionIds(await (await get('/')).text())).toEqual(['team', 'contact', 'apps'])
  })

  it('目次も置いた順に従う', async () => {
    await seedMember()
    await place([{ type: 'contact' }, { type: 'team' }])

    const html = await (await get('/')).text()
    expect(html.indexOf('href="#contact"')).toBeLessThan(html.indexOf('href="#team"'))
    expect(html).not.toContain('href="#apps"')
  })

  it('下書きのブロックは出ない。全部下書きでも既定には戻らない', async () => {
    await seedMember()
    await place([{ type: 'team', published: 0 }, { type: 'contact' }])

    expect(sectionIds(await (await get('/')).text())).toEqual(['contact'])
  })

  it('中身の無い節は見出しごと出さない', async () => {
    // apps は登録が0件、note は本文が空
    await place([{ type: 'apps' }, { type: 'note', title: '空のメモ' }, { type: 'contact' }])

    const html = await (await get('/')).text()
    expect(sectionIds(html)).toEqual(['contact'])
    expect(html).not.toContain('空のメモ')
  })

  it('打ち込むブロックは1行1件で読む', async () => {
    await place([
      { type: 'statement', title: '速くつくる。', body: '添え書きです' },
      { type: 'numbers', title: '数字で見る', body: '20 | 人日 | 見込み 40 → 実績\n5 | apps' },
      { type: 'links', title: 'Links', body: 'Blog | https://example.com/blog | 週1で書く' },
      { type: 'timeline', body: '2026.09 | サイトを公開' },
      { type: 'now', body: 'Workers への移行 | 進行中' },
    ])

    const html = await (await get('/')).text()
    expect(html).toContain('速くつくる。')
    expect(html).toContain('添え書きです')
    expect(html).toContain('metric__value">20<')
    expect(html).toContain('href="https://example.com/blog"')
    expect(html).toContain('サイトを公開')
    expect(html).toContain('Workers への移行')
    // 見出しが空なら種類の名前を使う
    expect(html).toContain('>Timeline<')
    // ひとことは目次に載せない
    expect(html).not.toContain('速くつくる。</a>')
  })

  it('リンク集では javascript: のような URL を落とす', async () => {
    await place([
      { type: 'links', body: '危ない | javascript:alert(1)\n安全 | https://example.com' },
    ])

    const html = await (await get('/')).text()
    expect(html).not.toContain('javascript:')
    expect(html).toContain('https://example.com')
  })
})

describe('管理の構成', () => {
  it('ログインしていなければ触れない', async () => {
    const response = await get('/admin/blocks', { method: 'POST', body: form({ type: 'team' }) })
    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe('/admin/login')
  })

  it('既定の並びから始められる。2回押しても増えない', async () => {
    const signed = await signIn()
    await signed('/admin/blocks/init', { method: 'POST' })
    await signed('/admin/blocks/init', { method: 'POST' })

    const rows = await db().select().from(schema.blocks)
    expect(rows.map((row) => row.type)).toEqual(['hero', 'apps', 'works', 'team', 'contact'])
  })

  it('決まった中身のものは1つしか置けない', async () => {
    const signed = await signIn()
    const first = await signed('/admin/blocks', { method: 'POST', body: form({ type: 'team' }) })
    expect(first.status).toBe(303)

    const second = await signed('/admin/blocks', { method: 'POST', body: form({ type: 'team' }) })
    expect(second.status).toBe(400)
    expect(await db().select().from(schema.blocks)).toHaveLength(1)
  })

  it('知らない種類は置けない', async () => {
    const signed = await signIn()
    const response = await signed('/admin/blocks', {
      method: 'POST',
      body: form({ type: 'chaos' }),
    })
    expect(response.status).toBe(400)
  })

  it('打ち込むものは中身が無いと保存しない。打った内容は残す', async () => {
    const signed = await signIn()
    const response = await signed('/admin/blocks', {
      method: 'POST',
      body: form({ type: 'numbers', title: '数字で見る', body: '' }),
    })
    expect(response.status).toBe(400)
    expect(await response.text()).toContain('value="数字で見る"')
    expect(await db().select().from(schema.blocks)).toHaveLength(0)
  })

  it('上下に動かすと並びが入れ替わる', async () => {
    const signed = await signIn()
    await signed('/admin/blocks/init', { method: 'POST' })
    const team = await db().query.blocks.findFirst({ where: (t, { eq }) => eq(t.type, 'team') })
    if (!team) throw new Error('team が無い')

    await signed(`/admin/blocks/${team.id}/move`, { method: 'POST', body: form({ dir: 'up' }) })
    await signed(`/admin/blocks/${team.id}/move`, { method: 'POST', body: form({ dir: 'up' }) })

    const rows = await db().query.blocks.findMany({ orderBy: (t, { asc }) => [asc(t.sortOrder)] })
    expect(rows.map((row) => row.type)).toEqual(['hero', 'team', 'apps', 'works', 'contact'])
  })

  it('一番上で上へ動かしても何も起きない', async () => {
    const signed = await signIn()
    await signed('/admin/blocks/init', { method: 'POST' })
    const hero = await db().query.blocks.findFirst({ where: (t, { eq }) => eq(t.type, 'hero') })
    if (!hero) throw new Error('hero が無い')

    const response = await signed(`/admin/blocks/${hero.id}/move`, {
      method: 'POST',
      body: form({ dir: 'up' }),
    })
    expect(response.status).toBe(303)
    const rows = await db().query.blocks.findMany({ orderBy: (t, { asc }) => [asc(t.sortOrder)] })
    expect(rows[0]?.type).toBe('hero')
  })

  it('外すと公開ページからも消える', async () => {
    await seedMember()
    const signed = await signIn()
    await signed('/admin/blocks/init', { method: 'POST' })
    const team = await db().query.blocks.findFirst({ where: (t, { eq }) => eq(t.type, 'team') })
    if (!team) throw new Error('team が無い')

    const response = await signed(`/admin/blocks/${team.id}/delete`, { method: 'POST' })
    expect(response.headers.get('location')).toBe('/admin/blocks?deleted=1')
    expect(sectionIds(await (await get('/')).text())).not.toContain('team')
  })
})
