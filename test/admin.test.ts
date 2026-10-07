import { env } from 'cloudflare:test'
import seedSql from 'virtual:repo:seed.sql'
import { asc, eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import { blockType, MAX_CHARS } from '../src/blocks'
import * as schema from '../src/db/schema'
import { STORY_SECTIONS } from '../src/domain'
import { yearFrom } from '../src/lib/format'
import { SITE_VERSION_KEY } from '../src/lib/page-cache'
import { db, form, get, okText, resetDb, seedItem, seedMember, signIn, touch } from './helpers'
import { avif, file, gif, heic, jpeg, png, svg, webp } from './images'

beforeEach(resetDb)

/*
  管理から書いたものが公開側に出たか（消えたか）は `/all` で見る。
  公開中のものが全部1ページに出る URL なので、書いた種類ごとに宛先を選ばずに済む。
*/

describe('認証', () => {
  it('ログインしていなければ管理画面に入れない', async () => {
    const response = await get('/admin/members')
    expect(response.status).toBe(303)
    // 開こうとしていた画面は、ログイン後の戻り先として持ち回す
    expect(response.headers.get('location')).toBe('/admin/login?next=%2Fadmin%2Fmembers')
  })

  it('ログインせずに書き込めない', async () => {
    const response = await get('/admin/items', { method: 'POST', body: form({ title: '侵入' }) })
    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe('/admin/login')
  })

  it('メンバーの編集でも不正な id は 404 にし、DB エラーを起こさない', async () => {
    const signed = await signIn()
    const member = await seedMember({ id: 10 })
    for (const id of ['abc', 'Infinity', '0xa', '1e1', '10.0', '010']) {
      expect((await signed(`/admin/members/${id}/edit`)).status, id).toBe(404)
    }
    expect((await signed(`/admin/members/${member.id}/edit`)).status).toBe(200)
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

  it('ログアウトへの CSRF も止める（壁の外の POST）', async () => {
    const signed = await signIn()
    const response = await signed('/admin/logout', {
      method: 'POST',
      headers: { origin: 'https://evil.example' },
    })
    expect(response.status).toBe(403)
    expect((await signed('/admin/members')).status).toBe(200)
  })

  /*
    SEC-6。Referrer-Policy: no-referrer のページやサンドボックスの iframe からの
    POST は Origin: null になる。以前は new URL('null') が例外を投げて 500 だった
  */
  it('Origin: null の書き込みは 403 で断る（500 にしない）', async () => {
    const signed = await signIn()
    for (const path of ['/admin/logout', '/admin/items']) {
      const response = await signed(path, {
        method: 'POST',
        body: form({ type: 'app', title: '侵入' }),
        headers: { origin: 'null' },
      })
      expect(response.status, path).toBe(403)
    }
    expect((await signed('/admin/members')).status).toBe(200)
  })

  it('Origin が無ければ Sec-Fetch-Site、それも無ければ Referer で見分ける', async () => {
    const signed = await signIn()
    const post = (headers: Record<string, string>) =>
      signed('/admin/items', { method: 'POST', body: form({ type: 'app', title: 'x' }), headers })

    expect((await post({ 'sec-fetch-site': 'cross-site' })).status).toBe(403)
    expect((await post({ 'sec-fetch-site': 'same-site' })).status).toBe(403)
    expect((await post({ referer: 'https://evil.example/page' })).status).toBe(403)
    // 同じ origin でも scheme が違えば別物（host だけを比べていたころは通っていた）
    expect((await post({ origin: 'http://astlog.test' })).status).toBe(403)

    // 同じサイトからのもの。保存まで進む（400 は中身の検査。送り元の検査は通っている）
    expect((await post({ origin: 'https://astlog.test' })).status).not.toBe(403)
    expect((await post({ 'sec-fetch-site': 'same-origin' })).status).not.toBe(403)
    expect((await post({ referer: 'https://astlog.test/admin/items/new' })).status).not.toBe(403)
    // 3つとも無い（ブラウザ以外）。セッションのクッキーは Lax なので、別のサイトからは付かない
    expect((await post({})).status).not.toBe(403)
  })

  it('ログアウトするとセッションが即座に切れる', async () => {
    const signed = await signIn()
    expect((await signed('/admin/members')).status).toBe(200)
    await signed('/admin/logout', { method: 'POST' })
    expect((await signed('/admin/members')).headers.get('location')).toMatch(/^\/admin\/login/)
  })

  it('ログアウトの手は日本語。同じ画面の「すべての端末からログアウト」と同じ言葉で言う', async () => {
    // 操作の言葉は日本語（CLAUDE.md「文言」）。「Sign out」と並ぶと別の操作に見えた
    const signed = await signIn()
    const html = await (await signed('/admin/account')).text()
    const logout = html.slice(html.indexOf('action="/admin/logout"'))
    expect(logout.slice(0, logout.indexOf('</form>'))).toContain('>ログアウト</button>')
    expect(html).not.toContain('Sign out')
  })

  it('一覧の「追加」の手も日本語。メンバーの削除の手はメンバーと言う', async () => {
    // 「＋ Add item」「＋ Add member」が、空の一覧の「＋ 最初の項目を追加」と別の言葉で並んでいた
    const member = await seedMember()
    await seedItem()
    const signed = await signIn()
    const items = await (await signed('/admin/items?type=app')).text()
    expect(items).toContain('＋ 項目を追加')
    const members = await (await signed('/admin/members')).text()
    expect(members).toContain('＋ メンバーを追加')
    expect(items + members).not.toMatch(/Add (item|member)/)
    // 共通の既定の「この項目を削除…」は作品の言い方。メンバーに「項目」は合わない
    const edit = await (await signed(`/admin/members/${member.id}/edit`)).text()
    expect(edit).toContain('このメンバーを削除…')
    expect(edit).not.toContain('この項目を削除')
  })
})

describe('フォームの読み取り', () => {
  it.each(['multipart/form-data', 'multipart/form-data; boundary=missing'])(
    '%s の壊れた本文は 400 にし、保存も公開ページの版更新もしない',
    async (contentType) => {
      const signed = await signIn()
      const version = await env.MEDIA.get(SITE_VERSION_KEY)
      const response = await signed('/admin/members', {
        method: 'POST',
        headers: { 'content-type': contentType },
        body: 'invalid multipart payload',
      })
      expect(response.status).toBe(400)
      expect(await response.text()).toContain('フォームを読み取れませんでした')
      expect(await db().select().from(schema.members)).toHaveLength(0)
      expect(await env.MEDIA.get(SITE_VERSION_KEY)).toBe(version)
    },
  )

  it('ログイン前の壊れたフォームも、認証の壁でログインへ戻す', async () => {
    const response = await get('/admin/members', {
      method: 'POST',
      headers: { 'content-type': 'multipart/form-data' },
      body: 'invalid multipart payload',
    })
    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe('/admin/login')
    expect(await db().select().from(schema.members)).toHaveLength(0)
  })

  it('urlencoded と画像を含む multipart は先読み後もそのまま保存できる', async () => {
    const signed = await signIn()
    const urlencoded = await signed('/admin/members', {
      method: 'POST',
      body: new URLSearchParams({ name: 'Form', slug: 'urlencoded' }),
    })
    expect(urlencoded.status).toBe(303)

    const body = form({ name: 'Image', slug: 'multipart' })
    body.append('avatar', file(png(), 'avatar.png', 'image/png'))
    const multipart = await signed('/admin/members', { method: 'POST', body })
    expect(multipart.status).toBe(303)

    const members = await db().select().from(schema.members).orderBy(asc(schema.members.id))
    expect(members.map((member) => member.slug)).toEqual(['urlencoded', 'multipart'])
    const avatarUrl = members[1]?.avatarUrl
    expect(avatarUrl).toMatch(/^\/images\/avatars\//)
    const image = await get(avatarUrl ?? '')
    expect(image.status).toBe(200)
    expect(image.headers.get('content-type')).toBe('image/png')
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
    expect(await okText('/all')).toContain('岡崎 昂功')
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

    expect(await okText('/all')).toContain('残るアプリ')
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
        summary: '説明。',
        published: '1',
        tags: 'Swift, SwiftUI',
        linkLabel: ['Repository', ''],
        linkUrl: ['https://example.com/repo', ''],
      }),
    })
    const html = await okText('/all')
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
    expect(await okText('/all')).not.toContain('テスト用アプリ')

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

  it('非10進・小数・指数表記の id で別の行を開いたり削除したりできない', async () => {
    const signed = await signIn()
    const item = await seedItem({ id: 10, title: '残す項目' })
    for (const id of ['0xa', '1e1', '10.0', '010', '9007199254740993', 'Infinity']) {
      const edit = await signed(`/admin/items/${id}/edit`)
      expect(edit.status, id).toBe(404)
      const deletion = await signed(`/admin/items/${id}/delete`, { method: 'POST' })
      expect(deletion.status, id).toBe(404)
    }
    expect((await signed(`/admin/items/${item.id}/edit`)).status).toBe(200)
    expect((await db().select().from(schema.items)).map((row) => row.id)).toEqual([item.id])
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
      body: form({
        type: 'app',
        title: '入れ替え',
        summary: '説明。',
        published: '1',
        tags: '古いタグ',
      }),
    })
    const id = (await (await signed('/admin/items?type=app')).text()).match(
      /\/admin\/items\/(\d+)\/edit/,
    )?.[1]

    await signed(`/admin/items/${id}`, {
      method: 'POST',
      body: form({
        type: 'app',
        title: '入れ替え',
        summary: '説明。',
        published: '1',
        tags: '新しいタグ',
      }),
    })

    const html = await okText('/all')
    expect(html).toContain('新しいタグ')
    expect(html).not.toContain('古いタグ')
  })
})

/*
  作品の本文と画像。本文と画像は作品のページにだけ出る（一覧には出さない。
  一覧のサムネイルは同じ画像の飾り）。

  画像はアバターと同じ経路（種類と大きさの検査 → KV）で、置き場だけが items/。
  公開側の /images/* は、KV のキーの形（avatars/ と items/ の2つの置き場）で
  縛っている（test/public.test.ts の /images）。
*/
describe('Items — 本文と画像', () => {
  // 中身の頭が本物の PNG（受け入れは先頭のバイトで種類を決める。test/images.ts）
  const shot = () => file(png(), 'shot.png', 'image/png')
  const withImage = (values: Record<string, string>, image = shot()) => {
    const body = form(values)
    body.append('image', image)
    return body
  }
  const itemKeys = async () => (await env.MEDIA.list({ prefix: 'items/' })).keys.map((k) => k.name)

  // KV は resetDb が触らない（D1 だけ）。前のテストが置いた画像を数えないよう、置き場を空にする
  beforeEach(async () => {
    for (const key of await itemKeys()) await env.MEDIA.delete(key)
  })

  it('列を足しても既にある行はそのまま（本文と代替テキストは空、画像は無し）', async () => {
    // drizzle-kit が生成した SQL（drizzle/0005_item_body_image.sql）。手で書いていない
    const found = env.TEST_MIGRATIONS.find((one) => one.name.includes('item_body_image'))
    expect(found, '0005_item_body_image の移行が無い').toBeDefined()
    const sql = found?.queries.join('\n') ?? ''
    expect(sql).toContain("ALTER TABLE `items` ADD `body` text DEFAULT '' NOT NULL")
    expect(sql).toContain('ALTER TABLE `items` ADD `image_url` text')
    expect(sql).toContain("ALTER TABLE `items` ADD `image_alt` text DEFAULT '' NOT NULL")

    // 列を知らない書き方（seed.sql の INSERT がそう）でも入り、空のまま残る
    await env.DB.prepare(
      "INSERT INTO items (type, title, published, sort_order) VALUES ('app', '古い行', 1, 10)",
    ).run()
    const [row] = await db().select().from(schema.items)
    expect(row?.body).toBe('')
    expect(row?.imageUrl).toBeNull()
    expect(row?.imageAlt).toBe('')
  })

  it('画像は KV の items/ に置き、作品のページに代替テキストつきで出る。本文は小節（Story）に出る', async () => {
    const signed = await signIn()
    const response = await signed('/admin/items', {
      method: 'POST',
      body: withImage({
        type: 'app',
        title: 'AppMixer',
        slug: 'appmixer',
        imageAlt: '音量ミキサーの画面',
        summary: '音量を分ける常駐アプリ。',
        body: '背景と結果の段落です。',
        published: '1',
      }),
    })
    expect(response.status).toBe(303)

    const [row] = await db().select().from(schema.items)
    // キーの形は /images/* の検査を必ず通る形（置き場/slug-乱数.拡張子）
    expect(row?.imageUrl).toMatch(/^\/images\/items\/appmixer-[0-9a-f]{8}\.png$/)
    const url = row?.imageUrl ?? ''
    expect(await itemKeys()).toEqual([url.replace('/images/', '')])

    const image = await get(url)
    expect(image.status).toBe(200)
    expect(image.headers.get('content-type')).toBe('image/png')

    const html = await okText('/apps/item/appmixer')
    expect(html).toContain(
      `<figure class="shot"><img src="${url}" alt="音量ミキサーの画面" decoding="async"/></figure>`,
    )
    // 説明の段落のあとに、本文の小節が同じ段落の部品（Note）で出る
    expect(html).toContain('<div class="bio"><p>音量を分ける常駐アプリ。</p></div>')
    expect(html).toContain(
      '<div class="story" id="story"><div class="head head--sub"><h2>Story</h2></div><div class="story-parts"><div class="bio"><p>背景と結果の段落です。</p></div></div></div>',
    )
  })

  it('画像があるのに代替テキストが空なら、公開では止める。打った内容は残し、画像は書かない', async () => {
    const signed = await signIn()
    const response = await signed('/admin/items', {
      method: 'POST',
      body: withImage({
        type: 'app',
        title: 'AppMixer',
        body: '残ってほしい本文',
        summary: '説明。',
        published: '1',
      }),
    })
    expect(response.status).toBe(400)

    const html = await response.text()
    expect(html).toContain('代替テキストが要ります')
    expect(html).toContain('残ってほしい本文')
    // ファイルの欄は描き直せない。選んだ画像も保存された、と読ませない
    expect(html).toContain('画像はまだ保存していません')
    // 止めた保存で KV に孤児の画像を残さない
    expect(await itemKeys()).toEqual([])
    expect(await db().select().from(schema.items)).toHaveLength(0)
  })

  it('いまの画像を残したまま代替テキストを消して公開しようとしても止める。外すなら通る', async () => {
    await env.MEDIA.put('items/kept-aaaa.png', 'bytes')
    const item = await seedItem({
      slug: 'kept',
      imageUrl: '/images/items/kept-aaaa.png',
      imageAlt: '前の説明',
    })
    const signed = await signIn()

    const kept = await signed(`/admin/items/${item.id}`, {
      method: 'POST',
      body: form({
        type: 'app',
        title: 'AppMixer',
        slug: 'kept',
        imageAlt: '',
        summary: '説明。',
        published: '1',
      }),
    })
    expect(kept.status).toBe(400)
    expect(await kept.text()).toContain('代替テキストが要ります')

    const removed = await signed(`/admin/items/${item.id}`, {
      method: 'POST',
      body: form({
        type: 'app',
        title: 'AppMixer',
        slug: 'kept',
        imageAlt: '',
        removeImage: '1',
        summary: '説明。',
        published: '1',
      }),
    })
    expect(removed.status).toBe(303)
  })

  it('下書きの保存では、代替テキストの不足も説明の長さも見ない', async () => {
    const signed = await signIn()
    const long = 'あ'.repeat(MAX_CHARS.itemSummary + 10)
    const response = await signed('/admin/items', {
      method: 'POST',
      body: withImage({ type: 'app', title: '下書き', summary: long }),
    })
    expect(response.status).toBe(303)

    const [row] = await db().select().from(schema.items)
    expect(row?.published).toBe(0)
    expect(row?.summary).toBe(long)
    expect(row?.imageUrl).toMatch(/^\/images\/items\//)
  })

  it('本文は長さでも段落の数でも止めない（作品のページは縦に読む）', async () => {
    /*
      本文を1画面に収めていたころは、300 字・3段落で止めていた。いまは作品の
      ページの小節で、ページごと縦に伸びる
    */
    const signed = await signIn()
    const body = Array.from({ length: 6 }, (_, i) => `段落${i}。${'あ'.repeat(120)}`).join('\n\n')
    const response = await signed('/admin/items', {
      method: 'POST',
      body: form({ type: 'app', title: '長い本文', body, summary: '説明。', published: '1' }),
    })
    expect(response.status).toBe(303)
    const [row] = await db().select().from(schema.items)
    expect(row?.published).toBe(1)
    expect(row?.body).toBe(body)
  })

  it('大きすぎる画像は、下書きでも止める（長さではなく受け取れない画像）', async () => {
    const signed = await signIn()
    const response = await signed('/admin/items', {
      method: 'POST',
      body: withImage(
        { type: 'app', title: '大きい画像' },
        file(new Uint8Array(1_200_000), 'big.png', 'image/png'),
      ),
    })
    expect(response.status).toBe(400)
    expect(await response.text()).toContain('1MB まで')
    expect(await itemKeys()).toEqual([])
    expect(await db().select().from(schema.items)).toHaveLength(0)
  })

  it('「画像を外す」と作品のページから消え、KV からも消える', async () => {
    await env.MEDIA.put('items/gone-aaaa.png', 'bytes')
    const item = await seedItem({
      slug: 'gone',
      imageUrl: '/images/items/gone-aaaa.png',
      imageAlt: '消える画像',
    })
    const signed = await signIn()
    expect(await (await signed(`/admin/items/${item.id}/edit`)).text()).toContain('画像を外す')

    const response = await signed(`/admin/items/${item.id}`, {
      method: 'POST',
      body: form({
        type: 'app',
        title: 'AppMixer',
        slug: 'gone',
        removeImage: '1',
        summary: '説明。',
        published: '1',
      }),
    })
    expect(response.status).toBe(303)
    const [row] = await db().select().from(schema.items)
    expect(row?.imageUrl).toBeNull()
    expect(await itemKeys()).toEqual([])
    expect(await okText('/apps/item/gone')).not.toContain('<figure')
  })

  it('差し替えると、前の画像は KV から消える', async () => {
    await env.MEDIA.put('items/swap-aaaa.png', 'bytes')
    const item = await seedItem({
      slug: 'swap',
      imageUrl: '/images/items/swap-aaaa.png',
      imageAlt: '前の画像',
    })
    const signed = await signIn()

    const response = await signed(`/admin/items/${item.id}`, {
      method: 'POST',
      body: withImage({
        type: 'app',
        title: 'AppMixer',
        slug: 'swap',
        imageAlt: '新しい画像',
        summary: '説明。',
        published: '1',
      }),
    })
    expect(response.status).toBe(303)
    const [row] = await db().select().from(schema.items)
    expect(row?.imageUrl).not.toBe('/images/items/swap-aaaa.png')
    expect(await itemKeys()).toEqual([(row?.imageUrl ?? '').replace('/images/', '')])
  })

  it('作品を削除すると、画像も KV から消える', async () => {
    await env.MEDIA.put('items/del-aaaa.png', 'bytes')
    const item = await seedItem({ imageUrl: '/images/items/del-aaaa.png', imageAlt: '消える' })
    const signed = await signIn()
    expect(await (await signed(`/admin/items/${item.id}/delete`)).text()).toContain('、画像 1 枚も')

    await signed(`/admin/items/${item.id}/delete`, { method: 'POST' })
    expect(await itemKeys()).toEqual([])
  })

  it('作品のページの小節の形は区分によらず同じ（テンプレートの欄の小見出しは h3）', async () => {
    const signed = await signIn()
    await signed('/admin/items', {
      method: 'POST',
      body: form({
        type: 'work',
        title: '問い合わせ対応',
        slug: 'support',
        summary: '説明。',
        storyApproach: '資料を整理しました。',
        published: '1',
      }),
    })
    expect(await okText('/works/item/support')).toContain(
      '<div class="story-parts"><div><h3 class="side-head" lang="en">APPROACH</h3><div class="bio"><p>資料を整理しました。</p></div></div></div>',
    )
  })

  it('本文の出る場所と画像の欄は書く前に見える。フォームは画像を送れる形', async () => {
    const signed = await signIn()
    const html = await (await signed('/admin/items/new?type=app')).text()
    expect(html).toContain('enctype="multipart/form-data"')
    expect(html).toContain('作品のページの「Story」に出る')
    expect(html).toContain('name="image"')
    expect(html).toContain('name="imageAlt"')
    // 外す画像が無い作品には「画像を外す」を出さない
    expect(html).not.toContain('画像を外す')
  })

  it('リンク欄はサイト内 URL も入力でき、リンクと実績値の各欄の目的が読み上げで分かる', async () => {
    const signed = await signIn()
    for (const type of ['app', 'work']) {
      const html = await (await signed(`/admin/items/new?type=${type}`)).text()
      const inputs = [...html.matchAll(/<input\b[^>]*>/g)].map((match) => match[0])
      for (const [name, purpose] of [
        ['linkLabel', 'のラベル'],
        ['linkUrl', 'の URL'],
      ]) {
        const links = inputs.filter((input) => input.includes(`name="${name}"`))
        expect(links, type).toHaveLength(3)
        links.forEach((input, index) => {
          expect(input, type).toContain(`aria-label="リンク ${index + 1} ${purpose}"`)
          // type=url では /projects を入れてもブラウザが送信を止める。
          if (name === 'linkUrl') {
            expect(input, type).toContain('type="text"')
            expect(input, type).toContain('inputmode="url"')
          }
        })
      }
      for (const [name, purpose] of [
        ['metricValue', '値'],
        ['metricUnit', '単位'],
        ['metricNote', '添え'],
      ]) {
        const input = inputs.find((input) => input.includes(`name="${name}"`))
        expect(input, type).toContain(`aria-label="実績値の${purpose}"`)
      }
    }
  })
})

/*
  作品の本文のテンプレート（src/domain.ts の STORY_SECTIONS。背景・取り組み・工夫・成果）。
  個人開発も業務も同じ欄・同じ順で書き、作品のページの Story にも同じ小見出しで出る
  （持ち主の「個人開発と業務で内容を統一するテンプレート」）。実績値の欄もどちらの区分にも出す
*/
describe('Items — 本文のテンプレート', () => {
  const storyFields = (html: string) =>
    [...html.matchAll(/<textarea class="[^"]*" name="(story\w+)"/g)].map((match) => match[1])

  it('個人開発も業務も、同じテンプレートの欄と実績値の欄を同じ順で出す', async () => {
    const signed = await signIn()
    for (const type of ['app', 'work']) {
      const html = await (await signed(`/admin/items/new?type=${type}`)).text()
      expect(storyFields(html), type).toEqual(STORY_SECTIONS.map((section) => section.column))
      for (const section of STORY_SECTIONS) {
        expect(html, type).toContain(
          `<span class="field__label" id="field-${section.column}-label">${section.label}</span>`,
        )
        expect(html, type).toContain(`作品のページの見出しは ${section.heading}`)
      }
      expect(html, type).toContain('name="metricValue"')
      // テンプレートより前の本文の欄は、中身の無い作品（新しい作品）には出さない
      expect(html, type).not.toContain('name="body"')
    }
  })

  it('欄はそれぞれの列に入る。弾いたときは書いた内容を欄に返す', async () => {
    const signed = await signIn()
    const values = {
      type: 'app',
      title: 'AppMixer',
      slug: 'appmixer',
      storyBackground: '音量を分けたかったからです。\n\n既存の道具では足りませんでした。',
      storyResults: 'Mac App Store で配布しています。',
    }
    // 公開には説明が要る（公開の関門）。弾いても、書いた欄は消さない
    const blocked = await signed('/admin/items', {
      method: 'POST',
      body: form({ ...values, published: '1' }),
    })
    expect(blocked.status).toBe(400)
    const again = await blocked.text()
    expect(again).toContain('音量を分けたかったからです。')
    expect(again).toContain('Mac App Store で配布しています。')

    const saved = await signed('/admin/items', { method: 'POST', body: form(values) })
    expect(saved.status).toBe(303)
    const [row] = await db().select().from(schema.items)
    expect(row?.storyBackground).toBe(values.storyBackground)
    expect(row?.storyApproach).toBe('')
    expect(row?.storyHighlights).toBe('')
    expect(row?.storyResults).toBe(values.storyResults)
    expect(row?.body).toBe('')
  })

  it('前の本文の欄は中身があるときだけ出す。空にして保存すれば、Story からも欄からも消える', async () => {
    const item = await seedItem({ slug: 'legacy', summary: '説明。', body: '前に書いた本文です。' })
    const signed = await signIn()
    const edit = await (await signed(`/admin/items/${item.id}/edit`)).text()
    expect(edit).toContain('前の本文（見出しなし）')
    expect(edit).toContain('前に書いた本文です。')

    const save = (body: string) =>
      signed(`/admin/items/${item.id}`, {
        method: 'POST',
        body: form({
          type: 'app',
          title: 'AppMixer',
          slug: 'legacy',
          summary: '説明。',
          body,
          storyBackground: '背景の段落です。',
          published: '1',
        }),
      })
    // 前の本文が先、テンプレートの欄が続く
    expect((await save('前に書いた本文です。')).status).toBe(303)
    expect(await okText('/apps/item/legacy')).toContain(
      '<div class="story-parts"><div class="bio"><p>前に書いた本文です。</p></div><div><h3 class="side-head" lang="en">BACKGROUND</h3>',
    )

    expect((await save('')).status).toBe(303)
    const [row] = await db().select().from(schema.items)
    expect(row?.body).toBe('')
    expect(await (await signed(`/admin/items/${item.id}/edit`)).text()).not.toContain('name="body"')
    const page = await okText('/apps/item/legacy')
    expect(page).not.toContain('前に書いた本文です。')
    expect(page).toContain('背景の段落です。')
  })

  it('個人開発の実績値も、一覧の行と作品のページに出る', async () => {
    const signed = await signIn()
    await signed('/admin/items', {
      method: 'POST',
      body: form({
        type: 'app',
        title: 'AppMixer',
        slug: 'appmixer',
        summary: '説明。',
        metricValue: '1,200',
        metricUnit: 'DL',
        metricNote: '公開から3か月',
        published: '1',
      }),
    })
    const metric =
      '<div class="metric"><span class="metric__value">1,200</span><span class="metric__unit">DL</span><span class="metric__note">公開から3か月</span></div>'
    expect(await okText('/projects')).toContain(metric)
    expect(await okText('/apps/item/appmixer')).toContain(metric)
  })
})

/*
  画像の受け入れ（SEC-2 / ADM-4）。アバターと作品の画像は同じ1本の検査
  （src/routes/admin/images.ts の pickImage → src/lib/image.ts の sniffImage）を通る。

  種類は中身の先頭のバイトで決め、ブラウザの名乗り（file.type）は見ない。
  以前は file.type が image/ で始まれば何でも受け、その名乗りのまま KV に
  入れて同じオリジンから配っていた——SVG の <script> がサイトのオリジンで走り、
  HEIC は Chrome と Firefox で壊れて見えた。
*/
/*
  作品のアイコンとほかの画像（スクリーンショット）。どちらも管理画面から上げ、KV の
  items/ に置く（メインの画像と同じ経路と検査）。ほかの画像は作品のページのギャラリーに
  並び（components.tsx の ItemShots）、1枚ずつ代替テキストが要る（公開の関門）。
*/
describe('Items — アイコンとほかの画像', () => {
  const itemKeys = async () =>
    (await env.MEDIA.list({ prefix: 'items/' })).keys.map((k) => k.name).sort()

  beforeEach(async () => {
    for (const key of await itemKeys()) await env.MEDIA.delete(key)
  })

  // フォームの値に画像を足す（同じ名前の欄は足した順に並ぶ）
  const withFiles = (values: Record<string, string | string[]>, files: [string, File][]) => {
    const body = form(values)
    for (const [name, one] of files) body.append(name, one)
    return body
  }
  const pngFile = (name: string) => file(png(), name, 'image/png')
  const shotsOf = (itemId: number) =>
    db()
      .select()
      .from(schema.itemShots)
      .where(eq(schema.itemShots.itemId, itemId))
      .orderBy(asc(schema.itemShots.sortOrder), asc(schema.itemShots.id))
  // 下ごしらえ: KV に置いた画像と、それを指すほかの画像の行
  const seedShots = async (
    itemId: number,
    shots: { key: string; alt: string; sortOrder: number }[],
  ) => {
    for (const shot of shots) {
      await env.MEDIA.put(shot.key, 'bytes', { metadata: { contentType: 'image/png' } })
    }
    await db()
      .insert(schema.itemShots)
      .values(
        shots.map((shot) => ({
          itemId,
          url: `/images/${shot.key}`,
          alt: shot.alt,
          width: 1440,
          height: 900,
          sortOrder: shot.sortOrder,
        })),
      )
    await touch()
  }
  // 作品のページのギャラリーの画像（src と代替テキスト）を並びのまま
  const galleryOf = (html: string) => {
    const from = html.indexOf('<section class="gallery"')
    if (from < 0) return []
    const gallery = html.slice(from, html.indexOf('</section>', from))
    return [...gallery.matchAll(/<img src="([^"]+)" alt="([^"]*)"/g)].map((m) => [m[1], m[2]])
  }

  it('アイコンとほかの画像を上げると KV の items/ に置き、作品のページでギャラリーに並ぶ', async () => {
    const signed = await signIn()
    const response = await signed('/admin/items', {
      method: 'POST',
      body: withFiles(
        {
          type: 'app',
          title: 'AppMixer',
          slug: 'appmixer',
          summary: '音量を分ける常駐アプリ。',
          imageAlt: 'メインの画面',
          newShotAlt: ['通話中の画面', '機能の一覧'],
          published: '1',
        },
        [
          ['image', pngFile('main.png')],
          ['icon', pngFile('icon.png')],
          ['newShot', pngFile('a.png')],
          ['newShot', pngFile('b.png')],
        ],
      ),
    })
    expect(response.status).toBe(303)

    const [row] = await db().select().from(schema.items)
    // アイコンのキーも /images/* の検査を通る形（置き場/slug-icon-乱数.拡張子）
    expect(row?.iconUrl).toMatch(/^\/images\/items\/appmixer-icon-[0-9a-f]{8}\.png$/)
    const shots = await shotsOf(row?.id ?? 0)
    // 寸法は中身の頭から読む（画像の縦横比と共有カードに使う）。並び順は 10 刻み
    expect(shots.map((shot) => [shot.alt, shot.sortOrder, shot.width, shot.height])).toEqual([
      ['通話中の画面', 10, 1200, 630],
      ['機能の一覧', 20, 1200, 630],
    ])
    for (const shot of shots)
      expect(shot.url).toMatch(/^\/images\/items\/appmixer-[0-9a-f]{8}\.png$/)
    expect(await itemKeys()).toEqual(
      [row?.imageUrl, row?.iconUrl, ...shots.map((shot) => shot.url)]
        .map((url) => (url ?? '').replace('/images/', ''))
        .sort(),
    )

    const html = await okText('/apps/item/appmixer')
    expect(html).toContain(
      `<img class="head__icon" src="${row?.iconUrl}" alt="" width="64" height="64" decoding="async"/>`,
    )
    // 2枚以上なので、説明の組には絵を置かず、ギャラリーに全部を並べる（メインの画像が先）
    expect(html).not.toContain('<figure class="shot">')
    expect(html).toContain(
      '<section class="gallery" aria-label="Screenshots"><figure class="gallery__item gallery__item--lead">',
    )
    expect(galleryOf(html)).toEqual([
      [row?.imageUrl, 'メインの画面'],
      [shots[0]?.url, '通話中の画面'],
      [shots[1]?.url, '機能の一覧'],
    ])
    // 一覧の行は題の左にアイコン（飾り）
    expect(await okText('/projects')).toContain(
      `<img class="entry__icon" src="${row?.iconUrl}" alt=""`,
    )
  })

  it('ほかの画像も1枚ずつ代替テキストが要る（公開のとき）。何枚目かを言い、画像は書かない', async () => {
    const signed = await signIn()
    const values = {
      type: 'app',
      title: 'AppMixer',
      summary: '説明。',
      newShotAlt: ['通話中の画面', ''],
    }
    const files = (): [string, File][] => [
      ['newShot', pngFile('a.png')],
      ['newShot', pngFile('b.png')],
    ]
    const blocked = await signed('/admin/items', {
      method: 'POST',
      body: withFiles({ ...values, published: '1' }, files()),
    })
    expect(blocked.status).toBe(400)
    const html = await blocked.text()
    // どの欄かはフォームの呼び名で言う（足す欄は「足す画像（N）」）
    expect(html).toContain('1枚ずつ代替テキストが要ります（足す画像（2））')
    // ファイルの欄は描き直せない。打った代替テキストは残す
    expect(html).toContain('画像はまだ保存していません')
    expect(html).toContain('value="通話中の画面"')
    expect(await itemKeys()).toEqual([])
    expect(await db().select().from(schema.items)).toHaveLength(0)

    // 下書きなら通る（代替テキストは公開するときにだけ見る）
    const draft = await signed('/admin/items', { method: 'POST', body: withFiles(values, files()) })
    expect(draft.status).toBe(303)
    expect(await db().select().from(schema.itemShots)).toHaveLength(2)
  })

  it('代替テキストだけを書いて画像を選んでいない欄は止める（書いた字を黙って捨てない）', async () => {
    const signed = await signIn()
    const body = form({ type: 'app', title: 'AppMixer', newShotAlt: ['通話中の画面', ''] })
    // ブラウザは空のファイルの欄も送る（名前の無い 0 バイト）
    body.append('newShot', file(new Uint8Array(0), '', 'application/octet-stream'))
    body.append('newShot', file(new Uint8Array(0), '', 'application/octet-stream'))
    const response = await signed('/admin/items', { method: 'POST', body })
    expect(response.status).toBe(400)
    const html = await response.text()
    expect(html).toContain('1 番目の欄: 代替テキストがあるのに画像が選ばれていません')
    // 2番目の欄（どちらも空）は数えない。書いた代替テキストは描き直す
    expect(html).not.toContain('2 番目の欄')
    expect(html).toContain('value="通話中の画面"')
    expect(await db().select().from(schema.items)).toHaveLength(0)
  })

  it('並び順を書き換えると帯の並びが変わり、外した画像は行も KV も消える（全角の数字も読む）', async () => {
    const item = await seedItem({ slug: 'appmixer', summary: '説明。' })
    await seedShots(item.id, [
      { key: 'items/appmixer-aaaaaaaa.png', alt: '一枚目', sortOrder: 10 },
      { key: 'items/appmixer-bbbbbbbb.png', alt: '二枚目', sortOrder: 20 },
      { key: 'items/appmixer-cccccccc.png', alt: '三枚目', sortOrder: 30 },
    ])
    const [a, b, c] = await shotsOf(item.id)
    if (!a || !b || !c) throw new Error('ほかの画像を作れなかった')
    const signed = await signIn()
    const edit = await (await signed(`/admin/items/${item.id}/edit`)).text()
    expect(edit).toContain(`name="shotAlt-${a.id}" value="一枚目"`)
    expect(edit).toContain(`name="shotRemove-${c.id}" value="1"`)

    const response = await signed(`/admin/items/${item.id}`, {
      method: 'POST',
      body: form({
        type: 'app',
        title: 'AppMixer',
        slug: 'appmixer',
        summary: '説明。',
        published: '1',
        [`shotAlt-${a.id}`]: '一枚目',
        [`shotOrder-${a.id}`]: '３０',
        [`shotAlt-${b.id}`]: '二枚目（直した）',
        [`shotOrder-${b.id}`]: '10',
        [`shotAlt-${c.id}`]: '',
        [`shotOrder-${c.id}`]: '20',
        [`shotRemove-${c.id}`]: '1',
      }),
    })
    // 外す画像の代替テキストは空でも公開を止めない（残らないので）
    expect(response.status).toBe(303)
    expect((await shotsOf(item.id)).map((shot) => [shot.alt, shot.sortOrder])).toEqual([
      ['二枚目（直した）', 10],
      ['一枚目', 30],
    ])
    expect(await itemKeys()).toEqual(['items/appmixer-aaaaaaaa.png', 'items/appmixer-bbbbbbbb.png'])
    expect(galleryOf(await okText('/apps/item/appmixer'))).toEqual([
      ['/images/items/appmixer-bbbbbbbb.png', '二枚目（直した）'],
      ['/images/items/appmixer-aaaaaaaa.png', '一枚目'],
    ])
  })

  it('並び順が数字でなければ 400 で何枚目かを言い、何も書かない', async () => {
    const item = await seedItem({ slug: 'appmixer' })
    await seedShots(item.id, [{ key: 'items/appmixer-aaaaaaaa.png', alt: '一枚目', sortOrder: 10 }])
    const [a] = await shotsOf(item.id)
    const signed = await signIn()
    const response = await signed(`/admin/items/${item.id}`, {
      method: 'POST',
      body: form({
        type: 'app',
        title: 'AppMixer',
        slug: 'appmixer',
        [`shotAlt-${a?.id}`]: '一枚目',
        [`shotOrder-${a?.id}`]: 'いちばん先',
      }),
    })
    expect(response.status).toBe(400)
    const html = await response.text()
    expect(html).toContain('並び順は数字で書いてください（1 枚目）')
    // 打った字はそのまま描き直す
    expect(html).toContain('value="いちばん先"')
    expect((await shotsOf(item.id)).map((shot) => shot.sortOrder)).toEqual([10])
  })

  it('ほかの画像は 8 枚まで。足す欄は残りの数だけ出し、超えて足そうとすると止める', async () => {
    const item = await seedItem({ slug: 'many' })
    await seedShots(
      item.id,
      Array.from({ length: 7 }, (_, index) => ({
        key: `items/many-${index}aaaaaaa.png`,
        alt: `${index + 1} 枚目`,
        sortOrder: (index + 1) * 10,
      })),
    )
    const signed = await signIn()
    const edit = await (await signed(`/admin/items/${item.id}/edit`)).text()
    expect(edit.match(/name="newShot"/g)).toHaveLength(1)

    const response = await signed(`/admin/items/${item.id}`, {
      method: 'POST',
      body: withFiles(
        { type: 'app', title: 'AppMixer', slug: 'many', newShotAlt: ['八枚目', '九枚目'] },
        [
          ['newShot', pngFile('8.png')],
          ['newShot', pngFile('9.png')],
        ],
      ),
    })
    expect(response.status).toBe(400)
    expect(await response.text()).toContain('ほかの画像は 8 枚までです')
    expect(await shotsOf(item.id)).toHaveLength(7)
    expect(await itemKeys()).toHaveLength(7)
  })

  it('アイコンを差し替える・外すと、前のアイコンは KV から消える', async () => {
    await env.MEDIA.put('items/appmixer-icon-aaaaaaaa.png', 'bytes')
    const item = await seedItem({
      slug: 'appmixer',
      iconUrl: '/images/items/appmixer-icon-aaaaaaaa.png',
    })
    const signed = await signIn()
    expect(await (await signed(`/admin/items/${item.id}/edit`)).text()).toContain('アイコンを外す')

    const swapped = await signed(`/admin/items/${item.id}`, {
      method: 'POST',
      body: withFiles({ type: 'app', title: 'AppMixer', slug: 'appmixer' }, [
        ['icon', pngFile('new.png')],
      ]),
    })
    expect(swapped.status).toBe(303)
    const [row] = await db().select().from(schema.items)
    expect(row?.iconUrl).toMatch(/^\/images\/items\/appmixer-icon-[0-9a-f]{8}\.png$/)
    expect(row?.iconUrl).not.toBe('/images/items/appmixer-icon-aaaaaaaa.png')
    expect(await itemKeys()).toEqual([(row?.iconUrl ?? '').replace('/images/', '')])

    const removed = await signed(`/admin/items/${item.id}`, {
      method: 'POST',
      body: form({ type: 'app', title: 'AppMixer', slug: 'appmixer', removeIcon: '1' }),
    })
    expect(removed.status).toBe(303)
    const [after] = await db().select().from(schema.items)
    expect(after?.iconUrl).toBeNull()
    expect(await itemKeys()).toEqual([])
  })

  it('作品を削除すると、アイコンとほかの画像も KV から消える', async () => {
    await env.MEDIA.put('items/appmixer-icon-aaaaaaaa.png', 'bytes')
    const item = await seedItem({
      slug: 'appmixer',
      iconUrl: '/images/items/appmixer-icon-aaaaaaaa.png',
    })
    await seedShots(item.id, [
      { key: 'items/appmixer-bbbbbbbb.png', alt: '一枚目', sortOrder: 10 },
      { key: 'items/appmixer-cccccccc.png', alt: '二枚目', sortOrder: 20 },
    ])
    const signed = await signIn()
    expect(await (await signed(`/admin/items/${item.id}/delete`)).text()).toContain('、画像 3 枚も')

    await signed(`/admin/items/${item.id}/delete`, { method: 'POST' })
    expect(await itemKeys()).toEqual([])
    expect(await db().select().from(schema.itemShots)).toHaveLength(0)
  })

  it('追加のフォームを2度送っても、ほかの画像は重ならない（2度目の画像は足さない）', async () => {
    const signed = await signIn()
    const html = await (await signed('/admin/items/new?type=app')).text()
    const key = html.match(/name="formKey" value="([0-9a-f]{16})"/)?.[1] ?? ''
    const send = () =>
      signed('/admin/items', {
        method: 'POST',
        body: withFiles(
          { type: 'app', title: 'AppMixer', formKey: key, newShotAlt: ['通話中の画面'] },
          [['newShot', pngFile('a.png')]],
        ),
      })
    expect((await send()).status).toBe(303)
    expect((await send()).status).toBe(303)
    const [row] = await db().select().from(schema.items)
    const shots = await shotsOf(row?.id ?? 0)
    expect(shots.map((shot) => shot.alt)).toEqual(['通話中の画面'])
    // 1度目の画像は KV から消えている
    expect(await itemKeys()).toEqual([(shots[0]?.url ?? '').replace('/images/', '')])
  })

  it('追加のフォームを開き直して送っても、そのあと編集で足した画像は消えない', async () => {
    /*
      追加のフォームは「戻る」で開き直せ、同じ札のまま送れる。2度目の送信で1度目の画像を
      入れ替えていたころは、そのあとで編集画面から足した画像まで消えた
    */
    const signed = await signIn()
    const html = await (await signed('/admin/items/new?type=app')).text()
    const key = html.match(/name="formKey" value="([0-9a-f]{16})"/)?.[1] ?? ''
    const send = () =>
      signed('/admin/items', {
        method: 'POST',
        body: withFiles(
          {
            type: 'app',
            title: 'AppMixer',
            slug: 'appmixer',
            formKey: key,
            newShotAlt: ['一枚目'],
          },
          [['newShot', pngFile('a.png')]],
        ),
      })
    expect((await send()).status).toBe(303)
    const [row] = await db().select().from(schema.items)
    const id = row?.id ?? 0
    const edited = await signed(`/admin/items/${id}`, {
      method: 'POST',
      body: withFiles(
        { type: 'app', title: 'AppMixer', slug: 'appmixer', newShotAlt: ['二枚目'] },
        [['newShot', pngFile('b.png')]],
      ),
    })
    expect(edited.status).toBe(303)
    const before = await shotsOf(id)
    expect(before.map((shot) => shot.alt)).toEqual(['一枚目', '二枚目'])

    expect((await send()).status).toBe(303)
    expect((await shotsOf(id)).map((shot) => shot.url)).toEqual(before.map((shot) => shot.url))
    expect(await itemKeys()).toEqual(before.map((shot) => shot.url.replace('/images/', '')).sort())
  })

  it('代替テキストの不足は、フォームの行の呼び名で言う（外した行と並べ替えに左右されない）', async () => {
    const item = await seedItem({ slug: 'appmixer', summary: '説明。' })
    await seedShots(item.id, [
      { key: 'items/appmixer-aaaaaaaa.png', alt: '一枚目', sortOrder: 10 },
      { key: 'items/appmixer-bbbbbbbb.png', alt: '二枚目', sortOrder: 20 },
      { key: 'items/appmixer-cccccccc.png', alt: '三枚目', sortOrder: 30 },
    ])
    const [a, b, c] = await shotsOf(item.id)
    const signed = await signIn()
    const response = await signed(`/admin/items/${item.id}`, {
      method: 'POST',
      body: form({
        type: 'app',
        title: 'AppMixer',
        slug: 'appmixer',
        summary: '説明。',
        published: '1',
        // 1枚目を外し、2枚目の代替テキストを消し、3枚目を先頭へ並べ替える
        [`shotAlt-${a?.id}`]: '一枚目',
        [`shotRemove-${a?.id}`]: '1',
        [`shotAlt-${b?.id}`]: '',
        [`shotOrder-${b?.id}`]: '20',
        [`shotAlt-${c?.id}`]: '三枚目',
        [`shotOrder-${c?.id}`]: '5',
      }),
    })
    expect(response.status).toBe(400)
    const html = await response.text()
    // 行の読み上げの名前（「2 枚目の代替テキスト」）と同じ番号で言う
    expect(html).toContain('1枚ずつ代替テキストが要ります（2 枚目）')
    expect(html).toContain('aria-label="2 枚目の代替テキスト"')
    // 外す印は行ごとに名前が違う
    expect(html).toContain(`aria-label="1 枚目を外す"`)
    // 何も書かない（1枚目も消えない）
    expect((await shotsOf(item.id)).map((shot) => shot.alt)).toEqual(['一枚目', '二枚目', '三枚目'])
    expect(await itemKeys()).toHaveLength(3)
  })

  it('編集で D1 が落ちたら、新しいアイコンとほかの画像は消え、前の画像と行はそのまま', async () => {
    await env.MEDIA.put('items/appmixer-icon-aaaaaaaa.png', 'bytes')
    const item = await seedItem({
      slug: 'appmixer',
      iconUrl: '/images/items/appmixer-icon-aaaaaaaa.png',
    })
    await seedShots(item.id, [
      { key: 'items/appmixer-bbbbbbbb.png', alt: '一枚目', sortOrder: 10 },
      { key: 'items/appmixer-cccccccc.png', alt: '二枚目', sortOrder: 20 },
    ])
    const [first] = await shotsOf(item.id)
    const before = await itemKeys()
    await env.DB.prepare(
      "CREATE TRIGGER IF NOT EXISTS fail_items_update BEFORE UPDATE ON items BEGIN SELECT RAISE(ABORT, 'D1 を落とす'); END",
    ).run()
    try {
      const signed = await signIn()
      const response = await signed(`/admin/items/${item.id}`, {
        method: 'POST',
        body: withFiles(
          {
            type: 'app',
            title: 'AppMixer',
            slug: 'appmixer',
            [`shotAlt-${first?.id}`]: '一枚目',
            [`shotRemove-${first?.id}`]: '1',
            newShotAlt: ['三枚目'],
          },
          [
            ['icon', pngFile('new-icon.png')],
            ['newShot', pngFile('c.png')],
          ],
        ),
      })
      expect(response.status).toBe(500)
    } finally {
      await env.DB.prepare('DROP TRIGGER IF EXISTS fail_items_update').run()
    }
    // 置いた新しい画像は消え、外すはずだった画像も行もそのまま（何も書かれていない）
    expect(await itemKeys()).toEqual(before)
    expect((await shotsOf(item.id)).map((shot) => shot.alt)).toEqual(['一枚目', '二枚目'])
    const [row] = await db().select().from(schema.items)
    expect(row?.iconUrl).toBe('/images/items/appmixer-icon-aaaaaaaa.png')
  })

  it('D1 が落ちたら、置いたアイコンとほかの画像は KV に残らない', async () => {
    await env.DB.prepare(
      "CREATE TRIGGER IF NOT EXISTS fail_shots BEFORE INSERT ON item_shots BEGIN SELECT RAISE(ABORT, 'D1 を落とす'); END",
    ).run()
    try {
      const signed = await signIn()
      const response = await signed('/admin/items', {
        method: 'POST',
        body: withFiles({ type: 'app', title: '落ちる', newShotAlt: ['一枚目'] }, [
          ['icon', pngFile('icon.png')],
          ['newShot', pngFile('a.png')],
        ]),
      })
      expect(response.status).toBe(500)
    } finally {
      await env.DB.prepare('DROP TRIGGER IF EXISTS fail_shots').run()
    }
    // 行も書かれない（1つの batch）
    expect(await itemKeys()).toEqual([])
    expect(await db().select().from(schema.items)).toHaveLength(0)
  })
})

describe('画像の受け入れ', () => {
  const keys = async (prefix: string) =>
    (await env.MEDIA.list({ prefix })).keys.map((key) => key.name)
  // KV は resetDb が触らない。前のテストが置いた画像を数えないよう、置き場を空にする
  beforeEach(async () => {
    for (const key of [...(await keys('avatars/')), ...(await keys('items/'))]) {
      await env.MEDIA.delete(key)
    }
  })

  const withAvatar = (values: Record<string, string>, avatar: File) => {
    const body = form(values)
    body.append('avatar', avatar)
    return body
  }
  const withImage = (values: Record<string, string>, image: File) => {
    const body = form(values)
    body.append('image', image)
    return body
  }

  it('SVG のアバターは 400 で弾き、理由を出す。KV にも D1 にも書かない', async () => {
    const signed = await signIn()
    const response = await signed('/admin/members', {
      method: 'POST',
      body: withAvatar({ name: 'Eve', slug: 'eve' }, file(svg(), 'logo.svg', 'image/svg+xml')),
    })
    expect(response.status).toBe(400)
    const html = await response.text()
    expect(html).toContain('SVG と HEIC は受け付けません')
    // 欄に印が付く（どの欄の話かを色だけでなく位置でも示す）
    expect(html).toContain('input input--file input--error')
    expect(await keys('avatars/')).toEqual([])
    expect(await db().select().from(schema.members)).toHaveLength(0)
  })

  it('image/png を名乗る SVG も弾く（名乗りと中身が違う）。HEIC も弾く', async () => {
    const signed = await signIn()
    for (const [image, what] of [
      [file(svg(), 'shot.png', 'image/png'), '名乗りは PNG の SVG'],
      [file(heic(), 'IMG_0001.HEIC', 'image/heic'), 'HEIC'],
      [file(heic(), 'IMG_0001.jpg', 'image/jpeg'), '名乗りは JPEG の HEIC'],
    ] as const) {
      const response = await signed('/admin/items', {
        method: 'POST',
        body: withImage({ type: 'app', title: '画像テスト' }, image),
      })
      expect(response.status, what).toBe(400)
      expect(await response.text(), what).toContain('SVG と HEIC は受け付けません')
    }
    const avatar = await signed('/admin/members', {
      method: 'POST',
      body: withAvatar({ name: 'Eve', slug: 'eve' }, file(svg(), 'eve.png', 'image/png')),
    })
    expect(avatar.status).toBe(400)
    expect(await keys('items/')).toEqual([])
    expect(await keys('avatars/')).toEqual([])
    expect(await db().select().from(schema.items)).toHaveLength(0)
  })

  it('5種類は通る。拡張子・content-type・寸法は中身から付け、名乗りは使わない', async () => {
    const signed = await signIn()
    const cases = [
      { content: png(1200, 630), type: 'image/png', extension: 'png', size: [1200, 630] },
      { content: jpeg(800, 600), type: 'image/jpeg', extension: 'jpg', size: [800, 600] },
      { content: webp(1024, 512), type: 'image/webp', extension: 'webp', size: [1024, 512] },
      { content: avif(1600, 900), type: 'image/avif', extension: 'avif', size: [1600, 900] },
      { content: gif(320, 200), type: 'image/gif', extension: 'gif', size: [320, 200] },
    ]
    for (const [index, one] of cases.entries()) {
      // わざと違う名前と違う名乗りで送る。保存されるのは中身の判定の結果だけ
      const response = await signed('/admin/items', {
        method: 'POST',
        body: withImage(
          { type: 'app', title: `画像 ${index}`, slug: `shot-${index}` },
          file(one.content, 'upload.bin', 'application/octet-stream'),
        ),
      })
      expect(response.status, one.type).toBe(303)

      const row = await db().query.items.findFirst({
        where: eq(schema.items.slug, `shot-${index}`),
      })
      expect(row?.imageUrl, one.type).toMatch(
        new RegExp(`^/images/items/shot-${index}-[0-9a-f]{8}\\.${one.extension}$`),
      )
      expect([row?.imageWidth, row?.imageHeight], one.type).toEqual(one.size)
      const stored = await env.MEDIA.getWithMetadata<{ contentType: string }>(
        (row?.imageUrl ?? '').replace('/images/', ''),
      )
      expect(stored.metadata?.contentType, one.type).toBe(one.type)
    }

    // アバターも同じ1本
    const member = await signed('/admin/members', {
      method: 'POST',
      body: withAvatar({ name: 'Eve', slug: 'eve' }, file(webp(), 'eve', '')),
    })
    expect(member.status).toBe(303)
    const [eve] = await db().select().from(schema.members)
    expect(eve?.avatarUrl).toMatch(/^\/images\/avatars\/eve-[0-9a-f]{8}\.webp$/)
  })

  it('選ぶ画面でも5種類に絞る（accept）', async () => {
    const signed = await signIn()
    const accept = 'accept="image/png,image/jpeg,image/webp,image/avif,image/gif"'
    expect(await (await signed('/admin/members/new')).text()).toContain(accept)
    expect(await (await signed('/admin/items/new?type=app')).text()).toContain(accept)
  })

  it('画像の URL はフォームから受け取らない。サーバーが付けた /images/… だけ', async () => {
    const signed = await signIn()
    await signed('/admin/items', {
      method: 'POST',
      body: form({
        type: 'app',
        title: '画像なし',
        slug: 'no-shot',
        imageUrl: 'javascript:alert(1)',
        imageWidth: '1200',
      }),
    })
    await signed('/admin/members', {
      method: 'POST',
      body: form({ name: 'Eve', slug: 'eve', avatarUrl: 'https://evil.example/x.svg' }),
    })
    const [item] = await db().select().from(schema.items)
    expect(item?.imageUrl).toBeNull()
    expect(item?.imageWidth).toBeNull()
    const [member] = await db().select().from(schema.members)
    expect(member?.avatarUrl).toBeNull()
  })

  /*
    KV と D1 は1つのトランザクションにできない。新しい画像を KV に置いてから
    D1 を書き、D1 で落ちたら置いた画像を消す（commitWithImage）。D1 を落とすのは
    テストの中だけの trigger——どの行を書いても RAISE で止まる
  */
  describe('KV と D1 の順序', () => {
    const failing = async (table: 'items' | 'members', event: 'INSERT' | 'UPDATE') => {
      await env.DB.prepare(
        `CREATE TRIGGER IF NOT EXISTS fail_${table}_${event} BEFORE ${event} ON ${table} BEGIN SELECT RAISE(ABORT, 'D1 を落とす'); END`,
      ).run()
      return () => env.DB.prepare(`DROP TRIGGER IF EXISTS fail_${table}_${event}`).run()
    }

    it('作品の追加で D1 が落ちたら、置いた画像は KV に残らない', async () => {
      const signed = await signIn()
      const restore = await failing('items', 'INSERT')
      try {
        const response = await signed('/admin/items', {
          method: 'POST',
          body: withImage({ type: 'app', title: '落ちる' }, file(png(), 'a.png', 'image/png')),
        })
        expect(response.status).toBe(500)
      } finally {
        await restore()
      }
      expect(await keys('items/')).toEqual([])
    })

    it('作品の差し替えで D1 が落ちたら、新しい画像は消え、前の画像と行はそのまま', async () => {
      await env.MEDIA.put('items/old-aaaa.png', 'bytes', { metadata: { contentType: 'image/png' } })
      const item = await seedItem({
        slug: 'old',
        imageUrl: '/images/items/old-aaaa.png',
        imageAlt: '前の画像',
      })
      const signed = await signIn()
      const restore = await failing('items', 'UPDATE')
      try {
        const response = await signed(`/admin/items/${item.id}`, {
          method: 'POST',
          body: withImage(
            { type: 'app', title: 'AppMixer', slug: 'old', imageAlt: '新しい画像' },
            file(png(), 'b.png', 'image/png'),
          ),
        })
        expect(response.status).toBe(500)
      } finally {
        await restore()
      }
      expect(await keys('items/')).toEqual(['items/old-aaaa.png'])
      const [row] = await db().select().from(schema.items)
      expect(row?.imageUrl).toBe('/images/items/old-aaaa.png')
    })

    it('メンバーの追加・差し替えで D1 が落ちても、アバターは KV に残らない', async () => {
      const signed = await signIn()
      const restoreInsert = await failing('members', 'INSERT')
      try {
        const response = await signed('/admin/members', {
          method: 'POST',
          body: withAvatar({ name: 'Eve', slug: 'eve' }, file(png(), 'eve.png', 'image/png')),
        })
        expect(response.status).toBe(500)
      } finally {
        await restoreInsert()
      }
      expect(await keys('avatars/')).toEqual([])

      await env.MEDIA.put('avatars/okazaki-aaaa.png', 'bytes')
      const member = await seedMember({ avatarUrl: '/images/avatars/okazaki-aaaa.png' })
      const restoreUpdate = await failing('members', 'UPDATE')
      try {
        const response = await signed(`/admin/members/${member.id}`, {
          method: 'POST',
          body: withAvatar(
            { name: member.name, slug: 'okazaki' },
            file(png(), 'o.png', 'image/png'),
          ),
        })
        expect(response.status).toBe(500)
      } finally {
        await restoreUpdate()
      }
      expect(await keys('avatars/')).toEqual(['avatars/okazaki-aaaa.png'])
    })

    it('メンバーを消すと、アバターも KV から消える', async () => {
      await env.MEDIA.put('avatars/okazaki-bbbb.png', 'bytes')
      const member = await seedMember({ avatarUrl: '/images/avatars/okazaki-bbbb.png' })
      const signed = await signIn()
      await signed(`/admin/members/${member.id}/delete`, { method: 'POST' })
      expect(await keys('avatars/')).toEqual([])
    })
  })

  it('寸法の列を足しても既にある行はそのまま（前の移行まで当てた D1 に行を入れてから当てる）', async () => {
    // drizzle-kit が生成した SQL（drizzle/0008_item_image_size.sql）。手で書いていない
    const found = env.TEST_MIGRATIONS.find((one) => one.name.includes('item_image_size'))
    expect(found, '0008_item_image_size の移行が無い').toBeDefined()
    const sql = found?.queries.join('\n') ?? ''
    expect(sql).toContain('ALTER TABLE `items` ADD `image_width` integer')
    expect(sql).toContain('ALTER TABLE `items` ADD `image_height` integer')

    const d1 = env.MIGRATION_DB
    const { results } = await d1
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY rowid DESC",
      )
      .all<{ name: string }>()
    for (const { name } of results) await d1.prepare(`DROP TABLE \`${name}\``).run()
    const run = async (names: (name: string) => boolean) => {
      for (const migration of env.TEST_MIGRATIONS.filter((one) => names(one.name))) {
        for (const query of migration.queries) await d1.prepare(query).run()
      }
    }

    await run((name) => name < '0008')
    await d1
      .prepare(
        "INSERT INTO items (id, type, title, slug, image_url, image_alt, published) VALUES (5, 'app', 'AppMixer', 'appmixer', '/images/items/appmixer-aaaa.png', '画面', 1)",
      )
      .run()
    await run((name) => name >= '0008')

    const row = await d1.prepare('SELECT * FROM items WHERE id = 5').first()
    expect(row).toMatchObject({
      title: 'AppMixer',
      image_url: '/images/items/appmixer-aaaa.png',
      image_alt: '画面',
      image_width: null,
      image_height: null,
    })
  })
})

/*
  作品のリンクとメンバーの GitHub（ADM-3 / PUB-5 / SEC-4）。

  URL の検査は保存と描画の2か所。ここは保存の側で、公開ページで落とすものは
  管理画面でも保存させない。以前は javascript: も頭を省いた「github.com/…」も
  303 で保存され、公開ページの href と JSON-LD に出ていた。ラベルを忘れた行は
  知らせなしに捨てていた。描画の側は test/public.test.ts の「URL の検査」。
*/
describe('URL の検査（保存）', () => {
  const links = (rows: [string, string][]) => ({
    linkLabel: rows.map(([label]) => label),
    linkUrl: rows.map(([, url]) => url),
  })

  it('作品のリンクの javascript: と相対 URL は、何行目かを示して 400。下書きでも止める', async () => {
    const signed = await signIn()
    const response = await signed('/admin/items', {
      method: 'POST',
      body: form({
        type: 'app',
        title: '残ってほしい題',
        ...links([
          ['Repository', 'https://example.test/r'],
          ['XSS', 'javascript:alert(document.domain)'],
          ['GitHub', 'github.com/iam74k4'],
        ]),
      }),
    })
    expect(response.status).toBe(400)
    const html = await response.text()
    expect(html).toContain('2 行目の URL は https:// か mailto: か / で始めてください')
    expect(html).toContain('3 行目の URL は https:// か mailto: か / で始めてください')
    expect(html).not.toContain('1 行目')
    // 打った内容は残す（直して保存し直せる）
    expect(html).toContain('残ってほしい題')
    expect(html).toContain('value="github.com/iam74k4"')
    expect(await db().select().from(schema.items)).toHaveLength(0)
    expect(await db().select().from(schema.itemLinks)).toHaveLength(0)
  })

  it('ラベルか URL の片方しか無い行は、黙って捨てずに 400', async () => {
    const item = await seedItem({ slug: 'appmixer' })
    const signed = await signIn()
    const response = await signed(`/admin/items/${item.id}`, {
      method: 'POST',
      body: form({
        type: 'app',
        title: 'AppMixer',
        slug: 'appmixer',
        summary: '説明。',
        published: '1',
        ...links([
          ['', 'https://only-url.example'],
          ['ラベルだけ', ''],
          ['', ''],
        ]),
      }),
    })
    expect(response.status).toBe(400)
    const html = await response.text()
    expect(html).toContain('1 行目はラベルと URL の両方を入れてください')
    expect(html).toContain('2 行目はラベルと URL の両方を入れてください')
    // 両方空の行（フォームが用意した空き）は数えない
    expect(html).not.toContain('3 行目')
  })

  it('通る行は並べた順に保存する。空の行は数えない', async () => {
    const signed = await signIn()
    const response = await signed('/admin/items', {
      method: 'POST',
      body: form({
        type: 'app',
        title: 'AppMixer',
        slug: 'appmixer',
        ...links([
          ['Repository', 'https://example.test/r'],
          ['', ''],
          ['Mail', 'mailto:a@example.test'],
          ['一覧', '/projects'],
        ]),
      }),
    })
    expect(response.status).toBe(303)
    const rows = await db().select().from(schema.itemLinks)
    expect(rows.map((row) => [row.label, row.url, row.sortOrder])).toEqual([
      ['Repository', 'https://example.test/r', 0],
      ['Mail', 'mailto:a@example.test', 1],
      ['一覧', '/projects', 2],
    ])
  })

  it('メンバーの GitHub は https:// の絶対 URL だけ。畳む欄は inputmode=url', async () => {
    const signed = await signIn()
    for (const github of [
      'javascript:alert(1)',
      'github.com/iam74k4',
      'http://github.com/iam74k4',
    ]) {
      const response = await signed('/admin/members', {
        method: 'POST',
        body: form({ name: 'Eve', slug: 'eve', github }),
      })
      expect(response.status, github).toBe(400)
      expect(await response.text(), github).toContain('https:// で始まる URL を入れてください')
    }
    expect(await db().select().from(schema.members)).toHaveLength(0)

    const ok = await signed('/admin/members', {
      method: 'POST',
      body: form({ name: 'Eve', slug: 'eve', github: 'https://github.com/eve' }),
    })
    expect(ok.status).toBe(303)

    const html = await (await signed('/admin/members/new')).text()
    expect(html).toMatch(/<input class="input" type="text" inputmode="url" name="github"/)
  })

  it('アバターを選んで別の欄で弾かれたら、画像はまだ保存していないと添える', async () => {
    const signed = await signIn()
    const body = form({ name: 'Eve', slug: 'eve', github: 'github.com/eve' })
    body.append('avatar', file(png(), 'eve.png', 'image/png'))
    const response = await signed('/admin/members', { method: 'POST', body })
    expect(response.status).toBe(400)
    expect(await response.text()).toContain('画像はまだ保存していません')
  })
})

/*
  作品1件の恒久リンク（slug）を、書く側から見る。

  公開側（test/public.test.ts）が押さえているのは「slug で名指しした URL は
  動かない」こと。こちらで押さえるのは、その slug が必ず付くことと、
  1つの slug が2つの作品を指す状態を保存させないこと。
*/
describe('Items — 恒久リンクの slug', () => {
  it('打たなければ作品名から作る。一覧に貼れる URL が出る', async () => {
    const signed = await signIn()

    expect(await (await signed('/admin/items/new?type=app')).text()).toContain('name="slug"')

    await signed('/admin/items', {
      method: 'POST',
      body: form({ type: 'app', title: 'App Mixer', summary: '説明。', published: '1' }),
    })

    // 貼るための URL なので、探しに行かずに読めるところに出す
    expect(await (await signed('/admin/items?type=app')).text()).toContain('/apps/item/app-mixer')
    expect((await get('/apps/item/app-mixer')).status).toBe(200)
  })

  it('日本語だけの題でも、恒久リンクの無い作品は作らない', async () => {
    const signed = await signIn()
    await signed('/admin/items', {
      method: 'POST',
      body: form({ type: 'work', title: '開発工程の効率化', summary: '説明。', published: '1' }),
    })

    // toSlug は空を返す。読めない代わりに重ならない名前にする
    const html = await (await signed('/admin/items?type=work')).text()
    const slug = html.match(/\/works\/item\/([a-z0-9-]+)/)?.[1]
    expect(slug, '恒久リンクが付いていない').toBeDefined()
    expect((await get(`/works/item/${slug}`)).status).toBe(200)
  })

  it('slug が重なったら弾き、打った内容は残す', async () => {
    const signed = await signIn()
    await signed('/admin/items', {
      method: 'POST',
      body: form({
        type: 'app',
        title: 'AppMixer',
        slug: 'appmixer',
        summary: '説明。',
        published: '1',
      }),
    })

    const response = await signed('/admin/items', {
      method: 'POST',
      body: form({
        type: 'app',
        title: '別のアプリ',
        slug: 'appmixer',
        summary: '消えてはいけない文章',
        published: '1',
      }),
    })
    expect(response.status).toBe(400)

    const html = await response.text()
    expect(html).toContain('この slug は既に使われています')
    expect(html).toContain('消えてはいけない文章')
    // 1つの URL が2つの作品を指す状態は保存されない
    expect(await okText('/apps/item/appmixer')).not.toContain('別のアプリ')
  })

  it('この列より前からある行は、一度保存すれば恒久リンクが付く', async () => {
    // 移行で足した列なので、既にある行の slug は null（埋められる既定値が無い）
    const item = await seedItem({ title: 'AppMixer', published: 1 })
    expect(item.slug).toBeNull()
    expect((await get('/apps/item/appmixer')).status).toBe(404)

    const signed = await signIn()
    // 一覧には「恒久リンクなし」と出ているので、放置されたことに気づける
    expect(await (await signed('/admin/items?type=app')).text()).toContain('恒久リンクなし')

    // 編集画面を開いて、slug の欄に何も足さずに保存し直すだけ
    await signed(`/admin/items/${item.id}`, {
      method: 'POST',
      body: form({ type: 'app', title: 'AppMixer', summary: '説明。', published: '1' }),
    })
    expect((await get('/apps/item/appmixer')).status).toBe(200)
  })

  it('同じ slug の行は DB が受け付けない（書く口が増えても最後に効く）', async () => {
    await seedItem({ title: 'AppMixer', slug: 'appmixer' })
    // フォームの検査より外側の最後の受け。seed.sql も将来の書き口もここを通る
    await expect(
      seedItem({ title: '別のアプリ', slug: 'appmixer', sortOrder: 20 }),
    ).rejects.toThrow()
  })

  it('自分の slug は重なりにしない（付けたあとも編集して保存できる）', async () => {
    const signed = await signIn()
    await signed('/admin/items', {
      method: 'POST',
      body: form({
        type: 'app',
        title: 'AppMixer',
        slug: 'appmixer',
        summary: '説明。',
        published: '1',
      }),
    })
    const id = (await (await signed('/admin/items?type=app')).text()).match(
      /\/admin\/items\/(\d+)\/edit/,
    )?.[1]

    const response = await signed(`/admin/items/${id}`, {
      method: 'POST',
      body: form({
        type: 'app',
        title: 'AppMixer 2',
        slug: 'appmixer',
        summary: '説明。',
        published: '1',
      }),
    })
    expect(response.status).toBe(303)
    expect(await okText('/apps/item/appmixer')).toContain('AppMixer 2')
  })
})

/*
  構成の「出る / 出ない」と、自由文の長さ。

  置く・外す・並べ替えそのものは test/blocks.test.ts の「管理の構成」にある。
  ここに置くのは、公開ページの姿を管理画面側から支える2つ——結果を見せること
  （公開ページに出るか）と、受け取れない中身・長すぎる名前を入口で止めること。
*/

/*
  一覧の行に出る「出る / 出ない」を、行の順に拾う。拾えなかったこと自体を落とす。
  0件のまま toEqual([]) を通すと、バッジが丸ごと消えていてもこのテストは緑のまま
  になる。
*/
const shownBadges = (html: string) => {
  const found = [...html.matchAll(/class="row__col">(出る|出ない)</g)].map((m) => m[1])
  expect(
    found.length,
    '「出る / 出ない」を1つも拾えていない（バッジの形が変わった？）',
  ).toBeGreaterThan(0)
  return found
}

describe('構成 — 公開ページに出るかを見せる', () => {
  it('行ごとに「出る / 出ない」、合計は公開ページのページ数と一致する', async () => {
    const signed = await signIn()
    await signed('/admin/blocks/init', { method: 'POST' })
    // members は0件なので、Team はページにならない。Projects も0件のうちは出ない
    const before = await (await signed('/admin/blocks')).text()
    // hero・projects・team・contact の順
    expect(shownBadges(before)).toEqual(['出る', '出ない', '出ない', '出る'])
    expect(before).toContain('合計 2 ページ')

    // 1件足すと Projects が出る。それが管理画面から見えることがこのテストの主題
    await seedItem({ title: 'アプリ 1' })
    const after = await (await signed('/admin/blocks')).text()
    expect(shownBadges(after)).toEqual(['出る', '出る', '出ない', '出る'])
    expect(after).toContain('合計 3 ページ')
    // 公開ページ側と突き合わせる。目次の行き先（名前のあるページ）＋入口
    const toc = [...(await okText('/')).matchAll(/<nav class="toc"[\s\S]*?<\/nav>/g)][0]?.[0] ?? ''
    expect(toc.match(/<a /g)).toHaveLength(2)
  })

  /*
    置いたものを通しで見る手を構成にも置く。「サイトを見る ↗」は入口（/）に
    着くだけで、そこから全部を見るには目次をたどるしかない——並べ替えたあとに
    確かめるのは全体のほう。
  */
  it('構成から保存済みの全体プレビューを開ける', async () => {
    const signed = await signIn()
    await signed('/admin/blocks/init', { method: 'POST' })

    const html = await (await signed('/admin/blocks')).text()
    expect(html).toContain('href="/admin/preview"')
    expect(html).toContain('保存済みの全体をプレビュー ↗')
    // 入口への1本も残す。読む人が着くのはこちら
    expect(html).toContain('href="/"')
  })

  it('1人のサイトの Team の行は、プロフィールに置き換わると言う', async () => {
    /*
      公開中が1人なら、公開ページの Team の位置にはその人のプロフィールが並ぶ
      （目次は Profile）。言っておかないと、公開ページに Team が見当たらない理由が
      分からない
    */
    await seedMember({ skillsText: 'C# | 3年以上', careerText: '2024.03 | 入社 | ある会社' })
    const signed = await signIn()
    await signed('/admin/blocks/init', { method: 'POST' })

    const html = await (await signed('/admin/blocks')).text()
    // hero・projects(0件)・team（プロフィール）・contact
    expect(shownBadges(html)).toEqual(['出る', '出ない', '出る', '出る'])
    expect(html).toContain('合計 3 ページ')
    expect(html).toContain(
      '公開中が1人のあいだは、その人のプロフィール（目次は Profile）に置き換わる',
    )
    expect((await get('/members/okazaki')).status).toBe(200)

    // 2人目を公開すると Team のページに戻る。知らせも消える
    await seedMember({ slug: 'hoshino', name: '星野' })
    const two = await (await signed('/admin/blocks')).text()
    expect(shownBadges(two)).toEqual(['出る', '出ない', '出る', '出る'])
    expect(two).not.toContain('置き換わる')
  })

  it('下書きのブロックは「出ない」と出る', async () => {
    await seedMember()
    const signed = await signIn()
    await signed('/admin/blocks/init', { method: 'POST' })
    const team = await db().query.blocks.findFirst({ where: (t, { eq }) => eq(t.type, 'team') })
    if (!team) throw new Error('team が無い')

    // 見出しだけ送れば下書きに戻る（決まった中身のものは公開/下書きしか変わらない）
    await signed(`/admin/blocks/${team.id}`, { method: 'POST', body: form({}) })

    const html = await (await signed('/admin/blocks')).text()
    // hero・projects(0件)・team(下書き)・contact
    expect(shownBadges(html)).toEqual(['出る', '出ない', '出ない', '出る'])
    expect(html).toContain('合計 2 ページ')
  })

  /*
    通らない URL の行は公開ページが落とす。落ちた行を数えると、公開ページに何も
    出ないリンク集が管理画面では「出る」と見える（src/blocks.ts の blockShown は
    blockLines が落としたあとの行を数える）。保存は全部の行が通るときだけなので、
    ここへ来るのは保存の検査より前に入った行
  */
  it('自由文は、公開ページに出る行が1つも無ければ「出ない」。公開ページでも URL が無い', async () => {
    const signed = await signIn()
    const [block] = await db()
      .insert(schema.blocks)
      .values({
        type: 'links',
        title: 'Links',
        body: 'だめ | javascript:alert(1)',
        published: 1,
        sortOrder: 10,
      })
      .returning()
    if (!block) throw new Error('links を置けなかった')

    expect(shownBadges(await (await signed('/admin/blocks')).text())).toEqual(['出ない'])
    expect((await get(`/block-${block.id}`)).status).toBe(404)
  })

  it('自由文は行の数に関わらず1ページ。割っていたころの続きの URL は同じページへ', async () => {
    const signed = await signIn()
    const body = Array.from({ length: 30 }, (_, i) => `いま${i} | 補足`).join('\n')
    const [block] = await db()
      .insert(schema.blocks)
      .values({ type: 'now', title: 'Now', body, published: 1, sortOrder: 10 })
      .returning()
    if (!block) throw new Error('now を置けなかった')

    expect(shownBadges(await (await signed('/admin/blocks')).text())).toEqual(['出る'])
    const page = await okText(`/block-${block.id}`)
    expect(page).toContain('いま0')
    expect(page).toContain('いま29')
    const second = await get(`/block-${block.id}/2`)
    expect(second.status).toBe(301)
    expect(second.headers.get('location')).toBe(`/block-${block.id}`)
  })
})

describe('構成 — 自由文の長さ', () => {
  /*
    1画面に収めていたころは、メモ 400 字・いま 250 字…と1画面ぶんの字数で止めて
    いた。ページは縦に読むので、中身の長さは止めない
  */
  it('長いメモも、行の多いリンク集も公開できる', async () => {
    const signed = await signIn()
    const note = await signed('/admin/blocks', {
      method: 'POST',
      body: form({
        type: 'note',
        title: 'あとがき',
        body: Array.from({ length: 8 }, () => 'あ'.repeat(300)).join('\n\n'),
        published: '1',
      }),
    })
    expect(note.status).toBe(303)

    const links = await signed('/admin/blocks', {
      method: 'POST',
      body: form({
        type: 'links',
        title: 'Links',
        body: Array.from({ length: 20 }, (_, i) => `ラベル${i} | https://example.com/${i}`).join(
          '\n',
        ),
        published: '1',
      }),
    })
    expect(links.status).toBe(303)
    // 何も置いていない構成に足すと既定の4節も行になる。数えるのは書いた2行
    const written = await db().select().from(schema.blocks)
    expect(written.filter((row) => row.type === 'note' || row.type === 'links')).toHaveLength(2)
  })

  it('ひとことは一文の長さだけを見る（大きく出る一文としての決まり）', async () => {
    const signed = await signIn()

    const sentence = await signed('/admin/blocks', {
      method: 'POST',
      body: form({ type: 'statement', title: 'あ'.repeat(121), published: '1' }),
    })
    expect(sentence.status).toBe(400)
    expect(await sentence.text()).toContain('120 字まで')

    // 添え書きは長くてよい
    const notes = await signed('/admin/blocks', {
      method: 'POST',
      body: form({
        type: 'statement',
        title: 'あ'.repeat(100),
        body: 'い'.repeat(600),
        published: '1',
      }),
    })
    expect(notes.status).toBe(303)
  })

  it('書き方は書く前に見える。行の数や字数の上限は出さない', async () => {
    const signed = await signIn()
    const html = await (await signed('/admin/blocks/new?type=now')).text()
    expect(html).toContain('内容を組み立てる')
    expect(html).toContain('1件目の取り組み')
    expect(html).toContain('1件目の補足')
    expect(html).not.toContain('1画面')
    // 見出しの上限は目次の1行の名前として出る
    expect(html).toContain(`${MAX_CHARS.blockHeading} 字まで（目次に1行で並ぶ）`)
  })
})

/*
  上限は「公開するもの」に掛ける。下書きに戻す道まで塞ぐと、上限より前に
  保存された長い見出しを持つ行が、編集フォームからも一覧からも引っ込められなく
  なる（残る手が中身ごと削除だけになる）。
*/
describe('構成 — 上限に引っかかる行でも、引っ込められる', () => {
  const LONG = 'あ'.repeat(MAX_CHARS.blockHeading * 3)
  const seedLongHeading = async () => {
    const [block] = await db()
      .insert(schema.blocks)
      .values({ type: 'note', title: LONG, body: '段落。', published: 1, sortOrder: 10 })
      .returning()
    if (!block) throw new Error('block を作れなかった')
    return block
  }

  it('編集フォームから下書きに戻せる（公開したままは止める）', async () => {
    const block = await seedLongHeading()
    const signed = await signIn()
    const body = { type: 'note', title: LONG, body: '段落。' }

    // 公開したままの保存は、いままでどおり止める
    const keep = await signed(`/admin/blocks/${block.id}`, {
      method: 'POST',
      body: form({ ...body, published: '1' }),
    })
    expect(keep.status).toBe(400)

    // 「公開する」を外した保存は通る
    const draft = await signed(`/admin/blocks/${block.id}`, {
      method: 'POST',
      body: form(body),
    })
    expect(draft.status).toBe(303)

    const row = await db().query.blocks.findFirst({ where: (t, { eq }) => eq(t.id, block.id) })
    expect(row?.published).toBe(0)
    expect(row?.title).toBe(LONG)
  })

  it('一覧のトグルで下書きに戻すのは、中身を見ずに通す', async () => {
    const block = await seedLongHeading()
    const signed = await signIn()

    const off = await signed(`/admin/blocks/${block.id}/publish`, {
      method: 'POST',
      body: form({}),
    })
    expect(off.status).toBe(303)
    const row = await db().query.blocks.findFirst({ where: (t, { eq }) => eq(t.id, block.id) })
    expect(row?.published).toBe(0)
    // 中身は触らない
    expect(row?.title).toBe(LONG)
  })

  it('一覧のトグルで公開に戻すほうは、編集フォームと同じ関門で止め、理由を編集画面に出す', async () => {
    /*
      「中身は触らないので検査もしない」としていたころは、下書きの保存（長さを
      見ない）とこのトグルを続けると、検査が1度も走らずに上限を超えた中身が
      公開になった（ADM-1 / MNT-1）。関門は published が 1 になるときに1か所
    */
    const block = await seedLongHeading()
    await db().update(schema.blocks).set({ published: 0 }).where(eq(schema.blocks.id, block.id))
    const signed = await signIn()

    const on = await signed(`/admin/blocks/${block.id}/publish`, {
      method: 'POST',
      body: form({ published: '1' }),
    })
    expect(on.status).toBe(303)
    expect(on.headers.get('location')).toBe(`/admin/blocks/${block.id}/edit?publish=blocked`)
    const row = await db().query.blocks.findFirst({ where: (t, { eq }) => eq(t.id, block.id) })
    expect(row?.published).toBe(0)

    // 送られた先で、止めた理由と「公開する」の印（直して保存すれば公開される）
    const edit = await (await signed(on.headers.get('location') ?? '')).text()
    expect(edit).toContain('公開できませんでした')
    expect(edit).toContain(`見出しは ${MAX_CHARS.blockHeading} 字までです`)
    expect(edit).toContain('name="published" value="1" checked=""')
  })

  it('一覧にその切り替えの口がある', async () => {
    const block = await seedLongHeading()
    const signed = await signIn()
    const html = await (await signed('/admin/blocks')).text()

    expect(html).toContain(`/admin/blocks/${block.id}/publish`)
    expect(html).toContain('下書きにする')
  })

  it('存在しない行の切り替えは 404', async () => {
    const signed = await signIn()
    const response = await signed('/admin/blocks/99999/publish', {
      method: 'POST',
      body: form({ published: '1' }),
    })
    expect(response.status).toBe(404)
  })
})

/*
  ブロックではない「書く場所」の上限。残したのは名前と目録の文の長さ（作品名・
  説明・大見出し・ブロックの見出し）だけで、紹介文・経歴・本文は長さで止めない
  （ページは縦に読む。src/blocks.ts の MAX_CHARS）。
*/
describe('項目とメンバー — 書く場所の上限', () => {
  it('長すぎる説明文は、公開するときに止め、打った内容は残す', async () => {
    const signed = await signIn()
    const response = await signed('/admin/items', {
      method: 'POST',
      body: form({
        type: 'app',
        title: '長い説明',
        summary: 'あ'.repeat(MAX_CHARS.itemSummary + 1),
        tags: 'KeepMe',
        published: '1',
      }),
    })
    expect(response.status).toBe(400)

    const html = await response.text()
    expect(html).toContain(`説明文は ${MAX_CHARS.itemSummary} 字までです`)
    expect(html).toContain('KeepMe')
    expect(await db().select().from(schema.items)).toHaveLength(0)
  })

  it('上限より前に保存された長い説明文の作品も、下書きに戻せる（行き止まりにしない）', async () => {
    /*
      説明文の長さだけは下書きの保存でも見ていた。編集フォームは DB の中身で
      初期化されるので、上限より長い説明文を持つ作品は「公開する」を外して
      保存しても同じ 400 で戻り、引っ込める手が削除しか無かった
    */
    const long = 'あ'.repeat(MAX_CHARS.itemSummary + 20)
    const item = await seedItem({ title: '古い作品', slug: 'old', summary: long })
    const signed = await signIn()

    const response = await signed(`/admin/items/${item.id}`, {
      method: 'POST',
      body: form({ type: 'app', title: '古い作品', slug: 'old', summary: long }),
    })
    expect(response.status).toBe(303)
    const [row] = await db().select().from(schema.items)
    expect(row?.published).toBe(0)
    expect(row?.summary).toBe(long)
  })

  it('説明文の上限は書く前に見える', async () => {
    const signed = await signIn()
    const html = await (await signed('/admin/items/new?type=app')).text()
    expect(html).toContain(`maxlength="${MAX_CHARS.itemSummary}"`)
    expect(html).toContain(`${MAX_CHARS.itemSummary} 字まで`)
    // 一覧の行は説明を切らずに全部出す。電話の幅で何字まで出るか、はもう言わない
    expect(html).not.toContain('字までしか出ません')
    // 説明は目録の文なので常体、本文は「です・ます」。同じ作品のページに続けて出る
    expect(html).toContain('2文を常体で')
    expect(html).toContain('「です・ます」で')
  })

  it('年と実績値の添えは、書き方を書く前に見せる', async () => {
    /*
      年の「2024 —」はダッシュの先が空いて書きかけに見え、実績値の添えの
      「見込み 40人日 → 実績」は → が値の前を指して逆に読めた。どちらもデータの
      書き方の問題なので、書く場所で例を見せる
    */
    const signed = await signIn()
    const html = await (await signed('/admin/items/new?type=work')).text()
    expect(html).toContain('placeholder="2026 / 2024 — 現在"')
    expect(html).toContain('続いているものは「2024 — 現在」')
    expect(html).toContain('placeholder="見込み 40人日から半減"')
    expect(html).toContain('添えは値と単位のあとに続けて読まれる')
    expect(html).not.toContain('→ 実績')
  })

  it('紹介文・経歴・作品の本文・タグ・リンクは、長さでも数でも止めない', async () => {
    /*
      1画面に収めていたころは、紹介文 400 字・3段落、経歴は1画面 250 字、作品の
      本文 300 字・3段落、タグ3つ・リンク3本で止めていた。どれも「1画面に収まるか」
      だけが理由だった
    */
    const signed = await signIn()
    const member = await signed('/admin/members', {
      method: 'POST',
      body: form({
        name: '岡崎 昂功',
        slug: 'okazaki',
        bio: Array.from({ length: 6 }, () => 'あ'.repeat(150)).join('\n\n'),
        careerText: Array.from({ length: 12 }, (_, i) => `20${10 + i} | ${'あ'.repeat(60)}`).join(
          '\n',
        ),
        published: '1',
      }),
    })
    expect(member.status).toBe(303)

    const item = await signed('/admin/items', {
      method: 'POST',
      body: form({
        type: 'app',
        title: '多い作品',
        summary: '説明。',
        tags: 'A, B, C, D, E, F',
        linkLabel: ['1', '2', '3', '4', '5'],
        linkUrl: ['/a', '/b', '/c', '/d', '/e'],
        published: '1',
      }),
    })
    expect(item.status).toBe(303)
    expect(await db().select().from(schema.itemTags)).toHaveLength(6)
    expect(await db().select().from(schema.itemLinks)).toHaveLength(5)
  })

  it('リンクの欄は、持っている行を全部と、空いた行を少なくとも1つ出す', async () => {
    /*
      JavaScript が無いので欄を足す手が無い。持っている行を切って出すと、出なかった
      行が保存の総入れ替えで黙って消える。空いた行が1つも無いと、もう1本足せない
    */
    const item = await seedItem({ slug: 'many' })
    await db()
      .insert(schema.itemLinks)
      .values(
        Array.from({ length: 4 }, (_, i) => ({
          itemId: item.id,
          label: `L${i}`,
          url: `/l${i}`,
          sortOrder: i,
        })),
      )
    const signed = await signIn()
    const html = await (await signed(`/admin/items/${item.id}/edit`)).text()
    expect(html.match(/name="linkLabel"/g)).toHaveLength(5)

    // 新しい作品では3行ぶん空けて出す
    const fresh = await (await signed('/admin/items/new?type=app')).text()
    expect(fresh.match(/name="linkLabel"/g)).toHaveLength(3)
  })
})

/*
  ADM-10。個人ページの大見出しとブロックの見出しは上限なしで公開できた。大見出しは
  連動の大きな段で出る1つの文、ブロックの見出しは目次の1行の名前で、どちらも
  長さで止める（src/blocks.ts の MAX_CHARS）。
*/
describe('大見出し・ブロックの見出しの上限（公開の関門）', () => {
  it('長い大見出しは、公開するときに止める', async () => {
    const signed = await signIn()
    const response = await signed('/admin/members', {
      method: 'POST',
      body: form({
        name: '岡崎 昂功',
        slug: 'okazaki',
        headline: 'あ'.repeat(MAX_CHARS.memberHeadline + 1),
        published: '1',
      }),
    })
    expect(response.status).toBe(400)
    const html = await response.text()
    expect(html).toContain(`大見出しは ${MAX_CHARS.memberHeadline} 字までです`)
    expect(await db().select().from(schema.members)).toHaveLength(0)
  })

  it('下書きでは長さを見ない（上限より前に書いた人を行き止まりにしない）', async () => {
    const signed = await signIn()
    const response = await signed('/admin/members', {
      method: 'POST',
      body: form({
        name: '岡崎 昂功',
        slug: 'okazaki',
        headline: 'あ'.repeat(MAX_CHARS.memberHeadline * 2),
      }),
    })
    expect(response.status).toBe(303)
  })

  it('ブロックの見出しは、公開するときに止める。ひとことの一文は別の上限', async () => {
    const signed = await signIn()
    const long = 'あ'.repeat(MAX_CHARS.blockHeading + 1)
    const published = await signed('/admin/blocks', {
      method: 'POST',
      body: form({ type: 'now', title: long, body: '新しい道具を試す', published: '1' }),
    })
    expect(published.status).toBe(400)
    expect(await published.text()).toContain(`見出しは ${MAX_CHARS.blockHeading} 字までです`)
    expect(await db().select().from(schema.blocks)).toHaveLength(0)

    const draft = await signed('/admin/blocks', {
      method: 'POST',
      body: form({ type: 'now', title: long, body: '新しい道具を試す' }),
    })
    expect(draft.status).toBe(303)

    // ひとことの「見出し」の欄は大きく出る一文で、MAX_STATEMENT_SENTENCE が見る
    const statement = await signed('/admin/blocks', {
      method: 'POST',
      body: form({ type: 'statement', title: long, body: '', published: '1' }),
    })
    expect(statement.status).toBe(303)
  })

  it('既定の見出し（空で保存したときに出る名前）は、どれも上限に収まる', () => {
    for (const type of [
      blockType('now'),
      blockType('numbers'),
      blockType('links'),
      blockType('timeline'),
    ]) {
      if (type?.kind !== 'free') throw new Error('種類が無い')
      expect([...type.title].length, type.key).toBeLessThanOrEqual(MAX_CHARS.blockHeading)
    }
  })

  /*
    seed.sql の紹介文は本人の文章で、1画面に収めていたころの上限（400 字）を
    超えていて、公開のまま保存し直すと止まっていた。いまは紹介文を長さで止めないので、
    本人の言葉を削らずにそのまま公開で保存できる。
  */
  it('seed の紹介文（本人の文章）は、公開のまま保存し直せる', async () => {
    const tuple = seedSql.slice(seedSql.indexOf('INSERT INTO members'))
    const strings = [...tuple.matchAll(/'((?:[^']|'')*)'/g)].map((found) =>
      (found[1] ?? '').replaceAll("''", "'"),
    )
    // slug, name, role, location, headline, bio の順
    const bio = strings[5] ?? ''
    expect(bio).toContain('コンピュータサイエンス')

    const member = await seedMember({ bio, published: 1 })
    const signed = await signIn()
    const publish = await signed(`/admin/members/${member.id}`, {
      method: 'POST',
      body: form({ name: member.name, slug: member.slug, bio, published: '1' }),
    })
    expect(publish.status).toBe(303)
    const row = await db().query.members.findFirst({ where: eq(schema.members.id, member.id) })
    expect(row?.published).toBe(1)
    expect(row?.bio).toBe(bio)
  })
})

/*
  作品の保存は、全部書けるか何も書かないか（ADM-6 / SYS-3 / DATA-1）。

  行・タグ・リンク・転送表を1つの batch に入れた。1本ずつ await していたころは、
  タグを 34 個付けるだけで D1 の束縛変数の上限（1文に 100 個）に当たって 500 になり、
  その時点で前のタグとリンクはもう消えていた。
*/
describe('作品の保存は、全部書けるか何も書かないか', () => {
  const tags = (n: number) => Array.from({ length: n }, (_, i) => `tag${i + 1}`).join(', ')

  // テストの中だけの trigger——その表への書き込みを RAISE で止める
  const failing = async (table: 'item_tags' | 'item_links') => {
    await env.DB.prepare(
      `CREATE TRIGGER IF NOT EXISTS fail_${table} BEFORE INSERT ON ${table} BEGIN SELECT RAISE(ABORT, 'D1 を落とす'); END`,
    ).run()
    return () => env.DB.prepare(`DROP TRIGGER IF EXISTS fail_${table}`).run()
  }

  const seedWithChildren = async () => {
    const item = await seedItem({ slug: 'appmixer' })
    await db().insert(schema.itemTags).values({ itemId: item.id, tag: 'Swift', sortOrder: 0 })
    await db()
      .insert(schema.itemLinks)
      .values({ itemId: item.id, label: 'Repository', url: 'https://example.test/r', sortOrder: 0 })
    return item
  }

  it('タグが多くても 500 にしない。下書きなら全部書く（束縛変数の上限は文を分けて避ける）', async () => {
    const item = await seedWithChildren()
    const signed = await signIn()
    const response = await signed(`/admin/items/${item.id}`, {
      method: 'POST',
      body: form({
        type: 'app',
        title: 'AppMixer',
        slug: 'appmixer',
        tags: tags(40),
        linkLabel: ['Repository'],
        linkUrl: ['https://example.test/r'],
      }),
    })
    expect(response.status).toBe(303)
    expect(await db().select().from(schema.itemTags)).toHaveLength(40)
    expect(await db().select().from(schema.itemLinks)).toHaveLength(1)
  })

  it('公開で止めても、前のタグとリンクは残る（止めるのは書く前）', async () => {
    const item = await seedWithChildren()
    const signed = await signIn()
    const response = await signed(`/admin/items/${item.id}`, {
      method: 'POST',
      body: form({
        type: 'app',
        title: 'AppMixer',
        slug: 'appmixer',
        // 説明が空のまま公開しようとする（公開の関門が止める）
        tags: tags(5),
        linkLabel: ['L0', 'L1'],
        linkUrl: ['https://e.test/0', 'https://e.test/1'],
        published: '1',
      }),
    })
    expect(response.status).toBe(400)
    expect(await response.text()).toContain('公開するときは説明文が要ります')
    expect((await db().select().from(schema.itemTags)).map((row) => row.tag)).toEqual(['Swift'])
    expect(await db().select().from(schema.itemLinks)).toHaveLength(1)
  })

  it('途中の1文が落ちたら、何も書かない（題も前のタグとリンクも元のまま）', async () => {
    const item = await seedWithChildren()
    const signed = await signIn()
    const restore = await failing('item_links')
    try {
      const response = await signed(`/admin/items/${item.id}`, {
        method: 'POST',
        body: form({
          type: 'app',
          title: '書き換えた題',
          slug: 'appmixer',
          tags: 'Kotlin, Compose',
          linkLabel: ['Store'],
          linkUrl: ['https://example.test/s'],
        }),
      })
      expect(response.status).toBe(500)
    } finally {
      await restore()
    }
    const [row] = await db().select().from(schema.items)
    expect(row?.title).toBe('AppMixer')
    expect((await db().select().from(schema.itemTags)).map((one) => one.tag)).toEqual(['Swift'])
    expect(await db().select().from(schema.itemLinks)).toHaveLength(1)
  })

  it('新しく作るときも、子の1文が落ちたら作品の行は残らない。送り直せば通る', async () => {
    const signed = await signIn()
    const send = () =>
      signed('/admin/items', {
        method: 'POST',
        body: form({ type: 'app', title: 'Solo', slug: 'solo', tags: 'A, B' }),
      })
    const restore = await failing('item_tags')
    try {
      expect((await send()).status).toBe(500)
    } finally {
      await restore()
    }
    // 行だけが残っていると、送り直しが「この slug は既に使われています」で弾かれた
    expect(await db().select().from(schema.items)).toHaveLength(0)
    expect((await send()).status).toBe(303)
    const [item] = await db().select().from(schema.items)
    const children = await db().select().from(schema.itemTags)
    expect(children.map((row) => [row.itemId, row.tag])).toEqual([
      [item?.id, 'A'],
      [item?.id, 'B'],
    ])
  })

  it('担当メンバーやプラットフォームが消えていたら、400 で選び直してもらう（500 にしない）', async () => {
    const signed = await signIn()
    const response = await signed('/admin/items', {
      method: 'POST',
      body: form({ type: 'app', title: '残ってほしい題', memberId: '9999', platformKey: 'nope' }),
    })
    expect(response.status).toBe(400)
    const html = await response.text()
    expect(html).toContain('担当メンバーが見つかりません')
    expect(html).toContain('プラットフォームが見つかりません')
    expect(html).toContain('value="残ってほしい題"')
    expect(await db().select().from(schema.items)).toHaveLength(0)
  })
})

/*
  二重送信（ADM-5）。管理画面は JavaScript を持たないので、押したあとにボタンを
  押せなくする手が無い。追加のフォームは描くときに一度きりの札（formKey）を持ち、
  同じ札の2度目は新しい行を作らず、1度目がその札で作った行への保存になる。
*/
describe('二重送信', () => {
  const keyOf = (html: string) => {
    const key = html.match(/name="formKey" value="([0-9a-f]{16})"/)?.[1]
    if (!key) throw new Error('フォームに札が無い')
    return key
  }

  it('同じフォームを2度送っても、作品は1件。2度目も「保存しました」へ（日本語だけの題でも）', async () => {
    const signed = await signIn()
    const key = keyOf(await (await signed('/admin/items/new?type=work')).text())
    const send = () =>
      signed('/admin/items', {
        method: 'POST',
        body: form({ type: 'work', title: '業務システム', formKey: key }),
      })
    const first = await send()
    const second = await send()
    expect([first.status, second.status]).toEqual([303, 303])
    expect(second.headers.get('location')).toContain('saved=draft')
    expect(await db().select().from(schema.items)).toHaveLength(1)
  })

  it('英字の題の2度目を「この slug は既に使われています」にしない（保存できたのに失敗に見えた）', async () => {
    const signed = await signIn()
    const key = keyOf(await (await signed('/admin/items/new?type=app')).text())
    const send = () =>
      signed('/admin/items', {
        method: 'POST',
        body: form({ type: 'app', title: 'AppMixer', formKey: key }),
      })
    await send()
    const second = await send()
    expect(second.status).toBe(303)
    expect(await db().select().from(schema.items)).toHaveLength(1)
  })

  it('同時に届いた2本でも、書くのは1度だけ', async () => {
    const signed = await signIn()
    const key = keyOf(await (await signed('/admin/items/new?type=work')).text())
    const send = () =>
      signed('/admin/items', {
        method: 'POST',
        body: form({ type: 'work', title: '業務システム', formKey: key }),
      })
    const responses = await Promise.all([send(), send()])
    expect(responses.map((response) => response.status)).toEqual([303, 303])
    expect(await db().select().from(schema.items)).toHaveLength(1)
  })

  it('メモを2度送っても1つ。メンバーを2度送っても1人', async () => {
    const signed = await signIn()
    await signed('/admin/blocks/init', { method: 'POST' })
    const noteKey = keyOf(await (await signed('/admin/blocks/new?type=note')).text())
    for (let i = 0; i < 2; i += 1) {
      const response = await signed('/admin/blocks', {
        method: 'POST',
        body: form({ type: 'note', title: '', body: '段落です', formKey: noteKey }),
      })
      expect(response.status).toBe(303)
    }
    const notes = await db().select().from(schema.blocks).where(eq(schema.blocks.type, 'note'))
    expect(notes).toHaveLength(1)

    const memberKey = keyOf(await (await signed('/admin/members/new')).text())
    for (let i = 0; i < 2; i += 1) {
      const response = await signed('/admin/members', {
        method: 'POST',
        body: form({ name: '星野', formKey: memberKey }),
      })
      expect(response.status).toBe(303)
    }
    expect(await db().select().from(schema.members)).toHaveLength(1)
  })

  /*
    COR-2。同じ札の2度目の送信は、1度目がその札で作った行への保存。下書きで保存した
    あと「戻る」で開き直し、直して「公開する」に印を付けて送ると、その行が直って公開に
    なる（関門に当たれば理由が出る）。以前は題・名前が同じなら中身を比べずに何も
    書かず、公開したと知らせたのに下書きのまま残った
  */
  it('作品: 同じ札で直して公開に印を付けた送信は、1度目の行を直して公開する', async () => {
    const signed = await signIn()
    const key = keyOf(await (await signed('/admin/items/new?type=app')).text())
    const send = (values: Record<string, string>) =>
      signed('/admin/items', {
        method: 'POST',
        body: form({ type: 'app', formKey: key, ...values }),
      })

    const draft = await send({ title: 'AppMixer', summary: '誤字あり。' })
    expect(draft.headers.get('location')).toContain('saved=draft')

    // 関門に当たる送り直し（説明が空）は、その行の編集フォームに理由を出す
    const blocked = await send({ title: 'AppMixer', summary: '', published: '1' })
    expect(blocked.status).toBe(400)
    const html = await blocked.text()
    expect(html).toContain('説明文が要ります')
    const [row] = await db().select().from(schema.items)
    expect(html).toContain(`action="/admin/items/${row?.id}"`)

    const again = await send({ title: 'AppMixer', summary: '誤字を直した。', published: '1' })
    expect(again.status).toBe(303)
    const location = again.headers.get('location') ?? ''
    expect(location).toContain('saved=1')
    expect(await (await signed(location)).text()).toContain('1度目に作ったものに書きました')
    const rows = await db().select().from(schema.items)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ summary: '誤字を直した。', published: 1 })
    expect(await okText('/apps/item/appmixer')).toContain('誤字を直した。')
  })

  it('メンバー: 同じ札で直して公開に印を付けた送信は、1度目の人を直して公開する', async () => {
    const signed = await signIn()
    const key = keyOf(await (await signed('/admin/members/new')).text())
    const send = (values: Record<string, string>) =>
      signed('/admin/members', { method: 'POST', body: form({ formKey: key, ...values }) })

    expect((await send({ name: '星野', bio: '古い紹介' })).headers.get('location')).toContain(
      'saved=draft',
    )
    const blocked = await send({ name: '星野', headline: 'あ'.repeat(81), published: '1' })
    expect(blocked.status).toBe(400)
    expect(await blocked.text()).toContain('80 字まで')

    const again = await send({ name: '星野', bio: '新しい紹介', published: '1' })
    expect(again.headers.get('location')).toContain('saved=1')
    expect(again.headers.get('location')).toContain('again=1')
    const rows = await db().select().from(schema.members)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ bio: '新しい紹介', published: 1 })
  })

  it('ブロック: 同じ札で公開に印だけを付けた送信は、1度目の行を公開する', async () => {
    const signed = await signIn()
    await signed('/admin/blocks/init', { method: 'POST' })
    const key = keyOf(await (await signed('/admin/blocks/new?type=note')).text())
    const send = (values: Record<string, string>) =>
      signed('/admin/blocks', {
        method: 'POST',
        body: form({ type: 'note', title: '', formKey: key, ...values }),
      })

    expect((await send({ body: '段落です' })).headers.get('location')).toContain('saved=draft')
    const blocked = await send({
      title: 'あ'.repeat(11),
      body: '段落です',
      published: '1',
    })
    expect(blocked.status).toBe(400)
    expect(await blocked.text()).toContain('見出しは 10 字までです')

    const again = await send({ body: '段落です', published: '1' })
    expect(again.headers.get('location')).toContain('saved=1')
    const notes = await db().select().from(schema.blocks).where(eq(schema.blocks.type, 'note'))
    expect(notes).toHaveLength(1)
    expect(notes[0]).toMatchObject({ body: '段落です', published: 1 })
  })

  it('札の無い送信は今までどおり書く（札は重複を止めるためのもので、書いてよいかは決めない）', async () => {
    const signed = await signIn()
    for (const title of ['一つ目', '二つ目']) {
      await signed('/admin/items', { method: 'POST', body: form({ type: 'work', title }) })
    }
    expect(await db().select().from(schema.items)).toHaveLength(2)
  })
})

/*
  決まった中身のブロックは1つだけ（ADM-5 / PUB-1 / SYS-4）。「読んでから足す」だけで
  守っていたころは、「この並びから始める」を2本同時に送ると hero〜contact が2組になり、
  公開ページのページャが自分自身を指して入口から先へ進めなくなった。
*/
describe('決まった中身のブロックは1つだけ', () => {
  it('「この並びから始める」を2本同時に送っても、並びは1組', async () => {
    const signed = await signIn()
    const responses = await Promise.all([
      signed('/admin/blocks/init', { method: 'POST' }),
      signed('/admin/blocks/init', { method: 'POST' }),
    ])
    expect(responses.map((response) => response.status)).toEqual([303, 303])
    const rows = await db().select().from(schema.blocks)
    expect(rows.map((row) => row.type).sort()).toEqual(['contact', 'hero', 'projects', 'team'])
  })

  it('決まった中身を2本同時に置いても1行', async () => {
    const signed = await signIn()
    await signed('/admin/blocks/init', { method: 'POST' })
    await db().delete(schema.blocks).where(eq(schema.blocks.type, 'team'))
    const place = () => signed('/admin/blocks', { method: 'POST', body: form({ type: 'team' }) })
    await Promise.all([place(), place()])
    const teams = await db().select().from(schema.blocks).where(eq(schema.blocks.type, 'team'))
    expect(teams).toHaveLength(1)
  })

  it('DB も2行目を受け付けない（書く口が増えても最後に効く）。打ち込むものは何行でも', async () => {
    await db().insert(schema.blocks).values({ type: 'hero', published: 1, sortOrder: 10 })
    await expect(
      db().insert(schema.blocks).values({ type: 'hero', published: 0, sortOrder: 20 }),
    ).rejects.toThrow()
    await db()
      .insert(schema.blocks)
      .values([
        { type: 'note', body: 'a', sortOrder: 30 },
        { type: 'note', body: 'b', sortOrder: 40 },
      ])
    expect(await db().select().from(schema.blocks)).toHaveLength(3)
  })

  it('移行は、既に2行ある固定のブロックを畳む（公開中の行を残す）。年の並びも既にある行に効く', async () => {
    const d1 = env.MIGRATION_DB
    const { results } = await d1
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY rowid DESC",
      )
      .all<{ name: string }>()
    for (const { name } of results) await d1.prepare(`DROP TABLE \`${name}\``).run()
    const run = async (names: (name: string) => boolean) => {
      for (const migration of env.TEST_MIGRATIONS.filter((one) => names(one.name))) {
        for (const query of migration.queries) await d1.prepare(query).run()
      }
    }

    await run((name) => name < '0009')
    await d1.batch([
      d1.prepare(
        "INSERT INTO blocks (id, type, published, sort_order) VALUES (1, 'hero', 1, 10), (2, 'projects', 0, 20), (3, 'projects', 1, 25), (4, 'team', 1, 30), (5, 'team', 1, 35), (6, 'note', 1, 40), (7, 'note', 1, 50), (8, 'hero', 1, 60)",
      ),
      d1.prepare(
        "INSERT INTO items (id, type, title, slug, year, published) VALUES (1, 'work', '続いている', 'a', '2024 — 現在', 1), (2, 'app', '和暦', 'b', '令和6', 1), (3, 'app', '無い', 'c', '', 1)",
      ),
    ])
    await run((name) => name >= '0009')

    const blocks = await d1.prepare('SELECT id, type FROM blocks ORDER BY id').all()
    expect(blocks.results).toEqual([
      { id: 1, type: 'hero' },
      // 下書きの projects（2）ではなく、公開中の projects（3）を残す
      { id: 3, type: 'projects' },
      { id: 4, type: 'team' },
      { id: 6, type: 'note' },
      { id: 7, type: 'note' },
    ])
    const years = await d1.prepare('SELECT id, year_from FROM items ORDER BY id').all()
    expect(years.results).toEqual([
      { id: 1, year_from: 2024 },
      { id: 2, year_from: null },
      { id: 3, year_from: null },
    ])
    // 移行のあとは DB が2行目を受け付けない
    await expect(
      d1.prepare("INSERT INTO blocks (type, sort_order) VALUES ('team', 90)").run(),
    ).rejects.toThrow()
  })
})

/*
  公開の関門（ADM-1 / MNT-1）。published が 1 になる書き込みは、どの入口からでも
  同じ関数（src/blocks.ts の publishErrors）を通る。下書きに戻す方向は通さない。
*/
describe('公開の関門', () => {
  it('公開になる入口はどれも同じ関門（新しく書く・編集・一覧のトグル）。下書きの保存は長さを見ない', async () => {
    const signed = await signIn()
    await signed('/admin/blocks/init', { method: 'POST' })
    // 目次に1行で並ぶ名前の上限を超える見出し（src/blocks.ts の MAX_CHARS.blockHeading）
    const long = 'あ'.repeat(MAX_CHARS.blockHeading + 1)

    // 新しく書く: 公開は止める、下書きは通す
    const publish = await signed('/admin/blocks', {
      method: 'POST',
      body: form({ type: 'note', title: long, body: '段落。', published: '1' }),
    })
    expect(publish.status).toBe(400)
    const draft = await signed('/admin/blocks', {
      method: 'POST',
      body: form({ type: 'note', title: long, body: '段落。' }),
    })
    expect(draft.status).toBe(303)
    const note = await db().query.blocks.findFirst({ where: eq(schema.blocks.type, 'note') })
    if (!note) throw new Error('note が無い')

    // 編集: 公開にする保存は止める
    const edit = await signed(`/admin/blocks/${note.id}`, {
      method: 'POST',
      body: form({ title: long, body: '段落。', published: '1' }),
    })
    expect(edit.status).toBe(400)

    // 一覧のトグル: 止めて編集画面へ
    const toggle = await signed(`/admin/blocks/${note.id}/publish`, {
      method: 'POST',
      body: form({ published: '1' }),
    })
    expect(toggle.headers.get('location')).toBe(`/admin/blocks/${note.id}/edit?publish=blocked`)
    const row = await db().query.blocks.findFirst({ where: eq(schema.blocks.id, note.id) })
    expect(row?.published).toBe(0)
  })

  it('一文を空にしたひとことも、トグルでは公開にならない（公開なのにサイトに出ない行を作らない）', async () => {
    const [statement] = await db()
      .insert(schema.blocks)
      .values({ type: 'statement', title: '', published: 0, sortOrder: 10 })
      .returning()
    if (!statement) throw new Error('ひとことを置けなかった')
    const signed = await signIn()
    const toggle = await signed(`/admin/blocks/${statement.id}/publish`, {
      method: 'POST',
      body: form({ published: '1' }),
    })
    expect(toggle.status).toBe(303)
    expect(toggle.headers.get('location')).toContain('publish=blocked')
    const edit = await (await signed(toggle.headers.get('location') ?? '')).text()
    expect(edit).toContain('一文を入れてください')
  })

  it('決まった中身のブロックは、トグルで何も見ずに公開にできる', async () => {
    const [team] = await db()
      .insert(schema.blocks)
      .values({ type: 'team', published: 0, sortOrder: 10 })
      .returning()
    if (!team) throw new Error('Team を置けなかった')
    const signed = await signIn()
    const toggle = await signed(`/admin/blocks/${team.id}/publish`, {
      method: 'POST',
      body: form({ published: '1' }),
    })
    expect(toggle.headers.get('location')).toBe(`/admin/blocks?saved=1#block-${team.id}`)
  })
})

/*
  リンク集は、全部の行が通るときだけ保存する（ADM-8）。「通る URL が1行でもあれば」
  保存を通していたころは、https:// を付け忘れた行や URL を書き忘れた行が、
  「保存しました」のあとで公開ページから黙って消えた。
*/
describe('リンク集の行', () => {
  const BODY = 'Good | https://example.com\nTypo | github.com/iam74k4\nNo URL'

  it('落ちる行を名指しして 400。下書きでも止める（受け取れない値）', async () => {
    const signed = await signIn()
    for (const published of [{ published: '1' }, {}] as Record<string, string>[]) {
      const response = await signed('/admin/blocks', {
        method: 'POST',
        body: form({ type: 'links', title: 'Links', body: BODY, ...published }),
      })
      expect(response.status).toBe(400)
      const html = await response.text()
      expect(html).toContain('2 行目（Typo）の URL は https:// か mailto: か / で始めてください')
      expect(html).toContain('3 行目（No URL）に URL がありません')
      expect(html).not.toContain('1 行目')
    }
    expect(await db().select().from(schema.blocks)).toHaveLength(0)
  })

  it('全部の行が通れば保存する。行の番号は欄の中の行（空行も数える）', async () => {
    const signed = await signIn()
    const ok = await signed('/admin/blocks', {
      method: 'POST',
      body: form({
        type: 'links',
        title: 'Links',
        body: 'Good | https://example.com',
        published: '1',
      }),
    })
    expect(ok.status).toBe(303)

    const gap = await signed('/admin/blocks', {
      method: 'POST',
      body: form({ type: 'links', title: 'Links', body: 'Good | https://example.com\n\nBad | x' }),
    })
    expect(await gap.text()).toContain('3 行目（Bad）')
  })
})

describe('メンバーのフォーム', () => {
  it('入力エラーで描き直しても、外した「公開する」は外れたまま（ADM-9）', async () => {
    const member = await seedMember({ published: 1 })
    await seedMember({ slug: 'hoshino', name: '星野' })
    const signed = await signIn()
    // 公開を外し、同じ送信で slug を重ねる
    const response = await signed(`/admin/members/${member.id}`, {
      method: 'POST',
      body: form({ name: member.name, slug: 'hoshino' }),
    })
    expect(response.status).toBe(400)
    expect(await response.text()).not.toContain('name="published" value="1" checked=""')

    // 新しく作るときは、付けた「公開する」が付いたまま戻る
    const added = await signed('/admin/members', {
      method: 'POST',
      body: form({ name: '三人目', slug: 'hoshino', published: '1' }),
    })
    expect(added.status).toBe(400)
    expect(await added.text()).toContain('name="published" value="1" checked=""')
  })
})

/*
  並び順（ADM-11）。欄は type=text なので、日本語入力のまま全角で入る。以前は
  Number('２０') が NaN になり、黙って 0 で保存してその行を一覧の先頭へ動かした。
*/
describe('並び順の数', () => {
  it('全角の数字は半角に直して読む。数でなければ 400 で欄を示し、黙って 0 にしない', async () => {
    const member = await seedMember({ sortOrder: 50 })
    const signed = await signIn()
    const zenkaku = await signed(`/admin/members/${member.id}`, {
      method: 'POST',
      body: form({ name: member.name, slug: 'okazaki', sortOrder: '２０', published: '1' }),
    })
    expect(zenkaku.status).toBe(303)
    const read = async () =>
      (await db().query.members.findFirst({ where: eq(schema.members.id, member.id) }))?.sortOrder
    expect(await read()).toBe(20)

    const text = await signed(`/admin/members/${member.id}`, {
      method: 'POST',
      body: form({ name: member.name, slug: 'okazaki', sortOrder: '二十', published: '1' }),
    })
    expect(text.status).toBe(400)
    const html = await text.text()
    expect(html).toContain('並び順は数字で入れてください')
    // 打った字をそのまま返す（倒した数を見せない）
    expect(html).toContain('value="二十"')
    expect(await read()).toBe(20)

    // 作品も同じ読み方
    const item = await seedItem({ slug: 'appmixer', sortOrder: 50 })
    await signed(`/admin/items/${item.id}`, {
      method: 'POST',
      body: form({ type: 'app', title: 'AppMixer', slug: 'appmixer', sortOrder: '３０' }),
    })
    const [row] = await db().select().from(schema.items)
    expect(row?.sortOrder).toBe(30)
  })

  it('空のまま保存したら、いまの並び順のまま', async () => {
    const member = await seedMember({ sortOrder: 50 })
    const signed = await signIn()
    await signed(`/admin/members/${member.id}`, {
      method: 'POST',
      body: form({ name: member.name, slug: 'okazaki', sortOrder: '' }),
    })
    const row = await db().query.members.findFirst({ where: eq(schema.members.id, member.id) })
    expect(row?.sortOrder).toBe(50)
  })
})

/*
  恒久リンクの slug を変える（ADM-7 / SYS-6）。変えてよいが、前の URL は新しい URL へ
  301 で送る（src/db/schema.ts の item_slug_redirects / member_slug_redirects）。
*/
describe('恒久リンクの slug を変える', () => {
  it('欄を空にして保存しても、いまの slug のまま（作り直さない）', async () => {
    const item = await seedItem({ type: 'work', title: '開発工程の効率化', slug: 'dev-efficiency' })
    const member = await seedMember({ name: '岡崎 昂功', slug: 'okazaki' })
    const signed = await signIn()
    await signed(`/admin/items/${item.id}`, {
      method: 'POST',
      body: form({ type: 'work', title: '開発工程の効率化', slug: '' }),
    })
    await signed(`/admin/members/${member.id}`, {
      method: 'POST',
      body: form({ name: '岡崎 昂功', slug: '' }),
    })
    expect((await db().select().from(schema.items))[0]?.slug).toBe('dev-efficiency')
    expect((await db().select().from(schema.members))[0]?.slug).toBe('okazaki')
  })

  it('変えたら前の slug を転送に残し、保存の知らせでそう言う。欄の説明も書く前に言う', async () => {
    const item = await seedItem({ title: 'AppMixer', slug: 'appmixer', published: 1 })
    const signed = await signIn()
    const edit = await (await signed(`/admin/items/${item.id}/edit`)).text()
    expect(edit).toContain('前の URL は新しい URL へ転送する')

    const response = await signed(`/admin/items/${item.id}`, {
      method: 'POST',
      body: form({
        type: 'app',
        title: 'AppMixer',
        slug: 'app-mixer',
        summary: '説明。',
        published: '1',
      }),
    })
    expect(response.headers.get('location')).toContain('moved=1')
    const list = await (await signed(response.headers.get('location') ?? '')).text()
    expect(list).toContain('前の URL は、新しい URL へ転送します')
    expect(await db().select().from(schema.itemSlugRedirects)).toEqual([
      expect.objectContaining({ oldSlug: 'appmixer', itemId: item.id }),
    ])
  })

  it('自分の前の slug へは戻せる（転送は消える）。ほかの作品の前の slug は使わせない', async () => {
    const first = await seedItem({ title: 'AppMixer', slug: 'appmixer' })
    const second = await seedItem({ title: 'Other', slug: 'other' })
    const signed = await signIn()
    const rename = (id: number, slug: string) =>
      signed(`/admin/items/${id}`, {
        method: 'POST',
        body: form({ type: 'app', title: 'x', slug }),
      })
    await rename(first.id, 'app-mixer')

    // 前の URL（/apps/item/appmixer）を別の作品が名乗ると、貼られたリンクが黙って別の作品を指す
    const taken = await rename(second.id, 'appmixer')
    expect(taken.status).toBe(400)
    expect(await taken.text()).toContain('別の作品の前の URL として転送に使っています')

    expect((await rename(first.id, 'appmixer')).status).toBe(303)
    expect(await db().select().from(schema.itemSlugRedirects)).toEqual([
      expect.objectContaining({ oldSlug: 'app-mixer', itemId: first.id }),
    ])
  })
})

/*
  作品名の上限（COR-4）と説明の必須（COR-5）。どちらも公開するときにだけ見る
  （下書きに戻す保存では長さを見ない決まり）。
*/
describe('作品の公開の関門（作品名・説明）', () => {
  it(`作品名が ${MAX_CHARS.itemTitle} 字を超えたら公開させない。下書きなら通る。欄にも上限を出す`, async () => {
    const signed = await signIn()
    const form0 = await (await signed('/admin/items/new?type=app')).text()
    expect(form0).toContain(`maxlength="${MAX_CHARS.itemTitle}"`)
    const long = 'あ'.repeat(MAX_CHARS.itemTitle + 1)
    const refused = await signed('/admin/items', {
      method: 'POST',
      body: form({ type: 'app', title: long, summary: '説明。', published: '1' }),
    })
    expect(refused.status).toBe(400)
    expect(await refused.text()).toContain(`作品名は ${MAX_CHARS.itemTitle} 字までです`)

    const draft = await signed('/admin/items', {
      method: 'POST',
      body: form({ type: 'app', title: long, summary: '説明。' }),
    })
    expect(draft.status).toBe(303)
    const ok = await signed('/admin/items', {
      method: 'POST',
      body: form({
        type: 'app',
        title: 'い'.repeat(MAX_CHARS.itemTitle),
        summary: '説明。',
        published: '1',
      }),
    })
    expect(ok.status).toBe(303)
  })

  it('説明が空なら公開させない（下書きなら通る）', async () => {
    const signed = await signIn()
    const refused = await signed('/admin/items', {
      method: 'POST',
      body: form({ type: 'app', title: 'AppMixer', published: '1' }),
    })
    expect(refused.status).toBe(400)
    expect(await refused.text()).toContain('説明文が要ります')
    const draft = await signed('/admin/items', {
      method: 'POST',
      body: form({ type: 'app', title: 'AppMixer' }),
    })
    expect(draft.status).toBe(303)
  })
})

/*
  作品の並び（PUB-4 / SYS-9）。並べる年（items.year_from）は DB が year から作り、
  管理画面の知らせは同じ規則の yearFrom が出す。2つの答えがずれないことを見る。
*/
describe('作品の並べる年', () => {
  /*
    アプリを通らずに入った行（seedItem・D1 を手で直した行・readItemForm が全角を直す
    より前に保存した行）でも同じ答え。全角の年を管理画面は 2024 と読むのに DB は null、
    と食い違っていたころは、一覧の最後に落ちた作品に「並びに使われません」が出なかった（COR-3）
  */
  it('DB が作る年（year_from）と、管理画面の知らせ（yearFrom）は同じ答え', async () => {
    const years = [
      '2026',
      '2024 — 現在',
      '2019.04 — 2021',
      '令和6',
      '〜2023',
      'FY2024',
      '24',
      '',
      '２０２４',
      '２０２４ — 現在',
    ]
    for (const [index, year] of years.entries()) {
      await seedItem({ title: `t${index}`, slug: `t${index}`, year })
    }
    const rows = await db().select().from(schema.items)
    for (const row of rows) expect(row.yearFrom, row.year).toBe(yearFrom(row.year))
  })

  it('年の頭が数字4桁でなければ、並びに使われないと欄の下で知らせる（保存は止めない）', async () => {
    const signed = await signIn()
    const response = await signed('/admin/items', {
      method: 'POST',
      body: form({ type: 'app', title: 'Reiwa', year: '令和6' }),
    })
    expect(response.status).toBe(303)
    const [item] = await db().select().from(schema.items)
    const html = await (await signed(`/admin/items/${item?.id}/edit`)).text()
    expect(html).toContain('並びに使われません')

    // 全角の数字は保存のときに半角へ直す（並べる年は DB がこの字から作る）
    await signed(`/admin/items/${item?.id}`, {
      method: 'POST',
      body: form({ type: 'app', title: 'Reiwa', slug: 'reiwa', year: '２０２４ — 現在' }),
    })
    const [saved] = await db().select().from(schema.items)
    expect(saved?.year).toBe('2024 — 現在')
    expect(saved?.yearFrom).toBe(2024)
  })

  it('管理画面の一覧も公開ページと同じ並び（年 → 並び順 → 作った順）', async () => {
    await seedItem({ title: '古いが1番', slug: 'old', year: '2020', sortOrder: 1 })
    await seedItem({ title: '新しい', slug: 'new', year: '2026', sortOrder: 50 })
    const signed = await signIn()
    const html = await (await signed('/admin/items?type=app')).text()
    expect(html.indexOf('新しい')).toBeLessThan(html.indexOf('古いが1番'))
  })
})
