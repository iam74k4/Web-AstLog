/*
  src/ の .ts を検査スクリプトからそのまま読む。

  数（src/blocks.ts の MAX_CHARS）を検査の側に
  書き写すと、上限を変えた日に検査だけが古い数で測り続ける——しかも緑のままで
  分からない。だから数は blocks.ts そのものから読む。

  Node は型注釈を落として .ts を動かせる（22.18 / 23.6 以降は既定で）。足りないのは
  拡張子を省いた相対 import（`from './lib/format'`）の解決だけなので、それだけを
  足す。bundler（esbuild・tsx）を持ち込まないのは、どれも devDependencies に無く、
  入っているのは wrangler や vitest が連れてきた写しだから——版が勝手に変わる。

  読めるのは型注釈を落とすだけで動く書き方（enum・namespace・引数プロパティを
  使わない）のファイルに限る。src/ はいまそうなっている。書き方が変わったら、
  import がその場で例外を投げる（黙って空の値を返しはしない）。
*/

import { registerHooks } from 'node:module'

registerHooks({
  resolve(specifier, context, next) {
    const fromTs = context.parentURL?.endsWith('.ts')
    if (fromTs && specifier.startsWith('.') && !/\.[a-z]+$/.test(specifier)) {
      return next(`${specifier}.ts`, context)
    }
    return next(specifier, context)
  },
})

export const importTs = (path) => import(new URL(`../../${path}`, import.meta.url).href)
