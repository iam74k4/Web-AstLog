// Built-in image_gen artwork, referenced only by normalized celestial keys.
// Keep the SHA-256 URL versions in sync when replacing a static asset.
export const CELESTIAL_ART = {
  sun: {
    src: '/assets/celestial-sun-v2.webp?v=23352d9a',
    width: 1254,
    height: 1254,
  },
  moon: {
    src: '/assets/celestial-moon-v2.webp?v=95419a05',
    width: 1254,
    height: 1254,
  },
  neptune: {
    src: '/assets/celestial-neptune-v2.webp?v=fa40f8bb',
    width: 1254,
    height: 1254,
  },
  saturn: {
    src: '/assets/celestial-saturn-v2.webp?v=d25892e3',
    width: 1254,
    height: 1254,
  },
} as const
