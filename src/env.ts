import type { User } from './db/schema'

export type Env = {
  DB: D1Database
  // アバター画像と、ログイン試行回数。R2 が未有効なので画像も当面ここ
  MEDIA: KVNamespace
  // 最初の owner を作るときだけ使う。`wrangler secret put SETUP_TOKEN` で設定する
  SETUP_TOKEN?: string
}

export type AppEnv = {
  Bindings: Env
  Variables: {
    user: User
  }
}
