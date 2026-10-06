import { env } from 'cloudflare:test'
import { drizzle } from 'drizzle-orm/d1'
import { describe, expect, it } from 'vitest'
import {
  CELESTIAL_ACCENTS,
  CELESTIAL_BODY_KEYS,
  DEFAULT_CELESTIAL,
  isCelestialAccent,
  isCelestialBody,
  normalizeCelestial,
} from '../src/celestial'
import * as schema from '../src/db/schema'
import { ACCENTS } from '../src/theme'

describe('メンバーの天体と色の共有ルール', () => {
  it('指定した5天体だけを受け入れ、色は既存プリセットと継承を使う', () => {
    expect(CELESTIAL_BODY_KEYS).toEqual(['black-hole', 'saturn', 'neptune', 'moon', 'sun'])
    for (const key of CELESTIAL_BODY_KEYS) expect(isCelestialBody(key)).toBe(true)
    expect(isCelestialAccent('inherit')).toBe(true)
    for (const [index, accent] of ACCENTS.entries()) {
      expect(isCelestialAccent(accent.key)).toBe(true)
      // 色の名前・説明も別の写しを作らず、そのまま同じ選択肢を使う。
      expect(CELESTIAL_ACCENTS[index + 1]).toBe(accent)
    }
  })

  it('未設定の既定は今までのブラックホールとサイトの色', () => {
    expect(normalizeCelestial()).toEqual({ body: 'black-hole', accent: 'inherit' })
    expect(normalizeCelestial({ celestialBody: null, celestialAccent: '' })).toEqual(
      DEFAULT_CELESTIAL,
    )
  })

  it('有効な選択は維持し、不明な天体・色だけを個別に既定へ戻す', () => {
    expect(normalizeCelestial({ celestialBody: 'saturn', celestialAccent: 'rose' })).toEqual({
      body: 'saturn',
      accent: 'rose',
    })
    expect(normalizeCelestial({ celestialBody: 'unknown', celestialAccent: 'mint' })).toEqual({
      body: 'black-hole',
      accent: 'mint',
    })
    expect(normalizeCelestial({ celestialBody: 'moon', celestialAccent: 'unknown' })).toEqual({
      body: 'moon',
      accent: 'inherit',
    })
  })

  it.each(['', 'constructor', '__proto__', 'toString', 'SUN', ' sun ', 'sun" style="color:red'])(
    '不明な値 %s をSSRへ流さず、保存用検査でも受け入れない',
    (value) => {
      expect(isCelestialBody(value)).toBe(false)
      expect(isCelestialAccent(value)).toBe(false)
      expect(normalizeCelestial({ celestialBody: value, celestialAccent: value })).toEqual(
        DEFAULT_CELESTIAL,
      )
    },
  )
})

describe('天体の列を追加するD1移行', () => {
  it('旧メンバーと子の参照を保ち、追加前のINSERTも既定の天体・継承色になる', async () => {
    const d1 = env.MIGRATION_DB
    const migration = env.TEST_MIGRATIONS.find((one) => one.name.includes('member_celestial'))
    if (!migration) throw new Error('member_celestial の移行が無い')
    const { results } = await d1
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY rowid DESC",
      )
      .all<{ name: string }>()
    for (const { name } of results) await d1.prepare(`DROP TABLE \`${name}\``).run()
    for (const earlier of env.TEST_MIGRATIONS.filter((one) => one.name < migration.name)) {
      for (const query of earlier.queries) await d1.prepare(query).run()
    }
    await d1.batch([
      d1.prepare(
        "INSERT INTO members (id, slug, name, role, bio, avatar_url, published, sort_order, form_key, created_at, updated_at) VALUES (1, 'first', '既存メンバー', '既存の役割', '既存の紹介', '/images/avatars/first.png', 1, 20, '1234567890abcdef', '2020-01-01', '2021-01-01'), (2, 'draft', '下書きメンバー', '', '', NULL, 0, 10, NULL, '2022-01-01', '2023-01-01')",
      ),
      d1.prepare("INSERT INTO users (id, role, member_id) VALUES (7, 'owner', 1)"),
      d1.prepare(
        "INSERT INTO items (id, type, member_id, title, slug, published) VALUES (3, 'app', 1, '既存の作品', 'existing-item', 1)",
      ),
      d1.prepare("INSERT INTO member_slug_redirects (old_slug, member_id) VALUES ('old-first', 1)"),
    ])
    const membersBefore = (await d1.prepare('SELECT * FROM members ORDER BY id').all()).results
    const usersBefore = (await d1.prepare('SELECT * FROM users').all()).results
    const itemsBefore = (await d1.prepare('SELECT * FROM items').all()).results
    const redirectsBefore = (await d1.prepare('SELECT * FROM member_slug_redirects').all()).results

    for (const query of migration.queries) await d1.prepare(query).run()

    expect((await d1.prepare('SELECT * FROM members ORDER BY id').all()).results).toEqual(
      membersBefore.map((member) => ({
        ...member,
        celestial_body: 'black-hole',
        celestial_accent: 'inherit',
      })),
    )
    expect((await d1.prepare('SELECT * FROM users').all()).results).toEqual(usersBefore)
    expect((await d1.prepare('SELECT * FROM items').all()).results).toEqual(itemsBefore)
    expect((await d1.prepare('SELECT * FROM member_slug_redirects').all()).results).toEqual(
      redirectsBefore,
    )
    expect((await d1.prepare('PRAGMA foreign_key_check').all()).results).toEqual([])

    // 旧コードのINSERT（新しい列を指定しない）でも、追加後のDBに書ける。
    await d1.prepare("INSERT INTO members (slug, name) VALUES ('new', '新メンバー')").run()
    const member = await d1
      .prepare('SELECT celestial_body, celestial_accent FROM members WHERE slug = ?')
      .bind('new')
      .first()
    expect(member).toEqual({ celestial_body: 'black-hole', celestial_accent: 'inherit' })
    const columns = await d1
      .prepare('PRAGMA table_info(members)')
      .all<{ name: string; notnull: number; dflt_value: string }>()
    expect(columns.results.find((column) => column.name === 'celestial_body')).toMatchObject({
      notnull: 1,
      dflt_value: "'black-hole'",
    })
    expect(columns.results.find((column) => column.name === 'celestial_accent')).toMatchObject({
      notnull: 1,
      dflt_value: "'inherit'",
    })

    // 保存を通らないDB値でも、描画へは許可リスト内の値だけを渡す。
    await d1
      .prepare('UPDATE members SET celestial_body = ?, celestial_accent = ? WHERE id = 1')
      .bind('sun" style="color:red', 'constructor')
      .run()
    const rows = await drizzle(d1, { schema }).query.members.findMany()
    expect(normalizeCelestial(rows.find((row) => row.id === 1) ?? {})).toEqual(DEFAULT_CELESTIAL)
  })
})
