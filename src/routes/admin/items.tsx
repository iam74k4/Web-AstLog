import { and, asc, eq, ne, type SQL, sql } from 'drizzle-orm'
import type { BatchItem } from 'drizzle-orm/batch'
import { type Context, Hono } from 'hono'
import { MAX_CHARS, publishErrors } from '../../blocks'
import { type Db, itemOrder } from '../../db/queries'
import * as schema from '../../db/schema'
import { ITEM_KINDS, type ItemKind, KIND_LABEL, readKind } from '../../domain'
import type { AppEnv } from '../../env'
import { newToken } from '../../lib/auth'
import {
  bool,
  chunk,
  halfWidthDigits,
  int,
  isSafeUrl,
  parseTags,
  str,
  yearFrom,
} from '../../lib/format'
import { IMAGE_ACCEPT, IMAGE_LABELS } from '../../lib/image'
import {
  Area,
  Confirm,
  Field,
  FormActions,
  FormKey,
  PublishToggle,
  Select,
} from '../../ui/AdminForm'
import { AdminLayout } from '../../ui/AdminLayout'
import { itemHref, Shot, StatusPill } from '../../ui/components'
import { PencilIcon, TrashIcon } from '../../ui/icons'
import {
  commitWithImage,
  imageNotKept,
  type PickedImage,
  pickImage,
  pickImages,
  putImage,
  removeImage,
} from './images'
import {
  cameFromEdit,
  db,
  flashFor,
  formKeyOf,
  mergeErrors,
  newFormKey,
  parseId,
  readSlug,
  readSortOrder,
  SLUG_MOVED,
  SLUG_TAKEN,
  savedParam,
  uniqueViolation,
} from './request'

export const itemRoutes = new Hono<AppEnv>()

/*
  管理画面の呼び名は公開ページにそろえる（src/domain.ts の ITEM_KINDS。
  「個人開発 / 業務」）。公開ページでは1つの一覧（Projects）だが、入力欄は区分
  ごとに違う（個人開発はプラットフォーム、業務は業界と実績値）ので、タブは区分ごと。
*/
itemRoutes.get('/items', async (c) => {
  const type = readKind(c.req.query('type'))
  /*
    並びは公開ページと同じ（年の新しい順 → 並び順 → 作った順。queries.ts の
    itemOrder）。並び順だけで並べていたころは、ここで先頭に見えている作品が
    公開ページでは年に負けて後ろにいて、公開の並びをどこでも確かめられなかった
  */
  const rows = await db(c).query.items.findMany({
    where: eq(schema.items.type, type),
    orderBy: itemOrder,
    with: { member: true, platform: true },
  })

  return c.html(
    <AdminLayout title="Projects" active="items" account={c.get('account')} flash={flashFor(c)}>
      <div class="admin-head">
        <div class="admin-head__title">
          <h1>Projects</h1>
          <div class="tabs">
            {ITEM_KINDS.map((kind) => (
              <a
                key={kind.key}
                href={`/admin/items?type=${kind.key}`}
                aria-current={type === kind.key ? 'page' : undefined}
              >
                {kind.label}
              </a>
            ))}
          </div>
        </div>
        <a class="btn btn--primary" href={`/admin/items/new?type=${type}`}>
          ＋ Add item
        </a>
      </div>

      {/*
        タブは入力欄の違い（プラットフォーム / 業界と実績値）で分けているだけで、
        公開ページでは1つの一覧。並びの規則を1文で言っておく
      */}
      <p class="form-note">
        公開ページでは{ITEM_KINDS.map((kind) => kind.label).join('と')}
        を1つの一覧に混ぜ、年の新しい順 → 並び順（区分をまたいで比べる）→
        作った順に並べます。ここもその順です。
      </p>

      {rows.length === 0 ? (
        <div class="empty-state">
          <p>{KIND_LABEL[type]} はまだありません</p>
          <a class="btn btn--primary" href={`/admin/items/new?type=${type}`}>
            ＋ 最初の項目を追加
          </a>
        </div>
      ) : (
        <ul class="rows">
          {rows.map((item) => (
            <li class="row" key={item.id}>
              <span class="row__main">
                <strong>{item.title}</strong>
                {/*
                  恒久リンクをここに出す。貼るための URL なので、探しに行かずに
                  読めるところに置く。slug の無い行（列より前からある作品）も、
                  黙っていると気づけないので名指しで出す
                */}
                <span class="row__sub">
                  {item.member?.name ?? '担当なし'} ·{' '}
                  {itemHref(item) ?? '恒久リンクなし（保存すると付く）'}
                </span>
              </span>
              <span class="row__col">{item.platform?.label ?? item.category}</span>
              <span class="row__col">{item.year}</span>
              <span class="row__col row__col--num">{item.sortOrder}</span>
              <StatusPill published={item.published} />
              <span class="row__actions">
                <a
                  class="icon-btn"
                  href={`/admin/items/${item.id}/edit`}
                  aria-label={`${item.title} を編集`}
                >
                  <PencilIcon />
                  <span class="icon-btn__text">編集</span>
                </a>
                <a
                  class="icon-btn icon-btn--danger"
                  href={`/admin/items/${item.id}/delete`}
                  aria-label={`${item.title} を削除`}
                >
                  <TrashIcon />
                  <span class="icon-btn__text">削除</span>
                </a>
              </span>
            </li>
          ))}
        </ul>
      )}
    </AdminLayout>,
  )
})

type ItemFormData = {
  account: string
  type: ItemKind
  members: schema.Member[]
  platforms: schema.Platform[]
  item?: schema.Item & {
    tags: { tag: string }[]
    links: { label: string; url: string }[]
    shots: schema.ItemShot[]
  }
  // 追加のフォームの一度きりの札（newFormKey）。編集では持たない
  formKey?: string | null
  // 入力エラーで描き直すとき、送られてきた内容をそのまま返すために使う
  submitted?: Record<string, string>
  errors?: Record<string, string>
}

/*
  フォームが描く値は、DB の行から来ることも、送信されて弾かれた内容から
  来ることもある。どちらも同じ形にしてから渡す。入力エラーのたびに
  打った内容が消えるのは、ここを分けていないと起きる。
*/
function itemDraft(item?: ItemFormData['item'], submitted?: Record<string, string>): ItemDraft {
  // いまあるほかの画像。弾いたあとの描き直しでは、送られてきた欄の値を採る
  const shots = (item?.shots ?? []).map((shot) => ({
    id: shot.id,
    url: shot.url,
    alt: submitted?.[`shotAlt-${shot.id}`] ?? shot.alt,
    order: submitted?.[`shotOrder-${shot.id}`] ?? String(shot.sortOrder),
    remove: submitted?.[`shotRemove-${shot.id}`] === '1',
  }))
  if (submitted) {
    return {
      title: submitted.title ?? '',
      slug: submitted.slug ?? '',
      memberId: submitted.memberId ?? '',
      platformKey: submitted.platformKey ?? '',
      category: submitted.category ?? '',
      year: submitted.year ?? '',
      summary: submitted.summary ?? '',
      body: submitted.body ?? '',
      imageAlt: submitted.imageAlt ?? '',
      removeImage: submitted.removeImage === '1',
      removeIcon: submitted.removeIcon === '1',
      shots,
      newShotAlts: submitted.newShotAlts ? JSON.parse(submitted.newShotAlts) : [],
      tags: submitted.tags ?? '',
      sortOrder: submitted.sortOrder ?? '10',
      published: submitted.published === '1' ? 1 : 0,
      metricValue: submitted.metricValue ?? '',
      metricUnit: submitted.metricUnit ?? '',
      metricNote: submitted.metricNote ?? '',
      links: submitted.links ? JSON.parse(submitted.links) : [],
    }
  }
  return {
    title: item?.title ?? '',
    slug: item?.slug ?? '',
    memberId: item?.memberId ? String(item.memberId) : '',
    platformKey: item?.platformKey ?? '',
    category: item?.category ?? '',
    year: item?.year ?? '',
    summary: item?.summary ?? '',
    body: item?.body ?? '',
    imageAlt: item?.imageAlt ?? '',
    removeImage: false,
    removeIcon: false,
    shots,
    newShotAlts: [],
    tags: (item?.tags ?? []).map((tag) => tag.tag).join(', '),
    sortOrder: String(item?.sortOrder ?? 10),
    published: item?.published ?? 0,
    metricValue: item?.metricValue ?? '',
    metricUnit: item?.metricUnit ?? '',
    metricNote: item?.metricNote ?? '',
    links: item?.links ?? [],
  }
}

type ItemDraft = {
  title: string
  slug: string
  memberId: string
  platformKey: string
  category: string
  year: string
  summary: string
  body: string
  imageAlt: string
  removeImage: boolean
  removeIcon: boolean
  // いまあるほかの画像（欄の値は字のまま。並び順は読めない字でも描き直す）
  shots: { id: number; url: string; alt: string; order: string; remove: boolean }[]
  // 足す欄の代替テキスト（弾いたあとの描き直しで残す。選んだファイルは残せない）
  newShotAlts: string[]
  tags: string
  sortOrder: string
  published: number
  metricValue: string
  metricUnit: string
  metricNote: string
  links: { label: string; url: string }[]
}

/*
  実績値の添えのヒント。添えは一覧の行でも作品のページでも説明文でも、値と単位の
  すぐあとに続けて出る（components.tsx の Metric、src/routes/public/meta.ts の metricDigest）。
  「見込み 40人日 → 実績」と書くと、→ が値より前を指して「20 人日 見込み
  40人日 → 実績」と逆に読める。続けて読んで意味が通る形を例で見せる。
*/
const METRIC_NOTE_HINT =
  '添えは値と単位のあとに続けて読まれる。「20 人日 見込み 40人日から半減」のように、続けて読んで意味が通る形で'

// リンクの欄を空けて出す行の数（ItemForm）。上限ではない
const LINK_ROWS = 3

/*
  ほかの画像（スクリーンショット）の上限と、1度の保存で足せる空いた欄の数。上限は
  作品のページの横の帯で送って見られる枚数として（1枚 1MB まで）。JavaScript が無いので
  欄を足す手が無く、もっと足すなら保存して開き直す（リンクの欄と同じ）
*/
const MAX_SHOTS = 8
const SHOT_SLOTS = 4

// 画像を受け取る欄（弾いたときに「まだ保存していません」と言う欄。imageNotKept）
const IMAGE_FIELDS = ['image', 'icon', 'newShot'] as const

/*
  ほかの画像（スクリーンショット）の欄。いまある画像は1枚ずつ見本・代替テキスト・
  並び順・外す、の1行で、その下に足す欄（ファイルと代替テキストの組）を空けて出す。
  欄の名前に画像の id を入れる（readShotEdits）——送った欄だけを読み、欄の無い画像は
  いまのまま残す。

  作品のページでは、メインの画像のあとに並び順で横に並べる（components.tsx の
  ItemShots）。代替テキストは公開するときに1枚ずつ要る（publishErrors）。
*/
const ShotFields = ({
  shots,
  alts,
  errors,
  slots,
}: {
  shots: ItemDraft['shots']
  alts: string[]
  errors?: Record<string, string>
  slots: number
}) => (
  <fieldset class="field field--wide fieldset">
    <legend class="field__label">ほかの画像（スクリーンショット）</legend>
    {shots.map((shot, index) => (
      <div class="shot-row" key={shot.id}>
        {/* 見本。何が写っているかは隣の欄が言うので、ここでは名前を持たせない */}
        <img class="shot-row__image" src={shot.url} alt="" loading="lazy" />
        <input
          class={errors?.shots && !shot.alt && !shot.remove ? 'input input--error' : 'input'}
          type="text"
          name={`shotAlt-${shot.id}`}
          value={shot.alt}
          placeholder="何が写っているかを1文で"
          aria-label={`${index + 1} 枚目の代替テキスト`}
        />
        <input
          class={errors?.shotOrder ? 'input input--error' : 'input'}
          type="text"
          inputmode="numeric"
          name={`shotOrder-${shot.id}`}
          value={shot.order}
          aria-label={`${index + 1} 枚目の並び順`}
        />
        <label class="check">
          <input type="checkbox" name={`shotRemove-${shot.id}`} value="1" checked={shot.remove} />
          外す
        </label>
      </div>
    ))}
    {Array.from({ length: slots }, (_, index) => (
      <div class="shot-row shot-row--new" key={`new-${index}`}>
        <input
          class={errors?.newShot ? 'input input--file input--error' : 'input input--file'}
          type="file"
          name="newShot"
          accept={IMAGE_ACCEPT}
          aria-label={`足す画像（${index + 1}）`}
        />
        <input
          class="input"
          type="text"
          name="newShotAlt"
          value={alts[index] ?? ''}
          placeholder="代替テキスト（何が写っているかを1文で）"
          aria-label={`足す画像（${index + 1}）の代替テキスト`}
        />
      </div>
    ))}
    {errors?.newShot ? <span class="field__error">{errors.newShot}</span> : null}
    {errors?.shotOrder ? <span class="field__error">{errors.shotOrder}</span> : null}
    {errors?.shots ? <span class="field__error">{errors.shots}</span> : null}
    <span class="field__hint">
      作品のページで、メインの画像のあとに横に並べる（横に送って見る）。並び順は小さいほど先 ·
      1枚ずつ {IMAGE_LABELS}（1MB まで） · 公開するときは1枚ずつ代替テキストが必須 ·{' '}
      {slots
        ? `${MAX_SHOTS} 枚まで。もっと足すときは、保存してから開き直すと空いた欄が出る`
        : `${MAX_SHOTS} 枚に達している。足すときは、外してから保存する`}
    </span>
  </fieldset>
)

const ItemForm = (props: ItemFormData) => {
  const item = props.item
  const d = itemDraft(item, props.submitted)
  /*
    リンクの欄は、持っている行を全部と、空いた行を足して出す（LINK_ROWS まで。
    持っている行が LINK_ROWS 以上なら空いた行を1つ）。JavaScript が無いので欄を
    足す手が無く、もう1本足したい人は保存して開き直せば次の空いた行が出る。
    持っている行を切って出すと、出なかった行が保存の総入れ替えで黙って消える
    （3行で切っていたころ、4本目から先がそうなった）
  */
  const blank = { label: '', url: '' }
  const links = [
    ...d.links,
    ...Array.from({ length: Math.max(1, LINK_ROWS - d.links.length) }, () => blank),
  ]
  // 年の欄の頭が数字4桁でなければ、並びに使われない（保存は止めない）
  const unordered = d.year !== '' && yearFrom(d.year) === null

  return (
    <AdminLayout title={item ? item.title : '新しい項目'} active="items" account={props.account}>
      <div class="admin-head">
        <div class="admin-head__title">
          <span class="crumbs">
            Projects / {KIND_LABEL[props.type]} / {item ? '編集' : '追加'}
          </span>
          <h1>{item ? item.title : '新しい項目'}</h1>
        </div>
      </div>

      {/* 画像を受け取るので multipart。アバターのフォーム（MemberForm）と同じ */}
      <form
        method="post"
        action={item ? `/admin/items/${item.id}` : '/admin/items'}
        enctype="multipart/form-data"
        class="form"
      >
        <input type="hidden" name="type" value={props.type} />
        <FormKey value={props.formKey} />
        <div class="form-grid">
          {/*
            作品名は一覧の行の題・入口の軌道図の札・作品のページの見出しに出る。長さは公開する
            ときにだけ見る（MAX_CHARS.itemTitle。理由は src/blocks.ts）
          */}
          <Field
            label="タイトル"
            name="title"
            value={d.title}
            required
            maxlength={MAX_CHARS.itemTitle}
            hint={`${MAX_CHARS.itemTitle} 字まで（一覧の行の題と作品のページの見出しに出る）`}
            error={props.errors?.title}
          />
          {/*
            この作品だけを指す URL。一覧の URL（/projects/3）は並べ替えるたびに
            別の作品を指すので、貼るならこちら。変えてよい——前の URL は新しい
            URL へ 301 で送る（item_slug_redirects）。それを書く前に言っておく
          */}
          <Field
            label="slug"
            name="slug"
            value={d.slug}
            error={props.errors?.slug}
            hint={
              item?.slug
                ? `${itemHref({ type: props.type, slug: '<slug>' })} になる。変えると、前の URL は新しい URL へ転送する。空にしたときはいまのまま`
                : `${itemHref({ type: props.type, slug: '<slug>' })} になる。空なら作品名から作る（日本語だけの題からは作れないので自動生成になる）`
            }
          />
          <Select
            label="担当メンバー"
            name="memberId"
            value={d.memberId}
            error={props.errors?.memberId}
            options={[
              { value: '', label: '（なし）' },
              ...props.members.map((member) => ({ value: String(member.id), label: member.name })),
            ]}
          />
          {props.type === 'app' ? (
            <Select
              label="プラットフォーム"
              name="platformKey"
              value={d.platformKey}
              error={props.errors?.platformKey}
              options={[
                { value: '', label: '（なし）' },
                ...props.platforms.map((platform) => ({
                  value: platform.key,
                  label: platform.label,
                })),
              ]}
              hint="絞り込みボタンと同じ値。自由入力にしないのは表記ゆれを防ぐため"
            />
          ) : (
            <Field
              label="区分"
              name="category"
              value={d.category}
              placeholder="金融系基幹システム"
            />
          )}
          {/*
            年の書き方は経歴（「2024.03 — 現在」）とそろえる。「2024 —」と書いて
            いたころは、ダッシュの先が空いたまま書きかけに見えた。一覧の並び
            （新しい順）は頭の数字4桁だけで決まる（items.year_from。DB が year から
            作る列で、知らせは同じ規則の src/lib/format.ts の yearFrom）ので、
            「2024 — 現在」でも 2024 として並ぶ。

            頭が数字4桁でない年（「令和6」「FY2024」）は保存を止めない（表示の
            書き方は自由）が、並びに使われないことをその場で言う——言わないと、
            一覧の最後に回った理由がどこにも見えない
          */}
          <Field
            label="年"
            name="year"
            value={d.year}
            placeholder="2026 / 2024 — 現在"
            warning={
              unordered
                ? '頭が数字4桁ではないので、並びに使われません（一覧では年の無い作品と一緒に最後に並びます）'
                : undefined
            }
            hint="終わったものは「2026」、続いているものは「2024 — 現在」。一覧は頭の数字4桁で新しい順に並ぶ"
          />
          <Area
            label="説明文"
            name="summary"
            value={d.summary}
            rows={3}
            /*
              一覧の行は説明を行数で切らずに全部出す。長いと一覧が縦に伸びるので、
              目録の2文ぶん（MAX_CHARS.itemSummary）で止める。

              説明は目録の文なので常体（〜する。〜した。）。本文（下の欄）は
              「です・ます」。作品のページでは説明のすぐ下に本文の小節（Story）が
              続けて読まれるので、文体で目録と本文を分ける（CLAUDE.md「文言」）
            */
            hint={`「何であるか。何をしたか。」の2文を常体で（〜する。〜した。）· ${MAX_CHARS.itemSummary} 字まで（公開するときは必須——一覧と作品のページの説明文になる）`}
            maxlength={MAX_CHARS.itemSummary}
            error={props.errors?.summary}
          />
          {/*
            本文は作品のページの説明の下に、小節「Story」として出る（一覧には
            出ない）。空なら小節は作らない。長さに上限は無い（ページは縦に読む）
          */}
          <Area
            label="本文"
            name="body"
            value={d.body}
            rows={6}
            hint="背景・やったこと・結果を「です・ます」で。空行で段落を分ける（作品のページの「Story」に出る。空なら出ない。一覧には出ない）"
            error={props.errors?.body}
          />
          <label class="field">
            <span class="field__label">画像</span>
            <input
              class={props.errors?.image ? 'input input--file input--error' : 'input input--file'}
              type="file"
              name="image"
              accept={IMAGE_ACCEPT}
            />
            {props.errors?.image ? <span class="field__error">{props.errors.image}</span> : null}
            <span class="field__hint">
              {item?.imageUrl
                ? `選ぶと差し替わる。空なら今のまま · ${IMAGE_LABELS}（1MB まで）`
                : `スクリーンショット。${IMAGE_LABELS}（1MB まで） · 作品のページと、一覧の行のサムネイルに出る。横長なら共有カードも大きく出る`}
            </span>
          </label>
          {/*
            代替テキストは画像そのものと別の欄。作品のページではこの画像が作品の
            見た目を伝える唯一の手段なので、画像を公開するなら空にできない
            （公開の関門 publishErrors）。下書きでは空のまま保存できる
          */}
          <Field
            label="画像の代替テキスト"
            name="imageAlt"
            value={d.imageAlt}
            error={props.errors?.imageAlt}
            hint="画像に何が写っているかを1文で。画像を公開するときは必須"
          />
          {item?.imageUrl ? (
            <div class="field field--wide">
              <span class="field__label">いまの画像（作品のページと同じ枠）</span>
              {/* 見本。何が写っているかは上の欄が言うので、ここでは名前を持たせない */}
              <Shot src={item.imageUrl} alt="" />
              <label class="check">
                <input type="checkbox" name="removeImage" value="1" checked={d.removeImage} />
                画像を外す
              </label>
            </div>
          ) : null}
          {/*
            アイコンは題の左に小さく出る飾り（代替テキストは持たない。名前は隣の題が言う）。
            正方形で描くので、正方形の画像を勧める
          */}
          <label class="field">
            <span class="field__label">アイコン</span>
            <input
              class={props.errors?.icon ? 'input input--file input--error' : 'input input--file'}
              type="file"
              name="icon"
              accept={IMAGE_ACCEPT}
            />
            {props.errors?.icon ? <span class="field__error">{props.errors.icon}</span> : null}
            <span class="field__hint">
              {item?.iconUrl
                ? `選ぶと差し替わる。空なら今のまま · ${IMAGE_LABELS}（1MB まで）`
                : `正方形の画像（アプリのアイコンなど）。${IMAGE_LABELS}（1MB まで） · 一覧の行と作品のページで、題の左に小さく出る`}
            </span>
          </label>
          {item?.iconUrl ? (
            <div class="field">
              <span class="field__label">いまのアイコン</span>
              <img class="icon-preview" src={item.iconUrl} alt="" width="64" height="64" />
              <label class="check">
                <input type="checkbox" name="removeIcon" value="1" checked={d.removeIcon} />
                アイコンを外す
              </label>
            </div>
          ) : null}
          <ShotFields
            shots={d.shots}
            alts={d.newShotAlts}
            errors={props.errors}
            slots={Math.max(0, Math.min(SHOT_SLOTS, MAX_SHOTS - d.shots.length))}
          />
          <Field
            label="タグ"
            name="tags"
            value={d.tags}
            error={props.errors?.tags}
            hint="カンマ区切り"
          />
          {/*
            並びは年が先に効き、同じ年の中でこの数。個人開発と業務は公開ページで
            1つの一覧に混ざるので、この数も区分をまたいで比べる（queries.ts の
            itemOrder）。「小さいほど先」とだけ書いていたころは、1 を付けても年が
            古い作品は後ろのままで、理由が分からなかった
          */}
          <Field
            label="並び順"
            name="sortOrder"
            value={d.sortOrder}
            error={props.errors?.sortOrder}
            hint="同じ年の中で、小さいほど先。個人開発と業務をまたいで比べる（同じ数なら先に作ったほう）。10刻み"
          />

          {/*
            行ごとの検査は readLinks。知らせは何行目かで言うので、行の順は
            送った順のまま描き直す（submittedItem）
          */}
          <fieldset class="field field--wide fieldset">
            <legend class="field__label">リンク</legend>
            {links.map((link, index) => {
              // 弾いたあとの描き直しでだけ、通らなかった行に印を付ける
              const bad = props.errors?.links ? linkProblem(link.label, link.url) : null
              return (
                <div class="link-row" key={index}>
                  <input
                    class={bad ? 'input input--error' : 'input'}
                    type="text"
                    name="linkLabel"
                    value={link.label}
                    placeholder="Repository"
                  />
                  <input
                    class={bad ? 'input input--error' : 'input'}
                    type="url"
                    name="linkUrl"
                    value={link.url}
                    placeholder="https://"
                  />
                </div>
              )
            })}
            {props.errors?.links ? <span class="field__error">{props.errors.links}</span> : null}
            <span class="field__hint">
              ラベルと URL は両方入れる。URL は https:// か mailto: か / から ·
              もっと足すときは、保存してから開き直すと空いた行が出る
            </span>
          </fieldset>

          {props.type === 'work' ? (
            <fieldset class="field field--wide fieldset">
              <legend class="field__label">実績値 — 1項目に1つだけ</legend>
              <div class="metric-row">
                <input
                  class="input"
                  type="text"
                  name="metricValue"
                  value={d.metricValue}
                  placeholder="20"
                />
                <input
                  class="input"
                  type="text"
                  name="metricUnit"
                  value={d.metricUnit}
                  placeholder="人日"
                />
                <input
                  class="input"
                  type="text"
                  name="metricNote"
                  value={d.metricNote}
                  placeholder="見込み 40人日から半減"
                />
              </div>
              {/* 添えは値のあとに続けて読まれる（METRIC_NOTE_HINT を見ること） */}
              <span class="field__hint">{METRIC_NOTE_HINT}</span>
            </fieldset>
          ) : null}
        </div>

        <div class="form-foot">
          <PublishToggle published={d.published} />
          <FormActions
            cancelHref={`/admin/items?type=${props.type}`}
            deleteHref={item ? `/admin/items/${item.id}/delete?from=edit` : undefined}
          />
        </div>
      </form>
    </AdminLayout>
  )
}

async function formContext(c: { env: { DB: D1Database } }) {
  const database = db(c)
  const [members, platforms] = await Promise.all([
    database.query.members.findMany({ orderBy: [asc(schema.members.sortOrder)] }),
    database.query.platforms.findMany({ orderBy: [asc(schema.platforms.sortOrder)] }),
  ])
  return { members, platforms }
}

itemRoutes.get('/items/new', async (c) => {
  const type = readKind(c.req.query('type'))
  const { members, platforms } = await formContext(c)
  return c.html(
    <ItemForm
      account={c.get('account')}
      type={type}
      members={members}
      platforms={platforms}
      formKey={newFormKey()}
    />,
  )
})

itemRoutes.get('/items/:id/edit', async (c) => {
  const editId = parseId(c.req.param('id'))
  if (!editId) return c.notFound()
  const item = await db(c).query.items.findFirst({
    where: eq(schema.items.id, editId),
    with: {
      tags: { orderBy: [asc(schema.itemTags.sortOrder)] },
      links: { orderBy: [asc(schema.itemLinks.sortOrder)] },
      shots: { orderBy: shotOrder },
    },
  })
  if (!item) return c.notFound()
  const { members, platforms } = await formContext(c)
  return c.html(
    <ItemForm
      account={c.get('account')}
      type={item.type}
      members={members}
      platforms={platforms}
      item={item}
    />,
  )
})

/*
  フォームの値を行の形にする。読めなかった値は errors に入れて返す
  （下書きでも止める、受け取れない値）。

  担当メンバーとプラットフォームは、フォームを描いたときの選択肢（formContext）に
  在るものだけを受ける。別のタブでメンバーを消したあとで、古いフォームのまま
  保存すると、以前は外部キーで 500 になり、打った内容も消えていた。いまは
  選び直してもらう（400。打った内容は残す）。
*/
function readItemForm(
  form: FormData,
  context: { members: schema.Member[]; platforms: schema.Platform[] },
  existing?: schema.Item,
) {
  const type = readKind(str(form.get('type')))
  const title = str(form.get('title'))
  // 全角の数字は半角に直す。並べるための年（year_from）は DB がこの字から作る
  const year = halfWidthDigits(str(form.get('year')))
  const sortOrder = readSortOrder(form, existing?.sortOrder)
  const errors: Record<string, string> = { ...sortOrder.error }

  const memberText = str(form.get('memberId'))
  const memberId = memberText ? int(memberText) : null
  if (memberText && !context.members.some((member) => member.id === memberId)) {
    errors.memberId =
      '担当メンバーが見つかりません（削除された可能性があります）。選び直してください'
  }
  const platformKey = type === 'app' ? str(form.get('platformKey')) : ''
  if (platformKey && !context.platforms.some((platform) => platform.key === platformKey)) {
    errors.platformKey = 'プラットフォームが見つかりません。選び直してください'
  }

  return {
    errors: Object.keys(errors).length ? errors : null,
    tags: parseTags(str(form.get('tags'))),
    values: {
      type,
      memberId,
      platformKey: platformKey || null,
      category: type === 'work' ? str(form.get('category')) : '',
      title,
      /*
        恒久リンクの3語目（readSlug）。空なら、編集ではいまの slug のまま、まだ
        持たない行では作品名から作る。

        題が日本語だけだと toSlug は空を返すので、そのときは読めない代わりに
        重ならない名前にする。空のまま保存させないのは、恒久リンクの無い作品を
        作らないため——この列より前からある行だけが「まだ無い」側で、
        ここを通った行は必ず名指しできる。
      */
      slug: readSlug(str(form.get('slug')), existing?.slug, title) ?? `item-${newToken(3)}`,
      year,
      summary: str(form.get('summary')),
      body: str(form.get('body')),
      imageAlt: str(form.get('imageAlt')),
      metricValue: str(form.get('metricValue')) || null,
      metricUnit: str(form.get('metricUnit')) || null,
      metricNote: str(form.get('metricNote')) || null,
      sortOrder: sortOrder.value,
      published: bool(form.get('published')),
      updatedAt: new Date().toISOString(),
    },
  }
}

/*
  作品の、下書きでも止める値。いまは題だけ（空の題の作品は一覧でも名指しできない）。

  説明文・本文の長さ、タグの数・リンクの本数、画像の代替テキストは、公開する
  ときにだけ見る（src/blocks.ts の publishErrors）。見ると、上限より前に保存された
  長い中身を持つ作品が「公開を外すことすらできない」行き止まりになる
  （CLAUDE.md「下書きに戻す保存では長さを見ない」）。
*/
function itemValueErrors(values: { title: string }): Record<string, string> | null {
  return values.title ? null : { title: 'タイトルは必須です' }
}

// slug の重なり。いまの slug と、ほかの作品の前の slug（memberSlugTaken と同じ規則）
async function itemSlugTaken(
  database: Db,
  slug: string,
  exceptId: number | null,
): Promise<Record<string, string> | null> {
  const [live, moved] = await Promise.all([
    database.query.items.findFirst({
      where: exceptId
        ? and(eq(schema.items.slug, slug), ne(schema.items.id, exceptId))
        : eq(schema.items.slug, slug),
    }),
    database.query.itemSlugRedirects.findFirst({
      where: exceptId
        ? and(
            eq(schema.itemSlugRedirects.oldSlug, slug),
            ne(schema.itemSlugRedirects.itemId, exceptId),
          )
        : eq(schema.itemSlugRedirects.oldSlug, slug),
    }),
  ])
  if (live) return { slug: SLUG_TAKEN }
  if (moved) return { slug: SLUG_MOVED('別の作品') }
  return null
}

// 弾いたときに、打った内容をそのままフォームへ返すための形
function submittedItem(form: FormData): Record<string, string> {
  const labels = form.getAll('linkLabel').map((value) => str(value))
  const urls = form.getAll('linkUrl').map((value) => str(value))
  return {
    title: str(form.get('title')),
    slug: str(form.get('slug')),
    memberId: str(form.get('memberId')),
    platformKey: str(form.get('platformKey')),
    category: str(form.get('category')),
    // 保存と同じく半角に直して返す（年の欄の知らせが、保存したときと同じ答えを出す）
    year: halfWidthDigits(str(form.get('year'))),
    summary: str(form.get('summary')),
    body: str(form.get('body')),
    imageAlt: str(form.get('imageAlt')),
    removeImage: bool(form.get('removeImage')) ? '1' : '',
    removeIcon: bool(form.get('removeIcon')) ? '1' : '',
    // いまあるほかの画像の欄（shotAlt-<id> など）はそのままの名前で返す（itemDraft が id で引く）
    ...Object.fromEntries(
      [...form.keys()]
        .filter((key) => /^shot(Alt|Order|Remove)-\d+$/.test(key))
        .map((key) => [key, str(form.get(key))]),
    ),
    newShotAlts: JSON.stringify(form.getAll('newShotAlt').map((value) => str(value))),
    tags: str(form.get('tags')),
    sortOrder: str(form.get('sortOrder')),
    published: bool(form.get('published')) ? '1' : '',
    metricValue: str(form.get('metricValue')),
    metricUnit: str(form.get('metricUnit')),
    metricNote: str(form.get('metricNote')),
    links: JSON.stringify(labels.map((label, index) => ({ label, url: urls[index] ?? '' }))),
  }
}

/*
  作品のリンク（行き先）。フォームはラベルと URL の欄を行ごとに並べて送る。

  1行ずつ見て、通らない行は保存させない（400 で何行目かを示す）。黙って落とすと、
  「保存しました」と出たのにサイトにリンクが無い、になる（CLAUDE.md「公開ページで
  落とす中身は、管理画面でも保存させない」）。

  - URL は isSafeUrl（https:// か http:// か mailto: か / で始まる）。公開ページの
    LinkRow も同じ検査で落とす。javascript: は同じオリジンの href に載り、
    頭を省いた「github.com/…」は相対 URL になって 404 になる
  - ラベルと URL は両方要る。片方だけの行は、以前は知らせなしに捨てていた
  - 両方空の行（フォームが用意した空き）は数えない

  下書きでも見る。長さではなく、受け取れない値なので（画像の種類と同じ）。
*/
type ItemLink = { label: string; url: string }

// 1行の検査。通らなければ「N 行目」に続ける言葉を返す（フォームも行の印に同じものを使う）
function linkProblem(label: string, url: string): string | null {
  if (!label && !url) return null
  if (!label || !url) return 'はラベルと URL の両方を入れてください'
  if (!isSafeUrl(url)) return 'の URL は https:// か mailto: か / で始めてください'
  return null
}

function readLinks(form: FormData): { links: ItemLink[]; error?: string } {
  const labels = form.getAll('linkLabel').map((value) => str(value))
  const urls = form.getAll('linkUrl').map((value) => str(value))
  const links: ItemLink[] = []
  const problems: string[] = []
  for (let index = 0; index < Math.max(labels.length, urls.length); index += 1) {
    const label = labels[index] ?? ''
    const url = urls[index] ?? ''
    const problem = linkProblem(label, url)
    if (problem) problems.push(`${index + 1} 行目${problem}`)
    else if (label && url) links.push({ label, url })
  }
  return problems.length ? { links, error: `${problems.join('。')}。` } : { links }
}

// ほかの画像の並び（公開ページと同じ。src/db/queries.ts の itemWith）
const shotOrder = [asc(schema.itemShots.sortOrder), asc(schema.itemShots.id)]

/*
  いまあるほかの画像の欄（ShotFields）を読む。欄の無い画像（追加のフォームの2度目の
  送信。1度目が作った画像はそのフォームに無い）はいまのまま残す。並び順は全角の数字も
  読み、読めなければ何枚目かを言って止める（黙って別の数に倒さない。作品の並び順と同じ）
*/
type ShotEdit = { shot: schema.ItemShot; alt: string; sortOrder: number; remove: boolean }

function readShotEdits(form: FormData, shots: schema.ItemShot[]) {
  const unreadable: number[] = []
  const edits: ShotEdit[] = shots.map((shot, index) => {
    const alt = form.get(`shotAlt-${shot.id}`)
    const order = str(form.get(`shotOrder-${shot.id}`))
    const sortOrder = order ? int(order) : shot.sortOrder
    if (sortOrder === null) unreadable.push(index + 1)
    return {
      shot,
      alt: alt === null ? shot.alt : str(alt),
      sortOrder: sortOrder ?? shot.sortOrder,
      remove: bool(form.get(`shotRemove-${shot.id}`)) === 1,
    }
  })
  return {
    edits,
    error: unreadable.length
      ? { shotOrder: `並び順は数字で書いてください（${unreadable.join('・')} 枚目）` }
      : null,
  }
}

/*
  足す欄（ファイルと代替テキストの組）を読む。どの欄も pickImage と同じ検査で、
  通らない欄は何番目の欄かを言って止める。代替テキストだけを書いた欄は数えない
*/
async function readNewShots(form: FormData) {
  const picks = await pickImages(form, 'newShot')
  const alts = form.getAll('newShotAlt').map((value) => str(value))
  const problems = picks.flatMap((pick, index) =>
    pick.error ? [`${index + 1} 番目の欄: ${pick.error}`] : [],
  )
  const added = picks.flatMap((pick, index) =>
    pick.image ? [{ image: pick.image, alt: alts[index] ?? '' }] : [],
  )
  return { added, error: problems.length ? { newShot: problems.join('。') } : null }
}

/*
  保存したあとのほかの画像（残す分を並び順に、足す分をその後ろへ）。足す画像の並び順は
  残す分のいちばん大きい数から 10 刻み。上限（MAX_SHOTS）を超えるなら止める
*/
function shotPlan(edits: ShotEdit[], added: { image: PickedImage; alt: string }[]) {
  const kept = edits
    .filter((edit) => !edit.remove)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.shot.id - b.shot.id)
  const base = kept.reduce((max, edit) => Math.max(max, edit.sortOrder), 0)
  return {
    kept,
    orders: added.map((_, index) => base + 10 * (index + 1)),
    alts: [...kept.map((edit) => edit.alt), ...added.map((shot) => shot.alt)],
    error:
      kept.length + added.length > MAX_SHOTS
        ? {
            newShot: `ほかの画像は ${MAX_SHOTS} 枚までです（残すのが ${kept.length} 枚、足すのが ${added.length} 枚）。外してから足してください`,
          }
        : null,
  }
}

/*
  画像を KV に置く（putImage）。何枚か置いたあとで落ちたら、置いた分を消してから
  投げ直す——どの行からも指されない画像を KV に残さない（commitWithImage と同じ約束）
*/
async function placeImages(
  kv: KVNamespace,
  images: { image: PickedImage; name: string }[],
): Promise<string[]> {
  const placed: string[] = []
  try {
    for (const { image, name } of images) placed.push(await putImage(kv, image, 'items', name))
  } catch (error) {
    for (const url of placed) await removeImage(kv, url).catch((cleanup) => console.error(cleanup))
    throw error
  }
  return placed
}

/*
  作品の保存は、行・タグ・リンク・転送表の書き込みを全部1つの batch に入れる
  （D1 の batch は1つのトランザクション。途中で落ちれば何も書かれない）。

  1本ずつ await すると、途中で落ちたときに半分だけ書かれる——子の総入れ替えは
  DELETE が先なので、INSERT が落ちると前のタグとリンクだけが消える（束縛変数の
  上限でタグの INSERT が落ちて、実際にそうなった）。構成の並べ替え（queries.ts の
  reorderBlocks）が batch なのと同じ理由。

  新しく作るときは親の id がまだ無い。そこで子の行は親を slug で引く
  （INSERT … VALUES ((SELECT id FROM items WHERE slug = ?), …)）。slug は保存の前に
  決まっていて unique なので、同じ batch の中の先の INSERT が作った行を指せる。

  タグとリンクの総入れ替えはそのまま（差分を取るより、消して入れ直すほうが読める）。
  複数行の INSERT は、1文の束縛変数が D1 の上限（100）を超えないように分ける。
*/
const D1_MAX_VARIABLES = 100
// 1行ぶんの束縛変数の数（item_id か親を引く slug・残りの列）から、1文に入る行数
const rowsPerInsert = (variablesPerRow: number) => Math.floor(D1_MAX_VARIABLES / variablesPerRow)

function childWrites(
  database: Db,
  // 既にある作品なら id、同じ batch で作る作品なら slug
  owner: number | string,
  tags: string[],
  links: ItemLink[],
): BatchItem<'sqlite'>[] {
  const itemId: number | SQL =
    typeof owner === 'number'
      ? owner
      : sql`(select ${schema.items.id} from ${schema.items} where ${schema.items.slug} = ${owner})`
  return [
    // 新しく作る作品には、消す子がまだ無い
    ...(typeof owner === 'number'
      ? [
          database.delete(schema.itemTags).where(eq(schema.itemTags.itemId, owner)),
          database.delete(schema.itemLinks).where(eq(schema.itemLinks.itemId, owner)),
        ]
      : []),
    // item_id・tag・sort_order
    ...chunk(
      tags.map((tag, index) => ({ itemId, tag, sortOrder: index })),
      rowsPerInsert(3),
    ).map((rows) => database.insert(schema.itemTags).values(rows)),
    // item_id・label・url・sort_order（id は自動なので変数を使わない）
    ...chunk(
      links.map((link, index) => ({ itemId, ...link, sortOrder: index })),
      rowsPerInsert(4),
    ).map((rows) => database.insert(schema.itemLinks).values(rows)),
  ]
}

/*
  ほかの画像の書き込み（作品の保存と同じ batch に入れる）。外す画像を消し、残す画像の
  代替テキストと並び順を書き、足す画像を入れる。新しく作る作品では、親を slug で引く
  （childWrites と同じ）。1行の束縛変数は item_id か親を引く slug・url・alt・寸法2つ・
  sort_order の6つ
*/
type AddedShot = {
  url: string
  alt: string
  width: number | null
  height: number | null
  sortOrder: number
}

function shotWrites(
  database: Db,
  owner: number | string,
  edits: ShotEdit[],
  added: AddedShot[],
): BatchItem<'sqlite'>[] {
  const itemId: number | SQL =
    typeof owner === 'number'
      ? owner
      : sql`(select ${schema.items.id} from ${schema.items} where ${schema.items.slug} = ${owner})`
  return [
    ...edits
      .filter((edit) => edit.remove)
      .map((edit) =>
        database.delete(schema.itemShots).where(eq(schema.itemShots.id, edit.shot.id)),
      ),
    ...edits
      .filter(
        (edit) =>
          !edit.remove && (edit.alt !== edit.shot.alt || edit.sortOrder !== edit.shot.sortOrder),
      )
      .map((edit) =>
        database
          .update(schema.itemShots)
          .set({ alt: edit.alt, sortOrder: edit.sortOrder })
          .where(eq(schema.itemShots.id, edit.shot.id)),
      ),
    ...chunk(
      added.map((shot) => ({ itemId, ...shot })),
      rowsPerInsert(6),
    ).map((rows) => database.insert(schema.itemShots).values(rows)),
  ]
}

// slug を変えた保存に足す2文。メンバーの memberSlugMoves と同じ（前の slug が無い行は何も残さない）
function itemSlugMoves(
  database: Db,
  id: number,
  before: string | null,
  after: string,
): BatchItem<'sqlite'>[] {
  if (!before || before === after) return []
  return [
    database.delete(schema.itemSlugRedirects).where(eq(schema.itemSlugRedirects.oldSlug, after)),
    database
      .insert(schema.itemSlugRedirects)
      .values({ oldSlug: before, itemId: id })
      .onConflictDoUpdate({ target: schema.itemSlugRedirects.oldSlug, set: { itemId: id } }),
  ]
}

// 画像の列（URL と寸法）。寸法は読めたときだけ（src/db/schema.ts の imageWidth）
const imageColumns = (url: string | null, image: PickedImage | null) => ({
  imageUrl: url,
  imageWidth: image?.width ?? null,
  imageHeight: image?.height ?? null,
})

itemRoutes.post('/items', async (c) => {
  const database = db(c)
  const form = await c.req.formData()
  const context = await formContext(c)
  // 同じ札で書いた行（newFormKey の注記）
  const twinOf = (key: string | null) =>
    key ? database.query.items.findFirst({ where: eq(schema.items.formKey, key) }) : undefined
  /*
    同じフォームの2度目の送信。1度目が作った行への保存として扱う——中身が同じなら
    同じ値を書き直すだけ、違えば（「戻る」で開き直して直した・公開に印を付けた）
    その行の編集として反映し、公開の関門も通す。黙って捨てて「保存しました」と言わない
  */
  const sent = formKeyOf(form)
  const twin = await twinOf(sent)
  if (twin) return saveItem(c, twin, form, context, true)

  const { values, tags, errors: unreadable } = readItemForm(form, context)
  const saved = () =>
    c.redirect(`/admin/items?type=${values.type}&saved=${savedParam(values.published)}`, 303)
  const back = (errors: Record<string, string>) =>
    c.html(
      <ItemForm
        account={c.get('account')}
        type={values.type}
        members={context.members}
        platforms={context.platforms}
        formKey={sent}
        submitted={submittedItem(form)}
        errors={imageNotKept(form, IMAGE_FIELDS, errors)}
      />,
      400,
    )

  // 画像の種類と大きさ、リンクの形は下書きでも見る。長さの話ではなく、受け取れない値
  const picked = await pickImage(form, 'image')
  const icon = await pickImage(form, 'icon')
  const shots = await readNewShots(form)
  const plan = shotPlan([], shots.added)
  const links = readLinks(form)
  const errors = mergeErrors(
    picked.error ? { image: picked.error } : null,
    icon.error ? { icon: icon.error } : null,
    shots.error,
    plan.error,
    links.error ? { links: links.error } : null,
    unreadable,
    itemValueErrors(values),
    values.published
      ? publishErrors({
          kind: 'item',
          title: values.title,
          summary: values.summary,
          imageAlt: values.imageAlt,
          hasImage: picked.image !== null,
          shotAlts: plan.alts,
        })
      : null,
    await itemSlugTaken(database, values.slug, null),
  )
  if (errors) return back(errors)

  // 検査が全部通ってから KV に置き、D1 が落ちたら置いた画像を消す（commitWithImage）
  const placed = await placeImages(c.env.MEDIA, [
    ...(picked.image ? [{ image: picked.image, name: values.slug }] : []),
    ...(icon.image ? [{ image: icon.image, name: `${values.slug}-icon` }] : []),
    ...shots.added.map((shot) => ({ image: shot.image, name: values.slug })),
  ])
  // 置いた順（メインの画像 → アイコン → ほかの画像）に取り出す
  const imageUrl = picked.image ? (placed.shift() ?? null) : null
  const iconUrl = icon.image ? (placed.shift() ?? null) : null
  const shotUrls = placed
  const added = shots.added.map((shot, index) => ({
    url: shotUrls[index] ?? '',
    alt: shot.alt,
    width: shot.image.width ?? null,
    height: shot.image.height ?? null,
    sortOrder: plan.orders[index] ?? 0,
  }))
  try {
    await commitWithImage(c.env.MEDIA, [imageUrl, iconUrl, ...shotUrls], () =>
      database.batch([
        database.insert(schema.items).values({
          ...values,
          ...imageColumns(imageUrl, picked.image),
          iconUrl,
          formKey: sent,
        }),
        ...childWrites(database, values.slug, tags, links.links),
        ...shotWrites(database, values.slug, [], added),
      ]),
    )
  } catch (error) {
    /*
      検査のあとに同じ札か同じ slug が先に書かれた（同時に来た2本の送信）。
      同じ札の行があれば、それは1度目の送信——英字の題なら slug も同じなので、
      どちらの制約が先に当たっても、その行への保存に寄せる
    */
    if (uniqueViolation(error, 'items.')) {
      const first = await twinOf(sent)
      if (first) return saveItem(c, first, form, context, true)
      if (uniqueViolation(error, 'items.slug')) return back({ slug: SLUG_TAKEN })
    }
    throw error
  }
  return saved()
})

itemRoutes.post('/items/:id', async (c) => {
  const id = parseId(c.req.param('id'))
  if (!id) return c.notFound()
  // 先に存在を確かめる。無い id のまま進むと、タグの差し替えが外部キーで
  // 落ちて 500 になるか、何も変わっていないのに「保存しました」と出る
  const existing = await db(c).query.items.findFirst({ where: eq(schema.items.id, id) })
  if (!existing) return c.notFound()
  return saveItem(c, existing, await c.req.formData(), await formContext(c), false)
})

/*
  既にある作品への保存。編集フォームの送信と、追加のフォームの2度目の送信
  （again。同じ札で1度目が作った行）の両方がここを通る。again のときは、知らせで
  「1度目に作った行に書いた」ことまで言う（request.ts の flashFor）。
*/
async function saveItem(
  c: Context<AppEnv>,
  existing: schema.Item,
  form: FormData,
  context: { members: schema.Member[]; platforms: schema.Platform[] },
  again: boolean,
) {
  const id = existing.id
  const database = db(c)
  const { values, tags, errors: unreadable } = readItemForm(form, context, existing)
  const existingShots = await database.query.itemShots.findMany({
    where: eq(schema.itemShots.itemId, id),
    orderBy: shotOrder,
  })
  const back = (errors: Record<string, string>) =>
    c.html(
      <ItemForm
        account={c.get('account')}
        type={values.type}
        members={context.members}
        platforms={context.platforms}
        item={{ ...existing, tags: [], links: [], shots: existingShots }}
        submitted={submittedItem(form)}
        errors={imageNotKept(form, IMAGE_FIELDS, errors)}
      />,
      400,
    )

  const picked = await pickImage(form, 'image')
  const icon = await pickImage(form, 'icon')
  // アイコンも画像と同じ: 選べば差し替え、「外す」なら無し、どちらでもなければいまのまま
  const keepsIcon = bool(form.get('removeIcon')) !== 1 && existing.iconUrl !== null
  const read = readShotEdits(form, existingShots)
  const shots = await readNewShots(form)
  /*
    追加のフォームの2度目の送信で画像を選んであれば、1度目が作ったほかの画像と入れ替える
    （同じ画像を2度重ねない）。選んでいなければ1度目の画像をそのまま残す
  */
  const edits =
    again && shots.added.length ? read.edits.map((edit) => ({ ...edit, remove: true })) : read.edits
  const plan = shotPlan(edits, shots.added)
  const links = readLinks(form)
  /*
    保存したあとの画像。新しく選んだならそれ（差し替え）、「画像を外す」なら
    無し、どちらでもなければいまのまま。選んだうえで外すにも印を付けたときは、
    選んだほうを採る——ファイルを選ぶ手間のほうが、印1つより強い意思表示
  */
  const removing = bool(form.get('removeImage')) === 1
  const keeps = !removing && existing.imageUrl !== null
  const errors = mergeErrors(
    picked.error ? { image: picked.error } : null,
    icon.error ? { icon: icon.error } : null,
    read.error,
    shots.error,
    plan.error,
    links.error ? { links: links.error } : null,
    unreadable,
    itemValueErrors(values),
    values.published
      ? publishErrors({
          kind: 'item',
          title: values.title,
          summary: values.summary,
          imageAlt: values.imageAlt,
          hasImage: picked.image !== null || keeps,
          shotAlts: plan.alts,
        })
      : null,
    await itemSlugTaken(database, values.slug, id),
  )
  if (errors) return back(errors)

  // 新しい画像を置く → D1 → 通ってから前の画像を消す（commitWithImage の順序）
  const placed = await placeImages(c.env.MEDIA, [
    ...(picked.image ? [{ image: picked.image, name: values.slug }] : []),
    ...(icon.image ? [{ image: icon.image, name: `${values.slug}-icon` }] : []),
    ...shots.added.map((shot) => ({ image: shot.image, name: values.slug })),
  ])
  // 置いた順（メインの画像 → アイコン → ほかの画像）に取り出す
  const imageUrl = picked.image ? (placed.shift() ?? null) : null
  const iconUrl = icon.image ? (placed.shift() ?? null) : null
  const shotUrls = placed
  const image = imageUrl
    ? imageColumns(imageUrl, picked.image)
    : keeps
      ? {}
      : imageColumns(null, null)
  const iconColumn = iconUrl ? { iconUrl } : keepsIcon ? {} : { iconUrl: null }
  const added = shots.added.map((shot, index) => ({
    url: shotUrls[index] ?? '',
    alt: shot.alt,
    width: shot.image.width ?? null,
    height: shot.image.height ?? null,
    sortOrder: plan.orders[index] ?? 0,
  }))
  try {
    await commitWithImage(c.env.MEDIA, [imageUrl, iconUrl, ...shotUrls], () =>
      database.batch([
        database
          .update(schema.items)
          .set({ ...values, ...image, ...iconColumn })
          .where(eq(schema.items.id, id)),
        ...itemSlugMoves(database, id, existing.slug, values.slug),
        ...childWrites(database, id, tags, links.links),
        ...shotWrites(database, id, edits, added),
      ]),
    )
  } catch (error) {
    if (uniqueViolation(error, 'items.slug')) return back({ slug: SLUG_TAKEN })
    throw error
  }
  // 差し替えた・外した画像は KV から消す（removeImage の注記）
  if (imageUrl || !keeps) await removeImage(c.env.MEDIA, existing.imageUrl)
  if (iconUrl || !keepsIcon) await removeImage(c.env.MEDIA, existing.iconUrl)
  for (const edit of edits) if (edit.remove) await removeImage(c.env.MEDIA, edit.shot.url)
  /*
    前の URL が変わったか。slug を変えたときと、区分を変えたとき（1語目の
    apps / works が変わる。公開ページが前の区分の URL を 301 で寄せる）
  */
  const moved =
    existing.slug !== null && (existing.slug !== values.slug || existing.type !== values.type)
  return c.redirect(
    `/admin/items?type=${values.type}&saved=${savedParam(values.published)}${moved ? '&moved=1' : ''}${again ? '&again=1' : ''}`,
    303,
  )
}

itemRoutes.get('/items/:id/delete', async (c) => {
  const id = parseId(c.req.param('id'))
  if (!id) return c.notFound()
  const item = await db(c).query.items.findFirst({
    where: eq(schema.items.id, id),
    with: { tags: true, links: true, shots: true },
  })
  if (!item) return c.notFound()
  // 一緒に消える画像（メインの画像・アイコン・ほかの画像）の枚数
  const images = (item.imageUrl ? 1 : 0) + (item.iconUrl ? 1 : 0) + item.shots.length

  return c.html(
    <AdminLayout title="削除の確認" active="items" account={c.get('account')}>
      <Confirm
        title={`「${item.title}」を削除しますか？`}
        detail="この操作は取り消せません。"
        action={`/admin/items/${id}/delete`}
        cancelHref={cameFromEdit(c) ? `/admin/items/${id}/edit` : `/admin/items?type=${item.type}`}
      >
        <p>
          タグ {item.tags.length} 件とリンク {item.links.length} 件
          {images ? `、画像 ${images} 枚` : ''}
          も一緒に消えます。
          <br />
          サイトから隠したいだけなら、編集で「公開する」を外すほうが安全です。
        </p>
      </Confirm>
    </AdminLayout>,
  )
})

itemRoutes.post('/items/:id/delete', async (c) => {
  const id = parseId(c.req.param('id'))
  if (!id) return c.notFound()
  const item = await db(c).query.items.findFirst({
    where: eq(schema.items.id, id),
    with: { shots: true },
  })
  if (!item) return c.notFound()

  // D1 → KV の順（ほかの画像の行は cascade で消える。URL は消す前に引いておく）
  await db(c).delete(schema.items).where(eq(schema.items.id, id))
  for (const url of [item.imageUrl, item.iconUrl, ...item.shots.map((shot) => shot.url)]) {
    await removeImage(c.env.MEDIA, url)
  }
  return c.redirect(`/admin/items?type=${item.type}&deleted=1`, 303)
})
