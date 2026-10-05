import { beforeEach, describe, expect, it } from 'vitest'
import { loadSiteSettings, saveSiteSettings } from '../src/db/queries'
import * as schema from '../src/db/schema'
import { SITE, SITE_SETTING_LIMITS, type SiteSettings } from '../src/site'
import { db, form, get, okText, resetDb, seedItem, seedMember, signIn, touch } from './helpers'

beforeEach(resetDb)

const configured: SiteSettings = {
  tagline: '小さなものを、丁寧につくる。',
  heroLead: '開発したサービスと取り組みを紹介しています。',
  contactLead: '開発に関するご相談をお待ちしています。',
  email: 'hello@example.test',
  github: 'https://github.com/astlog-example',
}

const plain = (html: string) => html.replace(/<[^>]*>/g, '')

describe('サイト設定', () => {
  it('空の DB は個人データや無効な連絡先リンクを公開しない', async () => {
    await db().delete(schema.settings)
    await touch()
    expect(await loadSiteSettings(db())).toEqual({
      tagline: SITE.tagline,
      heroLead: SITE.heroLead,
      contactLead: SITE.contactLead,
      email: '',
      github: '',
    })
    for (const path of ['/', '/all', '/contact']) {
      const html = await okText(path)
      expect(html).not.toContain('iam74k4')
      expect(html).not.toContain('noctifex.dev')
      expect(html).not.toContain('href="mailto:')
      expect(html).not.toContain('/assets/avatar.png')
    }
    expect(await okText('/contact')).toContain('連絡先を準備しています')
  })

  it('ログインと送信元の検査を通ってから編集できる', async () => {
    expect((await get('/admin/site')).status).toBe(303)
    expect((await get('/admin/site', { method: 'POST', body: form(configured) })).status).toBe(303)
    const signed = await signIn()
    expect((await signed('/admin/site')).status).toBe(200)
    expect(await (await signed('/')).text()).toContain('class="top__admin" href="/admin/site"')
    expect(
      (
        await signed('/admin/site', {
          method: 'POST',
          body: form(configured),
          headers: { origin: 'https://other.example' },
        })
      ).status,
    ).toBe(403)
    expect((await loadSiteSettings(db())).email).not.toBe(configured.email)
  })

  it('保存した文言と連絡先をすべての公開ページ・メタデータに反映する', async () => {
    const signed = await signIn()
    const response = await signed('/admin/site', { method: 'POST', body: form(configured) })
    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe('/admin/site?saved=1')
    expect(await loadSiteSettings(db())).toEqual(configured)
    const member = await seedMember({ github: configured.github, email: configured.email })
    await seedItem({ slug: 'sample', summary: '作品の説明。' })
    for (const path of ['/', '/all', '/projects', `/members/${member.slug}`, '/apps/item/sample']) {
      const html = await okText(path)
      expect(plain(html)).toContain(configured.tagline)
      expect(html).toContain(`href="mailto:${configured.email}"`)
      expect(html).toContain(`href="${configured.github}"`)
      expect(html).not.toContain('contact@example.test')
    }
    const top = await okText('/')
    expect(plain(top)).toContain(configured.heroLead)
    expect(top).toContain(`"description":"${configured.heroLead}"`)
    const contact = await okText('/contact')
    expect(plain(contact)).toContain(configured.contactLead)
    expect(contact).toContain(`name="description" content="${configured.contactLead}"`)
    expect((contact.match(/href="mailto:/g) ?? []).length).toBe(1)
    expect((await okText(`/members/${member.slug}`)).match(/href="mailto:/g)).toHaveLength(1)
    expect((await okText('/all')).match(/href="mailto:/g)).toHaveLength(2)
  })

  it('連絡先を消すとリンクと構造化データからも外れる', async () => {
    await saveSiteSettings(db(), configured)
    await touch()
    await okText('/')
    const signed = await signIn()
    expect(
      (
        await signed('/admin/site', {
          method: 'POST',
          body: form({ ...configured, email: '', github: '' }),
        })
      ).status,
    ).toBe(303)
    const html = await okText('/')
    expect(html).not.toContain('href="mailto:')
    expect(html).not.toContain('"sameAs"')
    expect(await okText('/contact')).toContain('連絡先を準備しています')
  })

  it('不正な URL・メールや長すぎる文は保存せず、入力欄で理由を返す', async () => {
    const signed = await signIn()
    const response = await signed('/admin/site', {
      method: 'POST',
      body: form({
        ...configured,
        tagline: 'あ'.repeat(SITE_SETTING_LIMITS.tagline + 1),
        email: 'hello@example.test?bcc=other@example.test',
        github: 'javascript:alert(1)',
      }),
    })
    expect(response.status).toBe(400)
    const html = await response.text()
    expect(html).toContain('80 字まで')
    expect(html).toContain('メールアドレスを1つ')
    expect(html).toContain('https:// で始まる URL')
    expect((await loadSiteSettings(db())).email).toBe('contact@example.test')
  })

  it('手動で入った不正な連絡先も公開時に落とす', async () => {
    await db().delete(schema.settings)
    await db()
      .insert(schema.settings)
      .values([
        { key: 'site.email', value: 'person@example.test?subject=unexpected' },
        { key: 'site.github', value: '//evil.example' },
      ])
    await touch()
    const html = await okText('/contact')
    expect(html).not.toContain('href="mailto:')
    expect(html).not.toContain('evil.example')
  })

  it('メンバーのメールも同じ単一宛先の検査を通す', async () => {
    const signed = await signIn()
    const response = await signed('/admin/members', {
      method: 'POST',
      body: form({
        name: '新しい人',
        slug: 'new-member',
        email: 'person@example.test?bcc=other@example.test',
      }),
    })
    expect(response.status).toBe(400)
    expect(await response.text()).toContain('メールアドレスを1つ')
    expect(await db().query.members.findMany()).toHaveLength(0)
  })
})
