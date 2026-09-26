import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import { type BlockKey, blockType, MAX_CHARS } from '../src/blocks'
import * as schema from '../src/db/schema'
import { chunk } from '../src/lib/paginate'
import { db, form, get, OWNER, resetDb, seedItem, seedMember, signIn } from './helpers'

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
    expect(await (await get('/all')).text()).toContain('岡崎 昂功')
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

    expect(await (await get('/all')).text()).toContain('残るアプリ')
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
    const html = await (await get('/all')).text()
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
    expect(await (await get('/all')).text()).not.toContain('テスト用アプリ')

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

    const html = await (await get('/all')).text()
    expect(html).toContain('新しいタグ')
    expect(html).not.toContain('古いタグ')
  })
})

/*
  作品の本文と画像。本文と画像は作品のページにだけ出る（カードには出さない。
  カードのサムネイルは同じ画像の飾り）。

  画像はアバターと同じ経路（種類と大きさの検査 → KV）で、置き場だけが items/。
  同じ KV にログイン試行の記録があるので、公開側の /images/* はキーの形で
  縛っている（test/public.test.ts の /images）。
*/
describe('Items — 本文と画像', () => {
  const png = (bytes = 64) => new File([new Uint8Array(bytes)], 'shot.png', { type: 'image/png' })
  const withImage = (values: Record<string, string>, file = png()) => {
    const body = form(values)
    body.append('image', file)
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

  it('画像は KV の items/ に置き、作品のページに代替テキストつきで出る。本文は説明に続く段落で出る', async () => {
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

    const html = await (await get('/apps/item/appmixer')).text()
    expect(html).toContain(
      `<figure class="shot"><img src="${url}" alt="音量ミキサーの画面" decoding="async"/></figure>`,
    )
    // 説明が頭の1段落、本文がそのあとに続く1つの段落の列（ItemDetail の Note）
    expect(html).toContain('<p>音量を分ける常駐アプリ。</p><p>背景と結果の段落です。</p>')
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
      body: withImage({ type: 'app', title: '大きい画像' }, png(1_200_000)),
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
    expect(await (await get('/apps/item/gone')).text()).not.toContain('<figure')
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
    expect(await (await get('/apps/item/appmixer')).text()).not.toContain('別のアプリ')
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
    expect(await (await get('/apps/item/appmixer')).text()).toContain('AppMixer 2')
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
    expect(await (await get('/projects')).text()).toContain(
      `Projects の ${chunk(titles, per).length} 画面のうち 1 画面目`,
    )

    // 1件足すと画面が1枚増える。それが管理画面から見えることがこのテストの主題
    const grown = [...titles, 'アプリ 5']
    await seedItem({ title: 'アプリ 5', sortOrder: 50 })

    const after = await (await signed('/admin/blocks')).text()
    expect(screenBadges(after)).toEqual([1, chunk(grown, per).length, 0, 1])
    expect(after).toContain('合計 5 画面')
    expect(await (await get('/projects')).text()).toContain(
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
      const page = await (await get(path)).text()
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
      const first = await (await get(`/block-${block.id}`)).text()
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

  it('一覧のトグルからも、フォームを通らずに切り替えられる', async () => {
    const block = await seedLongNote()
    const signed = await signIn()

    const off = await signed(`/admin/blocks/${block.id}/publish`, {
      method: 'POST',
      body: form({}),
    })
    expect(off.status).toBe(303)
    expect(
      (await db().query.blocks.findFirst({ where: (t, { eq }) => eq(t.id, block.id) }))?.published,
    ).toBe(0)

    // 戻すほうも同じ口から。中身は触らない
    const on = await signed(`/admin/blocks/${block.id}/publish`, {
      method: 'POST',
      body: form({ published: '1' }),
    })
    expect(on.status).toBe(303)
    const row = await db().query.blocks.findFirst({ where: (t, { eq }) => eq(t.id, block.id) })
    expect(row?.published).toBe(1)
    expect(row?.body).toHaveLength(maxCharsOf('note') * 3)
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

  it('紹介文は字数と段落の数の両方で止める', async () => {
    const signed = await signIn()
    const long = await signed('/admin/members', {
      method: 'POST',
      body: form({
        name: '岡崎 昂功',
        slug: 'okazaki',
        bio: 'あ'.repeat(MAX_CHARS.memberBio + 1),
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
      }),
    })
    expect(manyParagraphs.status).toBe(400)
    expect(await manyParagraphs.text()).toContain('段落は')
    expect(await db().select().from(schema.members)).toHaveLength(0)
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
