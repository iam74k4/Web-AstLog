# 画面一覧

公開が 4 画面、管理が 8 画面。ルートの実体は `src/routes/public.tsx` と
`src/routes/admin.tsx`。

## 公開側

誰でも見られる。出すのは `published = 1` の行だけ。

| 画面 | パス | 出すもの | 中身が無いとき |
| --- | --- | --- | --- |
| トップ | `GET /` | Hero → Apps → Works → Team → Contact | その節ごと出さない。見出しだけ残さない |
| メンバー個別 | `GET /members/:slug` | Hero → About（紹介文・スキル・経歴）→ Apps·Works への帯 → Contact | 下書きのメンバーは 404 |
| 画像 | `GET /images/avatars/…` | KV に入れたアバター | 該当なしは 404 |
| 404 / 500 | 未定義の URL / 例外 | マークと戻り導線だけ | — |

### トップの構成

| 節 | 出す条件 | 備考 |
| --- | --- | --- |
| Hero | 常に | 文言は `src/site.ts` |
| Apps | 公開中の app が1件以上 | 絞り込みピルは、実在するプラットフォームだけ並ぶ |
| Works | 公開中の work が1件以上 | 実績値は1項目に1つだけ |
| Team | 公開中のメンバーが1人以上 | **1〜2人は横長カード、3人以上はグリッド**。人数で決める、画面幅では決めない |
| Contact | 常に | |

目次（左の 01〜04）も、出さない節は載せない。

### メンバー個別ページ

- Apps / Works のカードはここに複製しない。帯から
  `/?member=<slug>#apps` へ送り、トップの一覧をその人で絞り込んだ状態にする
- 担当する公開項目が0件なら、帯ごと出さない

## 管理側

`/admin/*`。ログインが要る。書き込みは `Origin` も確認する（ログイン画面を含む）。

| 画面 | パス | 認証 | 役割 |
| --- | --- | --- | --- |
| 入口 | `GET /admin` | 要 | `/admin/members` へ 303 |
| ログイン | `GET /admin/login` | 不要 | フォーム |
| ログイン実行 | `POST /admin/login` | 不要 | 成功で Cookie を発行し `/admin/members` へ |
| ログアウト | `POST /admin/logout` | 要 | セッションを消す |
| 初期設定 | `GET`/`POST /admin/setup` | 不要 | **users が空で、かつ `SETUP_TOKEN` が一致するときだけ**。owner を1件作る。以降は 404 |
| Members 一覧 | `GET /admin/members` | 要 | 行に 公開/下書き・並び順・編集・削除 |
| Member フォーム | `GET /admin/members/new`<br>`GET /admin/members/:id/edit` | 要 | 追加と編集で同じテンプレート |
| Member 保存 | `POST /admin/members`<br>`POST /admin/members/:id` | 要 | 成功で `?saved=1` を付けて一覧へ |
| Member 削除 | `GET /admin/members/:id/delete`（確認）<br>`POST` 同 URL（実行） | 要 | 確認画面を必ず挟む |
| Items 一覧 | `GET /admin/items?type=app\|work` | 要 | Apps / Works をタブで切り替え |
| Item フォーム | `GET /admin/items/new?type=…`<br>`GET /admin/items/:id/edit` | 要 | `type` で欄が変わる（app はプラットフォーム、work は区分と実績値） |
| Item 保存 | `POST /admin/items`<br>`POST /admin/items/:id` | 要 | タグとリンクは総入れ替え |
| Item 削除 | `GET /admin/items/:id/delete`（確認）<br>`POST` 同 URL（実行） | 要 | 一緒に消えるタグ・リンクの件数を出す |

一覧・フォーム・確認の3種類だけで、Members と Items の両方をまかなっている。
一覧にフォームを同居させないのは、「どの行を編集中か」が読めなくなるため。

## 画面の状態

どれも JavaScript なしで、1往復で成立する。

| 状態 | 出る場所 | 見た目 |
| --- | --- | --- |
| 入力エラー | フォーム | 項目のそばに1行。**打った内容は残す** |
| ログイン失敗 | ログイン | 「メールアドレスかパスワードが違います」。どちらが違うかは言わない |
| 試行回数の制限 | ログイン | 5回失敗で 15 分。429 を返す |
| 一覧が空 | 管理の一覧 | 空の表を出さず、「＋ 最初の…を追加」だけ置く |
| 絞り込みで0件 | トップの Apps | ピルは残し、1行だけ出す |
| 保存完了 | 一覧 | `?saved=1` を読んで帯を1回だけ |
| 削除の確認 | 削除確認 | 対象名と、一緒に消えるものの件数。「非公開にする」逃げ道も添える |

## 静的ファイル

Worker より先に配られる（`public/`）。

| パス | 中身 |
| --- | --- |
| `/app.css` | 全画面のスタイル |
| `/filter.js` | Apps / Works の絞り込み。公開中の app があるか、メンバーが2人以上のときだけ読む |
| `/assets/…` | ロゴ、アバターの初期画像 |
