/*
  npm run check:restore — deploy が残す D1 の写しが、空の D1 に戻せるかを確かめる。

  deploy.yml は移行を流す前に本番の写しを取り、artifact に残す。写しは「戻せる」と
  確かめて初めて控えになる。1本の `d1 export`（定義と中身を1つの SQL に）は
  **戻せなかった**——写しは表を sqlite_master の順に書くので、先に作った子の表
  （0000_init の item_links・item_tags）の INSERT が親（items）の CREATE TABLE より
  前に来て、空の D1 に流すと `no such table: main.items` で止まる（頭の
  `PRAGMA defer_foreign_keys=TRUE` は、親の表そのものが無いときは救えない）。
  いまは定義（--no-data）と中身（--no-schema）の2本に分けて取り、定義 → 中身の順に
  流す（README の「戻す」）。ここではその手順をそのまま、手元の使い捨ての D1 で通す。

  1. 使い捨ての置き場に移行を流し、seed と check:fit の上限ちょうどの fixture と、
     ログインまわりの行（users・紐づけ・記録・札・セッション）と転送表の行を入れる。
     **どの表にも1行以上ある**ことを先に確かめる——表を足した日に、その表が空のまま
     「戻せた」と言わないため
  2. deploy と同じ2本の export を取る（--local。remote の写しと同じ形）
  3. 別の使い捨ての置き場（空の D1）に、定義 → 中身の順で流す
  4. 表と索引の定義、全部の表の全部の行が同じか。d1_migrations も戻っていて、
     戻した D1 に `migrations apply` が当てるものが無いか

  手元の D1（.wrangler/state）には触らない。export に --persist-to が無いので、
  元の側は wrangler.toml と drizzle/ を写した一時ディレクトリを cwd にして動かす。
*/

import { spawn } from 'node:child_process'
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ROOT, WRANGLER, WRANGLER_ARGS } from './lib/dev-server.mjs'
import { fixture } from './lib/fit-fixture.mjs'

const run = (args, cwd) =>
  new Promise((resolve, reject) => {
    const child = spawn(WRANGLER, [...WRANGLER_ARGS, ...args], {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    child.once('error', reject)
    const out = []
    const err = []
    child.stdout.on('data', (chunk) => out.push(String(chunk)))
    child.stderr.on('data', (chunk) => err.push(String(chunk)))
    child.once('exit', (code) =>
      code === 0
        ? resolve(out.join(''))
        : reject(
            new Error(
              `wrangler ${args.slice(0, 3).join(' ')} が ${code} で落ちた\n${out.join('')}${err.join('')}`,
            ),
          ),
    )
  })

// seed と fixture が触らない表の行。どれも本番の D1 に実際にある形
const AUTH_AND_REDIRECTS = `
INSERT INTO users (id, role, member_id) VALUES (1, 'owner', 1);
INSERT INTO user_identities (user_id, provider, subject, label) VALUES (1, 'github', '1001', '@owner');
INSERT INTO owner_claims (provider, value, subject, ticket) VALUES ('github', '1001', '1001', 'ticket');
INSERT INTO oauth_states (state, provider, code_verifier, nonce, next, expires_at) VALUES ('state', 'google', 'verifier', 'nonce', '/admin', '2999-01-01T00:00:00.000Z');
INSERT INTO sessions (id, user_id, expires_at) VALUES ('${'0'.repeat(64)}', 1, '2999-01-01T00:00:00.000Z');
INSERT INTO item_slug_redirects (old_slug, item_id) SELECT 'old-' || slug, id FROM items WHERE slug IS NOT NULL LIMIT 1;
INSERT INTO member_slug_redirects (old_slug, member_id) SELECT 'old-' || slug, id FROM members LIMIT 1;
INSERT OR REPLACE INTO settings (key, value) VALUES ('layout', 'rail');
`

const query = async (sql, cwd, persistTo) => {
  const args = ['d1', 'execute', 'astlog', '--local', '--json', `--command=${sql}`]
  if (persistTo) args.push('--persist-to', persistTo)
  const [{ results }] = JSON.parse(await run(args, cwd))
  return results
}

const TABLES =
  "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name"
const DEFINITIONS =
  "SELECT type, name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY type, name"

// 表と索引の定義、全部の表の全部の行（rowid の順）
async function picture(cwd, persistTo) {
  const tables = (await query(TABLES, cwd, persistTo)).map((row) => row.name)
  const rows = {}
  for (const table of tables) {
    rows[table] = await query(`SELECT * FROM "${table}" ORDER BY rowid`, cwd, persistTo)
  }
  return { definitions: await query(DEFINITIONS, cwd, persistTo), rows }
}

const source = await mkdtemp(join(tmpdir(), 'astlog-restore-source-'))
const target = await mkdtemp(join(tmpdir(), 'astlog-restore-target-'))
const failures = []
try {
  // 1. 元の D1（写した wrangler.toml の既定の置き場 = source/.wrangler/state）
  await cp(join(ROOT, 'wrangler.toml'), join(source, 'wrangler.toml'))
  await cp(join(ROOT, 'drizzle'), join(source, 'drizzle'), { recursive: true })
  await run(['d1', 'migrations', 'apply', 'astlog', '--local'], source)
  const data = [await readFile(join(ROOT, 'seed.sql'), 'utf8'), fixture().sql, AUTH_AND_REDIRECTS]
  for (const [index, sql] of data.entries()) {
    const file = join(source, `data-${index}.sql`)
    await writeFile(file, sql)
    await run(['d1', 'execute', 'astlog', '--local', `--file=${file}`], source)
  }
  const before = await picture(source)
  const empty = Object.entries(before.rows).filter(([, rows]) => rows.length === 0)
  if (empty.length > 0) {
    throw new Error(
      `元の D1 に行の無い表がある（${empty.map(([table]) => table).join('・')}）。` +
        'この検査の AUTH_AND_REDIRECTS に1行足すこと——空の表は戻せたかどうか分からない',
    )
  }

  // 2. deploy.yml と同じ2本
  const schema = join(source, 'schema.sql')
  const rows = join(source, 'data.sql')
  await run(['d1', 'export', 'astlog', '--local', '--no-data', `--output=${schema}`], source)
  await run(['d1', 'export', 'astlog', '--local', '--no-schema', `--output=${rows}`], source)

  // 3. 空の D1 に、定義 → 中身の順で（README の「戻す」と同じ順）
  for (const file of [schema, rows]) {
    await run(
      ['d1', 'execute', 'astlog', '--local', '--persist-to', target, `--file=${file}`],
      source,
    )
  }

  // 4. 同じか
  const after = await picture(source, target)
  if (JSON.stringify(after.definitions) !== JSON.stringify(before.definitions)) {
    failures.push('表と索引の定義が、元の D1 と違う')
  }
  for (const [table, rows] of Object.entries(before.rows)) {
    const back = after.rows[table]
    if (!back) failures.push(`${table}: 戻した D1 に表が無い`)
    else if (JSON.stringify(back) !== JSON.stringify(rows)) {
      failures.push(`${table}: 行が違う（元 ${rows.length} 行・戻した D1 ${back.length} 行）`)
    }
  }
  const pending = await run(
    ['d1', 'migrations', 'list', 'astlog', '--local', '--persist-to', target],
    source,
  )
  if (!/No migrations to apply/.test(pending)) {
    failures.push(
      `戻した D1 に、まだ当たっていない移行がある（d1_migrations が戻っていない）\n${pending}`,
    )
  }

  if (failures.length > 0) {
    console.error(`✗ 写しから戻せない: ${failures.length} 件`)
    for (const line of failures) console.error(`  ${line}`)
    process.exitCode = 1
  } else {
    const total = Object.values(before.rows).reduce((sum, rows) => sum + rows.length, 0)
    console.log(
      `✓ 写し（定義 → 中身の2本）を空の D1 に戻せた: ${Object.keys(before.rows).length} 表・${total} 行・` +
        `定義 ${before.definitions.length} 件が元と同じ。当たっていない移行 0`,
    )
  }
} finally {
  await rm(source, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 })
  await rm(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 })
}
