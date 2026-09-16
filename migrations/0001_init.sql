-- Noctifex — 初期スキーマ
--
-- 公開サイトは published = 1 の行だけを読む。
-- これは今まで index.html のカードに手で書いていた data-show="yes" / "no" を
-- そのまま置き換えるもので、「消さずに寝かせる」使い方を DB 側に移したもの。
--
-- 並び順は sort_order（小さいほど先）。id 順に依存しないこと。
-- 追加した順と、見せたい順は一致しない。

CREATE TABLE members (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  slug       TEXT    NOT NULL UNIQUE,            -- /members/:slug になる。後から変えるとURLが変わる
  name       TEXT    NOT NULL,
  role       TEXT    NOT NULL DEFAULT '',        -- 肩書き。名詞のまま、文にしない
  bio        TEXT    NOT NULL DEFAULT '',        -- 個人ページの About 本文
  avatar_key TEXT,                               -- KV のキー。NULL なら頭文字を出す
  github     TEXT,
  email      TEXT,
  published  INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- 絞り込みボタンの元。自由入力をやめてここに寄せる。
-- "macOS" と "Mac OS" のような表記ゆれでフィルタが壊れるのを防ぐため。
CREATE TABLE platforms (
  key        TEXT    PRIMARY KEY,                -- 絞り込みのキー。URLと属性に出る
  label      TEXT    NOT NULL,                   -- 画面に出す文字
  sort_order INTEGER NOT NULL DEFAULT 0
);

-- Apps と Works は列がほぼ同じなので1つの表にし、type で分ける。
-- 分けると、両方に出したい項目や横断の集計のたびに UNION が要る。
CREATE TABLE items (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  type         TEXT    NOT NULL CHECK (type IN ('app', 'work')),
  member_id    INTEGER REFERENCES members(id) ON DELETE SET NULL,
  platform_key TEXT    REFERENCES platforms(key) ON DELETE SET NULL,
  title        TEXT    NOT NULL,
  year         TEXT    NOT NULL DEFAULT '',      -- "2026" や "2024 —" を入れるので文字列
  summary      TEXT    NOT NULL DEFAULT '',      -- 「何であるか。何をしたか。」の2文
  metric_value TEXT,                             -- Works の実績値。無い項目のほうが多い
  metric_unit  TEXT,
  metric_note  TEXT,
  published    INTEGER NOT NULL DEFAULT 0,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE item_tags (
  item_id    INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  tag        TEXT    NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (item_id, tag)
);

CREATE TABLE item_links (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id    INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  label      TEXT    NOT NULL,                   -- "Repository" / "Release"
  url        TEXT    NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
);

-- 管理画面のログイン。
-- role と member_id を最初から持たせておく。後から「本人が自分のページだけ
-- 編集できる」を足すときに、列を増やす移行をしなくて済ませるため。
-- ただし Phase 2 で作るのは owner の1件だけ。
CREATE TABLE users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT    NOT NULL UNIQUE,
  password_hash TEXT    NOT NULL,                -- PBKDF2-SHA256。salt と反復回数を同じ文字列に含める
  role          TEXT    NOT NULL DEFAULT 'owner' CHECK (role IN ('owner', 'member')),
  member_id     INTEGER REFERENCES members(id) ON DELETE SET NULL,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Cookie に入るのは id だけ。ログアウトで即座に無効化したいので
-- KV の TTL ではなくこちらに置く（KV は反映まで最大60秒かかる）。
CREATE TABLE sessions (
  id         TEXT    PRIMARY KEY,                -- 乱数32バイトのhex
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT    NOT NULL,
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_members_public ON members(published, sort_order);
CREATE INDEX idx_items_public   ON items(type, published, sort_order);
CREATE INDEX idx_items_member   ON items(member_id);
CREATE INDEX idx_sessions_exp   ON sessions(expires_at);

-- 今の index.html の絞り込みボタンと同じ並び
INSERT INTO platforms (key, label, sort_order) VALUES
  ('macos',  'macOS',  1),
  ('ios',    'iOS',    2),
  ('cli',    'CLI',    3),
  ('server', 'Server', 4),
  ('web',    'Web',    5);
