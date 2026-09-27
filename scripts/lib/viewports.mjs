/*
  設計サイズ。check:fit（レイアウト）と check:contrast（月の上の字が読めるか）が
  同じこの一覧を読む。CLAUDE.md と public/app.css の「9通り」は、この3つ × 骨格3つ。

  電話・板・机。ページは縦にスクロールするので、背の低い窓（WCAG 1.4.10 の
  320x256 など）でも中身はページごと読める。ここに入れるのは設計の基準にする3つだけ。

  touch は check:fit が指で測る印（hasTouch で pointer: coarse になる）。実物は指で
  触る寸法で、指のときは押す手が --tap の 44px になり、目次の行き先も 44px の
  的になって 899 以下の柱の帯が 30px → 44px に伸びる（app.css の
  @media (pointer: coarse)）。check:fit はこの姿で目次の的が --tap 以上かを測る。
*/
export const DESIGN_SIZES = [
  { width: 390, height: 844, touch: true },
  { width: 768, height: 1024, touch: true },
  { width: 1440, height: 900, touch: false },
]

/*
  「幅は広いのに背が低い」窓。パネルがいちばん短くなる（center で 810x366）。
  月と文字の間隔がいちばん詰まるので、check:contrast はこれも測る（収まりの
  検査 check:fit には入れない）。
*/
export const SHORT_WIDE = { width: 1024, height: 768 }
