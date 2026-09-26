/*
  本番の D1 に seed.sql を流す。**空の D1 に一度きり**のためのもの。

  seed.sql は作品・メンバー・構成を全部消してから入れ直す。以前は
  `npm run db:seed` がそのまま --remote で流していて、ふだん打つ
  `npm run db:seed:local` の `:local` を付け忘れた1語が、本番の全消去になった。
  いまは名前を長く危険だと分かるもの（db:seed:remote:destroys-prod）にして、
  流す前に本番の件数を数え、作品・メンバー・構成のどれかが1行でもあれば止める。
  空でないなら、それはもう運用が始まっている D1 で、seed の出番ではない。

  消してしまったときの戻し方は README の「本番に出す」（D1 の Time Travel）。
*/

import { spawnSync } from 'node:child_process'
import { requireRealIds } from './lib/wrangler-ids.mjs'

requireRealIds()

const TABLES = ['items', 'members', 'blocks']

const wrangler = (args, capture) =>
  spawnSync('npx', ['wrangler', ...args], {
    encoding: 'utf8',
    stdio: capture ? ['inherit', 'pipe', 'inherit'] : 'inherit',
  })

const count = wrangler(
  [
    'd1',
    'execute',
    'noctifex',
    '--remote',
    '--json',
    '--command',
    `SELECT ${TABLES.map((table) => `(SELECT count(*) FROM ${table}) AS ${table}`).join(', ')}`,
  ],
  true,
)
if (count.status !== 0) {
  console.error('本番の件数を数えられなかったので止めました（先に npm run db:migrate を流す？）')
  process.exit(1)
}

let row
try {
  row = JSON.parse(count.stdout)?.[0]?.results?.[0]
} catch {
  row = undefined
}
if (!row) {
  console.error(`本番の件数を読めなかったので止めました:\n${count.stdout}`)
  process.exit(1)
}

const filled = TABLES.filter((table) => Number(row[table]) !== 0)
if (filled.length > 0) {
  console.error(
    [
      `本番の D1 には既に中身があります（${filled.map((table) => `${table} ${row[table]} 行`).join('・')}）。`,
      'seed.sql はこれを全部消してから入れ直すので、流さずに止めました。',
      '中身を変えたいなら管理画面から。どうしても入れ直すなら、先に',
      '  npx wrangler d1 export noctifex --remote --no-data --output=schema.sql',
      '  npx wrangler d1 export noctifex --remote --no-schema --output=data.sql',
      'で写しを取り（戻せる形は定義と中身の2本。README の「戻す」）、テーブルを手で空にしてから、もう一度このコマンドを流してください。',
    ].join('\n'),
  )
  process.exit(1)
}

const seed = wrangler(['d1', 'execute', 'noctifex', '--remote', '--file=./seed.sql'], false)
if (seed.status !== 0) process.exit(seed.status ?? 1)

// 管理画面を通らない書き換えなので、公開ページの写しの版を自分で上げる
// （上げないと、seed の前に置かれた「まだ何も置いていません」の写しが出続ける）
const touched = spawnSync('node', ['scripts/touch-site.mjs', '--remote'], { stdio: 'inherit' })
process.exit(touched.status ?? 1)
