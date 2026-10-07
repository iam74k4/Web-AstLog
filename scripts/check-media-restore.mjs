// D1 が参照する削除済み画像を、控えから元の公開キーへ戻して bytes まで照合する。
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { ROOT, scratchState, WRANGLER, WRANGLER_ARGS } from './lib/dev-server.mjs'
import { mediaBackup } from './media-backup.mjs'

const execute = promisify(execFile)
const temp = await mkdtemp(join(tmpdir(), 'astlog-media-restore-'))
const source = await scratchState('media-source', [await readFile(join(ROOT, 'seed.sql'), 'utf8')])
const target = await scratchState('media-target', [await readFile(join(ROOT, 'seed.sql'), 'utf8')])
const run = async (args, cwd = ROOT) =>
  (
    await execute(WRANGLER, [...WRANGLER_ARGS, ...args], {
      cwd,
      encoding: 'buffer',
      maxBuffer: 32 * 1024 * 1024,
    })
  ).stdout
const kv = (state, ...args) =>
  run(['kv', 'key', ...args, '--binding', 'MEDIA', '--local', '--persist-to', state.dir])
const directory = join(temp, 'media')
try {
  // デモ画像とは異なるバイナリ。テキストとして読み直すと壊れることも検査する。
  const bytes = Buffer.from([0, 255, 10, 128, 9, 0, 240, 159, 140, 145])
  const file = join(temp, 'deleted.bin')
  await writeFile(file, bytes)
  await kv(
    source,
    'put',
    'archive/items/deleted.png',
    '--path',
    file,
    '--metadata',
    JSON.stringify({
      contentType: 'image/png',
      originalKey: 'items/deleted.png',
      archivedAt: new Date().toISOString(),
    }),
    '--ttl',
    '7776000',
  )
  const refs = "UPDATE items SET image_url='/images/items/deleted.png' WHERE id=1"
  for (const state of [source, target])
    await run(['d1', 'execute', 'astlog', '--local', '--persist-to', state.dir, '--command', refs])
  // d1 export には --persist-to が無いため、検査元を一時 cwd の既定の場所へ写す。
  await cp(join(ROOT, 'wrangler.toml'), join(temp, 'wrangler.toml'))
  await cp(source.dir, join(temp, '.wrangler', 'state'), { recursive: true })
  const snapshot = { schema: join(temp, 'schema.sql'), data: join(temp, 'data.sql') }
  await run(['d1', 'export', 'astlog', '--local', '--no-data', '--output', snapshot.schema], temp)
  await run(['d1', 'export', 'astlog', '--local', '--no-schema', '--output', snapshot.data], temp)
  assert.ok(
    (await mediaBackup({ mode: 'export', local: true, persistTo: source.dir, directory })) > 0,
  )
  const expected = await mediaBackup({ mode: 'verify', local: true, directory, snapshot })
  assert.ok(expected > 0)
  const restored = await mediaBackup({
    mode: 'restore',
    local: true,
    persistTo: target.dir,
    directory,
  })
  assert.equal(restored, expected)
  assert.deepEqual(await kv(target, 'get', 'items/deleted.png'), bytes)
  const keys = JSON.parse((await kv(target, 'list', '--prefix', 'items/deleted.png')).toString())
  assert.equal(keys[0].metadata.contentType, 'image/png')
  assert.equal(keys[0].expiration, undefined)
  // SHA が違う控えは、書き込み前に拒否する。
  const manifest = JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8'))
  const archived = manifest.entries.find((entry) => entry.key === 'archive/items/deleted.png')
  await writeFile(join(directory, archived.file), Buffer.from('corrupt'))
  await assert.rejects(
    mediaBackup({ mode: 'restore', local: true, persistTo: target.dir, directory }),
    /壊れています/,
  )
  assert.deepEqual(await kv(target, 'get', 'items/deleted.png'), bytes)
  console.log(
    `✓ 画像の控え: ${restored} 件を復元・SHA-256 一致。削除画像・メタデータ・破損拒否・取得済み D1 との照合を確認`,
  )
} finally {
  await source.cleanup()
  await target.cleanup()
  await rm(temp, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 })
}
