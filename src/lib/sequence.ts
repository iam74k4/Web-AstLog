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

  navKey は目次の印を付ける単位。ブロックの2画面目（/projects/2）でも Projects の見出しに
  印が残るよう、URL ではなくこちらで揃える。目次に並ぶのは同じ navKey のうち
  最初の1枚だけで、行き先はその画面の URL（＝そのブロックの1画面目）。
*/
export type Step = {
  navKey: string
  // この画面自身の URL。絞り込み（?kind= / ?member=）はここに含める
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

    数えるのは**節の中**（Projects 2 / 4）で、全体の通し番号ではない。

    全体で数えていたころ（01 · 07）は3つ困っていた。
      1. 柱の「Apps」を押しても、Apps が3画面あることがどこにも出ない。
         手がかりは 02 · 07 だけで、これは Apps の2ページ目という意味ではない
      2. 「次」が「節の中の次」と「次の節へ移る」を兼ねていて、/apps/3 で
         押すと予告なく Works に出る
      3. **絞り込みが全体の番号を動かす。** Apps を macOS で絞ると 3画面が
         1画面になるので、無関係な Contact の番号が 07 から 05 に変わった
         （実測：/contact と /contact?platform=macos の違いはその数字だけ）

    節の中で数えれば3つとも消える。めくる先は今までどおり連なり全体なので、
    「次」を押し続ければサイトを一周できる性質は変わらない——変わるのは
    数え方と、節をまたぐときに行き先を名乗ること。
  */
  pager: {
    prev: string | null
    // 節をまたぐときだけ、行き先の節の名前。同じ節の中なら null
    prevSection: string | null
    next: string | null
    nextSection: string | null
    // いまの節の名前。名前を持たない節（Hero・ひとこと）では null
    section: string | null
    // 節の中での位置と、その節の画面数
    index: number
    total: number
  } | null
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

  2つの連なりをつなぐ（個人ページを Team の続きに差し込む）ときは、呼ぶ側が
  列を継ぎ合わせてからここへ渡す。目次とページャを別の列から取りたいときも
  同じで、2回呼んで要るほうを取る（src/routes/public.tsx の renderMemberScreen）。
*/
export function sequence(steps: Step[], index: number): Sequence | null {
  const current = steps[index]
  if (!current) return null

  /*
    目次は navKey ごとに1行。2画面目以降を並べると、同じ見出しが数だけ増える
    （Projects · Projects · Projects）。行き先は最初の1枚＝そのブロックの1画面目。
  */
  const seen = new Set<string>()
  const nav: NavLink[] = []
  for (const step of steps) {
    if (step.nav === null || seen.has(step.navKey)) continue
    seen.add(step.navKey)
    nav.push({ href: step.href, label: step.nav, active: step.navKey === current.navKey })
  }

  /*
    節の中での位置。navKey が同じものを1つの節として数える。

    列は節ごとにまとまって並んでいる（ブロックをほどいた順）ので、
    同じ navKey の連続した範囲がその節になる。
  */
  const sameSection = steps.filter((step) => step.navKey === current.navKey)
  const within = sameSection.indexOf(current)

  const prevStep = steps[index - 1] ?? null
  const nextStep = steps[index + 1] ?? null
  // 節をまたぐときだけ行き先を名乗る。同じ節の中なら「次 →」のまま
  const crossing = (step: Step | null) => (step && step.navKey !== current.navKey ? step.nav : null)

  return {
    index,
    current,
    nav,
    pager:
      steps.length > 1
        ? {
            // 端ではリンクそのものを出さない。押しても何も起きない手を置かない
            prev: prevStep?.href ?? null,
            prevSection: crossing(prevStep),
            next: nextStep?.href ?? null,
            nextSection: crossing(nextStep),
            section: current.nav,
            index: within + 1,
            total: sameSection.length,
          }
        : null,
  }
}
