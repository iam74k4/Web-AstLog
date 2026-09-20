/*
  画面の連なり。順序つきの列から「いま出す1枚」と、その前後・目次・ページャを組む。

  トップ（ブロックをほどいた列）と個人ページ（その人の画面の列）に、同じ手続きが
  2回書いてあった——URL から添字を引く / 範囲の外は「その URL は無い」/ prev と
  next / canonical / 目次の印 / 1枚しか無ければページャを出さない。並べるもの
  （何を画面にするか）は連なりごとに違うが、連ね方は同じで、2本あると片方だけ
  直した日に「トップではめくれるのに個人ページでは番号がずれる」が起きる。

  列の作り方だけを呼ぶ側に残し、連ね方はここ1本にする。3本目の連なり（作品の
  恒久リンクのような）を足すときも、列を1つ用意すればページャと目次が付いてくる。

  DOM も env も見ない純関数。src/lib/paginate.ts と同じ理由で、ブラウザ無しに
  確かめられる場所に置く。
*/

/*
  連なりの1枚。

  navKey は目次の印を付ける単位。ブロックの2画面目（/apps/2）でも Apps の見出しに
  印が残るよう、URL ではなくこちらで揃える。目次に並ぶのは同じ navKey のうち
  最初の1枚だけで、行き先はその画面の URL（＝そのブロックの1画面目）。
*/
export type Step = {
  navKey: string
  // この画面自身の URL。絞り込み（?platform= / ?member=）はここに含める
  href: string
  /*
    正の URL。絞り込みは付けない——同じ中身の取り出し方なので、ピルの
    組み合わせのぶんだけ URL が数えられると、どれが本体か分からなくなる。
  */
  canonical: string
  // 目次に出す名前。null なら目次に出さない（Hero・ひとこと）
  nav: string | null
  // <title>。画面ごとに変える。同じ題の URL が並ぶと、履歴から選び直せない
  title: string
}

export type NavLink = { href: string; label: string; active?: boolean }

export type Sequence = {
  index: number
  current: Step
  nav: NavLink[]
  /*
    ページャに渡す値。1枚しか無いときは null——めくる先が無いので帯ごと出さない。
    通し番号（01 · 07）は列の添字を1始まりにしたもので、ブロック単位ではない。
  */
  pager: { prev: string | null; next: string | null; index: number; total: number } | null
}

/*
  URL から画面を引く。名指しが無ければ先頭（どちらの連なりも、入口は1枚目）。

  見つからなければ -1。呼ぶ側はそれをそのまま「その URL は無い」に落とす
  ——知らない画面の名前も、範囲の外のページ数も、絞り込みで中身が無くなった
  画面も、ここでは同じ1つの結果になる。
*/
export function stepAt(steps: Step[], href: string | null): number {
  return href === null ? 0 : steps.findIndex((step) => step.href === href)
}

/*
  index 枚目を出すための一式。範囲の外（-1 を含む）なら null を返す。

  tail は連なりの外にある行き先（個人ページの「Apps · Works」）。めくって着く先
  ではないので、目次の最後に置いて、ページャとは別のものだと分かるようにする。
*/
export function sequence(steps: Step[], index: number, tail: NavLink[] = []): Sequence | null {
  const current = steps[index]
  if (!current) return null

  /*
    目次は navKey ごとに1行。2画面目以降を並べると、同じ見出しが数だけ増える
    （Apps · Apps · Apps）。行き先は最初の1枚＝そのブロックの1画面目。
  */
  const seen = new Set<string>()
  const nav: NavLink[] = []
  for (const step of steps) {
    if (step.nav === null || seen.has(step.navKey)) continue
    seen.add(step.navKey)
    nav.push({ href: step.href, label: step.nav, active: step.navKey === current.navKey })
  }

  return {
    index,
    current,
    nav: [...nav, ...tail],
    pager:
      steps.length > 1
        ? {
            // 端ではリンクそのものを出さない。押しても何も起きない手を置かない
            prev: steps[index - 1]?.href ?? null,
            next: steps[index + 1]?.href ?? null,
            index: index + 1,
            total: steps.length,
          }
        : null,
  }
}
