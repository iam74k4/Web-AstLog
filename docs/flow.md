# 画面遷移図

GitHub 上でそのまま図として表示される（Mermaid）。画面の一覧は
[screens.md](./screens.md)。

## 公開側

公開ページは節ごとに1ページ（入口・Projects・Profile・Contact と打ち込むブロック）で、
普通に縦にスクロールする。骨格は上の帯（ロゴと目次）・本文・足元で、目次の1行が1ページ、
上の帯はページの上に貼り付いていつでも押せる。ページからページへの移動は普通のフルページ遷移
（CSS の view transitions で短く切り替わる）。見る人は目次で飛ぶか、入口の「作品を見る →」から
入るか、一覧の行から作品1件へ入るか、Team のカードから個人ページへ入るかの
4つだけ。**画面の底のページャ（← 前 / 次 →）は無い**——以前は「1画面に収めてスクロール
させない」ために節を画面ごとに割り、底の左右の手でめくっていた。持ち主が触って「面倒すぎる」と
判断してやめた。個人ページも上の帯と足元はサイトのまま。

個人ページへの入り方は人数で変わる。

- **1人のサイト（Team を置いているとき）**: Team のページは無い。その位置にその人のページ
  （`/members/<slug>`。名札 → About → Skills → Career を縦に並べた1ページ）が並び、目次では
  「Profile」の1行。`/team` と `/profile` はそこへ 301
- **2人以上のサイト**: Team のカードから入る（目次の印は Team）

下の図は両方の形を1枚に載せ、片方にしか無い矢印には（2人以上）（1人のサイト）と
添えてある。

```mermaid
flowchart LR
    Top["トップ（並びの先頭）<br>GET /"]
    Screen["ページ<br>GET /:screen"]
    OldPage["割っていたころの続き<br>/:screen/:page"]
    Filtered["絞り込んだ一覧<br>/projects?kind= ・ ?member="]
    Moved["以前の一覧<br>/apps ・ /works（続きも）"]
    Item["作品1件（恒久リンク）<br>/apps/item/:slug ・ /works/item/:slug<br>本文は小節 #story"]
    OldStory["前の本文の画面<br>…/item/:slug/story"]
    Whole["全体 GET /all"]
    Profile["メンバー個別<br>/members/:slug<br>小節 #about ・ #skills ・ #career"]
    OldTeam["1人のサイトの Team<br>/team"]
    ProfileAlias["プロフィールの別名<br>/profile"]
    OldMember["前の個人ページの続き<br>/about ・ /skills ・ /career（…/:page も）"]
    Contact["サイトの Contact<br>/contact"]
    Mail["メールソフト"]
    NotFound["404"]
    Admin["管理画面（そのページを直す場所）"]

    Top -->|"上の帯の目次"| Screen
    Screen -->|"上の帯の目次（先頭の Hero へはロゴ）"| Screen
    Screen -->|"上の帯のロゴ"| Top
    Top -->|"作品を見る →"| Screen
    Top -->|"プロフィール →（1人のサイト）"| Profile
    OldPage -->|"301（同じページへ。query は付けたまま）"| Screen
    Moved -->|"301。同じ区分で絞る"| Filtered

    Screen -->|"絞り込みを押す"| Filtered
    Filtered -->|"「すべて」で外す"| Screen

    Screen -->|"一覧の行（面ごと押せる）"| Item
    Item -->|"← 一覧に戻る（一覧のその行 #item-slug）"| Screen
    Item -->|"目次（Projects に印）"| Screen
    Item -->|"行き先の「担当 名前 →」（2人以上、または Team が無いとき）"| Profile
    Item -->|"前の slug・前の区分の URL → 301（いまの URL へ）"| Item
    OldStory -->|"301（#story へ。本文が無ければページの頭へ）"| Item
    Profile -->|"前の slug → 301（いまの URL へ）"| Profile
    OldMember -->|"301（#about などの小節へ。無ければページの頭へ）"| Profile

    Screen -->|"Team のカード / プロフィール →（2人以上）"| Profile
    Screen -->|"目次の Profile（1人のサイト）"| Profile
    OldTeam -->|"301（1人のサイト）"| Profile
    ProfileAlias -->|"301（1人のサイト。ほかは 404）"| Profile
    Screen -->|"一覧の行の担当者名（2人以上、または Team が無いとき）"| Profile
    Profile -->|"上の帯のロゴ"| Top
    Profile -->|"目次（サイトのもの。Team に印／1人のサイトは Profile に印）"| Screen
    Profile -->|"このメンバーのつくったものの帯（2人以上のサイト）"| Filtered
    Profile -->|"/members/:slug/contact → 301"| Contact

    Whole -->|"上の帯のロゴ"| Top

    Contact -->|"アドレスの手（メールを送る）/ GitHub"| Mail
    Profile -.->|"下書き / 存在しない slug"| NotFound
    OldMember -.->|"知らない続きの名前"| NotFound
    Screen -.->|"ページの名前の形でない（D1 に聞かずに）"| NotFound
    Item -.->|"下書き / 知らない slug"| NotFound
    NotFound -->|"トップへ戻る"| Top

    Top -.->|"上の帯の「管理画面」（ログイン中だけ）"| Admin
    Screen -.->|"上の帯の「管理画面」（ログイン中だけ）"| Admin
    Item -.->|"上の帯の「管理画面」（ログイン中だけ）"| Admin
    Profile -.->|"上の帯の「管理画面」（ログイン中だけ）"| Admin
```

目次には番号を振らない。目次は `src/lib/sequence.ts` の `tableOfContents` が、サイトの
ページの並び（`src/routes/public/site.ts` の `sitePageLinks`）から1本で組み、トップも個人
ページも作品のページも同じところを通る。いまのページの行に印が付く（作品のページは
Projects、個人ページは Profile か Team）。先頭の Hero へはロゴで戻り、ほかは見出しの有無に
関わらず目次から開ける（ひとこと・見出しのないメモも含む）。`/all` は見出しの一覧を目次にする。

絞り込み（区分・メンバー）は**ページを移る**。絞り込みの手はリンクで、押すと絞り込んだ一覧の
ページへ遷移する。絞り込みは目次の Projects の行き先にも同じ query が付いて、目次から
一覧へ戻っても外れない。もう一度同じ手を押すとその軸だけ外れる（「すべて」は両方）。
内容と導線は SSR で成立し、公開ページは JavaScript を1本も持たない。

作品1件のページ（`/apps/item/<slug>` ・ `/works/item/<slug>`）は、一覧の行を開いたものと、
本文を書いた作品なら説明の下の小節「Story」（`#story`）。画像（あれば）はここに大きく出る
（2枚以上なら、小節「Screenshots」（`#screenshots`）で先頭を大きく見せ、
続きは番号と説明を添えたギャラリーに並べる）。
頭の「← 一覧に戻る」は一覧のその作品の行（`/projects#item-<slug>`）へ戻す——一覧は
全件を1ページに並べるので、開いた行の所から読み続けられる。作品同士をめくる手は無い
（隣の作品は、戻った一覧の隣の行）。目次の印は Projects に付く。一覧の行は面ごと
ここへのリンクで（中の Repository と担当者名はそれぞれの行き先へ）、出る条件は「その作品が
公開中」の1つだけ——Projects の節を外しても、貼られたリンクは死なない（そのときは
「← 一覧に戻る」を出さない）。以前の本文の画面（`…/<slug>/story`）は `#story` へ 301。
管理画面で slug を変えた作品・メンバーの前の URL と、区分を変えた作品の前の区分の URL は、
いまの URL へ 301 で寄せる（前の slug は `item_slug_redirects` / `member_slug_redirects`
に残っている）。変えた日に名刺や SNS に貼ったリンクが切れる、を起こさない。
この 301（と1人のサイトの `/team` と `/profile`・個人ページの Contact・前の個人ページの続き・
前の本文の画面の 301）は行き先がデータで変わるので、`Cache-Control: no-cache` でブラウザに覚えさせない
——slug を元に戻した日に、前の転送を覚えたブラウザがリダイレクトの無限ループにならないように。

個人開発と業務は、公開ページでは Projects の1つの一覧（新しい順・全件）。以前の一覧の URL
（`/apps` `/works` とその続き）は、同じ区分で絞った `/projects` へ 301 で寄せる。割って
いたころの続き（`/projects/2`）も `/projects` へ 301（絞り込みは付けたまま）。

「構成」で節を外しても、行き止まりを作らない。

- 入口の「作品を見る →」と件数、2人以上のサイトの個人ページの帯は Projects へ送り、件数は
  区分ごとに数える（`個人開発 5 · 業務 2`。項目の無い区分は数えない）。Projects を外した
  サイトでは出さない
- 一覧の行の担当者名（個人ページへのリンク）は、2人以上いるとき**か、Team を
  置いていないとき**に出す。Team が無いと、トップから個人ページへ行く道が
  ほかに1本も無い。作品1件のページの「担当」も同じ条件
- `?member=` は名前の絞り込みが並ぶとき（2人以上）だけ効く。1人のサイトでは読まず、
  個人ページの帯も付けない。効かせると「すべて」にも名前にも印が付かないまま
  一覧だけが絞られる

全体ページ（`/all`）は公開ページからリンクしない（足元は著作権表示と行き先だけ）。
管理画面の「構成」から開く（`sitemap.xml` にも載る）。印刷・Ctrl-F・翻訳・全体の点検のための
1本で、サイトの全部が1つの文書に並ぶ。詳しくは [screens.md](./screens.md#全体ページ)。

管理画面へは、**ログインしている人にだけ**上の帯に出る「管理画面」から行く（訪問者の
見た目は変わらない）。目次のすぐ後ろ（帯の右端）に置く。
行き先は「いま見ているページを直す場所」で、`src/routes/public/page.tsx` の `blockAdminPath`
が決める。

| 見ているページ | 行き先 |
|---|---|
| 入口（Hero） | 1人のサイトならその人の編集、それ以外はサイト設定 |
| Projects | 項目の一覧（`/admin/items`。個人開発 / 業務のタブ） |
| Team（2人以上のサイト） | Members 一覧 |
| Contact | サイト設定（`/admin/site`。文言と公開する宛先を編集） |
| 打ち込むブロック（ひとこと・メモ …） | そのブロックの編集 |
| 全体ページ（`/all`）・0件のトップ | 構成 |
| 作品1件 | その項目の編集 |
| 個人ページ（1人のサイトのプロフィールも） | その人の編集 |

同じタブで開く（管理画面の「サイトを見る ↗」は別タブ。両方を別タブにすると、
直して見に行くたびにタブが増える）。

機械に読ませる `/robots.txt` と `/sitemap.xml` は、人の導線には出てこない。
どちらも Worker が公開ページと同じ式から組み立てる。

## 管理側

ログイン後は概要から次の設定に進む。追加・編集・削除は「一覧 → フォーム → 一覧」で閉じ、
削除は確認を挟む。保存済みの内容は下書きもプレビューできる。メンバー・作品・ブロック・
サイト設定・見た目の入力中の内容も、選んだ画像とともにダイアログで確認してから保存できる。

```mermaid
flowchart TD
    Login["ログイン<br>GET /admin/login"]
    Dashboard["概要・次の設定<br>GET /admin"]
    Preview["管理者専用プレビュー<br>/admin/preview/*<br>保存・公開はしない"]
    Members["Members 一覧<br>GET /admin/members"]
    Account["アカウント<br>GET /admin/account"]
    Items["Projects（個人開発 / 業務）<br>GET /admin/items?type="]
    MForm["Member フォーム<br>/members/new ・ /:id/edit"]
    IForm["Item フォーム<br>/items/new ・ /:id/edit"]
    MDel["削除の確認<br>GET /members/:id/delete"]
    IDel["削除の確認<br>GET /items/:id/delete"]
    Blocks["構成<br>GET /admin/blocks"]
    BForm["ブロックフォーム<br>/blocks/new?type= ・ /:id/edit"]
    BDel["外す確認<br>GET /blocks/:id/delete"]
    Look["見た目<br>GET /admin/appearance"]
    SiteSettings["サイト設定<br>GET /admin/site"]
    Public["公開ページ<br>/ ・ /all"]

    Login -->|"GitHub / Google でログイン（認証の節）<br>成功 → 303（?next= があればそこへ）"| Dashboard
    Dashboard --> Members
    Dashboard --> Items
    Dashboard --> Blocks
    Dashboard --> SiteSettings
    Dashboard --> Look
    Dashboard -->|"保存済み全体を確認"| Preview
    MForm -->|"保存済みは別タブ / 入力中はダイアログ"| Preview
    IForm -->|"保存済みは別タブ / 入力中はダイアログ"| Preview
    BForm -->|"保存済みは別タブ / 入力中はダイアログ"| Preview
    SiteSettings -->|"フォームをプレビューに POST・保存しない"| Preview
    Look -->|"フォームをプレビューに POST・保存しない"| Preview
    Members <-->|"左ナビの足元の名前"| Account
    Account -->|"すべての端末からログアウト<br>POST /admin/account/logout-all → 303 ?out=all"| Login
    Members <-->|"左ナビ"| Items
    Items <-->|"左ナビ"| Blocks
    Blocks <-->|"左ナビ"| Look
    Look <-->|"左ナビ"| SiteSettings
    SiteSettings -->|"POST → 303 ?saved=1<br>不正な値なら 400"| SiteSettings

    Blocks -->|"↑↓ POST /:id/move → 303 #block-id"| Blocks
    Blocks -->|"公開/下書き POST /:id/publish → 303 #block-id"| Blocks
    Blocks -->|"公開にするのを関門が止めた → 303 /:id/edit?publish=blocked"| BForm
    Blocks -->|"足す（決まった中身）<br>POST /admin/blocks → 303 #block-id"| Blocks
    Blocks -->|"サイトを見る ↗"| Public
    Blocks -->|"保存済みの全体をプレビュー ↗"| Preview
    Members -->|"サイトで見る ↗（公開中の行）"| Public
    Public -->|"上の帯の「管理画面」（ログイン中だけ。その画面を直す場所へ）"| Members
    Blocks -->|"足す（打ち込む）/ 編集"| BForm
    BForm -->|"POST → 303 ?saved=1 / ?saved=draft"| Blocks
    BForm -->|"入力エラー → 400"| BForm
    Blocks -->|"外す"| BDel
    BForm -->|"外す"| BDel
    BDel -->|"POST → 303 ?deleted=1"| Blocks
    BDel -->|"キャンセル（編集から来たら編集へ）"| BForm
    Look -->|"POST → 303 ?saved=1<br>選べない値なら 400"| Look

    Members -->|"＋ Add / 編集"| MForm
    MForm -->|"POST → 303 ?saved=1 / ?saved=draft"| Members
    MForm -->|"キャンセル"| Members
    MForm -->|"入力エラー → 400<br>打った内容は残したまま描き直す"| MForm

    Items -->|"＋ Add / 編集"| IForm
    IForm -->|"POST → 303 ?saved=1 / ?saved=draft"| Items
    IForm -->|"キャンセル"| Items
    IForm -->|"入力エラー → 400"| IForm

    Members -->|"ゴミ箱"| MDel
    MForm -->|"削除"| MDel
    MDel -->|"POST → 303 ?deleted=1"| Members
    MDel -->|"キャンセル（来た画面へ）"| Members

    Items -->|"ゴミ箱"| IDel
    IForm -->|"削除"| IDel
    IDel -->|"POST → 303 ?deleted=1"| Items
    IDel -->|"キャンセル（来た画面へ）"| Items
```

保存に成功すると 303 リダイレクトで終わるので、リロードしても二重に登録されない。
送信ボタンの2度押し（遅い回線・送り直し）は、追加のフォームが描くときに持つ
一度きりの札（`formKey`）で止める——同じ札の2度目は新しい行を作らず、1度目がその札で
作った行がまだ編集されていなければその行への保存になる（編集後の古い送信は409で拒否。中身が同じなら書き直すだけ、「戻る」で開き直して
直した・公開に印を付けたなら、それを反映して公開の関門も通す。知らせは
「1度目に作ったものに書きました」まで言う）。JS の有無にかかわらずサーバーで重複を止める。「この並びから始める」は1文の INSERT で、決まった中身のブロックは DB の
部分一意索引で、同時に来た2本目を止める。

左ナビの足元の「サイトを見る ↗」は、どの画面からも公開ページを別タブで開く。

下書きで保存したときは `?saved=draft` を返し、「下書きで保存しました。サイトには
まだ出ていません」と言い分ける。「保存しました」だけだと、サイトに出たと思われる。
書くブロック（ひとこと・数字 …）もメンバー・項目と同じく下書きから始める。

削除の確認は、来た画面へキャンセルで戻す。編集フォームの「削除」から来たときは
`?from=edit` が付いていて、キャンセルで編集フォームへ戻る（一覧へ飛ばすと、
直しかけていた行を探し直すことになる）。

構成の ↑↓ と「公開／下書き」は、行ごとの小さなフォーム。1回押すごとに1つ動いて
一覧に戻る。ドラッグ&ドロップにしないのは、JavaScript を増やさないため。
戻り先には `#block-<id>` を付け、触った行へ着地させる（行の枠がアクセント色になる）。
足したブロックは Contact の手前に入る——末尾に付けると締めの連絡先の後ろに
来てしまい、↑ を何度も押して運ぶことになる。

**公開の関門は「published が 1 になるとき」に1か所**（`src/blocks.ts` の
`publishErrors`）。ブロックを新しく書く・編集で公開にする・構成の一覧の「公開する」・
作品の保存・メンバーの保存が、どれも同じ関数を通る。一覧の「公開する」が止められたら、
303 でその行の編集画面へ送り（`?publish=blocked`）、理由と「公開する」の印を付けて描く
——直して保存すれば公開になる。

下書きに戻す方向（一覧の「下書きにする」と、「公開する」を外した保存）は、中身の長さを
検査しない。検査すると、上限より前に保存された長い中身を持つ行が「引っ込めることすら
できない」行き止まりになる（残る手が本文ごと削除だけになる）。上限は公開するものに掛ける
（以前はメンバーの紹介文だけが下書きでも長さを見ていて、その行き止まりが残っていた）。

長さではなく**値そのもの**が受け取れないものは、下書きの保存でも 400 で止める——
画像（中身が PNG・JPEG・WebP・AVIF・GIF のどれでもない、1MB を超える）と、URL
（作品のリンクの `javascript:`・頭を省いた相対 URL・ラベルか URL の片方だけの行、
メンバーの GitHub の `https://` 以外、リンク集の落ちる行）と、書くブロックの空の中身と、
数として読めない並び順（全角の数字は読む）と、消えた担当メンバー・プラットフォーム。
どれも公開ページが落とすか、DB が受け取れないもので、直すのは同じフォームの中で済む
（リンクとリンク集は何行目かを言う）。画像を選んで別の欄で止められたときは
「画像はまだ保存していません」と添える。

作品の保存は、行・タグ・リンク・転送表を**1つの batch**で書く（全部書けるか何も
書かない）。1本ずつ書いていたころは、タグを 34 個付けると D1 の束縛変数の上限で
途中の INSERT が落ち、前のタグとリンクはもう消えていた。

画像のある保存は、検査が全部通ってから KV に置き、そのあと D1 を書く。D1 で
落ちたら置いた画像を消してから 500 を返す（どの行からも指されない画像を残さない）。
差し替えた前の画像を消すのは、D1 が通ったあと。

ログインした POST は、終わったあとで公開ページの写しの版（KV の `site:version`）を
上げる（`src/lib/page-cache.ts` の `touchSiteOnWrite`）。上げないのは 4xx で止めた保存
だけ。訪問者の画面が新しくなるのは、ほかの場所では版の読みのキャッシュが切れる
最大 60 秒ほどあと。保存した本人はクッキーで写しを通らないので、公開ページへ
行けばすぐ新しい画面が出る。

1行も無いうちは「足す」を出さない。0件のトップは既定の並びで描いているので、
先にそれを行にしてから触らせる。直接 `POST /admin/blocks` が来たときも、
足す前に既定の並びを行にする（足したのに4節が消える、を起こさないため）。

見た目とサイト設定は一覧を持たず、保存すると同じ画面に戻る。固定の項目を
編集するので、「どれを編集中か」を示す一覧が要らない。

## 認証

ログインは GitHub / Google の OAuth だけ（パスワードは無い）。ログイン画面の2つは
フォームではなく GET のリンクで、往復は `/admin/auth/:provider/start` と `callback`。

```mermaid
flowchart TD
    Any["/admin/* を開く"]
    Check{"Cookie の<br>セッションは有効か<br>（D1 にはハッシュで引く）"}
    Login["ログイン画面<br>GET /admin/login"]
    Start["GET /admin/auth/:provider/start<br>D1 に state・verifier・nonce（10分）<br>同じ state をクッキーに"]
    Busy["429<br>ログインの試行が多すぎます"]
    Provider["GitHub / Google<br>（本人が許可する）"]
    Callback["GET /admin/auth/:provider/callback<br>state の札を先に消す"]
    State{"クッキーと query の state が一致し<br>期限内で、提供元も同じか"}
    Exchange{"code をトークンに換え<br>本人の ID を引けたか"}
    Who{"user_identities に<br>（提供元, ID）があるか"}
    Owner{"OWNER_GITHUB_ID と同じ id か<br>確認済みの OWNER_GOOGLE_EMAIL か<br>その値はまだ使っていないか（owner_claims）"}
    Link["owner に紐づける<br>（owner の行が無ければ作る。owner は1人）"]
    Admin["管理画面<br>（前のセッションを捨てて発行し直す）"]
    Refuse["403<br>このアカウントでは入れません"]
    Broken["502<br>提供元との通信に失敗"]

    Any --> Check
    Check -->|"はい"| Admin
    Check -->|"いいえ → 303 ?next=開いた画面"| Login
    Login -->|"GitHub でログイン / Google でログイン"| Start
    Start -->|"同じ IP から 60 秒に 10 回を超えた<br>（D1 に書かない）"| Busy
    Start -->|"302（PKCE・state。Google は nonce も）"| Provider
    Provider -->|"断った → ?error=denied"| Login
    Provider -->|"?code&state"| Callback
    Callback --> State
    State -->|"いいえ → ?error=expired"| Login
    State -->|"はい"| Exchange
    Exchange -->|"いいえ"| Broken
    Exchange -->|"はい"| Who
    Who -->|"はい"| Admin
    Who -->|"いいえ"| Owner
    Owner -->|"はい"| Link
    Link --> Admin
    Owner -->|"いいえ"| Refuse
    Admin -->|"POST /admin/logout<br>セッションを消す"| Login
```

- 本人は提供元の ID で照合する（GitHub は数値の id、Google は sub）。ログイン名や
  メールアドレスを見るのは、最初の紐づけのときだけ
- ログインの入口は、同じ IP から 60 秒に 10 回まで（Workers の Rate Limiting）。
  超えたぶんは D1 に書かずに 429
- state は D1 で1回きり。成功しても弾いても、差し出された札（クッキーの側と
  query の側）はその場で消える。同じ URL をもう一度開いてもやり直しになる
- Google の id_token は iss・aud・exp・nonce を確かめ、合わなければ 400。署名は、
  トークンエンドポイントから TLS で直接受け取ったものなので確かめない（OIDC Core 3.1.3.7）
- アクセストークンは本人の ID を引いたら捨てる。保存しない・ログに出さない
- `POST` は送り元も確認する（Origin → Sec-Fetch-Site → Referer。`Origin: null` は 403）。
  ログアウトも対象
- ログインし直したら `?next=` の画面へ戻す。受け付けるのは `/admin/` の中だけで、
  外の URL・`//`・`..`・ログインの往復やログアウト自身は捨てて `/admin` へ送る

## 最初の紐づけ

最初の owner を作る入口（`/admin/setup`）は無い。`wrangler.toml` の `[vars]` と
一致するアカウントで初めてログインしたとき、そのアカウントが owner に紐づく。
`[vars]` の値が効くのは値ごとに1度だけ（使った値は `owner_claims` に残る）。

```mermaid
flowchart LR
    First["初めてのログイン<br>（user_identities に行が無い）"]
    Gate{"GitHub: id = OWNER_GITHUB_ID<br>Google: 確認済みで<br>アドレス = OWNER_GOOGLE_EMAIL"}
    Used{"その値はもう使ったか<br>（owner_claims に行があるか）"}
    Existing{"owner の行があるか"}
    Keep["その行に紐づける<br>（id もメンバーも変えない）"]
    Create["owner を1件作って紐づける"]
    Admin["管理画面<br>/admin"]
    Refuse["403"]

    First --> Gate
    Gate -->|"はい"| Used
    Used -->|"いいえ（記録を残す）"| Existing
    Used -->|"はい"| Refuse
    Existing -->|"はい（パスワードの頃から居る）"| Keep
    Existing -->|"いいえ"| Create
    Keep --> Admin
    Create --> Admin
    Gate -->|"いいえ"| Refuse
```

GitHub と Google の両方を、同じ owner に紐づけられる（片方で入ったあと、もう片方でも
一度ログインする。同時に初めて入っても owner は1人——部分一意索引 `users_one_owner`）。
紐づいたあとは `[vars]` を書き換えても外れない。外すのは `user_identities` の行を
消すこと（README の「管理画面に入る」）。外したアカウントは、同じアカウントで入り直しても
紐づき直らない（その値はもう使ってある）。また使うときは `owner_claims` の行も消す。
同じ確認済みのアドレスを持つ別の Google アカウント（別の sub）も、同じ値では紐づかない。
