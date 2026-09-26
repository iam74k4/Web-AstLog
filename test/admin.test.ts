import { env } from 'cloudflare:test'
import seedSql from 'virtual:repo:seed.sql'
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import { type BlockKey, blockType, MAX_CHARS, MEMBER_PER_SCREEN, TIMELINE } from '../src/blocks'
import * as schema from '../src/db/schema'
import { yearFrom } from '../src/lib/format'
import { chunk } from '../src/lib/paginate'
import { db, form, get, okText, resetDb, seedItem, seedMember, signIn } from './helpers'
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
    expect((await post({ origin: 'http://noctifex.test' })).status).toBe(403)

    // 同じサイトからのもの。保存まで進む（400 は中身の検査。送り元の検査は通っている）
    expect((await post({ origin: 'https://noctifex.test' })).status).not.toBe(403)
    expect((await post({ 'sec-fetch-site': 'same-origin' })).status).not.toBe(403)
    expect((await post({ referer: 'https://noctifex.test/admin/items/new' })).status).not.toBe(403)
    // 3つとも無い（ブラウザ以外）。セッションのクッキーは Lax なので、別のサイトからは付かない
    expect((await post({})).status).not.toBe(403)
  })

  it('ログアウトするとセッションが即座に切れる', async () => {
    const signed = await signIn()
    expect((await signed('/admin/members')).status).toBe(200)
    await signed('/admin/logout', { method: 'POST' })
    expect((await signed('/admin/members')).headers.get('location')).toMatch(/^\/admin\/login/)
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

    const html = await okText('/all')
    expect(html).toContain('新しいタグ')
    expect(html).not.toContain('古いタグ')
  })
})

/*
  作品の本文と画像。本文と画像は作品のページにだけ出る（カードには出さない。
  カードのサムネイルは同じ画像の飾り）。

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

  it('画像は KV の items/ に置き、作品のページに代替テキストつきで出る。本文は次の画面（Story）に出る', async () => {
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
    // 1枚目は説明だけの段落と、本文の画面への入口。本文は1枚目に出さない
    expect(html).toContain('<div class="bio"><p>音量を分ける常駐アプリ。</p></div>')
    expect(html).toContain('<a class="more" href="/apps/item/appmixer/story">')
    expect(html).not.toContain('背景と結果の段落です。')
    // 本文は本文の画面に、同じ段落の部品（Note）で出る
    const story = await okText('/apps/item/appmixer/story')
    expect(story).toContain('<div class="bio"><p>背景と結果の段落です。</p></div>')
  })

  it('画像があるのに代替テキストが空なら、公開では止める。打った内容は残し、画像は書かない', async () => {
    const signed = await signIn()
    const response = await signed('/admin/items', {
      method: 'POST',
      body: withImage({
        type: 'app',
        title: 'AppMixer',
        body: '残ってほしい本文',
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
      body: form({ type: 'app', title: 'AppMixer', slug: 'kept', imageAlt: '', published: '1' }),
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
        published: '1',
      }),
    })
    expect(removed.status).toBe(303)
  })

  it('下書きの保存では、代替テキストの不足も本文の長さも見ない', async () => {
    const signed = await signIn()
    const long = 'あ'.repeat(MAX_CHARS.itemBody + 10)
    const response = await signed('/admin/items', {
      method: 'POST',
      body: withImage({ type: 'app', title: '下書き', body: long }),
    })
    expect(response.status).toBe(303)

    const [row] = await db().select().from(schema.items)
    expect(row?.published).toBe(0)
    expect(row?.body).toBe(long)
    expect(row?.imageUrl).toMatch(/^\/images\/items\//)
  })

  it('本文は、公開するときに字数と段落の数の両方で止める', async () => {
    const signed = await signIn()
    const long = await signed('/admin/items', {
      method: 'POST',
      body: form({
        type: 'app',
        title: '長い本文',
        body: 'あ'.repeat(MAX_CHARS.itemBody + 1),
        published: '1',
      }),
    })
    expect(long.status).toBe(400)
    expect(await long.text()).toContain(`本文は ${MAX_CHARS.itemBody} 字までです`)

    // 字数が足りていても、段落を増やせば空行のぶんだけ高くなる
    const many = await signed('/admin/items', {
      method: 'POST',
      body: form({
        type: 'app',
        title: '段落の多い本文',
        body: Array.from({ length: MAX_CHARS.itemBodyParagraphs + 1 }, () => 'あ').join('\n\n'),
        published: '1',
      }),
    })
    expect(many.status).toBe(400)
    expect(await many.text()).toContain(`段落は ${MAX_CHARS.itemBodyParagraphs} つまでです`)
    expect(await db().select().from(schema.items)).toHaveLength(0)
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
    expect(await (await signed(`/admin/items/${item.id}/delete`)).text()).toContain('、画像も')

    await signed(`/admin/items/${item.id}/delete`, { method: 'POST' })
    expect(await itemKeys()).toEqual([])
  })

  it('本文の上限と画像の欄は書く前に見える。フォームは画像を送れる形', async () => {
    const signed = await signIn()
    const html = await (await signed('/admin/items/new?type=app')).text()
    expect(html).toContain('enctype="multipart/form-data"')
    expect(html).toContain(`maxlength="${MAX_CHARS.itemBody}"`)
    expect(html).toContain(`${MAX_CHARS.itemBody} 字・${MAX_CHARS.itemBodyParagraphs} 段落まで`)
    expect(html).toContain('name="image"')
    expect(html).toContain('name="imageAlt"')
    // 外す画像が無い作品には「画像を外す」を出さない
    expect(html).not.toContain('画像を外す')
  })
})

/*
  画像の受け入れ（SEC-2 / ADM-4）。アバターと作品の画像は同じ1本の検査
  （src/routes/admin.tsx の pickImage → src/lib/image.ts の sniffImage）を通る。

  種類は中身の先頭のバイトで決め、ブラウザの名乗り（file.type）は見ない。
  以前は file.type が image/ で始まれば何でも受け、その名乗りのまま KV に
  入れて同じオリジンから配っていた——SVG の <script> がサイトのオリジンで走り、
  HEIC は Chrome と Firefox で壊れて見えた。
*/
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
        ]),
      }),
    })
    expect(response.status).toBe(303)
    const rows = await db().select().from(schema.itemLinks)
    expect(rows.map((row) => [row.label, row.url, row.sortOrder])).toEqual([
      ['Repository', 'https://example.test/r', 0],
      ['Mail', 'mailto:a@example.test', 1],
    ])
  })

  it('メンバーの GitHub は https:// の絶対 URL だけ。欄も type=url', async () => {
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
    expect(html).toMatch(/<input class="input" type="url" name="github"/)
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
      body: form({ type: 'app', title: 'App Mixer', published: '1' }),
    })

    // 貼るための URL なので、探しに行かずに読めるところに出す
    expect(await (await signed('/admin/items?type=app')).text()).toContain('/apps/item/app-mixer')
    expect((await get('/apps/item/app-mixer')).status).toBe(200)
  })

  it('日本語だけの題でも、恒久リンクの無い作品は作らない', async () => {
    const signed = await signIn()
    await signed('/admin/items', {
      method: 'POST',
      body: form({ type: 'work', title: '開発工程の効率化', published: '1' }),
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
      body: form({ type: 'app', title: 'AppMixer', slug: 'appmixer', published: '1' }),
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
      body: form({ type: 'app', title: 'AppMixer', published: '1' }),
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
      body: form({ type: 'app', title: 'AppMixer', slug: 'appmixer', published: '1' }),
    })
    const id = (await (await signed('/admin/items?type=app')).text()).match(
      /\/admin\/items\/(\d+)\/edit/,
    )?.[1]

    const response = await signed(`/admin/items/${id}`, {
      method: 'POST',
      body: form({ type: 'app', title: 'AppMixer 2', slug: 'appmixer', published: '1' }),
    })
    expect(response.status).toBe(303)
    expect(await okText('/apps/item/appmixer')).toContain('AppMixer 2')
  })
})

/*
  構成の「N 画面」と、自由文の長さ。

  置く・外す・並べ替えそのものは test/blocks.test.ts の「管理の構成」にある。
  ここに置くのは、公開ページが1画面に収まることを管理画面側から支える2つ——
  結果を見せること（何画面になったか）と、収まらない中身を入口で止めること。
*/

/*
  一覧の行に出る「N 画面」を、行の順に拾う。

  拾えなかったこと自体を落とす。0件のまま toEqual([]) を通すと、バッジが
  丸ごと消えていてもこのテストは緑のままになる。
*/
const screenBadges = (html: string) => {
  const found = [...html.matchAll(/class="row__col">(\d+) 画面</g)].map((m) => Number(m[1]))
  expect(found.length, '「N 画面」を1つも拾えていない（バッジの形が変わった？）').toBeGreaterThan(0)
  return found
}

// 1画面あたりの件数は src/blocks.ts が正。テストに数を書き写さない
const perScreenOf = (key: string) => {
  const type = blockType(key)
  if (!type || !('perScreen' in type)) throw new Error(`${key} に perScreen が無い`)
  return type.perScreen
}

describe('構成 — 何画面になるかを見せる', () => {
  it('行の「N 画面」は chunk() と同じ数で、合計は公開ページの画面数と一致する', async () => {
    const signed = await signIn()
    await signed('/admin/blocks/init', { method: 'POST' })
    // 個人開発と業務を混ぜて登録する。Projects は区分を問わず1つの一覧で数える。
    // members は0件なので、Team は画面にならない
    const titles = ['アプリ 1', 'アプリ 2', '業務 1', '業務 2']
    for (const [index, title] of titles.entries()) {
      await seedItem({
        title,
        type: title.startsWith('業務') ? 'work' : 'app',
        sortOrder: (index + 1) * 10,
      })
    }
    const per = perScreenOf('projects')

    const before = await (await signed('/admin/blocks')).text()
    // hero・projects・team・contact の順
    expect(screenBadges(before)).toEqual([1, chunk(titles, per).length, 0, 1])
    expect(before).toContain('合計 4 画面')
    /*
      公開ページ側と突き合わせる。ページャは**節の中**を数えるので、
      見るのは Projects の画面に出る数（管理画面の Projects の「N 画面」と同じ数）。
      全体の通し番号は持っていない——絞り込みで動いてしまうのでやめた。
    */
    expect(await okText('/projects')).toContain(
      `Projects の ${chunk(titles, per).length} 画面のうち 1 画面目`,
    )

    // 1件足すと画面が1枚増える。それが管理画面から見えることがこのテストの主題
    const grown = [...titles, 'アプリ 5']
    await seedItem({ title: 'アプリ 5', sortOrder: 50 })

    const after = await (await signed('/admin/blocks')).text()
    expect(screenBadges(after)).toEqual([1, chunk(grown, per).length, 0, 1])
    expect(after).toContain('合計 5 画面')
    expect(await okText('/projects')).toContain(
      `Projects の ${chunk(grown, per).length} 画面のうち 1 画面目`,
    )
  })

  /*
    画面ごとに割ったあと、置いたものを通しで見る手はここにしか無い。
    「サイトを見る ↗」は入口（/）に着くだけで、そこから全部を見るには
    めくり続けるしかない——並べ替えたあとに確かめるのは全体のほう。
  */
  it('構成から全体ページを開ける', async () => {
    const signed = await signIn()
    await signed('/admin/blocks/init', { method: 'POST' })

    const html = await (await signed('/admin/blocks')).text()
    expect(html).toContain('href="/all"')
    expect(html).toContain('全体を1ページで見る ↗')
    // 入口への1本も残す。読む人が着くのはこちら
    expect(html).toContain('href="/"')
  })

  it('1人のサイトの Team の行は、プロフィールの画面を数え、置き換わると言う', async () => {
    /*
      公開中が1人なら、公開ページの Team の位置にはその人のプロフィール
      （1枚目・About・Skills・Career）が並ぶ。行が「Team 1 画面」のままだと、
      合計が公開ページの画面数とずれ、Team が見当たらない理由も分からない
    */
    await seedMember({ skillsText: 'C# | 3年以上', careerText: '2024.03 | 入社 | ある会社' })
    const signed = await signIn()
    await signed('/admin/blocks/init', { method: 'POST' })

    const html = await (await signed('/admin/blocks')).text()
    // hero・projects(0件)・team（プロフィール 4 画面）・contact
    expect(screenBadges(html)).toEqual([1, 0, 4, 1])
    expect(html).toContain('合計 6 画面')
    expect(html).toContain('公開中が1人のあいだは、その人のプロフィール（4 画面）に置き換わる')

    // 公開ページ側と突き合わせる。/ から「次」を辿った数がそのまま合計になる
    let visited = 0
    for (let path: string | null = '/'; path && visited < 20; visited += 1) {
      const page = await okText(path)
      path =
        page.match(/<a class="pager__go pager__go--next" href="([^"]+)" rel="next">/)?.[1] ?? null
    }
    expect(visited).toBe(6)

    // 2人目を公開すると Team の画面に戻る。知らせも消える
    await seedMember({ slug: 'hoshino', name: '星野' })
    const two = await (await signed('/admin/blocks')).text()
    expect(screenBadges(two)).toEqual([1, 0, 1, 1])
    expect(two).not.toContain('置き換わる')
  })

  it('下書きのブロックは 0 画面と出る', async () => {
    await seedMember()
    const signed = await signIn()
    await signed('/admin/blocks/init', { method: 'POST' })
    const team = await db().query.blocks.findFirst({ where: (t, { eq }) => eq(t.type, 'team') })
    if (!team) throw new Error('team が無い')

    // 見出しだけ送れば下書きに戻る（決まった中身のものは公開/下書きしか変わらない）
    await signed(`/admin/blocks/${team.id}`, { method: 'POST', body: form({}) })

    const html = await (await signed('/admin/blocks')).text()
    // hero・projects(0件)・team(下書き)・contact
    expect(screenBadges(html)).toEqual([1, 0, 0, 1])
    expect(html).toContain('合計 2 画面')
  })

  /*
    自由文の5種を1つずつ突き合わせる。

    「N 画面」は公開ページとは別の関数（blockScreens）が数えている。行の開き方が
    公開側とずれると、置いた本人だけが古い数を見続ける——「13件目を公開したら
    画面が1枚増えた」と気づかせるのがこの表示の存在理由なので、いちばん要る
    ときに嘘をつく。数え方の出どころは src/blocks.ts の blockUnitCount 1本。
  */
  it('自由文のどの種類でも、「N 画面」と公開ページの画面数が一致する', async () => {
    const signed = await signIn()
    const rows = (n: number, make: (i: number) => string) =>
      Array.from({ length: n }, (_, i) => make(i + 1)).join('\n')

    /*
      key は BlockKey。素の string のままだと、打ち間違えた種類名でも
      `.values({ type: one.key })` が通ってしまい、この一覧が
      src/blocks.ts の BLOCK_TYPES から外れても誰も気づかない
    */
    const cases: { key: BlockKey; body: string; screens?: number }[] = [
      { key: 'now', body: rows(perScreenOf('now') + 1, (i) => `いま${i} | 補足`), screens: 2 },
      { key: 'numbers', body: rows(perScreenOf('numbers') + 1, (i) => `${i} | 件 | 説明`) },
      { key: 'timeline', body: rows(perScreenOf('timeline') + 1, (i) => `2024.0${i} | こと`) },
      {
        /*
          段落は1行とはかぎらない。行で数えると、同じ中身でも画面数がずれる
          （メモを割る単位は空行で分けた段落）。だからここは2行ずつの段落にする
        */
        key: 'note',
        body: rows(perScreenOf('note') + 1, (i) => `段落${i}の一文。\n続きの行。`).replaceAll(
          '\n段落',
          '\n\n段落',
        ),
      },
      {
        /*
          通らない URL の行は公開ページが落とす。落ちた行を数えると、ちょうど
          1画面に収まっているのに「2 画面」と出る（この1件だけが 1 画面）
        */
        key: 'links',
        body: `${rows(perScreenOf('links'), (i) => `ラベル${i} | https://example.com/${i}`)}\nだめ | javascript:alert(1)`,
        screens: 1,
      },
    ]

    for (const one of cases) {
      await db().delete(schema.blocks)
      const [block] = await db()
        .insert(schema.blocks)
        .values({ type: one.key, title: '見出し', body: one.body, published: 1, sortOrder: 10 })
        .returning()
      if (!block) throw new Error(`${one.key} を置けなかった`)
      const want = one.screens ?? 2

      const admin = await (await signed('/admin/blocks')).text()
      expect(screenBadges(admin), one.key).toEqual([want])
      expect(admin, one.key).toContain(`合計 ${want} 画面`)

      /*
        公開ページ側の数。ページャは節の中を数えるので、その節の1画面目に
        出る数と突き合わせる。置いてあるのはこのブロック1つだけなので、
        節の画面数＝管理画面の「N 画面」。
      */
      const first = await okText(`/block-${block.id}`)
      if (want > 1) expect(first, one.key).toContain(`${want} 画面のうち 1 画面目`)
      else expect(first, one.key).not.toContain('画面のうち')

      /*
        数えた画面には URL があり、数えていない画面には無い。1画面目は
        /block-<id> ひとつに寄せてあるので、2枚目から先だけを URL で確かめる
      */
      if (want > 1) expect((await get(`/block-${block.id}/${want}`)).status, one.key).toBe(200)
      expect((await get(`/block-${block.id}/${want + 1}`)).status, one.key).toBe(404)
    }
  })
})

// 1画面に出せる字数も src/blocks.ts が正。テストに数を書き写さない
const maxCharsOf = (key: string) => {
  const type = blockType(key)
  if (!type || !('maxChars' in type)) throw new Error(`${key} に maxChars が無い`)
  return type.maxChars
}

describe('構成 — 1画面に収まらない自由文は保存させない', () => {
  it('長すぎるメモは 400 で戻し、打った内容は残す', async () => {
    const signed = await signIn()
    const max = maxCharsOf('note')
    const response = await signed('/admin/blocks', {
      method: 'POST',
      body: form({ type: 'note', title: 'あとがき', body: 'あ'.repeat(max + 1), published: '1' }),
    })
    expect(response.status).toBe(400)

    const html = await response.text()
    expect(html).toContain('1画面に収まりません')
    expect(html).toContain('あとがき')
    expect(await db().select().from(schema.blocks)).toHaveLength(0)
  })

  /*
    上限は「割ったあとの1画面」あたり。段落は1画面に perScreen 個まとめて
    出るので、空行で分けても同じ画面に居る限り合計で見る。ここを段落あたりに
    すると、規則どおり空行で分けた perScreen 倍の字数が素通りする
    （メモなら 3 倍。no-scroll を支える上限がその時点で成り立たなくなる）。
  */
  it('空行で分けても、同じ画面に出るぶんは合計で見る', async () => {
    const signed = await signIn()
    const max = maxCharsOf('note')
    // 2つ合わせて上限をちょうど1字だけ超える。どちらの段落も単独では上限以内
    const half = Math.ceil((max + 1) / 2)

    const split = await signed('/admin/blocks', {
      method: 'POST',
      body: form({
        type: 'note',
        title: 'あとがき',
        body: `${'あ'.repeat(half)}\n\n${'い'.repeat(half)}`,
        published: '1',
      }),
    })
    expect(split.status).toBe(400)
    expect(await split.text()).toContain('1画面に収まりません')
    expect(await db().select().from(schema.blocks)).toHaveLength(0)
  })

  /*
    次の画面に回るぶんは、いまの画面の字数ではない。1画面ぶんが上限ちょうどの
    段落を perScreen の倍だけ並べても、画面ごとに見れば上限どおりなので通る。
    ここで落ちるようだと、長いメモがどこにも書けなくなる
  */
  it('次の画面に回るぶんまで足して数えない', async () => {
    const signed = await signIn()
    const per = perScreenOf('note')
    const max = maxCharsOf('note')
    const paragraph = 'あ'.repeat(Math.floor(max / per))

    const response = await signed('/admin/blocks', {
      method: 'POST',
      body: form({
        type: 'note',
        title: 'あとがき',
        body: Array.from({ length: per * 2 }, () => paragraph).join('\n\n'),
        published: '1',
      }),
    })
    expect(response.status).toBe(303)
  })

  it('1行1件のものも、1画面ぶんの合計で止める', async () => {
    const signed = await signIn()
    const per = perScreenOf('now')
    const max = maxCharsOf('now')
    // 1画面ぶんの行に、上限をちょうど1字だけ超える字数を配る
    const line = 'あ'.repeat(Math.ceil((max + 1) / per))

    const response = await signed('/admin/blocks', {
      method: 'POST',
      body: form({
        type: 'now',
        title: 'Now',
        body: Array.from({ length: per }, () => line).join('\n'),
        published: '1',
      }),
    })
    expect(response.status).toBe(400)
    expect(await response.text()).toContain('1画面に収まりません')
  })

  /*
    リンク集の URL は href であって、画面に文字としては出ない。数えてしまうと、
    長い URL を1つ置いただけで書ける説明が減る
  */
  it('リンク集は URL を字数に数えない', async () => {
    const signed = await signIn()
    const max = maxCharsOf('links')
    const url = `https://example.com/${'a'.repeat(max)}`

    const response = await signed('/admin/blocks', {
      method: 'POST',
      body: form({ type: 'links', title: 'Links', body: `ラベル | ${url}`, published: '1' }),
    })
    expect(response.status).toBe(303)
  })

  it('ひとことは一文の長さと、添え書きを足した長さの両方を見る', async () => {
    const signed = await signIn()
    const max = maxCharsOf('statement')

    // 一文そのものが長い（大きく出る一文としての決まり）
    const sentence = await signed('/admin/blocks', {
      method: 'POST',
      body: form({ type: 'statement', title: 'あ'.repeat(121), published: '1' }),
    })
    expect(sentence.status).toBe(400)
    expect(await sentence.text()).toContain('120 字まで')

    // 一文は短くても、添え書きと足すと1画面に収まらない
    const together = await signed('/admin/blocks', {
      method: 'POST',
      body: form({
        type: 'statement',
        title: 'あ'.repeat(100),
        body: 'い'.repeat(max - 100 + 1),
        published: '1',
      }),
    })
    expect(together.status).toBe(400)
    expect(await together.text()).toContain('1画面に収まりません')
    expect(await db().select().from(schema.blocks)).toHaveLength(0)
  })

  it('上限は書く前に見える（保存を押すまで分からない、にしない）', async () => {
    const signed = await signIn()
    const html = await (await signed('/admin/blocks/new?type=now')).text()
    expect(html).toContain(`1画面 ${perScreenOf('now')} 件`)
    expect(html).toContain(`1画面 ${maxCharsOf('now')} 字まで`)
  })
})

/*
  上限は「公開するもの」に掛ける。下書きに戻す道まで塞ぐと、上限より前に
  保存された長い中身を持つ行が、編集フォームからも一覧からも引っ込められなく
  なる（残る手が本文ごと削除だけになる）。
*/
describe('構成 — 上限に引っかかる行でも、引っ込められる', () => {
  const seedLongNote = async () => {
    const [block] = await db()
      .insert(schema.blocks)
      .values({
        type: 'note',
        title: '前に書いた長いメモ',
        body: 'あ'.repeat(maxCharsOf('note') * 3),
        published: 1,
        sortOrder: 10,
      })
      .returning()
    if (!block) throw new Error('block を作れなかった')
    return block
  }

  it('編集フォームから下書きに戻せる（公開したままは止める）', async () => {
    const block = await seedLongNote()
    const signed = await signIn()
    const body = { type: 'note', title: '前に書いた長いメモ', body: 'あ'.repeat(1200) }

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
    expect(row?.body).toHaveLength(1200)
  })

  it('一覧のトグルで下書きに戻すのは、中身を見ずに通す', async () => {
    const block = await seedLongNote()
    const signed = await signIn()

    const off = await signed(`/admin/blocks/${block.id}/publish`, {
      method: 'POST',
      body: form({}),
    })
    expect(off.status).toBe(303)
    const row = await db().query.blocks.findFirst({ where: (t, { eq }) => eq(t.id, block.id) })
    expect(row?.published).toBe(0)
    // 中身は触らない
    expect(row?.body).toHaveLength(maxCharsOf('note') * 3)
  })

  it('一覧のトグルで公開に戻すほうは、編集フォームと同じ関門で止め、理由を編集画面に出す', async () => {
    /*
      「中身は触らないので検査もしない」としていたころは、下書きの保存（長さを
      見ない）とこのトグルを続けると、検査が1度も走らずに上限の3倍のメモが
      公開になった（ADM-1 / MNT-1）。関門は published が 1 になるときに1か所
    */
    const block = await seedLongNote()
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
    expect(edit).toContain('1画面に収まりません')
    expect(edit).toContain('name="published" value="1" checked=""')
  })

  it('一覧にその切り替えの口がある', async () => {
    const block = await seedLongNote()
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
  ブロックではない「書く場所」。どちらも1画面に全部出るので、割る先が無い。
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
    expect(html).toContain('カードに収まりません')
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
    // 電話の幅のカードは2行で切る。上限まで書けばどこでも全部読まれる、とは書かない
    expect(html).toContain(`${MAX_CHARS.itemSummaryVisible} 字までしか出ません`)
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

  it('紹介文は、公開するときに字数と段落の数の両方で止める', async () => {
    const signed = await signIn()
    const long = await signed('/admin/members', {
      method: 'POST',
      body: form({
        name: '岡崎 昂功',
        slug: 'okazaki',
        bio: 'あ'.repeat(MAX_CHARS.memberBio + 1),
        published: '1',
      }),
    })
    expect(long.status).toBe(400)
    expect(await long.text()).toContain('1画面に収まりません')

    // 字数が足りていても、段落を増やせば空行のぶんだけ高くなる
    const manyParagraphs = await signed('/admin/members', {
      method: 'POST',
      body: form({
        name: '岡崎 昂功',
        slug: 'okazaki',
        bio: Array.from({ length: MAX_CHARS.memberBioParagraphs + 1 }, () => 'あ').join('\n\n'),
        published: '1',
      }),
    })
    expect(manyParagraphs.status).toBe(400)
    expect(await manyParagraphs.text()).toContain('段落は')
    expect(await db().select().from(schema.members)).toHaveLength(0)
  })

  it('上限より前に保存された長い紹介文の人も、下書きに戻せる（行き止まりにしない）', async () => {
    /*
      紹介文の長さを下書きの保存でも見ていたころは、上限より前に保存された長い
      紹介文を持つ人の編集フォームが同じ 400 で戻り、公開を外すことすらできなかった
      （ADM-1 の「関門が3つの validator に別々に書いてあり、2つは下書きにも掛かる」）
    */
    const member = await seedMember({ bio: 'あ'.repeat(MAX_CHARS.memberBio * 2) })
    const signed = await signIn()
    const response = await signed(`/admin/members/${member.id}`, {
      method: 'POST',
      body: form({ name: member.name, slug: 'okazaki', bio: member.bio }),
    })
    expect(response.status).toBe(303)
    const row = await db().query.members.findFirst({ where: eq(schema.members.id, member.id) })
    expect(row?.published).toBe(0)
    expect(row?.bio).toHaveLength(MAX_CHARS.memberBio * 2)
  })

  it('上限のうちに収まる紹介文は通る', async () => {
    const signed = await signIn()
    const parts = MAX_CHARS.memberBioParagraphs
    // 空行も字として数える（打った文字列そのままの長さで見る）
    const each = Math.floor((MAX_CHARS.memberBio - (parts - 1) * 2) / parts)
    const response = await signed('/admin/members', {
      method: 'POST',
      body: form({
        name: '岡崎 昂功',
        slug: 'okazaki',
        bio: Array.from({ length: parts }, () => 'あ'.repeat(each)).join('\n\n'),
        published: '1',
      }),
    })
    expect(response.status).toBe(303)
  })
})

/*
  ADM-10。字数の関門が紹介文とブロックの本文にしか無く、個人ページの大見出し・
  経歴、ブロックの見出しは上限なしで公開できた。経歴は timeline ブロックと同じ
  部品・同じ件数で割るのに、timeline の字数の上限を持たなかった（同じ本文の
  timeline は 400、経歴は 303）。上限はどれも npm run check:fit の fixture が
  上限ちょうどの姿で測り続けている。
*/
describe('大見出し・経歴・ブロックの見出しの上限（公開の関門）', () => {
  // 経歴の1行。年月 | 何を | 補足 で、見える字数が n 字になる
  const careerLine = (n: number) => `2024 | ${'あ'.repeat(n - 5)} | あ`
  const perScreen = MEMBER_PER_SCREEN.career
  const overLine = Math.ceil((TIMELINE.maxChars + 1) / perScreen) + 2

  it('長い大見出しと経歴は、公開するときに止め、理由をまとめて返す', async () => {
    const signed = await signIn()
    const response = await signed('/admin/members', {
      method: 'POST',
      body: form({
        name: '岡崎 昂功',
        slug: 'okazaki',
        headline: 'あ'.repeat(MAX_CHARS.memberHeadline + 1),
        careerText: Array.from({ length: perScreen }, () => careerLine(overLine)).join('\n'),
        published: '1',
      }),
    })
    expect(response.status).toBe(400)
    const html = await response.text()
    expect(html).toContain(`大見出しは ${MAX_CHARS.memberHeadline} 字までです`)
    expect(html).toContain(`経歴は1画面（${perScreen} 行）で ${TIMELINE.maxChars} 字までです`)
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
        careerText: Array.from({ length: perScreen }, () => careerLine(overLine)).join('\n'),
      }),
    })
    expect(response.status).toBe(303)
  })

  it('経歴は割ったあとの1画面ごとに数える。次の画面に回るぶんまで足さない', async () => {
    const signed = await signIn()
    const each = Math.floor(TIMELINE.maxChars / perScreen)
    const response = await signed('/admin/members', {
      method: 'POST',
      body: form({
        name: '岡崎 昂功',
        slug: 'okazaki',
        headline: 'あ'.repeat(MAX_CHARS.memberHeadline),
        careerText: Array.from({ length: perScreen * 2 }, () => careerLine(each)).join('\n'),
        published: '1',
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
    seed.sql の紹介文は本人の文章で、いまの上限（紹介文 400 字）を超えている。
    書き換えない（本人の言葉を検査の都合で削らない）。そのかわり関門がそれを
    公開としては通さず、下書きへは戻せることをここで確かめる——上限を下げた日に
    「公開中の本人のプロフィールが、次に保存した瞬間に止まる」ことを知っておくため。
  */
  it('seed の紹介文（本人の文章）は上限を超えている。公開では止まり、下書きへは戻せる', async () => {
    const tuple = seedSql.slice(seedSql.indexOf('INSERT INTO members'))
    const strings = [...tuple.matchAll(/'((?:[^']|'')*)'/g)].map((found) =>
      (found[1] ?? '').replaceAll("''", "'"),
    )
    // slug, name, role, location, headline, bio の順
    const bio = strings[5] ?? ''
    expect(bio).toContain('コンピュータサイエンス')
    expect([...bio].length).toBeGreaterThan(MAX_CHARS.memberBio)

    const member = await seedMember({ bio, published: 1 })
    const signed = await signIn()
    const values = { name: member.name, slug: member.slug, bio }
    const publish = await signed(`/admin/members/${member.id}`, {
      method: 'POST',
      body: form({ ...values, published: '1' }),
    })
    expect(publish.status).toBe(400)
    expect(await publish.text()).toContain(`紹介文は ${MAX_CHARS.memberBio} 字までです`)

    const draft = await signed(`/admin/members/${member.id}`, {
      method: 'POST',
      body: form(values),
    })
    expect(draft.status).toBe(303)
    const row = await db().query.members.findFirst({ where: eq(schema.members.id, member.id) })
    expect(row?.published).toBe(0)
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

  it('公開では、タグとリンクは作品のページに収まる数まで。止めても前のタグとリンクは残る', async () => {
    const item = await seedWithChildren()
    const signed = await signIn()
    const response = await signed(`/admin/items/${item.id}`, {
      method: 'POST',
      body: form({
        type: 'app',
        title: 'AppMixer',
        slug: 'appmixer',
        tags: tags(MAX_CHARS.itemTags + 1),
        linkLabel: Array.from({ length: MAX_CHARS.itemLinks + 1 }, (_, i) => `L${i}`),
        linkUrl: Array.from({ length: MAX_CHARS.itemLinks + 1 }, (_, i) => `https://e.test/${i}`),
        published: '1',
      }),
    })
    expect(response.status).toBe(400)
    const html = await response.text()
    expect(html).toContain(`タグは ${MAX_CHARS.itemTags} つまでです`)
    expect(html).toContain(`リンクは ${MAX_CHARS.itemLinks} 本までです`)
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

  it('上限より前に4本以上のリンクを持つ作品も、編集フォームに全部の行が出る（保存で消えない）', async () => {
    const item = await seedItem({ slug: 'many' })
    await db()
      .insert(schema.itemLinks)
      .values(
        Array.from({ length: 5 }, (_, i) => ({
          itemId: item.id,
          label: `L${i}`,
          url: `https://e.test/${i}`,
          sortOrder: i,
        })),
      )
    const signed = await signIn()
    const html = await (await signed(`/admin/items/${item.id}/edit`)).text()
    expect(html.match(/name="linkLabel"/g)).toHaveLength(5)
    expect(html).toContain('value="L4"')
  })
})

/*
  二重送信（ADM-5）。管理画面は JavaScript を持たないので、押したあとにボタンを
  押せなくする手が無い。追加のフォームは描くときに一度きりの札（formKey）を持ち、
  同じ札の2度目は書かずに「保存しました」へ送る。
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

  it('同じ札でも中身が違えば別の行として書く（「戻る」で開き直したフォームから、別のものを書いた）', async () => {
    const signed = await signIn()
    const key = keyOf(await (await signed('/admin/items/new?type=app')).text())
    for (const title of ['AppMixer', 'AllTasks']) {
      const response = await signed('/admin/items', {
        method: 'POST',
        body: form({ type: 'app', title, formKey: key }),
      })
      expect(response.status).toBe(303)
    }
    const titles = (await db().select().from(schema.items)).map((row) => row.title).sort()
    // 黙って捨てて「保存しました」と言わない
    expect(titles).toEqual(['AllTasks', 'AppMixer'])
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
    const long = 'あ'.repeat(maxCharsOf('note') + 1)

    // 新しく書く: 公開は止める、下書きは通す
    const publish = await signed('/admin/blocks', {
      method: 'POST',
      body: form({ type: 'note', title: '長い', body: long, published: '1' }),
    })
    expect(publish.status).toBe(400)
    const draft = await signed('/admin/blocks', {
      method: 'POST',
      body: form({ type: 'note', title: '長い', body: long }),
    })
    expect(draft.status).toBe(303)
    const note = await db().query.blocks.findFirst({ where: eq(schema.blocks.type, 'note') })
    if (!note) throw new Error('note が無い')

    // 編集: 公開にする保存は止める
    const edit = await signed(`/admin/blocks/${note.id}`, {
      method: 'POST',
      body: form({ title: '長い', body: long, published: '1' }),
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
      body: form({ type: 'app', title: 'AppMixer', slug: 'app-mixer', published: '1' }),
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
  作品の並び（PUB-4 / SYS-9）。並べる年（items.year_from）は DB が year から作り、
  管理画面の知らせは同じ規則の yearFrom が出す。2つの答えがずれないことを見る。
*/
describe('作品の並べる年', () => {
  it('DB が作る年（year_from）と、管理画面の知らせ（yearFrom）は同じ答え', async () => {
    const years = ['2026', '2024 — 現在', '2019.04 — 2021', '令和6', '〜2023', 'FY2024', '24', '']
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
