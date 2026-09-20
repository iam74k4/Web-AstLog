import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import * as schema from '../src/db/schema'
import { db, form, get, resetDb, seedItem, seedMember, signIn } from './helpers'

beforeEach(resetDb)

/*
  節が出た順に id を拾う。並びのテストはこれで見る。

  id が第1属性でなくなると、この正規表現は [] を返す。[] のままだと
  `not.toContain('team')` が素通りして、節が全部消えていても緑になる。
  拾えなかったこと自体をここで落とす。
*/
const sectionIds = (html: string) => {
  const ids = [...html.matchAll(/<section id="([^"]+)"/g)].map((m) => m[1])
  expect(
    ids.length,
    '節の id を1つも拾えていない（<section id="…"> の形が変わった？）',
  ).toBeGreaterThan(0)
  return ids
}

/*
  並びを確かめる宛先は `/all`。置いたブロックが全部1ページに出る唯一の URL で、
  「置いた順にこの並びで出る」を1回の取得で見られるのはここだけ。
*/
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

    const html = await (await get('/all')).text()
    expect(html).toContain('class="hero"')
    expect(sectionIds(html)).toEqual(['apps', 'works', 'team', 'contact'])
  })

  it('置いた順に出る', async () => {
    await seedMember()
    await seedItem({ type: 'app' })
    await place([{ type: 'team' }, { type: 'contact' }, { type: 'apps' }])

    expect(sectionIds(await (await get('/all')).text())).toEqual(['team', 'contact', 'apps'])
  })

  it('目次も置いた順に従う', async () => {
    await seedMember()
    await place([{ type: 'contact' }, { type: 'team' }])

    const html = await (await get('/all')).text()
    expect(html.indexOf('href="#contact"')).toBeLessThan(html.indexOf('href="#team"'))
    expect(html).not.toContain('href="#apps"')
  })

  it('下書きのブロックは出ない。全部下書きでも既定には戻らない', async () => {
    await seedMember()
    await place([{ type: 'team', published: 0 }, { type: 'contact' }])

    expect(sectionIds(await (await get('/all')).text())).toEqual(['contact'])
  })

  it('中身の無い節は見出しごと出さない', async () => {
    // apps は登録が0件、note は本文が空
    await place([{ type: 'apps' }, { type: 'note', title: '空のメモ' }, { type: 'contact' }])

    const html = await (await get('/all')).text()
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

    const html = await (await get('/all')).text()
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

    const html = await (await get('/all')).text()
    expect(html).not.toContain('javascript:')
    expect(html).toContain('https://example.com')
  })
})

/*
  公開ページは画面ごとに別の URL。並びを確かめるのは上の `/all` のままだが、
  「どのブロックに URL があるか」はここでしか見られない。
*/
describe('画面ごとの URL', () => {
  it('置いた順の先頭が / に出る', async () => {
    await seedMember()
    await place([{ type: 'team' }, { type: 'contact' }])

    const html = await (await get('/')).text()
    // 先頭の1画面だけ。2番目から先は / には出ない
    expect(sectionIds(html)).toEqual(['team'])
    expect(html).not.toContain('<section id="contact"')
  })

  it('中身の無いブロックには URL が無い', async () => {
    // renderBlock が節ごと出さないものは、URL も無い。「公開なのに開けない
    // ページ」と「開けるのに空のページ」を、どちらも作らないため
    await seedMember()
    await place([{ type: 'apps' }, { type: 'team', published: 0 }, { type: 'contact' }])

    expect((await get('/apps')).status).toBe(404) // 公開中の登録が0件
    expect((await get('/team')).status).toBe(404) // 下書き
    expect((await get('/works')).status).toBe(404) // 置いていない
    expect((await get('/contact')).status).toBe(200)
  })

  it('全部下書きでも / は開ける', async () => {
    await place([
      { type: 'contact', published: 0 },
      { type: 'team', published: 0 },
    ])

    const response = await get('/')
    // 入口まで 404 にすると、管理画面に入って直す前に手詰まりになる
    expect(response.status).toBe(200)
    expect(await response.text()).toContain('class="empty"')
    // 入口以外は素直に無い
    expect((await get('/contact')).status).toBe(404)
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

  it('何も置いていないまま足しても、既定の5節は消えない', async () => {
    // 0件のトップは既定の並びで出ている。そこへ1つ足して、見えていた節が
    // 消えるなら「足したのに減った」になる
    await seedMember()
    await seedItem({ type: 'app' })
    await seedItem({ type: 'work', title: '業務の実績' })
    const signed = await signIn()

    const response = await signed('/admin/blocks', {
      method: 'POST',
      body: form({ type: 'note', title: 'あとがき', body: '本文です', published: '1' }),
    })
    expect(response.status).toBe(303)

    const rows = await db().query.blocks.findMany({ orderBy: (t, { asc }) => [asc(t.sortOrder)] })
    expect(rows.map((row) => row.type)).toEqual([
      'hero',
      'apps',
      'works',
      'team',
      'contact',
      'note',
    ])
    expect(sectionIds(await (await get('/all')).text())).toEqual([
      'apps',
      'works',
      'team',
      'contact',
      `block-${rows[5]?.id}`,
    ])
  })

  it('決まった中身のものは1つしか置けない', async () => {
    const signed = await signIn()
    await signed('/admin/blocks/init', { method: 'POST' })

    const response = await signed('/admin/blocks', { method: 'POST', body: form({ type: 'team' }) })
    expect(response.status).toBe(400)
    expect(await db().select().from(schema.blocks)).toHaveLength(5)
  })

  it('リンク集は URL の形まで見る', async () => {
    const signed = await signIn()
    // スキームの打ち忘れ。保存できてしまうと、公開なのにサイトに出ない行になる
    const response = await signed('/admin/blocks', {
      method: 'POST',
      body: form({ type: 'links', title: 'Links', body: 'Blog | example.com' }),
    })
    expect(response.status).toBe(400)
    expect(await response.text()).toContain('URL は https://')
    expect(await db().select().from(schema.blocks)).toHaveLength(0)
  })

  it('入力エラーで描き直しても、外した「公開する」は外れたまま', async () => {
    const signed = await signIn()
    const response = await signed('/admin/blocks', {
      method: 'POST',
      body: form({ type: 'numbers', title: '数字で見る', body: '' }),
    })
    expect(response.status).toBe(400)

    const html = await response.text()
    expect(html).toContain('value="数字で見る"')
    expect(html).not.toContain('name="published" value="1" checked=""')
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

  it('打ち込むブロックを編集できる', async () => {
    const signed = await signIn()
    await signed('/admin/blocks', {
      method: 'POST',
      body: form({ type: 'note', title: 'あとがき', body: '本文です', published: '1' }),
    })
    const note = await db().query.blocks.findFirst({ where: (t, { eq }) => eq(t.type, 'note') })
    if (!note) throw new Error('note が無い')

    const response = await signed(`/admin/blocks/${note.id}`, {
      method: 'POST',
      body: form({ title: '追記', body: '書き直しました', published: '1' }),
    })
    expect(response.status).toBe(303)

    const html = await (await get('/all')).text()
    expect(html).toContain('追記')
    expect(html).toContain('書き直しました')
    expect(html).not.toContain('本文です')
  })

  it('決まった中身のものは、編集しても公開/下書きしか変わらない', async () => {
    await seedMember()
    const signed = await signIn()
    await signed('/admin/blocks/init', { method: 'POST' })
    const team = await db().query.blocks.findFirst({ where: (t, { eq }) => eq(t.type, 'team') })
    if (!team) throw new Error('team が無い')

    // 見出しと中身を送りつけても、決まった中身のものは受け取らない
    const response = await signed(`/admin/blocks/${team.id}`, {
      method: 'POST',
      body: form({ title: '乗っ取り', body: '差し込み' }),
    })
    expect(response.status).toBe(303)

    const saved = await db().query.blocks.findFirst({ where: (t, { eq }) => eq(t.id, team.id) })
    expect(saved?.title).toBe('')
    expect(saved?.published).toBe(0)
    expect(sectionIds(await (await get('/all')).text())).not.toContain('team')
  })

  it('動かす向きが分からなければ何もしない', async () => {
    const signed = await signIn()
    await signed('/admin/blocks/init', { method: 'POST' })
    const apps = await db().query.blocks.findFirst({ where: (t, { eq }) => eq(t.type, 'apps') })
    if (!apps) throw new Error('apps が無い')

    const response = await signed(`/admin/blocks/${apps.id}/move`, {
      method: 'POST',
      body: form({ dir: 'DOWN' }),
    })
    expect(response.status).toBe(400)

    const rows = await db().query.blocks.findMany({ orderBy: (t, { asc }) => [asc(t.sortOrder)] })
    expect(rows.map((row) => row.type)).toEqual(['hero', 'apps', 'works', 'team', 'contact'])
  })

  it('種類が消えた行も外せる', async () => {
    // blocks.ts から種類を1つ減らしたあとの行。読む側は無視するが、
    // 外せないと一覧に残り続ける
    await env.DB.prepare(
      "INSERT INTO blocks (type, published, sort_order) VALUES ('gone', 1, 10)",
    ).run()
    const [orphan] = await db().select().from(schema.blocks)
    if (!orphan) throw new Error('行が無い')

    const signed = await signIn()
    expect((await signed(`/admin/blocks/${orphan.id}/delete`)).status).toBe(200)

    const response = await signed(`/admin/blocks/${orphan.id}/delete`, { method: 'POST' })
    expect(response.status).toBe(303)
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
    expect(sectionIds(await (await get('/all')).text())).not.toContain('team')
  })
})
