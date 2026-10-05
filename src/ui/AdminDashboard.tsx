import { AdminLayout } from './AdminLayout'

export type DashboardCounts = {
  published: number
  drafts: number
  total: number
  firstDraft: number | null
}

export type DashboardAction = {
  title: string
  note: string
  href: string
  label: string
  newTab?: boolean
}

const CountSummary = ({ counts }: { counts: DashboardCounts }) => (
  <span class="dashboard-counts">
    {counts.total === 0 ? (
      <span class="dashboard-state">未登録</span>
    ) : (
      <>
        <span>公開 {counts.published} 件</span>
        <span>下書き {counts.drafts} 件</span>
      </>
    )}
  </span>
)

export const AdminDashboard = (props: {
  account: string
  next: DashboardAction
  members: DashboardCounts
  apps: DashboardCounts
  works: DashboardCounts
  profilesShown: boolean
  projectsShown: boolean
  siteSaved: boolean
  siteStarted: boolean
  hasContact: boolean
  blockCount: number
  blockDrafts: number
  pages: number
  appearance: string
}) => (
  <AdminLayout title="概要" active="dashboard" account={props.account}>
    <div class="admin-head">
      <div class="admin-head__title">
        <span class="crumbs">サイト全体</span>
        <h1>概要</h1>
      </div>
    </div>

    <section class="dashboard-preview" aria-labelledby="dashboard-preview-title">
      <div>
        <h2 id="dashboard-preview-title">保存した内容を、サイトで確認する</h2>
        <p>公開中の内容をまとめて確認できます。下書きは各編集画面から確認できます。</p>
      </div>
      <div class="dashboard-preview__actions">
        <a class="btn btn--primary" href="/admin/preview" target="_blank" rel="noreferrer">
          全体をプレビュー ↗
        </a>
        <a class="btn btn--ghost" href="/" target="_blank" rel="noreferrer">
          公開サイトを開く ↗
        </a>
      </div>
    </section>

    <section class="dashboard-next" aria-labelledby="dashboard-next-title">
      <div>
        <span class="dashboard-next__label">次にできること</span>
        <h2 id="dashboard-next-title">{props.next.title}</h2>
        <p>{props.next.note}</p>
      </div>
      <a
        class="btn btn--ghost"
        href={props.next.href}
        target={props.next.newTab ? '_blank' : undefined}
        rel={props.next.newTab ? 'noreferrer' : undefined}
      >
        {props.next.label}
      </a>
    </section>

    <section class="dashboard-settings" aria-labelledby="dashboard-settings-title">
      <div class="dashboard-settings__head">
        <h2 id="dashboard-settings-title">設定する場所</h2>
        <p>必要な内容から整えられます。下書きは公開サイトに出ません。</p>
      </div>
      <div class="dashboard-grid">
        <a class="dashboard-card" href="/admin/site">
          <div class="dashboard-card__head">
            <h3>サイトの紹介と連絡先</h3>
            <span class="dashboard-state">
              {props.siteSaved ? '保存済み' : props.siteStarted ? '一部保存済み' : '既定の文章'}
            </span>
          </div>
          <p>入口の紹介文と、公開するメール・GitHub を編集します。</p>
          <span class="dashboard-card__status">
            公開する連絡先: {props.hasContact ? '設定あり' : '未設定（掲載しません）'}
          </span>
          <span class="dashboard-card__action">サイト設定を開く →</span>
        </a>

        <a class="dashboard-card" href="/admin/members">
          <div class="dashboard-card__head">
            <h3>プロフィール・チーム</h3>
          </div>
          <p>名前、紹介文、写真、経歴などを編集します。1人でも使えます。</p>
          <CountSummary counts={props.members} />
          {props.members.published > 0 && !props.profilesShown ? (
            <span class="dashboard-card__status">プロフィール・チームは目次から外れています</span>
          ) : null}
          <span class="dashboard-card__action">Members を開く →</span>
        </a>

        <a
          class="dashboard-card"
          href={
            props.apps.total === 0 && props.works.total > 0
              ? '/admin/items?type=work'
              : '/admin/items'
          }
        >
          <div class="dashboard-card__head">
            <h3>作品・業務の実績</h3>
          </div>
          <p>個人開発と業務の実績を、画像や説明とともに登録します。</p>
          <dl class="dashboard-projects">
            <div>
              <dt>個人開発</dt>
              <dd>
                <CountSummary counts={props.apps} />
              </dd>
            </div>
            <div>
              <dt>業務</dt>
              <dd>
                <CountSummary counts={props.works} />
              </dd>
            </div>
          </dl>
          {props.apps.published + props.works.published > 0 && !props.projectsShown ? (
            <span class="dashboard-card__status">
              Projects は目次から外れています（作品のページは公開中）
            </span>
          ) : null}
          <span class="dashboard-card__action">Projects を開く →</span>
        </a>

        <a class="dashboard-card" href="/admin/blocks">
          <div class="dashboard-card__head">
            <h3>ページの構成</h3>
            <span class="dashboard-state">
              {props.blockCount === 0
                ? '既定の並び'
                : props.blockDrafts === props.blockCount
                  ? 'すべて下書き'
                  : props.pages === 0
                    ? '目次に表示なし'
                    : '設定あり'}
            </span>
          </div>
          <p>サイトに出すページを選び、順番を変えたり文章のページを足したりします。</p>
          <span class="dashboard-card__status">目次に表示: {props.pages} ページ</span>
          {props.blockCount > 0 ? (
            <span class="dashboard-card__status">
              公開 {props.blockCount - props.blockDrafts} 件 · 下書き {props.blockDrafts} 件
            </span>
          ) : null}
          <span class="dashboard-card__action">構成を開く →</span>
        </a>

        <a class="dashboard-card" href="/admin/appearance">
          <div class="dashboard-card__head">
            <h3>色と書体</h3>
          </div>
          <p>サイト全体のアクセントと文字を選びます。今のままでも使えます。</p>
          <span class="dashboard-card__status">{props.appearance}</span>
          <span class="dashboard-card__action">見た目を開く →</span>
        </a>
      </div>
    </section>
  </AdminLayout>
)
