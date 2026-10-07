import { beforeEach, describe, expect, it } from 'vitest'
import * as schema from '../src/db/schema'
import { db, form, resetDb, signIn } from './helpers'

beforeEach(resetDb)

describe('ブロックの項目別入力', () => {
  it.each([
    ['numbers', ['12', '件', '制作したもの'], '12 | 件 | 制作したもの'],
    [
      'links',
      ['Example', 'https://example.test/', '紹介'],
      'Example | https://example.test/ | 紹介',
    ],
    ['timeline', ['2026', '公開', '最初の版'], '2026 | 公開 | 最初の版'],
    ['now', ['取り組み', '補足'], '取り組み | 補足'],
  ])('%s を保存し、既存の公開部品で読める本文にする', async (type, cells, expected) => {
    const signed = await signIn()
    const fields = Object.fromEntries(
      cells.map((cell, index) => [`blockPart${index}`, [cell, '', '']]),
    )
    const response = await signed('/admin/blocks', {
      method: 'POST',
      body: form({ type, title: '入力見本', ...fields }),
    })
    expect(response.status).toBe(303)
    const rows = await db().select().from(schema.blocks)
    expect(rows.find((row) => row.title === '入力見本')?.body).toBe(expected)
  })

  it('区切り文字と不正URLのエラーは、行や項目の値を変えずに返す', async () => {
    const signed = await signIn()
    for (const [label, url] of [
      ['ラベル | そのまま', 'https://example.test/'],
      ['残すラベル', 'javascript:alert(1)'],
    ]) {
      const response = await signed('/admin/blocks', {
        method: 'POST',
        body: form({
          type: 'links',
          title: '戻る題',
          blockPart0: [label ?? '', '2行目'],
          blockPart1: [url ?? '', 'https://example.test/two'],
          blockPart2: ['補足', '2行目の補足'],
        }),
      })
      expect(response.status).toBe(400)
      const html = await response.text()
      expect(html).toContain(`value="${label}"`)
      expect(html).toContain(`value="${url}"`)
      expect(html).toContain('value="2行目の補足"')
      expect(html).toContain('href="#field-body-error"')
      expect(html).not.toContain('<textarea')
    }
    expect(await db().select().from(schema.blocks)).toEqual([])
  })
})
