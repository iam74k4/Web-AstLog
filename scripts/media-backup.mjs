// D1 の写しと組で使う画像の控え。復元は、復元先 D1 が参照する画像だけを公開キーへ戻す。
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { ROOT, WRANGLER, WRANGLER_ARGS } from './lib/dev-server.mjs'

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex')
const mediaKey = /^(?:avatars|items)\/[a-zA-Z0-9][a-zA-Z0-9._-]*$/
const referenceSql =
  'SELECT avatar_url AS url FROM members WHERE avatar_url IS NOT NULL UNION SELECT image_url FROM items WHERE image_url IS NOT NULL UNION SELECT icon_url FROM items WHERE icon_url IS NOT NULL UNION SELECT url FROM item_shots'

function run(args) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(WRANGLER, [...WRANGLER_ARGS, ...args], {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const out = [],
      err = []
    child.stdout.on('data', (chunk) => out.push(chunk))
    child.stderr.on('data', (chunk) => err.push(chunk))
    child.once('error', reject)
    child.once('close', (code) =>
      code === 0
        ? resolveRun(Buffer.concat(out))
        : reject(
            new Error(
              `wrangler ${args.slice(0, 3).join(' ')} failed: ${Buffer.concat(err).toString()}`,
            ),
          ),
    )
  })
}

export async function mediaBackup({ mode, directory, local = false, persistTo, snapshot }) {
  if (!['export', 'restore', 'verify'].includes(mode))
    throw new Error('export / restore / verify を指定してください')
  if (snapshot && mode !== 'verify')
    throw new Error('D1 の写しとの照合は verify で指定してください')
  const dir = resolve(directory)
  const location = [
    local ? '--local' : '--remote',
    ...(persistTo ? ['--persist-to', persistTo] : []),
  ]
  const binding = ['--binding', 'MEDIA', ...location]
  if (!local) await import('./check-ids.mjs')
  if (mode === 'export') {
    await mkdir(dir, { recursive: true, mode: 0o700 })
    const entries = []
    for (const prefix of ['avatars/', 'items/', 'archive/']) {
      const listed = JSON.parse(
        (await run(['kv', 'key', 'list', ...binding, '--prefix', prefix])).toString(),
      )
      for (const item of listed) {
        const original = item.name.replace(/^archive\//, '')
        if (!mediaKey.test(original)) continue
        const bytes = await run(['kv', 'key', 'get', item.name, ...binding])
        if (!bytes.length || bytes.equals(Buffer.from('Value not found\n')))
          throw new Error(`画像がありません: ${item.name}`)
        const file = `${sha(item.name)}.bin`
        await writeFile(join(dir, file), bytes, { mode: 0o600 })
        entries.push({
          key: item.name,
          file,
          sha256: sha(bytes),
          bytes: bytes.length,
          metadata: item.metadata ?? {},
        })
      }
    }
    await writeFile(
      join(dir, 'manifest.json'),
      JSON.stringify({ version: 1, createdAt: new Date().toISOString(), entries }, null, 2),
      { mode: 0o600 },
    )
    return entries.length
  }
  const manifest = JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8'))
  if (manifest.version !== 1 || !Array.isArray(manifest.entries))
    throw new Error('読めない画像の控えです')
  const files = new Map()
  for (const entry of manifest.entries) {
    if (
      !mediaKey.test(entry.key.replace(/^archive\//, '')) ||
      !/^[a-f0-9]{64}\.bin$/.test(entry.file) ||
      files.has(entry.key)
    )
      throw new Error('控えのキー・ファイル名が不正です')
    const bytes = await readFile(join(dir, entry.file))
    if (sha(bytes) !== entry.sha256 || bytes.length !== entry.bytes)
      throw new Error(`控えの画像が壊れています: ${entry.key}`)
    files.set(entry.key, entry)
  }
  let queries
  if (snapshot) {
    // 検証対象は書き換わり続ける本番ではなく、実際に取得した D1 の写し。
    const state = await mkdtemp(join(tmpdir(), 'astlog-media-snapshot-'))
    try {
      for (const file of [snapshot.schema, snapshot.data]) {
        await run([
          'd1',
          'execute',
          'astlog',
          '--local',
          '--persist-to',
          state,
          '--file',
          resolve(file),
        ])
      }
      queries = JSON.parse(
        (
          await run([
            'd1',
            'execute',
            'astlog',
            '--local',
            '--persist-to',
            state,
            '--json',
            '--command',
            referenceSql,
          ])
        ).toString(),
      )
    } finally {
      await rm(state, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 })
    }
  } else {
    queries = JSON.parse(
      (
        await run(['d1', 'execute', 'astlog', ...location, '--json', '--command', referenceSql])
      ).toString(),
    )
  }
  const wanted = [
    ...new Set(
      queries
        .flatMap((result) => result.results)
        .map((row) => String(row.url).replace(/^\/images\//, ''))
        .filter((key) => mediaKey.test(key)),
    ),
  ]
  // 1枚でも無ければ、何も書き込まずに止める。
  const selected = wanted.map((key) => {
    const entry = files.get(key) ?? files.get(`archive/${key}`)
    if (!entry) throw new Error(`D1 が参照する画像の控えがありません: ${key}`)
    return { key, entry }
  })
  if (mode === 'restore') {
    for (const { key, entry } of selected) {
      const metadata = { ...entry.metadata }
      delete metadata.archivedAt
      delete metadata.originalKey
      await run([
        'kv',
        'key',
        'put',
        key,
        '--path',
        join(dir, entry.file),
        ...binding,
        '--metadata',
        JSON.stringify(metadata),
      ])
    }
    // 復元した実体も検証する。控えだけを読んで成功にはしない。
    for (const { key, entry } of selected) {
      if (sha(await run(['kv', 'key', 'get', key, ...binding])) !== entry.sha256)
        throw new Error(`復元後の画像が一致しません: ${key}`)
    }
  }
  return selected.length
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2)
  const value = (name) => args[args.indexOf(name) + 1]
  if (args.includes('--schema') !== args.includes('--data'))
    throw new Error('--schema と --data は組で指定してください')
  if (!args.includes('--directory')) throw new Error('--directory が必要です')
  const count = await mediaBackup({
    mode: args[0],
    directory: value('--directory'),
    local: args.includes('--local'),
    persistTo: args.includes('--persist-to') ? value('--persist-to') : undefined,
    snapshot:
      args.includes('--schema') && args.includes('--data')
        ? { schema: value('--schema'), data: value('--data') }
        : undefined,
  })
  console.log(`✓ 画像 ${count} 件: ${args[0]}`)
}
