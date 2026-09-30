/*
  ロゴの素材を書き出す。`node scripts/logo/export.mjs`

  形の正は src/ui/logo.ts（ページのロゴはそこから直に SVG を描く）。ここは、ページの
  外で使う素材——ファイルとしての SVG（ワードマークと favicon）と、SVG を読めない所に
  渡す PNG（favicon・iPhone のホーム画面）——を同じ形から作る（GitHub の Organization の
  顔は scripts/blackhole/render.py の avatar が焼く）。手で描き直さない（test/public.test.ts が SVG の中身を logo.ts と突き合わせる）。

  PNG はブラウザ（Playwright の Chromium）で SVG を描いて撮る。favicon とホーム画面は、
  どちらも地の色の正方形に載せた同じ印（logo.ts の iconSvg）を大きさだけ変えて撮る。全部を撮り終えてから書く——途中で落ちたときに、新しい SVG と古い PNG が
  並んで残らないように。
*/

import { writeFile } from 'node:fs/promises'
import { chromium } from 'playwright'
import { ROOT } from '../lib/dev-server.mjs'
import { importTs } from '../lib/ts-import.mjs'

const logo = await importTs('src/ui/logo.ts')
const ASSETS = `${ROOT}public/assets/`

const PNGS = [
  { file: 'favicon-32.png', size: 32, svg: logo.iconSvg() },
  { file: 'apple-touch-icon.png', size: 180, svg: logo.iconSvg() },
]

const files = new Map([
  ['astlog-wordmark.svg', logo.wordmarkSvg()],
  ['favicon.svg', logo.iconSvg()],
])

const browser = await chromium.launch()
try {
  for (const { file, size, svg } of PNGS) {
    const page = await browser.newPage({ viewport: { width: size, height: size } })
    await page.setContent(
      `<!doctype html><style>html,body{margin:0;background:transparent}svg{display:block}</style>${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}`,
    )
    files.set(file, await page.screenshot({ omitBackground: true }))
    await page.close()
  }
} finally {
  await browser.close()
}

for (const [file, content] of files) await writeFile(`${ASSETS}${file}`, content)
console.log(`書き出した: ${[...files.keys()].join('・')}`)
