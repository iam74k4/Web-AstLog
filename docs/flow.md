# 画面遷移図

GitHub 上でそのまま図として表示される（Mermaid）。画面の一覧は
[screens.md](./screens.md)。

## 公開側

見る人の動きは短い。トップから個人ページへ行き、戻ってくるだけ。

```mermaid
flowchart LR
    Top["トップ /<br>（構成で置いたブロックの順）"]
    Profile["メンバー個別<br>/members/:slug"]
    Filtered["トップ・その人で絞り込み<br>/?member=slug"]
    Mail["メールソフト"]
    NotFound["404"]

    Top -->|"Team のカード / Profile ↗"| Profile
    Profile -->|"左上のロゴ"| Top
    Profile -->|"Apps · Works の帯"| Filtered
    Filtered -->|"同じページ内で絞り込むだけ"| Top
    Top -->|"Contact"| Mail
    Profile -->|"Contact"| Mail
    Profile -.->|"下書き / 存在しない slug"| NotFound
    NotFound -->|"トップへ戻る"| Top
```

Apps の絞り込み（プラットフォーム・メンバー）はページを移らない。`filter.js`
が同じページのカードを出し入れするだけで、JavaScript を切れば全件が出る。

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

    Login -->|"POST /admin/login<br>成功 → 303"| Members
    Members <-->|"左ナビ"| Items
    Items <-->|"左ナビ"| Blocks
    Blocks <-->|"左ナビ"| Look

    Blocks -->|"↑↓ POST /:id/move → 303"| Blocks
    Blocks -->|"足す（決まった中身）<br>POST /admin/blocks → 303"| Blocks
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

構成の ↑↓ は、行ごとの小さなフォーム。1回押すごとに1つ動いて一覧に戻る。
ドラッグ&ドロップにしないのは、JavaScript を増やさないため。

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
