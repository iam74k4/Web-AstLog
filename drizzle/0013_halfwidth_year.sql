-- 作品の年（items.year）に全角の数字で書かれた行を、半角に直す。
-- スキーマは変わらないので drizzle-kit の生成物ではなく --custom で書いた。
--
-- 並べるための年（year_from）は year から DB が作る生成列で、頭が ASCII の数字4桁の
-- ときだけ年になる。年の欄は保存のときに全角を半角へ直す（src/routes/admin/items.tsx の
-- readItemForm）が、それより前に保存した行は「２０２４」のまま残っていて、year_from が
-- null になり、公開の一覧の最後（年の無い作品の並び）に落ちていた。管理画面の知らせ
-- （src/lib/format.ts の yearFrom）も DB と同じ規則なので、この行を直せば両方がそろう。
--
-- 生成列は year から作り直されるので、year を直すだけでよい。全角の数字を含まない行は
-- 何も変わらない（WHERE で最初から外す）。数字以外の字（「— 現在」）には触らない。
UPDATE `items`
SET `year` = replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(`year`, '０', '0'), '１', '1'), '２', '2'), '３', '3'), '４', '4'), '５', '5'), '６', '6'), '７', '7'), '８', '8'), '９', '9')
WHERE `year` GLOB '*[０-９]*';
