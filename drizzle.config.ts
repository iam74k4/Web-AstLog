import { defineConfig } from 'drizzle-kit'

// スキーマは src/db/schema.ts が正。ここから drizzle/ に SQL を生成し、
// それを wrangler d1 migrations apply が適用する。SQL を手で書き足さないこと。
export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'sqlite',
})
