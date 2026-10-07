# このリポジトリでの書き方

実行・検査・デプロイは `README.md`、画面と遷移は `docs/`。ここは決まりと理由だけを書く。

## 決まりごと

### 値と文字

**値は `public/app.css` の `:root` だけで決める。** 各セレクタに生の色やサイズを書かない
（`public/admin.css` も `:root` を持たず、app.css の段を読むだけ）。余白は7段。文字は
**静的6段**（`--fs-label` 11 / `--fs-meta` 12 / `--fs-sm` 13 / `--fs-base` 14 /
`--fs-md` 15 / `--fs-lg` 18）と、画面に連動する**4段**（`--fs-display-xl` > `--fs-display` >
`--fs-display-sm` > `--fs-display-xs`）の計10段。連動する4段は大きさ順の1本のはしごで、
部品の名前を持たない（名前を付けると、その部品でしか使えない段が増える）。セレクタに書いた
生の `font-size` は0（`.avatar__fallback` だけは `--avatar-size` からの比率なので例外）。
中間値は既存の段を使う。

**配色は黒基調で、文字もボタンも白。** 既定はモノクロ（`--mono`、白地のボタンに黒い字）、
ほかの6色は管理の「見た目」で選べる。持ち主の指定なので OS のライトには合わせない
（`prefers-color-scheme` は書かない）。`color-scheme: dark` と `ColorSchemeMeta` を使う。
**紙だけは白地**（末尾の `@media print` の `:root`）で、同じ名前の色を差し替える。
色を足すなら紙にも書く（`test/theme.test.ts` の「配色」）。

**和文の最小は `--fs-meta`（12）。** `--fs-label`（11）は和文が入らない英大文字の小見出し
と数字の札（Skills・Story の英字の小見出し・ADMIN・404 の番号・目次の英字の行き先・件数・
一覧の番号）だけ。**等幅（`--font-mono`）は英数字の札だけ**。打ち込んだ字が入る札は、日本語を1字も含まないときだけ
`src/ui/components.tsx` の `langOf` が `lang="en"` を付け、等幅はその `:lang(en)` にだけ
掛ける。年と期間は和文を含むので等幅にせず `tabular-nums`。`test/theme.test.ts` の
「文字の段」がセレクタを名指しで数えている——足すのは和文が入らないと確かめてから。

**見出しと本文の段。** 入口の大見出しと節の見出し（`SectionHead` の `h1`、`/all` の `h2`）は
最上段の `--fs-display-xl` で、一覧の行の題（`--fs-display-xs`）より2段以上大きい。行の説明は
`--fs-base`、段落（`.bio p`）は `--fs-md` で、1行は約40字（`--measure: 40em`）。小節の見出し
（`SectionHead` の `sub`。作品の Story の `h2`、`/all` の Profile の `h3`）は `--fs-lg` で線を
引かない。個人ページは頭の大見出し（`h1`）が `--fs-display`、章（About / Skills / Career の
`h2`。`chapter`）はそれより小さい `--fs-display-sm`（同じ大きさだと章が h1 と同じ格に見える）。

**折り返しは文節で。** 見出し・行の説明・段落・締めの1文に `word-break: auto-phrase` と
`text-wrap: pretty`（app.css の `.phrase` のすぐ下の1本。知らないブラウザは捨てる）。
句読点で塊に切る `Phrases` は短い一文（入口の大見出しとリード文・個人ページの大見出し・
締めの誘いの1文）だけに使う——長い段落を塊に切ると、行末に大きな空きが残る。

### 幅と入力

**幅は画面ごとではなく部品ごとに決める。** メディアクエリは 600 と 900 の2つだけ。
連続して変わるものは `clamp()`。部品が自分の幅で姿を変えるときは `@container`（枠の幅は
画面の幅と別に動く）。タッチは `pointer: coarse`、ホバーは `hover: hover` で
分け、幅で入力手段を推測しない（iPad の横向きは広くてもタッチ）。押すものの的は `--tap`
（指で 44px）で、目次の行き先と管理画面への入口も同じ的。

高さは別の決まり: 連動する4段の可変部を `@supports (font-size: 1svh)` の中で
`min(Xvw, Ysvh)` に差し替える（背の低い窓で見出しが画面を食わない）。メディアクエリは
増やさない。

**目次は1行のまま横に送り、いまのページの行き先が見える位置で開く。** 印（`aria-current`）に
`scroll-initial-target: nearest` とぼかしのぶんの `scroll-margin-inline`。右端のぼかし
（`--fade-right`）の幅だけ帯は右に空きを持って余白へはみ出す（溢れていなければ最後の行き先を
薄めない。`--fade-w`）。全体ページの目次は貼り付かないので折り返す。

### 部品と層

**部品は `src/ui/components.tsx` に置いてから使う。** その場で書くと、同じものが少しずつ
違う姿で増える。ルートのファイルに見た目の部品を書かない。管理画面のフォームの部品は
`src/ui/AdminForm.tsx`。

**ルートは責務ごとのモジュールに分け、層の向きを守る**（公開は `src/routes/public/`、
管理は `src/routes/admin/`。一覧は README の「どこに何があるか」）。
- DB の層（`src/db/`）と規則（`src/blocks.ts`・`src/domain.ts`・`src/lib/`）は UI とルートを
  読まない。UI と DB が共有する型は `src/domain.ts`（`test/source.test.ts` の「層の向き」）
- 公開ページと管理画面が同じ答えを要るものは `src/blocks.ts` に1本だけ置く（`blockShown`・
  `publishErrors`・`blockLines` ほか）。片方に書くと、もう片方が写しを持つ

**スタイルシートは用途で分ける。** 公開は app.css、編集は app.css + admin.css、プレビューは
app.css + preview.css（案内だけ）。値は app.css の段を読む。公開へ移す部品は規則も移す。
並びは素 → 600 → 900 → 手触り → 入力手段。読込は `Stylesheets` 1本（`test/headers.test.ts` の
「スタイルシート」、`test/theme.test.ts` の「スタイルシートの分け方」）。

**CSS と焼いた装飾の絵は版つきの URL で、1年・immutable で配る。** `public/_headers` が配信を決める。
CSS の版は `Stylesheets` が Worker に同梱した文字列から作る（`wrangler.toml` の `[[rules]]`、
テストでは `vitest.config.ts` の `cssTextPlugin`）。**`<link rel="stylesheet">` を直に書かない**。
ブラックホールと星雲の `?v=` はファイルの SHA-256 の頭8桁（`BLACKHOLE_ART`・`--nebula-art`）。
版の無い素材（ロゴの素材・アバター）に長い `Cache-Control` を付けない（古い写しが1年残る）。

### JavaScript とリンク

**公開の実行 script は装飾開始 helper 1本だけ。** `src/ui/motion.ts` の `MOTION_START` と
exact SHA-256（`MOTION_CSP`）で許す。外部 script・任意の inline は増やさない。内容と導線は SSR、
絞り込みはリンクと query（`?kind=` `?member=`）、管理は HTML フォームと 303。JSON API も SPA も無い。
CSS適用の直後から始める。星屑と天体は同時、時計は群内で同期。
初期フレームで待機し、開始済みの印を残して終える。JS無効時はCSS動作、reduceでは動かさない。
管理は `src/ui/admin-behavior.ts` の固定ハッシュだけを許す。見本・プレビューダイアログ・エラー導線の補助で、保存は標準フォーム。JSON-LD はデータ。ログイン・公開のエラー・プレビューは実行script無し。

**畳んだ欄はエラー時に開く**（`FormDetails`）。URL・メールは `inputmode` とサーバー検証を使う
（閉じた欄ではブラウザが修正先へフォーカスできない）。必須欄は畳まず `required` も使う。

**プレビューは認証内で保存せず描く。** `/admin/preview` は公開部品を共用し、POSTは200。通常は同じ画面のダイアログ、JS無効時は別タブ。
`no-store`・`noindex`・script無し、`touchSiteOnWrite` の前に登録する。全体は公開中だけ。
選んだ画像は検査後に応答内へ閉じ込め、KVに置かない。

**押せるように見えるものは、面ごと押せるようにする。** 一覧の行は題のリンク（`.entry__link`）の
`::after` を面いっぱいに被せる（stretched link）。行を `<a>` で包まない（中のリンクが
入れ子になる）。中のほかのリンクは `position: relative; z-index: 1`。フォーカスの輪郭は覆いの
縁の内側に描く（外だと上の行の罫線に重なる）。ホバーで応えるのは `:has(.entry__link)` だけ。
`:has` はセレクタの列に素で並べない（知らないブラウザが列ごと捨てる）——`:is()` の中か1本の規則に。

**矢印は行き先で使い分ける。** `↗` は外へ出る・別タブだけ、サイトの中の続きは `→`、一覧へ
戻る手は `←`（`BackLink`）。`LinkRow` は矢印を CSS が URL の頭で決め
（`.links a[href^='/']::after`）、`target` / `rel` は部品が同じ条件で決める。

### 作品と画像

**作品のページは一覧の行を開いたもの。** 頭は行と同じ部品（`Note`・`Metric`・`Tags`・
`LinkRow`）を並べ、足すのは絵だけ（`ItemDetail`。画像の `Shot`。**画像の無い作品に代わりの絵を
置かない**——星図を置いたら持ち主が「なんか違う」と外した）。900 以上は文の列の右に絵。画像が2枚以上なら、絵は
小節「Screenshots」（`ItemShots`）の縦ギャラリーへ全部。先頭を大きく、900 以上では
続きの画像を大小の2列に配置し、狭い画面は全幅の1列（順は `itemImages`、先頭がサムネイルと共有カード）。
各画像の説明と番号を添え、原寸を別タブで開ける。アイコン（`icon_url`）は題の左の飾り。その下に本文の小節「Story」（`ItemStory`。`id="story"`・`h2`）。
**本文は個人開発も業務も同じテンプレート**（`STORY_SECTIONS`。持ち主の「内容を統一」）。開く式は `src/blocks.ts` の
`itemStory` 1本（ページ・全体ページ・転送が読む）。本文の無い作品は小節を出さない。
- 作品同士をめくる手は置かない（前の `…/<slug>/story` は下の「前の URL は殺さない」）
- 「← 一覧に戻る」（`BackLink`）は一覧のその作品の行（`/projects#item-<slug>`。行の id は
  `src/ui/components.tsx` の `itemCardId`）へ。Projects を置いていなければ出さない
- `/all` では Projects の節の行の下に小節で並べる（`ItemStories`）。行の中に入れない

**画像の枠は絵に合わせない。** 枠の形は CSS が先に決める（絵に合わせると、読み込んだ瞬間に
下の字が押し下げられ、縦長の絵1枚でページの頭が埋まる）。作品のページは高さ `--shot-h`（900 以上は文の列の
高さまで伸びる）、一覧のサムネイルは `--thumb-ratio`（16:10。本文の下に置き、画像の無い作品には
何も置かない）で、絵はどちらも `contain`（切らない）。ギャラリーの枠も `--thumb-ratio` で
先に決め、先頭は `--gallery-lead-h`、続きは `--gallery-shot-h` を高さの上限にする。
- サムネイルは**どの幅でも出す**（`loading="lazy"`。畳むと電話の一覧に絵が無い）
- 一覧の画像は飾り（`alt=""`）。名前は題のリンクが持つ

**一覧の行は書いたぶんを全部出す。** 説明を行数で切らず、タグと行き先も畳まない（一覧は
縦に読む）。長さは説明の上限（100 字の2文。`MAX_CHARS.itemSummary`）で受ける。

**公開画像は KV の2区画**（`avatars/`・`items/`）。削除時は `archive/<元キー>` へ90日控えを置く。
控えと `site:version` は `/images/*` から読めない。キーは
`<置き場>/<slug>-<乱数8桁>.<拡張子>` で、付けるのは `src/routes/admin/images.ts` の `putImage`
だけ。取り込みの検査は `pickImage` の1本。**画像があるのに代替テキストが空なら、公開として
保存させない**（`publishErrors`。ほかの画像も1枚ずつ）。

**画像の種類は中身の先頭のバイトで決める。** 通すのは5種類（`src/lib/image.ts` の
`IMAGE_FORMATS` が正。`accept` も配る側の許可リストもここから）、1MB まで。`file.type` と
拡張子は見ない（名乗りのまま配っていたころ、SVG の `<script>` がサイトのオリジンで走った）。
SVG と HEIC は理由を添えて 400。**画像の URL はフォームから受け取らない。**

**KV と D1 は順序で守る。** 新しい画像を KV に置く → D1 を書く（落ちたら置いた画像を全部消して
投げ直す。`commitWithImage`）→ 前の画像の控えを作ってから原本を消す。控えに失敗したら原本を残す。検査は KV に置く前。削除も D1 → 控え → 原本。

**URL の検査は保存と描画の2か所。** 保存で弾き、描く部品の中でもう一度見る（検査より前に
入った行を落とす）。作品のリンクは `isSafeUrl`（`https?://`・`mailto:`・`/`。制御文字は不可）、
ラベルか URL の片方だけの行も 400 で何行目かを示す（`readLinks`）。描くのは `LinkRow` /
`LinkList`。メンバーの GitHub は `https://` だけ（`isHttpsUrl`。保存は `memberErrors`、描くのは
`Socials` と JSON-LD の `sameAs`）。受け取れない値なので、下書きでも見る。

**作品のページの共有カードは、その作品の画像**（`src/routes/public/item.tsx` の
`itemOgImage`。分からないものは名乗らない。AVIF はサイトの1枚に戻す）。`twitter:card` は
寸法で決める（`src/ui/Layout.tsx` の `cardOf`）。

### 動き

**動きは CSS だけで付け、曲線は1つに揃える。** 押すと縮み（`--press`）、離すとばねで戻る
（`--ease-spring`）。部品ごとに量や曲線を変えない。公開ページは箱（枠・面・影）を並べず、
罫線で区切り、角を立てる（管理画面の部品は面と上辺の光 `--highlight` のまま）。
`prefers-reduced-motion` では全部止まる前提で、止まった姿でも読めるようにする。

**星系は初めから完成形で表示する**。背景・軌道・光の大きい層を動かす登場は、アクセラレーションを
切った Edge で重くなる。**文字・名札・件数だけが不透明度と移動で浮かぶ**（ぼかさない）。
件数は600ms待って数え上げる。一度きりの動きは5秒以内で、動きを減らす設定でも完成形になる。

**入口も締めも動き続ける**（持ち主が「もっと動きを」と選んだ）。
**星屑と天体は軌道ごと公転する**（持ち主の「軌道の線を星と一緒に動かして」）。単位円に直した楕円を
`orbit-spin` で回し、天体は `orbit-unspin` で形を保つ。光芒のある星が淡い尾を引く（`Flows`）・
吸い込まれる粒（`orbit-grain-*`）・ブラックホールの光の揺らぎ・星雲の漂い・星の瞬き・流れ星。
**続く動きは更新頻度ごとに層を分ける**。粒と流れる星は小さい HTML を、65点から焼いた固定 CSS の
区間ごとの `steps()` で60回/秒まで動かす（`MOTION_RATE`）。星屑・天体・瞬きは100ms
（`TICK` / `BODY_TICK`、6刻み）、星雲と光も100ms。大きな層を毎コマ描き直さない。
**止める手は置かない**（持ち主が外した。動きを減らす設定だけが止める）。**keyframes に `var()` を書かない**
（毎コマの style 計算を避ける）。量は静止した親の transform 属性・timing（天体の揺れは `linear()`）・
粒・流れる星の固定 CSS へ。途中の姿は `check:contrast` が `orbit-` の animation を止めて送る。

**ページを移るときの切り替えも CSS だけ**（`@view-transition`。前と次の両方が宣言したときだけ
切り替わる）。上の帯は `view-transition-name: top` で本文の入れ替わりから外し、一覧の行の題と
作品のページの h1 は同じ名前（`itemTransition`。ページの中でただ1つ）でつなぐ。管理画面は
admin.css が `navigation: none` で打ち消し、動きを減らす設定でも外す（`*` の
`animation: none` は `::view-transition` に届かない）。

### 一覧と画面の組み方

**一覧は件数で形を変える。** Team は 2人なら横長の行、3人以上なら格子、1人なら Team の
ページを作らずその人のプロフィールに置き換える（下の「このサイトは1人として名乗る」）。0件なら
節ごと出さない。見出しだけ残さない。

**Projects は番号付きの行を縦に並べた索引**（`ItemRow`）。列の数を数える規則は持たず、行の中の
区画の幅（`--entry-*`）だけを決める（広い画面ほど本文が細る、を起こさない）。番号は公開中の全件の並びで、
絞り込んでも絞り込む前の番号のまま（`rowNumber`。同じ作品はどの一覧でも同じ番号）。

**トップは決まったブロックの並び。** 置く・外す・並べ替えるのは管理画面の「構成」から。
見た目を変える口は作らない（どう並べても統一感が崩れない）。

**同じ行き先を1つのページに2つ置かない。** Contact のページで足元の GitHub / メールを出さない、
1人のサイトのプロフィールに帯を出さない（入口の「一覧で見る →」と同じ行き先・同じ件数）、
全体ページへの1本は足元だけ、作品のページに「くわしく読む →」を置かない（本文はすぐ下の小節）。

**技術の補足は行に1度**（`src/lib/format.ts` の `skillRows`、描くのは `SkillGroups`）。補足と
項目は `<dl>` の `dt` / `dd` で結ぶ（読み上げでどの項目の補足か分かるように）。

**骨格は1つ——上の帯・本文・足元**（`src/ui/Layout.tsx`。骨格のプリセットは持たない）。上の帯はロゴと目次（と
ログイン中の管理画面の入口）だけで、**帯の段の数を中身で変えない**（目次は1行で残りの幅を取り、
溢れたら横に送る）。名乗りと連絡先と全体ページへの1本は足元で、**どの幅でも畳まない**。
見出しと本文は左の軸にそろえる。**どのページも横には動かない**（`check:fit` が測る）。

### 公開ページは縦に読む

**節ごとに1ページ。ページは普通に縦にスクロールし、目次はページの上に貼り付ける。** 入口・
Projects・Profile・Contact・打ち込むブロックがそれぞれ1ページ。先頭の Hero はロゴで戻り、ほかは
見出しがなくても目次に載せる。`/all` の目次は見出しだけ。行き来は目次と本文のリンク（「一覧で見る →」・一覧の行・
「← 一覧に戻る」）だけで、**画面の底のページャ（← 前 / 次 →）は置かない**（1画面に収めて
ページャでめくる形は、持ち主が「面倒すぎる」とやめた）。
- **前の URL は殺さない。** `/<ページ>/<n>` は `/<ページ>` へ素の 301（query は付けたまま）、
  `/members/<slug>/about`・`/skills`・`/career`（と `/<n>`）は `/members/<slug>#about` などへ、
  `…/item/<slug>/story` は `#story` へ（どちらも行き先が中身しだいなので `movedTo` の no-cache。
  小節が無くなっていればページの頭へ）。sitemap には転送元を載せない
- **件数や字数でページを割らない。** 1画面に収めるための数（`perScreen`・`maxChars`・紹介文や
  本文の字数・タグとリンクの本数）は外した。残した数は名前と目録の文の長さ（`MAX_CHARS`。
  下の「よくある変更」）だけ

外枠は app.css の末尾「ページの外枠」（`@media screen` の括り。紙には当てない）で、役は4つ。
- **足元を画面の底に置き、表紙は1画面ぶんの高さを下限に持つ。** `body[data-site]` を縦の flex に
  して `min-height: var(--screen-h)`、本文が残りを受ける。入口の Hero と締めの Contact は
  `--cover-h`（画面から帯と本文の上下の余白を除いた高さ）を下限に持つ。どれも `height` に
  しない——決め打つと長い中身がページの外で切られる
- **上の帯を貼り付ける。** `position: sticky; top: 0` と地（`--bg`）と `z-index: 2`（中身の
  `z-index: 1` より上）。`/all` は外枠の外（表紙も帯の貼り付けも持たない。目次は折り返す）
- **送った先を帯の下に止める。** html の `scroll-padding-top` に `:root` の `--top-clear`
  （帯の高さ `--top-h` + 間）。帯の高さを変えたらこの段も
- `html` と `body` に `overflow: clip` / `hidden` や高さの決め打ちを書かない。節に `overflow` を
  持たせない（縦のスクロール箱はページ1つ。横にだけ送る目次の帯は別）。`main` の直接の子は `Screen` / `Hero` だけが作る
- **節は上揃え（見出しの錨）**（`align-content: safe start`）。どのページも見出しが帯の罫線から
  同じだけ下（本文の上の余白 `--page-pad`）に居る。錨を持たないのは Hero と締めの節（`.orbital`）
  だけ。見出しより前に子を足すなら全ページに足すか、錨の測り方と一緒に決め直す（`check:fit` が
  1px 以内を測る）
- **レイアウトは `check:fit` が測る。** 設計サイズは3つ（正は `scripts/lib/viewports.mjs`）× 書体3つで、
  **390 と 768 は指で測る**。測るのは横のはみ出し・切られた要素・`h1` の数・帯の貼り付け（一番下
  まで送っても見える）・送った先・指の的・見出しの錨・入口の軌道図（ブラックホールが焦点に座る）

### 見出しと文書

**1ページ = 1ドキュメント。** ページごとの URL はどれも `h1` を**ちょうど1つ**持ち、ページの
中の小節は `h2`（個人ページの About / Skills / Career、作品の Story）。`/all` だけが Hero の `h1` に
節が `h2` でぶら下がる（1人のサイトの Profile の節は `h3` / `h4` まで。`SectionHead` の `sub` と
`SkillGroups` の `level`）。出し分けは `renderBlock` の `whole`（全体ページの節として描くか）1つが
決める。**目に見える見出しの無いページ**（締めの Contact・見出しを空けたメモ）は
`.sr-only` の `h1`（`HiddenHeading`）を置き、メモは名前「メモ」を持つ（`test/public.test.ts` の
「サイトの全ページ」が `h1` を数える）。`<title>`・`description`・canonical・構造化データも
ページごとに変える。題は `src/routes/public/meta.ts` の `pageTitle` 1本、名前と肩書きは
`nameWithRole` 1本（肩書きが空なら名前だけ）。sitemap の全 URL の題が重ならないことをテストが
見ている。

サイトの名乗りの構造化データ（`Person` / `Organization`）はページの並びの**先頭にだけ**載せる
（`src/routes/public/page.tsx` の `firstOnly`）。作品の `CreativeWork` と2人以上のサイトの個人
ページの `Person` は「この URL が何か」なので、それぞれのページに載せる。載せるかは呼ぶ側が
決めて `screenPage` に渡す。

**ページの並びに同じ URL を2度並べない。** 目次を組む `src/lib/sequence.ts` の
`tableOfContents` は重なり（URL と key）を例外にする（黙って落とすと、どのページが消えたか
分からない）。

### 足元と個人ページ

**名乗りは足元が持つ。** 1人のサイトなら、入口も含めてすべてのページの足元に名前と職種を出す
（`src/ui/components.tsx` の `SiteIdentity`）。入口の大見出しはその人の一文（`members.headline`。
無ければ名前）で、名前を真ん中に据えない（持ち主が「ださい。Profile で出る」と外した）。
2人以上のサイトでは足元に名前を出さない。顔は個人ページの名札（`.nameplate`）にだけ。上の帯には
名乗りを置かない（ロゴ・目次・管理画面の入口だけ）ので、幅で畳むものが無い。
**行き先の違う同じ名前の札を並べない**——2人以上のサイトの個人ページでは、その人の札
（`OwnSocials`）が読み上げの名前でその人を名乗る（`aria-label="青木 春香の GitHub"`。見た目の字を
含める、WCAG 2.5.3）。足元のほうは外さない（足元はどのページでも同じサイトの足元）。

**個人ページは1ページで、サイトの並びの一部。** `/members/<slug>` に 名札 → 大見出し → About →
Skills → Career を縦に並べる（`src/routes/public/member-page.tsx` の `memberPage`。小節は
`#about` などの id、書いていない Skills / Career は出さない）。上の帯も足元もサイトのままで、専用の
ものに入れ替えない（別のサイトへ飛んだように見え、戻る道も無かった）。組み方は
`src/routes/public/member.tsx` の `renderMemberScreen`。
- 1人のサイト（Team を置いているとき。`profileOf`）: Team の位置にこのページが入る。目次は
  「Profile」の1行で、このページでその行に印（`src/routes/public/site.ts` の `PROFILE_KEY`）。
  About などの小節は目次に並べない。`/team` はこのページへ 301
- 2人以上: Team から入るページ。目次の印は Team
- Team を置いていないサイト: 並びの外（目次に印は無い。一覧の行の担当者名から入る）
- 個人ページだけの Contact は持たない（`/members/<slug>/contact` はサイトの Contact へ 301）

**このサイトは1人として名乗る。** 文言は管理画面の「サイト設定」の `tagline` と `heroLead`、それ以外は
「公開中のメンバーがちょうど1人か」（`src/routes/public/data.ts` の `soloMember`）で決まる。
1人のあいだは Team の代わりにプロフィール、`/all` でも Profile の節。管理画面の「構成」の
Team の行も「プロフィールに置き換わる」と言う。2人目を公開すると自動で器（Organization）と
Team に戻る。人数は数えて告知しない。

### 作品の並びと選択肢

**選択肢は表で持つ。** プラットフォームは `platforms` テーブルが正（自由入力は表記ゆれで札が
揃わない）。行を入れるのは移行で、`seed.sql` ではない（seed にしか無いと、新しい環境の用意に
本番の全消去が要る）。

**個人開発と業務は、公開ページでは1つの一覧（Projects）。** データの区分（`items.type`）と
管理画面のタブは分かれたまま、公開ページでは新しい順（年 → 並び順 → 作った順。
`src/db/queries.ts` の `itemOrder`）で混ぜる。**並び順は区分をまたいで1つの数の並びとして比べる。**
- **並べる年は `items.year_from`**——DB が year から作る生成列（VIRTUAL）で、書く口は無い。頭が
  数字4桁でない年は null で最後。同じ規則の写しが `src/lib/format.ts` の `yearFrom`（知らせる側）で、
  変えるなら2つ一緒に。**全角の数字は保存のときに半角へ直し（`readItemForm`）、`yearFrom` は
  全角を読まない**（DB の glob と同じ ASCII の規則）
- **`itemOrder` と items の索引3本（`idx_items_public` / `_kind` / `_member`）はセット**
  （並びだけ変えると全件を読む形に黙って戻る。`test/queries.test.ts` の「索引」）
- **区分の一覧は `src/domain.ts` の `ITEM_KINDS` が正**（値・URL の語・呼び名。enum・
  `KIND_LABEL`・`itemHref`・ルートと 301・入口の件数・管理画面のタブはここから作る）。前の `/apps`
  `/works` は `/projects` へ 301、作品の恒久リンクは貼られたまま動かす

### 入口の天体カバーと Contact

**入口と Contact は5天体共通の余白・書体・左の情報列・右の天体画像**を使う。
900 未満は縦積み、900 以上は画像を右へ置く（`.astra-art`）。ブラックホールの Contact だけ
星雲画像を使い、月・土星・海王星・太陽は入口と同じ天体画像を抑えた濃さで再使用する。
文字の星は置かない。画像だけを小さく浮遊・傾け、光を呼吸させる。字と導線は初期位置で固定し、reduceでは全て止める。
旧 `OrbitSystem` の HTML は互換のため残るが表紙では非表示。プロフィールの動く天体と
ワードマークは引き続き表示する。入口の大見出しの上の札は「職種 — 所在地」（`Eyebrow`）、その下にリード文と
「一覧で見る →」（`Cta`）。一覧への1本と件数（`Tally`）は Projects のページがあって作品があるときだけ
（`bandOf`）。件数は作品・区分ごと（両方の区分があるときだけ）・いちばん古い年（Since）。

**軌道図の焦点はメンバーの天体、軌道を回る天体は作品**（`OrbitSystem`・`orbitMap`）。
公開中が1人ならその人の天体と色を入口・Contact に使い、0人・複数人は既存のブラックホール。
選択肢は `src/celestial.ts`。個人ページは大きな天体、名札・Team・全体は小さなシンボル。写真は残す。
大きな天体はCSSで動く。BH中心と太陽の球体・小シンボル・ロゴは静止。動きを減らす設定では止まる。
色は装飾だけ、本文は白。既定値は black-hole/inherit、未知の送信値は400、DBの未知値は描画で既定値へ。
天体は光る惑星で手前ほど大きく、**業務は輪のある惑星**（区分を色だけで分けない）。**軌道は同じ形の入れ子で交わらず、外ほど
間を広げる**（散らすと隣と交わる）。天体は画面の上の軌道の長さで黄金角ずつ（奥に詰めない。同じ軌道の次は
`ROUND_SPREAD` 先）。

**ブラックホールは旧素材**（`BLACKHOLE_ART`）。ほかの天体も白い光が黒い影へ溶ける質感に揃える。自然な濃淡は残し、細部を抑える。均一な球や幾何学的な穴に単純化しない。詳細はREADME。`hero`は比較用（`dist/`）。
**軌道面は水平で、`ELEVATION`（26°）から透視で見る**（`CAMERA`。手前は広がり奥は
詰まる。どの距離も同じ大きさでは的か図面に、低い角度ではレコード盤に、半端な傾きは曲がって見えた）。
奥の半分（`far`）はブラックホールの後ろ、手前（`near`）は前に描く（`orbitHalves`）。

**天体に作品の札を添えない**（図は飾りで、作品へは「一覧で見る →」から）。作品が0件なら焦点の天体だけ。`/all` には置かない（頭は名前を目に見える `h1` で置く）。

**軌道は細い線と光の帯と星屑**（`bands` は手前ほど太く明るい、`stardust` は字の白の点。線だけでは
図面に見えた）。線は `--accent` の坂（奥 `--orbit-far` → 手前 `--orbit-ink`。
半分ずつ変えると継ぎ目で跳ぶ）で、外の軌道ほど淡い（`--orbit-outer`）。帯のぼかしは動かない層
（`.system__bands`・`.orbits__still`）でだけ掛ける。星屑と天体は別の SVG、流れる星と粒は小さい HTML。
星屑は600粒まで。外側 SVG の奥・手前に代表の濃さを掛けて奥ほど淡くする。内外とも mask を置かない。
点は `--ink`。**色を混ぜる式は `:root` に置けない**（`var()` は宣言した要素で解決され、`[data-accent]` が
効かなくなる）。線と星屑は画面の px（`vector-effect: non-scaling-stroke`）。**天体は中心から外へ
溶ける光**（縁のくっきりした白い丸は、軌道を回る平らな点に見えた）で、枠の単位で描く（にじみ・輪と
一緒に奥行きで縮む）。縦横比と傾きは `orbits.ts` と対（`test/theme.test.ts`）。

**入口と締めは、まわりを本文の幅いっぱいの星空にし、星雲を画面の端まで広げる**（持ち主の
「もっと壮大に」「画面広く」。`Cosmos`・`nebulaMap`）。**字の後ろには何も出さない**
（字の塊が地の色を敷く。星1つで小さい字の 4.5:1 を割る）。**モノクロでも星雲だけは色を持つ**。
星雲はプリセットごとの3色と4層の濃さを CSS から読み、透過 WebP の6枚へ焼く（mono と iris は共用）。
明るい塊は軌道の帯の外へ。雲は箱ごと漂い、瞬く星と流星は小さい HTML の点・筋を動かす。
模様のフィルタは生成時だけ、底のフェードは下端の帯だけに地の色を重ねる。星空の親に mask を掛けない
（どちらもアクセラレーションを切った Edge で重くなる）。

**締めの Contact は、左に見出しと連絡先、右に画像を置く。** 画像は装飾で、
メールと GitHub は HTML のまま。着いたときのテキスト遅延は付けない。
受ける節は `Screen` の `orbital`。`/all` では従来どおり本文だけを表示する。

**Contact のページに置く字は、見える h1、誘いの1文と手だけ**（サイト設定の `contactLead`、メールの手、
GitHub の手）。メールの手はアドレスそのものを大きな字にしたリンクで「メールを送る」を添える
（紙に刷っても宛先が字で残る。`/all` も同じ手）。`/all` では節見出しを置く。
`contactLead` は `/contact` の description にも使う。

**ロゴは ΛSTLOG、O は選択中の天体。** 1人のサイトはその人、プロフィール・作品は公開の持ち主、
未指定・複数人の共通ページはブラックホール。プレビューは編集中の天体を使う。
本文と同じ版つき素材を読み、文字の幅・O の中心は固定。CSS で O の画像だけを動かし、
影・他の文字・小記号は静止。helper は初期フレームから始め、reduce では止める。
ブラックホールは `BLACKHOLE_ART` と黒い円（`--hole-core`）を重ねる。強制色では全天体を字の色の輪に替える。
`HoleMark`・配布素材・favicon は静止したブラックホール。
形は `src/ui/logo.ts`。`scripts/logo/export.mjs` が SVG・PNG を書く。SVG は絵を data URI で抱え、
favicon・apple-touch-icon は黒い地を敷く。GitHub の顔は render.py の `avatar`。

前の入口の月の記録は `docs/moon.md`。

## 文言

- 見出しは言い切り。動詞で終える
- **本文は「です・ます」**（`SITE.heroLead`・紹介文・`SITE.contactLead`・作品の Story）
- **一覧の行の説明（`items.summary`）は常体の2文**（「何であるか。何をしたか。」）。目録の文なので
  本文と文体で分ける。管理画面の欄のヒントにも同じことを書いてある
- ラベル（タグ・役割・年）は名詞のまま。文にしない
- **期間は「2024.03 — 現在」「2024 — 現在」。** 先を空けない（「2024 —」は書きかけに見える）
- **実績値の添えは、値と単位のあとに続けて読んで意味が通る形**（「20 人日 見込み 40人日から半減」。
  `Metric` / `metricDigest`）
- **節の名前は英語の固有名、操作の言葉は日本語。** 節の名前＝目次・見出し
  （Projects / Profile / About / Skills / Career / Contact / Team / Story / Screenshots）。操作の言葉＝押す手の言葉
  （「一覧で見る →」「← 一覧に戻る」「→ メールを送る」「プロフィール →」「ログアウト」…）。管理画面で
  書くリンクのラベル（Repository など）はデータなので外
- **見出しに訳語だけの添えを置かない。** 添え（`SectionHead` の `note`）は見出しに無い情報のとき
  だけ（業界 / プラットフォーム · 年、`/all` の作品の本文の Story、区分の絞り込みが並ばない Projects の区分名）
- **札の中で同じ語を2度言わない**（個人ページの帯は「このメンバーのつくったもの」で、右端が「一覧で見る →」）
- 英数字と日本語のあいだに半角スペースを1つ
- 状態は「公開 / 下書き」で固定。Yes/No や色だけで区別しない

## よくある変更

**Projects に項目を足す・トップの節を並べる** → 管理画面から。コードは触らない。

**プラットフォームの種類を増やす** → `npx drizzle-kit generate --custom --name <名前>` で空の移行を
作り、`INSERT OR IGNORE INTO platforms …` を1行（0011 に倣う）。本番へ `d1 execute --remote` で
手打ちしない（リポジトリに残らない）。

**メンバーの項目（列）を増やす** → `src/db/schema.ts` → `npm run db:generate` →
`src/routes/admin/members.tsx` のフォームと `src/routes/public/member-page.tsx`・
`src/ui/components.tsx` の表示。`drizzle/` の SQL は手で書かない。

**見た目のプリセットを増やす** → `src/theme.ts` の一覧と、`public/app.css` の同じ key の
`[data-accent]` / `[data-typeface]` の両方（片方だけだとテストが落ちる）。骨格（並べ方）は選ばせない。

**ブロックの種類を増やす** → **4か所**。`src/blocks.ts` の `BLOCK_TYPES` に1行 → 同じファイルの
`blockShown` に1分岐 → 描く部品を components.tsx → `src/routes/public/blocks.tsx` の
`renderBlock` に1分岐。2つの `switch` に `default` を置かない（足し忘れを TS2366 で落とす）。
中身が無ければ `null`。body は「1行1件・`|` 区切り」で `parseLines`、行と段落に開く式は
`blockLines` / `blockTexts` / `blockUnitCount` が1本の正。見出し部品に `h1={!whole}` を渡す
（型は黙っている）。
- **公開ページで落とす中身は、管理画面でも保存させない**（`blockValueErrors` と
  `publishErrors`）。リンク集は**全部の行**が通るときだけ保存し、落ちる行を名指しする。落ちるかは
  `blockLines` に聞く（`isSafeUrl` の条件を写さない）
- 関門が見る長さは**名前と目録の文だけ**（`MAX_CHARS`: 作品名 32・説明 100・大見出し 80・
  ブロックの見出し 10。ひとことの一文 120 は `MAX_STATEMENT_SENTENCE`）。どれも「その字が出る場所の
  役目」で決めた数で、ページの高さの話ではない。中身（段落・行・タグ・リンク）の長さや数は見ない
  ——ページは縦に読むので、1画面に収めるための上限は外した

**公開の関門は1か所、「published が 1 になるとき」**（`publishErrors`）。書く・編集で公開・一覧の
「公開する」・作品とメンバーの保存が、どれもこの1本を通る。一覧の「公開する」を止めたら 303 で
その行の編集画面へ（`?publish=blocked`）。公開のトグルを足すなら同じ関門を通す。

**下書きに戻す保存では長さを見ない**（見ると、長い行が公開を外すことすらできない行き止まりになる）。
作品の下書きで見るのは題と受け取れない値（画像・URL・並び順・消えた担当とプラットフォーム）だけ。
作品名と説明の長さ・代替テキスト・**説明が空であること**（メンバーは大見出しの長さ）は
公開するときにだけ止める。
説明の無いまま公開された作品の説明文は事実から組む（`src/routes/public/item.tsx` の `itemFacts`）。
書くブロックは中身が空なら下書きでも作らせない。

**作品の保存は、全部書けるか何も書かないか**（1つの `db.batch`。`src/routes/admin/items.tsx` の
`childWrites`）。新しい子の行は親を slug で引く。**複数行の INSERT は束縛変数の上限（1文に
100 個）を超えないように分ける。** KV の画像は batch の外で、順序で守る。

**編集は `_version` を照合する。** 競合は入力を残して409。`src/db/edit.ts` の検査を batch の先頭に置き、子の書き換えまで原子的に止める。設定は値と日時のスナップショットで比較。
**追加は `form_key` で重複を防ぐ。** 再送による更新はまだ編集されていない行だけ。公開の関門も通す。

**決まった中身のブロック（hero / projects / team / contact）は1つずつ。3か所で守る**——部分一意
索引 `blocks_fixed_once`（`FIXED_BLOCK_KEYS` から作る）、書く側の1文（`src/db/queries.ts` の
`initBlocks`）、読む側の重複落とし（`publishedBlocks`）。

**並び順の欄は全角の数字も読む。** 読めなければ 400 で欄を示し、黙って別の数に倒さない
（`src/lib/format.ts` の `int`）。

**ページや URL を足す・変える** → 登録順を守る（下の「気をつける場所」）。新しい URL の族は
`/sitemap.xml` にも1行（`src/routes/public/crawl.ts`）。目次と canonical と題は、サイトの並び
（`src/routes/public/site.ts` の `sitePageLinks`）を `tableOfContents` に渡せば付いてくる。
URL を動かすなら前の URL は転送で残す（貼られたリンクを殺さない。転送元は sitemap に載せない）。
`docs/screens.md` と `docs/flow.md` も同じ変更の中で直す（ずれた図は無いよりたちが悪い）。

**作品の恒久リンクの URL を変える** → `itemHref` と `src/routes/public/routes.ts` のルート
（前の本文の画面 `…/story` の転送も）はセット。1語目は `ITEM_KINDS` の `path` の1か所。

**slug は管理画面から変えてよい。前の URL は新しい URL へ 301**（転送表 `item_slug_redirects` /
`member_slug_redirects`。区分を変えた作品の前の区分の URL も）。欄を空にしても作り直さない。ほかの行の前の slug はいまの slug として
使わせない（前の URL が黙って別の作品を指す）。自分の前の slug へ戻すのは通る。
- **行き先がデータで変わる転送は、ブラウザに覚えさせない**（`Cache-Control: no-cache`。
  `src/routes/public/page.tsx` の `movedTo`）。301 は期限なしで覚えられ、slug を戻した日に無限
  ループになった。行き先が動かない転送（`/apps` → `/projects`）は素の 301
- **D1 を手で直して slug を変えないこと**（転送表に残らない）。D1 を手で直したら
  `npm run site:touch`

**サイト全体の文言と連絡先** → 管理画面の「サイト設定」（`/admin/site`）。初期値と検査は
`src/site.ts`。`heroLead` の長さを変えたら `check:contrast` も。

**管理画面に入れるアカウントを替える** → `wrangler.toml` の `[vars]` と D1 の `user_identities` /
`owner_claims` の行。コードは触らない（手順は README の「管理画面に入る」）。

**入口の軌道図の形を変える** → `src/lib/orbits.ts`（`MAX_ORBITS`・`inner` / `outer`・離心率と近点・
`ELEVATION`・`CAMERA`・`TILT`・`hole`・帯と星屑の数）。枠の縦横比と傾きは `app.css` の
`--system-ratio` / `--contact-ratio` / `--system-tilt` とそろえ、`npm test`・`check:fit`・`check:contrast`。
星雲の `NEBULA_LOBES`・CSS の色・4層の濃さを変えたら、`scripts/nebula/render.mjs` で素材と版も更新する
（手順は README）。

**ロゴの形や色を変える** → `src/ui/logo.ts`（素材に焼く色 `LOGO_COLORS` は `:root` の段と同じ値。
`test/theme.test.ts` が突き合わせる）→ `node scripts/logo/export.mjs` で素材を書き直す → `npm test`。

## 触るときの作法

- **コメントは WHY を厚く書く。ただし「いま成り立つ理由」だけを。** 経緯は、外すと同じ失敗に
  戻る、の1〜2文だけにし、顛末はコミットメッセージに置く。**実装を変えた日は、それを説明していた
  コメント（ほかのファイル・CLAUDE.md・README・docs も）を grep して同じ変更の中で直す。** 名指し
  したファイル・関数・テストの名前が在ることと層の向きは `test/source.test.ts` が見ている
- `npm run typecheck` `npm run lint` `npm test` を通してから push する。CSS・
  マークアップの高さを触ったら `npm run check:fit`、軌道図かそのまわりの字を触ったら
  `npm run check:contrast`（`npm test` は workerd の中なので版面を持たない）。**成功行を毎回読む**
  （URL の数が README の表より減っていたら測れていない。読み方は README の「確かめる」）
- `check:fit` は使い捨ての D1 に中身を入れて測る。数（名前の上限）は `src/blocks.ts` をそのまま読む
  （`scripts/lib/ts-import.mjs`。Node の型の読み飛ばしなので、`src/` に enum のような「型を落とす
  だけでは動かない」書き方を持ち込まない）。測り方は箱の位置（ブラウザが解いた結果）で、
  貼り付けは本文の下に空きを足して一番下まで送って確かめる（中身が短いページでも必ず試す）
- `check:contrast` は**文字を消した地だけを撮る**（合成後の画面ではグリフ自身を背景に数える）。
  **上限だけでなく下限も見る**（軌道図が薄くなる・消えるのは改善ではない）
- 2つとも**自分で立てたサーバだけを測る**。ポートが使われていたら止まる（`FIT_PORT` /
  `CONTRAST_PORT` で分ける）。止まる手を外さない——相手のサーバを測って緑を出したことがある
- 直した不具合には、同じ形のテストを1つ足す。CSS の不変条件は `test/theme.test.ts` の `ruleWith` /
  `blockAt` / `bodyOf` で、**必ずコメントを落とした写し（`sheet`）を読む**（規則を引用した
  コメントに当たって永久に緑、が3件あった）。管理画面は `adminSheet`、サイト全体の決まりは
  `sheets`。`ruleWith` / `bodyOf` は後ろで上書きされていたら落ちる。**効いているか**は `check:fit`
  が計算済みのスタイルで見る
- 公開ページの本文を確かめるテストは `test/helpers.ts` の `okText` を通す（404 の空の本文で
  「含まない」が緑にならないように）
- 型検査は `test/**` も、Biome は `public/**` と `scripts/**` も見る
- `npm run lint` は**警告も落とす**。規則を外すときは理由をその場かここに書く。いま外しているのは
  `noDescendingSpecificity` だけ（幅の括りと入力手段の括りで、素の部品を後から上書きする書き方
  そのもの）
- `compatibility_date` はテスト側の workerd が対応する日付に揃える

### 移行

- スキーマを変えたら `npm run db:generate`。**手で書いてよいのは、スキーマの変わらないデータの
  書き換えだけ**（`--custom` で空のファイルを作り、頭に理由を書く）。**ほかの列から決まる値は
  生成列にする**（`items.year_from`。アプリが埋めると、アプリを通らない行でずれる）
- **D1 では `PRAGMA foreign_keys=OFF` が効かない。** drizzle-kit が表の作り直し（`__new_<表>` と
  `DROP TABLE`）を生成したら、そのまま当てない（子の行が cascade で消える）。列を落とすだけなら
  `ALTER TABLE … DROP COLUMN`。既存の行を持った D1 での形は、`test/oauth.test.ts` の「移行」のように
  `MIGRATION_DB` に前の移行まで流して行を入れてから確かめる
- **データを書き換える移行は、expand → contract の2リリースで出す。** 移行は deploy より先に
  流れるので、「新しい DB ＋ 前のコード」（deploy の失敗・`wrangler rollback`）も「前の DB ＋
  新しいコード」（流し忘れ）も起きる。先のリリースで読む側を広げ（`src/blocks.ts` の
  `LEGACY_BLOCK_KEYS`）、`test/deploy.test.ts` の「前の DB ＋ 今のコード」のように、書き換えの
  前後で同じ HTML になることを確かめる。前の形を外してよいのは、どの環境にも当たったあと
- `0006_oauth_identities`・`0007_hash_sessions` は例外として同時に旧認証列を落とした。
  それより前の Worker へ戻すなら D1 も移行前へ戻す（README）。
- **`seed.sql` はローカルの開発・検査専用で、中身を全部消す。** `db:seed:local` だけが
  流す。本番への seed 経路は作らず、内容は管理画面から登録する。作品の検査画像は
  `scripts/fixtures/media/` に置き、ローカルの KV にだけ投入する（public/ に含めない）。

### 本番へ出す道

- **移行は deploy がいつも流す**（`.github/workflows/deploy.yml`。順序は README の「出す」）。
  移行を流さないと 500 か、無い列の名前が字のまま出る（SQLite が文字列として読む）ので、選択肢に戻さない。門は
  `check.yml` を `workflow_call` で呼び、2か所に書き写さない
- **本番の守りは GitHub の側に置く。** environment `production` の Deployment branches を `main`
  だけに、Required reviewers を付け、`CLOUDFLARE_API_TOKEN` はその environment の secret に**だけ**
  置く（リポジトリの secret には置かない）。deploy.yml の「main から実行しているか」は実行した
  ブランチの YAML にあって消せるので、守りに数えない
- workflow の中では、トークンは **wrangler を呼ぶ step の `env` にだけ**渡す（job の env に置くと
  `npm ci` の install スクリプトや action から読める）。`permissions: contents: read`。action は
  **commit の SHA で固定**し、行末にタグ名を残す（`test/deploy.test.ts` が形を見る）
- **本番の写しは定義と中身の2本で取る**（`--no-data` と `--no-schema`）。1本の export は、子の表の
  行が親の CREATE TABLE より前に来て空の D1 に戻せない。戻せることは `npm run check:restore` が
  毎回確かめる。画像も `scripts/media-backup.mjs` で控えを取り、取得済み D1 の参照とSHA-256を照合する。復元は `check:media-restore`、管理の実操作は `check:admin`。artifact は90日保持

## 気をつける場所

- **固定のルートは `/:screen` より前に登録する。** `src/routes/public/routes.ts` の `/:screen` と
  `/:screen/:page` は catch-all で最後にある。下に足した固定ルートは吸われて**静かに 404** になる
  （`test/public.test.ts` の「URL の登録順」。`docs/screens.md` の URL 表も登録順）。catch-all は
  1語目がページの名前の形（`PAGE_NAME`）のときだけ D1 に聞く——ページの名前の付け方（`renderBlock`
  の `id`）を変えるなら、ここも一緒に変える
- **`<html>` を直に書かない。** 外枠はどれも `src/ui/components.tsx` の `HtmlDocument` で開く
  （DOCTYPE を出す。無いと互換モードで組まれる。`test/public.test.ts` の「文書の外枠」）
- **`public/` に置いたファイルは Worker より先に配られる**（`public/robots.txt` を置くと Worker の
  ほうが届かなくなる）。例外は `public/_headers` で、ヘッダの規則として読まれ配られない

**応答のヘッダ**は `src/index.tsx` のミドルウェア1本が、全部の応答（公開・管理・404・500・
リダイレクト・robots・sitemap）に掛ける。ルートごとに書くと、足したルートだけが素で出る。
- CSP（中身は `src/index.tsx`）は公開・管理それぞれの固定 helper の exact hash だけを許す。プレビューは同一オリジン内の埋め込みを許すが script は許さない。style の
  `'unsafe-inline'` は `style` 属性で渡す値（軌道図の置き場所・件数の数え上げ・ページの
  切り替えの名前・アバターの寸法）のため。外のサイトの画像・書体・スクリプトを読むなら、
  ここを一緒に直す（直さないと黙って読み込まれない）。CSP を変えたら、全公開
  URL と管理画面の主な画面を Chromium で開いて違反が出ないことを確かめる（`npm test` はブラウザの
  CSP を持たない）
- `Referrer-Policy` を **`no-referrer` にしない**（同じオリジンの POST に `Origin: null` が付き、
  `sameOrigin` が管理画面の保存を全部止める）。`X-Content-Type-Options: nosniff` はどの応答にも
- `/admin/*` は `Cache-Control: no-store`。公開ページはログイン中だけ `private, no-store`
  （`adminHref`）で、ミドルウェアは上書きしない。**ルートが自分の CSP を持っていたら上書きしない**
  （`/images/*`）
- `public/` の静的なファイルはミドルウェアを通らないので `public/_headers`（上限 100 本）

**公開ページの「管理画面」の入口はログイン中だけ出る**（`src/routes/public/page.tsx` の
`adminHref`。クッキーが無ければ D1 に聞かない。行き先は `blockAdminPath`）。出したページは
`private, no-store`——外すと、入口つきのページが共有のキャッシュから次の訪問者に出る。`check:fit` は
ログインした姿も測る。

**公開ページの HTML は写し（Cache API）から出す**（`src/lib/page-cache.ts` の `pageCache`）。
- **写しが正しいかは内容の版で決める。** 版は KV の `site:version` で、管理画面の書き込みが上げる
  （`touchSiteOnWrite`）。**管理画面の外に書く口を足したら、そこでも `touchSite` を呼ぶ**（呼ばないと
  最大1時間、前の画面が出る）。版の読みはエッジのキャッシュを通すので、反映は最大 60 秒ほど遅れる
- **管理画面を通らない書き換えは、自分で版を上げる**（`npm run site:touch`。seed は自分で上げる。
  テストで D1 を直に書いたら `test/helpers.ts` の `touch`）
- **デプロイで写しは全部外れる**（鍵に `CF_VERSION_METADATA` の版）
- **D1 が例外を投げたら、いまの版の写しだけを返す。** 版が変わった写し（書き込みのあと）は障害の
  間も出さない——取り下げた作品が戻ってこないように。版を読めないときも出さない。別の DB で描き
  比べるテストは `uncachedEnv()`
- 写しを通らないのは、セッションのクッキーを持つ要求・GET 以外・`/admin`・`/images/*`・
  `/robots.txt`・最後の語に「.」を含む URL（`/sitemap.xml` を除く）。置くのは 200・301・302・404
  だけで、**`set-cookie` と `private` / `no-store` を持つ応答は置かない**（ログイン中の応答を
  写しに置かない約束はこれが守る）。`no-cache` の応答は置き、返すときに付け直す。写しの印は訪問者に
  出さない（出すのは `x-astlog-cache` だけ）

**`/images/*` は KV をそのまま読む。** キーの形の検査（`src/routes/public/images.ts` の
`IMAGE_KEY`）は外さない・緩めない——この URL は KV のキーを外に開く口で、同じ KV に置いた別の
ものが黙って読めるようになる。置き場を足すときは1語足すだけ。応答には必ず `nosniff` と
`Content-Security-Policy: default-src 'none'; sandbox` を付け、content-type は許可リスト
（`isImageType`）にあるものだけをそのまま返し、ほかは `application/octet-stream` の添付
（KV には受け入れを絞る前の SVG・HEIC が残っている）。

**`sameOrigin` は認証の壁より外側に掛ける**（内側だと壁の外の POST が素通り）。見る順は Origin →
Sec-Fetch-Site → Referer で、origin ごと比べる。`Origin: null` は 403。3つとも無い POST は通す
（ブラウザ以外からしか来ず、管理画面の POST は Lax のセッションが要る）——**クッキー無しで受ける
POST を足すなら**ここを見直す。

**ログインは GitHub / Google の OAuth だけ**（往復は `src/routes/admin/auth.tsx`、提供元との約束は
`src/lib/oauth.ts`、誰を通すかは `src/lib/auth.ts` の `userForIdentity`）。
- **本人は ID で照合する**（GitHub は数値の id、Google は sub）。環境変数は**最初の紐づけにだけ**
  使い、大小を無視するのは ASCII のアドレスだけ（`toLowerCase` はケルビン記号を `k` にする）。
  画面から紐づけ・外しをさせない（盗んだセッションで持ち主を締め出せる）
- **環境変数の値は（提供元, 値）ごとに1度きり**（`owner_claims`）。記録と紐づけは同じ batch で書き、
  紐づけは記録の ticket がこの往復の乱数のときだけ
- **owner は1人**（部分一意索引 `users_one_owner`。ON CONFLICT DO NOTHING で作ってから読み直す）
- **ログインの入口は IP ごとに数える**（`[[ratelimits]]`。D1 に書く前に 429。
  `src/routes/admin/auth.tsx` の `tooManyStarts`）。**全体の上限にしない**（叩く側が埋めると持ち主も
  入れない）。多くの IP からなら WAF で外から止める
- **state は D1 で1回きり**（`oauth_states`）と同じ値のクッキー。callback は**両方の札を、成否に
  かかわらず先に消して**から比べる。クッキーは `SameSite=Lax`・`Path=/admin/auth`（Strict だと
  提供元からの戻りで送られない）
- **トークンを持たない**（本人の ID を引いたら捨てる。ログにも例外にも入れない。外への fetch には
  `AbortSignal.timeout`、提供元の失敗は 502）
- **Google の id_token の署名は確かめていない**（トークンエンドポイントから TLS で直接受けたもの）。
  iss・aud・exp・nonce は見る。ブラウザ経由で受ける形に変えるなら JWKS で確かめる
- 入口はフォームではなく GET のリンク（POST から外へのリダイレクトは CSP の `form-action` に止まる）
- **`wrangler dev` の中では `c.req.url` が本番の顔をしている。** コールバックは `.dev.vars` の
  `OAUTH_REDIRECT_ORIGIN` で渡す（`src/lib/oauth.ts` の `callbackUrl`）。ヘッダーから組まない
- **セッションの id は D1 にはハッシュで置く**（`src/lib/auth.ts` の `sessionKey`）。ログインのたびに
  発行し直す。全部を切るのは管理画面の「すべての端末からログアウト」
