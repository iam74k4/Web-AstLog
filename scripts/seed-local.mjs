/* seed はローカル専用。本番の内容は管理画面から登録する。 */
import { spawnSync } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { demoMediaFile } from './lib/demo-media.mjs'

if (process.argv.length > 2) {
  console.error('seed はローカル専用です。引数は指定できません。')
  process.exit(2)
}

const run = (args) => {
  const result = spawnSync('npx', ['wrangler', ...args], { stdio: 'inherit' })
  if (result.status !== 0) throw new Error(`ローカル seed が失敗しました (${result.status})`)
}
const directory = await mkdtemp(join(tmpdir(), 'astlog-seed-'))
try {
  run(['d1', 'execute', 'astlog', '--local', '--file=./seed.sql'])
  run(['kv', 'bulk', 'put', await demoMediaFile(directory), '--binding', 'MEDIA', '--local'])
  const touch = spawnSync(process.execPath, ['scripts/touch-site.mjs', '--local'], {
    stdio: 'inherit',
  })
  if (touch.status !== 0) throw new Error('ローカルの公開ページの版を更新できませんでした')
} finally {
  await rm(directory, { recursive: true, force: true })
}
