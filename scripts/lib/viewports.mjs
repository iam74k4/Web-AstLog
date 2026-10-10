/*
  設計サイズ。check:fit（レイアウト）が読む。

  電話・板・机。ページは縦にスクロールするので、背の低い窓（WCAG 1.4.10 の
  320x256 など）でも中身はページごと読める。ここに入れるのは設計の基準にする3つだけ。

  touch は check:fit が指で測る印（hasTouch で pointer: coarse になる）。実物は指で
  触る寸法で、指のときは押す手が --tap の 44px になる（app.css の
  @media (pointer: coarse)）。check:fit はこの姿で目次の的が --tap 以上かを測る。
*/
export const DESIGN_SIZES = [
  { width: 390, height: 844, touch: true },
  { width: 768, height: 1024, touch: true },
  { width: 1440, height: 900, touch: false },
]
