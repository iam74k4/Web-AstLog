import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test'
import { drizzle } from 'drizzle-orm/d1'
import { beforeEach, describe, expect, it } from 'vitest'
import { listBlocks } from '../src/db/queries'
import * as schema from '../src/db/schema'
import app from '../src/index'
import { createSession, SESSION_COOKIE } from '../src/lib/auth'
import { findAdminBlock } from '../src/routes/admin/blocks'
import { form, uncachedEnv } from './helpers'

/*
  Apps / Works を Projects に畳む移行（0004）だけを適用していない D1。
  公開と一覧が読み替える論理行に、編集・公開切り替え・削除も同じように作用するかを見る。
*/
const d1 = () => env.MIGRATION_DB
const database = () => drizzle(d1(), { schema })
const rewrite = () => {
  const migration = env.TEST_MIGRATIONS.find((one) => one.name.includes('merge_apps_works'))
  if (!migration) throw new Error('Projects に畳む移行が無い')
  return migration
}
let cookie = ''

beforeEach(async () => {
  const { results } = await d1()
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY rowid DESC",
    )
    .all<{ name: string }>()
  for (const { name } of results) await d1().prepare(`DROP TABLE \`${name}\``).run()
  for (const migration of env.TEST_MIGRATIONS.filter((one) => one.name !== rewrite().name)) {
    for (const query of migration.queries) await d1().prepare(query).run()
  }
  await d1().batch([
    d1().prepare(
      "INSERT INTO blocks (id, type, published, sort_order) VALUES (1, 'hero', 1, 10), (2, 'apps', 0, 20), (3, 'works', 1, 30), (4, 'contact', 1, 40)",
    ),
    d1().prepare(
      "INSERT INTO items (id, type, title, slug, summary, published) VALUES (1, 'app', 'AppMixer', 'appmixer', '音量を混ぜる。', 1)",
    ),
    d1().prepare("INSERT INTO users (id, role) VALUES (1, 'owner')"),
    d1().prepare(
      "INSERT INTO user_identities (user_id, provider, subject, label) VALUES (1, 'github', '1001', '@owner')",
    ),
  ])
  const { token } = await createSession(database(), 1)
  cookie = `${SESSION_COOKIE}=${token}`
})

async function open(path: string, init: RequestInit = {}, signed = true) {
  const headers = new Headers(init.headers)
  if (signed) headers.set('cookie', cookie)
  const ctx = createExecutionContext()
  const response = await app.fetch(
    new Request(`https://astlog.test${path}`, { ...init, headers, redirect: 'manual' }),
    uncachedEnv({ DB: d1() }),
    ctx,
  )
  await waitOnExecutionContext(ctx)
  return response
}

const post = async (path: string, values: Record<string, string> = {}) => {
  const id = path.match(/^\/admin\/blocks\/(\d+)$/)?.[1]
  const version = id ? (await findAdminBlock(database(), Number(id)))?.block.updatedAt : undefined
  return open(path, {
    method: 'POST',
    body: form({ ...values, ...(version ? { _version: version } : {}) }),
  })
}

async function oldRows() {
  const { results } = await d1()
    .prepare(
      "SELECT id, type, published, sort_order FROM blocks WHERE type IN ('apps', 'works') ORDER BY id",
    )
    .all<{ id: number; type: string; published: number; sort_order: number }>()
  return results
}

async function contract() {
  for (const query of rewrite().queries) await d1().prepare(query).run()
}

describe('旧構成の Projects を管理する', () => {
  it('一覧と編集は、同じ代表 id と統合した公開状態を使う', async () => {
    expect((await listBlocks(database())).find((row) => row.type === 'projects')).toMatchObject({
      id: 2,
      published: 1,
    })
    for (const id of [2, 3]) {
      const response = await open(`/admin/blocks/${id}/edit`)
      expect(response.status).toBe(200)
      const html = await response.text()
      expect(html).toContain('action="/admin/blocks/2"')
      expect(html).toContain('name="published" value="1" checked=""')
    }
  })

  it.each(['/admin/blocks/2/publish', '/admin/blocks/2'])(
    '%s の下書き化・再公開が両方の元行と公開ページに反映される',
    async (path) => {
      const off = await post(path)
      expect(off.status).toBe(303)
      expect(off.headers.get('location')).toBe('/admin/blocks?saved=draft#block-2')
      expect((await oldRows()).map((row) => row.published)).toEqual([0, 0])
      expect((await open('/projects', {}, false)).status).toBe(404)
      expect((await listBlocks(database())).find((row) => row.id === 2)?.published).toBe(0)

      const on = await post(path, { published: '1' })
      expect(on.status).toBe(303)
      expect((await oldRows()).map((row) => [row.id, row.published, row.sort_order])).toEqual([
        [2, 1, 20],
        [3, 1, 30],
      ])
      const publicPage = await open('/projects', {}, false)
      expect(publicPage.status).toBe(200)
      expect(await publicPage.text()).toContain('AppMixer')

      await post(path)
      await contract()
      expect((await listBlocks(database())).find((row) => row.type === 'projects')).toMatchObject({
        id: 2,
        published: 0,
      })
      expect((await open('/projects', {}, false)).status).toBe(404)
    },
  )

  it('並び順で選んだ代表を維持し、隠れた元行からの送信もその論理行を操作する', async () => {
    await d1().prepare('UPDATE blocks SET sort_order = 15 WHERE id = 3').run()
    const before = await listBlocks(database())
    expect(before.find((row) => row.type === 'projects')?.id).toBe(3)
    const edit = await open('/admin/blocks/2/edit')
    expect(edit.status).toBe(200)
    expect(await edit.text()).toContain('action="/admin/blocks/3"')
    const off = await post('/admin/blocks/2/publish')
    expect(off.headers.get('location')).toBe('/admin/blocks?saved=draft#block-3')
    expect((await oldRows()).map((row) => row.published)).toEqual([0, 0])
    expect((await listBlocks(database())).find((row) => row.type === 'projects')?.id).toBe(3)
  })

  it('外すと両方の元行が消え、Projects は復活せず、作品は残り、置き直せる', async () => {
    const response = await post('/admin/blocks/2/delete')
    expect(response.status).toBe(303)
    expect(await oldRows()).toEqual([])
    expect((await listBlocks(database())).map((row) => row.type)).toEqual(['hero', 'contact'])
    expect((await open('/projects', {}, false)).status).toBe(404)
    expect((await open('/apps/item/appmixer', {}, false)).status).toBe(200)
    expect((await post('/admin/blocks', { type: 'projects' })).status).toBe(303)
    expect((await open('/projects', {}, false)).status).toBe(200)
    await contract()
    expect((await listBlocks(database())).filter((row) => row.type === 'projects')).toHaveLength(1)
  })

  it.each(['publish', 'delete'])(
    '%s が途中の元行で失敗しても、元行全体が書き込み前の状態に戻る',
    async (action) => {
      const before = await oldRows()
      const operation = action === 'publish' ? 'UPDATE' : 'DELETE'
      const at = action === 'publish' ? 'NEW' : 'OLD'
      await d1()
        .prepare(
          `CREATE TRIGGER fail_legacy BEFORE ${operation} ON blocks WHEN ${at}.id = 3 BEGIN SELECT RAISE(ABORT, 'legacy write failed'); END`,
        )
        .run()
      try {
        expect((await post(`/admin/blocks/2/${action}`, { published: '1' })).status).toBe(500)
        expect(await oldRows()).toEqual(before)
        expect((await open('/projects', {}, false)).status).toBe(200)
      } finally {
        await d1().prepare('DROP TRIGGER fail_legacy').run()
      }
    },
  )

  it('移行済みの Projects でも、編集・公開切り替え・削除が通常どおり動く', async () => {
    await contract()
    const edit = await open('/admin/blocks/2/edit')
    expect(edit.status).toBe(200)
    expect(await edit.text()).toContain('name="published" value="1" checked=""')
    expect((await post('/admin/blocks/2')).status).toBe(303)
    expect((await open('/projects', {}, false)).status).toBe(404)
    expect((await post('/admin/blocks/2/publish', { published: '1' })).status).toBe(303)
    expect((await open('/projects', {}, false)).status).toBe(200)
    expect((await post('/admin/blocks/2/delete')).status).toBe(303)
    expect((await listBlocks(database())).map((row) => row.type)).toEqual(['hero', 'contact'])
    expect((await open('/apps/item/appmixer', {}, false)).status).toBe(200)
  })
})
