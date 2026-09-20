# 画面遷移図

GitHub 上でそのまま図として表示される（Mermaid）。画面の一覧は
[screens.md](./screens.md)。

## 公開側

公開ページは1画面に1つぶん。ページはスクロールせず、移動は普通のフルページ遷移で
やる。見る人は連なりをめくるか、目次で飛ぶか、カードから作品1件へ入るか、
個人ページへ抜けるかの4つだけ。

```mermaid
flowchart LR
    Top["トップ（連なりの先頭）<br>GET /"]
    Screen["画面<br>GET /:screen"]
    Page["画面の続き<br>GET /:screen/:page"]
    Filtered["絞り込んだ1画面目<br>/apps?platform= ・ ?member="]
    Item["作品1件（恒久リンク）<br>/apps/item/:slug ・ /works/item/:slug"]
    Whole["全体 GET /all<br>（縦に伸びる唯一の1本）"]
    Profile["メンバー個別<br>/members/:slug"]
    MScreen["その人の画面<br>/about ・ /skills ・ /career ・ /contact<br>（続きは …/:page）"]
    Mail["メールソフト"]
    NotFound["404"]

    Top -->|"ページャ 次 →"| Screen
    Screen -->|"ページャ 次 →"| Page
    Page -->|"ページャ ← 前"| Screen
    Screen -->|"ページャ ← 前（先頭は /hero）"| Top
    Top -->|"左の目次"| Screen
    Screen -->|"左の目次（Hero は載らない）"| Screen
    Screen -->|"左上のロゴ"| Top
    Top -->|"入口の帯 Apps · Works"| Screen

    Screen -->|"ピルを押す"| Filtered
    Page -->|"ピルを押す"| Filtered
    Filtered -->|"「すべて」で外す"| Screen

    Screen -->|"カードの題"| Item
    Page -->|"カードの題"| Item
    Item -->|"目次（戻る道はこれだけ）"| Screen

    Screen -->|"Team のカード / Profile ↗"| Profile
    Profile -->|"左上のロゴ"| Top
    Profile -->|"ページャ 次 → / 目次"| MScreen
    MScreen -->|"ページャ ← 前（1枚目は目次に無い）"| Profile
    MScreen -->|"目次 About・Skills・Career・Contact"| MScreen
    Profile -->|"Apps · Works の帯"| Filtered
    MScreen -->|"目次の Apps · Works"| Filtered

    Top -->|"柱の足元（900 以上）"| Whole
    Screen -->|"柱の足元（900 以上）"| Whole
    Whole -->|"左上のロゴ"| Top

    Screen -->|"Contact の画面（メール / GitHub）"| Mail
    MScreen -->|"Contact の画面（メール / GitHub）"| Mail
    Profile -.->|"下書き / 存在しない slug"| NotFound
    MScreen -.->|"書いていない画面"| NotFound
    Page -.->|"範囲の外のページ数"| NotFound
    Item -.->|"下書き / 知らない slug / 種類の食い違い"| NotFound
    NotFound -->|"トップへ戻る"| Top
```

めくる先は `01 · 07` のページャ。`/apps/1` は `/apps` へ 303 で寄せる
（同じ画面に URL を2つ作らない）。1画面しか無いサイトではページャを出さない。
目次には番号を振らない——数え上げはページャ1つに寄せてある。画面の連なり
（前後・目次・通し番号・canonical）は `src/lib/sequence.ts` が1本で持っていて、
トップも個人ページも同じところを通る。

絞り込み（プラットフォーム・メンバー）は**ページを移る**。ピルはリンクで、
押すとそのブロックの1画面目へ遷移する——3画面目で絞り込むと、絞ったあとの
3画面目が無いことがあるため。絞り込みはページャにも目次にも同じ query が付いて
画面をまたいで効き、もう一度同じピルを押すとその軸だけ外れる（「すべて」は両方）。
公開ページは JavaScript を1バイトも持たないので、切っても何も変わらない。

作品1件のページ（`/apps/item/<slug>`）は**連なりの外にある1枚**。ページャは出さず、
戻る道は目次だけ。一覧のカードの題がここへのリンクで、出る条件は「その作品が
公開中」の1つだけ——Apps の節を外しても、貼られたリンクは死なない。

全体ページ（`/all`）へは、柱の足元の「全体を1ページで見る ↗」から行く。899 以下では
足元ごと畳まれるので、スマホの幅では画面から消える（`sitemap.xml` には載る）。
管理画面の「構成」からも同じ1本が開く。印刷・Ctrl-F・翻訳・全体の点検のための
1本で、ここだけは縦に伸びる。詳しくは [screens.md](./screens.md#全体ページ)。

機械に読ませる `/robots.txt` と `/sitemap.xml` は、人の導線には出てこない。
どちらも Worker が公開ページと同じ式から組み立てる。

## 管理側

追加・編集・削除は、どれも「一覧 → フォーム → 一覧」で閉じる。削除だけ確認を挟む。

```mermaid
flowchart TD
    Login["ログイン<br>GET /admin/login"]
    Members["Members 一覧<br>GET /admin/members"]
    Items["Apps・Works 一覧<br>GET /admin/items?type="]
    MForm["Member フォーム<br>/members/new ・ /:id/edit"]
    IForm["Item フォーム<br>/items/new ・ /:id/edit"]
    MDel["削除の確認<br>GET /members/:id/delete"]
    IDel["削除の確認<br>GET /items/:id/delete"]
    Blocks["構成<br>GET /admin/blocks"]
    BForm["ブロックフォーム<br>/blocks/new?type= ・ /:id/edit"]
    BDel["外す確認<br>GET /blocks/:id/delete"]
    Look["見た目<br>GET /admin/appearance"]
    Public["公開ページ<br>/ ・ /all"]

    Login -->|"POST /admin/login<br>成功 → 303"| Members
    Members <-->|"左ナビ"| Items
    Items <-->|"左ナビ"| Blocks
    Blocks <-->|"左ナビ"| Look

    Blocks -->|"↑↓ POST /:id/move → 303"| Blocks
    Blocks -->|"公開/下書き POST /:id/publish → 303"| Blocks
    Blocks -->|"足す（決まった中身）<br>POST /admin/blocks → 303"| Blocks
    Blocks -->|"サイトを見る ↗ / 全体を1ページで見る ↗"| Public
    Blocks -->|"足す（打ち込む）/ 編集"| BForm
    BForm -->|"POST → 303 ?saved=1"| Blocks
    BForm -->|"入力エラー → 400"| BForm
    Blocks -->|"外す"| BDel
    BDel -->|"POST → 303 ?deleted=1"| Blocks
    Look -->|"POST → 303 ?saved=1<br>選べない値なら 400"| Look

    Members -->|"＋ Add / 編集"| MForm
    MForm -->|"POST → 303 ?saved=1"| Members
    MForm -->|"キャンセル"| Members
    MForm -->|"入力エラー → 400<br>打った内容は残したまま描き直す"| MForm

    Items -->|"＋ Add / 編集"| IForm
    IForm -->|"POST → 303 ?saved=1"| Items
    IForm -->|"キャンセル"| Items
    IForm -->|"入力エラー → 400"| IForm

    Members -->|"ゴミ箱"| MDel
    MDel -->|"POST → 303 ?deleted=1"| Members
    MDel -->|"キャンセル"| Members

    Items -->|"ゴミ箱"| IDel
    IDel -->|"POST → 303 ?deleted=1"| Items
    IDel -->|"キャンセル"| Items
```

保存が必ず 303 リダイレクトで終わるので、リロードしても二重に登録されない。

構成の ↑↓ と「公開／下書き」は、行ごとの小さなフォーム。1回押すごとに1つ動いて
一覧に戻る。ドラッグ&ドロップにしないのは、JavaScript を増やさないため。

公開／下書きの切り替えと、「公開する」を外した保存は、中身の長さを検査しない。
検査すると、上限より前に保存された長い中身を持つ行が「引っ込めることすらできない」
行き止まりになる（残る手が本文ごと削除だけになる）。上限は公開するものに掛ける。

1行も無いうちは「足す」を出さない。0件のトップは既定の並びで描いているので、
先にそれを行にしてから触らせる。直接 `POST /admin/blocks` が来たときも、
足す前に既定の並びを行にする（足したのに5節が消える、を起こさないため）。

見た目だけは一覧を持たず、同じ画面に戻る。選ぶものが3つしかないので、
「どれを編集中か」を示す一覧が要らない。

## 認証

```mermaid
flowchart TD
    Any["/admin/* を開く"]
    Check{"Cookie の<br>セッションは有効か"}
    Login["ログイン画面"]
    Rate{"直近15分の失敗が<br>5回以上か"}
    Verify{"メールと<br>パスワードが一致するか"}
    Admin["管理画面"]

    Any --> Check
    Check -->|"はい"| Admin
    Check -->|"いいえ → 303"| Login
    Login -->|"POST"| Rate
    Rate -->|"はい → 429"| Login
    Rate -->|"いいえ"| Verify
    Verify -->|"はい → Cookie 発行"| Admin
    Verify -->|"いいえ → 401"| Login
    Admin -->|"POST /admin/logout<br>セッションを消す"| Login
```

- ユーザーが居ないときも、必ず1回ハッシュを計算してから失敗を返す。応答の速さで
  アカウントの有無が分からないようにするため
- 失敗の回数は KV に 15 分の期限付きで置く。厳密な回数制限ではなく、総当たりを
  鈍らせるためのもの
- `POST` は Origin も確認する。ログイン・ログアウト・初期設定も対象

## 初回だけ通る道

owner がまだ1人も居ないときだけ、この入口が開く。

```mermaid
flowchart LR
    Setup["初期設定<br>/admin/setup"]
    Gate{"users が空、かつ<br>SETUP_TOKEN が一致"}
    Create["owner を1件作る"]
    Login["ログイン画面"]
    Gone["404"]

    Setup --> Gate
    Gate -->|"はい"| Create
    Create -->|"303"| Login
    Gate -->|"いいえ（2回目以降）"| Gone
```

`SETUP_TOKEN` は `wrangler secret put SETUP_TOKEN` で入れる。パスワードを
リポジトリに置かずに最初の1人を作るための仕掛けで、作った後は通らなくなる。
