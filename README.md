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
| 画像 | KV | アバター（`avatars/`）と作品のスクリーンショット（`items/`）だけ。R2 が未有効なので当面こちら。受けるのは中身で確かめた PNG・JPEG・WebP・AVIF・GIF だけ |
| 管理画面のログイン | GitHub / Google の OAuth | パスワードを持たない。本人は提供元の ID で照合する |
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

公開中のメンバーが1人のあいだは、サイトはその人として名乗る。Team の画面の代わりに
その人のプロフィール（`/members/<slug>` と About / Skills / Career）がサイトの連なりに
入り、目次では「Profile」の1行になる。柱は入口（Hero が名乗る）以外のどの画面でも
名前と職種を出す。2人目を公開すると Team と器の名乗りに戻る（決まりは `CLAUDE.md`）。

## 動かす

```bash
npm install
npm run db:migrate:local   # ローカル D1 にスキーマを作る
npm run db:seed:local      # 初期データを入れる
npm run dev                # http://localhost:8787
```

管理画面（`http://localhost:8787/admin`）に入るには、GitHub か Google の
OAuth クライアントが要る。作り方と `.dev.vars` の書き方は下の「管理画面に入る」。

## 管理画面に入る

ログインは GitHub か Google の OAuth だけ（パスワードは無い）。owner として
最初に紐づくのは、`wrangler.toml` の `[vars]` に書いたアカウントだけ。

- `OWNER_GITHUB_ID` — GitHub の**数値の**ユーザー id（ログイン名ではない。
  `https://api.github.com/users/<ログイン名>` の `id`）。いまは `118629892`
- `OWNER_GOOGLE_EMAIL` — Google アカウントのメールアドレス（Google が確認済みの
  もの。大小は無視する）。いまはサイトに出しているアドレス `iam74k4@gmail.com` を
  入れてある。**別の Google アカウントで入るなら、ここを書き換える**

そのアカウントで一度ログインすると D1 の `user_identities` に紐づき、以後は
提供元の ID（GitHub の id / Google の sub）で照合する。ログイン名やアドレスを
変えても入れる。どちらにも当たらないアカウントは「このアカウントでは入れません」
（403）になり、その画面にそのアカウント自身の ID が出る——設定を間違えたときは、
それを `[vars]` に写せばよい。

### OAuth のクライアントを作る

GitHub（OAuth App。コールバック URL を1つしか持てないので、本番用と開発用の2つを作る）

1. GitHub の Settings → Developer settings → OAuth Apps → New OAuth App
2. 本番用: Homepage URL `https://noctifex.dev`、Authorization callback URL
   `https://noctifex.dev/admin/auth/github/callback`
3. 開発用: Homepage URL `http://localhost:8787`、Authorization callback URL
   `http://localhost:8787/admin/auth/github/callback`
4. それぞれの Client ID と、Generate a new client secret で出るシークレットを控える。
   スコープは頼まない（公開プロフィールの id だけを見る）

Google（ウェブ アプリケーションの OAuth クライアントを1つ）

1. Google Cloud Console の「API とサービス」→ OAuth 同意画面を作る。スコープは
   `openid` と `email` だけ。公開前（テスト中）のままなら、テストユーザーに自分を足す
2. 「認証情報」→「認証情報を作成」→「OAuth クライアント ID」→ 種類は
   「ウェブ アプリケーション」
3. 承認済みのリダイレクト URI に2つ足す:
   `https://noctifex.dev/admin/auth/google/callback` と
   `http://localhost:8787/admin/auth/google/callback`

開発では `.dev.vars`（コミットしない）に、開発用の値を書く。

```
GITHUB_CLIENT_ID=開発用 OAuth App の Client ID
GITHUB_CLIENT_SECRET=開発用 OAuth App のシークレット
GOOGLE_CLIENT_ID=….apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=…
OAUTH_REDIRECT_ORIGIN=http://localhost:8787
```

`OAUTH_REDIRECT_ORIGIN` は開発でだけ要る。`wrangler.toml` に `routes`（noctifex.dev）が
あると、`wrangler dev` は Worker に見せる URL を `http://noctifex.dev/…` に書き換える
ので、リクエストから組んだコールバックが登録したもの（`http://localhost:8787/…`）と
食い違う。本番では入れない（リクエストの origin＝`https://noctifex.dev` を使う）。

本番では同じ4つを secret で入れる（GitHub は本番用の OAuth App の値）。

```bash
npx wrangler secret put GITHUB_CLIENT_ID
npx wrangler secret put GITHUB_CLIENT_SECRET
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
```

片方の提供元だけでもよい。ログイン画面には、ID とシークレットがそろった提供元だけが出る。

### 紐づけを外す・端末を締め出す

紐づいたアカウントは、`[vars]` を書き換えても外れない（ID で照合しているため）。
外すときは D1 の行を消す。

```bash
npx wrangler d1 execute noctifex --remote --command "DELETE FROM user_identities WHERE provider = 'github'"
```

端末を失くした・共用の端末でログアウトし忘れたときは、管理画面の「アカウント」
（左ナビの足元の名前）→「すべての端末からログアウト」。管理画面に入れないときは、

```bash
npx wrangler d1 execute noctifex --remote --command "DELETE FROM sessions"
```

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
3骨格 × 3ビューポート（390x844 / 768x1024 / 1440x900。電話と板の2つは指＝
`pointer: coarse` で）× `/sitemap.xml` に載った全 URL を Chromium で開き、ページの
動きと節の弁の開き、それに**見出しの錨**（めくっても節の見出しが同じ高さに居るか）を
測る。`/all` だけは縦に伸びてよいので測らない。初回は実体のブラウザが要る。

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
```

OAuth のクライアントの secret も入れる（上の「管理画面に入る」）。

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
入る。既にある作品は `slug` が `null` のまま——サイトは壊れず、そのカードが
押せる面にならない（題は素の字のまま、ホバーでも浮かない）うえ、作品同士を
めくる列にも入らないだけ。管理画面から一度保存すれば埋まり、一覧には
「恒久リンクなし（保存すると付く）」と出る。

`items.body`（作品の本文）・`items.image_url`（スクリーンショット）・`items.image_alt`
（その代替テキスト）はマイグレーションで入り、既にある作品は本文と代替テキストが
空、画像は無しのまま——作品のページに `figure` も本文の画面（`…/story`）も無く、
カードにサムネイルも出ないだけ。`seed.sql` も書かない（本人の作品の中身を作り話で
埋めない）。管理画面の作品のフォームから書く。本文を書いた作品は、作品のページの
1枚目の次に本文だけの画面（`/apps/item/<slug>/story`。300 字・3段落まで）を持つ。
画像は KV の `items/` に置かれ、`/images/items/…` から出る。画像を公開するときは
代替テキストが要る。

seed に本文が無いので、seed のままの `check:fit` は本文の画面を1枚も測らない
（URL は 17 のまま）。本文の画面に触れたら、本文を書いた作品を置いてから測ること
（本文のある作品の数だけ URL が増える）。

`items.image_width` / `image_height`（画像の寸法。共有カードの `og:image:width` /
`height` と `twitter:card` の大きさにだけ使う）は `0008_item_image_size` で入る。
既にある画像は寸法が `null` のまま——作品のページの共有カードは寸法を名乗らず、
小さい札（`summary`）になるだけ。画像を選び直して保存すれば読み取って入る。

`0009_one_fixed_block` 〜 `0010_permalinks_and_order` で入るもの。どれも既にある行を
壊さない。

- 決まった中身のブロック（hero / projects / team / contact）が二重送信で2行に
  なっていたら、0009 が種類ごとに1行へ畳む（公開中の行を先に、並びの先頭を残す）。
  そのあと 0010 が「1つだけ」の部分一意索引 `blocks_fixed_once` を張る。重複を
  残したまま索引を張ると移行ごと止まるので、この順は崩さないこと
- `items.year_from`（並べるための年）は year から DB が作る列（生成列・VIRTUAL）で、
  既にある作品にもそのまま効く。埋め直しの移行は要らない。頭が数字4桁でない年の
  作品は、一覧の最後に回る（管理画面が「並びに使われません」と知らせる）
- `item_slug_redirects` / `member_slug_redirects`（前の slug の転送表）は空で入る。
  管理画面で slug を変えた日から、前の URL がいまの URL へ 301 で寄る
- `form_key`（追加のフォームの一度きりの札。members・items・blocks）は既にある行では
  `null` のまま（札を持たない行は何行でも入る）

受け取る画像は中身の先頭のバイトで決めた PNG・JPEG・WebP・AVIF・GIF だけで、
SVG と HEIC は弾く。この検査より前に上げた SVG / HEIC が KV に残っていても、
`/images/*` は画像としてではなく添付（`application/octet-stream`）で返すので、
そのアバター・作品の画像は壊れて見える。管理画面から画像を選び直せば直る
（前の画像はそのとき KV から消える）。

パスワードのログインから OAuth へ移す移行（`0006_oauth_identities` と
`0007_hash_sessions`）を当てると、`users` からメールアドレスとパスワードの
ハッシュが外れ、ログイン中のセッションは全部消える（セッションの id を D1 には
ハッシュで置くようになったため）。owner の行は id もメンバーとの紐づけもそのまま
残り、`[vars]` と一致するアカウントで最初にログインしたときに、その行へ紐づく。
前に入れた `SETUP_TOKEN` はもう使わないので `npx wrangler secret delete SETUP_TOKEN`
で消してよい。

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
                     個人ページを画面に割る単位（memberUnits / memberScreenCount）も
  env.ts             バインディングの型
  db/
    schema.ts        テーブル定義。ここが正
    queries.ts       公開ページが読む問い合わせと、構成・見た目の読み書き
  lib/
    auth.ts          セッション（D1 にはハッシュで置く）と、通してよいアカウントの判定
    oauth.ts         GitHub / Google との約束（認可 URL・トークンの交換・id_token の検査）
    format.ts        テキストの解釈とフォーム値の受け取り
    paginate.ts      一覧を1画面ぶんずつに割る（chunk / screenCount）
    sequence.ts      画面の連なり。前後・目次・通し番号・canonical をここで組む
                     目次のまとめ単位（tocKey）は節（navKey）より大きくてよい
                     ページャが数える単位（countKey）は画面より大きくてよい
  routes/
    public.tsx       画面ごとの URL・/members/:slug の連なり・作品の恒久リンクと本文の画面
                     /all・/robots.txt・/sitemap.xml・/images/*
    admin.tsx        /admin/*
  ui/
    Layout.tsx       公開ページの外枠
    AdminLayout.tsx  管理画面の外枠
    components.tsx   画面を組む部品。main の直接の子は Screen / Hero だけが作る
                     外枠はどれも HtmlDocument で <html> を開く（DOCTYPE を出す）
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
