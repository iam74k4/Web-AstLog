import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import { get, resetDb, seedItem, seedMember } from './helpers'

beforeEach(resetDb)

describe('トップページ', () => {
  it('公開中のものだけを出す', async () => {
    const member = await seedMember()
    await seedItem({ title: '公開のアプリ', memberId: member.id, platformKey: 'web' })
    await seedItem({ title: '下書きのアプリ', memberId: member.id, published: 0 })

    const html = await (await get('/')).text()
    expect(html).toContain('公開のアプリ')
    expect(html).not.toContain('下書きのアプリ')
  })

  it('絞り込みは実際に使われているプラットフォームだけ並べる', async () => {
    await seedItem({ platformKey: 'web' })

    const html = await (await get('/')).text()
    expect(html).toContain('data-filter="web"')
    // cli の項目は1件も無いので、押しても何も起きないボタンは出さない
    expect(html).not.toContain('data-filter="cli"')
  })

  it('メンバーが1〜2人なら横長、3人以上ならグリッドにする', async () => {
    await seedMember()
    expect(await (await get('/')).text()).toContain('member--wide')

    await seedMember({ slug: 'b', name: 'B' })
    await seedMember({ slug: 'c', name: 'C' })
    expect(await (await get('/')).text()).toContain('member--compact')
  })

  it('アバターは遅延読み込みにしない（空の丸のまま見えてしまう）', async () => {
    await seedMember({ avatarUrl: '/assets/avatar.png' })
    const html = await (await get('/')).text()
    expect(html).toContain('src="/assets/avatar.png"')
    expect(html).not.toContain('loading="lazy"')
  })

  it('下書きのメンバーは名前もリンクも出さない', async () => {
    const draft = await seedMember({ slug: 'draft', name: '下書きの人', published: 0 })
    await seedMember({ slug: 'shown', name: '公開の人' })
    await seedMember({ slug: 'shown2', name: 'もう一人' })
    await seedItem({ title: '担当者が下書きのアプリ', memberId: draft.id })

    const html = await (await get('/')).text()
    expect(html).toContain('担当者が下書きのアプリ')
    expect(html).not.toContain('/members/draft')
    expect(html).not.toContain('下書きの人')
  })
})

describe('メンバーページ', () => {
  it('公開中なら出る', async () => {
    await seedMember({ headline: 'つくる工程そのものを、速くする。' })
    const response = await get('/members/okazaki')
    expect(response.status).toBe(200)
    expect(await response.text()).toContain('つくる工程そのものを、速くする。')
  })

  it('下書きなら 404', async () => {
    await seedMember({ slug: 'hidden', published: 0 })
    expect((await get('/members/hidden')).status).toBe(404)
  })
})

describe('/images', () => {
  it('avatars 配下だけを返す', async () => {
    await env.MEDIA.put('avatars/ok.png', 'image-bytes', {
      metadata: { contentType: 'image/png' },
    })
    expect((await get('/images/avatars/ok.png')).status).toBe(200)
  })

  it('ログイン試行の記録は読ませない', async () => {
    // 同じ KV に置いているので、キーの形を縛らないと漏れる
    await env.MEDIA.put('login:someone@example.com', '3')
    expect((await get('/images/login:someone@example.com')).status).toBe(404)
  })
})

it('知らない URL は 404 ページを返す', async () => {
  const response = await get('/nope')
  expect(response.status).toBe(404)
  expect(await response.text()).toContain('ページが見つかりません')
})
