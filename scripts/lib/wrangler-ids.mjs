/*
  wrangler.toml の D1 と KV の id が、まだプレースホルダ（TO_BE_CREATED）かどうか。

  ローカル（wrangler dev・vitest）は id を見ないのでプレースホルダのままでも動き、
  `wrangler deploy --dry-run` も id を検証しないので check の「ビルド」は緑になる。
  ところが本番へ出す段（migrations apply --remote・deploy・d1 export）は API に
  拒まれ、しかもその失敗は「データベースが見つからない」としか言わない。
  本番に触れる入口（deploy ワークフロー・npm run deploy / db:migrate / seed）は、
  最初にここを通して、何を直せばいいかを言って止まる。

  id は秘密ではない（アカウントに入れなければ使えない）ので、wrangler.toml に
  書いてコミットする。手元にだけある toml から出すと、どの設定で本番が動いているか
  リポジトリから追えなくなる。
*/

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const TOML = fileURLToPath(new URL('../../wrangler.toml', import.meta.url))
const PLACEHOLDER = 'TO_BE_CREATED'

// 見つけた id の行ごとに [名前, 値]。行の形が変わって1つも読めなければ例外で止める
export function bindingIds(source = readFileSync(TOML, 'utf8')) {
  const ids = [...source.matchAll(/^\s*(database_id|id)\s*=\s*"([^"]*)"/gm)].map((found) => [
    found[1],
    found[2],
  ])
  if (!ids.some(([name]) => name === 'database_id') || !ids.some(([name]) => name === 'id')) {
    throw new Error('wrangler.toml の database_id と KV の id を読めなかった（書き方が変わった？）')
  }
  return ids
}

export function placeholderIds(source) {
  return bindingIds(source).filter(([, value]) => value === '' || value === PLACEHOLDER)
}

// 本番に触れる前に呼ぶ。プレースホルダが残っていれば、直し方を出して終了コード 1
export function requireRealIds() {
  const missing = placeholderIds()
  if (missing.length === 0) return
  console.error(
    [
      `wrangler.toml の ${missing.map(([name]) => name).join(' と ')} がまだ ${PLACEHOLDER} です。`,
      '本番の D1 と KV を作って、出力の id を wrangler.toml に書いてコミットしてください:',
      '  npx wrangler d1 create astlog          # database_id',
      '  npx wrangler kv namespace create MEDIA   # [[kv_namespaces]] の id',
      '（README の「本番に出す」）',
    ].join('\n'),
  )
  process.exit(1)
}
