import { BLACKHOLE_ART } from './logo'

// A fixed luminance mask reuses the artwork's bright disk, keeping its black
// center and outline untouched. Only the light beams move; reduce hides them.
export const BlackholeFlow = () => (
  <span
    class="blackhole-flow"
    style={`aspect-ratio:${BLACKHOLE_ART.width}/${BLACKHOLE_ART.height};--blackhole-flow-art:url(${BLACKHOLE_ART.src})`}
  >
    <span class="blackhole-flow__texture">
      {[0, 1].map((layer) => (
        <span class="blackhole-flow__beam" data-flow-layer={layer} />
      ))}
    </span>
  </span>
)
