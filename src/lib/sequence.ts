/*
  サイトのページの並びと、そこから組む目次。

  公開ページは節ごとに1ページ（入口・Projects・Profile・Contact・打ち込むブロック）で、
  ページのあいだを行き来する手は目次（上の帯）とページの中のリンクだけ
  （CLAUDE.md の「公開ページは縦に読む」）。トップ（ブロックの並び）・個人ページ・
  作品のページのどれも、サイトのページの並びから同じ目次を組む——別に組むと、
  節が1つ増えた日に片方だけ古い並びを出し続ける。

  以前はここが「画面の連なり」で、前後・節の中の数え方・作品の数え方（ページャ）まで
  持っていた。ページャを外したので、残っているのは目次の組み立てと印だけ。

  DOM も env も見ない純関数。ブラウザ無しに確かめられる場所に置く
  （test/sequence.test.ts）。
*/

/*
  サイトの1ページ。

  key は目次の単位で、印はいまのページと key が一致する行に付く。作品のページと
  2人以上のサイトの個人ページは、並びの外のページなので自分の key を持たず、
  呼ぶ側が「どの行に印を付けるか」を tableOfContents に渡す（作品は載っている
  一覧の projects、個人ページは team）。
*/
export type Page = {
  key: string
  // 目次に出す名前。null なら目次に出さない（Hero・ひとこと・見出しを空けたメモ）
  nav: string | null
  // このページの URL。絞り込み（?kind= / ?member=）はここに含める
  href: string
  /*
    正の URL。絞り込みは付けない——同じ中身の取り出し方なので、絞り込みの
    組み合わせのぶんだけ URL が数えられると、どれが本体か分からなくなる。
  */
  canonical: string
  // <title>。ページごとに変える。同じ題の URL が並ぶと、履歴から選び直せない
  title: string
}

export type NavLink = { href: string; label: string; active?: boolean }

/*
  並びの前提: 1つの URL・1つの key は並びに1度しか現れない。

  同じ URL が2度あると、目次に同じ行き先が2行出る。固定のブロックが二重送信で
  2行になったとき、実際にそうなった（当時は画面の底の「次」が自分自身を指して
  入口から先へ進めなくなった）。

  **重なりは落とさずに例外にする。** データの側はもう重なりを作れない
  （固定のブロックは DB の部分一意索引と publishedBlocks の重複落とし、
  打ち込むものは block-<id>、メンバーは slug の unique）。ここまで来る重なりは
  並びを組むコードの誤りで、黙って落とすと、どのページが消えたかを誰も知らない
  まま目次から1つ消える（sitemap も URL を重ねずに数えるので、検査からも見えない）。
  例外なら 500 になり、公開ページの全 URL を描くテスト（test/public.test.ts）が
  その場で落ちる。
*/
function assertUnique(pages: Page[]) {
  const hrefs = new Set<string>()
  const keys = new Set<string>()
  for (const page of pages) {
    if (hrefs.has(page.href)) {
      throw new Error(`ページの並びに同じ URL が2度並んでいる: ${page.href}`)
    }
    if (keys.has(page.key)) {
      throw new Error(`ページの並びに同じ key が2度並んでいる: ${page.key}`)
    }
    hrefs.add(page.href)
    keys.add(page.key)
  }
}

/*
  目次。名前のあるページを並びの順に1行ずつ、いまのページ（here。key）の行に印。
  here が並びに無い（作品を置いた一覧を外したサイトの作品のページ、Team を置いて
  いないサイトの個人ページ）なら印はどこにも付かない。
*/
export function tableOfContents(pages: Page[], here: string | null): NavLink[] {
  assertUnique(pages)
  return pages.flatMap((page) =>
    page.nav === null ? [] : [{ href: page.href, label: page.nav, active: page.key === here }],
  )
}
