# Noctifex

つくったものを置いておく場所。Cloudflare Workers の上で、公開ページと管理画面を
1つの Worker が返す。

- 公開: `https://noctifex.dev`
- 管理: `https://noctifex.dev/admin`

## 構成

| 層 | 使うもの | なぜ |
| --- | --- | --- |
| 実行環境 | Cloudflare Workers | 常時起動のサーバーを持たずに済む |
| データ | D1（SQLite） | メンバーと Apps / Works |
| 画像 | KV | アバター。R2 が未有効なので当面こちら |
| 言語 | TypeScript | |
| ルーティング・描画 | Hono（JSX でサーバーサイドレンダリング） | クライアント側のフレームワークを持たない |
| DB | Drizzle ORM | スキーマは TypeScript が正、SQL は生成する |
| 書式・lint | Biome | |
| テスト | Vitest（workerd 上で実行） | D1 も KV も本物で確かめる |

ランタイム依存は Hono と Drizzle だけ。JavaScript は公開ページの絞り込みにしか
使っていないので、切っても全件が読める。管理画面も HTML フォームと 303
リダイレクトだけで動く。

## 動かす

```bash
npm install
npm run db:migrate:local   # ローカル D1 にスキーマを作る
npm run db:seed:local      # 初期データを入れる
npm run dev                # http://localhost:8787
```

管理画面に入るには owner が要る。`.dev.vars` を作り、

```
SETUP_TOKEN=何か長い文字列
```

`/admin/setup` を開いて、その token とメールアドレス・パスワードを入れる。
owner が1件でもあれば、この入口は 404 になる。

## 確かめる

```bash
npm run typecheck
npm run lint      # 直すなら npm run format
npm test          # workerd 上で D1・KV ごと動かす
```

push すると GitHub Actions が同じものを走らせる。

## 本番に出す

最初の一度だけ、器を作る。

```bash
npx wrangler d1 create noctifex          # 出力の database_id を wrangler.toml へ
npx wrangler kv namespace create MEDIA   # 出力の id を wrangler.toml へ
npx wrangler secret put SETUP_TOKEN
```

以降は、

```bash
npm run db:migrate   # スキーマを変えたときだけ
npm run deploy
```

`npm run db:seed` は本番では最初の一度だけ。中の `DELETE` が全部消すので、
運用が始まったら流さないこと。

Actions の deploy ワークフロー（手動実行）でも同じことができる。使うなら
`CLOUDFLARE_API_TOKEN` をリポジトリの secret に入れる。

## どこに何があるか

```
src/
  index.tsx          入口。ルートを束ねて 404 / 500 を出す
  site.ts            サイト全体の文言と宛先（管理画面からは変えない）
  env.ts             バインディングの型
  db/
    schema.ts        テーブル定義。ここが正
    queries.ts       公開ページが読む問い合わせ
  lib/
    auth.ts          パスワード・セッション・試行回数
    format.ts        テキストの解釈とフォーム値の受け取り
  routes/
    public.tsx       / と /members/:slug と /images/*
    admin.tsx        /admin/*
  ui/
    Layout.tsx       公開ページの外枠
    AdminLayout.tsx  管理画面の外枠
    components.tsx   画面を組む部品
    icons.tsx        インライン SVG
public/
  app.css            全画面のスタイル。値は :root のトークンだけで決める
  filter.js          Apps / Works の絞り込み
  assets/            ロゴとアバター
drizzle/             生成されたマイグレーション（手で書かない）
test/                workerd 上で動くテスト
seed.sql             移行前の index.html の内容
```

書き方の約束は `CLAUDE.md` に置いてある。
