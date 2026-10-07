import { CELESTIAL_ACCENTS, CELESTIAL_BODIES } from '../celestial'
import { ADMIN_ART } from './admin-art'
import { Wordmark } from './icons'

export const CelestialChoices = ({
  body,
  accent,
  errors,
}: {
  body: string
  accent: string
  errors?: Record<string, string>
}) => (
  <div class="celestial-choices field--wide">
    <fieldset>
      <legend>天体</legend>
      {!CELESTIAL_BODIES.some((option) => option.key === body) ? (
        <label class="field__error">
          <input type="radio" name="celestialBody" value={body} checked /> 選べない値: {body}
        </label>
      ) : null}
      <div class="celestial-choices__grid">
        {CELESTIAL_BODIES.map((option) => {
          const art = ADMIN_ART[option.key]
          return (
            <label class="celestial-choice" key={option.key}>
              <input
                type="radio"
                name="celestialBody"
                value={option.key}
                checked={body === option.key}
              />
              <span>
                <img src={art.src} alt="" width={96} height={96} loading="lazy" />
                <strong>{option.label}</strong>
                <small>{option.note}</small>
              </span>
            </label>
          )
        })}
      </div>
      {errors?.celestialBody ? (
        <p class="field__error" id="field-celestialBody-error">
          {errors.celestialBody}
        </p>
      ) : null}
    </fieldset>
    <fieldset>
      <legend>装飾色</legend>
      <p class="field__hint">文字やリンクの色は変わりません。</p>
      {!CELESTIAL_ACCENTS.some((option) => option.key === accent) ? (
        <label class="field__error">
          <input type="radio" name="celestialAccent" value={accent} checked /> 選べない値: {accent}
        </label>
      ) : null}
      <div class="accent-choices">
        {CELESTIAL_ACCENTS.map((option) => (
          <label class="accent-choice" data-accent={option.key} key={option.key}>
            <input
              type="radio"
              name="celestialAccent"
              value={option.key}
              checked={accent === option.key}
            />
            <span>
              <i aria-hidden="true" />
              {option.key === 'inherit' ? 'サイトの色' : option.label}
            </span>
          </label>
        ))}
      </div>
      {errors?.celestialAccent ? (
        <p class="field__error" id="field-celestialAccent-error">
          {errors.celestialAccent}
        </p>
      ) : null}
    </fieldset>
  </div>
)

export const DesignSample = () => (
  <section class="design-sample" aria-label="色と書体の使用例">
    <div class="design-sample__brand">
      <Wordmark class="admin-wordmark" />
      <span>表示の見本</span>
    </div>
    <h2>つくる、その先へ。</h2>
    <p>選んだ書体は見出しに、色はリンクと選択状態に反映されます。</p>
    <span class="design-sample__link">Projects →</span>
    <span class="design-sample__pill">選択中</span>
  </section>
)

// 保存済み本文を描かず、ブロックの構造だけを小さく示す。公開用の見た目はプレビューで確認する。
export const BlockIllustration = ({ type }: { type: string }) => (
  <div class="block-illustration" data-block-kind={type} aria-hidden="true">
    {type === 'numbers' ? (
      <>
        <b>24</b>
        <b>08</b>
        <b>03</b>
      </>
    ) : type === 'hero' || type === 'team' || type === 'contact' ? (
      <>
        <img src={ADMIN_ART['black-hole'].src} alt="" width={80} height={80} loading="lazy" />
        <span>
          <i />
          <i />
          <i />
        </span>
      </>
    ) : type === 'statement' ? (
      <strong>つくる、その先へ。</strong>
    ) : (
      <>
        <i />
        <i />
        <i />
      </>
    )}
  </div>
)

export const PlacementHint = ({
  label,
  children,
}: {
  label: string
  children?: import('hono/jsx').Child
}) => (
  <aside class="placement-hint">
    <span>{label}</span>
    <p>{children}</p>
  </aside>
)
