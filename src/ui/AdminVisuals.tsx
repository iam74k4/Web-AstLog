import { Wordmark } from './icons'

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
        <b class="block-illustration__head" />
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
