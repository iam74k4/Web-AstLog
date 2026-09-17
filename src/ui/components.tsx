import type { Child } from 'hono/jsx'
import type { Item, Member, Platform } from '../db/schema'
import { initials } from '../lib/format'
import { MarkIcon } from './icons'

/*
  画面はこの部品だけで組む。新しい見た目が要るときは、まずここに足してから使う。
  ここに無い形をその場で書くと、同じものが少しずつ違う姿で増える。
*/

export const Brand = ({ size = 'md', href = '/' }: { size?: 'sm' | 'md'; href?: string }) => (
  <a class={`brand brand--${size}`} href={href}>
    <MarkIcon size={size === 'sm' ? 17 : 27} />
    <span class="brand__word">NOCTIFEX</span>
  </a>
)

export const Avatar = ({
  src,
  name,
  size = 72,
}: {
  src?: string | null
  name: string
  size?: number
}) => (
  <span class="avatar" style={`--avatar-size:${size}px`}>
    {/*
      遅延読み込みにしない。1ページに数枚しか無く、どれも小さい。
      待たせる利得より、Team の欄が空の丸のまま見える時間のほうが痛い
      （印刷とスクリーンショットでは、そのまま空で焼き付く）
    */}
    {src ? (
      <img src={src} alt="" width={size} height={size} />
    ) : (
      <span class="avatar__fallback" aria-hidden="true">
        {initials(name)}
      </span>
    )}
  </span>
)

export const SectionHead = ({ id, title, note }: { id?: string; title: string; note?: string }) => (
  <div class="head">
    <h2 id={id}>{title}</h2>
    {note ? <span class="note">{note}</span> : null}
  </div>
)

export const Tags = ({ tags }: { tags: string[] }) =>
  tags.length ? (
    <ul class="tags">
      {tags.map((tag) => (
        <li key={tag}>{tag}</li>
      ))}
    </ul>
  ) : null

export type ItemView = Item & {
  tags: string[]
  links: { label: string; url: string }[]
  platformLabel: string | null
  memberName: string | null
  memberSlug: string | null
}

export const ItemCard = ({ item, showMember }: { item: ItemView; showMember?: boolean }) => (
  <article class="card" data-platform={item.platformKey ?? ''} data-member={item.memberSlug ?? ''}>
    <div class="card__head">
      <h3>{item.title}</h3>
      {item.year ? <span class="year">{item.year}</span> : null}
    </div>
    {item.platformLabel || item.category ? (
      <span class="chip">{item.platformLabel ?? item.category}</span>
    ) : null}
    {item.summary ? <p>{item.summary}</p> : null}
    {item.metricValue ? (
      <div class="metric">
        <span class="metric__value">{item.metricValue}</span>
        {item.metricUnit ? <span class="metric__unit">{item.metricUnit}</span> : null}
        {item.metricNote ? <span class="metric__note">{item.metricNote}</span> : null}
      </div>
    ) : null}
    <Tags tags={item.tags} />
    {showMember && item.memberName && item.memberSlug ? (
      <a class="card__member" href={`/members/${item.memberSlug}`}>
        {item.memberName}
      </a>
    ) : null}
    {item.links.length ? (
      <div class="links">
        {item.links.map((link) => (
          <a key={link.url} href={link.url} rel="noreferrer" target="_blank">
            {link.label}
          </a>
        ))}
      </div>
    ) : null}
  </article>
)

// 1〜2人のときは横長。4列のグリッドに1人だけ置くと、未完成の一覧に見える
export const MemberCardWide = ({ member }: { member: Member }) => (
  <a class="member member--wide" href={`/members/${member.slug}`}>
    <Avatar src={member.avatarUrl} name={member.name} size={52} />
    <span class="member__body">
      <span class="member__line">
        <strong>{member.name}</strong>
        <span class="member__role">
          {member.role}
          {member.location ? ` · ${member.location}` : ''}
        </span>
      </span>
      {member.headline ? <span class="member__lead">{member.headline}</span> : null}
    </span>
    <span class="member__go">Profile ↗</span>
  </a>
)

export const MemberCardCompact = ({ member }: { member: Member }) => (
  <a class="member member--compact" href={`/members/${member.slug}`}>
    <Avatar src={member.avatarUrl} name={member.name} size={44} />
    <strong>{member.name}</strong>
    <span class="member__role">{member.role}</span>
    <span class="member__go">Profile ↗</span>
  </a>
)

export const Filters = ({
  platforms,
  members,
}: {
  platforms: Platform[]
  members: { slug: string; name: string }[]
}) => (
  <fieldset class="filters">
    <legend class="sr-only">種別で絞り込む</legend>
    <button type="button" data-filter="all" aria-pressed="true">
      すべて
    </button>
    {platforms.map((platform) => (
      <button key={platform.key} type="button" data-filter={platform.key} aria-pressed="false">
        {platform.label}
      </button>
    ))}
    {members.length > 1
      ? members.map((member) => (
          <button
            key={member.slug}
            type="button"
            data-filter-member={member.slug}
            aria-pressed="false"
          >
            {member.name}
          </button>
        ))
      : null}
  </fieldset>
)

export const Empty = ({ children }: { children: Child }) => <p class="empty">{children}</p>

export const StatusPill = ({ published }: { published: number }) =>
  published ? (
    <span class="status status--published">公開</span>
  ) : (
    <span class="status status--draft">下書き</span>
  )
