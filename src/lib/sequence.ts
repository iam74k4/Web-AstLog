/*
  画面の連なり。順序つきの列から「いま出す1枚」と、その前後・目次・ページャを組む。

  トップ（ブロックをほどいた列）と個人ページ（その人の画面の列）に、同じ手続きが
  2回書いてあった——URL から添字を引く / 範囲の外は「その URL は無い」/ prev と
  next / canonical / 目次の印 / 1枚しか無ければページャを出さない。並べるもの
  （何を画面にするか）は連なりごとに違うが、連ね方は同じで、2本あると片方だけ
  直した日に「トップではめくれるのに個人ページでは番号がずれる」が起きる。

  列の作り方だけを呼ぶ側に残し、連ね方はここ1本にする。3本目の連なり——作品1件の
  ページ同士をめくる列（src/routes/public.tsx の renderItem）——も、列を1つ用意した
  だけでページャと目次が付いてきた。

  DOM も env も見ない純関数。src/lib/paginate.ts と同じ理由で、ブラウザ無しに
  確かめられる場所に置く。
*/

/*
  連なりの1枚。

  navKey は節の単位。ページャはこれで「節の中の何枚目か」を数え、節をまたぐ手だけが
  行き先の nav を名乗る。ブロックの2画面目（/projects/2）も同じ navKey なので、
  Projects の 2 / 2 と数えられる。

  tocKey は目次の単位で、既定は navKey。目次に並ぶのは同じ tocKey のうち最初の
  1枚だけで、行き先はその画面の URL、印はいまの画面と tocKey が一致する行に付く。

  2つを分けてあるのは、節より大きなまとまりを目次の1行にしたいときがあるため。
  1人のサイトのプロフィールがそれで、1枚目・About・Skills・Career の4つの節は
  ページャではそれぞれ名乗る（「About →」「Contact →」）が、目次では
  「Profile」の1行にまとまり、どの画面でもその行に印が付く。目次に節を
  そのまま並べると、柱の目次が 3行から 6行に伸び、899 以下の帯に入らない。
*/
export type Step = {
  navKey: string
  /*
    目次のまとめ単位。省けば navKey。tocLabel はその行の名前で、省けば nav。
    null を渡すと目次に出さない（nav とは別に消せる——個人ページの画面は
    ページャでは名乗るが、2人以上のサイトでは目次に行を持たない）。
  */
  tocKey?: string
  tocLabel?: string | null
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
  列の前提: 1つの URL は列に1度しか現れない。

  stepAt は URL から findIndex で添字を引くので、同じ URL が2度あると2つ目の
  画面には決して着かない。そのうえ1つ目の「次」が同じ URL を指すので、
  ページャが自分自身を指して先へ進めなくなる——固定のブロックが二重送信で
  2行になったとき、入口の「次 →」を何度押しても入口に戻った。

  **重なりは落とさずに例外にする。** データの側はもう重なりを作れない
  （固定のブロックは DB の部分一意索引と publishedBlocks の重複落とし、
  打ち込むものは block-<id>、メンバーと作品は slug の unique）。ここまで来る
  重なりは列を組むコードの誤りで、黙って落とすと、どの画面が消えたかを誰も
  知らないまま一部の画面に着けなくなる（check:fit も sitemap も URL を重ねずに
  数えるので、検査からも見えない）。例外なら 500 になり、公開ページの全 URL を
  描くテスト（test/public.test.ts）がその場で落ちる。
*/
function assertUniqueHrefs(steps: Step[]) {
  const seen = new Set<string>()
  for (const step of steps) {
    if (seen.has(step.href)) {
      throw new Error(`画面の連なりに同じ URL が2度並んでいる: ${step.href}`)
    }
    seen.add(step.href)
  }
}

// 目次のまとめ単位と名前。省いたものは節（navKey / nav）と同じ
const tocKeyOf = (step: Step) => step.tocKey ?? step.navKey
// null は「目次に出さない」なので ?? では書けない（null も既定へ落ちてしまう）
const tocLabelOf = (step: Step) => (step.tocLabel === undefined ? step.nav : step.tocLabel)

/*
  index 枚目を出すための一式。範囲の外（-1 を含む）なら null を返す。

  2つの連なりをつなぐ（個人ページを Team の続きに差し込む）ときは、呼ぶ側が
  列を継ぎ合わせてからここへ渡す。目次とページャを別の列から取りたいときも
  同じで、2回呼んで要るほうを取る（src/routes/public.tsx の renderMemberScreen と
  renderItem。作品のページは、目次をサイトの列と継いだ列から、ページャを作品の列
  だけから取る）。
  1人のサイトのプロフィールは継ぎ合わせではなく、サイトの列そのものに入っている
  （Team の画面の代わり。同じ renderMemberScreen）。
*/
export function sequence(steps: Step[], index: number): Sequence | null {
  assertUniqueHrefs(steps)
  const current = steps[index]
  if (!current) return null

  /*
    目次は tocKey ごとに1行。2画面目以降を並べると、同じ見出しが数だけ増える
    （Projects · Projects · Projects）。行き先は最初の1枚＝そのまとまりの1画面目。

    名前の無い画面（Hero・ひとこと・目次に出さない個人ページ）は飛ばすが、
    その tocKey を「見た」ことにはしない。名前のある仲間が後ろに居れば、
    そちらが行になる。
  */
  const seen = new Set<string>()
  const nav: NavLink[] = []
  const here = tocKeyOf(current)
  for (const step of steps) {
    const label = tocLabelOf(step)
    const key = tocKeyOf(step)
    if (label === null || seen.has(key)) continue
    seen.add(key)
    nav.push({ href: step.href, label, active: key === here })
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
