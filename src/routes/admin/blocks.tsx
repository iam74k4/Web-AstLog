import { eq, inArray, type SQL, sql } from 'drizzle-orm'
import { type Context, Hono } from 'hono'
import {
  BLOCK_TYPES,
  type BlockType,
  blockShown,
  blockType,
  blockValueErrors,
  isBlockKey,
  LEGACY_BLOCK_KEYS,
  MAX_CHARS,
  MAX_STATEMENT_SENTENCE,
  publishErrors,
  type SiteCounts,
} from '../../blocks'
import {
  countPublishedItems,
  type Db,
  defaultBlocks,
  ensureBlocks,
  initBlocks,
  listBlocks,
  listPublishedMembers,
  reorderBlocks,
} from '../../db/queries'
import * as schema from '../../db/schema'
import type { AppEnv } from '../../env'
import { bool, str } from '../../lib/format'
import { Area, Confirm, Field, FormActions, FormKey, PublishToggle } from '../../ui/AdminForm'
import { AdminLayout } from '../../ui/AdminLayout'
import { StatusPill } from '../../ui/components'
import { PencilIcon, TrashIcon } from '../../ui/icons'
import {
  asValues,
  cameFromEdit,
  db,
  flashFor,
  formKeyOf,
  newFormKey,
  parseId,
  savedParam,
} from './request'

export const blockRoutes = new Hono<AppEnv>()

/*
  前の Apps / Works は、一覧では1つの Projects に畳まれる（listBlocks）。編集と
  削除もその論理行を操作する。代表だけを書き換えると、隠れた公開行から Projects が
  戻ってしまうので、元の行の id をまとめ、1つの UPDATE / DELETE に渡す。

  表示する id と公開状態は listBlocks の答えを使う。移行済みの種類は1行のまま。
*/
async function findAdminBlock(database: Db, id: number) {
  const stored = await database.query.blocks.findFirst({ where: eq(schema.blocks.id, id) })
  if (!stored) return undefined
  const type = LEGACY_BLOCK_KEYS[stored.type]
  if (!type) return { block: stored, where: eq(schema.blocks.id, id) }

  const aliases = Object.entries(LEGACY_BLOCK_KEYS)
    .filter(([, current]) => current === type)
    .map(([before]) => sql`${before}`)
  const [rows, legacy] = await Promise.all([
    listBlocks(database),
    database
      .select({ id: schema.blocks.id })
      .from(schema.blocks)
      .where(sql`${schema.blocks.type} in (${sql.join(aliases, sql`, `)})`),
  ])
  const ids = legacy.map((row) => row.id)
  const block = rows.find((row) => ids.includes(row.id)) ?? rows.find((row) => row.id === id)
  if (!block) return undefined
  return { block, where: inArray(schema.blocks.id, [...new Set([...ids, block.id])]) }
}

/*
  公開ページの並び。置く・外す・前後に動かす、の3つだけ。
  部品の見た目はここからは変えられない（見た目は「見た目」で、全体に対して選ぶ）。

  ブロック1つが公開ページの1ページ。行に出す「出る / 出ない」は、公開にしたのに
  中身が無くて出ていないもの（項目が0件の Projects・通る行が1つも無いリンク集）を
  知らせるためのもので、操作する口ではない。「公開」の札だけでは、それが
  公開ページのどこにも無いことに気づけない。
*/

const blockLabel = (block: schema.Block) =>
  block.title || blockType(block.type)?.label || block.type

/*
  公開ページに出るかを決める、公開中のものの件数（src/blocks.ts の blockShown が
  読む形）。項目の行そのものは引かない（数えるだけなら、一覧の行の中身まで取って
  くる必要が無い）。公開中のメンバーが1人なら、Team の行はその人のプロフィールに
  置き換わる（src/routes/public/data.ts の profileOf。行の下にその旨を出す）。
*/
async function siteCounts(database: Db): Promise<SiteCounts> {
  const [projects, members] = await Promise.all([
    // Projects は個人開発と業務を1つの一覧に並べるので、区分を問わず数える
    countPublishedItems(database),
    listPublishedMembers(database),
  ])
  return { items: projects, members: members.length }
}

const BlocksPage = (props: {
  account: string
  rows: schema.Block[]
  counts: SiteCounts
  flash?: string | null
  error?: string
}) => {
  const placed = new Set(props.rows.map((row) => row.type))
  // 決まった中身のものは1つだけ。打ち込むものはいくつでも置ける
  const available = BLOCK_TYPES.filter((type) => type.kind === 'free' || !placed.has(type.key))
  // 行ごとに公開ページに出るかと、出るものの数（＝いまサイトが何ページあるか）
  const shown = props.rows.map((row) => blockShown(row, props.counts))
  const total = shown.filter(Boolean).length

  return (
    <AdminLayout title="構成" active="blocks" account={props.account} flash={props.flash}>
      <div class="admin-head">
        <div class="admin-head__title">
          <span class="crumbs">トップページ</span>
          <h1>構成</h1>
        </div>
        {/*
          「見る」は2つある。入口（/）は読む人が着くところで、節ごとのページを
          目次で行き来する姿そのもの。全体ページ（/all）は置いたものが全部縦に
          並ぶ唯一の姿で、この一覧が「合計 N ページ」と言っている中身を通しで
          見られる——並べ替えたあとに確かめる先はこちらのほう。

          入れ物は .form-actions__right（横並び・同じ幅）を借りる。管理画面で
          ボタンを2つ並べる形はこれ1つで、新しい見た目を増やさない。
        */}
        <div class="form-actions__right">
          <a class="btn btn--ghost" href="/" target="_blank" rel="noreferrer">
            サイトを見る ↗
          </a>
          <a class="btn btn--ghost" href="/all" target="_blank" rel="noreferrer">
            全体を1ページで見る ↗
          </a>
        </div>
      </div>

      {props.error ? <p class="banner banner--error">{props.error}</p> : null}

      {/*
        まだ1行も無いときは「足す」を出さない。今そこに見えている5節は
        既定の並びで、行としては存在しない。先にそれを行にしてから触らせる
      */}
      {props.rows.length === 0 ? (
        <div class="empty-state">
          <p>
            まだ何も置いていないので、既定の並び（Hero → Projects → Team → Contact）で 出しています
          </p>
          <form method="post" action="/admin/blocks/init">
            <button class="btn btn--primary" type="submit">
              この並びから始める
            </button>
          </form>
        </div>
      ) : (
        <>
          {/*
            どれが公開ページに出ているかは、公開の札だけでは分からない（中身の無い
            ものは公開でも出ない）。ここに出さないと、公開ページを開くまで分からない
          */}
          <p class="form-note">
            合計 {total}{' '}
            ページ。公開ページはこの順に並び、目次から1つずつ開けます（下書きと、中身の無いものは出ません）。
          </p>
          <ul class="rows">
            {props.rows.map((block, index) => {
              const type = blockType(block.type)
              return (
                // id は「動かした・直した行」へ戻ってくるための着地点
                <li class="row" id={`block-${block.id}`} key={block.id}>
                  <span class="row__move">
                    <form method="post" action={`/admin/blocks/${block.id}/move`}>
                      <input type="hidden" name="dir" value="up" />
                      <button
                        class="move-btn"
                        type="submit"
                        disabled={index === 0}
                        aria-label={`${blockLabel(block)} を前へ`}
                      >
                        ↑
                      </button>
                    </form>
                    <form method="post" action={`/admin/blocks/${block.id}/move`}>
                      <input type="hidden" name="dir" value="down" />
                      <button
                        class="move-btn"
                        type="submit"
                        disabled={index === props.rows.length - 1}
                        aria-label={`${blockLabel(block)} を後ろへ`}
                      >
                        ↓
                      </button>
                    </form>
                  </span>
                  <span class="row__main">
                    <strong>{blockLabel(block)}</strong>
                    <span class="row__sub">
                      {type?.label ?? block.type}
                      {type?.kind === 'fixed' ? ' · 中身は自動' : ''}
                    </span>
                    {/*
                      1人のサイトの Team。公開ページでは Team のページを作らず、その
                      位置にその人のプロフィールが並ぶ（目次は「Profile」）。ここで
                      言っておかないと、公開ページに Team が見当たらない理由が
                      分からない。下書きの行にも出す——公開したら何が出るかの知らせなので
                    */}
                    {block.type === 'team' && props.counts.members === 1 ? (
                      <span class="row__sub">
                        公開中が1人のあいだは、その人のプロフィール（目次は Profile）に置き換わる
                      </span>
                    ) : null}
                  </span>
                  {/* 読み取り専用の知らせ。ここから件数は変えられない */}
                  <span class="row__col">{shown[index] ? '出る' : '出ない'}</span>
                  <StatusPill published={block.published} />
                  <span class="row__actions">
                    {/*
                      公開と下書きを、編集フォームを通らずに切り替える。
                      フォームを通ると本文の検査に当たるので、上限より前に
                      保存された長い中身は「引っ込める」ことすらできなかった。
                      公開にするほうは編集フォームと同じ関門を通る（止めたら
                      その行の編集画面へ。POST /blocks/:id/publish の注記）。
                      ピルは状態の表示、こちらは操作——文言は起きることで書く
                    */}
                    <form
                      class="row__publish"
                      method="post"
                      action={`/admin/blocks/${block.id}/publish`}
                    >
                      <input type="hidden" name="published" value={block.published ? '' : '1'} />
                      <button
                        class="icon-btn icon-btn--wide"
                        type="submit"
                        aria-label={`${blockLabel(block)} を${
                          block.published ? '下書きにする' : '公開する'
                        }`}
                      >
                        {block.published ? '下書きにする' : '公開する'}
                      </button>
                    </form>
                    <a
                      class="icon-btn"
                      href={`/admin/blocks/${block.id}/edit`}
                      aria-label={`${blockLabel(block)} を編集`}
                    >
                      <PencilIcon />
                      <span class="icon-btn__text">編集</span>
                    </a>
                    <a
                      class="icon-btn icon-btn--danger"
                      href={`/admin/blocks/${block.id}/delete`}
                      aria-label={`${blockLabel(block)} を外す`}
                    >
                      <TrashIcon />
                      <span class="icon-btn__text">外す</span>
                    </a>
                  </span>
                </li>
              )
            })}
          </ul>
        </>
      )}

      {props.rows.length === 0 ? null : (
        <section class="catalog">
          <h2 class="catalog__title">
            足す
            <span class="presets__note">Contact の手前に入る。置いてから前後に動かす</span>
          </h2>
          <ul class="catalog__grid">
            {available.map((type) => (
              <li class="catalog__item" key={type.key}>
                <span class="catalog__label">{type.label}</span>
                <span class="catalog__note">{type.note}</span>
                {type.kind === 'fixed' ? (
                  <form method="post" action="/admin/blocks">
                    <input type="hidden" name="type" value={type.key} />
                    <button class="btn btn--ghost" type="submit">
                      置く
                    </button>
                  </form>
                ) : (
                  <a class="btn btn--ghost" href={`/admin/blocks/new?type=${type.key}`}>
                    書く
                  </a>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </AdminLayout>
  )
}

blockRoutes.get('/blocks', async (c) => {
  const database = db(c)
  const [rows, counts] = await Promise.all([listBlocks(database), siteCounts(database)])
  return c.html(
    <BlocksPage
      account={c.get('account')}
      rows={rows}
      counts={counts}
      flash={flashFor(c, '外しました')}
    />,
  )
})

/*
  中身の欄に添える一文。書き方（src/blocks.ts の hint）だけ。行の数や字数に上限は
  無い（ブロック1つが1ページで、ページは縦に読む）。
*/
const bodyHint = (type: Extract<BlockType, { kind: 'free' }>) => type.hint

const BlockForm = (props: {
  account: string
  type: BlockType
  block?: schema.Block
  // 追加のフォームの一度きりの札（newFormKey）。編集では持たない
  formKey?: string | null
  values?: Record<string, string>
  errors?: Record<string, string>
  // フォームの上に出す知らせ（一覧の「公開する」を関門が止めて、ここへ送ってきたとき）
  notice?: string
}) => {
  const { type, block } = props
  const value = (key: 'title' | 'body') =>
    props.values?.[key] ?? block?.[key] ?? (key === 'title' && 'title' in type ? type.title : '')
  /*
    入力エラーで描き直すとき、外した「公開する」も外したまま返す。
    新しく書くときは下書きから始める（メンバー・項目と同じ。置くだけのもの——
    Projects や Team——はフォームを通らず、置いた時点で出る）
  */
  const published = props.values ? Number(props.values.published === '1') : (block?.published ?? 0)

  return (
    <AdminLayout title={type.label} active="blocks" account={props.account}>
      <div class="admin-head">
        <div class="admin-head__title">
          <span class="crumbs">構成 / {block ? '編集' : '追加'}</span>
          <h1>{type.label}</h1>
        </div>
      </div>

      {props.notice ? <p class="banner banner--error">{props.notice}</p> : null}

      <form
        method="post"
        action={block ? `/admin/blocks/${block.id}` : '/admin/blocks'}
        class="form"
      >
        <input type="hidden" name="type" value={type.key} />
        <FormKey value={props.formKey} />
        <div class="form-grid">
          {type.kind === 'free' ? (
            <>
              <Field
                label={type.key === 'statement' ? '一文' : '見出し'}
                name="title"
                value={value('title')}
                error={props.errors?.title}
                hint={
                  type.key === 'statement'
                    ? `大きく出る · ${MAX_STATEMENT_SENTENCE} 字まで`
                    : `空なら「${type.title || type.label}」 · ${MAX_CHARS.blockHeading} 字まで（目次に1行で並ぶ）`
                }
              />
              <Area
                label={type.key === 'statement' ? '添え書き' : '中身'}
                name="body"
                value={value('body')}
                rows={6}
                hint={bodyHint(type)}
                error={props.errors?.body}
              />
            </>
          ) : (
            <p class="form-note field--wide">
              中身は自動で入ります（{type.note}）。ここでは出す・出さないだけを決めます。
            </p>
          )}
        </div>

        <div class="form-foot">
          <PublishToggle published={published} />
          <FormActions
            cancelHref="/admin/blocks"
            deleteHref={block ? `/admin/blocks/${block.id}/delete?from=edit` : undefined}
            deleteLabel="トップから外す…"
          />
        </div>
      </form>
    </AdminLayout>
  )
}

blockRoutes.get('/blocks/new', (c) => {
  const key = c.req.query('type') ?? ''
  const type = isBlockKey(key) ? blockType(key) : undefined
  // 決まった中身のものは書くことが無いので、一覧の「置く」から直接入る
  if (type?.kind !== 'free') return c.notFound()
  return c.html(<BlockForm account={c.get('account')} type={type} formKey={newFormKey()} />)
})

/*
  一覧の「公開する」を関門（publishErrors）が止めたときの着地点。
  /admin/blocks/:id/edit?publish=blocked で来る。

  止めた理由をその行のフォームに出し、「公開する」に印を付けて描く——直して
  保存すれば、押したかった「公開」がそのまま通る。理由がもう無ければ（別の
  タブで直した）、ふつうの編集画面。
*/
const PUBLISH_BLOCKED = '公開できませんでした。下の理由を直して保存すると、公開されます'

blockRoutes.get('/blocks/:id/edit', async (c) => {
  const id = parseId(c.req.param('id'))
  if (!id) return c.notFound()
  const block = (await findAdminBlock(db(c), id))?.block
  const type = block ? blockType(block.type) : undefined
  if (!block || !type) return c.notFound()
  const blocked =
    c.req.query('publish') === 'blocked'
      ? publishErrors({ kind: 'block', type, title: block.title, body: block.body })
      : null
  return c.html(
    blocked ? (
      <BlockForm
        account={c.get('account')}
        type={type}
        block={block}
        values={{ title: block.title, body: block.body, published: '1' }}
        errors={blocked}
        notice={PUBLISH_BLOCKED}
      />
    ) : (
      <BlockForm account={c.get('account')} type={type} block={block} />
    ),
  )
})

function readBlockForm(form: FormData) {
  return {
    title: str(form.get('title')),
    body: str(form.get('body')),
    published: bool(form.get('published')),
  }
}

/*
  ブロックを保存してよいか。下書きでも止めるのは受け取れない値（中身が空・
  リンク集の通らない行。blockValueErrors）だけで、見出しと一文の長さは公開に
  なるときにだけ見る（publishErrors）。数そのものは src/blocks.ts の MAX_CHARS が正。
*/
const blockSaveErrors = (type: BlockType, values: ReturnType<typeof readBlockForm>) =>
  values.published
    ? publishErrors({ kind: 'block', type, title: values.title, body: values.body })
    : blockValueErrors(type, values)

// 足す先はいちばん下。行はもう読んであるので、最大値を DB に聞き直さない
const nextBlockOrder = (rows: schema.Block[]) =>
  rows.reduce((last, row) => Math.max(last, row.sortOrder), 0) + 10

blockRoutes.post('/blocks', async (c) => {
  const database = db(c)
  const form = await c.req.formData()
  const key = str(form.get('type'))
  const type = isBlockKey(key) ? blockType(key) : undefined
  const account = c.get('account')
  const values = type?.kind === 'free' ? readBlockForm(form) : null
  const saved = (id: number) =>
    c.redirect(`/admin/blocks?saved=${savedParam(values ? values.published : 1)}#block-${id}`, 303)

  // 同じ札で書いた行（newFormKey の注記）。札を持つのは打ち込むものだけ
  const twinOf = (key: string | null) =>
    key ? database.query.blocks.findFirst({ where: eq(schema.blocks.formKey, key) }) : undefined
  /*
    同じフォームの2度目の送信は、1度目が作った行への保存（作品の POST /items と同じ。
    中身が違えば・公開に印を付けていれば、編集として反映し、公開の関門も通す）
  */
  const sent = formKeyOf(form)
  const twin = values ? await twinOf(sent) : undefined
  const twinType = twin ? blockType(twin.type) : undefined
  if (twin && values && twinType) return saveBlock(c, twin, twinType, values, true)
  const formKey = sent

  const stored = await listBlocks(database)
  // 0件のときサイトに出ているのは既定の並び。重複かどうかもそれで判断する
  const rows = stored.length ? stored : defaultBlocks()
  const placedAlready = (label: string) =>
    siteCounts(database).then((counts) =>
      c.html(
        <BlocksPage
          account={account}
          rows={stored}
          counts={counts}
          error={`${label} は既に置いてあります`}
        />,
        400,
      ),
    )

  // 公開ページに出るかを数えるのは、一覧を描き直すときだけ。保存できた側では要らない
  if (!type) {
    return c.html(
      <BlocksPage
        account={account}
        rows={stored}
        counts={await siteCounts(database)}
        error="置けないブロックです"
      />,
      400,
    )
  }

  if (type.kind === 'fixed' && rows.some((row) => row.type === type.key)) {
    return placedAlready(type.label)
  }

  if (values) {
    const errors = blockSaveErrors(type, values)
    if (errors) {
      return c.html(
        <BlockForm
          account={account}
          type={type}
          formKey={formKey}
          values={asValues(values)}
          errors={errors}
        />,
        400,
      )
    }
  }

  /*
    ここまで来てから足す。0件なら、先に既定の並びを行にする。
    そうしないと、足した1つだけの DB になって、見えていた5節が消える。

    書くのは ON CONFLICT DO NOTHING の1文。決まった中身の種類は DB の部分一意
    索引（blocks_fixed_once）が、打ち込むものは札（form_key）が、同時に来た
    2本目を止める。止まったら行は返らない
  */
  const current = await ensureBlocks(database)
  const [added] = await database
    .insert(schema.blocks)
    .values({
      type: type.key,
      ...(values ?? { published: 1 }),
      sortOrder: nextBlockOrder(current),
      formKey: values ? formKey : null,
    })
    .onConflictDoNothing()
    .returning({ id: schema.blocks.id })
  if (!added) {
    // 打ち込むものなら1度目の送信が書いている（その行への保存）。決まった中身なら、もう置いてある
    const first = values ? await twinOf(formKey) : undefined
    return first && values ? saveBlock(c, first, type, values, true) : placedAlready(type.label)
  }

  /*
    足す先は Contact の手前。並びのいちばん後ろに付けると締めの連絡先の後ろに
    来てしまい、↑ を何度も押して運ぶことになる
  */
  const contact = current.findIndex((row) => row.type === 'contact')
  if (contact >= 0) {
    const ids = current.map((row) => row.id)
    ids.splice(contact, 0, added.id)
    await reorderBlocks(database, ids)
  }

  return saved(added.id)
})

/*
  何も置いていないときだけ、既定の並びを行にする。2回目以降は何もしない
  （何もしていないのに「保存しました」と出さない）。数えると足すを1文でやる
  （src/db/queries.ts の initBlocks）ので、2本同時に来ても2組にならない
*/
blockRoutes.post('/blocks/init', async (c) => {
  const created = await initBlocks(db(c))
  return c.redirect(created ? '/admin/blocks?saved=1' : '/admin/blocks', 303)
})

blockRoutes.post('/blocks/:id', async (c) => {
  const id = parseId(c.req.param('id'))
  if (!id) return c.notFound()
  const target = await findAdminBlock(db(c), id)
  const block = target?.block
  const type = block ? blockType(block.type) : undefined
  if (!block || !type) return c.notFound()

  return saveBlock(c, block, type, readBlockForm(await c.req.formData()), false, target?.where)
})

/*
  既にある行への保存。編集フォームの送信と、追加のフォームの2度目の送信（again。
  同じ札で1度目が作った行）の両方がここを通る（作品の saveItem と同じ）。
*/
async function saveBlock(
  c: Context<AppEnv>,
  block: schema.Block,
  type: BlockType,
  values: ReturnType<typeof readBlockForm>,
  again: boolean,
  where: SQL = eq(schema.blocks.id, block.id),
) {
  const id = block.id
  const updatedAt = new Date().toISOString()
  const done = () =>
    c.redirect(
      `/admin/blocks?saved=${savedParam(values.published)}${again ? '&again=1' : ''}#block-${id}`,
      303,
    )

  // 決まった中身のものは、出す・出さないしか変えられない
  if (type.kind === 'fixed') {
    await db(c).update(schema.blocks).set({ published: values.published, updatedAt }).where(where)
    return done()
  }

  /*
    下書きに戻す保存では見出しの長さを見ない（関門は published が 1 になるときだけ。
    publishErrors）。公開しないものは公開ページに出ないので、目次に並ぶ長さか
    どうかを問う理由が無い。

    問うと行き止まりができる。上限より前に保存された長い見出しを持つ行は、編集
    フォームが DB の本文で初期化されるので、「公開する」を外して保存しても同じ 400 で
    戻り、引っ込める手が削除しか残らない。
  */
  const errors = blockSaveErrors(type, values)
  if (errors) {
    return c.html(
      <BlockForm
        account={c.get('account')}
        type={type}
        block={block}
        values={asValues(values)}
        errors={errors}
      />,
      400,
    )
  }

  await db(c)
    .update(schema.blocks)
    .set({ ...values, updatedAt })
    .where(where)
  return done()
}

/*
  一覧から公開・下書きだけを切り替える。中身は触らない。

  **公開にするほうは、編集フォームと同じ関門を通す（publishErrors）。** 下書きの
  保存は長さを見ないので、ここで見ないと、上限を超えて書き足した下書きがボタン
  1つで公開になる（検査が1度も走らない道になる）。止めたら 303 でその行の
  編集画面へ送り、理由を出す（GET /blocks/:id/edit の publish=blocked）。

  下書きに戻すほうは何も見ない（引っ込める道を塞がない）。種類も見ない——
  外すのと同じ理由で、blocks.ts から種類を1つ減らしたとき、その行が引っ込められずに
  残らないように。種類の消えた行を公開にするときも見るものが無い（公開ページが
  読み飛ばす）。
*/
blockRoutes.post('/blocks/:id/publish', async (c) => {
  const id = parseId(c.req.param('id'))
  if (!id) return c.notFound()
  const target = await findAdminBlock(db(c), id)
  if (!target) return c.notFound()
  const { block, where } = target

  const form = await c.req.formData()
  const published = bool(form.get('published'))
  const type = blockType(block.type)
  if (
    published &&
    type &&
    publishErrors({ kind: 'block', type, title: block.title, body: block.body })
  ) {
    return c.redirect(`/admin/blocks/${block.id}/edit?publish=blocked`, 303)
  }
  await db(c)
    .update(schema.blocks)
    .set({ published, updatedAt: new Date().toISOString() })
    .where(where)
  // 押した行へ戻す。一覧の頭に戻すと、どれを切り替えたかを探し直すことになる
  return c.redirect(`/admin/blocks?saved=${savedParam(published)}#block-${block.id}`, 303)
})

/*
  上下に1つ動かす。並び順は毎回 10 刻みで振り直すので、同じ値が並んで
  「動かしたのに順番が変わらない」ことが起きない
*/
blockRoutes.post('/blocks/:id/move', async (c) => {
  const id = parseId(c.req.param('id'))
  if (!id) return c.notFound()
  const rows = await listBlocks(db(c))
  const index = rows.findIndex((row) => row.id === id)
  if (index < 0) return c.notFound()

  const form = await c.req.formData()
  const dir = str(form.get('dir'))
  // 'up' 以外を全部「下へ」にすると、打ち間違いの POST でも並びが変わる
  if (dir !== 'up' && dir !== 'down') {
    return c.html(
      <BlocksPage
        account={c.get('account')}
        rows={rows}
        counts={await siteCounts(db(c))}
        error="動かす向きが分かりません"
      />,
      400,
    )
  }

  const target = dir === 'up' ? index - 1 : index + 1
  const ids = rows.map((row) => row.id)
  if (target >= 0 && target < ids.length) {
    const [moved] = ids.splice(index, 1)
    if (moved !== undefined) ids.splice(target, 0, moved)
    await reorderBlocks(db(c), ids)
  }
  // 動かした行へ戻す。ページの頭に戻すと、続けて動かすたびに行を探し直すことになる
  return c.redirect(`/admin/blocks#block-${id}`, 303)
})

/*
  外すのに種類は要らない。blocks.ts から種類を1つ減らしたとき、その行が
  編集も削除もできずに一覧へ残り続けるのを避けるため（読む側は既に無視している）
*/
blockRoutes.get('/blocks/:id/delete', async (c) => {
  const id = parseId(c.req.param('id'))
  if (!id) return c.notFound()
  const block = (await findAdminBlock(db(c), id))?.block
  if (!block) return c.notFound()
  const type = blockType(block.type)

  return c.html(
    <AdminLayout title="外す" active="blocks" account={c.get('account')}>
      <Confirm
        title={`「${blockLabel(block)}」をトップから外しますか？`}
        detail={
          type?.kind === 'fixed'
            ? '中身（登録した項目やメンバー）は消えません。あとから「足す」で置き直せます。'
            : '打ち込んだ中身も消えます。'
        }
        action={`/admin/blocks/${block.id}/delete`}
        // 種類が消えた行は編集画面が開けないので、一覧へ戻す
        cancelHref={
          cameFromEdit(c) && type
            ? `/admin/blocks/${block.id}/edit`
            : `/admin/blocks#block-${block.id}`
        }
        verb="外す"
      >
        <p>いったん隠したいだけなら、編集で「公開する」を外すほうが安全です。</p>
      </Confirm>
    </AdminLayout>,
  )
})

blockRoutes.post('/blocks/:id/delete', async (c) => {
  const id = parseId(c.req.param('id'))
  if (!id) return c.notFound()
  const target = await findAdminBlock(db(c), id)
  if (!target) return c.notFound()

  await db(c).delete(schema.blocks).where(target.where)
  return c.redirect('/admin/blocks?deleted=1', 303)
})
