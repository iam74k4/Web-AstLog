import { env } from 'cloudflare:test'
import { eq, sql } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { guardEdit, isEditConflict, settingsVersion } from '../src/db/edit'
import { loadSiteSettings, loadTheme } from '../src/db/queries'
import * as schema from '../src/db/schema'
import { MEDIA_RETENTION_SECONDS } from '../src/lib/media-retention'
import { discardImages } from '../src/routes/admin/images'
import { db, form, get, resetDb, seedItem, seedMember, signIn, TEST_SITE } from './helpers'

beforeEach(resetDb)

describe('古い編集を上書きしない', () => {
  it('同じ作品を同時保存しても、本文・タグ・リンクが勝った1件だけになる', async () => {
    const item = await seedItem({ published: 0 })
    const signed = await signIn({ rawForms: true })
    const response = await Promise.all(
      ['A', 'B'].map((title) =>
        signed(`/admin/items/${item.id}`, {
          method: 'POST',
          body: form({
            title,
            tags: title,
            linkLabel: title,
            linkUrl: `https://example.test/${title}`,
            _version: item.updatedAt,
          }),
        }),
      ),
    )
    expect(response.map((r) => r.status).sort()).toEqual([303, 409])
    const saved = await db().query.items.findFirst({
      where: eq(schema.items.id, item.id),
      with: { tags: true, links: true },
    })
    expect(saved?.tags.map((t) => t.tag)).toEqual([saved?.title])
    expect(saved?.links.map((l) => l.label)).toEqual([saved?.title])
    const losing = response.findIndex((r) => r.status === 409)
    const rejected = response[losing]
    if (!rejected) throw new Error('競合した応答が無い')
    const html = await rejected.text()
    expect(html).toContain(`value="${['A', 'B'][losing]}"`)
    expect(html).toContain('最新の編集画面と比較する')
    expect(html).toContain(`name="_version" value="${item.updatedAt}"`)
  })

  it('事前読み取り後に更新されても batch の検査で子の削除まで巻き戻す', async () => {
    const item = await seedItem()
    await db().insert(schema.itemTags).values({ itemId: item.id, tag: '保持する' })
    await db()
      .update(schema.items)
      .set({ updatedAt: '2099-01-01T00:00:00.000Z' })
      .where(eq(schema.items.id, item.id))
    let failure: unknown
    try {
      await db().batch([
        guardEdit(
          db(),
          sql`EXISTS (SELECT 1 FROM items WHERE id = ${item.id} AND updated_at = ${item.updatedAt})`,
        ),
        db().delete(schema.itemTags).where(eq(schema.itemTags.itemId, item.id)),
        db()
          .update(schema.items)
          .set({ title: '上書きしない' })
          .where(eq(schema.items.id, item.id)),
      ])
    } catch (error) {
      failure = error
    }
    expect(isEditConflict(failure)).toBe(true)
    expect((await db().select().from(schema.itemTags))[0]?.tag).toBe('保持する')
    expect((await db().select().from(schema.items))[0]?.title).toBe(item.title)
  })

  it('メンバーの競合・版の欠落では写真や天体を変えない', async () => {
    const member = await seedMember({ avatarUrl: '/images/avatars/retain.jpg' })
    const signed = await signIn({ rawForms: true })
    expect(
      (
        await signed(`/admin/members/${member.id}`, {
          method: 'POST',
          body: form({ name: '最新', celestialBody: 'sun', _version: member.updatedAt }),
        })
      ).status,
    ).toBe(303)
    for (const version of [member.updatedAt, undefined]) {
      const body = form({
        name: '古い入力',
        celestialBody: 'moon',
        removeAvatar: '1',
        ...(version ? { _version: version } : {}),
      })
      const result = await signed(`/admin/members/${member.id}`, { method: 'POST', body })
      expect(result.status).toBe(409)
      expect(await result.text()).toContain('value="古い入力"')
    }
    expect((await db().select().from(schema.members))[0]).toMatchObject({
      name: '最新',
      celestialBody: 'sun',
      avatarUrl: member.avatarUrl,
    })
  })

  it('ブロックの本文と公開状態も古い版から上書きしない', async () => {
    const [block] = await db()
      .insert(schema.blocks)
      .values({ type: 'note', title: '元の題', body: '元の本文', published: 0 })
      .returning()
    if (!block) throw new Error('fixture')
    const signed = await signIn({ rawForms: true })
    const save = (body: string) =>
      signed(`/admin/blocks/${block.id}`, {
        method: 'POST',
        body: form({ type: 'note', title: '題', body, _version: block.updatedAt }),
      })
    expect((await save('新しい本文')).status).toBe(303)
    const conflict = await save('残す入力')
    expect(conflict.status).toBe(409)
    expect(await conflict.text()).toContain('残す入力')
    expect((await db().select().from(schema.blocks))[0]?.body).toBe('新しい本文')
  })

  it('サイト設定と見た目はそれぞれ全体を1つの版として保存する', async () => {
    const signed = await signIn({ rawForms: true })
    for (const kind of ['site', 'appearance'] as const) {
      const version = await settingsVersion(db(), kind === 'site' ? 'site.' : 'theme.')
      const fresh: Record<string, string> =
        kind === 'site'
          ? { ...TEST_SITE, tagline: '最新の紹介' }
          : { accent: 'ember', typeface: 'serif' }
      const old: Record<string, string> =
        kind === 'site'
          ? { ...TEST_SITE, tagline: '未保存の紹介' }
          : { accent: 'sky', typeface: 'mono' }
      const save = (values: Record<string, string>) =>
        signed(`/admin/${kind}`, { method: 'POST', body: form({ ...values, _version: version }) })
      expect((await save(fresh)).status).toBe(303)
      const response = await save(old)
      expect(response.status).toBe(409)
      expect(await response.text()).toContain('入力内容は残しています')
    }
    expect((await loadSiteSettings(db())).tagline).toBe('最新の紹介')
    expect(await loadTheme(db())).toMatchObject({ accent: 'ember', typeface: 'serif' })
  })
})

describe('削除画像の控え', () => {
  it('差し替え後の原本を90日保持し、公開URLから控えは読めない', async () => {
    const bytes = new Uint8Array([0, 255, 127, 10, 128])
    const key = 'items/archive-test.png'
    await env.MEDIA.put(key, bytes, { metadata: { contentType: 'image/png' } })
    const before = Math.floor(Date.now() / 1000)
    await discardImages(env.MEDIA, [`/images/${key}`])
    expect(await env.MEDIA.get(key)).toBeNull()
    const archived = await env.MEDIA.getWithMetadata(`archive/${key}`, 'arrayBuffer')
    if (!archived.value) throw new Error('控えが無い')
    expect(new Uint8Array(archived.value)).toEqual(bytes)
    expect(archived.metadata).toMatchObject({ contentType: 'image/png', originalKey: key })
    const listed = await env.MEDIA.list({ prefix: `archive/${key}` })
    expect(listed.keys[0]?.expiration).toBeGreaterThanOrEqual(before + MEDIA_RETENTION_SECONDS)
    expect((await get(`/images/archive/${key}`)).status).toBe(404)
  })

  it('控えを作れなければ原本を消さない', async () => {
    const remove = vi.fn()
    const kv = {
      getWithMetadata: async () => ({ value: new Uint8Array([1]).buffer }),
      put: async () => {
        throw new Error('archive failed')
      },
      delete: remove,
    } as unknown as KVNamespace
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      await discardImages(kv, ['/images/items/keep.png'])
      expect(remove).not.toHaveBeenCalled()
    } finally {
      log.mockRestore()
    }
  })
})
