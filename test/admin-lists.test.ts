import { asc, eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import { MAX_CHARS } from '../src/blocks'
import { itemOrder } from '../src/db/queries'
import * as schema from '../src/db/schema'
import { db, form, resetDb, seedItem, seedMember, signIn } from './helpers'

beforeEach(resetDb)

const titles = async () =>
  (await db().query.items.findMany({ orderBy: itemOrder })).map((item) => item.title)

/*
  作品の一覧から、並べ替えと公開の切り替えをする（src/routes/admin/items.tsx）。

  一覧は区分のタブで割れていて、公開ページの混ぜた並びを管理画面のどこでも見られなかった。
  並び順は1件ずつ編集を開いて数字を打ち、公開の切り替えも編集を開くしかなかった（ページ構成の
  一覧には、どちらの手もあった）
*/
describe('作品の一覧', () => {
  it('初めに開くのは全部を混ぜた公開の並び。区分の札を出し、区分のタブでは絞る', async () => {
    await seedItem({ title: '古い個人開発', year: '2024', sortOrder: 10 })
    await seedItem({
      title: '業務の作品',
      type: 'work',
      year: '2026',
      sortOrder: 20,
      category: '金融',
    })
    await seedItem({ title: '新しい個人開発', year: '2026', sortOrder: 10 })
    const signed = await signIn()
    const all = await (await signed('/admin/items')).text()
    expect(all).toContain('<a href="/admin/items" aria-current="page">すべて</a>')
    const order = ['新しい個人開発', '業務の作品', '古い個人開発'].map((title) =>
      all.indexOf(`>${title}<`),
    )
    expect(order).toEqual([...order].sort((a, b) => a - b))
    expect(order.every((at) => at > 0)).toBe(true)
    expect(all).toContain('<span class="row__col">個人開発</span>')
    expect(all).toContain('<span class="row__col">業務</span>')
    // 足す手は区分ごと
    expect(all).toContain('href="/admin/items/new?type=app"')
    expect(all).toContain('href="/admin/items/new?type=work"')
    // 区分で絞った一覧には、入れ替えの手を出さない（隣が公開ページの隣とは限らない）
    const apps = await (await signed('/admin/items?type=app')).text()
    expect(apps).not.toContain('>業務の作品<')
    expect(apps).not.toContain('class="move-btn"')
    expect(all).toContain('class="move-btn"')
  })

  it('↑↓ は同じ年の中だけ。動かすと、その年の並び順を 10 刻みで振り直す', async () => {
    const a = await seedItem({ title: 'A', year: '2026', sortOrder: 10 })
    const b = await seedItem({ title: 'B', type: 'work', year: '2026', sortOrder: 10 })
    const c = await seedItem({ title: 'C', year: '2026 — 現在', sortOrder: 30 })
    const old = await seedItem({ title: 'OLD', year: '2025', sortOrder: 5 })
    expect(await titles()).toEqual(['A', 'B', 'C', 'OLD'])
    const signed = await signIn()
    const move = (id: number, dir: string) =>
      signed(`/admin/items/${id}/move`, { method: 'POST', body: form({ dir }) })

    const up = await move(c.id, 'up')
    expect(up.status).toBe(303)
    expect(up.headers.get('location')).toBe(`/admin/items#item-row-${c.id}`)
    expect(await titles()).toEqual(['A', 'C', 'B', 'OLD'])
    const orders = async () =>
      Object.fromEntries(
        (await db().select().from(schema.items)).map((item) => [item.title, item.sortOrder]),
      )
    // 同じ数（A と B の 10）が並んでいても、動かしたあとは 10 刻み。ほかの年の数は変えない
    expect(await orders()).toEqual({ A: 10, C: 20, B: 30, OLD: 5 })

    // 年の違う隣とは入れ替えない（年が先に効く）。そう知らせて、何も変えない
    const stopped = await move(old.id, 'up')
    expect(stopped.status).toBe(303)
    expect(stopped.headers.get('location')).toBe(`/admin/items?move=blocked#item-row-${old.id}`)
    expect(await titles()).toEqual(['A', 'C', 'B', 'OLD'])
    expect(await (await signed('/admin/items?move=blocked')).text()).toContain(
      '年の違う作品とは入れ替えられません',
    )
    // 一覧の手も、年の端では押せない
    const html = await (await signed('/admin/items')).text()
    const row = (id: number) =>
      html.slice(html.indexOf(`id="item-row-${id}"`)).split('</li>')[0] ?? ''
    expect(row(a.id)).toMatch(/disabled=""[^>]*aria-label="A を前へ"/)
    expect(row(b.id)).toMatch(/disabled=""[^>]*aria-label="B を後ろへ"/)
    expect(row(old.id).match(/disabled=""/g)).toHaveLength(2)
    expect(row(c.id)).not.toContain('disabled')

    expect((await move(a.id, 'sideways')).status).toBe(400)
    expect((await move(99999, 'up')).status).toBe(404)
    // 動かしていない行の更新時刻は変えない（開いている編集画面を競合にしない）
    const kept = await db().query.items.findFirst({ where: eq(schema.items.id, a.id) })
    expect(kept?.updatedAt).toBe(a.updatedAt)
  })

  it('一覧から下書きにできる。公開にするほうは関門を通し、止めたら編集画面で理由を出す', async () => {
    const ready = await seedItem({ title: '説明あり', summary: '説明。', published: 0 })
    const bare = await seedItem({ title: '説明なし', summary: '', published: 0 })
    const signed = await signIn()
    const toggle = (id: number, published: string, view = '') =>
      signed(`/admin/items/${id}/publish`, { method: 'POST', body: form({ published, view }) })
    const stateOf = async (id: number) =>
      (await db().query.items.findFirst({ where: eq(schema.items.id, id) }))?.published

    const html = await (await signed('/admin/items')).text()
    expect(html).toContain(`action="/admin/items/${ready.id}/publish"`)
    expect(html).toContain('aria-label="説明あり を公開する"')

    const shown = await toggle(ready.id, '1')
    expect(shown.status).toBe(303)
    expect(shown.headers.get('location')).toBe(`/admin/items?saved=1#item-row-${ready.id}`)
    expect(await stateOf(ready.id)).toBe(1)
    // 絞ったタブから押したら、そのタブへ戻す
    const hidden = await toggle(ready.id, '', 'app')
    expect(hidden.headers.get('location')).toBe(
      `/admin/items?type=app&saved=draft#item-row-${ready.id}`,
    )
    expect(await stateOf(ready.id)).toBe(0)

    const blocked = await toggle(bare.id, '1')
    expect(blocked.status).toBe(303)
    expect(blocked.headers.get('location')).toBe(`/admin/items/${bare.id}/edit?publish=blocked`)
    expect(await stateOf(bare.id)).toBe(0)
    const edit = await (await signed(`/admin/items/${bare.id}/edit?publish=blocked`)).text()
    expect(edit).toContain('公開できませんでした。下の理由を直して保存すると、公開されます')
    expect(edit).toContain('公開するときは説明文が要ります')
    expect(edit).toMatch(/<input type="checkbox" name="published" value="1" checked=""/)
    // 理由がもう無ければ、ふつうの編集画面
    const fine = await (await signed(`/admin/items/${ready.id}/edit?publish=blocked`)).text()
    expect(fine).not.toContain('公開できませんでした')
  })
})

describe('メンバーの一覧', () => {
  it('↑↓ で並びを入れ替え、一覧から公開と下書きを切り替える', async () => {
    const first = await seedMember({ slug: 'a', name: '青木', sortOrder: 10 })
    const second = await seedMember({ slug: 'b', name: '石田', sortOrder: 10, published: 0 })
    const third = await seedMember({
      slug: 'c',
      name: '上野',
      sortOrder: 30,
      published: 0,
      headline: 'あ'.repeat(MAX_CHARS.memberHeadline + 1),
    })
    const signed = await signIn()
    const names = async () =>
      (
        await db().query.members.findMany({
          orderBy: [asc(schema.members.sortOrder), asc(schema.members.id)],
        })
      ).map((member) => member.name)
    const html = await (await signed('/admin/members')).text()
    expect(html).toContain(`action="/admin/members/${first.id}/move"`)
    expect(html).toContain('aria-label="石田 を公開する"')

    const moved = await signed(`/admin/members/${third.id}/move`, {
      method: 'POST',
      body: form({ dir: 'up' }),
    })
    expect(moved.headers.get('location')).toBe(`/admin/members#member-row-${third.id}`)
    expect(await names()).toEqual(['青木', '上野', '石田'])
    // 端では動かない（何も変えずに戻る）
    await signed(`/admin/members/${first.id}/move`, { method: 'POST', body: form({ dir: 'up' }) })
    expect(await names()).toEqual(['青木', '上野', '石田'])

    const shown = await signed(`/admin/members/${second.id}/publish`, {
      method: 'POST',
      body: form({ published: '1' }),
    })
    expect(shown.headers.get('location')).toBe(`/admin/members?saved=1#member-row-${second.id}`)
    const blocked = await signed(`/admin/members/${third.id}/publish`, {
      method: 'POST',
      body: form({ published: '1' }),
    })
    expect(blocked.headers.get('location')).toBe(`/admin/members/${third.id}/edit?publish=blocked`)
    const states = Object.fromEntries(
      (await db().select().from(schema.members)).map((member) => [member.name, member.published]),
    )
    expect(states).toEqual({ 青木: 1, 石田: 1, 上野: 0 })
    const edit = await (await signed(`/admin/members/${third.id}/edit?publish=blocked`)).text()
    expect(edit).toContain('公開できませんでした')
    expect(edit).toMatch(/<input type="checkbox" name="published" value="1" checked=""/)
  })
})
