import { beforeEach, describe, expect, it } from 'vitest'
import * as schema from '../src/db/schema'
import { db, get, resetDb, seedItem, seedMember, signIn } from './helpers'

beforeEach(resetDb)

const plain = (html: string) => html.replace(/<[^>]*>/g, '')

describe('管理画面の概要', () => {
  it('認証なしでは概要とプレビューへの導線を表示しない', async () => {
    const response = await get('/admin')
    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe('/admin/login?next=%2Fadmin')
  })

  it('初回は設定の次の一手を案内し、読むだけではデータを作らない', async () => {
    await db().delete(schema.settings)
    const signed = await signIn()
    const response = await signed('/admin')
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toContain('no-store')
    const html = await response.text()
    expect(html).toContain('サイトの紹介文を確認する')
    expect(html).toContain('href="/admin" aria-current="page"')
    expect(html).toContain('href="/admin/preview" target="_blank" rel="noreferrer"')
    expect(html).toContain('既定の文章')
    expect(html).toContain('未設定（掲載しません）')
    expect(html).toContain('既定の並び')
    // 既定の並びで出るのは入口だけ（作品・メンバー・連絡先がまだ無いので、Projects・Team・Contact は出ない）
    expect(plain(html)).toContain('目次に表示: 1 ページ')
    // 見た目は1つ（選ぶ口を持たない）ので、色と書体のカードは無い
    expect(plain(html)).not.toContain('色と書体')
    expect(await db().query.settings.findMany()).toHaveLength(0)
    expect(await db().query.blocks.findMany()).toHaveLength(0)
    expect(await db().query.members.findMany()).toHaveLength(0)
    expect(await db().query.items.findMany()).toHaveLength(0)
  })

  it('公開/下書きを区分ごとに数え、実在する下書きの編集へ送る', async () => {
    await seedMember()
    await db().insert(schema.members).values({ slug: 'draft-person', name: '下書き', published: 0 })
    await db()
      .insert(schema.items)
      .values([
        { id: 10, type: 'app', slug: 'app-one', title: 'A', published: 1 },
        { id: 11, type: 'app', slug: 'app-two', title: 'B', published: 1 },
        { id: 12, type: 'app', slug: 'app-draft', title: 'C', published: 0 },
        { id: 20, type: 'work', slug: 'work-draft-one', title: 'D', published: 0 },
        { id: 21, type: 'work', slug: 'work-draft-two', title: 'E', published: 0 },
      ])
    const signed = await signIn()
    const html = await (await signed('/admin')).text()
    expect(html).toContain('作品の下書きを確認する')
    expect(html).toContain('href="/admin/items/12/edit"')
    const projects = plain(html).slice(plain(html).indexOf('作品・業務の実績'))
    expect(projects).toContain('個人開発公開 2 件下書き 1 件')
    expect(projects).toContain('業務公開 0 件下書き 2 件')
    expect(plain(html)).toContain('目次に表示: 4 ページ')
  })

  it('一部だけ保存した設定を、まったく未設定の状態と混同しない', async () => {
    await db().delete(schema.settings)
    await db()
      .insert(schema.settings)
      .values({ key: 'site.heroLead', value: '保存した紹介文です。' })
    const signed = await signIn()
    const html = await (await signed('/admin')).text()
    expect(html).toContain('一部保存済み')
    expect(html).toContain('サイトの紹介文を確認する')
    expect(html).not.toContain('いまは既定の文章が使われています')
  })

  it('あとから足した欄（Instagram・X）の行が無くても、保存済みに数える', async () => {
    // 欄を足す前に保存したサイト。足した日に「一部保存済み」へ戻さない
    await db().delete(schema.settings)
    await db()
      .insert(schema.settings)
      .values(
        ['tagline', 'heroLead', 'contactLead', 'email', 'github'].map((key) => ({
          key: `site.${key}`,
          value: key === 'email' || key === 'github' ? '' : '保存した文です。',
        })),
      )
    const signed = await signIn()
    const html = await (await signed('/admin')).text()
    expect(html).not.toContain('一部保存済み')
    expect(html).toContain('保存済み')
  })

  it('プロフィールだけが下書きなら、その編集を案内する', async () => {
    const member = await seedMember({ published: 0 })
    const signed = await signIn()
    const html = await (await signed('/admin')).text()
    expect(html).toContain('プロフィールの下書きを確認する')
    expect(html).toContain(`href="/admin/members/${member.id}/edit"`)
    expect(plain(html)).toContain('公開 0 件下書き 1 件')
  })

  it('全ページの取り下げを既定の構成と混同しない', async () => {
    await seedMember()
    await seedItem()
    await db()
      .insert(schema.blocks)
      .values([
        { type: 'hero', published: 0, sortOrder: 10 },
        { type: 'projects', published: 0, sortOrder: 20 },
        { type: 'team', published: 0, sortOrder: 30 },
        { type: 'contact', published: 0, sortOrder: 40 },
      ])
    const signed = await signIn()
    const html = await (await signed('/admin')).text()
    expect(html).toContain('公開ページの構成を確認する')
    expect(html).toContain('すべて下書き')
    expect(plain(html)).toContain('目次に表示: 0 ページ')
    expect(html).toContain('プロフィール・チームは目次から外れています')
    expect(html).toContain('Projects は目次から外れています（作品のページは公開中）')
    expect(html).not.toContain('既定の並び')
    expect(await db().query.blocks.findMany()).toHaveLength(4)
  })

  it('保存済みの公開内容があるときは全体プレビューを案内する', async () => {
    await seedMember()
    await seedItem()
    const signed = await signIn()
    const html = await (await signed('/admin')).text()
    expect(html).toContain('公開画面を確認する')
    expect(html).toContain('保存済み')
    expect(html).not.toContain('公開準備完了')
  })

  it('業務だけ登録している場合は、空の個人開発一覧へ送らない', async () => {
    await seedMember()
    await seedItem({ type: 'work' })
    const signed = await signIn()
    const html = await (await signed('/admin')).text()
    expect(html).toContain('class="dashboard-card" href="/admin/items?type=work"')
  })
})
