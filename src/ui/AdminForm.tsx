import type { Child } from 'hono/jsx'

/*
  管理画面のフォームの部品。どの管理画面も、この部品だけで欄と操作を組む。
*/

export const FormKey = ({ value }: { value?: string | null }) =>
  value ? <input type="hidden" name="formKey" value={value} /> : null

export const Field = (props: {
  label: string
  name: string
  value?: string | number | null
  type?: string
  hint?: string
  error?: string
  /*
    保存は止めないが、書いた人に知らせたいこと（作品の年が並びに使われない、など）。
    エラーとは色を分ける——赤で出すと「保存できなかった」と読まれる
  */
  warning?: string
  required?: boolean
  placeholder?: string
}) => (
  <label class="field">
    <span class="field__label">{props.label}</span>
    <input
      class={props.error ? 'input input--error' : 'input'}
      type={props.type ?? 'text'}
      name={props.name}
      value={props.value ?? ''}
      required={props.required}
      placeholder={props.placeholder}
    />
    {props.error ? <span class="field__error">{props.error}</span> : null}
    {props.warning ? <span class="field__warn">{props.warning}</span> : null}
    {props.hint ? <span class="field__hint">{props.hint}</span> : null}
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
  maxlength?: number
}) => (
  <label class="field field--wide">
    <span class="field__label">{props.label}</span>
    <textarea
      class={props.error ? 'input input--area input--error' : 'input input--area'}
      name={props.name}
      rows={props.rows ?? 4}
      maxlength={props.maxlength}
    >
      {props.value ?? ''}
    </textarea>
    {props.error ? <span class="field__error">{props.error}</span> : null}
    {props.hint ? <span class="field__hint">{props.hint}</span> : null}
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
    <span class="field__label">{props.label}</span>
    <select class={props.error ? 'input input--error' : 'input'} name={props.name}>
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
    {props.error ? <span class="field__error">{props.error}</span> : null}
    {props.hint ? <span class="field__hint">{props.hint}</span> : null}
  </label>
)

export const PublishToggle = ({ published }: { published: number }) => (
  <label class="toggle">
    <input type="checkbox" name="published" value="1" checked={published === 1} />
    <span class="toggle__track" aria-hidden="true">
      <span class="toggle__knob" />
    </span>
    <span class="toggle__text">
      公開する<span class="toggle__hint">外すと下書き。サイトには出ない</span>
    </span>
  </label>
)

export const FormActions = ({
  cancelHref,
  deleteHref,
  deleteLabel = 'この項目を削除…',
}: {
  cancelHref: string
  deleteHref?: string
  deleteLabel?: string
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
      <button class="btn btn--primary" type="submit">
        保存
      </button>
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
