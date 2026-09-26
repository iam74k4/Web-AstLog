/*
  設計サイズ。check:fit（収まるか）と check:contrast（月の上の字が読めるか）が
  同じこの一覧を読む。CLAUDE.md と public/app.css の「9通り」は、この3つ × 骨格3つ。

  電話・板・机。WCAG 1.4.10 の 320x256 はここに入れない——あの寸法にはカードが
  1枚も入らず、収めにいくと設計サイズの件数まで削ることになる。あちらは弁を開けて
  受け、そのかわりキーボードで操作できるようにしてある（節の tabindex）。

  touch は check:fit が指で測る印（hasTouch で pointer: coarse になる）。実物は指で
  触る寸法で、指のときは押す手が --tap の 44px になり、目次の行き先も 44px の
  的になって 899 以下の柱の帯が 30px → 44px に伸びる（app.css の
  @media (pointer: coarse)）。指の姿は細いポインタの姿より必ず高い（足すだけで
  削る規則が無い）ので、指で閉じれば細いポインタでも閉じる。
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
