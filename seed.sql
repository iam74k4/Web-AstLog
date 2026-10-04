-- 移行前の index.html に載っていた内容を、そのまま D1 に入れる。
-- 何度流しても同じ状態になるよう、先に消してから入れている——**中身を全部消す**。
--
-- ふだん流すのはローカルだけ（npm run db:seed:local）。本番に流すのは空の D1 に
-- 一度きりで、npm run db:seed:remote:destroys-prod（scripts/seed-remote.mjs）が
-- 作品・メンバー・構成が1行でもあれば止める。
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
-- Projects は個人開発と業務を1つにした一覧（以前の Apps と Works）
INSERT INTO blocks (type, published, sort_order) VALUES
  ('hero',     1, 10),
  ('projects', 1, 20),
  ('team',     1, 30),
  ('contact',  1, 40);

INSERT INTO members (id, slug, name, role, location, headline, bio, skills_text, career_text, avatar_url, github, email, published, sort_order)
VALUES (
  1,
  'okazaki',
  '岡崎 昂功',
  'System Engineer',
  'Kanagawa, Japan',
  'つくる工程そのものを、速くする。',
  'コンピュータサイエンスを専攻し、2024年から株式会社リンクレアの金融ビジネス本部でシステム開発に携わっています。証券会社向け基幹システムのモダナイゼーション案件で、基礎検討・要件定義から基本設計、C# による実装、単体からシナリオまでのテスト、レビューまでを担当しています。

生成AIと自動化ツールで開発工程を効率化することに取り組んでいます。設計書の Markdown 変換、画面コードの生成、テスト支援などを通じて、40人日を見込んでいた14画面の製造・単体テストを約20人日で完了しました。製造業の案件では、ドキュメントを参照して問い合わせに答えるエージェントを Copilot Studio で構築しています。

社外では顧客・ベンダーを含む約200名規模のライトニングトークで AI 活用事例を発表し、社内では約500名規模の全社発表に登壇しました。自部署ではハンズオン形式の AI 勉強会を企画・開催しています。',
  'LANGUAGES:
C# | 3年以上
SQL | 3年以上
JavaScript | 3年以上
HTML / CSS | 3年以上
Python | 1年以上
TypeScript
Swift
FRAMEWORKS / INFRA:
.NET Framework | 3年以上
ASP.NET | 3年以上
SQL Server | 3年以上
Oracle Database | 3年以上
Docker
Google Cloud
PRACTICE:
生成AI・開発効率化
基本設計 / 詳細設計 | 3年以上
開発・実装 | 3年以上
テスト（単体〜シナリオ） | 3年以上
Git / GitHub Actions
Playwright',
  '2024.03 — 現在 | システムエンジニア / 金融ビジネス本部 | 株式会社リンクレア
2024.03 卒業 | コンピュータサイエンス学部 コンピュータサイエンス学科 | 東京工科大学
2021.03 卒業 | 情報処理科 | 日本工学院八王子専門学校',
  '/assets/avatar.png',
  'https://github.com/iam74k4',
  'iam74k4@gmail.com',
  1,
  10
);

-- Apps ------------------------------------------------------------------

-- slug は作品1件の恒久リンク（/apps/item/<slug> と /works/item/<slug>）の3語目。
-- 作り方は管理画面と同じ toSlug（小文字にして、英数字とハイフン以外をハイフンに畳む）。
-- 重なったら末尾に -2, -3 と付けて一意にする（いまは重なっていない）。
-- 題が日本語だけのもの（Works の2件）は toSlug が空を返すので、意味の分かる英語を手で置く。
-- ここを変えると、貼られたリンクが切れる。足すのはよいが、書き換えないこと。
--
-- 本文（body）と画像（image_url / image_alt）は書かない。列の既定値のまま
-- （本文と代替テキストは空、画像は無し）入る。作品の中身は本人が管理画面から
-- 書くもので、ここで作り話を埋めると、それが本人の言葉として公開される。

INSERT INTO items (id, type, member_id, platform_key, title, slug, year, summary, published, sort_order) VALUES
  (1, 'app', 1, 'macos', 'AppMixer', 'appmixer', '2026', 'macOS 14.4 の Core Audio Process Tap でアプリ単位の音量と出力先を制御する常駐アプリ。Mac App Store で配布している。', 1, 10),
  (2, 'app', 1, 'ios', 'AllTasks', 'alltasks', '2026', 'Apple リマインダー・Microsoft To Do・Google ToDo を1つの受信箱にまとめるタスクアプリ。3つのサービスを横断して1画面で扱えるようにしている。', 1, 20),
  (3, 'app', 1, 'cli', 'AI Agent Config', 'ai-agent-config', '2026', 'Cursor / Claude Code / Copilot でばらつくルールを1か所に集約し、1コマンドで各環境へ配る設定ツール。本業の AI 活用を自分の環境にも通すためにつくった。', 1, 30),
  (4, 'app', 1, 'server', 'Discord Bot', 'discord-bot', '2026', '機能追加がコマンド単位で完結する153ファイルのモジュール構成。VC 録音と SQLite 永続化を備え、Railway へ継続デプロイしている。', 1, 40),
  (5, 'app', 1, 'web', 'AstLog', 'astlog', '2026', 'Cloudflare Workers で動くこのポートフォリオ。JavaScript を1行も配らず、入口の軌道図の動きもページの切り替えも CSS だけで組んでいる。', 1, 50);

-- 5 は前の Portfolio（スクロールしない SPA のサイト。リポジトリはもう無い）を、このサイトに
-- 差し替えたもの。前の slug（/apps/item/portfolio）は転送表に残し、貼られたリンクを殺さない
-- （管理画面で slug を変えたときと同じ形。下の item_slug_redirects）。このサイトの
-- リポジトリは非公開なので、行き先（item_links）は置かない

-- 説明文がまだ書けていないもの。消さずに下書きのまま置いておく
INSERT INTO items (id, type, member_id, platform_key, title, slug, year, summary, published, sort_order) VALUES
  (6, 'app', 1, 'web', 'Booking-Platform', 'booking-platform', '2026', '', 0, 60),
  (7, 'app', 1, 'cli', 'EventPlayback', 'eventplayback', '2026', '', 0, 70),
  (8, 'app', 1, 'cli', 'AgentDeck for Stream Deck+', 'agentdeck-for-stream-deck', '2026', '', 0, 80);

-- Works -----------------------------------------------------------------

-- 続いているものの年は「2024 — 現在」（経歴の期間と同じ書き方）。「2024 —」だけでは
-- ダッシュの先が空いて書きかけに見える。並びは頭の4桁で決まるので 2024 のまま。
-- 実績値の添え（metric_note）は、値と単位のあとに続けて読まれる（「20 人日 見込み
-- 40人日から半減」）。「見込み 40人日 → 実績」と書くと → が値の前を指して逆に読める。

INSERT INTO items (id, type, member_id, category, title, slug, year, summary, metric_value, metric_unit, metric_note, published, sort_order) VALUES
  (9, 'work', 1, '金融系基幹システム', '開発工程の効率化', 'dev-efficiency', '2024 — 現在', '生成AIと自動化を設計・製造・テストに組み込む取り組み。横断で使える集計ツールも展開している。', '20', '人日', '見込み 40人日から半減', 1, 10),
  (10, 'work', 1, '製造業', '問い合わせ対応エージェント', 'support-agent', '2026', 'Copilot Studio で構築した、ドキュメントを参照して問い合わせに答えるエージェント。参照する資料を整理し、回答を検証して一次対応に充てた。', NULL, NULL, NULL, 1, 20);

-- タグ --------------------------------------------------------------------

INSERT INTO item_tags (item_id, tag, sort_order) VALUES
  (1, 'Swift', 0), (1, 'SwiftUI', 1), (1, 'Core Audio', 2),
  (2, 'Swift', 0), (2, 'SwiftUI', 1), (2, 'watchOS', 2),
  (3, 'Shell', 0), (3, 'PowerShell', 1), (3, 'Node.js', 2),
  (4, 'TypeScript', 0), (4, 'discord.js', 1), (4, 'SQLite', 2),
  (5, 'TypeScript', 0), (5, 'Hono', 1), (5, 'Cloudflare Workers', 2),
  (7, 'Python', 0),
  (9, '生成AI', 0), (9, 'C#', 1), (9, 'Playwright', 2),
  (10, 'Copilot Studio', 0), (10, 'Power Platform', 1), (10, 'RAG', 2);

-- リンク ------------------------------------------------------------------

-- AllTasks（2）のリポジトリは公開していない（URL が 404）ので、行き先を置かない。公開したら
-- 管理画面から足す
-- AppMixer（1）は Mac App Store で公開している。行き先はリポジトリではなく App Store（持ち主の
-- 判断。手に入れる所はそこだけにする）

INSERT INTO item_links (item_id, label, url, sort_order) VALUES
  (1, 'App Store', 'https://apps.apple.com/jp/app/appmixer/id6804171608', 0),
  (3, 'Repository', 'https://github.com/iam74k4/Tool-AgentConfig', 0),
  (4, 'Repository', 'https://github.com/iam74k4/Bot-Discord', 0),
  (6, 'Repository', 'https://github.com/iam74k4/Booking-Platform', 0),
  (7, 'Repository', 'https://github.com/iam74k4/Tool-EventPlayback', 0),
  (8, 'Repository', 'https://github.com/iam74k4/Device-AgentDeck', 0);

-- 画像 ------------------------------------------------------------------

-- AppMixer（1）のアイコンとスクリーンショットは、Mac App Store の掲載（id6804171608）と同じもの。
-- 管理画面から上げた画像は KV に置くが、seed は SQL だけで入れるので、同梱の素材
-- （public/assets の appmixer-*）を指す。管理画面から差し替えれば KV の画像に替わる（同梱の
-- 素材は消さない。src/routes/admin/images.ts の removeImage は /images/ だけを消す）。
-- 寸法は帯（作品のページの横に送る帯）の幅のため。画像が5枚あるので、作品のページでは
-- 全部を帯に並べる（メインの画像が先）
UPDATE items SET
  icon_url = '/assets/appmixer-icon.png',
  image_url = '/assets/appmixer-01-per-app-volume.jpg',
  image_alt = 'AppMixer のミキサー。Discord・Google Chrome・ミュージックの音量をアプリごとに変えている画面',
  image_width = 1440,
  image_height = 900
WHERE id = 1;

INSERT INTO item_shots (item_id, url, alt, width, height, sort_order) VALUES
  (1, '/assets/appmixer-02-auto-ducking.jpg', 'FaceTime の通話が始まり、ほかのアプリの音量を自動で下げている画面', 1440, 900, 10),
  (1, '/assets/appmixer-03-per-device-memory.jpg', 'AirPods Pro と MacBook Air のスピーカーで、同じアプリの音量を別々に覚えている画面', 1440, 900, 20),
  (1, '/assets/appmixer-04-per-app-output.jpg', 'ミュージックの出力先をスピーカーに、FaceTime を AirPods Pro に振り分けている画面', 1440, 900, 30),
  (1, '/assets/appmixer-05-features.jpg', 'AppMixer の機能の一覧。アプリ別の音量とミュート、レベルメーター、通話中の自動ダッキング、デバイスごとの音量の記憶、アプリ別の出力先、メニューバー常駐', 1440, 900, 40);

-- 前の slug --------------------------------------------------------------

-- 差し替えた 5 の前の URL を、いまの URL へ 301 で送る（src/routes/public/item.tsx の renderItem）
INSERT INTO item_slug_redirects (old_slug, item_id) VALUES
  ('portfolio', 5);
