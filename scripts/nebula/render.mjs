/*
  星雲を透過 WebP に焼く。node scripts/nebula/render.mjs

  形は orbits.ts の nebulaMap、色と4層の濃さは app.css が正。以前と同じ SVG の
  フィルタを生成時にだけ掛け、訪問者には絵を1枚配る。アクセラレーションを切った
  Edge では、inline SVG の漂いや周囲の動きで巨大なノイズのフィルタが描き直されていた。
  元の箱の半分の解像度でも雲の細部を保てる。版は各 WebP の SHA-256 の頭で、
  CSS の URL も一緒に更新する。形・色・濃さを変えたらこのスクリプトを流し直す。
*/

import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright'
import { ROOT } from '../lib/dev-server.mjs'
import { importTs } from '../lib/ts-import.mjs'

const { nebulaMap } = await importTs('src/lib/orbits.ts')
const map = nebulaMap()
const cssPath = `${ROOT}public/app.css`
let css = await readFile(cssPath, 'utf8')
const root = css.slice(css.indexOf(':root {'), css.indexOf('\n}', css.indexOf(':root {')))
const value = (body, name) => {
  const found = body.match(new RegExp(`${name}:\\s*([^;]+);`))?.[1]
  if (!found) throw new Error(`Missing nebula token: ${name}`)
  return found.trim()
}
const color = (body, name) => value(root, value(body, name).match(/^var\((--[a-z]+)\)$/)?.[1])
const tones = ['a', 'b', 'c', 'ink', 'dust']
const alpha = Object.fromEntries(
  ['light', 'cloud', 'veil', 'dust'].map((layer) => [
    layer,
    Number(value(root, `--nebula-${layer}`)),
  ]),
)
const region = `x="0" y="0" width="${map.width}" height="${map.height}" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB"`

const svg = (palette) => {
  const ellipse = (lobe) =>
    `<ellipse cx="${lobe.cx}" cy="${lobe.cy}" rx="${lobe.rx}" ry="${lobe.ry}" transform="rotate(${lobe.rot} ${lobe.cx} ${lobe.cy})" fill="url(#${lobe.tone})" opacity="${lobe.o}"/>`
  const lobes = (dust) =>
    map.lobes
      .filter((lobe) => (lobe.tone === 'dust') === dust)
      .map(ellipse)
      .join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${map.width}" height="${map.height}" viewBox="0 0 ${map.width} ${map.height}">
<defs>
${tones.map((tone) => `<radialGradient id="${tone}"><stop stop-color="${palette[tone]}" offset="0" stop-opacity="1"/><stop stop-color="${palette[tone]}" offset="0.45" stop-opacity="0.5"/><stop stop-color="${palette[tone]}" offset="1" stop-opacity="0"/></radialGradient>`).join('')}
<g id="lobes-glow">${lobes(false)}</g><g id="lobes-dust">${lobes(true)}</g>
<filter id="f-cloud" ${region}><feTurbulence type="fractalNoise" baseFrequency="0.0042 0.0075" numOctaves="5" seed="4" result="noise"/><feColorMatrix in="noise" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 2.1 0 0 0 -0.62" result="mask"/><feComposite in="SourceGraphic" in2="mask" operator="in"/></filter>
<filter id="f-veil" ${region}><feTurbulence type="turbulence" baseFrequency="0.006 0.01" numOctaves="4" seed="9" result="ridge"/><feTurbulence type="fractalNoise" baseFrequency="0.003" numOctaves="2" seed="21" result="warp"/><feDisplacementMap in="ridge" in2="warp" scale="90" xChannelSelector="R" yChannelSelector="G" result="bent"/><feColorMatrix in="bent" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 -4.6 0 0 0 1.05" result="mask"/><feComposite in="SourceGraphic" in2="mask" operator="in"/></filter>
<filter id="f-dust" ${region}><feTurbulence type="fractalNoise" baseFrequency="0.008 0.016" numOctaves="4" seed="33" result="noise"/><feColorMatrix in="noise" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 2.6 0 0 0 -0.9" result="mask"/><feComposite in="SourceGraphic" in2="mask" operator="in"/></filter>
</defs>
<use href="#lobes-glow" opacity="${alpha.light}"/><use href="#lobes-glow" filter="url(#f-cloud)" opacity="${alpha.cloud}"/><use href="#lobes-glow" filter="url(#f-veil)" opacity="${alpha.veil}"/><use href="#lobes-dust" filter="url(#f-dust)" opacity="${alpha.dust}"/>
</svg>`
}

const files = new Map()
const browser = await chromium.launch()
try {
  const page = await browser.newPage()
  for (const accent of ['iris', 'violet', 'ember', 'mint', 'sky', 'rose']) {
    const preset = css.match(new RegExp(`\\[data-accent='${accent}'\\] \\{([^}]+)\\}`))?.[1]
    const palette = {
      a: color(preset, '--nebula-a'),
      b: color(preset, '--nebula-b'),
      c: color(preset, '--nebula-c'),
      ink: value(root, '--ink'),
      dust: value(root, '--bg'),
    }
    const data = await page.evaluate(
      async ({ art, width, height }) => {
        const image = new Image()
        image.src = `data:image/svg+xml;base64,${art}`
        await image.decode()
        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        const context = canvas.getContext('2d')
        context.drawImage(image, 0, 0, width, height)
        return canvas.toDataURL('image/webp', 0.9).split(',')[1]
      },
      {
        art: Buffer.from(svg(palette)).toString('base64'),
        width: map.width / 2,
        height: map.height / 2,
      },
    )
    const bytes = Buffer.from(data, 'base64')
    const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 8)
    const file = `nebula-${accent}.webp`
    files.set(file, bytes)
    const urls = new RegExp(`/assets/${file.replace('.', '\\.')}\\?v=[0-9a-f]{8}`, 'g')
    if (!urls.test(css)) throw new Error(`Missing versioned nebula URL: ${file}`)
    css = css.replace(urls, `/assets/${file}?v=${hash}`)
    console.log(`${file}: ${bytes.length} bytes, v=${hash}`)
  }
} finally {
  await browser.close()
}
// 全色を解き終えてから、素材と版をそろえて保存する。
await mkdir(`${ROOT}public/assets`, { recursive: true })
for (const [name, bytes] of files) await writeFile(`${ROOT}public/assets/${name}`, bytes)
await writeFile(cssPath, css)
