-- Apps と Works を Projects に畳む（src/blocks.ts の projects）。
-- スキーマは変わらない（blocks.type は text）。変わるのは構成に置いた行だけで、
-- 放っておくと apps / works の行は「知らない種類」として公開ページから黙って消える。
--
-- 先に並んでいたほうの行を projects に書き換えて、構成の中の位置を引き継ぐ。
-- どちらかが公開中なら公開にする（片方だけ出していたサイトで一覧ごと消さない）。
-- もう片方の行は消す。どちらも置いていないサイトでは何も起きない。
UPDATE `blocks`
SET
	`type` = 'projects',
	`published` = (SELECT MAX(`published`) FROM `blocks` WHERE `type` IN ('apps', 'works')),
	`updated_at` = datetime('now')
WHERE `id` = (
	SELECT `id` FROM `blocks` WHERE `type` IN ('apps', 'works') ORDER BY `sort_order`, `id` LIMIT 1
);
--> statement-breakpoint
DELETE FROM `blocks` WHERE `type` IN ('apps', 'works');
