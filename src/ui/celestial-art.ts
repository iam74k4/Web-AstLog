import type { CelestialBody } from '../celestial'

// Built-in image_gen artwork, referenced only by normalized celestial keys.
// Keep the SHA-256 URL versions in sync when replacing a static asset.
export const CELESTIAL_ART = {
  sun: {
    src: '/assets/celestial-sun-v2.webp?v=0383b12e',
    width: 1254,
    height: 1254,
  },
  moon: {
    src: '/assets/celestial-moon-v2.webp?v=99af9d0a',
    width: 1254,
    height: 1254,
  },
  neptune: {
    src: '/assets/celestial-neptune-v2.webp?v=568d3093',
    width: 1254,
    height: 1254,
  },
  saturn: {
    src: '/assets/celestial-saturn-v2.webp?v=7eb69c84',
    width: 1254,
    height: 1254,
  },
} as const

// The five covers share the same 1586x992 canvas and CSS layout. The closing
// black-hole page uses a cloud instead of repeating its entrance artwork.
export const ASTRA_COVER_ART = {
  'black-hole': '/assets/astra-black-hole.webp?v=34a75e33',
  moon: '/assets/astra-moon.webp?v=e116ae47',
  saturn: '/assets/astra-saturn.webp?v=5451b5ef',
  neptune: '/assets/astra-neptune.webp?v=26bbe195',
  sun: '/assets/astra-sun.webp?v=8d4f9dda',
} as const satisfies Record<CelestialBody, string>

export const ASTRA_CONTACT_ART = '/assets/astra-nebula-v2.webp?v=2cf6e359'
