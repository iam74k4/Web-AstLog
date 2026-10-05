// Built-in image_gen artwork, referenced only by normalized celestial keys.
// Keep the SHA-256 URL versions in sync when replacing a static asset.
export const CELESTIAL_ART = {
  sun: {
    src: '/assets/celestial-sun-v2.webp?v=85c08ca7',
    width: 1254,
    height: 1254,
  },
  moon: {
    src: '/assets/celestial-moon-v2.webp?v=a541a3f0',
    width: 1254,
    height: 1254,
  },
  neptune: {
    src: '/assets/celestial-neptune-v2.webp?v=4cfe95a4',
    width: 1254,
    height: 1254,
  },
  saturn: {
    src: '/assets/celestial-saturn-v2.webp?v=394a3e6e',
    width: 1254,
    height: 1254,
  },
} as const
