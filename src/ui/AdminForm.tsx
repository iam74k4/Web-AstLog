import type { Child } from 'hono/jsx'
import { headlineText, type Pair, pairsText, str } from '../lib/format'
import {
  AVAILABILITY,
  MUSIC_MAX,
  MUSIC_NAME_WIDTH,
  MUSIC_URL_MAX,
  type MusicTrack,
  SITE_SETTING_LIMITS,
  type SiteSettings,
} from '../site'

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

/*
  preview は、その節の欄が出る公開ページの画面（サイト設定の「プレビューする画面」の値）。節に
  触れると、管理画面の補助が横の完成形をその画面へ替える（admin-behavior.ts）
*/
export const FormSection = (props: {
  title: string
  note?: string
  preview?: string
  children?: Child
}) => (
  <section class="form-section" data-preview-screen={props.preview}>
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
  // 保存は止めないが知らせたいこと（Field の warning と同じ）
  warning?: string
  /*
    上限がある欄には付ける。ブラウザ側で止まるので、長い文を打ったあとに
    保存で弾かれて直す、という往復が減る。数える単位はサーバー側（コード
    ポイント）と少し違い、絵文字は2字と数えられる——止めるのが少しだけ
    早くなるぶんには困らないので、そろえずにそのまま使う。
    保存してよいかを決めるのは、いつもサーバー側の検査のほう
  */
  required?: boolean
  maxlength?: number
  /*
    欄の格子の半分の幅に置く（既定は1行ぶん全部）。短い複数行の欄（大見出し）を、
    隣の1行の欄と並べるときだけ。広げると隣の欄の横が空く
  */
  half?: boolean
}) => (
  <label class={props.half ? 'field' : 'field field--wide'}>
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

/*
  画像の位置と大きさを合わせるダイアログ（Discord のアイコンの調整と同じ）。丸の中が表示される範囲。
  動かすのは src/ui/crop-behavior.ts で、ファイル欄の data-crop と組になる。**JavaScript が無ければ
  閉じたまま出ない**（画像は今までどおり選んで送れる）ので、中の文は JavaScript がある前提で書く。

  フォームの外に置く（ダイアログの中のボタンが、編集のフォームを送らないように）。ボタンは type=button。
  stage は指とマウスで動かす面（touch-action: none）。矢印と +/- のキーでも動かせるよう tabindex を
  持ち、独自のキー操作を持つ面なので role は application（group は fieldset に置き換えられる
  ——Biome の useSemanticElements——が、これは入力欄のまとまりではない）。使い方は aria-describedby で伝える。
*/
export const CropDialog = (props: { title: string }) => (
  <dialog class="crop" aria-labelledby="crop-title">
    <h2 class="crop__title" id="crop-title">
      {props.title}
    </h2>
    <p class="crop__help" id="crop-help">
      ドラッグで位置を、スライダーで大きさを合わせます。丸の中が表示される範囲です
    </p>
    <div
      class="crop__stage"
      tabindex={0}
      role="application"
      aria-label="画像の位置"
      aria-describedby="crop-help"
    >
      <img class="crop__image" alt="" draggable="false" />
      <span class="crop__mask" aria-hidden="true" />
    </div>
    <label class="crop__zoom">
      <span>大きさ</span>
      <input type="range" min={0} max={1000} step={1} value={0} />
    </label>
    <p class="crop__status" role="status" />
    <div class="crop__actions">
      <button type="button" class="btn btn--ghost" data-crop-cancel>
        キャンセル
      </button>
      <button type="button" class="btn btn--primary" data-crop-apply>
        適用
      </button>
    </div>
  </dialog>
)

/*
  前の URL（slug を変えたときに残る転送の行。src/db/schema.ts の item_slug_redirects /
  member_slug_redirects）。見えるようにして、転送をやめる手を持つ——転送に使っている slug は
  ほかの行が使えないので（貼られた URL が黙って別の行を指さないように）、打ち間違いで作った
  前の URL を空けるには D1 を直に消すしかなかった。フォームに出すのは、いまある転送だけ
*/
export const SlugRedirects = (props: {
  redirects: { slug: string; href: string }[]
  // 弾いたあとの描き直しで、付けた印を残す
  dropped?: readonly string[]
  // 「ほかの作品」「ほかのメンバー」
  others: string
}) =>
  props.redirects.length ? (
    <fieldset class="field field--wide fieldset">
      <legend class="field__label">前の URL（いまの URL へ転送中）</legend>
      {props.redirects.map((one) => (
        <label class="check" key={one.slug}>
          <input
            type="checkbox"
            name="dropRedirect"
            value={one.slug}
            checked={props.dropped?.includes(one.slug)}
          />
          {one.href} の転送をやめる
        </label>
      ))}
      <span class="field__hint">
        印を付けて保存すると、その URL は見つからなくなり（404）、{props.others}の URL
        に使えるようになります。貼ったリンクが残っているなら、そのままにします
      </span>
    </fieldset>
  ) : null

/*
  見出しと説明の組を1行ずつ受ける欄（メンバーの「大事にしていること」と、Contact の「相談の
  流れ」）。「見出し | 説明」の書き方を覚えなくても直せるように、組ごとに2つの欄を並べる
  （作品のリンクの欄と同じ形。行を足すのは AddRow）。保存する形は1行1件のテキスト
  （src/lib/format.ts の pairsText）で、読むのは readPairRows。

  持っている組を全部と、空いた行を足して出す（rows まで。持っている組が rows 以上なら空いた
  行を1つ）——持っている組を切って出すと、出なかった組が保存で黙って消える。name は保存する
  欄の名前（知らせの鍵）、field は送る欄の名前の頭（principle → principleTitle / principleText）
*/
export const PairRows = (props: {
  legend: string
  name: string
  field: string
  pairs: Pair[]
  rows: number
  titlePlaceholder?: string
  textPlaceholder?: string
  hint?: string
  error?: string
}) => {
  const blank = { title: '', text: '' }
  const rows = [
    ...props.pairs,
    ...Array.from({ length: Math.max(1, props.rows - props.pairs.length) }, () => blank),
  ]
  return (
    <fieldset class="field field--wide fieldset" aria-describedby={describedBy(props)}>
      <legend class="field__label">{props.legend}</legend>
      {rows.map((pair, index) => {
        // 弾いたあとの描き直しでだけ、通らなかった行に印を付ける（説明だけで見出しの無い行）
        const bad = Boolean(props.error) && (!pair.title || pair.title.includes('|')) && pair.text
        return (
          <div class="pair-row" key={index}>
            <input
              class={bad ? 'input input--error' : 'input'}
              type="text"
              name={`${props.field}Title`}
              value={pair.title}
              placeholder={props.titlePlaceholder}
              aria-label={`${props.legend} ${index + 1} の見出し`}
            />
            {/*
              説明は2行の欄（1行の欄では、長い説明が欄の幅で切れて全文が見えなかった）。保存の形は
              1組1行なので、打った改行は readPairRows が文の継ぎ目に畳む
            */}
            <textarea
              class="input input--area"
              name={`${props.field}Text`}
              rows={2}
              placeholder={props.textPlaceholder}
              aria-label={`${props.legend} ${index + 1} の説明`}
            >
              {pair.text}
            </textarea>
          </div>
        )
      })}
      <AddRow rows=".pair-row" />
      <Feedback name={props.name} error={props.error} hint={props.hint} />
    </fieldset>
  )
}

/*
  音楽の札の曲の行（サイト設定の「音楽」）。MUSIC_MAX 行をいつも並べ、上から順に札に出す
  （行を足す手を持たない——上限が小さいので、空いた行を見せておけば足りる）。1行は Apple Music の
  曲の URL・曲名・アーティスト名と、いまのジャケット。欄は同じ名前で並び、readSiteForm が行ごとに
  組む。知らせは行の並びの下に1つで、何曲目かを言う（src/site.ts の musicProblems）
*/
const MUSIC_HINT =
  'ミュージックで曲の「共有 → リンクをコピー」で取った URL を貼ります。保存のときに、曲名・アーティスト名・ジャケットを Apple Music から読み込みます。名前がカタカナで入ったとき（例: アヴィーチー）は、欄で直して保存します（例: Avicii）。名前を空にすると Apple Music の名前に戻します。URL を空にした行は外します。曲名は半角 40 字・アーティスト名は半角 24 字まで（全角は2字）'

export const MusicRows = (props: { tracks: readonly MusicTrack[]; error?: string }) => {
  const blank: MusicTrack = { url: '', title: '', artist: '', art: '' }
  const rows = Array.from({ length: MUSIC_MAX }, (_, index) => props.tracks[index] ?? blank)
  const feedback = { name: 'music', error: props.error, hint: MUSIC_HINT }
  return (
    <fieldset class="field field--wide fieldset" aria-describedby={describedBy(feedback)}>
      <legend class="field__label">曲（上から順に出します。{MUSIC_MAX} 曲まで）</legend>
      {rows.map((track, index) => {
        const at = `${index + 1} 曲目`
        return (
          <div class="music-row" key={index}>
            <input
              class="input"
              type="url"
              inputmode="url"
              name="musicUrl"
              value={track.url}
              maxlength={MUSIC_URL_MAX}
              placeholder="https://music.apple.com/jp/album/…?i=…"
              aria-label={`${at}の Apple Music の URL`}
            />
            <input
              class="input"
              type="text"
              name="musicTitle"
              value={track.title}
              maxlength={MUSIC_NAME_WIDTH.musicTitle}
              placeholder="曲名"
              aria-label={`${at}の曲名`}
            />
            <input
              class="input"
              type="text"
              name="musicArtist"
              value={track.artist}
              maxlength={MUSIC_NAME_WIDTH.musicArtist}
              placeholder="アーティスト名"
              aria-label={`${at}のアーティスト名`}
            />
            {track.art ? (
              <img
                class="music-row__art"
                src={track.art}
                alt={`${at}のいまのジャケット`}
                width="48"
                height="48"
              />
            ) : (
              <span class="music-row__art" aria-hidden="true" />
            )}
          </div>
        )
      })}
      <Feedback {...feedback} />
    </fieldset>
  )
}

/*
  PairRows の欄を読む。空いた行は畳み、見出しの無い行（説明だけ）と見出しに「|」のある行は
  何行目かを言って返す——「|」は保存の形の区切りなので、見出しに入ると説明が黙って割れる。
  返す text は弾いたときもそのまま描き直せる形（見出しの無い行も「| 説明」で残す）
*/
export function readPairRows(form: FormData, field: string): { text: string; error?: string } {
  const titles = form.getAll(`${field}Title`).map((value) => str(value))
  // 説明の欄は複数行。改行は継ぎ目に畳む（和文どうしは詰め、欧文が隣なら半角の空き。headlineText）
  const texts = form.getAll(`${field}Text`).map((value) => headlineText(str(value)))
  const pairs: Pair[] = []
  const problems: string[] = []
  for (let index = 0; index < Math.max(titles.length, texts.length); index += 1) {
    const title = titles[index] ?? ''
    const text = texts[index] ?? ''
    if (!title && !text) continue
    if (!title) problems.push(`${index + 1} 行目は見出しを入れてください`)
    else if (title.includes('|')) problems.push(`${index + 1} 行目の見出しに「|」は使えません`)
    pairs.push({ title, text })
  }
  const text = pairsText(pairs)
  return problems.length ? { text, error: `${problems.join('。')}。` } : { text }
}

/*
  受付状況の4つの欄（Contact の Availability）。置くのはサイト設定と、概要の「受付状況」の
  2か所——状態はよく変わるので、概要から1回の保存で変えられるようにした
  （src/routes/admin/dashboard.tsx・src/routes/admin/site-settings.tsx の /site/availability）。
  状態は選ぶだけで、公開ページの文は状態ごとに決まっている（src/site.ts の AVAILABILITY）。
  押して選べるよう、選択肢は並べて見せ（ラジオ）、それぞれに公開ページに出る文を添える
*/
export const AvailabilityFields = (props: {
  site: Pick<
    SiteSettings,
    'availability' | 'availabilityReply' | 'availabilityHours' | 'availabilityFormat'
  >
  errors?: Record<string, string> | null
}) => {
  const choices = [
    ...Object.entries(AVAILABILITY).map(([value, state]) => ({
      value,
      label: state.label,
      shown: state.text,
    })),
    { value: '', label: '出さない', shown: '状態の行を出しません' },
  ]
  return (
    <>
      <fieldset
        class="field field--wide fieldset"
        aria-describedby={describedBy({ name: 'availability', error: props.errors?.availability })}
      >
        <legend class="field__label">受付の状態</legend>
        <div class="choices">
          {choices.map((choice) => (
            <label class="choice" key={choice.value}>
              <input
                type="radio"
                name="availability"
                value={choice.value}
                checked={props.site.availability === choice.value}
              />
              <span class="choice__body">
                <span class="choice__label">{choice.label}</span>
                <span class="choice__note">{choice.shown}</span>
              </span>
            </label>
          ))}
        </div>
        <Feedback name="availability" error={props.errors?.availability} />
      </fieldset>
      <Field
        label="返信の目安"
        name="availabilityReply"
        value={props.site.availabilityReply}
        placeholder="2日以内"
        hint="「Response」の行。空なら出しません"
        maxlength={SITE_SETTING_LIMITS.availabilityReply}
        error={props.errors?.availabilityReply}
      />
      <Field
        label="連絡のつく時間"
        name="availabilityHours"
        value={props.site.availabilityHours}
        placeholder="平日 20–24時・土日（日本時間）"
        hint="「Hours」の行。空なら出しません"
        maxlength={SITE_SETTING_LIMITS.availabilityHours}
        error={props.errors?.availabilityHours}
      />
      <Field
        label="進め方"
        name="availabilityFormat"
        value={props.site.availabilityFormat}
        placeholder="オンライン"
        hint="「Format」の行。空なら出しません"
        maxlength={SITE_SETTING_LIMITS.availabilityFormat}
        error={props.errors?.availabilityFormat}
      />
    </>
  )
}

/*
  行を足す手（リンク・ブロックの行）。管理画面の補助（admin-behavior.ts）が、いちばん後ろの行を
  空にして写す。補助が動くまで押せないので、初めは隠しておく（hidden。補助が外す）——
  JavaScript が無ければ、今までどおり保存して開き直すと空いた行が出る（noscript の案内）。
  rows は、同じ親の中で行を選ぶセレクタ
*/
export const AddRow = ({ rows }: { rows: string }) => (
  <>
    <button type="button" class="btn btn--ghost add-row" data-add-row={rows} hidden>
      ＋ 行を足す
    </button>
    <noscript>
      <span class="field__hint">もっと足すときは、保存してから開き直すと空いた行が出る</span>
    </noscript>
  </>
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
  deleteLabel = 'この作品を削除…',
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
