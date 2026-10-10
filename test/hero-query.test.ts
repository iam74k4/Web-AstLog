import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import * as schema from '../src/db/schema'
import app from '../src/index'
import { CACHE_STATE_HEADER } from '../src/lib/page-cache'
import { db, resetDb, seedMember, uncachedEnv } from './helpers'

beforeEach(resetDb)

// キャッシュミスの実経路で D1 に投げた文を見る。描いた本文だけでは、未使用の全文取得に気づけない。
async function uncachedHero(query = '') {
  const statements: string[] = []
  const database = new Proxy(env.DB, {
    get(target, key) {
      if (key === 'prepare') {
        return (sql: string) => {
          statements.push(sql)
          return target.prepare(sql)
        }
      }
      const value = Reflect.get(target, key)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
  const ctx = createExecutionContext()
  const response = await app.fetch(
    new Request(`https://astlog.test/${query}`),
    uncachedEnv({ DB: database }),
    ctx,
  )
  await waitOnExecutionContext(ctx)
  expect(response.status).toBe(200)
  expect(response.headers.get(CACHE_STATE_HEADER)).toBe('miss')
  return { html: await response.text(), statements }
}

describe('入口の取得', () => {
  it('絞り込みを付けて来ても、作品の行も本文も関連行も引かない（区分ごとの件数だけ）', async () => {
    const first = await seedMember({ slug: 'first' })
    const second = await seedMember({ slug: 'second' })
    await db()
      .insert(schema.items)
      .values([
        {
          type: 'app',
          title: '新しい',
          year: '2026',
          memberId: first.id,
          storyBackground: 'a'.repeat(100_000),
          published: 1,
        },
        { type: 'work', title: '古い', year: '2010', memberId: second.id, published: 1 },
        { type: 'app', title: '下書き', year: '1990', published: 0 },
      ])

    const { html, statements } = await uncachedHero('?kind=app&member=first')
    // 一覧への1本は出る（作品がある）。件数の帯は持たない
    expect(html).toContain('作品を見る')
    expect(html).not.toContain('class="tally')
    const itemQueries = statements.filter((sql) => /\bfrom\s+"items"(?:\s|$)/i.test(sql))
    expect(itemQueries.length).toBeGreaterThan(0)
    for (const sql of itemQueries) {
      expect(sql).toMatch(/\bcount\(/i)
      expect(sql).not.toMatch(/"body"|"story_\w+"|"item_(tags|links|shots)"|json_array|\bmin\(/i)
    }
  })
})
