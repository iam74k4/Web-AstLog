/*
  一覧を「1画面ぶん」ずつに割る。

  公開ページはページ自体がスクロールしない。だから何件が1画面に入るかは
  ブラウザではなくサーバーが決め、入らないぶんは次の URL に送る。その
  割りかたがこの2つ。DOM も env も見ない純関数なので、ブラウザ無しで
  確かめられる。1画面あたりの件数（perScreen）は src/blocks.ts が正。
*/

/*
  perScreen 件ずつの配列に割る。0件なら空配列（「1画面目は空」ではない）。

  節ごと出さない・見出しだけ残さない、という既存の決まりに合わせてある。
  perScreen が 1 未満だと1件も進まず終わらないので、下限を 1 に切り上げる。
*/
export function chunk<T>(rows: T[], perScreen: number): T[][] {
  const size = Math.max(1, Math.floor(perScreen))
  const screens: T[][] = []
  for (let i = 0; i < rows.length; i += size) {
    screens.push(rows.slice(i, i + size))
  }
  return screens
}

// 何画面になるか。0件なら0画面（chunk の長さと必ず一致する）
export function screenCount(total: number, perScreen: number): number {
  const size = Math.max(1, Math.floor(perScreen))
  return Math.max(0, Math.ceil(total / size))
}
