import { readFileSync } from 'node:fs'
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers'
import type { Plugin } from 'vite'
import { defineConfig } from 'vitest/config'

// テストも本番と同じ Worker ランタイム（workerd）で動かす。
// Node で動かすと D1 も KV も偽物になり、確かめたいことが確かめられない。
const migrations = await readD1Migrations('./drizzle')

/*
  app.css をテストから読めるようにする。

  静的ファイル（public/）はテストでは配られず、CSS の import も workerd 側では
  中身が消える。そこで仮想モジュールにして渡す。

  読み込み時に1度だけ文字列にするのではなく load() の中で読むのは、watch の
  ためでもある。addWatchFile で依存に入れておけば、CSS だけを直したときにも
  読み直される（設定ファイルは読み直されないので、ここで固めると古いまま残る）。
*/
const APP_CSS = 'virtual:app-css'

const appCssPlugin = (): Plugin => ({
  name: 'noctifex:app-css',
  resolveId: (id) => (id === APP_CSS ? `\0${APP_CSS}` : null),
  load(id) {
    if (id !== `\0${APP_CSS}`) return null
    this.addWatchFile('./public/app.css')
    return `export default ${JSON.stringify(readFileSync('./public/app.css', 'utf8'))}`
  },
})

export default defineConfig({
  plugins: [
    appCssPlugin(),
    cloudflareTest({
      singleWorker: true,
      wrangler: { configPath: './wrangler.toml' },
      miniflare: {
        bindings: {
          // drizzle-kit が生成した SQL をそのままテスト用 D1 に流す
          TEST_MIGRATIONS: migrations,
          SETUP_TOKEN: 'test-setup-token',
        },
      },
    }),
  ],
  test: {
    setupFiles: ['./test/setup.ts'],
  },
})
