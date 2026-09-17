import { beforeEach, describe, expect, it } from 'vitest'
import { form, get, OWNER, resetDb, seedItem, seedMember, signIn } from './helpers'

beforeEach(resetDb)

describe('認証', () => {
  it('ログインしていなければ管理画面に入れない', async () => {
    const response = await get('/admin/members')
    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe('/admin/login')
  })

  it('ログインせずに書き込めない', async () => {
    const response = await get('/admin/items', { method: 'POST', body: form({ title: '侵入' }) })
    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe('/admin/login')
  })

  it('別のサイトからの送信は受け付けない', async () => {
    const signed = await signIn()
    const response = await signed('/admin/items', {
      method: 'POST',
      body: form({ type: 'app', title: '侵入' }),
      headers: { origin: 'https://evil.example' },
    })
    expect(response.status).toBe(403)
  })

  it('ログイン画面への CSRF も止める', async () => {
    const response = await get('/admin/login', {
      method: 'POST',
      body: form({ email: OWNER.email, password: OWNER.password }),
      headers: { origin: 'https://evil.example' },
    })
    expect(response.status).toBe(403)
  })

  it('間違ったパスワードでは入れない', async () => {
    await signIn()
    const response = await get('/admin/login', {
      method: 'POST',
      body: form({ email: OWNER.email, password: 'wrong' }),
    })
    expect(response.status).toBe(401)
    expect(response.headers.get('set-cookie')).toBeNull()
  })

  it('owner は二度作れない', async () => {
    await signIn()
    const response = await get('/admin/setup', {
      method: 'POST',
      body: form({
        token: 'test-setup-token',
        email: 'another@example.test',
        password: 'x'.repeat(12),
      }),
    })
    expect(response.status).toBe(404)
  })

  it('ログアウトするとセッションが即座に切れる', async () => {
    const signed = await signIn()
    expect((await signed('/admin/members')).status).toBe(200)
    await signed('/admin/logout', { method: 'POST' })
    expect((await signed('/admin/members')).headers.get('location')).toBe('/admin/login')
  })
})

describe('Members', () => {
  it('追加すると公開側に出る', async () => {
    const signed = await signIn()
    const response = await signed('/admin/members', {
      method: 'POST',
      body: form({ name: '岡崎 昂功', slug: 'okazaki', role: 'System Engineer', published: '1' }),
    })
    expect(response.status).toBe(303)
    expect(await (await get('/')).text()).toContain('岡崎 昂功')
  })

  it('slug が重なったら弾き、打った内容は残す', async () => {
    await seedMember({ slug: 'taken' })
    const signed = await signIn()
    const response = await signed('/admin/members', {
      method: 'POST',
      body: form({ name: '重複テスト', slug: 'taken', role: '残ってほしい肩書' }),
    })
    const html = await response.text()
    expect(response.status).toBe(400)
    expect(html).toContain('この slug は既に使われています')
    expect(html).toContain('残ってほしい肩書')
  })

  it('大きすぎる画像は黙って捨てず、保存も止める', async () => {
    const signed = await signIn()
    const body = form({ name: '画像テスト', slug: 'image-test' })
    body.append('avatar', new File([new Uint8Array(1_200_000)], 'big.png', { type: 'image/png' }))

    const response = await signed('/admin/members', { method: 'POST', body })
    expect(response.status).toBe(400)
    expect(await response.text()).toContain('1MB まで')
    expect(await (await signed('/admin/members')).text()).not.toContain('image-test')
  })

  it('削除しても、担当していた項目は残る', async () => {
    const member = await seedMember()
    await seedItem({ memberId: member.id, title: '残るアプリ' })

    const signed = await signIn()
    await signed(`/admin/members/${member.id}/delete`, { method: 'POST' })

    expect(await (await get('/')).text()).toContain('残るアプリ')
    expect((await get('/members/okazaki')).status).toBe(404)
  })
})

describe('Items', () => {
  it('作って、下書きに戻して、消せる', async () => {
    const signed = await signIn()
    await seedMember()

    await signed('/admin/items', {
      method: 'POST',
      body: form({
        type: 'app',
        title: 'テスト用アプリ',
        platformKey: 'web',
        published: '1',
        tags: 'Swift, SwiftUI',
        linkLabel: ['Repository', ''],
        linkUrl: ['https://example.com/repo', ''],
      }),
    })
    const html = await (await get('/')).text()
    expect(html).toContain('テスト用アプリ')
    expect(html).toContain('SwiftUI')
    expect(html).toContain('https://example.com/repo')

    const id = (await (await signed('/admin/items?type=app')).text()).match(
      /\/admin\/items\/(\d+)\/edit/,
    )?.[1]
    expect(id).toBeDefined()

    // published を送らなければ下書きに戻る
    await signed(`/admin/items/${id}`, {
      method: 'POST',
      body: form({ type: 'app', title: 'テスト用アプリ' }),
    })
    expect(await (await get('/')).text()).not.toContain('テスト用アプリ')

    await signed(`/admin/items/${id}/delete`, { method: 'POST' })
    expect(await (await signed('/admin/items?type=app')).text()).not.toContain('テスト用アプリ')
  })

  it('存在しない id は 404（500 にも、保存済みの見せかけにもしない）', async () => {
    const signed = await signIn()
    const missing = await signed('/admin/items/99999', {
      method: 'POST',
      body: form({ type: 'app', title: 'x' }),
    })
    expect(missing.status).toBe(404)

    const notANumber = await signed('/admin/items/abc', {
      method: 'POST',
      body: form({ type: 'app', title: 'x' }),
    })
    expect(notANumber.status).toBe(404)
  })

  it('タイトルが空なら弾き、打った内容は残す', async () => {
    const signed = await signIn()
    const response = await signed('/admin/items', {
      method: 'POST',
      body: form({ type: 'app', title: '', summary: '消えてはいけない文章', tags: 'KeepMe' }),
    })
    const html = await response.text()
    expect(response.status).toBe(400)
    expect(html).toContain('消えてはいけない文章')
    expect(html).toContain('KeepMe')
  })

  it('タグとリンクは総入れ替えになる', async () => {
    const signed = await signIn()
    await signed('/admin/items', {
      method: 'POST',
      body: form({ type: 'app', title: '入れ替え', published: '1', tags: '古いタグ' }),
    })
    const id = (await (await signed('/admin/items?type=app')).text()).match(
      /\/admin\/items\/(\d+)\/edit/,
    )?.[1]

    await signed(`/admin/items/${id}`, {
      method: 'POST',
      body: form({ type: 'app', title: '入れ替え', published: '1', tags: '新しいタグ' }),
    })

    const html = await (await get('/')).text()
    expect(html).toContain('新しいタグ')
    expect(html).not.toContain('古いタグ')
  })
})
