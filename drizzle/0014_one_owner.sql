-- owner（users.role = 'owner'）を1人に寄せる。
-- スキーマは変わらないので drizzle-kit の生成物ではなく --custom で書いた。
--
-- 次の移行（0015）が「owner は1人だけ」の部分一意索引（users_one_owner）を張る。
-- owner の行が無い D1 に初回のログインが2本同時に来ると（GitHub と Google を2つの
-- タブで、など）、「読んでから作る」の両方が owner を作り、2人になっていた。
-- その D1 では索引を作れずに移行ごと止まるので、先にここで片付ける。
--
-- 残すのはいちばん古い owner（id の小さいほう。パスワードの頃から居る行があれば
-- それ）。ほかの owner の紐づけ（user_identities）とセッションを残す owner へ移し、
-- メンバーとの紐づけは残す owner が持っていなければ引き継いでから、行を消す。
-- 移してから消すので、cascade で紐づけやセッションが消えることは無い
-- （2人のどちらのアカウントでも、同じ1人として入れる）。
-- owner が1人以下の D1 では何も起きない。
UPDATE `users`
SET `member_id` = (
	SELECT `other`.`member_id` FROM `users` AS `other`
	WHERE `other`.`role` = 'owner' AND `other`.`member_id` IS NOT NULL
	ORDER BY `other`.`id`
	LIMIT 1
)
WHERE `id` = (SELECT min(`id`) FROM `users` WHERE `role` = 'owner')
	AND `member_id` IS NULL;
--> statement-breakpoint
UPDATE `user_identities`
SET `user_id` = (SELECT min(`id`) FROM `users` WHERE `role` = 'owner')
WHERE `user_id` IN (SELECT `id` FROM `users` WHERE `role` = 'owner');
--> statement-breakpoint
UPDATE `sessions`
SET `user_id` = (SELECT min(`id`) FROM `users` WHERE `role` = 'owner')
WHERE `user_id` IN (SELECT `id` FROM `users` WHERE `role` = 'owner');
--> statement-breakpoint
DELETE FROM `users`
WHERE `role` = 'owner'
	AND `id` <> (SELECT min(`id`) FROM `users` WHERE `role` = 'owner');
