/*
  見た目プリセットの key を src/theme.ts から拾う。

  検査スクリプトに 'rail' や 'violet' と書き写すと、4つ目のプリセットを
  足した日に、そのプリセットだけ誰も測らないまま出ていく——しかも緑のままで
  分からない。.ts をそのまま読み込めないので、宣言の文字列から key だけを拾う。

  宣言の形が変わったら（`as const` を外した、配列を関数で組むようにした）
  読めずに例外で止まる。空で返して「0通り測って合格」にはしない。
*/

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const THEME = fileURLToPath(new URL('../../src/theme.ts', import.meta.url))

export function keysOf(name) {
  const source = readFileSync(THEME, 'utf8')
  const block = source.match(new RegExp(`export const ${name} = \\[([\\s\\S]*?)\\] as const`))?.[1]
  if (!block) throw new Error(`src/theme.ts の ${name} を読めなかった（宣言の形が変わった？）`)
  const keys = [...block.matchAll(/key: '([^']+)'/g)].map((found) => found[1])
  if (keys.length === 0) throw new Error(`src/theme.ts の ${name} が空に見える`)
  return keys
}
