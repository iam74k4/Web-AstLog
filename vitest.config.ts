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

/*
  public/ に置いた素材を、テストから中身として読む。

  workerd の中では public/ が配られない（実測で /assets/… は 404）。しかも
  404 のページ自身がロゴを描いているので、「素材を fetch して中身を見る」
  検査は**素通りで緑になる**——実際にそう書いて、通ってしまった。
  ファイルを読むのはここ（Node 側）しかない。
*/
const ASSET = 'virtual:asset:'

const assetPlugin = (): Plugin => ({
  name: 'noctifex:asset',
  resolveId: (id) => (id.startsWith(ASSET) ? `\0${id}` : null),
  load(id) {
    if (!id.startsWith(`\0${ASSET}`)) return null
    const file = `./public/assets/${id.slice(`\0${ASSET}`.length)}`
    this.addWatchFile(file)
    return `export default ${JSON.stringify(readFileSync(file, 'utf8'))}`
  },
})

export default defineConfig({
  plugins: [
    appCssPlugin(),
    assetPlugin(),
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
