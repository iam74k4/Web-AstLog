import { readFileSync } from 'node:fs'
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers'
import type { Plugin } from 'vite'
import { defineConfig } from 'vitest/config'

// テストも本番と同じ Worker ランタイム（workerd）で動かす。
// Node で動かすと D1 も KV も偽物になり、確かめたいことが確かめられない。
const migrations = await readD1Migrations('./drizzle')

/*
  public/ の CSS（app.css・admin.css）を、中身の文字列として import できるようにする。
  読むのは2か所——src/ui/components.tsx の Stylesheets（中身から URL の版を作る）と、
  test/theme.test.ts（規則そのものを見る）。本番と wrangler dev では wrangler.toml の
  [[rules]]（Text）が同じ形で渡すので、ここはその写し。

  vite の既定のままだと .css の import は CSS として処理され、workerd 側では中身が
  消える。そこで vite の解決より先（enforce: 'pre'）に拾い、末尾が .css でない
  仮の id（… .js）に付け替える——.css のままだと vite の CSS の変換が、ここで作った
  JS を CSS として読み直す。

  読み込み時に1度だけ文字列にするのではなく load() の中で読むのは、watch の
  ためでもある。addWatchFile で依存に入れておけば、CSS だけを直したときにも
  読み直される（設定ファイルは読み直されないので、ここで固めると古いまま残る）。
*/
const CSS_TEXT = '\0noctifex-css:'
const CSS_FILES = new Set(['app.css', 'admin.css'])

const cssTextPlugin = (): Plugin => ({
  name: 'noctifex:css-text',
  enforce: 'pre',
  resolveId(id) {
    const name = id.match(/(?:^|\/)public\/([^/]+\.css)$/)?.[1]
    return name && CSS_FILES.has(name) ? `${CSS_TEXT}${name}.js` : null
  },
  load(id) {
    if (!id.startsWith(CSS_TEXT)) return null
    const file = `./public/${id.slice(CSS_TEXT.length, -'.js'.length)}`
    this.addWatchFile(file)
    return `export default ${JSON.stringify(readFileSync(file, 'utf8'))}`
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

/*
  リポジトリの設定ファイル（.github/workflows/*.yml・package.json）を、テストから
  中身として読む。本番へ出す道（門・順序・seed の名前）は YAML と package.json に
  しか無く、workerd の中からはファイルを読めない。読めるのはこの一覧だけ
  （テストが何でも読めるようにはしない）。
*/
const REPO = 'virtual:repo:'
const REPO_FILES = new Set([
  '.github/workflows/check.yml',
  '.github/workflows/deploy.yml',
  'package.json',
  'public/_headers',
  'scripts/touch-site.mjs',
  'seed.sql',
])

// 解決した id の末尾に .js を付ける。package.json のまま渡すと、vite の JSON の
// 変換が（ここで作った JS を）JSON として読み直して落ちる
const repoPlugin = (): Plugin => ({
  name: 'noctifex:repo',
  resolveId: (id) => (id.startsWith(REPO) ? `\0${id}.js` : null),
  load(id) {
    if (!id.startsWith(`\0${REPO}`) || !id.endsWith('.js')) return null
    const file = id.slice(`\0${REPO}`.length, -'.js'.length)
    if (!REPO_FILES.has(file)) throw new Error(`${file} は virtual:repo: の一覧に無い`)
    this.addWatchFile(`./${file}`)
    return `export default ${JSON.stringify(readFileSync(`./${file}`, 'utf8'))}`
  },
})

export default defineConfig({
  plugins: [
    cssTextPlugin(),
    assetPlugin(),
    repoPlugin(),
    cloudflareTest({
      singleWorker: true,
      wrangler: { configPath: './wrangler.toml' },
      miniflare: {
        bindings: {
          // drizzle-kit が生成した SQL をそのままテスト用 D1 に流す
          TEST_MIGRATIONS: migrations,
          /*
            OAuth の設定。本物のクライアントではなく、テストの中だけの値。
            wrangler.toml の [vars]（持ち主の本物の ID とアドレス）はここで上書きする
            ——テストが本物のアカウントを前提にしないように。外への fetch は
            test/oauth.test.ts が差し替えるので、この ID で提供元に届くことは無い
          */
          OWNER_GITHUB_ID: '1001',
          OWNER_GOOGLE_EMAIL: 'Owner@Example.test',
          GITHUB_CLIENT_ID: 'test-github-client',
          GITHUB_CLIENT_SECRET: 'test-github-secret',
          GOOGLE_CLIENT_ID: 'test-google-client.apps.googleusercontent.com',
          GOOGLE_CLIENT_SECRET: 'test-google-secret',
        },
        /*
          移行のテスト用の空の D1。本来の DB には setup.ts が全部の移行を当ててしまうので、
          「前の移行まで当てて行を入れ、そのあと新しい移行を当てる」はこちらでやる
          （test/oauth.test.ts の「移行」）
        */
        d1Databases: ['MIGRATION_DB'],
      },
    }),
  ],
  test: {
    setupFiles: ['./test/setup.ts'],
  },
})
