import { applyD1Migrations, env } from 'cloudflare:test'

// drizzle-kit が生成した SQL をテスト用の D1 に流す。
// スキーマを変えたら、テストは自動でその形になる（手で二重管理しない）
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS)
