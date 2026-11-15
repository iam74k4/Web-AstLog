import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import * as schema from '../src/db/schema'
import { yearInJapan } from '../src/lib/format'
import { db, form, okText, resetDb, seedItem, seedMember, signIn } from './helpers'

beforeEach(resetDb)

const platforms = () =>
  db().query.platforms.findMany({ orderBy: (table, { asc }) => [asc(table.sortOrder)] })

/*
  プラットフォームの選択肢を管理画面から足す・直す・消す（src/routes/admin/platforms.tsx）。

  行を入れる口が移行にしか無かったころは、選択肢に無い種類の作品（VS Code の拡張など）は、
  札を付けないまま公開するか、コードを直してデプロイするしかなかった
*/
describe('プラットフォームの選択肢', () => {
  it('一覧は使っている作品の数を出し、足す・直す・消すの手を持つ', async () => {
    await seedItem({ platformKey: 'web' })
    const signed = await signIn()
    const response = await signed('/admin/platforms')
    expect(response.status).toBe(200)
    const html = await response.text()
    expect(html).toContain('<h1>プラットフォーム</h1>')
    expect(html).toContain('action="/admin/platforms/web"')
    expect(html).toContain('1 件の作品が使用中')
    expect(html).toContain('未使用')
    expect(html).toContain('href="/admin/platforms/cli/delete"')
    // 足す枠の並び順は、いまの最後のあと
    expect(html).toMatch(
      /action="\/admin\/platforms" class="option">[\s\S]*name="sortOrder"[^>]*value="30"/,
    )
    // 作品の一覧から入れる
    expect(await (await signed('/admin/items')).text()).toContain('href="/admin/platforms"')
  })

  it('足す。key は表示名から作り、同じ名前（大文字小文字の違い）は足させない', async () => {
    const signed = await signIn()
    const added = await signed('/admin/platforms', {
      method: 'POST',
      body: form({ label: 'VS Code', sortOrder: '30' }),
    })
    expect(added.status).toBe(303)
    expect(added.headers.get('location')).toBe('/admin/platforms?added=1#platform-vs-code')
    expect(await platforms()).toEqual([
      { key: 'web', label: 'Web', sortOrder: 10 },
      { key: 'cli', label: 'CLI', sortOrder: 20 },
      { key: 'vs-code', label: 'VS Code', sortOrder: 30 },
    ])
    for (const [label, message] of [
      ['vs code', '同じ名前の選択肢がもうあります'],
      ['', '表示名を入れてください'],
      ['あ'.repeat(25), '24 字までにしてください'],
    ] as const) {
      const refused = await signed('/admin/platforms', { method: 'POST', body: form({ label }) })
      expect(refused.status, label).toBe(400)
      const html = await refused.text()
      expect(html, label).toContain(message)
      // 打った字は足す枠に残す
      if (label) expect(html, label).toContain(`value="${label}"`)
    }
    expect(await platforms()).toHaveLength(3)
    // 英数字の無い名前は、重ならない key を作る
    await signed('/admin/platforms', { method: 'POST', body: form({ label: 'ブラウザ拡張' }) })
    const made = (await platforms()).find((one) => one.label === 'ブラウザ拡張')
    expect(made?.key).toMatch(/^platform-[0-9a-f]{6}$/)
    expect(made?.sortOrder).toBe(40)
  })

  it('直す。表示名と並び順を変えても key は変わらず、作品はそのまま指す', async () => {
    const item = await seedItem({ platformKey: 'web', slug: 'site' })
    const signed = await signIn()
    const saved = await signed('/admin/platforms/web', {
      method: 'POST',
      body: form({ label: 'Web アプリ', sortOrder: '５０' }),
    })
    expect(saved.status).toBe(303)
    expect(await platforms()).toEqual([
      { key: 'cli', label: 'CLI', sortOrder: 20 },
      { key: 'web', label: 'Web アプリ', sortOrder: 50 },
    ])
    expect(await okText(`/apps/item/${item.slug}`)).toContain('Web アプリ')
    // ほかの選択肢と同じ名前にはできない。読めない並び順も止める
    for (const body of [{ label: 'cli' }, { label: 'Web', sortOrder: 'x' }] as Record<
      string,
      string
    >[]) {
      const refused = await signed('/admin/platforms/web', { method: 'POST', body: form(body) })
      expect(refused.status).toBe(400)
    }
    expect((await platforms()).find((one) => one.key === 'web')?.label).toBe('Web アプリ')
    expect((await signed('/admin/platforms/nope', { method: 'POST', body: form({}) })).status).toBe(
      404,
    )
  })

  it('消すと、その札の作品からは札が外れる。作品は消えない', async () => {
    const item = await seedItem({ platformKey: 'web' })
    const signed = await signIn()
    const confirm = await (await signed('/admin/platforms/web/delete')).text()
    expect(confirm).toContain('選択肢「Web」を消しますか？')
    expect(confirm).toContain('1 件の作品から、札が外れます')
    const gone = await signed('/admin/platforms/web/delete', { method: 'POST', body: form({}) })
    expect(gone.status).toBe(303)
    expect((await platforms()).map((one) => one.key)).toEqual(['cli'])
    const kept = await db().query.items.findFirst({ where: eq(schema.items.id, item.id) })
    expect(kept?.title).toBe('AppMixer')
    expect(kept?.platformKey).toBeNull()
  })
})

describe('作品のフォームからプラットフォームを足す', () => {
  it('「選択肢に無いとき」に書いて保存すると、選択肢に足してその作品に付ける', async () => {
    const signed = await signIn()
    const html = await (await signed('/admin/items/new?type=app')).text()
    expect(html).toContain('name="platformNew"')
    expect(html).toContain('href="/admin/platforms"')
    // 使われない説明（公開ページに絞り込みのボタンはもう無い）を残さない
    expect(html).not.toContain('絞り込みボタン')
    const saved = await signed('/admin/items', {
      method: 'POST',
      body: form({ type: 'app', title: 'Markdown Lens', platformNew: 'VS Code' }),
    })
    expect(saved.status).toBe(303)
    const item = await db().query.items.findFirst({
      where: eq(schema.items.title, 'Markdown Lens'),
    })
    expect(item?.platformKey).toBe('vs-code')
    expect((await platforms()).at(-1)).toEqual({ key: 'vs-code', label: 'VS Code', sortOrder: 30 })
    // 開き直したフォームでは、選択肢の中の選ばれた1つになっている
    const edit = await (await signed(`/admin/items/${item?.id}/edit`)).text()
    expect(edit).toMatch(/<option value="vs-code" selected="">VS Code<\/option>/)
    expect(edit).toMatch(/name="platformNew"[^>]*value=""/)
  })

  it('同じ名前の選択肢がもうあれば、足さずにそれを付ける。編集でも足せる', async () => {
    const item = await seedItem({ published: 0, platformKey: 'cli' })
    const signed = await signIn()
    const reuse = await signed(`/admin/items/${item.id}`, {
      method: 'POST',
      body: form({ title: 'AppMixer', platformNew: 'web', _version: item.updatedAt }),
    })
    expect(reuse.status).toBe(303)
    expect(await platforms()).toHaveLength(2)
    const first = await db().query.items.findFirst({ where: eq(schema.items.id, item.id) })
    expect(first?.platformKey).toBe('web')
    const add = await signed(`/admin/items/${item.id}`, {
      method: 'POST',
      body: form({ title: 'AppMixer', platformNew: 'visionOS', _version: first?.updatedAt ?? '' }),
    })
    expect(add.status).toBe(303)
    const second = await db().query.items.findFirst({ where: eq(schema.items.id, item.id) })
    expect(second?.platformKey).toBe('visionos')
    expect((await platforms()).map((one) => one.label)).toEqual(['Web', 'CLI', 'visionOS'])
  })

  it('保存が止まったら選択肢も足さない。プレビューは札を出すが、何も書かない', async () => {
    const signed = await signIn()
    const stopped = await signed('/admin/items', {
      method: 'POST',
      body: form({ type: 'app', title: '', platformNew: 'VS Code' }),
    })
    expect(stopped.status).toBe(400)
    expect(await stopped.text()).toMatch(/name="platformNew"[^>]*value="VS Code"/)
    const long = await signed('/admin/items', {
      method: 'POST',
      body: form({ type: 'app', title: '題', platformNew: 'あ'.repeat(25) }),
    })
    expect(long.status).toBe(400)
    expect(await long.text()).toContain('id="field-platformNew-error"')
    const preview = await signed('/admin/preview/items', {
      method: 'POST',
      body: form({ type: 'app', title: '題', year: '2026', platformNew: 'VS Code' }),
    })
    expect(preview.status).toBe(200)
    expect(await preview.text()).toContain('VS Code')
    expect(await platforms()).toHaveLength(2)
    expect(await db().select().from(schema.items)).toEqual([])
  })
})

describe('作品の区分を変える', () => {
  it('編集のフォームは区分を選べる。変えて保存すると、区分ごとの札が入れ替わる', async () => {
    const item = await seedItem({ slug: 'tool', platformKey: 'web', published: 0 })
    const signed = await signIn()
    const edit = await (await signed(`/admin/items/${item.id}/edit`)).text()
    expect(edit).toMatch(/<select[^>]*name="type"/)
    expect(edit).toMatch(/<option value="app" selected="">個人開発<\/option>/)
    expect(edit).not.toContain('<input type="hidden" name="type"')
    // 追加のフォームは、タブが決めた区分を hidden で持つ
    expect(await (await signed('/admin/items/new?type=work')).text()).toContain(
      '<input type="hidden" name="type" value="work"/>',
    )
    const moved = await signed(`/admin/items/${item.id}`, {
      method: 'POST',
      body: form({ title: 'AppMixer', type: 'work', category: '製造業', _version: item.updatedAt }),
    })
    expect(moved.status).toBe(303)
    expect(moved.headers.get('location')).toContain('moved=1')
    const saved = await db().query.items.findFirst({ where: eq(schema.items.id, item.id) })
    expect(saved?.type).toBe('work')
    expect(saved?.platformKey).toBeNull()
    expect(saved?.category).toBe('製造業')
    const again = await (await signed(`/admin/items/${item.id}/edit`)).text()
    expect(again).toContain('name="category"')
    expect(again).not.toContain('name="platformKey"')
  })

  it('区分の欄の無い送信は、いまの区分のまま', async () => {
    const item = await seedItem({ type: 'work', category: '金融', published: 0 })
    const signed = await signIn()
    const response = await signed(`/admin/items/${item.id}`, {
      method: 'POST',
      body: form({ title: '題だけ', category: '金融', _version: item.updatedAt }),
    })
    expect(response.status).toBe(303)
    const saved = await db().query.items.findFirst({ where: eq(schema.items.id, item.id) })
    expect(saved?.type).toBe('work')
    expect(saved?.category).toBe('金融')
  })
})

/*
  追加のフォームが初めに出す値（items.tsx の newItemDefaults）。空の年・並び順 10・担当なしで
  始めていたころは、題だけで保存した作品が年の無いまま一覧の最後に並び、並び順は既にある作品と
  重なり、どれも畳んだ欄を開くまで気づけなかった
*/
describe('新しい作品の初めの値', () => {
  it('年は今年、並び順はいちばん後ろ、担当は1人だけのメンバー。札と年は畳まない', async () => {
    const member = await seedMember()
    await seedItem({ sortOrder: 40 })
    await seedItem({ type: 'work', title: '業務', sortOrder: 70 })
    const signed = await signIn()
    const html = await (await signed('/admin/items/new?type=app')).text()
    expect(html).toMatch(new RegExp(`name="year"[^>]*value="${yearInJapan()}"`))
    expect(html).toMatch(/name="sortOrder"[^>]*value="80"/)
    expect(html).toMatch(new RegExp(`<option value="${member.id}" selected="">`))
    // 年とプラットフォームは、畳んだ欄（details）の外
    const open = html.slice(html.indexOf('<h2 class="form-section__title">一覧の札</h2>'))
    const beforeDetails = open.slice(0, open.indexOf('<details'))
    expect(beforeDetails).toContain('name="platformKey"')
    expect(beforeDetails).toContain('name="year"')
    // 業務は業界の欄
    const work = await (await signed('/admin/items/new?type=work')).text()
    expect(work).toContain('業界')
    expect(work).toContain('name="category"')
    expect(work).not.toContain('name="platformNew"')
  })

  it('メンバーが2人以上なら、担当は選ばせる（初めは「なし」）', async () => {
    await seedMember()
    await seedMember({ slug: 'hoshino', name: '星野', sortOrder: 20 })
    const signed = await signIn()
    const html = await (await signed('/admin/items/new?type=app')).text()
    expect(html).toMatch(/<option value="" selected="">（なし）<\/option>/)
  })
})
