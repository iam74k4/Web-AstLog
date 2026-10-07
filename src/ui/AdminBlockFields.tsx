import { BLOCK_COLUMNS } from '../block-editor'
import { Area } from './AdminForm'

export const BlockBodyFields = ({
  type,
  body,
  error,
  hint,
  rows: submitted,
}: {
  type: string
  body: string
  error?: string
  hint: string
  rows?: string[][]
}) => {
  const columns = BLOCK_COLUMNS[type]
  if (!columns)
    return (
      <Area
        label={type === 'statement' ? '添え書き' : '中身'}
        name="body"
        value={body}
        rows={6}
        hint={hint}
        error={error}
      />
    )
  // 登録済みの行は切らない。旧形式に想定外の列があれば本文欄へ戻し、保存時の欠落を防ぐ。
  const saved = body
    ? body.split('\n').map((line) => line.split('|').map((part) => part.trim()))
    : []
  if (!submitted && saved.some((row) => row.length > columns.length))
    return <Area label="中身" name="body" value={body} rows={6} hint={hint} error={error} />
  const rows = submitted ?? [...saved, ...Array.from({ length: 3 }, () => [])]
  return (
    <fieldset class="block-fields field--wide">
      <legend>内容を組み立てる</legend>
      <p class="field__hint">
        1行が1件です。空の行は表示されません。保存すると追加の入力欄ができます。
      </p>
      {error ? (
        <p class="field__error" id="field-body-error">
          {error}
        </p>
      ) : null}
      {rows.map((row, index) => (
        <div class="block-fields__row" key={index}>
          <span class="block-fields__number">{String(index + 1).padStart(2, '0')}</span>
          {columns.map((label, column) => (
            <label class="field" key={label}>
              <span class="field__label">{label}</span>
              <input
                class="input"
                type="text"
                inputmode={type === 'links' && column === 1 ? 'url' : undefined}
                name={`blockPart${column}`}
                value={row[column] ?? ''}
                aria-label={`${index + 1}件目の${label}`}
              />
            </label>
          ))}
        </div>
      ))}
    </fieldset>
  )
}
