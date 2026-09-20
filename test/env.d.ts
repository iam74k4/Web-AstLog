/*
  テストが読む型の宣言。

  **このファイルに `import` 文も `export` 文も書かない。** 1つでも書くと
  ファイルがモジュールになり、下の `declare module 'virtual:app-css'` は
  「既にあるモジュールへの継ぎ足し」と解釈されて効かなくなる（素の宣言として
  効くのは、モジュールではないファイルの中だけ）。外から型を借りるときは、
  下の `Bindings` のように `import('…')` を型の別名にしてから使う——
  `interface X extends import('…').Y` はそのままでは書けない（TS2499）。

  `cloudflare:test` の `env` の型は、グローバルの `Cloudflare.Env` で決まる
  （@cloudflare/vitest-pool-workers 0.22 でここへ移った。前に書いてあった
  `ProvidedEnv` はもう存在しない）。

  ここが間違っていても `npm test` は通る。vitest は型を見ずに落とすだけで、
  `tsconfig.json` の `skipLibCheck` はこの .d.ts 自身の誤りも黙らせるため。
  気づけるのは、tsconfig の include に test/** が入っていて、`env.DB` を
  読んでいる側（test/setup.ts など）が型エラーになるからである。
*/

// src/env.ts が正。ここに列を書き写すと、バインディングを足した日にずれる
type Bindings = import('../src/env').Env

declare namespace Cloudflare {
  interface Env extends Bindings {
    // drizzle-kit が生成した SQL。vitest.config.ts が bindings で渡す
    TEST_MIGRATIONS: import('@cloudflare/vitest-pool-workers').D1Migration[]
  }
}

// app.css の中身。静的ファイルはテストでは配られないので、
// vitest.config.ts の仮想モジュールから受け取る
declare module 'virtual:app-css' {
  const css: string
  export default css
}
