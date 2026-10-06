import { Layout } from './Layout'

type PublicLayoutProps = Parameters<typeof Layout>[0]

export type PreviewLayoutProps = Omit<
  PublicLayoutProps,
  'canonical' | 'jsonLd' | 'admin' | 'image' | 'preview' | 'previewUnsaved'
> & {
  label: string
  editHref: string
  publicHref?: string
  unsaved?: boolean
  draft?: boolean
  warnings?: Record<string, string> | null
}

// 公開と同じ外枠で表示し、管理プレビューであることだけを明示する。
export const PreviewLayout = (props: PreviewLayoutProps) => (
  <Layout
    title={`${props.title} · プレビュー`}
    description={props.description}
    canonical=""
    nav={props.nav}
    theme={props.theme}
    celestial={props.celestial}
    footer={props.footer}
    whole={props.whole}
    previewUnsaved={props.unsaved}
    preview={
      <aside class="preview-notice" aria-label="管理プレビュー">
        <div class="preview-notice__inner">
          <div class="preview-notice__copy">
            <strong>プレビュー · {props.label}</strong>
            <span>
              {props.unsaved
                ? '編集中の内容です。このプレビューでは保存されません。編集を続けるには元のタブに戻ってください。'
                : props.draft
                  ? '保存済みの下書きです。サイトには公開されません。'
                  : '公開中の保存済みデータを表示しています。'}
            </span>
            <span>
              {props.unsaved
                ? 'ほかの画面へ移動すると保存済みの内容を表示します。公開サイトや外部サービスへのリンクもあります。'
                : '本文内には、公開サイトや外部サービスへ移動するリンクがあります。'}
            </span>
            {props.warnings ? (
              <span>公開する前に確認してください: {Object.values(props.warnings).join('。')}</span>
            ) : null}
          </div>
          {!props.unsaved || props.publicHref ? (
            <div class="preview-notice__actions">
              {!props.unsaved ? (
                <a href={props.editHref} target="_blank" rel="noreferrer">
                  編集画面を開く ↗
                </a>
              ) : null}
              {props.publicHref ? (
                <a href={props.publicHref} target="_blank" rel="noreferrer">
                  公開中の画面を見る ↗
                </a>
              ) : null}
            </div>
          ) : null}
        </div>
      </aside>
    }
  >
    {props.children}
  </Layout>
)
