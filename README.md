# Noctifex

つくったものを置いておく場所。Cloudflare Workers の上で、公開ページと管理画面を
1つの Worker が返す。

- 公開: `https://noctifex.dev`
- 管理: `https://noctifex.dev/admin`

## 構成

| 層 | 使うもの | なぜ |
| --- | --- | --- |
| 実行環境 | Cloudflare Workers | 常時起動のサーバーを持たずに済む |
| データ | D1（SQLite） | メンバーと Projects（個人開発 / 業務） |
| 画像 | KV | アバター。R2 が未有効なので当面こちら |
| 言語 | TypeScript | |
| ルーティング・描画 | Hono（JSX でサーバーサイドレンダリング） | クライアント側のフレームワークを持たない |
| DB | Drizzle ORM | スキーマは TypeScript が正、SQL は生成する |
| 書式・lint | Biome | `src/` `test/` `public/` `scripts/` を見る |
| テスト | Vitest（workerd 上で実行） | D1 も KV も本物で確かめる |
| 寸法の検査 | Playwright（`npm run check:fit`） | 「スクロールしない」を実際に測る |
| 可読性の検査 | Playwright（`npm run check:contrast`） | 入口の月の上で文字が読めるかを画素で測る |

ランタイム依存は Hono と Drizzle だけ。**公開ページに JavaScript は無い**
（読み込む `<script src>` は0本）。絞り込みもページめくりも URL とサーバーで
成立する。管理画面も HTML フォームと 303 リダイレクトだけで動く。

公開ページは1画面に1つぶんを収め、ページそのものはスクロールしない。入りきらない
ぶんは次の URL に送る。縦に伸びるのは全体ページ（`/all`）だけ。1画面 = 1ドキュメントで、
割られた画面はどれも `h1` をちょうど1つ持ち、題も説明文も canonical も画面ごとに違う。
機械に読ませる口として `/robots.txt` と `/sitemap.xml` があり、どちらも
（手で並べた表ではなく）公開ページと同じ式から数え上げている。

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
npm run typecheck # src/ と test/ の両方を見る
npm run lint      # 警告も落とす（--error-on-warnings）。直すなら npm run format
npm test          # workerd 上で D1・KV ごと動かす
npm run check:fit # 画面に収まっているか（ブラウザで実測）
npm run check:contrast # 入口の月の上で文字が読めるか（ブラウザで実測）
```

`check:fit` と `check:contrast` の2つだけは毛色が違う。`npm test` は workerd の中で動くので版面を組む
エンジンが居らず、このサイトの名前そのものである不変条件——**公開ページは
スクロールしない**——を1行も測れない。そこで `wrangler dev` を自分で立て、
3骨格 × 3ビューポート（390x844 / 768x1024 / 1440x900）× `/sitemap.xml` に載った
全 URL を Chromium で開き、ページの動きと節の弁の開きを測る。`/all` だけは
縦に伸びてよいので測らない。初回は実体のブラウザが要る。

`check:contrast` も同じ理由でブラウザが要る。入口と締め（Contact）の画面の背景には
粒子で焼いた三日月があり、いちばん明るい所は白、見出しも `#f2f2f4` なので、置き方を間違えると
白の上の白になる（実際そうなっていて、リード文が明るい縁に載って **1.00:1** ——
その字は背景と同じ明るさで、完全に消えていた）。4寸法 × 3骨格 × 6アクセント＝
72通りを画面ごとに描き、月の上に乗る字の行ボックスの下の画素を読んで WCAG 1.4.3 に
照らす。入口の月は着いたときに一度だけ降りてきて焦点が合うので、その途中の3コマも
同じ72通りで測る（入口 72 × 4姿 + 締め 72 × 1姿＝360通り）。あわせて**月が出ていること**も見る（三日月だけを消した絵との差分で、
描いている画素数と明るさに床を置く）。**文字を消した地だけを撮る**のが肝で、合成後の画面をそのまま読むと
グリフ自身を背景として数えてしまい、どの組も 1.00:1 になって検査が意味を失う。

```bash
npx playwright install chromium   # 一度だけ
FIT_BASE=http://localhost:8787 npm run check:fit        # 立てっぱなしの dev に向けて測る
CONTRAST_BASE=http://localhost:8787 npm run check:contrast
```

push すると GitHub Actions が同じものを走らせる（`check` と `fit` の2つの job）。

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

`items.slug`（作品の恒久リンク `/apps/item/<slug>`）だけは、マイグレーションでは
埋まらない。SQLite の `ALTER TABLE ADD COLUMN` は `NOT NULL` に定数の既定値を
要求し、その1つの値が既存行で重なって unique を張れないため、列は nullable で
入る。既にある作品は `slug` が `null` のまま——サイトは壊れず、カードの題が
リンクにならないだけ。管理画面から一度保存すれば埋まり、一覧には
「恒久リンクなし（保存すると付く）」と出る。

Actions の deploy ワークフロー（手動実行）でも同じことができる。使うなら
`CLOUDFLARE_API_TOKEN` をリポジトリの secret に入れる。

## 画面

どんな画面があり、どう行き来するかは `docs/` にまとめてある。

- [docs/screens.md](./docs/screens.md) — 画面一覧（URL・認証・出す条件・状態）
- [docs/flow.md](./docs/flow.md) — 画面遷移図

## どこに何があるか

```
src/
  index.tsx          入口。ルートを束ねて 404 / 500 を出す
  site.ts            サイト全体の文言と宛先（管理画面からは変えない）
  theme.ts           見た目のプリセット。選べる値はここが正
  blocks.ts          置けるブロックの種類と、1画面あたりの件数。ここが正
  env.ts             バインディングの型
  db/
    schema.ts        テーブル定義。ここが正
    queries.ts       公開ページが読む問い合わせと、構成・見た目の読み書き
  lib/
    auth.ts          パスワード・セッション・試行回数
    format.ts        テキストの解釈とフォーム値の受け取り
    paginate.ts      一覧を1画面ぶんずつに割る（chunk / screenCount）
    sequence.ts      画面の連なり。前後・目次・通し番号・canonical をここで組む
  routes/
    public.tsx       画面ごとの URL・/members/:slug の連なり・作品の恒久リンク
                     /all・/robots.txt・/sitemap.xml・/images/*
    admin.tsx        /admin/*
  ui/
    Layout.tsx       公開ページの外枠
    AdminLayout.tsx  管理画面の外枠
    components.tsx   画面を組む部品。main の直接の子は Screen / Hero だけが作る
    icons.tsx        インライン SVG
public/
  app.css            全画面のスタイル。値は :root のトークンだけで決める
                     骨格・色・書体のプリセットもここ（[data-layout] など）
                     末尾の「画面に収める外枠」が no-scroll を作る
  assets/            ロゴ・アバター・入口の月（moon.avif / moon.webp）
                     ※ ここに robots.txt や sitemap.xml を置かないこと。
                       public/ は Worker より先に配られるので、置くと
                       Worker が組み立てているほうが静かに届かなくなる
scripts/
  check-fit.mjs      npm run check:fit の中身。ブラウザで寸法を測る
  check-contrast.mjs npm run check:contrast の中身。月の上の文字を画素で測る
  moon/              入口の月。render.py が Blender で焼き、pack.py が配信用に詰める
                     配るのは無彩色の三日月だけ。光暈は app.css が --accent から描く
  lib/               上の2本の共通部分。dev サーバの立て方（dev-server.mjs）と
                     src/theme.ts の読み方（theme.mjs）。写しを2本持たない
drizzle/             生成されたマイグレーション（手で書かない）
test/                workerd 上で動くテスト
docs/                画面一覧と画面遷移図
seed.sql             移行前の index.html の内容
```

書き方の約束は `CLAUDE.md` に置いてある。
