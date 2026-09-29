/*
  アイコンはインライン SVG のみ。絵文字は使わない。
  ロゴは assets/astlog-mark.svg / astlog-wordmark.svg と同じ形。currentColor を
  継ぐので、置いた場所の文字色になる。
*/

/*
  AstLog のロゴ——字で組む ΛSTLOG。横棒の無い A（Λ）と、線の太さをそろえた幾何の
  大文字で、宇宙機関の字の系譜。記号（軌道・星・アスタリスク）を足さず、名前そのものを
  ロゴにする（記号の案はどれも持ち主に「ださい」と外された）。

  - Λ だけは塗りの形で描く。線で描くと足の切り口が脚に直角になり、片方の角が
    字の底より下へ出る。塗りなら足を水平に切れる
  - 丸い字（O・G・S）と尖った頂（Λ）は字の高さから少しはみ出させる（0.3）。
    そろえると、丸と尖りのほうが小さく見える
  - 字間は字の高さの 0.34 を土台に、組み合わせごとに目で詰める（L の右は上が
    空くので L→O を詰める、など）

  WORDMARK は字の高さ 20 の格子（原点は左下、上が負）。MARK は Λ だけを 24 の
  格子に置いたもの——favicon・404・管理画面の小さな印。

  ここが正。同じ形が4か所にある——この部品、Layout.tsx の favicon（data URI）、
  public/assets/astlog-mark.svg と astlog-wordmark.svg。前の2つはここから配り、
  後の2つは別ファイルなので test/public.test.ts が一致を見張る。
*/
export const WORDMARK = {
  viewBox: '0 -20.31 131.67 20.62',
  lambda: 'M0 0L9.2 -20.3L18.4 0L15.55 0L9.2 -14L2.85 0Z',
  strokes:
    'M35.94 -16.61A5.3 4.5 0 0 0 25.96 -14.5A5.3 4.5 0 0 0 31.26 -10A5.3 4.5 0 0 1 36.56 -5.5A5.3 4.5 0 0 1 26.58 -3.39M44.66 -18.7H60.26M52.46 -18.7V0M67.68 -20V-1.3H78.78M93.97 -19A9 9 0 1 1 93.97 -1A9 9 0 1 1 93.97 -19ZM128.46 -15.54A9 9 0 1 0 130.37 -10H122.45',
  stroke: 2.6,
} as const

export const MARK = 'M3 21.93L12 2.07L21 21.93L18.21 21.93L12 8.23L5.79 21.93Z'

/*
  印の中身を SVG の文字列で（favicon の data URI に入れる。属性は ' で括る）。
  MarkIcon と同じ MARK から組むので、2つの形はずれない
*/
export const markInner = (color: string) => `<path d='${MARK}' fill='${color}'/>`

/*
  size は必須。app.css はロゴの印に寸法を与える規則を持たないので、
  渡し忘れると素の 300x150 に落ちて版面が崩れる。
*/
export const MarkIcon = ({ size }: { size: number }) => (
  <svg
    viewBox="0 0 24 24"
    width={size}
    height={size}
    fill="currentColor"
    aria-hidden="true"
    focusable="false"
  >
    <path d={MARK} />
  </svg>
)

/*
  ワードマーク（ΛSTLOG）。大きさは置く側の CSS が高さで決める（幅は viewBox の
  縦横比から）。読み上げには出さない——名前は置く側が字で持つ（.sr-only の AstLog）
*/
export const Wordmark = ({ class: className }: { class: string }) => (
  <svg
    class={className}
    viewBox={WORDMARK.viewBox}
    fill="currentColor"
    aria-hidden="true"
    focusable="false"
  >
    <path d={WORDMARK.lambda} />
    <path d={WORDMARK.strokes} fill="none" stroke="currentColor" stroke-width={WORDMARK.stroke} />
  </svg>
)

/*
  入口の真ん中の星（軌道図の恒星。components.tsx の OrbitSystem）。4つの角が尖り、
  辺は内へへこむ曲線。縦の角を横より長くして、止まっていても瞬いて見える形にする。
  24 の格子いっぱいに描いてあり、寸法は置く側の CSS が決める（app.css の
  .system__star。枠と一緒に伸び縮みする）。
*/
export const STAR =
  'M12 1Q13.14 10.86 20.76 12Q13.14 13.14 12 23Q10.86 13.14 3.24 12Q10.86 10.86 12 1Z'

const stroke = {
  fill: 'none',
  stroke: 'currentColor',
  'stroke-width': '1.4',
  'stroke-linecap': 'round' as const,
  'stroke-linejoin': 'round' as const,
}

export const PencilIcon = () => (
  <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false" {...stroke}>
    <path d="M11 2l3 3-7.5 7.5L3 13l.5-3.5L11 2z" />
  </svg>
)

// 別のタブで開くもの（公開ページへ）
export const ExternalIcon = () => (
  <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false" {...stroke}>
    <path d="M9 3h4v4M13 3L7.5 8.5M11 9.5V13H3V5h3.5" />
  </svg>
)

export const TrashIcon = () => (
  <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false" {...stroke}>
    <path d="M3 4h10M6 4V2.5h4V4M4.5 4l.5 9h6l.5-9" />
  </svg>
)

export const GithubIcon = () => (
  <svg viewBox="0 0 16 16" width="13" height="13" fill="currentColor" aria-hidden="true">
    <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.4 7.4 0 0 1 2-.27c.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
  </svg>
)

export const MailIcon = () => (
  <svg viewBox="0 0 16 16" width="13" height="13" fill="currentColor" aria-hidden="true">
    <path d="M1.5 3h13A1.5 1.5 0 0 1 16 4.5v7a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 0 11.5v-7A1.5 1.5 0 0 1 1.5 3Zm.2 1.4 6.3 4.1 6.3-4.1H1.7Z" />
  </svg>
)
