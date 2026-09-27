-- プラットフォームの選択肢（参照データ）を、移行で入れる。
-- スキーマは変わらないので drizzle-kit の生成物ではなく --custom で書いた。
--
-- 以前この5行を作るのは seed.sql だけで、seed.sql は items・members・blocks を
-- 全部消してから入れ直す破壊的なファイルだった。新しい環境（作り直し・ステージング）を
-- 用意するにはそれを流すしかなく、本番の選択肢を足すには手打ちの d1 execute が要った。
-- いまは移行が選択肢を持ち、seed.sql は platforms に触らない。
--
-- INSERT OR IGNORE なので、既にある行（seed で入った同じ5行・運用で足した行・
-- 書き換えた表示名や並び順）はそのまま残る。足りないものだけが入る。
INSERT OR IGNORE INTO `platforms` (`key`, `label`, `sort_order`) VALUES
	('macos', 'macOS', 10),
	('ios', 'iOS', 20),
	('cli', 'CLI', 30),
	('server', 'Server', 40),
	('web', 'Web', 50);
