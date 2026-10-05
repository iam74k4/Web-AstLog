import { type Context, Hono } from 'hono'
import { blockType, blockValueErrors, isBlockKey, publishErrors } from '../../blocks'
import type * as schema from '../../db/schema'
import type { AppEnv } from '../../env'
import { str } from '../../lib/format'
import { findAdminBlock, readBlockForm } from './blocks'
import { renderBlockPreview, validationFailure } from './preview'
import { db, parseId } from './request'

export const blockPreviewRoutes = new Hono<AppEnv>()

// 未保存の文章はこの応答内だけで描く。既存の公開状態・本文・構成には書き込まない。
async function previewBlockPost(c: Context<AppEnv>, askedId?: string) {
  const id = askedId === undefined ? null : parseId(askedId)
  if (askedId !== undefined && !id) return c.notFound()
  const existing = id ? (await findAdminBlock(db(c), id))?.block : undefined
  if (id && !existing) return c.notFound()
  let form: FormData
  try {
    form = await c.req.formData()
  } catch {
    return c.text('フォームを読み取れませんでした。編集画面から再送してください。', 400)
  }
  const key = existing?.type ?? str(form.get('type'))
  const type = isBlockKey(key) ? blockType(key) : undefined
  if (!type || (!existing && type.kind !== 'free')) return c.notFound()
  const values =
    type.kind === 'free'
      ? readBlockForm(form)
      : { title: existing?.title ?? '', body: existing?.body ?? '', published: 0 }
  const editHref = existing ? `/admin/blocks/${id}/edit` : `/admin/blocks/new?type=${type.key}`
  const errors = blockValueErrors(type, values)
  if (errors) return validationFailure(c, errors, editHref)
  const now = new Date().toISOString()
  const block: schema.Block = {
    id: 0,
    type: type.key,
    sortOrder: 0,
    formKey: null,
    createdAt: now,
    updatedAt: now,
    ...existing,
    ...values,
  }
  return renderBlockPreview(c, block, {
    editHref,
    unsaved: true,
    warnings: publishErrors({ kind: 'block', type, title: values.title, body: values.body }),
  })
}

blockPreviewRoutes.post('/preview/blocks', (c) => previewBlockPost(c))
blockPreviewRoutes.post('/preview/blocks/:id', (c) => previewBlockPost(c, c.req.param('id')))
