import type { D1Migration } from '@cloudflare/vitest-pool-workers/config'
import type { Env } from '../src/env'

declare module 'cloudflare:test' {
  interface ProvidedEnv extends Env {
    TEST_MIGRATIONS: D1Migration[]
  }
}

// app.css の中身。静的ファイルはテストでは配られないので、
// vitest.config.ts の仮想モジュールから受け取る
declare module 'virtual:app-css' {
  const css: string
  export default css
}
