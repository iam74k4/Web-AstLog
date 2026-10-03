import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import * as schema from '../src/db/schema'
import app from '../src/index'
import { CACHE_STATE_HEADER } from '../src/lib/page-cache'
import { db, resetDb, seedItem, seedMember, uncachedEnv } from './helpers'

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

describe('入口の年の取得', () => {
  it('絞り込みを無視して年を集約し、作品の本文・関連行を取得しない', async () => {
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
    expect(html).toContain('<dt lang="en">Since</dt><dd class="tally__year">2010</dd>')
    const itemQueries = statements.filter((sql) => /\bfrom\s+"items"(?:\s|$)/i.test(sql))
    expect(itemQueries.some((sql) => /\bmin\(/i.test(sql))).toBe(true)
    for (const sql of itemQueries) {
      expect(sql).not.toMatch(/"body"|"story_\w+"|"item_(tags|links|shots)"|json_array/i)
    }
  })

  it('最小年が 0 のときは、従来どおり Since を表示しない', async () => {
    await seedItem({ year: '0000' })
    await seedItem({ year: '2026' })
    const { html } = await uncachedHero()
    expect(html).toContain('class="tally"')
    expect(html).not.toContain('class="tally__year"')
  })
})
