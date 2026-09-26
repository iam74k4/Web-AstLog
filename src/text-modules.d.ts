/*
  CSS を文字列として読む（src/ui/components.tsx の Stylesheets が、中身から URL の版を
  作るため）。本番と wrangler dev は wrangler.toml の [[rules]]（Text）が、テストは
  vitest.config.ts の cssTextPlugin が、同じ「ファイルの中身の文字列」を渡す。

  このファイルに import / export を書かない（書くとモジュールになり、下の宣言が
  既にあるモジュールへの継ぎ足しと解釈されて効かなくなる。test/env.d.ts と同じ）。
*/
declare module '*.css' {
  const text: string
  export default text
}
