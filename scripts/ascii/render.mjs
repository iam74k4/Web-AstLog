/*
  Bake real ASCII animation frames into self-contained SVG images. Geometry and
  lighting run here, not in visitors' browsers. SVG's discrete visibility clock
  shows one text frame at a time; a separate poster is used for reduced motion.
  Regenerate with `node scripts/ascii/render.mjs`.
*/
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { ROOT } from '../lib/dev-server.mjs'

const WIDTH = 1586
const HEIGHT = 992
const CELL_X = 17
const CELL_Y = 27
const FRAMES = 64
const PERIOD = 8
const RAMP = ' .:-=+*#%@'
const KINDS = ['black-hole', 'saturn', 'neptune', 'moon', 'sun', 'nebula']
const sheet = await readFile(`${ROOT}public/app.css`, 'utf8')
const ink = sheet.match(/--ink:\s*(#[\da-f]+);/i)?.[1]
const font = sheet.match(/--font-mono:\s*([^;]+);/)?.[1]
if (!ink || !font) throw new Error('The shared ink/font tokens are missing')

const clamp = (value) => Math.max(0, Math.min(1, value))
const gaussian = (value, width) => Math.exp(-((value / width) ** 2))
const noise = (x, y, z) =>
  (Math.sin(x * 6 + Math.sin(z * 4)) * Math.cos(y * 7 - z * 3) +
    0.45 * Math.sin(x * 14 + y * 9 + z * 11)) /
  1.45
const craters = [
  [-0.5, -0.3, 0.17],
  [0.65, 0.45, 0.2],
  [-1.4, 0.15, 0.14],
  [1.2, -0.45, 0.1],
  [-0.1, 0.62, 0.12],
  [2.6, -0.2, 0.23],
  [0.35, -0.6, 0.08],
  [-2.4, 0.6, 0.12],
  [1.7, 0.1, 0.16],
].map(([longitude, latitude, size]) => ({
  x: Math.sin(longitude) * Math.cos(latitude),
  y: Math.sin(latitude),
  z: Math.cos(longitude) * Math.cos(latitude),
  size,
}))

function globe(kind, x, y, phase) {
  const radius = kind === 'saturn' ? 215 : 292
  const nx = x / radius
  const ny = y / radius
  const square = nx * nx + ny * ny
  if (square >= 1) return null
  const nz = Math.sqrt(1 - square)
  const rotation = phase * Math.PI * 2
  const tx = nx * Math.cos(rotation) + nz * Math.sin(rotation)
  const tz = nz * Math.cos(rotation) - nx * Math.sin(rotation)
  const longitude = Math.atan2(tx, tz)
  const latitude = Math.asin(ny)
  const light = clamp(-0.55 * nx - 0.45 * ny + 0.72 * nz)
  let texture = 0.76
  if (kind === 'moon') {
    texture = 0.73 + noise(tx, ny, tz) * 0.14
    for (const crater of craters) {
      const distance = Math.sqrt(
        Math.max(0, 2 - 2 * (tx * crater.x + ny * crater.y + tz * crater.z)),
      )
      texture -= 0.3 * gaussian(distance, crater.size)
      texture += 0.16 * gaussian(distance - crater.size, crater.size * 0.25)
    }
  } else if (kind === 'neptune') {
    texture = 0.7 + 0.12 * Math.sin(latitude * 27 + Math.sin(longitude * 3) * 1.8)
    const storm = gaussian(Math.sin((longitude + 1.3) / 2), 0.15) * gaussian(latitude - 0.2, 0.12)
    texture -= storm * 0.25
  } else if (kind === 'saturn') {
    texture =
      0.74 +
      Math.sin(latitude * 33 + Math.sin(longitude * 3) * 0.6) * 0.11 +
      Math.cos(latitude * 17) * 0.08 +
      noise(tx, ny, tz) * 0.06
  } else {
    texture = 0.73 + 0.2 * noise(tx * 1.6, ny * 1.6, tz * 1.6)
  }
  if (kind === 'sun') return clamp(texture * (0.55 + nz * 0.45))
  return clamp(texture * (0.1 + light * 0.9))
}

function saturn(x, y, phase) {
  const angle = -0.31
  const rx = x * Math.cos(angle) + y * Math.sin(angle)
  const ry = -x * Math.sin(angle) + y * Math.cos(angle)
  const diskY = ry / 0.34
  const radius = Math.hypot(rx, diskY)
  const body = globe('saturn', x, y, phase)
  if (radius > 288 && radius < 460 && (body === null || diskY > 0)) {
    const gap = radius > 390 && radius < 405 ? 0.2 : 1
    const striation = 0.58 + 0.14 * Math.sin(radius * 0.19)
    const flow = 0.85 + 0.15 * Math.sin(Math.atan2(diskY, rx) * 8 - phase * Math.PI * 2)
    return striation * gap * flow
  }
  return body ?? 0
}

function nebula(x, y, phase) {
  const radius = Math.hypot(x / 1.15, y)
  const angle = Math.atan2(y, x)
  const rotation = phase * Math.PI * 2
  const twist = angle * 3 - radius * 0.014 - rotation
  // Rotate a fixed cloud field instead of advancing an unbounded noise slice.
  // Every term is periodic, including the seam from the last frame to the first.
  const nx = (x * Math.cos(rotation) + y * Math.sin(rotation)) / 120
  const ny = (y * Math.cos(rotation) - x * Math.sin(rotation)) / 150
  const cloud = 0.35 + Math.sin(twist) * 0.19 + noise(nx, ny, 0.7) * 0.2
  return Math.max(0, cloud - 0.14) * gaussian(radius, 410) * 1.6
}

function blackHole(x, y, phase) {
  const angle = -0.32
  const rx = x * Math.cos(angle) + y * Math.sin(angle)
  const ry = -x * Math.sin(angle) + y * Math.cos(angle)
  const radius = Math.hypot(rx, ry / 0.29)
  const orbit = Math.atan2(ry / 0.29, rx)
  const flow = 0.65 + 0.2 * Math.sin(orbit * 5 - radius * 0.045 - phase * Math.PI * 2)
  const disk = radius > 175 && radius < 510 ? gaussian(radius - 280, 180) * flow : 0
  const lensRadius = Math.hypot(x, y * 1.12)
  const lens = gaussian(lensRadius - 168, 22) * (y < 0 ? 0.8 : 0.45)
  const halo = nebula(x, y, phase) * 0.35
  // The shadow stays fixed while the textured accretion disk turns around it.
  if (Math.hypot(x, y * 1.12) < 131) return 0
  return Math.max(disk, lens, halo)
}

function intensity(kind, x, y, phase) {
  if (kind === 'black-hole') return blackHole(x, y, phase)
  if (kind === 'nebula') return nebula(x, y, phase)
  if (kind === 'saturn') return saturn(x, y, phase)
  const body = globe(kind, x, y, phase)
  if (body !== null) return body
  if (kind === 'sun') {
    const radius = Math.hypot(x, y)
    const ray = 0.5 + 0.5 * Math.sin(Math.atan2(y, x) * 17 + phase * Math.PI * 2)
    return gaussian(radius - 306, 46) * ray * 0.28
  }
  return 0
}

const escapeText = (text) =>
  text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')

function frame(kind, phase) {
  const rows = []
  for (let row = 0; row < Math.floor(HEIGHT / CELL_Y); row++) {
    let line = ''
    for (let column = 0; column < Math.floor(WIDTH / CELL_X); column++) {
      const value = intensity(kind, column * CELL_X - 1080, row * CELL_Y - 495, phase)
      line += RAMP[Math.min(RAMP.length - 1, Math.floor(clamp(value) * RAMP.length))]
    }
    const first = line.search(/\S/)
    if (first < 0) continue
    const text = line.trimEnd().slice(first)
    rows.push(
      `<tspan x="${first * CELL_X}" y="${row * CELL_Y}" textLength="${text.length * CELL_X}" lengthAdjust="spacingAndGlyphs">${escapeText(text)}</tspan>`,
    )
  }
  return `<text xml:space="preserve">${rows.join('')}</text>`
}

function svg(kind, animated) {
  const frames = animated ? FRAMES : 1
  const groups = Array.from({ length: frames }, (_, index) => {
    const begin = index === 0 ? 0 : -PERIOD * (1 - index / FRAMES)
    const clock = animated
      ? `<animate attributeName="visibility" values="visible;hidden;hidden" keyTimes="0;${1 / FRAMES};1" calcMode="discrete" dur="${PERIOD}s" begin="${begin}s" repeatCount="indefinite"/>`
      : ''
    return `<g visibility="${index === 0 ? 'visible' : 'hidden'}">${clock}${frame(kind, index / FRAMES)}</g>`
  })
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" fill="${ink}" font-family="${escapeText(font).replaceAll('"', '&quot;')}" font-size="26" font-weight="400"><title>AstLog ASCII ${kind}</title>${groups.join('')}</svg>\n`
}

const versioned = (name, text) =>
  `/assets/${name}?v=${createHash('sha256').update(text).digest('hex').slice(0, 8)}`
const assets = new Map()
const metadata = []
for (const kind of KINDS) {
  const motion = svg(kind, true)
  const still = svg(kind, false)
  const motionName = `ascii-${kind}.svg`
  const stillName = `ascii-${kind}-still.svg`
  assets.set(motionName, motion)
  assets.set(stillName, still)
  metadata.push(
    `  ${kind.includes('-') ? `'${kind}'` : kind}: {\n    motion: '${versioned(motionName, motion)}',\n    still: '${versioned(stillName, still)}',\n  },`,
  )
  console.log(
    `${kind}: ${FRAMES} frames / ${PERIOD}s, ${(Buffer.byteLength(motion) / 1024).toFixed(0)} KiB SVG`,
  )
}
for (const [name, content] of assets) await writeFile(`${ROOT}public/assets/${name}`, content)
await writeFile(
  `${ROOT}src/ui/ascii-art.ts`,
  `// Generated by scripts/ascii/render.mjs. Regenerate assets and URL versions together.\nexport const ASCII_ART = {\n${metadata.join('\n')}\n} as const\n`,
)
