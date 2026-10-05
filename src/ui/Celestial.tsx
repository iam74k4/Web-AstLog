import { normalizeCelestial } from '../celestial'
import { BlackholeFlow } from './BlackholeFlow'
import { CELESTIAL_ART } from './celestial-art'
import { HoleMark } from './icons'
import { BLACKHOLE_ART } from './logo'

export type CelestialMember = {
  celestialBody?: string | null
  celestialAccent?: string | null
}

type CelestialProps = {
  member?: CelestialMember
  body?: string
  accent?: string
  id?: string
}

const picked = ({ member, body, accent }: CelestialProps) =>
  normalizeCelestial({
    celestialBody: body ?? member?.celestialBody,
    celestialAccent: accent ?? member?.celestialAccent,
  })

// Element-level theme selection is only placed on the decorative side of a profile.
export const celestialTheme = (member?: CelestialMember) => {
  const { accent } = normalizeCelestial(member)
  return accent === 'inherit' ? undefined : accent
}

const ArtGuide = () => (
  <svg class="celestial__guide" viewBox="0 0 360 300" aria-hidden="true" focusable="false">
    <ellipse cx="180" cy="150" rx="169" ry="116" transform="rotate(-24 180 150)" />
    <path d="M62 61V69M58 65H66M293 215V225M288 220H298" />
    <circle cx="98" cy="254" r="1.2" />
    <circle cx="283" cy="51" r="1.6" />
    <circle cx="332" cy="112" r="1" />
  </svg>
)

// Each decorative body uses one versioned image, with the same shared guide and halo.
// The image dimensions reserve its layout before decoding.
export const CelestialArt = (props: CelestialProps) => {
  const { body, accent } = picked(props)
  return (
    <div
      id={props.id}
      class="celestial celestial--art"
      data-celestial-body={body}
      data-celestial-accent={accent}
      aria-hidden="true"
    >
      <ArtGuide />
      <span class="celestial__halo"></span>
      {body === 'black-hole' ? (
        <span
          class="celestial__black-hole"
          style={`--celestial-hole-shadow:${Math.round(((2 * BLACKHOLE_ART.shadow) / BLACKHOLE_ART.width) * 10000) / 100}%`}
        >
          <img
            src={BLACKHOLE_ART.src}
            width={BLACKHOLE_ART.width}
            height={BLACKHOLE_ART.height}
            alt=""
            decoding="async"
          />
          <BlackholeFlow />
        </span>
      ) : (
        <img
          class="celestial__image"
          src={CELESTIAL_ART[body].src}
          width={CELESTIAL_ART[body].width}
          height={CELESTIAL_ART[body].height}
          alt=""
          decoding="async"
        />
      )}
      {body === 'sun' && (
        <span class="celestial__corona">
          <img
            class="celestial__corona-image"
            src={CELESTIAL_ART.sun.src}
            width={CELESTIAL_ART.sun.width}
            height={CELESTIAL_ART.sun.height}
            alt=""
            decoding="async"
          />
        </span>
      )}
    </div>
  )
}

export const CelestialSymbol = (props: CelestialProps) => {
  const { body, accent } = picked(props)
  return (
    <span
      class="celestial celestial--symbol"
      data-celestial-body={body}
      data-celestial-accent={accent}
      aria-hidden="true"
    >
      {body === 'black-hole' ? (
        <HoleMark size={24} />
      ) : (
        <svg viewBox="0 0 32 32" aria-hidden="true" focusable="false">
          {body === 'saturn' ? (
            <>
              <circle cx="16" cy="16" r="7" />
              <ellipse cx="16" cy="16" rx="15" ry="4" transform="rotate(-24 16 16)" />
            </>
          ) : body === 'neptune' ? (
            <>
              <circle cx="16" cy="16" r="10" />
              <path d="M7 11Q16 15 25 11M6 18Q16 23 26 18" />
            </>
          ) : body === 'moon' ? (
            <>
              <circle cx="16" cy="16" r="10" />
              <circle cx="12" cy="12" r="2.5" />
              <circle cx="20" cy="19" r="3" />
              <circle cx="11" cy="21" r="1" />
            </>
          ) : (
            <>
              <circle cx="16" cy="16" r="6" />
              <path d="M16 1V5M16 27V31M1 16H5M27 16H31M5 5L8 8M24 24L27 27M5 27L8 24M24 8L27 5" />
            </>
          )}
        </svg>
      )}
    </span>
  )
}
