# 画面遷移図

GitHub 上でそのまま図として表示される（Mermaid）。画面の一覧は
[screens.md](./screens.md)。

## 公開側

公開ページは1画面に1つぶん。ページはスクロールせず、移動は普通のフルページ遷移で
やる。見る人は連なりをめくるか、目次で飛ぶか、カードから作品1件へ入るか、
Team のカードから個人ページへ入るかの4つだけ。個人ページも柱と目次はサイトのまま。

個人ページへの入り方は人数で変わる。

- **1人のサイト（Team を置いているとき）**: Team の画面は無い。その位置にその人の画面
  （1枚目 → About → Skills → Career）がサイトの連なりとして並ぶので、入口から「次」を
  押し続けるだけで着き、そのまま Contact へ抜ける。目次では「Profile」の1行。
  `/team` は1枚目へ 301
- **2人以上のサイト**: Team のカードから入り、Team の続きとしてめくり、最後は Contact へ
  抜ける（Team の画面自身の「次」は Contact のまま）

下の図は両方の形を1枚に載せ、片方にしか無い矢印には（2人以上）（1人のサイト）と
添えてある。1人のサイトでは Team のカードが無く、`Screen`（Projects）から `Profile` へは
ページャの「岡崎 昂功 →」か目次の「Profile」で入る。

```mermaid
flowchart LR
    Top["トップ（連なりの先頭）<br>GET /"]
    Screen["画面<br>GET /:screen"]
    Page["画面の続き<br>GET /:screen/:page"]
    Filtered["絞り込んだ1画面目<br>/projects?kind= ・ ?member="]
    Moved["以前の一覧<br>/apps ・ /works（続きも）"]
    Item["作品1件（恒久リンク）<br>/apps/item/:slug ・ /works/item/:slug"]
    Story["作品の本文（Story）<br>…/item/:slug/story<br>（本文のある作品だけ）"]
    Whole["全体 GET /all<br>（縦に伸びる唯一の1本）"]
    Profile["メンバー個別<br>/members/:slug"]
    OldTeam["1人のサイトの Team<br>/team ・ /team/:page"]
    MScreen["その人の画面<br>/about ・ /skills ・ /career<br>（続きは …/:page）"]
    Contact["サイトの Contact<br>/contact"]
    Mail["メールソフト"]
    NotFound["404"]
    Admin["管理画面（その画面を直す場所）"]

    Top -->|"ページャ 次 →（帯と同じ行き先なら出さない）"| Screen
    Screen -->|"ページャ 次 →"| Page
    Page -->|"ページャ ← 前"| Screen
    Screen -->|"ページャ ← 前（先頭は /hero）"| Top
    Top -->|"左の目次"| Screen
    Screen -->|"左の目次（Hero は載らない）"| Screen
    Screen -->|"左上のロゴ"| Top
    Top -->|"入口の帯 つくったもの（個人開発 N · 業務 M）一覧で見る →"| Screen
    Moved -->|"301。同じ区分で絞る"| Filtered

    Screen -->|"ピルを押す"| Filtered
    Page -->|"ピルを押す"| Filtered
    Filtered -->|"「すべて」で外す"| Screen

    Screen -->|"カード（面ごと押せる）"| Item
    Page -->|"カード（面ごと押せる）"| Item
    Item -->|"ページャ ← 前 / 次 →（作品同士。一覧と同じ並び。本文の無い作品）"| Item
    Item -->|"くわしく読む → / ページャ 次 →（本文のある作品）"| Story
    Item -->|"ページャ ← 前（前の作品に本文があれば、その Story）"| Story
    Story -->|"ページャ ← 前（同じ作品の1枚目）"| Item
    Story -->|"ページャ 次 →（次の作品の1枚目）"| Item
    Story -->|"← 一覧に戻る（その作品が載っている画面）"| Screen
    Story -->|"目次（Projects に印）"| Screen
    Item -->|"← 一覧に戻る（その作品が載っている画面）"| Screen
    Item -->|"← 一覧に戻る（2画面目から先に載っている作品）"| Page
    Item -->|"目次（Projects に印）"| Screen
    Item -->|"行き先の「担当 名前 →」（2人以上、または Team が無いとき）"| Profile
    Item -->|"前の slug・前の区分の URL → 301（いまの URL へ）"| Item
    Story -->|"前の slug・前の区分の URL → 301（いまの URL の …/story へ）"| Story
    Profile -->|"前の slug → 301（同じ画面のいまの URL へ）"| Profile

    Screen -->|"Team のカード / プロフィール →（2人以上）"| Profile
    Screen -->|"ページャ 岡崎 昂功 → / 目次の Profile（1人のサイト）"| Profile
    OldTeam -->|"301（1人のサイト）"| Profile
    Screen -->|"カードの担当者名（2人以上、または Team が無いとき）"| Profile
    Profile -->|"ページャ ← Team（1人のサイトでは ← 手前の節）"| Screen
    Profile -->|"左上のロゴ"| Top
    Profile -->|"ページャ About →"| MScreen
    MScreen -->|"ページャ ← その人の名前"| Profile
    MScreen -->|"ページャ（About → Skills → Career）"| MScreen
    MScreen -->|"最後の画面の Contact →"| Contact
    Profile -->|"目次（サイトのもの。Team に印／1人のサイトは Profile に印）"| Screen
    MScreen -->|"目次（サイトのもの。Team に印／1人のサイトは Profile に印）"| Screen
    Profile -->|"このメンバーのつくったものの帯（1人のサイトのプロフィールには無い）"| Filtered

    Top -->|"柱の足元（900 以上）"| Whole
    Top -->|"帯の下の すべてを1ページで読む →（幅で畳まない）"| Whole
    Screen -->|"柱の足元（900 以上。中央寄せでは目次の行）"| Whole
    Whole -->|"左上のロゴ"| Top

    Screen -->|"Contact の画面（メール / GitHub）"| Mail
    Profile -.->|"下書き / 存在しない slug"| NotFound
    MScreen -.->|"書いていない画面"| NotFound
    Page -.->|"範囲の外のページ数"| NotFound
    Screen -.->|"画面の名前の形でない（D1 に聞かずに）"| NotFound
    Item -.->|"下書き / 知らない slug"| NotFound
    Story -.->|"本文の無い作品"| NotFound
    NotFound -->|"トップへ戻る"| Top

    Top -.->|"柱の「管理画面」（ログイン中だけ）"| Admin
    Screen -.->|"柱の「管理画面」（ログイン中だけ）"| Admin
    Item -.->|"柱の「管理画面」（ログイン中だけ）"| Admin
    Story -.->|"柱の「管理画面」（ログイン中だけ）"| Admin
    MScreen -.->|"柱の「管理画面」（ログイン中だけ）"| Admin
```

めくる先はページャ。数えるのは**節の中**（`Projects  2 / 4`）で、サイト全体の通し番号では
ない——全体で数えると、絞り込みが無関係な画面の番号まで動かす（[画面の一覧](screens.md)）。
節をまたぐ手だけが行き先を名乗る（`← 前` ではなく `← Projects`）。
`/projects/1` は `/projects` へ 303 で寄せる（同じ画面に URL を2つ作らない）。1画面しか
無いサイトではページャを出さない。入口（連なりの先頭の Hero）も、帯の行き先がページャの
「次」と同じなら出さない——同じ `/projects` へのリンクを2つ置かない。入口から先へ進む手は
帯になる（入口と Projects の間に画面を置いた構成では、ページャはそちらへ、帯は一覧へ）。目次には番号を振らない——数え上げはページャ1つに
寄せてある。画面の連なり（前後・目次・通し番号・canonical）は `src/lib/sequence.ts` が
1本で持っていて、トップも個人ページも同じところを通る。

絞り込み（区分・メンバー）は**ページを移る**。ピルはリンクで、
押すとそのブロックの1画面目へ遷移する——3画面目で絞り込むと、絞ったあとの
3画面目が無いことがあるため。絞り込みはページャにも目次にも同じ query が付いて
画面をまたいで効き、もう一度同じピルを押すとその軸だけ外れる（「すべて」は両方）。
公開ページは JavaScript を1バイトも持たないので、切っても何も変わらない。

作品1件のページ（`/apps/item/<slug>` ・ `/works/item/<slug>`）は**作品同士でめくる、
自分たちだけの連なり**。ページャは一覧と同じ並びで前後の作品へ行き（`← 前`
`Projects 3 / 7` `次 →`。恒久リンクの無い作品は飛ばす）、サイトの連なりには継がない。
中身はカードを開いたもので、画像（あれば）はここにだけ出る。本文を書いた作品は、
1枚目の次に本文だけの画面（Story、`…/<slug>/story`）を持ち、1枚目 → Story → 次の作品と
めくる。入口は1枚目の説明のすぐ下の「くわしく読む →」とページャの「次 →」。ページャが
数えるのは作品なので、Story でも `Projects 3 / 7` のまま（同じ作品の2枚目）。
どちらの画面も頭の「← 一覧に戻る」は、その作品が載っている Projects の画面（`/projects/N`）へ
戻す——目次の Projects は1画面目へ行くので、4画面目から入った人が最初からめくり直さずに
済む。目次の印は Projects に付く。一覧のカードは面ごとここへのリンクで（中の Repository と
担当者名はそれぞれの行き先へ。カードの行き先は 600 未満と、900 以上の画像のある行では
畳むので、そこでは作品のページの行き先から出る）、出る条件は「その作品が公開中」の1つだけ——Projects の
節を外しても、貼られたリンクは死なない（そのときは「← 一覧に戻る」を出さない）。
管理画面で slug を変えた作品・メンバーの前の URL と、区分を変えた作品の前の区分の URL は、
いまの URL へ 301 で寄せる（前の slug は `item_slug_redirects` / `member_slug_redirects`
に残っている）。変えた日に名刺や SNS に貼ったリンクが切れる、を起こさない。
この 301（と1人のサイトの `/team`・個人ページの Contact の 301）は行き先がデータで
変わるので、`Cache-Control: no-cache` でブラウザに覚えさせない——slug を元に戻した
日に、前の転送を覚えたブラウザがリダイレクトの無限ループにならないように。

個人開発と業務は、公開ページでは Projects の1つの一覧（新しい順）。以前の一覧の URL
（`/apps` `/works` とその続き）は、同じ区分で絞った `/projects` へ 301 で寄せる
（ページ数は引き継がない。区分を混ぜて並べ直したので、同じ番号に同じカードは居ない）。

「構成」で節を外しても、行き止まりを作らない。

- 帯（入口と個人ページの1枚目）は Projects へ送り、件数は区分ごとに数える
  （`個人開発 5 · 業務 2`。項目の無い区分は数えない）。Projects を外したサイトでは
  帯ごと出さない
- カードの担当者名（個人ページへのリンク）は、2人以上いるとき**か、Team を
  置いていないとき**に出す。Team が無いと、トップから個人ページへ行く道が
  ほかに1本も無い。作品1件のページの「担当」も同じ条件
- `?member=` は名前のピルが並ぶとき（2人以上）だけ効く。1人のサイトでは読まず、
  個人ページの帯も付けない。効かせると「すべて」にも名前にも印が付かないまま
  一覧だけが絞られる

全体ページ（`/all`）へは、柱の足元の「全体を1ページで見る →」と、入口の帯の下の
「すべてを1ページで読む →」から行く。足元は 899 以下で畳まれるので、スマホの幅では
入口の1本が受ける（`sitemap.xml` にも載る）。中央寄せの骨格の 900 以上では、足元の
著作権表示は出さず、全体ページへの1本だけを目次と同じ行に置く。
管理画面の「構成」からも同じ行き先が開く。印刷・Ctrl-F・翻訳・全体の点検のための
1本で、ここだけは縦に伸びる。詳しくは [screens.md](./screens.md#全体ページ)。

管理画面へは、**ログインしている人にだけ**柱に出る「管理画面」から行く（訪問者の
見た目は変わらない）。目次のすぐ後ろに置くので、899 以下の横帯でも右端に残る。
行き先は「いま見ている画面を直す場所」で、`src/routes/public/page.tsx` の `blockAdminPath`
が決める。

| 見ている画面 | 行き先 |
|---|---|
| 入口（Hero） | 1人のサイトならその人の編集、それ以外は Members 一覧 |
| Projects | 項目の一覧（`/admin/items`。個人開発 / 業務のタブ） |
| Team（2人以上のサイト） | Members 一覧 |
| Contact | 構成のその行（中身は `src/site.ts` にあり、管理画面からは変えられない） |
| 打ち込むブロック（ひとこと・メモ …） | そのブロックの編集 |
| 全体ページ（`/all`）・0件のトップ | 構成 |
| 作品1件（1枚目・本文の画面 Story） | その項目の編集 |
| 個人ページ（どの画面でも。1人のサイトのプロフィールも） | その人の編集 |

同じタブで開く（管理画面の「サイトを見る ↗」は別タブ。両方を別タブにすると、
直して見に行くたびにタブが増える）。

機械に読ませる `/robots.txt` と `/sitemap.xml` は、人の導線には出てこない。
どちらも Worker が公開ページと同じ式から組み立てる。

## 管理側

追加・編集・削除は、どれも「一覧 → フォーム → 一覧」で閉じる。削除だけ確認を挟む。

```mermaid
flowchart TD
    Login["ログイン<br>GET /admin/login"]
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
    Public["公開ページ<br>/ ・ /all"]

    Login -->|"GitHub / Google でログイン（認証の節）<br>成功 → 303（?next= があればそこへ）"| Members
    Members <-->|"左ナビの足元の名前"| Account
    Account -->|"すべての端末からログアウト<br>POST /admin/account/logout-all → 303 ?out=all"| Login
    Members <-->|"左ナビ"| Items
    Items <-->|"左ナビ"| Blocks
    Blocks <-->|"左ナビ"| Look

    Blocks -->|"↑↓ POST /:id/move → 303 #block-id"| Blocks
    Blocks -->|"公開/下書き POST /:id/publish → 303 #block-id"| Blocks
    Blocks -->|"公開にするのを関門が止めた → 303 /:id/edit?publish=blocked"| BForm
    Blocks -->|"足す（決まった中身）<br>POST /admin/blocks → 303 #block-id"| Blocks
    Blocks -->|"サイトを見る ↗ / 全体を1ページで見る ↗"| Public
    Members -->|"サイトで見る ↗（公開中の行）"| Public
    Public -->|"柱の「管理画面」（ログイン中だけ。その画面を直す場所へ）"| Members
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

保存が必ず 303 リダイレクトで終わるので、リロードしても二重に登録されない。
送信ボタンの2度押し（遅い回線・送り直し）は、追加のフォームが描くときに持つ
一度きりの札（`formKey`）で止める——同じ札の2度目は新しい行を作らず、1度目がその札で
作った行への保存になる（編集と同じ道。中身が同じなら書き直すだけ、「戻る」で開き直して
直した・公開に印を付けたなら、それを反映して公開の関門も通す。知らせは
「1度目に作ったものに書きました」まで言う）。JavaScript が無いので、押したあとにボタンを押せなくする
手が無い。「この並びから始める」は1文の INSERT で、決まった中身のブロックは DB の
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

見た目だけは一覧を持たず、同じ画面に戻る。選ぶものが3つしかないので、
「どれを編集中か」を示す一覧が要らない。

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
