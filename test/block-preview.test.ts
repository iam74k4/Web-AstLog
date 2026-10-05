import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import * as schema from '../src/db/schema'
import { SITE_VERSION_KEY } from '../src/lib/page-cache'
import { db, form, get, resetDb, signIn, touch } from './helpers'

beforeEach(resetDb)

describe('文章ページの保存前プレビュー', () => {
  it('新しい文章を確認しても行を作らず、フォームの札も消費しない', async () => {
    const signed = await signIn()
    const version = await env.MEDIA.get(SITE_VERSION_KEY)
    const response = await signed('/admin/preview/blocks', {
      method: 'POST',
      body: form({
        type: 'note',
        title: '保存前',
        body: '未保存の文章です。',
        formKey: 'preview-only',
      }),
    })
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    const html = await response.text()
    expect(html).toContain('未保存の文章です。')
    expect(html).toContain('このプレビューでは保存されません')
    expect(html).not.toContain('<script')
    expect(await db().query.blocks.findMany()).toEqual([])
    expect(await env.MEDIA.get(SITE_VERSION_KEY)).toBe(version)
  })

  it('公開中のページに重ねても本文と公開状態を変更しない', async () => {
    const [block] = await db()
      .insert(schema.blocks)
      .values({ type: 'note', title: '公開文', body: '公開中の文章です。', published: 1 })
      .returning()
    if (!block) throw new Error('block がありません')
    await touch()
    const signed = await signIn()
    const version = await env.MEDIA.get(SITE_VERSION_KEY)
    const response = await signed(`/admin/preview/blocks/${block.id}`, {
      method: 'POST',
      body: form({ type: 'links', title: '入力中', body: '入力中の文章です。' }),
    })
    expect(response.status).toBe(200)
    expect(await response.text()).toContain('入力中の文章です。')
    const saved = await db().query.blocks.findFirst()
    expect(saved).toEqual(block)
    const publicPage = await get(`/block-${block.id}`)
    expect(publicPage.status).toBe(200)
    const html = await publicPage.text()
    expect(html).toContain('公開中の文章です。')
    expect(html).not.toContain('入力中の文章です。')
    expect(await env.MEDIA.get(SITE_VERSION_KEY)).toBe(version)
  })

  it('危険なリンクは公開前でも受け取らず、元のフォームで修正できる案内を返す', async () => {
    const signed = await signIn()
    const response = await signed('/admin/preview/blocks', {
      method: 'POST',
      body: form({ type: 'links', body: 'リンク | javascript:alert(1)' }),
    })
    expect(response.status).toBe(400)
    const html = await response.text()
    expect(html).toContain('編集していたタブに戻り')
    expect(html).not.toContain('href="javascript:')
    expect(await db().query.blocks.findMany()).toEqual([])
  })

  it('公開条件を満たさない下書きも注意を添えて確認できる', async () => {
    const signed = await signIn()
    const response = await signed('/admin/preview/blocks', {
      method: 'POST',
      body: form({ type: 'note', title: '長'.repeat(11), body: '確認したい本文' }),
    })
    expect(response.status).toBe(200)
    const html = await response.text()
    expect(html).toContain('確認したい本文')
    expect(html).toContain('公開する前に確認してください')
    expect(await db().query.blocks.findMany()).toEqual([])
  })

  it('匿名と外部サイトからのPOSTは拒否する', async () => {
    const body = () => form({ type: 'note', body: '非公開の本文' })
    expect((await get('/admin/preview/blocks', { method: 'POST', body: body() })).status).toBe(303)
    const signed = await signIn()
    expect(
      (
        await signed('/admin/preview/blocks', {
          method: 'POST',
          body: body(),
          headers: { origin: 'https://evil.example' },
        })
      ).status,
    ).toBe(403)
    expect(await db().query.blocks.findMany()).toEqual([])
  })

  it('存在しないIDと、不正な種類を別の対象に読み替えない', async () => {
    const signed = await signIn()
    for (const path of [
      '/admin/preview/blocks/0',
      '/admin/preview/blocks/01',
      '/admin/preview/blocks/999',
    ]) {
      expect(
        (await signed(path, { method: 'POST', body: form({ type: 'note', body: '本文' }) })).status,
      ).toBe(404)
    }
    for (const type of ['unknown', 'hero']) {
      expect(
        (await signed('/admin/preview/blocks', { method: 'POST', body: form({ type }) })).status,
      ).toBe(404)
    }
  })

  it('フォーム以外のPOSTは500にせず400を返し、既存ページと公開の版を変えない', async () => {
    const [block] = await db()
      .insert(schema.blocks)
      .values({ type: 'note', body: '保存済みの本文', published: 1 })
      .returning()
    if (!block) throw new Error('block がありません')
    const signed = await signIn()
    const version = await env.MEDIA.get(SITE_VERSION_KEY)
    for (const path of ['/admin/preview/blocks', `/admin/preview/blocks/${block.id}`]) {
      const response = await signed(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{"type":"note","body":"未保存"}',
      })
      expect(response.status).toBe(400)
      expect(response.headers.get('cache-control')).toBe('private, no-store')
      expect(await response.text()).toContain('フォームを読み取れませんでした')
    }
    expect(await db().query.blocks.findMany()).toEqual([block])
    expect(await env.MEDIA.get(SITE_VERSION_KEY)).toBe(version)
  })
})
