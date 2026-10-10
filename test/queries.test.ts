import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import { publishedItemsQuery } from '../src/db/queries'
import { db, resetDb, seedMember } from './helpers'

beforeEach(resetDb)

/*
  公開の一覧の索引（PERF-1）。

  item_links に item_id の索引が無く、items の索引も公開の並び（year_from の新しい順 →
  sort_order → id）と別の順だった。一覧を出すたびに公開中の全件を並べ直し
  （TEMP B-TREE）、その全件ぶんのタグとリンクを読んでいた。索引が並びの順に
  なっていれば、並べ直さずに前から読め、子も作品ごとに自分の索引で引ける。
*/

type Plan = { detail: string }

// 担当つき・区分まじり・年の無い行もある公開中の作品を、子（タグ3・リンク3）ごと置く
async function seedMany(count: number, memberId: number) {
  const stmts: D1PreparedStatement[] = []
  for (let i = 1; i <= count; i += 1) {
    stmts.push(
      env.DB.prepare(
        'INSERT INTO items (id, type, member_id, title, slug, year, published, sort_order) VALUES (?, ?, ?, ?, ?, ?, 1, ?)',
      ).bind(
        i,
        i % 3 ? 'app' : 'work',
        i % 2 ? memberId : null,
        `作品${i}`,
        `item-${i}`,
        i % 5 ? `${2000 + (i % 20)}` : '',
        i % 4,
      ),
    )
    for (let k = 0; k < 3; k += 1) {
      stmts.push(
        env.DB.prepare(
          'INSERT INTO item_links (item_id, label, url, sort_order) VALUES (?, ?, ?, ?)',
        ).bind(i, `L${k}`, 'https://example.test/', k),
        env.DB.prepare('INSERT INTO item_tags (item_id, tag, sort_order) VALUES (?, ?, ?)').bind(
          i,
          `T${k}`,
          k,
        ),
      )
    }
  }
  await env.DB.batch(stmts)
}

async function explain(query: ReturnType<typeof publishedItemsQuery>) {
  const { sql, params } = query.toSQL()
  const plan = await env.DB.prepare(`EXPLAIN QUERY PLAN ${sql}`)
    .bind(...params)
    .all<Plan>()
  return { plan: plan.results.map((row) => row.detail) }
}

describe('索引', () => {
  it('Projects の一覧は、並べ直さずに索引の順で読む。子も作品ごとに索引で引く', async () => {
    const member = await seedMember()
    await seedMany(60, member.id)

    const scopes = {
      全部: {},
      区分: { kind: 'app' as const },
      担当: { memberId: member.id },
    }
    for (const [name, scope] of Object.entries(scopes)) {
      const { plan } = await explain(publishedItemsQuery(db(), scope))
      // 並べ直しが1つも無い（一覧の並びも、タグとリンクの並びも索引のまま）
      expect(
        plan.filter((line) => line.includes('TEMP B-TREE')),
        name,
      ).toEqual([])
      // items は索引で引く。表を頭から読まない
      expect(
        plan.filter((line) => /^(SCAN|SEARCH) items /.test(line)),
        name,
      ).toEqual([expect.stringMatching(/^SEARCH items USING INDEX idx_items_/)])
      // 子は作品ごとに自分の索引で引く（その場で作る AUTOMATIC INDEX に頼らない）
      expect(plan, name).toContain('SEARCH items_links USING INDEX idx_item_links_item (item_id=?)')
      expect(plan, name).toContain('SEARCH items_tags USING INDEX idx_item_tags_item (item_id=?)')
      expect(plan, name).toContain('SEARCH items_shots USING INDEX idx_item_shots_item (item_id=?)')
    }
  })

  it('既にある行を持った D1 に当てても、行はそのままで索引が張られる', async () => {
    const found = env.TEST_MIGRATIONS.find((one) => one.name.includes('item_indexes'))
    expect(found, '0012_item_indexes の移行が無い').toBeDefined()

    const d1 = env.MIGRATION_DB
    const { results } = await d1
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY rowid DESC",
      )
      .all<{ name: string }>()
    for (const { name } of results) await d1.prepare(`DROP TABLE \`${name}\``).run()
    const run = async (names: (name: string) => boolean) => {
      for (const migration of env.TEST_MIGRATIONS.filter((one) => names(one.name))) {
        for (const query of migration.queries) await d1.prepare(query).run()
      }
    }

    await run((name) => name < '0012')
    await d1.batch([
      d1.prepare(
        "INSERT INTO items (id, type, title, slug, year, published, sort_order) VALUES (1, 'app', 'AppMixer', 'appmixer', '2026', 1, 10), (2, 'work', '基幹刷新', 'kikan', '2024 — 現在', 1, 20)",
      ),
      d1.prepare(
        "INSERT INTO item_links (item_id, label, url, sort_order) VALUES (1, 'Repository', 'https://example.test/r', 0)",
      ),
      d1.prepare("INSERT INTO item_tags (item_id, tag, sort_order) VALUES (1, 'Rust', 0)"),
    ])
    await run((name) => name >= '0012')

    const items = await d1
      .prepare('SELECT id, title, year_from FROM items ORDER BY id')
      .all<{ id: number; title: string; year_from: number }>()
    expect(items.results).toEqual([
      { id: 1, title: 'AppMixer', year_from: 2026 },
      { id: 2, title: '基幹刷新', year_from: 2024 },
    ])
    expect(await d1.prepare('SELECT count(*) AS n FROM item_links').first('n')).toBe(1)
    expect(await d1.prepare('SELECT count(*) AS n FROM item_tags').first('n')).toBe(1)

    const indexes = await d1
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_item%'")
      .all<{ name: string }>()
    expect(indexes.results.map((row) => row.name).sort()).toEqual(
      [
        'idx_item_links_item',
        'idx_item_shots_item',
        'idx_item_slug_redirects_item',
        'idx_item_tags_item',
        'idx_items_kind',
        'idx_items_member',
        'idx_items_public',
      ].sort(),
    )
  })
})
