import type { Child } from 'hono/jsx'

/*
  管理画面のフォームの部品。どの管理画面も、この部品だけで欄と操作を組む。
*/

type FieldFeedback = { name: string; error?: string; warning?: string; hint?: string }

const describedBy = (props: FieldFeedback) =>
  (['error', 'warning', 'hint'] as const)
    .filter((kind) => props[kind])
    .map((kind) => `field-${props.name}-${kind}`)
    .join(' ') || undefined

// 欄の名前はラベルだけ。修正理由とヒントは別の説明として、その欄へ結び付ける。
const Feedback = (props: FieldFeedback) => (
  <>
    {props.error ? (
      <span class="field__error" id={`field-${props.name}-error`}>
        {props.error}
      </span>
    ) : null}
    {props.warning ? (
      <span class="field__warn" id={`field-${props.name}-warning`}>
        {props.warning}
      </span>
    ) : null}
    {props.hint ? (
      <span class="field__hint" id={`field-${props.name}-hint`}>
        {props.hint}
      </span>
    ) : null}
  </>
)

export const FormKey = ({ value }: { value?: string | null }) =>
  value ? <input type="hidden" name="formKey" value={value} /> : null

export const FormVersion = ({ value }: { value: string }) => (
  <input type="hidden" name="_version" value={value} />
)

export const FormErrors = ({
  errors,
  latestHref,
}: {
  errors?: Record<string, string> | null
  latestHref?: string
}) =>
  errors && Object.keys(errors).length ? (
    <section
      class="form-errors"
      role="alert"
      aria-labelledby="form-errors-title"
      tabindex={-1}
      autofocus
    >
      <h2 id="form-errors-title">
        {errors._version ? '保存が競合しています' : '保存できませんでした'}
      </h2>
      <ul>
        {Object.entries(errors).map(([name, message]) => (
          <li key={name}>
            {name === '_version' ? (
              <span id="field-_version-error">{message}</span>
            ) : (
              <a href={`#field-${name}-error`}>{message}</a>
            )}
          </li>
        ))}
      </ul>
      {errors._version && latestHref ? (
        <a class="btn btn--ghost" href={latestHref} target="_blank" rel="noreferrer">
          最新の編集画面と比較する ↗
        </a>
      ) : null}
    </section>
  ) : null

export const FormSection = (props: { title: string; note?: string; children?: Child }) => (
  <section class="form-section">
    <div class="form-section__head">
      <h2 class="form-section__title">{props.title}</h2>
      {props.note ? <p class="form-section__note">{props.note}</p> : null}
    </div>
    <div class="form-grid">{props.children}</div>
  </section>
)

// 畳んだ欄で保存が止まったときは、その理由が隠れないように開いて返す。
export const FormDetails = (props: {
  title: string
  note?: string
  status?: string
  defaultOpen?: boolean
  errors?: Record<string, string> | null
  fields: readonly string[]
  children?: Child
}) => (
  <details
    class="form-details"
    open={props.defaultOpen || props.fields.some((field) => Boolean(props.errors?.[field]))}
  >
    <summary class="form-details__summary">
      {props.title}
      {props.status ? <span class="form-details__status">{props.status}</span> : null}
      {props.note ? <span class="form-details__note">{props.note}</span> : null}
    </summary>
    <div class="form-grid">{props.children}</div>
  </details>
)

export const Field = (props: {
  label: string
  name: string
  value?: string | number | null
  type?: string
  inputmode?: 'url' | 'email' | 'numeric' | 'text'
  hint?: string
  error?: string
  /*
    保存は止めないが、書いた人に知らせたいこと（作品の年が並びに使われない、など）。
    エラーとは色を分ける——赤で出すと「保存できなかった」と読まれる
  */
  warning?: string
  required?: boolean
  placeholder?: string
  // 上限がある欄には付ける（Area の maxlength の注記と同じ）
  maxlength?: number
}) => (
  <label class="field">
    <span class="field__label" id={`field-${props.name}-label`}>
      {props.label}
    </span>
    <input
      class={props.error ? 'input input--error' : 'input'}
      type={props.type ?? 'text'}
      inputmode={props.inputmode}
      name={props.name}
      aria-labelledby={`field-${props.name}-label`}
      aria-describedby={describedBy(props)}
      aria-invalid={props.error ? 'true' : undefined}
      value={props.value ?? ''}
      required={props.required}
      placeholder={props.placeholder}
      maxlength={props.maxlength}
    />
    <Feedback {...props} />
  </label>
)

export const Area = (props: {
  label: string
  name: string
  value?: string | null
  hint?: string
  rows?: number
  error?: string
  /*
    上限がある欄には付ける。ブラウザ側で止まるので、長い文を打ったあとに
    保存で弾かれて直す、という往復が減る。数える単位はサーバー側（コード
    ポイント）と少し違い、絵文字は2字と数えられる——止めるのが少しだけ
    早くなるぶんには困らないので、そろえずにそのまま使う。
    保存してよいかを決めるのは、いつもサーバー側の検査のほう
  */
  required?: boolean
  maxlength?: number
}) => (
  <label class="field field--wide">
    <span class="field__label" id={`field-${props.name}-label`}>
      {props.label}
    </span>
    <textarea
      class={props.error ? 'input input--area input--error' : 'input input--area'}
      name={props.name}
      aria-labelledby={`field-${props.name}-label`}
      aria-describedby={describedBy(props)}
      aria-invalid={props.error ? 'true' : undefined}
      rows={props.rows ?? 4}
      required={props.required}
      maxlength={props.maxlength}
    >
      {props.value ?? ''}
    </textarea>
    <Feedback {...props} />
  </label>
)

export const Select = (props: {
  label: string
  name: string
  value?: string | number | null
  options: { value: string; label: string }[]
  hint?: string
  error?: string
}) => (
  <label class="field">
    <span class="field__label" id={`field-${props.name}-label`}>
      {props.label}
    </span>
    <select
      class={props.error ? 'input input--error' : 'input'}
      name={props.name}
      aria-labelledby={`field-${props.name}-label`}
      aria-describedby={describedBy(props)}
      aria-invalid={props.error ? 'true' : undefined}
    >
      {props.options.map((option) => (
        <option
          key={option.value}
          value={option.value}
          selected={String(props.value ?? '') === option.value}
        >
          {option.label}
        </option>
      ))}
    </select>
    <Feedback {...props} />
  </label>
)

export const PublishToggle = ({ published }: { published: number }) => (
  <label class="toggle">
    <input type="checkbox" name="published" value="1" checked={published === 1} />
    <span class="toggle__track" aria-hidden="true">
      <span class="toggle__knob" />
    </span>
    <span class="toggle__text">
      公開する<span class="toggle__hint">保存すると反映。外すと下書き</span>
    </span>
  </label>
)

export const FormActions = ({
  cancelHref,
  deleteHref,
  deleteLabel = 'この項目を削除…',
  previewAction,
}: {
  cancelHref: string
  deleteHref?: string
  deleteLabel?: string
  previewAction?: string
}) => (
  <div class="form-actions">
    {deleteHref ? (
      <a class="btn btn--link btn--danger" href={deleteHref}>
        {deleteLabel}
      </a>
    ) : (
      <span />
    )}
    <div class="form-actions__right">
      <a class="btn btn--ghost" href={cancelHref}>
        キャンセル
      </a>
      {/* Enter による送信も、これまでどおり保存へ進む。最初の submit を保存にする。 */}
      <button class="btn btn--primary" type="submit">
        保存
      </button>
      {previewAction ? (
        <button
          class="btn btn--ghost"
          type="submit"
          formaction={previewAction}
          formtarget="_blank"
          formnovalidate
        >
          保存前にプレビュー
        </button>
      ) : null}
    </div>
  </div>
)

export const Confirm = (props: {
  title: string
  detail: string
  action: string
  cancelHref: string
  // ボタンの文言。既定は「削除する」。構成から外すときは「外す」
  verb?: string
  children?: Child
}) => (
  <div class="confirm">
    <h1>{props.title}</h1>
    <p>{props.detail}</p>
    {props.children}
    <form method="post" action={props.action} class="confirm__actions">
      <a class="btn btn--ghost" href={props.cancelHref}>
        キャンセル
      </a>
      <button class="btn btn--danger" type="submit">
        {props.verb ?? '削除する'}
      </button>
    </form>
  </div>
)
