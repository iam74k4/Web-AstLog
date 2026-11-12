-- ローカルの開発・画面検査専用。内容を全部消してから入れ直す。
-- 本番には流さず、管理画面から内容と画像を登録する。
-- 画像は scripts/fixtures/media/ からローカル KV にだけ入れる。
--
-- 中身は検査のための見本（作り話）で、本人のサイトの写しではない。本番の正は D1 で、写しを
-- ここに持つと本番と黙ってずれていき（作品の顔ぶれが入れ替わっても、ここは古いまま）、
-- 経歴・連絡先・規約の全文まで二重に持つことになった。形だけを本番にそろえる——1人のサイト、
-- 公開中の個人開発5件と業務2件、下書き3件。アイコン・画像5枚・押し手・文書2本を持つ作品が1件。
-- 名前と画像が実物なのは、検査画像（scripts/fixtures/media/）を借りている AppMixer と、この
-- サイト（AstLog）だけ。どちらも公開している作品で、文の中身は見本。
--
-- プラットフォームの選択肢（platforms）は参照データなので、ここではなく移行
-- （drizzle/0011_platforms_reference）が入れる。先に移行を流してから流すこと。

DELETE FROM item_slug_redirects;
DELETE FROM member_slug_redirects;
DELETE FROM item_shots;
DELETE FROM item_links;
DELETE FROM item_tags;
DELETE FROM items;
DELETE FROM members;
DELETE FROM blocks;

-- トップの並び（src/blocks.ts の DEFAULT_BLOCKS と揃える）。
-- Projects は個人開発と業務を1つにした一覧
INSERT INTO blocks (type, published, sort_order) VALUES
  ('hero',     1, 10),
  ('projects', 1, 20),
  ('team',     1, 30),
  ('contact',  1, 40);

-- 見本の人。紹介文・技術・経歴は、本番の1人のサイトと同じくらいの長さと形（段落3つ、技術の
-- 塊3つに補足、経歴3行で1行目が「現在」）にしてある。check:fit がこの長さで版面を測る
INSERT INTO members (id, slug, name, name_latin, role, location, headline, bio, skills_text, career_text, avatar_url, github, email, published, sort_order)
VALUES (
  1,
  'mihon',
  '見本 花子',
  'Mihon Hanako',
  'Software Engineer',
  'Tokyo, Japan',
  '小さな道具で、毎日の手間を減らす。',
  '情報工学を専攻し、2023年から株式会社サンプルの業務システム部で開発に携わっています。物流会社向けの在庫管理と出荷のシステムを新しくする案件で、現場への聞き取りと要件の整理から基本設計、TypeScript による実装、単体から結合までのテスト、レビューまでを担当しています。

手作業の多い工程を道具で短くすることに取り組んでいます。帳票の取り込み、画面の雛形の生成、テストデータの作成などを自動化し、40人日を見込んでいた12画面の製造と単体テストを約20人日で終えました。問い合わせの多い部署では、社内の資料を引いて回答の候補を出す仕組みを組み、一次対応の手順の中で毎日使ってもらっています。

社外では顧客や協力会社を含む約150名の勉強会で業務の自動化の事例を話し、社内では約300名の全体会議で発表しました。自分の部署では、手を動かしながら学ぶ小さな勉強会を月に一度企画し、開いています。',
  'LANGUAGES:
TypeScript | 3年以上
SQL | 3年以上
JavaScript | 3年以上
HTML / CSS | 3年以上
Python | 1年以上
Go
Swift
FRAMEWORKS / INFRA:
Node.js | 3年以上
React | 3年以上
PostgreSQL | 3年以上
Cloudflare Workers | 1年以上
Docker
AWS
PRACTICE:
業務の自動化
基本設計 / 詳細設計 | 3年以上
開発・実装 | 3年以上
テスト（単体〜結合） | 3年以上
Git / GitHub Actions
Playwright',
  '2023.04 — 現在 | ソフトウェアエンジニア / 業務システム部 | 株式会社サンプル
2023.03 卒業 | 情報工学部 情報工学科 | 見本工科大学
2019.03 卒業 | 情報処理科 | 見本情報専門学校',
  '/images/avatars/avatar.png',
  'https://github.com/example',
  'hanako@example.com',
  1,
  10
);

-- 個人開発 ---------------------------------------------------------------

-- slug は作品1件の恒久リンク（/apps/item/<slug> と /works/item/<slug>）の3語目。
-- 作り方は管理画面と同じ toSlug（小文字にして、英数字とハイフン以外をハイフンに畳む）。
-- 題が日本語だけのもの（業務の2件）は toSlug が空を返すので、意味の分かる英語を手で置く。
-- check:gallery は /apps/item/appmixer を開く。
--
-- 本文（body と story_*）と、AppMixer 以外の画像は書かない。本番の1人のサイトも、本文を
-- 書いていない作品のほうが多い（本文の小節は check:fit の fixture が長い本文で測る）。

INSERT INTO items (id, type, member_id, platform_key, title, slug, year, summary, published, sort_order) VALUES
  (1, 'app', 1, 'macos', 'AppMixer', 'appmixer', '2026', 'Mac で鳴っているアプリごとに音量と出力先を変える常駐アプリ。Mac App Store で配布している。', 1, 10),
  (2, 'app', 1, 'ios', 'Pocket Inbox', 'pocket-inbox', '2026', 'メモ・ToDo・買い物リストを1つの受信箱にまとめる iPhone アプリ。3つの入口を1画面で扱えるようにしている。', 1, 20),
  (3, 'app', 1, 'cli', 'Config Sync', 'config-sync', '2026', 'エディタごとにばらつく設定を1か所に集め、1コマンドで各環境へ配る道具。手元の環境をそろえるためにつくった。', 1, 30),
  (4, 'app', 1, 'server', 'Chat Bot', 'chat-bot', '2026', '機能をコマンド単位で足せるモジュール構成のチャットボット。記録を SQLite に残し、継続デプロイしている。', 1, 40),
  (5, 'app', 1, 'web', 'AstLog', 'astlog', '2026', 'Cloudflare Workers で動くポートフォリオ。本文と導線をサーバーで描画し、JavaScript なしで読める。', 1, 50);

-- 5 の前の slug（/apps/item/portfolio）は転送表に残す（管理画面で slug を変えたときと同じ形。
-- 下の item_slug_redirects）。行き先（item_links）を持たない作品も1件ある形にしておく

-- 説明文がまだ書けていないもの。下書きのまま置いておく
INSERT INTO items (id, type, member_id, platform_key, title, slug, year, summary, published, sort_order) VALUES
  (6, 'app', 1, 'web', 'Booking Sample', 'booking-sample', '2026', '', 0, 60),
  (7, 'app', 1, 'cli', 'Log Replay', 'log-replay', '2026', '', 0, 70),
  (8, 'app', 1, 'cli', 'Deck Controller for Stream Deck+', 'deck-controller', '2026', '', 0, 80);

-- 業務 -------------------------------------------------------------------

-- 続いているものの年は「2024 — 現在」（経歴の期間と同じ書き方）。「2024 —」だけでは
-- ダッシュの先が空いて書きかけに見える。並びは頭の4桁で決まるので 2024 のまま。
-- 実績値の添え（metric_note）は、値と単位のあとに続けて読まれる（「20 人日 見込み
-- 40人日から半減」）。「見込み 40人日 → 実績」と書くと → が値の前を指して逆に読める。

INSERT INTO items (id, type, member_id, category, title, slug, year, summary, metric_value, metric_unit, metric_note, published, sort_order) VALUES
  (9, 'work', 1, '物流業務システム', '開発工程の自動化', 'dev-automation', '2024 — 現在', '帳票の取り込みとテストの準備を自動化する取り組み。部署をまたいで使える集計の道具も配っている。', '20', '人日', '見込み 40人日から半減', 1, 10),
  (10, 'work', 1, '製造業', '問い合わせ回答の候補出し', 'answer-assist', '2026', '社内の資料を引いて、問い合わせへの回答の候補を出す仕組み。参照する資料を整理し、候補を確かめて一次対応に充てた。', NULL, NULL, NULL, 1, 20);

-- タグ --------------------------------------------------------------------

INSERT INTO item_tags (item_id, tag, sort_order) VALUES
  (1, 'Swift', 0), (1, 'SwiftUI', 1), (1, 'Core Audio', 2),
  (2, 'Swift', 0), (2, 'SwiftUI', 1), (2, 'WidgetKit', 2),
  (3, 'Shell', 0), (3, 'Node.js', 1), (3, 'YAML', 2),
  (4, 'TypeScript', 0), (4, 'SQLite', 1), (4, 'Docker', 2),
  (5, 'TypeScript', 0), (5, 'Hono', 1), (5, 'Cloudflare Workers', 2),
  (7, 'Python', 0),
  (9, '自動化', 0), (9, 'TypeScript', 1), (9, 'Playwright', 2),
  (10, '検索', 0), (10, 'Python', 1), (10, 'RAG', 2);

-- リンク ------------------------------------------------------------------

-- 行き先は example.com（見本）。AppMixer だけは公開している App Store の掲載
INSERT INTO item_links (item_id, label, url, sort_order) VALUES
  (1, 'App Store', 'https://apps.apple.com/jp/app/appmixer/id6804171608', 0),
  (3, 'Repository', 'https://example.com/config-sync', 0),
  (4, 'Repository', 'https://example.com/chat-bot', 0),
  (6, 'Repository', 'https://example.com/booking-sample', 0),
  (7, 'Repository', 'https://example.com/log-replay', 0),
  (8, 'Repository', 'https://example.com/deck-controller', 0);

-- AppMixer（1）の1本目（App Store）は押し手にする（items.lead_link）
UPDATE items SET lead_link = 1 WHERE id = 1;

-- 作品の文書のページ（/apps/item/appmixer/privacy・…/support）。中身は形を測るための見本で、
-- 本番のアプリの規約ではない（本番は管理画面の「プライバシーポリシーとサポートを書く」で書く）。
-- 「## 日本語」「## English」で分けた文書の言語の切り替え、### の見出し、太字・箇条書き・
-- リンクを1つずつ持たせてある
UPDATE items SET
  privacy = '最終更新日 / Last updated: 2026-11-12

## 日本語

### 収集する情報

**このアプリは個人情報を収集、保存、送信しません。**（検査のための見本の文です）

解析ツール、広告、クラッシュレポートの送信、そのほかの外部の SDK を含みません。外部のサーバーと通信する機能もありません。

### 保存される設定

アプリごとの音量や出力先の割り当ては、お使いの Mac の中にだけ保存されます。アプリを削除すると、設定も一緒に削除されます。

### お問い合わせ

ご質問はサポートのページからお寄せください。

[サポート](/apps/item/appmixer/support)

## English

### Information We Collect

**This app does not collect, store, or transmit any personal information.** (Sample text for layout checks.)

It contains no analytics, no advertising, no crash reporting, and no third-party SDKs, and it does not communicate with external servers.

### Settings We Store

Per-app volume levels and output assignments are stored only on your Mac. Deleting the app also deletes these settings.

### Contact

Questions may be sent via the support page.

[Support](/apps/item/appmixer/support?lang=en)',
  support = '## 日本語

ご質問や不具合のご報告は、このページの下にある連絡先までお寄せください（検査のための見本の文です）。

不具合をご報告いただくときは、次のことを添えていただけると原因を早く確かめられます。

- macOS のバージョン
- アプリのバージョン
- 起きたことと、そのときの操作

### 動作環境

macOS 14.4 以降で動作します。

### 購入と返金

Mac App Store での購入と返金の手続きは Apple が扱います。

## English

For questions or bug reports, please use the contact details at the bottom of this page. (Sample text for layout checks.)

When reporting a problem, please include:

- your macOS version
- the app version
- what happened and what you were doing at the time

### Requirements

macOS 14.4 or later.

### Purchases and refunds

Purchases and refunds on the Mac App Store are handled by Apple.'
WHERE id = 1;

-- 画像 ------------------------------------------------------------------

-- AppMixer（1）のアイコンとスクリーンショットは、Mac App Store の掲載と同じ検査画像。
-- 検査用の画像はローカル KV に置く。本番の public/ には含めない。
-- 寸法は表示と共有カードに使う。メインの画像が先頭。
UPDATE items SET
  icon_url = '/images/items/appmixer-icon.png',
  image_url = '/images/items/appmixer-01-per-app-volume.jpg',
  image_alt = 'アプリごとの音量を変えるミキサーの画面。3つのアプリの音量の帯が並んでいる',
  image_width = 1440,
  image_height = 900
WHERE id = 1;

-- アイコンのある作品をもう2件（一覧の行で、アイコンのある行と無い行が並ぶ形）
UPDATE items SET icon_url = '/images/items/discord-bot-icon.png' WHERE id = 4;
UPDATE items SET icon_url = '/images/items/astlog-icon.png' WHERE id = 5;

INSERT INTO item_shots (item_id, url, alt, width, height, sort_order) VALUES
  (1, '/images/items/appmixer-02-auto-ducking.jpg', '通話が始まり、ほかのアプリの音量を自動で下げている画面', 1440, 900, 10),
  (1, '/images/items/appmixer-03-per-device-memory.jpg', 'イヤホンとスピーカーで、同じアプリの音量を別々に覚えている画面', 1440, 900, 20),
  (1, '/images/items/appmixer-04-per-app-output.jpg', 'アプリごとに出力先を振り分けている画面', 1440, 900, 30),
  (1, '/images/items/appmixer-05-features.jpg', '機能の一覧。アプリ別の音量とミュート、レベルメーター、自動で下げる音量、出力先の振り分け', 1440, 900, 40);

-- 前の slug --------------------------------------------------------------

-- 5 の前の URL を、いまの URL へ 301 で送る（src/routes/public/item.tsx の renderItem）
INSERT INTO item_slug_redirects (old_slug, item_id) VALUES
  ('portfolio', 5);


-- ローカル見本のサイト設定 ------------------------------------------------
-- 公開文言・宛先の編集は管理画面で行う。宛先は example.com（見本）
INSERT OR REPLACE INTO settings (key, value) VALUES
  ('site.tagline', 'つくったものを、ひとつずつ記録する。'),
  ('site.heroLead', 'つくったアプリと、仕事で取り組んだ自動化をまとめています。'),
  ('site.heroRoles', 'Software Engineer' || char(10) || 'iOS / macOS Developer' || char(10) || 'Automation Engineer'),
  ('site.contactLead', '業務の自動化や個人開発について、話しませんか。お仕事のご相談も歓迎します。'),
  ('site.email', 'hanako@example.com'),
  ('site.github', 'https://github.com/example'),
  ('site.instagram', ''),
  ('site.x', '');
