import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test'
import backupRecipients from 'virtual:repo:.github/backup-recipients.txt'
import checkYml from 'virtual:repo:.github/workflows/check.yml'
import deployYml from 'virtual:repo:.github/workflows/deploy.yml'
import packageJson from 'virtual:repo:package.json'
import seedSql from 'virtual:repo:seed.sql'
import { drizzle } from 'drizzle-orm/d1'
import { describe, expect, it } from 'vitest'
import * as schema from '../src/db/schema'
import app from '../src/index'
import { createSession, SESSION_COOKIE } from '../src/lib/auth'
import { uncachedEnv } from './helpers'

/*
  本番へ出す道（SYS-1 / SYS-2 / SYS-7 / CI-1）。

  ほかのテストはどれも、setup.ts が全部の移行を当てた D1 で動く。だから
  「前の DB ＋ 今のコード」——移行を流す前に出た版・移行が途中で止まった本番・
  手元から出して移行を忘れた本番——の組は、CI に一度も現れなかった。ここでは
  空の MIGRATION_DB に移行を途中まで当て、今のコード（src/index.tsx の app）を
  その D1 で動かす。
*/

const d1 = () => env.MIGRATION_DB

async function emptyD1() {
  // 前の実行の残りを片付ける（後から作った表から消す）
  const { results } = await d1()
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY rowid DESC",
    )
    .all<{ name: string }>()
  for (const { name } of results) await d1().prepare(`DROP TABLE \`${name}\``).run()
}

async function migrate(which: (name: string) => boolean) {
  for (const migration of env.TEST_MIGRATIONS.filter((one) => which(one.name))) {
    for (const query of migration.queries) await d1().prepare(query).run()
  }
}

const migrationNamed = (part: string) => {
  const found = env.TEST_MIGRATIONS.find((one) => one.name.includes(part))
  if (!found) throw new Error(`${part} の移行が無い`)
  return found.name
}

// 今のコードを、MIGRATION_DB を DB として動かす。移行の前後で描き比べるので、
// 公開ページの写しは通さない（写しがあると、移行の後でも前の画面が出る）
async function open(path: string) {
  const ctx = createExecutionContext()
  const response = await app.fetch(
    new Request(`http://localhost${path}`, { redirect: 'manual' }),
    uncachedEnv({ DB: d1() }),
    ctx,
  )
  await waitOnExecutionContext(ctx)
  return response
}

// 本番にある形の行（1人・作品3件・構成の決まった4節）。選択肢は移行 0011 より前の D1 にも
// 行があるよう、ここでも入れる（INSERT OR IGNORE）
async function liveRows() {
  await d1().batch([
    d1().prepare(
      "INSERT OR IGNORE INTO platforms (key, label, sort_order) VALUES ('web', 'Web', 50), ('cli', 'CLI', 30)",
    ),
    d1().prepare(
      "INSERT INTO members (id, slug, name, role, published, sort_order) VALUES (1, 'okazaki', '岡崎 昂功', 'System Engineer', 1, 10)",
    ),
    d1().prepare(
      "INSERT INTO items (id, type, member_id, platform_key, category, title, slug, year, summary, published, sort_order) VALUES (1, 'app', 1, 'web', '', 'AppMixer', 'appmixer', '2026', '音量を混ぜる常駐アプリ。配布している。', 1, 10), (2, 'app', 1, 'cli', '', 'Tool', 'tool', '2025', '道具。作った。', 1, 20), (3, 'work', 1, NULL, '金融', '基幹刷新', 'kikan', '2024 — 現在', '基幹の刷新。担当した。', 1, 30)",
    ),
    d1().prepare(
      "INSERT INTO blocks (id, type, published, sort_order) VALUES (1, 'hero', 1, 10), (2, 'projects', 1, 20), (4, 'team', 1, 40), (5, 'contact', 1, 50)",
    ),
    // Contact は連絡先があるときだけ出る（src/blocks.ts の blockShown）。前の DB にも置いておく
    d1().prepare("INSERT INTO settings (key, value) VALUES ('site.email', 'contact@example.test')"),
  ])
}

// 公開ページの主な入口。/apps は前の一覧の URL で、区分を絞った /projects へ 301
const PAGES = [
  '/',
  '/projects',
  '/projects?kind=app',
  '/projects?kind=work',
  '/apps',
  '/works/2',
  '/apps/item/appmixer',
  '/works/item/kikan',
  '/contact',
  '/all',
  '/sitemap.xml',
  '/members/okazaki',
]

async function snapshot() {
  const out: Record<string, { status: number; location: string | null; body: string }> = {}
  for (const path of PAGES) {
    const response = await open(path)
    out[path] = {
      status: response.status,
      location: response.headers.get('location'),
      body: await response.text(),
    }
  }
  return out
}

describe('前の DB ＋ 今のコード', () => {
  /*
    使わなくなった天体の列（members.celestial_body / celestial_accent）を落とす移行（0025）。
    読む側から先に外した版（expand → contract の1段目）が出たあとで出す。行を持った D1 に
    0024 まで流してから当て、前後で同じ画面になること、メンバーの行が残って管理画面から
    足して直せることを見る（列を落とすだけなら表を作り直さない。CLAUDE.md「移行」）
  */
  it('天体の列を落とす移行（0025）の前後で同じ画面。行は残り、メンバーを足して直せる', async () => {
    const drop = migrationNamed('drop_member_celestial')
    await emptyD1()
    await migrate((name) => name < drop)
    await liveRows()
    const before = await snapshot()
    await migrate((name) => name === drop)
    const columns = await d1().prepare('PRAGMA table_info(members)').all<{ name: string }>()
    expect(columns.results.map((column) => column.name)).not.toContain('celestial_body')
    expect(columns.results.map((column) => column.name)).not.toContain('celestial_accent')
    const after = await snapshot()
    for (const path of PAGES) {
      expect(after[path]?.status, path).toBeLessThan(400)
      expect(after[path], path).toEqual(before[path])
    }

    // 管理画面の書き込み（足す・直す）。セッションは D1 にハッシュで置く（src/lib/auth.ts）
    const database = drizzle(d1(), { schema })
    const [owner] = await database.insert(schema.users).values({ role: 'owner' }).returning()
    if (!owner) throw new Error('owner を作れなかった')
    const { token } = await createSession(database, owner.id)
    const signed = async (path: string, body: Record<string, string>) => {
      const form = new FormData()
      for (const [key, value] of Object.entries(body)) form.append(key, value)
      const ctx = createExecutionContext()
      const response = await app.fetch(
        new Request(`http://localhost${path}`, {
          method: 'POST',
          body: form,
          headers: { cookie: `${SESSION_COOKIE}=${token}` },
          redirect: 'manual',
        }),
        uncachedEnv({ DB: d1() }),
        ctx,
      )
      await waitOnExecutionContext(ctx)
      return response
    }
    const added = await signed('/admin/members', { name: '星野', slug: 'hoshino', _version: 'new' })
    expect(added.status).toBe(303)
    const current = await database.query.members.findFirst({
      where: (table, { eq }) => eq(table.id, 1),
    })
    const edited = await signed('/admin/members/1', {
      name: '岡崎 昂功',
      slug: 'okazaki',
      role: 'Engineer',
      published: '1',
      _version: current?.updatedAt ?? '',
    })
    expect(edited.status).toBe(303)
    const names = (await database.query.members.findMany()).map((member) => [
      member.name,
      member.role,
    ])
    expect(names).toEqual([
      ['岡崎 昂功', 'Engineer'],
      ['星野', ''],
    ])
  })

  it('移行を流していない D1 では正しく描けない（表が無ければ 500、列が無ければ列の名前が字で出る）——だから deploy は移行をいつも流す', async () => {
    /*
      表や列を足した移行は、読む側で受けられない。drizzle は表と列を名指しで SELECT する
      ので、表を足す移行（0017 の item_shots）を流していない D1 では「no such table」で
      落ちる。列を足すだけの移行（0018 の story_*）では落ちない——SQLite は二重引用符で
      書いた名前が列に見つからないと文字列として読む（DQS）ので、列の名前そのものが中身として
      返り、作品のページにその字が出る。黙って違う字を出す形で、500 より気づきにくい。
      だから deploy.yml は移行を選択肢にせず毎回流し、README もそう書く。この事実が
      変わったなら、この説明ごと見直すこと
    */
    const shots = migrationNamed('item_shots')
    await emptyD1()
    await migrate((name) => name < shots)
    await liveRows()
    expect((await open('/projects')).status).toBe(500)

    const story = migrationNamed('item_story')
    await emptyD1()
    await migrate((name) => name < story)
    await liveRows()
    const page = await open('/apps/item/appmixer')
    expect(page.status).toBe(200)
    expect(await page.text()).toContain('<p>story_background</p>')
  })
})

/*
  プラットフォームの選択肢（参照データ）は移行が入れる（0011_platforms_reference）。
  以前は破壊的な seed.sql の中にしか無く、新しい環境を作るにはそれを流すしかなかった。
*/
describe('プラットフォームの選択肢', () => {
  const platforms = () =>
    d1()
      .prepare('SELECT key, label, sort_order FROM platforms ORDER BY sort_order, key')
      .all<{ key: string; label: string; sort_order: number }>()
      .then((result) => result.results)

  it('移行だけを流した空の D1 に、5つの選択肢がある（seed を流さなくてよい）', async () => {
    await emptyD1()
    await migrate(() => true)
    expect((await platforms()).map((row) => row.key)).toEqual([
      'macos',
      'ios',
      'cli',
      'server',
      'web',
    ])
  })

  it('既にある行（seed で入った行・運用で直した行・足した行）は書き換えない', async () => {
    const reference = migrationNamed('platforms_reference')
    await emptyD1()
    await migrate((name) => name < reference)
    await d1().batch([
      d1().prepare(
        "INSERT INTO platforms (key, label, sort_order) VALUES ('web', 'Web ブラウザ', 5), ('android', 'Android', 60)",
      ),
    ])
    await migrate((name) => name >= reference)
    expect(await platforms()).toEqual([
      { key: 'web', label: 'Web ブラウザ', sort_order: 5 },
      { key: 'macos', label: 'macOS', sort_order: 10 },
      { key: 'ios', label: 'iOS', sort_order: 20 },
      { key: 'cli', label: 'CLI', sort_order: 30 },
      { key: 'server', label: 'Server', sort_order: 40 },
      { key: 'android', label: 'Android', sort_order: 60 },
    ])
  })

  it('seed.sql は platforms に触らない（消さない・入れない）', () => {
    const sql = seedSql.replace(/--.*$/gm, '')
    expect(sql).not.toMatch(/\bplatforms\b/i)
  })
})

/*
  本番へ出す道の決まり。YAML と package.json にしか無いので、文字列で見る。
  コメントに当たって緑にならないよう、# から行末（YAML のコメント）を落として読む。
*/
describe('本番へ出す道', () => {
  const uncommented = (yml: string) => yml.replace(/(^|\s)#.*$/gm, '$1')
  const deploy = uncommented(deployYml)
  const scripts = (JSON.parse(packageJson) as { scripts: Record<string, string> }).scripts

  it('deploy は main からだけ、check と同じ門を通ってから出る', () => {
    expect(deploy).toMatch(/if: github\.ref != 'refs\/heads\/main'/)
    expect(deploy).toContain('uses: ./.github/workflows/check.yml')
    expect(deploy).toMatch(/deploy:\s*\n\s*needs: check/)
    expect(uncommented(checkYml)).toMatch(/^\s*workflow_call:/m)
    // 並んで走らせない。途中の移行を取り消さない
    expect(deploy).toMatch(
      /concurrency:\s*\n\s*group: deploy-production\s*\n\s*cancel-in-progress: false/,
    )
    // id がプレースホルダのままなら、何を直すかを言って止まる
    expect(deploy).toContain('node scripts/check-ids.mjs')
  })

  it('移行はいつも流す（選択肢にしない）。流す前に本番の写しを残す', () => {
    expect(deploy).not.toMatch(/inputs\.migrate|migrate:\s*\n\s*description/)
    const exported = deploy.indexOf('wrangler d1 export astlog --remote')
    const bookmark = deploy.indexOf('wrangler d1 time-travel info astlog')
    const uploaded = deploy.indexOf('actions/upload-artifact')
    const migrated = deploy.indexOf('wrangler d1 migrations apply astlog --remote')
    const deployed = deploy.indexOf('npx wrangler deploy')
    for (const at of [exported, bookmark, uploaded, migrated, deployed])
      expect(at).toBeGreaterThan(-1)
    expect(Math.max(exported, bookmark)).toBeLessThan(uploaded)
    expect(deploy.indexOf('media-backup.mjs export')).toBeGreaterThan(exported)
    expect(deploy.indexOf('media-backup.mjs verify')).toBeLessThan(uploaded)
    const encrypted = deploy.indexOf('age --encrypt -R .github/backup-recipients.txt')
    expect(encrypted).toBeGreaterThan(deploy.indexOf('media-backup.mjs verify'))
    expect(encrypted).toBeLessThan(uploaded)
    expect(deploy).toContain('--schema')
    expect(deploy).toContain('--data')
    expect(uploaded).toBeLessThan(migrated)
    expect(migrated).toBeLessThan(deployed)
  })

  it('写しは戻せる形（定義と中身の2本）で取り、Time Travel より長く置く', () => {
    // 1本の export は、子の表の行が親の CREATE TABLE より前に来て空の D1 に戻せない
    expect(deploy).toMatch(/wrangler d1 export astlog --remote[^\n]*--no-data/)
    expect(deploy).toMatch(/wrangler d1 export astlog --remote[^\n]*--no-schema/)
    expect(deploy).not.toMatch(/wrangler d1 export astlog --remote(?![^\n]*--no-(?:data|schema))/)
    // 栞（Time Travel）は30日まで。控えがそれと同じ日に消えては、30日より前へ戻せない
    const days = Number(deploy.match(/retention-days: (\d+)/)?.[1])
    expect(days).toBeGreaterThan(30)
    // 戻せることは check の門が毎回確かめる
    expect(uncommented(checkYml)).toContain('npm run check:restore')
    expect(scripts['check:restore']).toBe('node scripts/check-restore.mjs')
  })

  /*
    このリポジトリは公開で、artifact は GitHub に入れる人なら誰でも落とせる。写しには
    下書き・削除した画像の控え・連絡先が入るので、age の公開鍵で暗号化した1ファイルだけを置く。
    公開鍵が無ければ、本番の写しを取る前（guard）に止まる。
  */
  it('artifact には暗号化した写しだけを置く', () => {
    const upload = deploy.slice(deploy.indexOf('actions/upload-artifact')).split(/\n(?= {6}- )/)[0]
    expect(upload).toMatch(/^\s*path: site-backup-\$\{\{ github\.sha \}\}\.tar\.age\s*$/m)
    expect(upload).not.toMatch(/path:\s*backup/)
    const guarded = deploy.indexOf('node scripts/check-backup-recipients.mjs')
    expect(guarded).toBeGreaterThan(-1)
    expect(guarded).toBeLessThan(deploy.search(/^ {2}deploy:/m))
    // 書くのは公開鍵（age1…）だけ。秘密鍵（AGE-SECRET-KEY-1…）の行はこの形に当たらず落ちる
    const keys = backupRecipients
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'))
    for (const key of keys) expect(key).toMatch(/^age1[qpzry9x8gf2tvdw0s3jn54khce6mua7l]{58}$/)
  })

  /*
    本番のトークンは、wrangler を呼ぶ step にだけ渡す。job の env に置くと、npm ci
    （依存の install スクリプト）や action からも読める。action はタグではなく
    commit の SHA で固定し、GITHUB_TOKEN は読むだけにする。
  */
  it('本番のトークンは wrangler を呼ぶ step にだけある。action は SHA で固定する', () => {
    const job = deploy.slice(deploy.search(/^ {2}deploy:/m))
    const [head = '', ...steps] = job.split(/\n(?= {6}- )/)
    const secret = /CLOUDFLARE_API_TOKEN: \$\{\{ secrets\.CLOUDFLARE_API_TOKEN \}\}/
    expect(head).not.toMatch(secret)
    expect(steps.length).toBeGreaterThan(5)
    for (const step of steps) {
      const usesWrangler = /npx wrangler (?:d1|deploy)|node scripts\/media-backup\.mjs/.test(step)
      const checksToken = /\$CLOUDFLARE_API_TOKEN/.test(step)
      expect(secret.test(step), step).toBe(usesWrangler || checksToken)
    }
    // トークンの無い install でも、install スクリプトは走らせない
    expect(job).toMatch(/run: npm ci --ignore-scripts/)
    // 秘密はここ（step の env）にしか書かない
    expect(deployYml.match(/secrets\.CLOUDFLARE_API_TOKEN/g)?.length).toBe(
      steps.filter((step) => secret.test(step)).length,
    )

    for (const yml of [deploy, uncommented(checkYml)]) {
      expect(yml).toMatch(/^permissions:\s*\n\s+contents: read\s*$/m)
      const uses = [...yml.matchAll(/uses: (\S+)/g)].map(([, target = '']) => target)
      expect(uses.length).toBeGreaterThan(1)
      for (const target of uses.filter((one) => !one.startsWith('./'))) {
        expect(target).toMatch(/^[\w-]+\/[\w-]+@[0-9a-f]{40}$/)
      }
    }
    // 固定した SHA には、どのタグかを行末に残す（上げるときに引き直す手がかり）
    for (const yml of [deployYml, checkYml]) {
      for (const line of yml.split('\n').filter((one) => /uses: [\w-]+\/[\w-]+@/.test(one))) {
        expect(line).toMatch(/@[0-9a-f]{40} # v\d+\.\d+\.\d+$/)
      }
    }
  })

  it('seed はローカル専用で、本番に流す入口はない', () => {
    for (const [name, command] of Object.entries(scripts)) {
      if (!/--file=\.\/seed\.sql/.test(command)) continue
      expect(command, name).toContain('--local')
    }
    expect(scripts['db:seed']).toBeUndefined()
    expect(Object.keys(scripts).filter((name) => name.startsWith('db:seed'))).toEqual([
      'db:seed:local',
    ])
    expect(scripts['db:seed:local']).toBe('node scripts/seed-local.mjs')
    // 本番に触れる入口は、どれも先に id の番兵を通る
    expect(scripts.deploy).toMatch(/^node scripts\/check-ids\.mjs && /)
    expect(scripts['db:migrate']).toMatch(/^node scripts\/check-ids\.mjs && /)
  })
})
