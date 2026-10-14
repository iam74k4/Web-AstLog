import { beforeEach, describe, expect, it } from 'vitest'
import * as schema from '../src/db/schema'
import { db, form, resetDb, seedItem, seedMember, signIn } from './helpers'

beforeEach(resetDb)

const details = (html: string, title: string) =>
  (html.match(/<details\b[^>]*>[\s\S]*?<\/details>/g) ?? []).find((block) =>
    block.includes(`>${title}<`),
  ) ?? ''

describe('管理フォームの入力とプレビュー導線', () => {
  it('共通ナビを飛ばし、管理内容へキーボードのフォーカスを移せる入口を先頭に置く', async () => {
    const signed = await signIn()
    for (const path of ['/admin', '/admin/members/new', '/admin/site']) {
      const response = await signed(path)
      expect(response.status).toBe(200)
      const html = await response.text()
      expect(html).toContain('href="#admin-main"')
      expect(html).toContain('管理内容へスキップ')
      expect(html.indexOf('href="#admin-main"')).toBeLessThan(html.indexOf('class="admin-shell"'))
      // 書きながら横に完成形を置く画面（フォームの画面）は live の印を足す
      expect(html).toMatch(
        /<main class="admin-main( admin-main--live)?" id="admin-main" tabindex="-1">/,
      )
    }
  })

  it('新規の主要入力を先頭に出し、任意の項目は畳んでも送信できる欄として残す', async () => {
    const signed = await signIn()
    for (const [path, firstField, optionalTitle] of [
      ['/admin/members/new', 'name', 'プロフィールを詳しく書く'],
      ['/admin/items/new?type=app', 'title', '画像を追加する'],
    ] as const) {
      const response = await signed(path)
      expect(response.status).toBe(200)
      const html = await response.text()
      expect(html.indexOf(`name="${firstField}"`)).toBeLessThan(
        html.indexOf('<details class="form-details"'),
      )
      expect(details(html, optionalTitle)).not.toMatch(/^<details[^>]*\bopen\b/)
      const advanced = details(html, '詳細設定')
      expect(advanced).toContain('name="slug"')
      expect(advanced).toContain('name="sortOrder"')
      expect(advanced).not.toContain('disabled')
      expect(advanced).not.toMatch(/^<details[^>]*\bopen\b/)
      if (firstField === 'name') {
        // ブラウザが閉じた欄の検証で送信を止めると、修正する欄へ移れない。
        for (const [name, mode] of [
          ['github', 'url'],
          ['email', 'email'],
        ]) {
          const input = html.match(new RegExp(`<input[^>]*name="${name}"[^>]*>`))?.[0] ?? ''
          expect(input).toContain('type="text"')
          expect(input).toContain(`inputmode="${mode}"`)
        }
      }
      expect(html).toContain('保存前にプレビューで')
      expect(html).toContain(
        `formaction="/admin/preview/${firstField === 'name' ? 'members' : 'items'}"`,
      )
      expect(html).toContain('formtarget="_blank"')
      expect(html).toContain('formnovalidate')
      expect(html).not.toMatch(/href="\/admin\/preview\/(members|items)\//)
    }
  })

  it('下書きにも保存済みプレビューを出し、公開中の項目には公開ページを別のリンクとして出す', async () => {
    const member = await seedMember({ published: 0, slug: 'draft-member' })
    const item = await seedItem({ published: 0, slug: 'draft-app' })
    const publicMember = await seedMember({ name: '公開メンバー', slug: 'public-member' })
    const publicItem = await seedItem({ title: '公開作品', slug: 'public-app' })
    const signed = await signIn()
    for (const [kind, draft, published, publicHref] of [
      ['members', member, publicMember, '/members/public-member'],
      ['items', item, publicItem, '/apps/item/public-app'],
    ] as const) {
      const list = await signed(`/admin/${kind}`)
      expect(list.status).toBe(200)
      const html = await list.text()
      expect(html).toContain(`href="/admin/preview/${kind}/${draft.id}"`)
      expect(html).toContain(`href="/admin/preview/${kind}/${published.id}"`)
      expect(html).toContain(`href="${publicHref}"`)
      expect(html).not.toContain(
        `href="${kind === 'members' ? '/members/draft-member' : '/apps/item/draft-app'}"`,
      )
      const edit = await signed(`/admin/${kind}/${draft.id}/edit`)
      expect(edit.status).toBe(200)
      const formHtml = await edit.text()
      expect(formHtml).toContain(`href="/admin/preview/${kind}/${draft.id}"`)
      expect(formHtml).toContain('保存済み内容をプレビュー')
      expect(formHtml).toContain(`formaction="/admin/preview/${kind}/${draft.id}"`)
      expect(formHtml).toContain('保存前にプレビューで')
    }
  })

  it('メンバーの名前のローマ字を保存し、編集画面に戻す', async () => {
    const signed = await signIn()
    const response = await signed('/admin/members', {
      method: 'POST',
      body: form({ name: 'テスト', nameLatin: 'Tesuto Taro' }),
    })
    expect(response.status).toBe(303)
    const [member] = await db().select().from(schema.members)
    expect(member?.nameLatin).toBe('Tesuto Taro')
    const edit = await (await signed(`/admin/members/${member?.id}/edit`)).text()
    expect(edit).toContain('name="nameLatin"')
    expect(edit).toContain('value="Tesuto Taro"')
  })

  it('畳んだメンバーの設定で入力が止まったら、該当するまとまりを開く', async () => {
    const signed = await signIn()
    for (const [values, title, field] of [
      [{ name: 'テスト', sortOrder: 'bad' }, '詳細設定', 'sortOrder'],
      [{ name: 'テスト', github: 'http://github.com/example' }, '個人の連絡先を追加する', 'github'],
    ] as const) {
      const response = await signed('/admin/members', { method: 'POST', body: form(values) })
      expect(response.status).toBe(400)
      const section = details(await response.text(), title)
      expect(section).toMatch(/^<details[^>]*\bopen\b/)
      expect(section).toContain(`id="field-${field}-error"`)
    }
  })

  it('作品の分類・リンク・画像のエラーを閉じたまま返さない', async () => {
    const item = await seedItem({
      published: 0,
      slug: 'image-draft',
      imageUrl: '/images/items/test.jpg',
    })
    const signed = await signIn()
    for (const [path, values, title] of [
      ['/admin/items', { type: 'app', title: 'テスト', memberId: '999' }, '分類と担当を設定する'],
      [
        '/admin/items',
        { type: 'app', title: 'テスト', linkLabel: 'Repository', linkUrl: '' },
        'リンクを追加する',
      ],
      [
        `/admin/items/${item.id}`,
        { title: 'テスト', summary: '説明。', published: '1' },
        '画像を追加する',
      ],
    ] as const) {
      const response = await signed(path, { method: 'POST', body: form(values) })
      expect(response.status).toBe(400)
      const section = details(await response.text(), title)
      expect(section).toMatch(/^<details[^>]*\bopen\b/)
      expect(section).toContain('field__error')
    }
  })

  it('サイト設定には保存前プレビューと、保存せず確認する説明がある', async () => {
    const signed = await signIn()
    for (const name of ['site']) {
      const response = await signed(`/admin/${name}`)
      expect(response.status).toBe(200)
      const html = await response.text()
      expect(html).toContain(`action="/admin/${name}"`)
      expect(html).toContain(`formaction="/admin/preview/${name}"`)
      expect(html).toContain('formtarget="_blank"')
      expect(html).toContain('formnovalidate')
      expect(html).toContain('プレビューは保存されません')
      expect(html).toContain('保存すると公開中のサイトに反映')
      expect(html).toContain('name="previewScreen"')
      for (const screen of ['hero', 'projects', 'contact', 'all']) {
        expect(html).toContain(`value="${screen}"`)
      }
    }
  })

  it('アカウントには利用者の操作と公開連絡先への入口を示す', async () => {
    const signed = await signIn()
    const response = await signed('/admin/account')
    expect(response.status).toBe(200)
    const html = await response.text()
    expect(html).toContain('action="/admin/account/logout-all"')
    expect(html).toContain('href="/admin/site"')
    expect(html).not.toContain('OWNER_GITHUB_ID')
    expect(html).not.toContain('OWNER_GOOGLE_EMAIL')
    expect(html).not.toContain('owner_claims')
    expect(html).not.toContain('D1')
  })
})

/*
  書くそばから横で完成形が変わる編集画面（AdminLayout の live）。編集の枠が広いときだけ右に
  完成形の枠を出し、admin-behavior.ts が入力の止まるたびに「保存前にプレビュー」と同じ送り先へ
  ?live=1 を付けて送り直す。?live=1 の完成形は動きを止めて描く（書くたびに幕開けが動かない）
*/
describe('書きながら横に完成形を置く', () => {
  it('保存前にプレビューできるフォームの画面にだけ、完成形の枠を置く', async () => {
    const member = await seedMember()
    await seedMember({ slug: 'second', name: '星野' })
    const item = await seedItem()
    const [block] = await db()
      .insert(schema.blocks)
      .values({ type: 'note', title: 'メモ', body: '本文', published: 1 })
      .returning()
    const signed = await signIn()
    for (const path of [
      `/admin/members/${member.id}/edit`,
      '/admin/members/new',
      `/admin/items/${item.id}/edit`,
      `/admin/blocks/${block?.id}/edit`,
      '/admin/site',
    ]) {
      const html = await (await signed(path)).text()
      expect(html, path).toContain('<main class="admin-main admin-main--live"')
      expect(html, path).toContain('<iframe name="live-preview"')
      // 送り先はフォームの「保存前にプレビュー」（その画面のプレビューの口）
      expect(html, path).toMatch(/formaction="\/admin\/preview\//)
    }
    for (const path of ['/admin', '/admin/members', '/admin/items', '/admin/blocks']) {
      expect(await (await signed(path)).text(), path).not.toContain('<iframe name="live-preview"')
    }
  })

  it('?live=1 の完成形は動きを止めて描き、ふつうのプレビューは止めない', async () => {
    const member = await seedMember()
    const signed = await signIn()
    const body = () => form({ name: member.name, slug: member.slug, headline: '書きかけの見出し' })
    const live = await (
      await signed(`/admin/preview/members/${member.id}?live=1`, { method: 'POST', body: body() })
    ).text()
    expect(live).toContain('data-still=""')
    expect(live).toContain('書きかけの見出し')
    const plain = await (
      await signed(`/admin/preview/members/${member.id}`, { method: 'POST', body: body() })
    ).text()
    expect(plain).not.toContain('data-still')
    // 横の完成形では長い案内を出さない（枠の頭が、保存前か保存済みかを言う）
    expect(live).not.toContain('編集中の内容です')
    expect(plain).toContain('編集中の内容です')
    // サイト設定の完成形も同じ
    const site = await (
      await signed('/admin/preview/site?live=1', {
        method: 'POST',
        body: form({ heroLead: '入口の紹介文です。', previewScreen: 'hero' }),
      })
    ).text()
    expect(site).toContain('data-still=""')
  })
})

describe('見出しの欄は、どこに出るかで名前を変える', () => {
  it('1人のサイトでは「入口の大見出し」、2人以上では「ページの見出し」', async () => {
    const member = await seedMember()
    const signed = await signIn()
    const solo = await (await signed(`/admin/members/${member.id}/edit`)).text()
    expect(solo).toContain('入口の大見出し')
    expect(solo).toContain('1人のサイトでは個人ページには出しません')
    // まだ誰もいないときの追加は、その人が1人目になる
    await db().delete(schema.members)
    expect(await (await signed('/admin/members/new')).text()).toContain('入口の大見出し')
    const again = await seedMember()
    await seedMember({ slug: 'second', name: '星野' })
    const team = await (await signed(`/admin/members/${again.id}/edit`)).text()
    expect(team).toContain('ページの見出し')
    expect(team).not.toContain('入口の大見出し')
  })
})
