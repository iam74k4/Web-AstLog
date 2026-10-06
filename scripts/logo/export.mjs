/*
  ロゴの素材を書き出す。`node scripts/logo/export.mjs`

  形の正は src/ui/logo.ts（ページのロゴはそこから直に SVG を描く）。ここは、ページの
  外で使う素材——ファイルとしての SVG（ワードマークと favicon）と、SVG を読めない所に
  渡す PNG（favicon・iPhone のホーム画面）——を同じ形から作る。O の光は入口のブラック
  ホールと同じ絵（logo.ts の BLACKHOLE_ART が指す1枚）で、差し替えたらここも流し直す。
  手で描き直さない（test/public.test.ts が SVG の中身を logo.ts と突き合わせる）。

  SVG のファイルはページの外で開かれ、/assets の絵を読みに行けないので、絵を data URI で
  抱える。全ページでキャッシュを共有する原画像を各SVGに複製しないよう、ブラウザ
  （Playwright の Chromium）の canvas で幅 ART_WIDTH に描き直した WebP を入れる。
  PNG は元の絵のまま描いて撮る。favicon と
  ホーム画面は、どちらも地の色の正方形に載せた同じ印（logo.ts の iconSvg）を大きさだけ
  変えて撮る。全部を撮り終えてから書く——途中で落ちたときに、新しい SVG と古い PNG が
  並んで残らないように。
*/

import { readFile, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright'
import { ROOT } from '../lib/dev-server.mjs'
import { importTs } from '../lib/ts-import.mjs'

const logo = await importTs('src/ui/logo.ts')
const ASSETS = `${ROOT}public/assets/`

/*
  SVG のファイルに抱える絵の幅（画素）。ページ内のロゴと表紙は2倍解像度にも余裕のある
  原画像を読む。この縮小画像はファイルとして使うロゴ用で、favicon の2倍解像度にも足りる。
  test/public.test.ts は埋め込む絵が12KB未満であることを確かめる
*/
const ART_WIDTH = 320
// 原画像の柔らかな光を残しつつ、埋め込みの12KB予算に収める。
const ART_QUALITY = 0.89

// 絵のファイル（URL の ?v= の版を落としたパス）
const artPath = `${ROOT}public${logo.BLACKHOLE_ART.src.split('?')[0]}`
const art = (await readFile(artPath)).toString('base64')

const browser = await chromium.launch()
const files = new Map()
try {
  const page = await browser.newPage()
  const small = await page.evaluate(
    async ({ art, width, height, quality }) => {
      const image = new Image()
      image.src = `data:image/webp;base64,${art}`
      await image.decode()
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const context = canvas.getContext('2d')
      context.imageSmoothingQuality = 'high'
      context.drawImage(image, 0, 0, width, height)
      return canvas.toDataURL('image/webp', quality).split(',')[1]
    },
    {
      art,
      width: ART_WIDTH,
      height: Math.round((ART_WIDTH * logo.BLACKHOLE_ART.height) / logo.BLACKHOLE_ART.width),
      quality: ART_QUALITY,
    },
  )
  await page.close()
  files.set('astlog-wordmark.svg', logo.wordmarkSvg(small))
  files.set('favicon.svg', logo.iconSvg(small))

  for (const [file, size] of [
    ['favicon-32.png', 32],
    ['apple-touch-icon.png', 180],
  ]) {
    const shot = await browser.newPage({ viewport: { width: size, height: size } })
    await shot.setContent(
      `<!doctype html><style>html,body{margin:0;background:transparent}svg{display:block}</style>${logo.iconSvg(art).replace('<svg ', `<svg width="${size}" height="${size}" `)}`,
    )
    // SVG の <image> は document.images に入らないので、読み込み（setContent が待つ）のあと2コマ待つ
    await shot.evaluate(
      () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
    )
    files.set(file, await shot.screenshot({ omitBackground: true }))
    await shot.close()
  }
} finally {
  await browser.close()
}

for (const [file, content] of files) await writeFile(`${ASSETS}${file}`, content)
console.log(`書き出した: ${[...files.keys()].join('・')}`)
