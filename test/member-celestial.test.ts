import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import { CELESTIAL_ACCENTS, CELESTIAL_BODIES, DEFAULT_CELESTIAL } from '../src/celestial'
import * as schema from '../src/db/schema'
import { SITE_VERSION_KEY } from '../src/lib/page-cache'
import { readMemberForm } from '../src/routes/admin/members'
import { ADMIN_BEHAVIOR } from '../src/ui/admin-behavior'
import { db, form, okText, resetDb, seedMember, signIn } from './helpers'

beforeEach(resetDb)

const choices = (html: string, name: string) =>
  (html.match(/<input\b[^>]*>/g) ?? []).filter((input) => input.includes(`name="${name}"`)).join('')
const chosen = (html: string, name: string, value: string) =>
  expect(
    choices(html, name)
      .split('<input')
      .find((input) => input.includes(`value="${value}"`)),
  ).toContain('checked')
const celestialGroup = (html: string) =>
  (html.match(/<details\b[^>]*>[\s\S]*?<\/details>/g) ?? []).find((part) =>
    part.includes('>天体と色<'),
  ) ?? ''
const mediaNames = async () => (await env.MEDIA.list()).keys.map((key) => key.name).sort()

describe('メンバーごとの天体と装飾色', () => {
  it('新規フォームには既定値とすべての選択肢を示し、顔写真とは役割を分ける', async () => {
    const signed = await signIn()
    const response = await signed('/admin/members/new')
    expect(response.status).toBe(200)
    const html = await response.text()
    chosen(html, 'celestialBody', DEFAULT_CELESTIAL.body)
    chosen(html, 'celestialAccent', DEFAULT_CELESTIAL.accent)
    for (const option of CELESTIAL_BODIES)
      expect(choices(html, 'celestialBody')).toContain(`value="${option.key}"`)
    for (const option of CELESTIAL_ACCENTS)
      expect(choices(html, 'celestialAccent')).toContain(`value="${option.key}"`)
    const group = celestialGroup(html)
    expect(group).toMatch(/^<details[^>]*\bopen\b/)
    expect(group).toContain(
      'プロフィールの表紙とメンバー一覧に反映。公開中が1人なら入口・Contactにも反映',
    )
    expect(group).toContain('celestial-choices__grid')
    expect(group.match(/<img /g)).toHaveLength(5)
    expect(group).toContain('文字やリンクの色は変わりません')
    expect(group).not.toContain('name="avatar"')
  })

  it('選べる天体と色を下書きにも保存できる', async () => {
    const signed = await signIn()
    const cases = [
      ...CELESTIAL_BODIES.map(({ key }) => ({
        slug: `body-${key}`,
        celestialBody: key,
        celestialAccent: DEFAULT_CELESTIAL.accent,
      })),
      ...CELESTIAL_ACCENTS.map(({ key }) => ({
        slug: `accent-${key}`,
        celestialBody: DEFAULT_CELESTIAL.body,
        celestialAccent: key,
      })),
    ]
    for (const values of cases) {
      const response = await signed('/admin/members', {
        method: 'POST',
        body: form({ name: values.slug, ...values }),
      })
      expect(response.status, values.slug).toBe(303)
    }
    const members = await db().select().from(schema.members)
    expect(members).toHaveLength(cases.length)
    for (const values of cases) {
      expect(members.find((member) => member.slug === values.slug)).toMatchObject({
        celestialBody: values.celestialBody,
        celestialAccent: values.celestialAccent,
        published: 0,
      })
    }
  })

  it('古いフォームは新規なら既定値、編集なら既存値を保ち、写真も維持する', async () => {
    const signed = await signIn()
    const created = await signed('/admin/members', {
      method: 'POST',
      body: form({ name: '旧フォーム', slug: 'old-form' }),
    })
    expect(created.status).toBe(303)
    expect((await db().select().from(schema.members))[0]).toMatchObject({
      celestialBody: 'black-hole',
      celestialAccent: 'inherit',
    })
    const member = await seedMember({
      slug: 'existing',
      celestialBody: 'moon',
      celestialAccent: 'rose',
      avatarUrl: '/images/avatars/kept.png',
    })
    const changed = await signed(`/admin/members/${member.id}`, {
      method: 'POST',
      body: form({ name: member.name, slug: member.slug }),
    })
    expect(changed.status).toBe(303)
    expect(
      (await db().select().from(schema.members)).find((row) => row.id === member.id),
    ).toMatchObject({
      celestialBody: 'moon',
      celestialAccent: 'rose',
      avatarUrl: member.avatarUrl,
    })
    const html = await (await signed(`/admin/members/${member.id}/edit`)).text()
    chosen(html, 'celestialBody', 'moon')
    chosen(html, 'celestialAccent', 'rose')
  })

  it('片方だけ送られた場合も、もう片方の設定を上書きしない', async () => {
    const member = await seedMember({ celestialBody: 'saturn', celestialAccent: 'sky' })
    const signed = await signIn()
    const partials: Record<string, string>[] = [
      { celestialBody: 'neptune' },
      { celestialAccent: 'mint' },
    ]
    for (const partial of partials) {
      const response = await signed(`/admin/members/${member.id}`, {
        method: 'POST',
        body: form({ name: member.name, slug: member.slug, ...partial }),
      })
      expect(response.status).toBe(303)
    }
    expect((await db().select().from(schema.members))[0]).toMatchObject({
      celestialBody: 'neptune',
      celestialAccent: 'mint',
    })
  })

  it('未知値・空値・余分な空白を送ると、下書き保存と保存前プレビューのどちらも400にする', async () => {
    const signed = await signIn()
    const version = await env.MEDIA.get(SITE_VERSION_KEY)
    const keys = await mediaNames()
    const invalid: Record<string, string>[] = [
      { celestialBody: 'earth' },
      { celestialBody: '' },
      { celestialBody: 'moon ' },
      { celestialAccent: 'blue' },
      { celestialAccent: '' },
      { celestialAccent: ' inherit' },
    ]
    for (const values of invalid) {
      for (const path of ['/admin/members', '/admin/preview/members']) {
        const response = await signed(path, {
          method: 'POST',
          body: form({ name: '選び直す人', ...values }),
        })
        expect(response.status, `${path}: ${JSON.stringify(values)}`).toBe(400)
        const html = await response.text()
        expect(html).toContain('選び直してください')
        expect(html.replace(`<script>${ADMIN_BEHAVIOR}</script>`, '')).not.toContain('<script')
      }
    }
    expect(await db().select().from(schema.members)).toEqual([])
    expect(await mediaNames()).toEqual(keys)
    expect(await env.MEDIA.get(SITE_VERSION_KEY)).toBe(version)
  })

  it('入力エラーで設定を開き、通った天体も選べない色も残して返す', async () => {
    const member = await seedMember({ celestialBody: 'moon', celestialAccent: 'rose' })
    const signed = await signIn()
    const response = await signed(`/admin/members/${member.id}`, {
      method: 'POST',
      body: form({
        name: member.name,
        slug: member.slug,
        celestialBody: 'neptune',
        celestialAccent: 'infrared',
      }),
    })
    expect(response.status).toBe(400)
    const html = await response.text()
    expect(celestialGroup(html)).toMatch(/^<details[^>]*\bopen\b/)
    chosen(html, 'celestialBody', 'neptune')
    chosen(html, 'celestialAccent', 'infrared')
    expect(html).toContain('選べない値: infrared')
    expect(await db().select().from(schema.members)).toEqual([member])
  })

  it('保存前の設定を同じパーサーから受け取り、プレビューでDBや画像を変更しない', async () => {
    const member = await seedMember({
      celestialBody: 'moon',
      celestialAccent: 'rose',
      avatarUrl: '/images/avatars/kept.png',
    })
    const body = form({
      name: member.name,
      slug: member.slug,
      celestialBody: 'sun',
      celestialAccent: 'ember',
      published: '1',
    })
    expect(readMemberForm(body, member)).toMatchObject({
      errors: null,
      values: { celestialBody: 'sun', celestialAccent: 'ember' },
    })
    const signed = await signIn()
    const version = await env.MEDIA.get(SITE_VERSION_KEY)
    const keys = await mediaNames()
    const response = await signed(`/admin/preview/members/${member.id}`, { method: 'POST', body })
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    const html = await response.text()
    expect(html).toContain('data-celestial-body="sun"')
    expect(html).toContain('data-celestial-accent="ember"')
    expect(html).toContain(member.avatarUrl)
    expect(html).toContain('編集を続けるにはプレビューを閉じてください')
    expect(html).not.toContain('<script')
    expect(await db().select().from(schema.members)).toEqual([member])
    expect(await mediaNames()).toEqual(keys)
    expect(await env.MEDIA.get(SITE_VERSION_KEY)).toBe(version)
    const publicPage = await okText(`/members/${member.slug}`)
    expect(publicPage).toContain('data-celestial-body="moon"')
    expect(publicPage).toContain('data-celestial-accent="rose"')
  })

  it('旧フォームの保存前プレビューも、新規の既定値と編集の保存済み設定を保持する', async () => {
    const member = await seedMember({ celestialBody: 'saturn', celestialAccent: 'mint' })
    const signed = await signIn()
    for (const [path, name, expectedBody, expectedAccent] of [
      ['/admin/preview/members', '新しい人', 'black-hole', 'inherit'],
      [`/admin/preview/members/${member.id}`, member.name, 'saturn', 'mint'],
    ] as const) {
      const response = await signed(path, { method: 'POST', body: form({ name }) })
      expect(response.status).toBe(200)
      const html = await response.text()
      expect(html).toContain(`data-celestial-body="${expectedBody}"`)
      expect(html).toContain(`data-celestial-accent="${expectedAccent}"`)
    }
    expect(await db().select().from(schema.members)).toEqual([member])
  })

  it('新規フォームの再送でも、欄のない天体設定を最初の保存から引き継ぐ', async () => {
    const signed = await signIn()
    const first = await signed('/admin/members', {
      method: 'POST',
      body: form({
        formKey: 'abcdef1234567890',
        name: '最初の入力',
        slug: 'first-person',
        celestialBody: 'saturn',
        celestialAccent: 'violet',
      }),
    })
    expect(first.status).toBe(303)
    const repeated = await signed('/admin/members', {
      method: 'POST',
      body: form({ formKey: 'abcdef1234567890', name: '送り直した入力', slug: 'first-person' }),
    })
    expect(repeated.status).toBe(303)
    const members = await db().select().from(schema.members)
    expect(members).toHaveLength(1)
    expect(members[0]).toMatchObject({
      name: '送り直した入力',
      celestialBody: 'saturn',
      celestialAccent: 'violet',
    })
  })
})
