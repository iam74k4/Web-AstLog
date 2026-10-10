/*
  ロゴと天体の飾りの素材を書き出す。`node scripts/logo/export.mjs`

  形の正は src/ui/logo.ts（ページのロゴはそこから直に SVG を描く）と src/ui/astra.ts
  （夜空の窓の空。app.css が背景として読む）。ここは、ページの
  外で使う素材——ファイルとしての SVG（ワードマーク・favicon・空）と、SVG を読めない所に
  渡す PNG（favicon・iPhone のホーム画面・共有カード）——を同じ形から作る。
  手で描き直さない（test/public.test.ts が SVG の中身を logo.ts・astra.ts と突き合わせる）。

  PNG はブラウザ（Playwright の Chromium）で SVG を描いて撮る。共有カード（1200×630）の
  所在（astlog.dev）だけはワードマークと同じ線の字ではないので、HTML の字として重ねて撮る
  ——書き出す環境の書体に左右されるのはこの1行だけ。全部を撮り終えてから書く——途中で
  落ちたときに、新しい SVG と古い PNG が並んで残らないように。
*/

import { writeFile } from 'node:fs/promises'
import { chromium } from 'playwright'
import { ROOT } from '../lib/dev-server.mjs'
import { importTs } from '../lib/ts-import.mjs'

const logo = await importTs('src/ui/logo.ts')
const astra = await importTs('src/ui/astra.ts')
const ASSETS = `${ROOT}public/assets/`

const files = new Map([
  ['astlog-wordmark.svg', logo.wordmarkSvg()],
  ['favicon.svg', logo.iconSvg()],
  ['sky.svg', astra.skySvg()],
])

const sized = (svg, width, height) =>
  svg.replace('<svg ', `<svg width="${width}" height="${height}" `)

const browser = await chromium.launch()
try {
  for (const [file, size] of [
    ['favicon-32.png', 32],
    ['apple-touch-icon.png', 180],
  ]) {
    const shot = await browser.newPage({ viewport: { width: size, height: size } })
    await shot.setContent(
      `<!doctype html><style>html,body{margin:0;background:transparent}svg{display:block}</style>${sized(logo.iconSvg(), size, size)}`,
    )
    files.set(file, await shot.screenshot({ omitBackground: true }))
    await shot.close()
  }

  const { width, height, pad } = logo.CARD
  const card = await browser.newPage({ viewport: { width, height } })
  await card.setContent(
    `<!doctype html><style>
      html,body{margin:0}
      body{position:relative;width:${width}px;height:${height}px}
      svg{display:block}
      p{position:absolute;left:${pad}px;bottom:${pad}px;margin:0;
        font:500 28px 'Helvetica Neue','Hiragino Sans',system-ui,sans-serif;
        letter-spacing:0.02em;color:${logo.LOGO_COLORS.ink};opacity:0.6}
    </style>${sized(logo.cardSvg(), width, height)}<p>astlog.dev</p>`,
  )
  files.set('astlog-card.png', await card.screenshot())
  await card.close()
} finally {
  await browser.close()
}

for (const [file, content] of files) await writeFile(`${ASSETS}${file}`, content)
console.log(`書き出した: ${[...files.keys()].join('・')}`)
