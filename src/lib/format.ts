/*
  DB に文字列で持っているものを、表示用の形に開く。

  スキルと経歴を子テーブルにしていないのは、並べて出す以外の使い道が
  無いため。入力は1行1件のテキストエリアで受ける。
*/

export type SkillGroup = { heading: string; skills: { label: string; note: string }[] }

// 末尾が : の行はグループ見出し。それ以外は「表示名 | 補足」
export function parseSkills(text: string): SkillGroup[] {
  const groups: SkillGroup[] = []
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    if (trimmed.endsWith(':')) {
      groups.push({ heading: trimmed.slice(0, -1).trim(), skills: [] })
      continue
    }
    const [label, note] = trimmed.split('|').map((part) => part.trim())
    if (!label) continue
    if (groups.length === 0) groups.push({ heading: '', skills: [] })
    groups[groups.length - 1]?.skills.push({ label, note: note ?? '' })
  }
  return groups
}

/*
  技術の塊の中を、経験の添え（note）ごとの行にまとめる。個人ページの Skills と
  全体ページ（/all）の Profile の SkillGroups が、この行を1本ずつ描く。

  添えを項目ごとに並べていたころは、seed の技術 19 項目のうち 11 項目に
  「3年以上」が付いて、同じ4文字が画面に11回並んでいた。読み手が知りたいのは
  「どれが3年以上か」で、それは行に1度書けば足りる。

  行の順は、その添えが最初に現れた順——書いた人の並べ方をそのまま残す
  （年数の長い順に並べ替えると、「1年以上」と「半年」のような自由な書き方の
  添えを比べる規則が要る）。添えの無い項目は最後の1行にまとめ、添えを付けない。
  行の中の項目の順も書いた順のまま。

  データの形（parseSkills の SkillGroup）は変えない。管理画面の書き方も
  「表示名 | 補足」のまま。まとめるのは描くときだけ。
*/
export type SkillRow = { note: string; labels: string[] }

export function skillRows(skills: SkillGroup['skills']): SkillRow[] {
  const byNote = new Map<string, string[]>()
  for (const skill of skills) {
    const row = byNote.get(skill.note)
    if (row) row.push(skill.label)
    else byNote.set(skill.note, [skill.label])
  }
  const rows = [...byNote].map(([note, labels]) => ({ note, labels }))
  // 添えの無い行（note が空）だけを最後へ。ほかは最初に現れた順のまま
  return [...rows.filter((row) => row.note !== ''), ...rows.filter((row) => row.note === '')]
}

/*
  1行1件・「|」区切りのテキストを、列の配列に開く。

  経歴も、ブロック（数字・リンク集・できごと …）の body も、どれもこの形。
  列の意味は使う側で決めるので、ここでは名前を付けない。読み方を1か所に
  まとめておかないと、書式を変えるたびに両方を直すことになる
*/
export function parseLines(text: string): string[][] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.split('|').map((part) => part.trim()))
}

/*
  管理画面から入る URL でも、javascript: のような形は通さない。

  **掛ける場所は2か所——保存するときと、描くとき。** 保存で弾くのは「公開ページで
  落とすものは、管理画面でも保存させない」ため（作品のリンクは src/routes/admin/items.tsx の
  readLinks、リンク集は blockErrors）。描くときにもう一度見るのは、この検査より
  前に保存された行や、手で DB に入れた行を守るため（components.tsx の LinkRow・
  LinkList）。呼ぶ側が掛けたはずだ、という前提に部品を寄りかからせない——
  作品のページが検査の無い行を LinkList に渡していたことが実際にあった。

  / で始まるものは同じサイトの経路として通すが、// と /\ は除く。
  //example.com はブラウザではプロトコル相対の外部 URL で、
  「同じサイトだから同じタブで開く」の判断が外れる。

  制御文字（タブ・改行を含む）を持つ URL も通さない。ブラウザは URL を読む前に
  タブと改行を黙って取り除くので、「/<タブ>/evil.example」は頭の検査を
  通ったあとで //evil.example（外のサイト）になる。
*/
// biome-ignore lint/suspicious/noControlCharactersInRegex: 制御文字を弾くのがこの検査の目的
const CONTROL = /[\u0000-\u001f\u007f]/

export function isSafeUrl(url: string | undefined | null): url is string {
  return !!url && /^(https?:\/\/|mailto:|\/(?![/\\]))/.test(url) && !CONTROL.test(url)
}

/*
  外のサイトを指す https:// の絶対 URL だけ。メンバーの GitHub に使う
  （保存は src/routes/admin/members.tsx の memberErrors、描くのは components.tsx の Socials と
  構造化データの sameAs）。isSafeUrl より狭い——GitHub のプロフィールに
  mailto: や / で始まるサイトの中の経路が入ることは無く、sameAs は
  この文書の外で読まれるので、相対の URL では何も指さない。
*/
export function isHttpsUrl(url: string | undefined | null): url is string {
  if (!isSafeUrl(url) || !url.startsWith('https://')) return false
  try {
    return new URL(url).hostname !== ''
  } catch {
    return false
  }
}

/*
  Location に入れてよい行き先か。isSafeUrl より狭い——あちらは管理画面が
  受け取る「人が書いた URL」用で https:// と mailto: を通すが、こちらは
  自分のサイトの中へ戻す用なので、絶対パスだけを通す。

  2つ見る。

  1. `//` と `/\` を弾く。ブラウザはこれをプロトコル相対の外部 URL として
     解決するので、`/%2F%2Fevil.com/1` のような URL が 303 で evil.com へ
     飛ばす踏み台になっていた（実際に飛んだ）。Hono は生のパスで照合するが
     c.req.param() は percent-decode するので、パスの一部から作った文字列は
     先頭の1文字から信用できない。
  2. 制御文字を弾く。CR/LF が入ると workerd の Headers.set が例外を投げ、
     それが 500 になっていた（`/ab%0d%0aX/1`）。無い URL は 404 が正しい。
*/
export function isSafeRedirect(path: string): boolean {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: 制御文字を弾くのがこの検査の目的
  return /^\/(?![/\\])[^\x00-\x1f\x7f]*$/.test(path)
}

// 空行で段落を分ける
export function paragraphs(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((part) => part.trim())
    .filter(Boolean)
}

/*
  いまが日本で何年か。柱の足元の著作権表示（© 2026 Noctifex）に使う。

  以前は「© 2026」と字で書いてあった。年が明けると、どの画面の足元も
  去年のまま残る——しかも誰も直す日を覚えていない種類の古さで、
  「このサイトは手入れされていない」と読まれる。だから描くたびに数える。

  **呼ぶのはリクエストを捌いている最中だけ。** 定数に括り出さないこと。
  モジュールの頭に置くと、isolate が立ち上がった時点の年で固まる（isolate は
  年をまたいで生き残りうる）。そのうえ Workers は起動中の時計を進めないので、
  起動時に読むと 1970 年が出ることがある。

  Workers の時計は UTC なので、日本時間（UTC+9、夏時間なし）へ9時間ずらして
  から年を取る。ずらさないと、元日の 0 時から 9 時までの間だけ去年の年が出る。
*/
const JST_OFFSET_MS = 9 * 60 * 60 * 1000

export function yearInJapan(now: Date = new Date()): number {
  return new Date(now.getTime() + JST_OFFSET_MS).getUTCFullYear()
}

/*
  D1 の datetime('now')（UTC の「YYYY-MM-DD HH:MM:SS」）を、日本時間の
  「YYYY-MM-DD HH:MM」にする。管理画面の「最後のログイン」。読めない値はそのまま返す
*/
export function timeInJapan(utc: string): string {
  const date = new Date(`${utc.replace(' ', 'T')}Z`)
  if (Number.isNaN(date.getTime())) return utc
  return new Date(date.getTime() + JST_OFFSET_MS).toISOString().slice(0, 16).replace('T', ' ')
}

export function initials(name: string): string {
  return name.trim().slice(0, 1).toUpperCase() || '·'
}

// フォームから来る値。ファイルも混ざるので、文字列以外は空として扱う
type FormValue = string | File | null | undefined

export function str(value: FormValue): string {
  return typeof value === 'string' ? value.trim() : ''
}

/*
  人が打った整数（並び順）と、フォームが送る id（担当メンバー）を読む。
  読めなければ null——空も null。空をどう扱うか（いまの値のまま・既定の数）は
  呼ぶ側が決める。

  全角の数字は半角に直してから読む（NFKC）。並び順の欄は type=text なので、
  日本語入力のまま「２０」と入る。以前は Number('２０') が NaN になり、黙って
  既定の 0 で保存していた——エラーは出ず、その行だけが一覧の先頭へ動いた。
  数として読めないものは、黙って別の数に倒さず、呼ぶ側が 400 で欄を示す。
  小数も読まない（列は整数。1.5 を入れると SQLite は実数のまま持つ）。
*/
export function int(value: FormValue): number | null {
  const text = str(value).normalize('NFKC')
  return /^-?\d{1,9}$/.test(text) ? Number(text) : null
}

// 全角の数字（０〜９）を半角に。作品の年の欄は保存のときにこれを通す（src/routes/admin/items.tsx の readItemForm）
export const halfWidthDigits = (text: string) =>
  text.replace(/[０-９]/g, (digit) => String.fromCharCode(digit.charCodeAt(0) - 0xfee0))

/*
  作品の年から、並べるための年を読む。頭の数字4桁で、無ければ null。
  「2024 — 現在」は 2024。「令和6」「〜2023」「FY2024」は null——並びでは年の無い
  作品と一緒に最後に回る（管理画面はそのことを欄の下で知らせる）。

  **並びそのものは DB が同じ規則で作る**（src/db/schema.ts の items.year_from。
  生成列）。ここは管理画面が「並びに使われない年」を知らせるための写しで、
  規則を変えるなら2つ一緒に（test/admin.test.ts が2つの答えを突き合わせている）。
  全角の数字は保存のときに半角へ直るので、ここでも直してから読む。
*/
export function yearFrom(year: string): number | null {
  const head = halfWidthDigits(year).match(/^[0-9]{4}/)
  return head ? Number(head[0]) : null
}

export function bool(value: FormValue): number {
  return str(value) ? 1 : 0
}

// 「Swift, SwiftUI, Core Audio」→ 配列。重複と空白は落とす
export function parseTags(value: string): string[] {
  const seen = new Set<string>()
  for (const tag of value.split(',').map((part) => part.trim())) {
    if (tag) seen.add(tag)
  }
  return [...seen]
}

// 人が打った文字列から slug を作る。既に入っていればそれを尊重する
export function toSlug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
}
