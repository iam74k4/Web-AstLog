// 復元用の画像は公開の /images/* から読めない場所に90日保持する。
export const MEDIA_RETENTION_SECONDS = 90 * 24 * 60 * 60
export const MEDIA_ARCHIVE_PREFIX = 'archive/'

export async function archiveImage(kv: KVNamespace, key: string) {
  const stored = await kv.getWithMetadata<{ contentType?: string }>(key, 'arrayBuffer')
  if (!stored.value) return
  await kv.put(`${MEDIA_ARCHIVE_PREFIX}${key}`, stored.value, {
    expirationTtl: MEDIA_RETENTION_SECONDS,
    metadata: { ...stored.metadata, originalKey: key, archivedAt: new Date().toISOString() },
  })
}
