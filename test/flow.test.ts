import { beforeEach, describe, expect, it } from 'vitest'
import * as schema from '../src/db/schema'
import { db, form, get, OWNER, resetDb, seedItem, seedMember, signIn } from './helpers'

/*
  導線。ある画面から次の画面へ、行き止まらずに進めるか。
  構成でブロックを外したときに切れやすいので、その形をここで押さえる。
*/

beforeEach(resetDb)

type BlockKey = (typeof schema.blocks.$inferInsert)['type']

const place = (types: BlockKey[]) =>
  db()
    .insert(schema.blocks)
    .values(types.map((type, index) => ({ type, published: 1, sortOrder: (index + 1) * 10 })))

const bandOf = (html: string) => {
  const from = html.indexOf('class="band"')
  return from < 0 ? '' : html.slice(from, html.indexOf('</a>', from))
}

describe('個人ページ → 一覧', () => {
  it('構成で Apps と Works を外したら、一覧へは案内しない', async () => {
    const member = await seedMember()
    await seedItem({ type: 'app', memberId: member.id })
    await seedItem({ type: 'work', title: '業務の実績', memberId: member.id })
    await place(['hero', 'team', 'contact'])

    // 送った先に節が無いと、行き止まり（404）になる
    const html = await (await get('/members/okazaki')).text()
    expect(bandOf(html)).toBe('')
    expect(html).not.toContain('href="/apps')
    expect(html).not.toContain('href="/works')
  })

  it('帯の件数は、置いてある節のぶんだけ', async () => {
    const member = await seedMember()
    await seedItem({ type: 'app', memberId: member.id })
    await seedItem({ type: 'work', title: '業務の実績', memberId: member.id })
    await place(['hero', 'works', 'team', 'contact'])

    const band = bandOf(await (await get('/members/okazaki')).text())
    expect(band).toContain('href="/works"')
    expect(band).toContain('Works 1')
    // Apps の節が無いのに「Apps 1」と出すと、どこにも無い1件になる
    expect(band).not.toContain('Apps 1')
  })

  it('入口の帯も、置いてある節のぶんだけ数える', async () => {
    await seedItem({ type: 'app' })
    await seedItem({ type: 'work', title: '業務の実績' })
    await place(['hero', 'apps', 'contact'])

    const band = bandOf(await (await get('/')).text())
    expect(band).toContain('Apps 1')
    expect(band).not.toContain('Works 1')
  })
})

describe('1人のサイトの ?member=', () => {
  it('帯は ?member= を付けずに一覧へ送る', async () => {
    const member = await seedMember()
    await seedItem({ memberId: member.id })

    const html = await (await get('/members/okazaki')).text()
    expect(bandOf(html)).toContain('href="/apps"')
    expect(html).not.toContain('?member=')
  })

  it('URL に付いていても絞り込まない。「すべて」に印が付いたまま全件を出す', async () => {
    const member = await seedMember()
    await seedItem({ title: '本人のアプリ', memberId: member.id })
    await seedItem({ title: '担当の無いアプリ', sortOrder: 20 })

    // 名前のピルが無いので、効かせると「すべて」にも名前にも印が付かなくなる
    const html = await (await get('/apps?member=okazaki')).text()
    expect(html).toContain('担当の無いアプリ')
    expect(html).toContain('href="/apps" aria-current="true"')
  })
})

describe('トップ → 個人ページ', () => {
  it('Team を外したら、メンバーが1人でもカードから個人ページへ行ける', async () => {
    const member = await seedMember()
    await seedItem({ slug: 'appmixer', memberId: member.id })
    await place(['hero', 'apps', 'contact'])

    expect(await (await get('/apps')).text()).toContain(
      'class="card__member" href="/members/okazaki"',
    )
    // 作品1件のページの「担当」も同じ条件
    expect(await (await get('/apps/item/appmixer')).text()).toContain('href="/members/okazaki"')
  })

  it('Team があってメンバーが1人なら、カードには名前を出さない', async () => {
    const member = await seedMember()
    await seedItem({ memberId: member.id })

    expect(await (await get('/apps')).text()).not.toContain('card__member')
  })
})

/* ------------------------------------------------------------- 管理側 */

describe('ログインの戻り先', () => {
  it('弾かれた画面へ、ログイン後に戻る', async () => {
    const bounced = await get('/admin/appearance')
    expect(bounced.headers.get('location')).toBe('/admin/login?next=%2Fadmin%2Fappearance')

    // 戻り先はログイン画面のフォームに持ち回される
    const page = await (await get('/admin/login?next=%2Fadmin%2Fappearance')).text()
    expect(page).toContain('name="next" value="/admin/appearance"')

    await signIn()
    const response = await get('/admin/login', {
      method: 'POST',
      body: form({ email: OWNER.email, password: OWNER.password, next: '/admin/appearance' }),
    })
    expect(response.headers.get('location')).toBe('/admin/appearance')
  })

  it('管理画面の外へは戻さない', async () => {
    await signIn()
    for (const next of [
      'https://evil.example',
      '//evil.example',
      '/admin/../..//evil',
      '/members/okazaki',
      '/admin/logout',
    ]) {
      const response = await get('/admin/login', {
        method: 'POST',
        body: form({ email: OWNER.email, password: OWNER.password, next }),
      })
      expect(response.headers.get('location'), next).toBe('/admin/members')
    }
  })
})

it('初期設定で owner を作ったら、そのまま管理画面に入れる', async () => {
  const response = await get('/admin/setup', {
    method: 'POST',
    body: form({ token: 'test-setup-token', email: OWNER.email, password: OWNER.password }),
  })
  expect(response.status).toBe(303)
  expect(response.headers.get('location')).toBe('/admin/members')

  const cookie = response.headers.get('set-cookie')?.split(';')[0] ?? ''
  expect((await get('/admin/members', { headers: { cookie } })).status).toBe(200)
})

describe('構成', () => {
  it('↑↓ のあとは、動かした行へ戻る', async () => {
    const signed = await signIn()
    await signed('/admin/blocks/init', { method: 'POST' })
    const team = await db().query.blocks.findFirst({ where: (t, { eq }) => eq(t.type, 'team') })
    if (!team) throw new Error('team が無い')

    const response = await signed(`/admin/blocks/${team.id}/move`, {
      method: 'POST',
      body: form({ dir: 'up' }),
    })
    expect(response.headers.get('location')).toBe(`/admin/blocks#block-${team.id}`)
    expect(await (await signed('/admin/blocks')).text()).toContain(`id="block-${team.id}"`)
  })

  it('足したものは Contact の手前に入り、その行へ戻る', async () => {
    const signed = await signIn()
    await signed('/admin/blocks/init', { method: 'POST' })

    const response = await signed('/admin/blocks', {
      method: 'POST',
      body: form({ type: 'note', title: 'あとがき', body: '本文です', published: '1' }),
    })
    const rows = await db().query.blocks.findMany({ orderBy: (t, { asc }) => [asc(t.sortOrder)] })
    expect(rows.map((row) => row.type).slice(-2)).toEqual(['note', 'contact'])
    expect(response.headers.get('location')).toBe(`/admin/blocks?saved=1#block-${rows.at(-2)?.id}`)
  })
})

describe('管理画面からサイトへ', () => {
  it('公開中のメンバーは、一覧からそのページを開ける', async () => {
    await seedMember()
    await seedMember({ slug: 'draft', name: '下書きの人', published: 0 })
    const signed = await signIn()

    const html = await (await signed('/admin/members')).text()
    expect(html).toContain('href="/members/okazaki"')
    // 下書きの人のページは 404 なので、リンクを出さない
    expect(html).not.toContain('href="/members/draft"')
  })

  it('どの画面の左ナビにも「サイトを見る」がある', async () => {
    const signed = await signIn()
    for (const path of ['/admin/members', '/admin/items', '/admin/blocks', '/admin/appearance']) {
      expect(await (await signed(path)).text(), path).toContain('サイトを見る')
    }
  })
})

describe('下書きの扱い', () => {
  it('下書きで保存したら、サイトにまだ出ていないと知らせる', async () => {
    const signed = await signIn()
    const response = await signed('/admin/items', {
      method: 'POST',
      body: form({ type: 'app', title: '寝かせておくアプリ' }),
    })
    expect(response.headers.get('location')).toBe('/admin/items?type=app&saved=draft')
    expect(await (await signed('/admin/items?type=app&saved=draft')).text()).toContain(
      'サイトにはまだ出ていません',
    )
  })

  it('書くブロックは、メンバー・項目と同じく下書きから始まる', async () => {
    const signed = await signIn()
    const html = await (await signed('/admin/blocks/new?type=note')).text()
    expect(html).toContain('name="published" value="1"')
    expect(html).not.toContain('name="published" value="1" checked')
  })
})

describe('削除の確認から戻る', () => {
  it('編集画面から来たなら、キャンセルで編集画面へ戻る', async () => {
    const member = await seedMember()
    const item = await seedItem()
    const signed = await signIn()

    const fromEdit = await (await signed(`/admin/members/${member.id}/delete?from=edit`)).text()
    expect(fromEdit).toContain(`href="/admin/members/${member.id}/edit"`)
    const itemFromEdit = await (await signed(`/admin/items/${item.id}/delete?from=edit`)).text()
    expect(itemFromEdit).toContain(`href="/admin/items/${item.id}/edit"`)

    // 一覧から来たなら一覧へ
    const fromList = await (await signed(`/admin/members/${member.id}/delete`)).text()
    expect(fromList).not.toContain(`href="/admin/members/${member.id}/edit"`)
  })
})
