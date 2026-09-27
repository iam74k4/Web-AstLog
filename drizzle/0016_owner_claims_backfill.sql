-- 既に owner に紐づいているアカウントの「環境変数を使った記録」（owner_claims）を埋める。
-- スキーマは変わらないので drizzle-kit の生成物ではなく --custom で書いた。
--
-- owner_claims（0015）は「OWNER_GITHUB_ID / OWNER_GOOGLE_EMAIL の値で owner に紐づけて
-- よいのは、その値ごとに1度きり」を持つ表。この移行の前に紐づいた owner のアカウントは
-- 記録を持たないので、そのままだと README のとおり user_identities の行を消して紐づけを
-- 外しても、次のログインで「まだ使っていない値」として紐づき直ってしまう。
--
-- 環境変数の値は D1 からは読めないので、紐づいているアカウントから書き戻す。
-- GitHub の値は数値の id（= subject）。Google の値は確認済みのアドレスで、紐づけたときの
-- アドレスは label に写してある（src/lib/oauth.ts。照合と同じく小文字にする）。
-- アドレスを持たない label（「sub …」）の行は書かない。
INSERT OR IGNORE INTO `owner_claims` (`provider`, `value`, `subject`, `ticket`)
SELECT `i`.`provider`,
	CASE WHEN `i`.`provider` = 'github' THEN `i`.`subject` ELSE lower(`i`.`label`) END,
	`i`.`subject`,
	'migrated'
FROM `user_identities` AS `i`
INNER JOIN `users` AS `u` ON `u`.`id` = `i`.`user_id`
WHERE `u`.`role` = 'owner'
	AND (`i`.`provider` = 'github' OR `i`.`label` LIKE '%_@_%');
