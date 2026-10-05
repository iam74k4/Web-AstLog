import { BLACKHOLE_ART } from './logo'

// Only the front disk carries a drifting texture. The original shadow stays still.
// Both layers reuse the cached artwork; CSS hides them when motion is reduced.
export const BlackholeFlow = () => (
  <span
    class="blackhole-flow"
    style={`aspect-ratio:${BLACKHOLE_ART.width}/${BLACKHOLE_ART.height}`}
  >
    {[0, 1].map((layer) => (
      <img
        class="blackhole-flow__image"
        data-flow-layer={layer}
        src={BLACKHOLE_ART.src}
        width={BLACKHOLE_ART.width}
        height={BLACKHOLE_ART.height}
        alt=""
        decoding="async"
      />
    ))}
  </span>
)
