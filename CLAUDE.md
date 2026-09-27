# このリポジトリでの書き方

構成・動かし方・検査の読み方・本番の出し方と戻し方は `README.md`、画面一覧と遷移図は
`docs/`、月の作り方は `docs/moon.md`。ここには「迷ったらこうする」だけ——決まりと、その
理由を1〜2文と、詳しい場所——を書く。手順と経緯は書き写さない（写しは片方だけ古くなる）。

## 決まりごと

### 値と文字

**値は `public/app.css` の `:root` だけで決める。** 各セレクタに生の色やサイズを書かない
（`public/admin.css` も `:root` を持たず、app.css の段を読むだけ）。余白は7段。文字は
**静的6段**（`--fs-label` 11 / `--fs-meta` 12 / `--fs-sm` 13 / `--fs-base` 14 /
`--fs-md` 15 / `--fs-lg` 18）と、画面に連動する**4段**（`--fs-display-xl` > `--fs-display` >
`--fs-display-sm` > `--fs-display-xs`）の計10段。連動する4段は大きさ順の1本のはしごで、
部品の名前を持たない（名前を付けると、その部品でしか使えない段が増える）。セレクタに書いた
生の `font-size` は0（`.avatar__fallback` だけは `--avatar-size` からの比率なので例外）。
中間の値が欲しくなったら、たいてい既存の段で足りる。

**和文の最小は `--fs-meta`（12）。** `--fs-label`（11）は和文が入らない英大文字の小見出し
（Skills の英字の小見出し・管理画面の ADMIN・404 の番号）だけ。**等幅（`--font-mono`）は
英数字の札だけ**。打ち込んだ字が入る札は、日本語を1字も含まないときだけ
`src/ui/components.tsx` の `langOf` が `lang="en"` を付け、等幅はその `:lang(en)` にだけ
掛ける。年と期間は和文を含むので等幅にせず `tabular-nums`。`test/theme.test.ts` の
「文字の段」がセレクタを名指しで数えている——足すのは和文が入らないと確かめてから。

**見出しと本文の段。** 節の見出し（`SectionHead` の `h1`、`/all` の `h2`）は
`--fs-display-xs`（雑誌風は `--fs-display-sm`）で、カードの題（`--fs-md`）より2段以上
大きい。カードの説明は `--fs-base`、段落（`.bio p`）は `--fs-md` で、1行は約40字
（`--measure: 40em`）。小節の見出し（`SectionHead` の `sub`。作品の Story の `h2`、`/all` の
Profile の `h3`）は `--fs-lg` で線を引かない（雑誌風でも上げない）。個人ページの章（About /
Skills / Career の `h2`。`SectionHead` の `chapter`）は節の見出しの字面のまま上を1段空け、頭の
大見出し（`h1`・`--fs-display-sm`）を越えないよう雑誌風でも上げない。

**折り返しは文節で。** 見出し・カードの説明・段落に `word-break: auto-phrase` と
`text-wrap: pretty`（app.css の `.phrase` のすぐ下の1本。知らないブラウザは捨てる）。
句読点で塊に切る `Phrases` は短い一文（入口の大見出しとリード文・個人ページの大見出し・
締めの誘いの1文）だけに使う——長い段落を塊に切ると、行末に大きな空きが残る。

### 幅と入力

**幅は画面ごとではなく部品ごとに決める。** メディアクエリは 600 と 900 の2つだけ。
連続して変わるものは `clamp()`。タッチは `pointer: coarse`、ホバーは `hover: hover` で
分け、幅で入力手段を推測しない（iPad の横向きは広くてもタッチ）。押すものの的は `--tap`
（指で 44px）で、目次の行き先・管理画面への入口・入口の「すべてを1ページで読む →」
（`.hero__whole`）も指では同じ的。

高さは別の決まり: 連動する4段の可変部を `@supports (font-size: 1svh)` の中で
`min(Xvw, Ysvh)` に差し替える（背の低い窓で見出しが画面を食わない）。メディアクエリは
増やさない。

**目次の帯は、いまのページの行き先が見える位置で開く。** 帯の姿（899 以下と、上の帯になる
骨格の 900 以上）では印（`aria-current`）に `scroll-initial-target: nearest` と、ぼかしの
ぶんの `scroll-margin-inline`。柱が縦に立つ rail の 900 以上には掛けない。上の帯の 900 以上は
帯を `overflow-x: auto` にする（溢れた行き先に手が届くように）。

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

**スタイルシートは2枚。** 公開ページは `app.css` だけ、管理画面は `app.css` のあとに
`admin.css`。管理画面の部品の規則は admin.css にだけ書く（訪問者に管理画面の規則を配らない）。
公開ページに出したくなったら規則ごと app.css へ移す。並びは app.css と同じ（素 → 600 → 900 →
手触り → 入力手段）。どの外枠が何を読むかは `Stylesheets` 1本（`test/headers.test.ts` の
「スタイルシート」、`test/theme.test.ts` の「スタイルシートの分け方」）。

**CSS は版つきの URL で、1年・immutable で配る。** `Stylesheets` が中身から版を作り
（`/app.css?v=…`）、`public/_headers` が2枚に `immutable` を付ける。**`<link rel="stylesheet">`
を直に書かない**（版の無い URL は古い写しを1年掴む）。版を持たない素材（ロゴ・月）に長い
`Cache-Control` を付けない。版は Worker に同梱した CSS の文字列から作る（`wrangler.toml` の
`[[rules]]`、テストでは `vitest.config.ts` の `cssTextPlugin`）。

### JavaScript とリンク

**公開ページに JavaScript は置かない。** いまは0本で、増やさない。絞り込みもページの移動も
リンクと query（`?kind=` `?member=`）、管理画面は HTML フォームと 303。JSON API も SPA も
持たない。「動きを付けたい」は、たいていページを1つ増やすほうで足りる。CSP の
`script-src 'none'` がブラウザに守らせていて、置いてよい `<script>` は JSON-LD だけ
（`test/headers.test.ts` が数える）。

**押せるように見えるものは、面ごと押せるようにする。** カードは題のリンク（`.card__link`）の
`::after` を面いっぱいに被せる（stretched link）。カードを `<a>` で包まない（中のリンクが
入れ子になる）。中のほかのリンクは `position: relative; z-index: 1`。フォーカスの輪郭は覆いの
縁の内側に描く（外だと並んだカードの間隔に出て、どちらを囲むか読み分けにくい。雑誌風は上の罫線を太く）。ホバーで浮かせるのは
`:has(.card__link)` だけ。`:has` はセレクタの列に素で並べない（知らないブラウザが列ごと
捨てる）——`:is()` の中か1本の規則に。

**矢印は行き先で使い分ける。** `↗` は外へ出る・別タブだけ、サイトの中の続きは `→`、一覧へ
戻る手は `←`（`BackLink`）。`LinkRow` は矢印を CSS が URL の頭で決め
（`.links a[href^='/']::after`）、`target` / `rel` は部品が同じ条件で決める。

### 作品と画像

**作品のページはカードを開いたもの。** 頭はカードと同じ部品（`Note`・`Metric`・`Tags`・
`LinkRow`）を並べ、足すのは画像（`Shot`）だけ（`ItemDetail`）。900 以上で画像がある作品は
文の列の右に画像（`.detail--shot`）。その下に本文（`items.body`）の小節「Story」
（`ItemStory`。`id="story"`・`h2`）。段落に開く式は `src/blocks.ts` の `itemStory` 1本
（ページ・全体ページ・転送が読む）。本文の無い作品は小節を出さない。
- 以前は本文を次の画面（`…/<slug>/story`）に分け、1枚目に「くわしく読む →」、作品同士を
  画面の底のページャでめくっていた。1ページにまとめたので、前の `…/story` は `#story` へ 301
  （本文が無くなっていればページの頭へ。`renderItem`）。作品同士をめくる手は置かない
- 「← 一覧に戻る」（`BackLink`）は一覧のその作品のカード（`/projects#item-<slug>`。カードの id は
  `src/ui/components.tsx` の `itemCardId`）へ。Projects を置いていなければ出さない
- `/all` では Projects の節のカードの下に小節で並べる（`ItemStories`）。カードの中に入れない

**画像の枠は絵に合わせない。** 枠の形は CSS が先に決める（絵に合わせると、読み込んだ瞬間に
下の字が押し下げられ、縦長の絵1枚でページの頭が埋まる）。作品のページは高さ `--shot-h`（`object-fit: contain`。900 以上は文の列の
高さまで伸びる）、サムネイルは `--thumb-ratio`（3:1。雑誌風は `--thumb-ratio-wide` 4:1。
`cover` で上寄せ）。寸法の列（`image_width` / `image_height`）は共有カードのためだけ。
- サムネイルは**どの幅でも出す**（`loading="lazy"`。一覧は縦に長い）。以前は 600 未満で畳み、
  電話の一覧には作品の絵がどこにも無かった
- 同じ行に画像の有る無しが混ざったら、無いほうにも空の枠を置く（600 未満では出さない——1列で
  そろえる相手が居ない。`.card__thumb:empty`）。行に1枚も無ければ枠を出さない
- カードの画像は飾り（`alt=""`）。名前は題のリンクが持つ

**カードは書いたぶんを全部出す。** 説明を行数で切らず、タグと行き先も畳まない（一覧は
1ページに縦に並ぶ）。以前は1画面に収めるために `--card-lines` / `--card-extras` で切っていて、
「何をしたか」の2文目がカードからほぼ読めない幅があった。長さは説明の上限（100 字の2文。
`MAX_CHARS.itemSummary`）で受ける。

**画像の置き場は KV の2つだけ**（顔は `avatars/`、作品は `items/`）。KV にはほかに写しの版の
1行（`site:version`）だけが同居し、`/images/*` からは読めない。キーは
`<置き場>/<slug>-<乱数8桁>.<拡張子>` で、付けるのは `src/routes/admin/images.ts` の `putImage`
だけ。取り込みの検査は `pickImage` の1本。**画像があるのに代替テキストが空なら、公開として
保存させない**（`publishErrors`）。

**画像の種類は中身の先頭のバイトで決める。** 通すのは5種類（`src/lib/image.ts` の
`IMAGE_FORMATS` が正。`accept` も配る側の許可リストもここから）、1MB まで。`file.type` と
拡張子は見ない（名乗りのまま配っていたころ、SVG の `<script>` がサイトのオリジンで走った）。
SVG と HEIC は理由を添えて 400。**画像の URL はフォームから受け取らない。**

**KV と D1 は順序で守る。** 新しい画像を KV に置く → D1 を書く（落ちたら置いた画像を消して
投げ直す。`commitWithImage`）→ 通ってから前の画像を `removeImage`。検査は全部 KV に置く前。
削除は D1 → KV。逆にすると、無い画像を指す行か、どこからも指されない画像が残る。

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
（`--ease-spring`）。部品ごとに量や曲線を変えない。面は白を薄く重ねた地と上辺の光
（`--highlight`）で立たせ、線に頼らない。`<button>` にも使う部品は地と書体を自分で持つ。
`prefers-reduced-motion` では全部止まる前提で、止まった姿でも読めるようにする。

例外は入口の月の出で、**ばねを使わず `--ease`**（ばねの行き過ぎは、`check:contrast` が測った
上限より明るい瞬間を作る）。keyframes の `from` に書いてよいのは止まった姿より**暗い・小さい・
上**だけ。一度きりで 5 秒以内に止める（WCAG 2.2.2。止める手段を JavaScript 無しでは置けない）。

### 一覧と画面の組み方

**一覧は件数で形を変える。** Team は 2人なら横長カード、3人以上ならグリッド、1人なら Team の
ページを作らずその人のプロフィールに置き換える（下の「このサイトは1人として名乗る」）。0件なら
節ごと出さない。見出しだけ残さない。

Projects の**列の数もサーバーが決める**（`src/blocks.ts` の `PROJECT_COLUMNS` を
`style="--cols:2"` で渡し、app.css は 600 以上で `repeat(var(--cols), minmax(0, 1fr))`）。
広い画面ほど列が増えて本文が細る、を起こさない。`style` を落とすと規則ごと無効になって
静かに1列へ落ちる。

**トップは決まったブロックの並び。** 置く・外す・並べ替えるのは管理画面の「構成」から。
見た目を変える口は作らない（どう並べても統一感が崩れない）。

**同じ行き先を1つのページに2つ置かない。** Contact のページで柱の GitHub / メールを出さない、
1人のサイトのプロフィールに帯を出さない（入口の帯と同じ行き先・同じ件数）、作品のページに
「くわしく読む →」を置かない（本文はすぐ下の小節）。

**技術の補足は行に1度**（`src/lib/format.ts` の `skillRows`、描くのは `SkillGroups`）。補足と
項目は `<dl>` の `dt` / `dd` で結ぶ（読み上げでどの項目の補足か分かるように）。

**中央寄せの骨格が中央に組むのは、入口・締め・ひとことだけ。** 節の見出しと「← 一覧に戻る」、
個人ページの頭（名札・大見出し。`Hero` の `profile`。すぐ下に About が続く）は左に置き、本文の列と
同じ軸に立てる。Hero に子を足したら中央へ寄せる列にも足す（`check:fit` が
Hero の子の中心がそろうかを測る）。

**柱が上の帯になる骨格（中央寄せ・雑誌風の 900 以上）は足元の役を持たない。** 中央寄せは帯を
2段にし著作権表示を出さない（`.rail__copy`）。雑誌風は1段にし、名札・目次・足元の**縦の中心**を
そろえる。**帯の段の数を中身で変えない**——目次は1行の横帯で残りの幅を取り（`flex: 1 1 0`、
溢れたら右端をぼかす）、職種は `--role-w` で末尾を省く。`/all` は逆に目次を折り返す。
**どのページも横には動かない**（`check:fit` が `/all` の `scrollWidth` を測る）。

### 公開ページは縦に読む

**節ごとに1ページ。ページは普通に縦にスクロールし、目次はページの上に貼り付ける。** 入口・
Projects・Profile・Contact と打ち込むブロックがそれぞれ1ページ（目次の1行＝1ページ）で、中身は
全部そのページに並ぶ。行き来は目次とページの中のリンク（入口の帯・カード・「← 一覧に戻る」）
だけで、**画面の底のページャ（← 前 / 次 →）は置かない**。以前は「1画面に1つぶんだけを収め、
ページはスクロールしない」を不変条件にして、入りきらないぶんを次の URL に割り、ページャで
めくっていた。持ち主が実際に触って「スクロールできず、底の左右の手でしかめくれないのが面倒
すぎる。Profile → About → Skills みたいな」と判断してやめた。
- **前の URL は殺さない。** `/<ページ>/<n>` は `/<ページ>` へ素の 301（query は付けたまま）、
  `/members/<slug>/about`・`/skills`・`/career`（と `/<n>`）は `/members/<slug>#about` などへ、
  `…/item/<slug>/story` は `#story` へ（どちらも行き先が中身しだいなので `movedTo` の no-cache。
  小節が無くなっていればページの頭へ）。sitemap には転送元を載せない
- **件数や字数でページを割らない。** 1画面に収めるための数（`perScreen`・`maxChars`・紹介文や
  本文の字数・タグとリンクの本数）は外した。残した数は Projects の列（`PROJECT_COLUMNS`）と、
  名前と目録の文の長さ（`MAX_CHARS`。下の「よくある変更」）だけ

外枠は app.css の末尾「ページの外枠」（`@media screen` の括り。紙には当てない）で、役は4つ。
- **表紙は1画面ぶんの高さを下限に持つ。** `.shell` の `min-height: var(--screen-h)`（`height` に
  しない——決め打つと長い中身がページの外で切られる）。入口の Hero と締めの Contact はその高さに
  月を敷く（月の丈は節に対する %。`check:contrast` の姿はこの高さで測る）
- **目次は貼り付ける。** 帯の姿（899 以下の全骨格・中央寄せと雑誌風の 900 以上）は
  `position: sticky; top: 0` と地（`--bg`）と `z-index: 2`（中身の `z-index: 1` より上）。空きは
  負の margin で戻し、貼り付く前の版面を動かさない。帯の姿の `.shell` は縦の flex（grid の子の
  sticky は自分の grid area から出られない）。rail の 900 以上は素の規則で柱が貼り付き、画面より
  高ければ柱の中だけが動く。`/all` は外枠の外（表紙も帯の貼り付けも持たない）
- **送った先を帯の下に止める。** html の `scroll-padding-top` に `:root` の `--band-clear` /
  `--band-clear-wide`（帯のいちばん高い形 + 間）。帯の高さを変えたらこの段も
- `html` と `body` に `overflow: clip` / `hidden` や高さの決め打ちを書かない。節に `overflow` を
  持たせない（スクロール箱はページ1つ。以前の「弁」と、そのための節の `tabindex="0"` と
  `--focus-inset` は外した——ページがスクロールするので要らない）。`main` の直接の子は
  `Screen` / `Hero` だけが作る
- **節は上揃え（見出しの錨）**（`align-content: safe start`）。目次でページを移っても見出しが同じ
  高さに居る（上下中央に寄せると、表紙の高さより短いページで見出しの位置が中身の量で跳ねる）。錨を持たないのは Hero と月の節だけ。見出しより前に子を足すなら全ページに足すか、錨の測り方と
  一緒に決め直す（`check:fit` が 1px 以内を測る）。節を2つ以上持つページ（個人ページ）では最後の
  節だけが残りの高さを受ける（`:not(:last-child)` の `flex-grow: 0`。名札を画面の真ん中に浮かせない）
- **レイアウトは `check:fit` が測る。** 設計サイズは3つ × 骨格3つ＝9通り（正は
  `scripts/lib/viewports.mjs`）で、**390 と 768 は指で測る**。測るのは横のはみ出し・切られた
  要素・`h1` の数・目次の貼り付け（一番下まで送っても見える）・送った先・指の的・見出しの錨

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

### 柱と個人ページ

**899 以下で畳むものに、「畳んだぶんがどこにも無くなるもの」を入れない。** 畳むのは4つ
（肩書き・柱の一言 `.identity__tagline`・柱の中の GitHub / メール・著作権表示）と、名乗るページの
ワードマーク（`.brand__word`）。畳む規則は柱の中（`.identity .socials`）だけを名指しする
（素の `.socials` を隠して GitHub へ辿れなくなったことがある）。ワードマークは `display: none`
にしない（ロゴのリンクの名前がこの字だけ。`.sr-only` と同じ手で見た目から外す）。柱の名前は
畳まない。畳まれる足元の全体ページへの1本は、入口の `WholeLink` が受ける。

**柱は入口の外で名乗る。** 1人のサイトなら、入口以外のすべてのページで柱に名前と職種を出す
（`src/ui/components.tsx` の `SiteIdentity`）。入口では出さない（Hero の `h1` と2度並ぶ）。
2人以上のサイトでは柱に名前を出さない。顔は個人ページの名札（`.nameplate`）にだけ。
**行き先の違う同じ名前の札を並べない**——2人以上のサイトの個人ページでは、その人の札
（`OwnSocials`）が読み上げの名前でその人を名乗る（`aria-label="青木 春香の GitHub"`。見た目の字を
含める、WCAG 2.5.3）。柱のほうは外さない（柱はどのページでも同じサイトの柱）。

**個人ページは1ページで、サイトの並びの一部。** `/members/<slug>` に 名札 → 大見出し → About →
Skills → Career を縦に並べる（`src/routes/public/member-page.tsx` の `memberPage`。小節は
`#about` などの id、書いていない Skills / Career は出さない）。柱も目次もサイトのままで、専用の
ものに入れ替えない（別のサイトへ飛んだように見え、戻る道も無かった）。組み方は
`src/routes/public/member.tsx` の `renderMemberScreen`。
- 1人のサイト（Team を置いているとき。`profileOf`）: Team の位置にこのページが入る。目次は
  「Profile」の1行で、このページでその行に印（`src/routes/public/site.ts` の `PROFILE_KEY`）。
  About などの小節は目次に並べない。`/team` はこのページへ 301
- 2人以上: Team から入るページ。目次の印は Team
- Team を置いていないサイト: 並びの外（目次に印は無い。カードの担当者名から入る）
- 個人ページだけの Contact は持たない（`/members/<slug>/contact` はサイトの Contact へ 301）

**このサイトは1人として名乗る。** 文言は `src/site.ts` の `tagline` と `heroLead`、それ以外は
「公開中のメンバーがちょうど1人か」（`src/routes/public/data.ts` の `soloMember`）で決まる。
1人のあいだは Team の代わりにプロフィール、`/all` でも Profile の節。管理画面の「構成」の
Team の行も「プロフィールに置き換わる」と言う。2人目を公開すると自動で器（Organization）と
Team に戻る。人数は数えて告知しない。

### 作品の並びと選択肢

**選択肢は表で持つ。** プラットフォームは `platforms` テーブルが正（自由入力は表記ゆれで札が
揃わない）。行を入れるのは移行で、`seed.sql` ではない（破壊的な seed にしか無いと、新しい環境の
用意に本番の全消去が要る）。

**個人開発と業務は、公開ページでは1つの一覧（Projects）。** データの区分（`items.type`）と
管理画面の入力欄は分かれたまま、公開ページでは新しい順（年 → 並び順 → 作った順。
`src/db/queries.ts` の `itemOrder`）で混ぜる。**並び順は区分をまたいで1つの数の並びとして比べる。**
- **並べる年は `items.year_from`**——DB が year から作る生成列（VIRTUAL）で、書く口は無い。頭が
  数字4桁でない年は null で最後。同じ規則の写しが `src/lib/format.ts` の `yearFrom`（知らせる側）で、
  変えるなら2つ一緒に。**全角の数字は保存のときに半角へ直し（`readItemForm`）、`yearFrom` は
  全角を読まない**（DB の glob と同じ ASCII の規則）
- **`itemOrder` と items の索引3本（`idx_items_public` / `_kind` / `_member`）はセット**
  （並びだけ変えると全件を読む形に黙って戻る。`test/queries.test.ts` の「索引」）
- **区分の一覧は `src/domain.ts` の `ITEM_KINDS` が正**（値・URL の語・呼び名。enum・
  `KIND_LABEL`・`itemHref`・ルートと 301・帯の件数・管理画面のタブはここから作る）。前の `/apps`
  `/works` は `/projects` へ 301、作品の恒久リンクは貼られたまま動かす

### 入口の月と Contact

**入口の月は、絵に色を持たせない。** `public/assets/moon.*` はアルファ1面だけで、色は app.css が
`--accent` から作って mask で抜く（三日月は `.moon__mark::after`、光暈は `::before`）。焼き込むと
アクセントへの追従と、光と形を別に置けることを失う。**色を混ぜる式は `:root` に置けない**
（`var()` は宣言した要素で解決され、`[data-accent]` が効かなくなる。`:root` が持つのは割合
`--moon-tint` と坂 `--moon-glow` まで）。

**月の上に乗る文字には、色ごとの上限がある。** 見出し `--ink` は大きい文字（3:1）なので
**横切ってよい**。リード文 `--ink-mid` は 4.5:1 なので**避ける**。帯の字・`.hero__whole`・
`.contact__lead` は光暈の上に乗る小さい字なので `--ink-mid`（`--ink-weak` では足りない）。
三日月は `--moon-top` + `--moon-h` で見出しの帯までに収める。明るさは `--moon-ink` で、その上限は
「見出しの後ろのいちばん明るい画素」が決める（連続した階調の絵を明るくするなら
`scripts/moon/pack.py` の `GAMMA`）。`heroLead`・見出し・`--moon-*` を変えたら
`npm run check:contrast`。作り方と経緯は `docs/moon.md`。

**月はサイトの並びの最初と最後に出る。** 締めの月は入口の三日月を左右に返し、小さく、動かさずに
置く（`.moon--closing`。受ける節は `Screen` の `moonlit`）。`/all` には出さない。締めの月に動きを
付けるなら、先に `check:contrast` に途中の姿を測る段（入口の `motion`）を足す。

**Contact のページに置く字は、誘いの1文だけ**（`src/site.ts` の `contactLead` とボタン2つ）。見出しや
アドレスは置かない（ボタンと同じことを言うだけ）。1文は `--ink-mid`。見出しは `.sr-only` の `h1`
「Contact」で残す。`/all` では目に見える見出し・同じ1文・アドレスの字も置く（印刷の宛先）。
`contactLead` は `/contact` の description にも使う。

## 文言

- 見出しは言い切り。動詞で終える
- **本文は「です・ます」**（`SITE.heroLead`・紹介文・`SITE.contactLead`・`items.body`）
- **カードの説明（`items.summary`）は常体の2文**（「何であるか。何をしたか。」）。目録の文なので
  本文と文体で分ける。管理画面の欄のヒントにも同じことを書いてある
- ラベル（タグ・役割・年）は名詞のまま。文にしない
- **期間は「2024.03 — 現在」「2024 — 現在」。** 先を空けない（「2024 —」は書きかけに見える）
- **実績値の添えは、値と単位のあとに続けて読んで意味が通る形**（「20 人日 見込み 40人日から半減」。
  `Metric` / `metricDigest`）
- **節の名前は英語の固有名、操作の言葉は日本語。** 節の名前＝目次・見出し
  （Projects / Profile / About / Skills / Career / Contact / Team / Story）。操作の言葉＝押す手の言葉
  （「一覧で見る →」「← 一覧に戻る」「メールを送る →」「プロフィール →」「ログアウト」…）。管理画面で
  書くリンクのラベル（Repository など）はデータなので外
- **見出しに訳語だけの添えを置かない。** 添え（`SectionHead` の `note`）は見出しに無い情報のとき
  だけ（業界 / プラットフォーム · 年、`/all` の作品の本文の Story、ピルの無い Projects の区分名）
- **札の中で同じ語を2度言わない**（入口の帯は「つくったもの」で、右端が「一覧で見る →」）
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
`[data-layout]` / `[data-accent]` / `[data-typeface]` の両方（片方だけだとテストが落ちる）。

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

**追加のフォームは一度きりの札を持つ（`form_key`）**（JavaScript が無く、押したボタンを止められない）。
**同じ札の2度目の送信は、1度目がその札で作った行への保存**（`saveItem` / `saveMember` /
`saveBlock`）で、公開の関門も通す。知らせは実際に起きたことを言う。

**決まった中身のブロック（hero / projects / team / contact）は1つずつ。3か所で守る**——部分一意
索引 `blocks_fixed_once`（`FIXED_BLOCK_KEYS` から作る）、書く側の1文（`src/db/queries.ts` の
`initBlocks`）、読む側の重複落とし（`publishedBlocks`）。

**並び順の欄は全角の数字も読む。** 読めなければ 400 で欄を示し、黙って別の数に倒さない
（`src/lib/format.ts` の `int`）。

**Projects の列の数を変える** → `src/blocks.ts` の `PROJECT_COLUMNS` だけ。CSS は触らない
（列の数はサーバーが `--cols` で渡す）。`npm run check:fit` を通す。

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

**サイト全体の文言** → `src/site.ts`。`heroLead` の長さを変えたら `check:contrast` も。

**管理画面に入れるアカウントを替える** → `wrangler.toml` の `[vars]` と D1 の `user_identities` /
`owner_claims` の行。コードは触らない（手順は README の「管理画面に入る」）。

**入口の月を焼き直す** → `docs/moon.md` の「焼く手順」（preset `final`・`pack.py`・pack が出す寸法を
`--moon-ratio` へ写す）。マークアップに寸法は無い。そのあと必ず `npm run check:contrast`（素材と
`--moon-ratio` の突き合わせもこれがやる）。**月の輪郭はロゴの多角形ではない**（`render.py` の
`OUTER` / `INNER` の2つの円。大きいと弦の折れ目が角に見える）。前の粒子版
（`scripts/moon/particles.py`）を焼くなら、`pack.py` の坂は逆なので引数で渡す。

## 触るときの作法

- **コメントは WHY を厚く書く。ただし「いま成り立つ理由」だけを。** 経緯は、外すと同じ失敗に
  戻る、の1〜2文だけにし、顛末はコミットメッセージに置く。**実装を変えた日は、それを説明していた
  コメント（ほかのファイル・CLAUDE.md・README・docs も）を grep して同じ変更の中で直す。** 名指し
  したファイル・関数・テストの名前が在ることと層の向きは `test/source.test.ts` が見ている
- `npm run typecheck` `npm run lint` `npm test` を通してから push する。CSS・列の数・
  マークアップの高さを触ったら `npm run check:fit`、月かその上の字を触ったら
  `npm run check:contrast`（`npm test` は workerd の中なので版面を持たない）。**成功行を毎回読む**
  （URL の数が README の表より減っていたら測れていない。読み方は README の「確かめる」）
- `check:fit` は使い捨ての D1 に中身を入れて測る。数（列・名前の上限）は `src/blocks.ts` をそのまま読む
  （`scripts/lib/ts-import.mjs`。Node の型の読み飛ばしなので、`src/` に enum のような「型を落とす
  だけでは動かない」書き方を持ち込まない）。測り方は箱の位置（ブラウザが解いた結果）で、
  貼り付けは本文の下に空きを足して一番下まで送って確かめる（中身が短いページでも必ず試す）
- `check:contrast` は**文字を消した地だけを撮る**（合成後の画面ではグリフ自身を背景に数える）。
  **上限だけでなく下限も見る**（月が暗くなる・消えるのは改善ではない）
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
  2つ: `noDescendingSpecificity`（骨格プリセットは素の部品を後から上書きする書き方そのもの）と、
  `public/assets/**` の `noSvgWithoutTitle`（`<img>` で貼るブランド素材）
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
- **例外は `0006_oauth_identities`**（と `0007_hash_sessions`）。パスワードのログインをやめた
  リリースで、`users` の `email` と `password_hash` を同じリリースで落とした——読む側だけを先に
  出すと、もう使わない秘密（パスワードのハッシュ）が D1 と deploy の写しに残り続けるため。代わりに、
  流したあとで前の版へ rollback すると管理画面が 500 になる。戻すなら D1 も deploy が残した移行前の
  栞まで戻し、そのあいだの書き込みは消える（README の「前の版の Worker へ戻すときの注意」）。
  列を落とす移行を足すときは、同じ注意を README に書く
- **`seed.sql` は中身を全部消す。本番には空の D1 に一度きり**（`db:seed:remote:destroys-prod` は
  件数を見て止まる）。短い名前の本番向け seed を戻さない（テストが package.json を見ている）

### 本番へ出す道

- **移行は deploy がいつも流す**（`.github/workflows/deploy.yml`。順序は README の「出す」）。
  列を足す移行を流さないと 500 になる（drizzle は列を名指しで読む）ので、選択肢に戻さない。門は
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
  毎回確かめる。artifact は Time Travel の期限より長く置く

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
- CSP（中身は `src/index.tsx`）の `script-src 'none'` が「JavaScript 0本」の壁。style の
  `'unsafe-inline'` は `style="--cols:2"` とアバターの寸法のため。外のサイトの画像・書体・
  スクリプトを読むなら、ここを一緒に直す（直さないと黙って読み込まれない）。CSP を変えたら、全公開
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
  出さない（出すのは `x-noctifex-cache` だけ）

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
