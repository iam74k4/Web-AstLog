/*
  公開ページの写しの版（KV の site:version）を上げる。

  版は管理画面の保存が上げる（src/lib/page-cache.ts の touchSiteOnWrite）。
  管理画面を通らずに D1 の中身を変えたとき——seed を流した・D1 を手で直した——は
  誰も上げないので、訪問者には写しの前の画面が最大1時間（FRESH_MS）出続ける。
  そのときにこれを流す。

    node scripts/touch-site.mjs --local    （npm run db:seed:local が最後に流す）
    node scripts/touch-site.mjs --remote   （npm run site:touch）

  ほかのデータセンターに届くまでは、さらに最大 60 秒ほど（KV の読みのキャッシュ）。
  鍵の名前は src/lib/page-cache.ts の SITE_VERSION_KEY と同じ（test/page-cache.test.ts が
  突き合わせている）。
*/

import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { requireRealIds } from './lib/wrangler-ids.mjs'

const KEY = 'site:version'

const where = process.argv[2]
if (where !== '--local' && where !== '--remote') {
  console.error('使い方: node scripts/touch-site.mjs --local | --remote')
  process.exit(2)
}
if (where === '--remote') requireRealIds()

const put = spawnSync(
  'npx',
  ['wrangler', 'kv', 'key', 'put', KEY, randomUUID(), '--binding', 'MEDIA', where],
  { stdio: 'inherit' },
)
process.exit(put.status ?? 1)
