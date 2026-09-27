/*
  本番に触れる前の番兵。wrangler.toml の D1 / KV の id がプレースホルダのままなら、
  直し方を言って止まる（scripts/lib/wrangler-ids.mjs）。

  deploy ワークフローの最初の job と、npm run deploy / db:migrate /
  db:seed:remote:destroys-prod の頭で動く。
*/

import { requireRealIds } from './lib/wrangler-ids.mjs'

requireRealIds()
console.log('wrangler.toml の D1 と KV の id は設定されています')
