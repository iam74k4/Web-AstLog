import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import { SITE_VERSION_KEY } from '../src/lib/page-cache'
import { ADMIN_BEHAVIOR } from '../src/ui/admin-behavior'
import { form, okText, resetDb, seedMember, signIn } from './helpers'

beforeEach(resetDb)

// 認証用の行を作ってから、プレビューがアプリのどの表も書き換えないことを見る。
async function databaseState() {
  const { results } = await env.DB.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name",
  ).all<{ name: string }>()
  return Promise.all(
    results.map(async ({ name }) => {
      const table = name.replaceAll('"', '""')
      const rows = await env.DB.prepare(`SELECT * FROM "${table}" ORDER BY rowid`).all()
      return { name, rows: rows.results }
    }),
  )
}

async function mediaState() {
  const { keys } = await env.MEDIA.list()
  return Promise.all(
    keys
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(async ({ name }) => ({
        name,
        value: [
          ...new Uint8Array((await env.MEDIA.get(name, 'arrayBuffer')) ?? new ArrayBuffer(0)),
        ],
      })),
  )
}

async function privateText(response: Response, status = 200) {
  expect(response.status).toBe(status)
  expect(response.headers.get('cache-control')).toBe('private, no-store')
  expect(response.headers.get('x-robots-tag')).toContain('noindex')
  expect(response.headers.get('content-security-policy')).toContain("script-src 'none'")
  const html = await response.text()
  expect(html).not.toContain('<script')
  return html
}

const selectedPair = (html: string, body: string, accent: string) => {
  expect(html).toContain(`data-celestial-body="${body}" data-celestial-accent="${accent}"`)
}

describe('天体設定の入力とプレビューの独立監査', () => {
  it('CSSや属性として送られた未知値は追加・編集・プレビューの全経路で保存前に拒否する', async () => {
    const member = await seedMember({ celestialBody: 'moon', celestialAccent: 'rose' })
    const signed = await signIn()
    const before = await databaseState()
    const media = await mediaState()
    const attacks = [
      ['celestialBody', 'moon" style="--accent:red'],
      ['celestialBody', '<script>alert(1)</script>'],
      ['celestialBody', '__proto__'],
      ['celestialAccent', 'rose; background: url(https://evil.example/leak)'],
      ['celestialAccent', 'mint" onmouseover="alert(1)'],
      ['celestialAccent', 'constructor'],
    ] as const
    for (const [field, value] of attacks) {
      for (const path of [
        '/admin/members',
        `/admin/members/${member.id}`,
        '/admin/preview/members',
        `/admin/preview/members/${member.id}`,
      ]) {
        const body = form({
          name: member.name,
          slug: path.endsWith('/members') ? 'new-person' : member.slug,
          celestialBody: 'sun',
          celestialAccent: 'ember',
          [field]: value,
        })
        const response = await signed(path, { method: 'POST', body })
        expect(response.status, `${path}: ${field}=${value}`).toBe(400)
        const html = path.startsWith('/admin/preview')
          ? await privateText(response, 400)
          : await response.text()
        expect(html.replace(`<script>${ADMIN_BEHAVIOR}</script>`, '')).not.toContain('<script')
        expect(html).not.toContain('onmouseover="alert(1)"')
        expect(html).not.toContain('style="--accent:red"')
      }
    }
    expect(await databaseState()).toEqual(before)
    expect(await mediaState()).toEqual(media)
  })

  it('multipartの天体・色欄にFileを送り込んでも、文字列の許可値として扱わない', async () => {
    const member = await seedMember({ celestialBody: 'saturn', celestialAccent: 'sky' })
    const signed = await signIn()
    const before = await databaseState()
    const media = await mediaState()
    for (const field of ['celestialBody', 'celestialAccent']) {
      for (const path of [`/admin/members/${member.id}`, `/admin/preview/members/${member.id}`]) {
        const body = form({ name: member.name, slug: member.slug })
        body.set(field, new File(['sun'], 'sun', { type: 'text/plain' }))
        const response = await signed(path, { method: 'POST', body })
        expect(response.status, `${path}: ${field}`).toBe(400)
      }
    }
    expect(await databaseState()).toEqual(before)
    expect(await mediaState()).toEqual(media)
  })

  it('既存DBの危険な値は公開・保存済み・旧フォームのプレビューで既定表示へ戻す', async () => {
    const member = await seedMember({
      celestialBody: 'moon" onmouseover="alert(1)',
      celestialAccent: 'mint; background: url(https://evil.example/leak)',
    })
    const publicHtml = await okText(`/members/${member.slug}`)
    const signed = await signIn()
    const before = await databaseState()
    const media = await mediaState()
    const saved = await privateText(await signed(`/admin/preview/members/${member.id}`))
    const oldForm = await privateText(
      await signed(`/admin/preview/members/${member.id}`, {
        method: 'POST',
        body: form({ name: member.name, slug: member.slug }),
      }),
    )
    for (const html of [publicHtml, saved, oldForm]) {
      selectedPair(html, 'black-hole', 'inherit')
      expect(html).toContain('<header class="hero hero--profile">')
      expect(html).not.toContain('onmouseover')
      expect(html).not.toContain('evil.example')
    }
    expect(await databaseState()).toEqual(before)
    expect(await mediaState()).toEqual(media)
  })

  it('未保存の天体変更は他メンバー・保存済みプレビュー・全体の公開データへ混ざらない', async () => {
    const first = await seedMember({
      slug: 'first',
      celestialBody: 'moon',
      celestialAccent: 'rose',
    })
    const second = await seedMember({
      slug: 'second',
      name: '別のメンバー',
      celestialBody: 'saturn',
      celestialAccent: 'mint',
    })
    // 公開ページのキャッシュ作成も監査対象POSTの前に済ませる。
    const originalPublic = await okText(`/members/${first.slug}`)
    const signed = await signIn()
    const before = await databaseState()
    const media = await mediaState()
    const version = await env.MEDIA.get(SITE_VERSION_KEY)
    const unsaved = await privateText(
      await signed(`/admin/preview/members/${first.id}`, {
        method: 'POST',
        body: form({
          name: first.name,
          slug: first.slug,
          headline: first.name,
          published: '1',
          celestialBody: 'sun',
          celestialAccent: 'ember',
        }),
      }),
    )
    selectedPair(unsaved, 'sun', 'ember')
    expect(unsaved).not.toContain('data-celestial-body="saturn"')
    const other = await privateText(await signed(`/admin/preview/members/${second.id}`))
    selectedPair(other, 'saturn', 'mint')
    expect(other).not.toContain('data-celestial-body="sun"')
    const saved = await privateText(await signed(`/admin/preview/members/${first.id}`))
    selectedPair(saved, 'moon', 'rose')
    expect(saved).not.toContain('data-celestial-body="sun"')
    const all = await privateText(await signed('/admin/preview'))
    selectedPair(all, 'moon', 'rose')
    selectedPair(all, 'saturn', 'mint')
    expect(all).not.toContain('data-celestial-body="sun"')
    expect(all).not.toContain('data-celestial-accent="ember"')
    expect(await databaseState()).toEqual(before)
    expect(await mediaState()).toEqual(media)
    expect(await env.MEDIA.get(SITE_VERSION_KEY)).toBe(version)
    expect(await okText(`/members/${first.slug}`)).toBe(originalPublic)
  })
})
