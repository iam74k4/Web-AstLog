-- 決まった中身のブロック（hero / projects / team / contact）を、種類ごとに1行へ畳む。
-- スキーマは変わらないので drizzle-kit の生成物ではなく --custom で書いた。
--
-- 次の移行（0010）が「固定の種類は1つだけ」の部分一意索引（blocks_fixed_once）を張る。
-- 二重送信で既に2行できている D1 では、そのままだと索引を作れずに移行ごと止まるので、
-- 先にここで片付ける。
--
-- 残すのは、公開中のものを先に、その中で並び（sort_order → id）の先頭の1行。
-- 並びだけで選ぶと、下書きの行を残して公開中の行を消し、サイトからその節が消えうる。
-- 公開側の読み方（src/db/queries.ts の publishedBlocks）も、公開中のうち並びの先頭を採る。
-- 重複の無い D1 では何も起きない。
DELETE FROM `blocks`
WHERE `type` IN ('hero', 'projects', 'team', 'contact')
	AND `id` <> (
		SELECT `kept`.`id` FROM `blocks` AS `kept`
		WHERE `kept`.`type` = `blocks`.`type`
		ORDER BY `kept`.`published` DESC, `kept`.`sort_order`, `kept`.`id`
		LIMIT 1
	);
