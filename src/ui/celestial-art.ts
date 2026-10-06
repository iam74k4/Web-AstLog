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
