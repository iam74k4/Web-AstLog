import { drizzle } from 'drizzle-orm/d1'
import type { Context } from 'hono'
import * as schema from '../../db/schema'
import type { AppEnv } from '../../env'
import { newToken } from '../../lib/auth'
import { int, str, toSlug } from '../../lib/format'

/*
  管理画面のルートが共通に使う、要求の読み方と応答の決まり（見た目は持たない。
  フォームの部品は src/ui/AdminForm.tsx）。
*/

export const db = (c: { env: { DB: D1Database } }) => drizzle(c.env.DB, { schema })

// URL の :id は数字とは限らない。数字でなければ 404 にする
export function parseId(value: string | undefined): number | null {
  const id = Number(value)
  return Number.isInteger(id) && id > 0 ? id : null
}

// 保存の知らせ。下書きで保存したときは、サイトにまだ出ていないことまで言う
export const savedParam = (published: number) => (published ? '1' : 'draft')

export function flashFor(c: Context<AppEnv>, deleted = '削除しました'): string | null {
  const saved = c.req.query('saved')
  /*
    slug を変えた保存。前の URL が切れていないことまで言う——言わないと、
    名刺や SNS に貼った URL を直しに行くことになる（src/db/schema.ts の
    item_slug_redirects）
  */
  const moved = c.req.query('moved') ? '。前の URL は、新しい URL へ転送します' : ''
  if (saved === 'draft') return `下書きで保存しました。サイトにはまだ出ていません${moved}`
  if (saved) return `保存しました${moved}`
  return c.req.query('deleted') ? deleted : null
}

/*
  追加のフォームの一度きりの札（src/db/schema.ts の form_key の注記）。

  フォームを描くときに1枚作って hidden で持ち回し、行と一緒に書く。同じ札で
  同じ中身（題・名前…）の2度目の送信は、検査より先に「もう保存してある」と見て、
  書かずに一覧へ送る（英字の題の作品を2度押すと、2度目が「この slug は既に
  使われています」の 400 になり、保存できたのに失敗したように見えていた）。
  検査に当たって描き直すときも同じ札を持ち回す。

  同じ札で中身が違うのは、ブラウザの「戻る」で開き直した追加のフォームから、
  別のものを書いて送ったとき。それは2度押しではないので、新しい札で書く
  （黙って捨てて「保存しました」と言わない）。

  受け取るのはこちらが作った形（16進 16 字）だけ。手で組んだ POST の任意の
  文字列を unique の列に入れない。札の無い送信は今までどおり書く（札は重複を
  止めるためのもので、書いてよいかの判断には使わない）。
*/
export const newFormKey = () => newToken(8)

export function formKeyOf(form: FormData): string | null {
  const key = str(form.get('formKey'))
  return /^[0-9a-f]{16}$/.test(key) ? key : null
}

/*
  書き込みが unique のどの列に当たって止まったか（列は「表.列」で渡す）。
  drizzle は D1 の例外を cause に包んで投げ直すので、原因をたどって見る。
  同時に来た2本の送信が、検査を両方すり抜けて DB の制約で止まったときに、
  500 ではなく検査と同じ答え（400・保存済み）に戻すために使う。
*/
export function uniqueViolation(error: unknown, column: string): boolean {
  let current: unknown = error
  while (current instanceof Error) {
    if (current.message.includes('UNIQUE constraint failed') && current.message.includes(column)) {
      return true
    }
    current = current.cause
  }
  return false
}

// 削除の確認から「キャンセル」したときの戻り先。編集画面から来たなら編集画面へ
export const cameFromEdit = (c: Context<AppEnv>) => c.req.query('from') === 'edit'

/*
  並び順の欄。空なら編集ではいまの値、追加では既定の 10（フォームが初めに出す数）。
  数として読めなければ、黙って別の数に倒さず 400 で欄を示す（src/lib/format.ts の
  int）。返す text は描き直し用——打った字をそのまま返す。
*/
export const SORT_ORDER_ERROR = '並び順は数字で入れてください（例: 10）'

export function readSortOrder(form: FormData, current: number | undefined) {
  const text = str(form.get('sortOrder'))
  const value = text ? int(text) : (current ?? 10)
  return {
    text,
    value: value ?? current ?? 10,
    error: value === null ? { sortOrder: SORT_ORDER_ERROR } : null,
  }
}

/*
  slug の欄の読み方。メンバーと作品で同じ。

  **欄が空なら、編集ではいまの slug のまま。** 以前は空にすると名前から作り直し、
  日本語だけの名前では乱数になって、貼られていた前の URL がその日から 404 に
  なった（「空にすれば作り直される」と思って消すのは、ごく自然な操作）。
  作り直すのは、まだ slug を持たない行（追加と、slug の列より前からある作品）だけ。
  打った slug が英数字を1つも含まない（toSlug が空を返す）ときも空と同じ扱い。
*/
export const readSlug = (typed: string, current: string | null | undefined, name: string) =>
  toSlug(typed) || current || toSlug(name) || null

// 入力エラーで描き直すとき、打った内容をそのまま返すための変換
export function asValues(values: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(values).map(([key, value]) => [key, String(value ?? '')]),
  )
}

/*
  slug が重なったら弾く。いまの slug に加えて、ほかの行の前の slug
  （転送表に残っているもの）も使わせない——使わせると、その前の URL を
  貼っていた人のリンクが黙って別の人・別の作品を指す（404 より悪い）。
  自分の前の slug へ戻すのは通す（転送の行は、保存の batch の中で消える）。

  黙って番号を足して通さないのは、そうすると「保存した順」で URL が決まって
  しまうため。恒久リンクは1つの URL が1つの行を指すことに全部が懸かって
  いるので、重なりは人に直してもらう。
*/
export const SLUG_TAKEN = 'この slug は既に使われています'
export const SLUG_MOVED = (whose: string) =>
  `この slug は、${whose}の前の URL として転送に使っています。使うと、貼られた前の URL が行き先を変えます`

// 検査の結果を1つにまとめる。止める理由は全部返す（1つずつ返すと、直すたびに次が出る）
export function mergeErrors(
  ...sets: (Record<string, string> | null | undefined)[]
): Record<string, string> | null {
  const all: Record<string, string> = Object.assign({}, ...sets.filter(Boolean))
  return Object.keys(all).length ? all : null
}
