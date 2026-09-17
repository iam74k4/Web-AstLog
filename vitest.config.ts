import { readFile } from 'node:fs/promises'
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers'
import { defineConfig } from 'vitest/config'

// テストも本番と同じ Worker ランタイム（workerd）で動かす。
// Node で動かすと D1 も KV も偽物になり、確かめたいことが確かめられない。
const migrations = await readD1Migrations('./drizzle')

// 静的ファイルはテストでは配られない。見た目のプリセットが CSS 側にも
// あるかを確かめたいので、中身だけを渡す
const appCss = await readFile('./public/app.css', 'utf8')

export default defineConfig({
  plugins: [
    cloudflareTest({
      singleWorker: true,
      wrangler: { configPath: './wrangler.toml' },
      miniflare: {
        bindings: {
          // drizzle-kit が生成した SQL をそのままテスト用 D1 に流す
          TEST_MIGRATIONS: migrations,
          TEST_APP_CSS: appCss,
          SETUP_TOKEN: 'test-setup-token',
        },
      },
    }),
  ],
  test: {
    setupFiles: ['./test/setup.ts'],
  },
})
