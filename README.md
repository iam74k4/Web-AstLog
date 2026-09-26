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
| 画像 | KV | アバター（`avatars/`）と作品のスクリーンショット（`items/`）だけ。R2 が未有効なので当面こちら。受けるのは中身で確かめた PNG・JPEG・WebP・AVIF・GIF だけ。ほかに写しの版の1行（`site:version`）が同居している |
| 公開ページの写し | Cache API ＋ KV の版 | 訪問者の画面は D1 に聞かずに返し、D1 が落ちても前の写しを出す（下の「公開ページの写し」） |
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
全部の応答に CSP（`script-src 'none'`・`frame-ancestors 'none'` ほか）と
`X-Content-Type-Options: nosniff`・`Referrer-Policy: strict-origin-when-cross-origin`
を付けるので、この「0本」はブラウザが守る。管理画面は `Cache-Control: no-store`。
付けているのは `src/index.tsx` のミドルウェアと、Worker を通らない `public/` の
ファイルには `public/_headers`（決まりは `CLAUDE.md` の「応答のヘッダ」）。

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
npm run db:migrate:local   # ローカル D1 にスキーマと選択肢（platforms）を作る
npm run db:seed:local      # 初期データを入れる（ローカルの中身を全部入れ直す）
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
変えても入れる。`[vars]` の値が効くのは**値ごとに1度だけ**で、使った値は D1 の
`owner_claims` に残る（同じ確認済みアドレスを持つ別の Google アカウントも、外したあとの
同じアカウントも、その値ではもう紐づかない）。どちらにも当たらないアカウントは「このアカウントでは入れません」
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
外すときは D1 の行を消す。`[vars]` がそのままでも、同じアカウントで入り直して紐づき
直ることは無い（その値はもう使ってある。`owner_claims`）。

```bash
npx wrangler d1 execute noctifex --remote --command "DELETE FROM user_identities WHERE provider = 'github'"
npx wrangler d1 execute noctifex --remote --command "DELETE FROM sessions"
```

外したアカウントを**また使う**ときは、使った記録の行も消してから、そのアカウントで
ログインする（`[vars]` の値がそのアカウントのものであること）。

```bash
npx wrangler d1 execute noctifex --remote --command "DELETE FROM owner_claims WHERE provider = 'github'"
```

別のアカウントに替えるなら、`[vars]` をそのアカウントの値に書き換えてデプロイする
（新しい値として1度だけ効く）。

ログインの入口（`/admin/auth/<提供元>/start`）は、同じ IP から 60 秒に 10 回まで
（`wrangler.toml` の `[[ratelimits]]`。作っておくものは無い）。超えると 1 分ほど 429 になる。

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
npm run check:restore  # deploy が残す D1 の写しを、空の D1 に戻せるか
```

`check:fit` と `check:contrast` の2つだけは毛色が違う。`npm test` は workerd の中で動くので版面を組む
エンジンが居らず、このサイトの名前そのものである不変条件——**公開ページは
スクロールしない**——を1行も測れない。そこで `wrangler dev` を自分で立て、
3骨格 × 3書体 × 3ビューポート（390x844 / 768x1024 / 1440x900。電話と板の2つは指＝
`pointer: coarse` で）× 訪問者とログインした姿（柱に「管理画面」が出る）×
`/sitemap.xml` に載った全 URL を Chromium で開いて測る。`/all` だけは縦に伸びてよいので
画面に収まるかは測らない（横に動かないことだけを 3骨格 × 3書体 × 3寸法で測る）。
初回は実体のブラウザが要る（Node は 22.18 以降。上限の数を `src/blocks.ts` から
そのまま読むのに、Node の型の読み飛ばしを使う）。

測るのは箱の位置そのもの——外枠（`.shell`）が画面の高さちょうどか、`main` と柱の
見えている要素が画面の下端より下に出ていないか（`overflow: clip` で黙って切られて
いないか）、節の弁が開いていないか、`html` / `body` が `clip`・節が `auto` に解けて
いるか、柱が骨格どおりの場所（左か上）に居るか、**見出しの錨**（めくっても節の
見出しが同じ高さに居るか）。あわせて、ページャの手が1行（`--tap` の高さ）に収まるか、
中央寄せの Hero の子が同じ軸に立つか、**目次の印**（いまの画面の行き先）が帯の見えて
いる幅の中にあるか——帯の最初の位置は読み込んだときに決まるので、ここだけは骨格ごとに
開き直して測る。

中身は4つで、どれも使い捨ての D1 に入れて測る（手元の D1 には触らない。migrate や
seed を先に流さなくてよい）。

| 中身 | 何か | URL |
|---|---|---|
| seed | `seed.sql`。本人のサイトそのもの | 17 |
| seed＋ブロック3本 | seed に既定の見出しのブロックを3本（いま・数字・リンク集。`fit-fixture.mjs` の `seedBlocks`）。目次の帯が溢れる、ふつうの姿 | 20 |
| fixture（複数人） | `scripts/lib/fit-fixture.mjs` が `src/blocks.ts` の上限から作る、上限ちょうどのサイト。打ち込むブロック6種を均等に割った形と1つに寄せた形で・6人の Team・長い肩書き・上限の大見出し / 紹介文 / 経歴・いちばん重いカードの行・実績値の無い軽い行・本文の画面・上限の作品名 | 44 |
| fixture（1人） | 同じ中身で公開中のメンバーを1人にしたもの（Team の位置にプロフィール・柱が名前と長い職種で名乗る。軽い行は電話でも説明が5行） | 31 |

成功行は中身ごとに1行出る。

```
✓ seed（1人のサイト）: 918 通り（17 URL × 3骨格 × 3書体 × 3寸法 × 2姿）。ページが動いた画面 0・
  切られた要素 0・弁が開いた節 0。いちばん惜しい節の余り 29.3px（…）。見出しの錨のずれ 最大 0px。
  目次の印 128 画面が帯の中（うち 0 画面は送って開いた）。/all は 27 通りとも横に動かない
```

読むのは3つ。**URL の数**（上の表より減っていたら、測れていない。検査は seed が 17 本
より少ないとき・fixture から生えるはずの画面が1本でも欠けたときに自分で止まる）、
**いちばん惜しい節の余り**（どこがいちばん窮屈か。数 px なら次の変更で溢れる）、
**見出しの錨のずれ**（1px を超えたら落ちる）。「目次の印 N 画面が帯の中（うち M 画面は送って
開いた）」の M が 0 の中身は、帯が溢れていない（seed）。

測り方は箱の位置そのもので、`scrollHeight` には頼らない。`html` / `body` は `overflow: clip` なので、
外枠が外れて中身が画面の下で切られても `scrollHeight` は伸びないことがあり、前の測り方はそれを
0px と報告した。fixture の中身が上限ちょうどでない（超える・足りない）と、作る時点で公開の関門
（`publishErrors`）に照らして止まる。上限を変えれば fixture も新しい数で作られる。

`check:contrast` も同じ理由でブラウザが要る。入口と締め（Contact）の画面の背景には
点で焼いた三日月があり、いちばん明るい所は白、見出しも `#f2f2f4` なので、置き方を間違えると
白の上の白になる（実際そうなっていて、リード文が明るい縁に載って **1.00:1** ——
その字は背景と同じ明るさで、完全に消えていた）。4寸法（電話と板は指で）× 3骨格 × 6アクセント＝
72通りを画面ごとに描き、月の上に乗る字の行ボックスの下の画素を読んで WCAG 1.4.3 に
照らす。入口の月は着いたときに一度だけ降りてきて焦点が合うので、その途中の3コマも
同じ72通りで測る（入口 72 × 4姿 + 締め 72 × 1姿＝360通り）。あわせて**月が出ていること**も見る（三日月だけを消した絵との差分で、
描いている画素数と明るさに床を置く）。**文字を消した地だけを撮る**のが肝で、合成後の画面をそのまま読むと
グリフ自身を背景として数えてしまい、どの組も 1.00:1 になって検査が意味を失う。

```bash
npx playwright install chromium   # 一度だけ
FIT_ONLY=many,solo npm run check:fit                     # 中身を絞って測る（seed / blocks / many / solo）
FIT_BASE=http://localhost:8787 npm run check:fit        # 立てっぱなしの dev に向けて測る（その D1 のまま・訪問者の姿だけ）
CONTRAST_BASE=http://localhost:8787 npm run check:contrast
```

`check:contrast` は手元の D1（`--local` の既定の置き場）をそのまま読むので、新しい
ワークツリーでは `npm run db:migrate:local` と `npm run db:seed:local` を先に通すこと。

2つとも `wrangler dev` を自分で立てる（ポートは `FIT_PORT` / `CONTRAST_PORT`。既定は
8788 / 8789）。**そのポートを誰かが使っていたら、立てずに止まる**。wrangler は
「Address already in use」ですぐ終わるのに、待つ側がそのポートの別のサーバ（別の
ワークツリーの dev や検査）の返事を受け、相手の画面を測って緑を出していたため。
いくつものワークツリーで並べて回すときは、ポートを分けること。準備ができる前に
wrangler が終わったときも同じく止まる（`scripts/lib/dev-server.mjs`）。

`check:restore` は、deploy が本番の D1 から取る写しと同じ形（定義と中身の2本）を、
使い捨ての D1（seed と check:fit の fixture と、ログインまわり・転送表の行を入れたもの）
から取り、別の空の D1 に下の「戻す」の順で流して、全部の表の全部の行・表と索引の定義・
当たった移行の記録が元と同じかを突き合わせる。手元の D1 には触らない。

push すると GitHub Actions が同じものを走らせる（`check` と `fit` の2つの job。
`check:restore` は `check` の job で）。

## 本番に出す

最初の一度だけ、器を作る。

```bash
npx wrangler d1 create noctifex          # 出力の database_id を wrangler.toml へ
npx wrangler kv namespace create MEDIA   # 出力の id を wrangler.toml へ
```

2つの id は秘密ではないので、`wrangler.toml` に書いて**コミットする**。
`TO_BE_CREATED` のままだと、本番に触れる入口（deploy ワークフロー・`npm run deploy`・
`npm run db:migrate`・本番の seed）は `scripts/check-ids.mjs` が直し方を言って止める
（`npm run check:ids` で先に確かめられる）。check の「ビルド」（`wrangler deploy --dry-run`）
は id を見ないので、プレースホルダでも緑のまま。

OAuth のクライアントの secret も入れる（上の「管理画面に入る」）。

空の D1 に、スキーマと最初の中身を入れる（一度きり）。

```bash
npm run db:migrate                       # スキーマとプラットフォームの選択肢
npm run db:seed:remote:destroys-prod     # 移行前の index.html の中身
```

`seed.sql` は作品・メンバー・構成を**全部消してから**入れ直す。本番向けの名前が長いのは
わざとで、中身の `scripts/seed-remote.mjs` は本番の件数を数え、作品・メンバー・構成の
どれかが1行でもあれば流さずに止まる。運用が始まった D1 に seed の出番は無い
（中身は管理画面から変える）。ローカルは `npm run db:seed:local`。

### 出す

ふだんは Actions の **deploy** ワークフロー（手動実行）から出す。やることは決まっていて、
選ぶものは無い。

1. main から実行しているか、`wrangler.toml` の id が入っているかを見る（違えば止まる。
   ただし main だけを通す守りは、下の environment の設定のほう）
2. check と同じ門を通す（型・lint・テスト・`check:restore`・ビルド・`check:fit`・
   `check:contrast`。`check.yml` をそのまま呼ぶ）
3. 本番 D1 の写し（`wrangler d1 export` の定義 `schema-<sha>.sql` と中身
   `data-<sha>.sql` の2本）と Time Travel の栞（`bookmark.json`）を取り、
   artifact `d1-backup-<run id>` に残す（90日）
4. **マイグレーションを流す**（`wrangler d1 migrations apply --remote`。当てた移行は D1 に
   記録されていて、未適用のものだけが当たる。何も無ければ何もしない）
5. `wrangler deploy`

マイグレーションは「スキーマを変えたときだけ」ではなく**毎回**流す。`drizzle/` に
ファイルが増えていれば必ず当たる。流さずに出すと、列を足した移行（`0005` など）の
あとでは作品の画面が「no such column」で 500 になる——drizzle は列を名指しで読むので、
前の D1 のままでは今のコードが動かない（`test/deploy.test.ts` がこの事実を確かめている）。

使う前に、リポジトリの設定を用意する。**どれも必須で、最初に deploy を実行するより前に**
済ませる（environment が無いまま実行すると、GitHub は保護の無い `production` を自動で作る。
承認も「main だけ」も、YAML ではなくこの設定が守っている）。

1. Settings → Environments → New environment で `production` を作る
2. Deployment protection rules で **Required reviewers** に自分を付ける。deploy の最後の
   job はこの environment で動くので、承認するまで本番に触れない
3. **Deployment branches and tags** を「Selected branches and tags」にし、`main` だけを
   足す。承認と同じく GitHub の側で効く——deploy.yml の「main から実行しているか」は、
   実行したブランチ自身の YAML に書いてあるので、そのブランチで消せる（分かりやすく
   止めるための1段で、守りではない）
4. `CLOUDFLARE_API_TOKEN`（D1 の編集・Workers のデプロイができるトークン）を、この
   environment の **Environment secrets にだけ**置く。**リポジトリの secret
   （Settings → Secrets and variables → Actions → Repository secrets）には置かない**——
   そこに置くと、environment を外した workflow をどのブランチにでも書けば、承認も
   ブランチの制限も通らずに読める。前にリポジトリの secret に置いていたなら、
   environment の側に置き直してからリポジトリの側を消す
5. Settings → Branches で `main` をブランチ保護する（直接の push を止め、check を必須に）

deploy.yml の中でも、トークンは wrangler を呼ぶ step にだけ渡し（`npm ci` や action からは
読めない。deploy の job の `npm ci` は `--ignore-scripts`）、`permissions: contents: read`、
action は commit の SHA で固定してある（上げるときは `git ls-remote --tags
https://github.com/actions/<名前>` で引き直し、行末のタグ名も直す）。

続けて2回押しても並んでは走らない（2本目は1本目が終わるまで待つ）。

手元から出すなら `npm run db:migrate && npm run deploy`（どちらも先に id の番兵を通る）。
門は通らないので、先に `npm run typecheck` `npm run lint` `npm test`
`npm run check:restore` `npm run check:fit` `npm run check:contrast` を自分で通すこと。
写しも自分で取る（下の「戻す」の2本の `d1 export`）。

### 公開ページの写し

訪問者（管理画面にログインしていない人）の公開ページは、そのデータセンターの Cache API に
写しを置き、次からは D1 に聞かずに返す（`src/lib/page-cache.ts`）。D1 が落ちている間も、
写しのある画面は前の姿で出る（写しの無い画面は 500）。

- **管理画面で保存すると、写しは外れる。** 保存が KV の `site:version` を新しくし、写しは
  置いたときの版と違えば使われない。ただし版の読みは KV のエッジのキャッシュ（60秒）を
  通すので、**保存から最大 60 秒ほど**、ほかの場所の訪問者には前の画面が出る。
  ログインしている自分にはすぐ見える
- **デプロイすると、写しは全部外れる**（鍵に Worker の版が入っている）
- **D1 が落ちている間に出すのは、いまの版の写しだけ。** 管理画面で何かを書いたあと
  （下書きに戻した・消した、を含む）の写しは、障害の間も出さない——取り下げた作品が
  障害のたびに戻ってくることは無い。版（KV）が読めないときも出さない。保存から 60 秒
  ほどは版の読みがエッジのキャッシュを通るので、その間だけは前の版の写しが出うる。
  すぐに全部を確実に外したいときは、デプロイし直す
- **D1 を管理画面の外から変えたら、版を自分で上げる。** D1 を手で直した・Time Travel で
  戻した、のあとに

  ```bash
  npm run site:touch   # 本番の site:version を新しくする（id の番兵を通る）
  ```

  上げ忘れても、写しは1時間で引き直される。seed（`db:seed:local` と本番の
  `db:seed:remote:destroys-prod`）は最後に自分で上げる
- 写しを通ったかは応答の `x-noctifex-cache`（`hit` / `miss` / `stale`）で分かる

### 戻す

コードは `npx wrangler rollback`（前の版の Worker に戻す）。D1 は戻らないので、
移行が中身や列を変えていたら、D1 も移行の前へ戻す（下の「前の版の Worker へ戻すときの
注意」）。D1 を戻したら `npm run site:touch`（公開ページの写しの版を上げる。上の
「公開ページの写し」）。

Time Travel で戻すのがふつう。deploy が残した artifact の `bookmark.json` の
`"bookmark"` を使う。

```bash
npx wrangler d1 time-travel restore noctifex --bookmark=<bookmark>
# 栞が無ければ時刻で
npx wrangler d1 time-travel restore noctifex --timestamp=2026-09-27T09:00:00Z
```

Time Travel は D1 に最初から入っていて、過去の任意の時点に戻せる（Workers の有料プランで
30日、無料で7日まで。戻すこと自体も取り消せる——restore は戻す直前の bookmark を出す）。
それより前へ戻す・別の D1 に写す（ステージングを作る・別のアカウントへ移す）なら、
artifact の写し（90日残る）を**新しい空の D1 に、定義 → 中身の順で**流す。

```bash
npx wrangler d1 create noctifex-restore
npx wrangler d1 execute noctifex-restore --remote --file=schema-<sha>.sql   # 表と索引・移行の記録の表
npx wrangler d1 execute noctifex-restore --remote --file=data-<sha>.sql     # 行（d1_migrations の行も）
# 中身を確かめてから、wrangler.toml の database_id をこちらへ差し替えて出す
```

**1つの SQL にまとめた写し（`d1 export` を `--no-data` / `--no-schema` なしで取ったもの）は
流せない。** 写しは表を作った順に書くので、先に作った子の表（`item_links`・`item_tags`）の
行が親の `items` の CREATE TABLE より前に来て、`no such table: main.items` で止まる（D1 は
外部キーをいつも効かせる）。この手順は `npm run check:restore` が CI で毎回通している。
写しには `d1_migrations` の行も入るので、戻した D1 にはそのとき当たっていた移行が記録
されたままになる（次の deploy は、そのあとの移行だけを当てる）。

手元で写しを取るのも同じ2本。

```bash
npx wrangler d1 export noctifex --remote --no-data --output=schema.sql
npx wrangler d1 export noctifex --remote --no-schema --output=data.sql
```

写しにはメンバーの連絡先とログインの紐づけ（セッションの id は D1 にもハッシュでしか
無い）が入るので、置き場所に気をつけること。

**前の版の Worker へ戻すときの注意。** 移行を流したあとの D1 の上で、その移行より前の
コードが動くと壊れるものがある。前の版へ `wrangler rollback` するなら、D1 もその版の
deploy が残した栞（その移行を流す**前**に取ったもの）まで戻す。**D1 を戻すと、その栞から
あとに管理画面で書いたものは消える**（戻す前に上の2本で写しを取っておけば、あとで手で
拾える）。戻さずに直すなら、前へ進める（直したコードをもう一度 deploy する）ほうが
何も失わない。

- `0006_oauth_identities` と `0007_hash_sessions`（パスワードのログインから OAuth へ）。
  0006 は `users` から `email` と `password_hash` の列を落とし、0007 はセッションを全部
  消す。この2本を流したあとの D1 の上で、それより前のコード（5627c08 まで。`users` を
  メールアドレスで引き、行を丸ごと読む）へ rollback すると、**管理画面はログインもできずに
  500 になる**（公開ページは出続ける）。移行と `wrangler deploy` のあいだ・deploy の失敗の
  あとも同じ姿になる。どちらも、今の版を deploy し直せば直る
- `0004_merge_apps_works`（Apps と Works を Projects に畳む構成の行の書き換え）。流した
  あとの D1 は、Projects を知らない版（それより前のコード）では作品の一覧が出ない。
  いまのコードは逆向き——0004 を流す前の D1（`apps` / `works` の行）——も Projects と
  して読めるので、移行が途中で止まっても一覧は消えない

この先、データを書き換える移行は2回のリリースに分ける（先に読む側を広げ、次に
書き換える。`CLAUDE.md` の「移行」）。

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

seed に本文が無いので、seed の `check:fit` は本文の画面を1枚も測らない（URL は 17 の
まま）。本文の画面は `check:fit` の fixture（上限ちょうどの本文を均等に割った形と
1つに寄せた形の2件。1件は作品名も上限ちょうど）が測る。

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

`0013_halfwidth_year` 〜 `0016_owner_claims_backfill` で入るもの。

- 0013 は作品の年（`items.year`）の全角の数字を半角に直す。年の欄を保存するときに半角へ
  直すより前に「２０２４」と保存した作品は、並べる年（`year_from`）が無く一覧の最後に
  落ちていた。数字以外の字には触らない
- 0014 は owner（`users.role = 'owner'`）が2人いる D1 を、いちばん古い1人に寄せる
  （もう1人の紐づけとセッションを移してから消す。どちらのアカウントでも同じ1人として
  入れる）。そのあと 0015 が「owner は1人」の部分一意索引 `users_one_owner` を張る。
  この順は崩さないこと（2人のまま索引を張ると移行ごと止まる）
- 0015 は `owner_claims`（`[vars]` の値を使った記録）も作り、0016 が、既に owner に
  紐づいているアカウントの記録を書き戻す（GitHub は id、Google は紐づけたアドレス）

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
で消してよい。この2本は前のコードが読む列を同じリリースで落とすので、流したあとで
前の版へ戻すときは、上の「前の版の Worker へ戻すときの注意」を読むこと。

プラットフォームの選択肢（`platforms`）は `0011_platforms_reference` が入れる
（`INSERT OR IGNORE`。前に seed で入った行・運用で直した表示名や並び順は書き換えない）。
`seed.sql` はもう platforms に触らない。

`0012_item_indexes` は索引だけを張り替える（行には触らない）。公開の一覧の3つの
引き方（全部・区分・担当）に、公開の並び（`year_from` の新しい順 → 並び順 → id）の
順の索引を1本ずつと、タグ・リンクの作品ごとの索引。Projects の1画面（カード2枚）が、
公開中の全件を並べ直してその子まで全部読む形から、その画面の2件と子だけを読む形に
なる（200 件で約 1,200 行 → 24 行）。並び（`src/db/queries.ts` の `itemOrder`）を
変えるときは、この索引も一緒に変えること（`test/queries.test.ts` の「索引」が
EXPLAIN QUERY PLAN で並べ直しが無いことを見ている）。

## 画面

どんな画面があり、どう行き来するかは `docs/` にまとめてある。

- [docs/screens.md](./docs/screens.md) — 画面一覧（URL・認証・出す条件・状態）
- [docs/flow.md](./docs/flow.md) — 画面遷移図

## どこに何があるか

```
src/
  index.tsx          入口。応答のヘッダ（CSP など）を全部に付け、ルートを束ねて 404 / 500 を出す
  site.ts            サイト全体の文言と宛先（管理画面からは変えない）
  theme.ts           見た目のプリセット。選べる値はここが正
  domain.ts          作品の区分（ITEM_KINDS: データの値・URL の語・呼び名の対応）と、
                     UI と DB が共有する作品の型（ItemView・ItemFilter）
  blocks.ts          置けるブロックの種類と、1画面あたりの件数・字数。ここが正
                     何画面になるか（blockPages。公開ページと管理画面の「N 画面」が読む）、
                     個人ページを画面に割る単位（memberUnits / memberScreenCount）、公開の関門も
  env.ts             バインディングの型
  db/
    schema.ts        テーブル定義。ここが正
    queries.ts       公開ページが読む問い合わせと、構成・見た目の読み書き
  lib/
    auth.ts          セッション（D1 にはハッシュで置く）と、通してよいアカウントの判定
    oauth.ts         GitHub / Google との約束（認可 URL・トークンの交換・id_token の検査）
    format.ts        テキストの解釈とフォーム値の受け取り
    page-cache.ts    公開ページの写し（Cache API）と、その版（KV の site:version）の上げ方
    paginate.ts      一覧を1画面ぶんずつに割る（chunk / screenCount）
    sequence.ts      画面の連なり。前後・目次・ページャの数・canonical をここで組む
                     目次のまとめ単位（tocKey）は節（navKey）より大きくてよい
                     ページャが数える単位（countKey）は画面より大きくてよい
  routes/
    public/          公開ページ
      routes.ts      URL の登録だけ（登録順の決まり。catch-all は最後）
      data.ts        サイトの今の姿（1人か・帯・絞り込みの読み方と効く画面）
      meta.ts        題・説明文・構造化データの組み方
      site.ts        サイトの画面の列（構成を画面にほどき、連なりの1枚ずつに写す）
      blocks.tsx     ブロック1つを節に描く（renderBlock）
      page.tsx       連なりの1枚をページにする（screenPage）・管理画面への入口
      top.tsx        トップの画面（/ と /:screen）と全体ページ（/all）
      member-screens.tsx  個人ページの画面ひとそろい（中身・URL・連なりの1枚）
      member.tsx     個人ページの連なり（/members/:slug …）
      item.tsx       作品1件の恒久リンクと本文の画面
      crawl.ts       /robots.txt・/sitemap.xml
      images.ts      /images/*（KV の画像。キーの形の検査と配るときのヘッダ）
    admin/           管理画面（/admin/*）
      index.ts       組み立て（送り元の検査 → ログインの往復 → 認証の壁 → 資源ごと）
      session.ts     送り元の検査（sameOrigin）と認証の壁（requireAuth）
      request.ts     要求の読み方（id・並び順・slug・札）と保存の知らせ
      auth.tsx       ログインの往復（/admin/login・/admin/auth/*・ログアウト）
      images.ts      画像の取り込み（pickImage / putImage）と KV・D1 の順序
      members.tsx    Members
      items.tsx      Projects の項目（個人開発・業務）
      blocks.tsx     構成
      appearance.tsx 見た目
      account.tsx    アカウント
  ui/
    Layout.tsx       公開ページの外枠
    AdminLayout.tsx  管理画面の外枠
    AdminForm.tsx    管理画面のフォームの部品（欄・公開のトグル・確認）
    components.tsx   画面を組む部品。main の直接の子は Screen / Hero だけが作る
                     外枠はどれも HtmlDocument で <html> を開く（DOCTYPE を出す）
    icons.tsx        インライン SVG
public/
  app.css            全画面のスタイル。値は :root のトークンだけで決める
                     骨格・色・書体のプリセットもここ（[data-layout] など）
                     末尾の「画面に収める外枠」が no-scroll を作る
  admin.css          管理画面だけの規則。管理画面は app.css のあとにこれを読み、
                     公開ページは読まない（:root は持たず、app.css の段を読む）
  _headers           静的なファイルに付けるヘッダ（Worker を通らないので、ここで付ける）
                     Workers Static Assets が読む規則で、ファイルとしては配られない
                     2枚の CSS は 1年・immutable（HTML が中身の版つきの URL
                     /app.css?v=… で読むので、変えてデプロイすれば URL が変わる）
  assets/            ロゴ・アバター・入口の月（moon.avif / moon.webp）
                     ※ ここに robots.txt や sitemap.xml を置かないこと。
                       public/ は Worker より先に配られるので、置くと
                       Worker が組み立てているほうが静かに届かなくなる
scripts/
  check-fit.mjs      npm run check:fit の中身。ブラウザで寸法を測る（seed と、上限ちょうどの fixture）
  check-contrast.mjs npm run check:contrast の中身。月の上の文字を画素で測る
  check-restore.mjs  npm run check:restore の中身。deploy の写し（定義と中身の2本）を空の D1 に戻して突き合わせる
  check-ids.mjs      本番に触れる前の番兵。wrangler.toml の id がプレースホルダなら止める
  seed-remote.mjs    npm run db:seed:remote:destroys-prod の中身。本番が空のときだけ流す
  touch-site.mjs     公開ページの写しの版を上げる（npm run site:touch / db:seed:local の最後）
  moon/              入口の月。render.py が Blender で焼き、pack.py が配信用に詰める
                     配るのは無彩色の三日月だけ。光暈は app.css が --accent から描く
  lib/               上の2本の共通部分。dev サーバの立て方と使い捨ての D1（dev-server.mjs）、
                     src/theme.ts の読み方（theme.mjs）、設計サイズ（viewports.mjs）。写しを2本持たない
                     wrangler.toml の id の読み方（wrangler-ids.mjs）も
                     fit-fixture.mjs は check:fit の上限ちょうどの中身を src/blocks.ts の
                     上限から作る。ts-import.mjs は src/ の .ts を Node からそのまま読む口
.github/workflows/
  check.yml          push と PR ごとの門。deploy からも同じものを呼ぶ（workflow_call）
  deploy.yml         本番へ出す道（main だけ・門 → 写し → 移行 → deploy）
drizzle/             生成されたマイグレーション（手で書かない）
test/                workerd 上で動くテスト
docs/                画面一覧と画面遷移図
seed.sql             移行前の index.html の内容（全部消してから入れ直す。本番は空のときだけ）
```

書き方の約束は `CLAUDE.md` に置いてある。
