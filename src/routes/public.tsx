import { drizzle } from 'drizzle-orm/d1'
import { Hono } from 'hono'
import type { Child } from 'hono/jsx'
import { blockType } from '../blocks'
import {
  countMemberItems,
  findPublishedMember,
  listPlatforms,
  listPublishedItems,
  listPublishedMembers,
  loadTheme,
  publishedBlocks,
  usedPlatforms,
} from '../db/queries'
import * as schema from '../db/schema'
import type { AppEnv } from '../env'
import { isSafeUrl, paragraphs, parseLines, parseSkills } from '../lib/format'
import { SITE } from '../site'
import {
  Avatar,
  Brand,
  Empty,
  Filters,
  ItemCard,
  type ItemView,
  LinkList,
  MemberCardCompact,
  MemberCardWide,
  Note,
  NowList,
  Numbers,
  SectionHead,
  Statement,
  Timeline,
} from '../ui/components'
import { GithubIcon, MailIcon } from '../ui/icons'
import { Layout, type NavItem } from '../ui/Layout'

export const publicRoutes = new Hono<AppEnv>()

const Socials = ({ github, email }: { github?: string | null; email?: string | null }) => (
  <div class="socials">
    {github ? (
      <a href={github} rel="me noreferrer" target="_blank">
        <GithubIcon /> GitHub
      </a>
    ) : null}
    {email ? (
      <a href={`mailto:${email}`}>
        <MailIcon /> Mail
      </a>
    ) : null}
  </div>
)

const Contact = ({ title, lead, email }: { title: string; lead: string; email: string }) => (
  <section id="contact">
    <div class="contact">
      <h2>{title}</h2>
      <p>{lead}</p>
      <a class="pill-cta" href={`mailto:${email}`}>
        {email}
      </a>
    </div>
  </section>
)

type TopData = {
  members: schema.Member[]
  apps: ItemView[]
  works: ItemView[]
  platforms: schema.Platform[]
}

type Rendered = { id: string; nav: string | null; node: Child }

/*
  ブロック1つを節に描く。中身が無ければ null を返し、節ごと出さない
  （見出しだけ残さない）。

  決まった中身のもの（apps・team …）は id を type と同じにして、
  #apps のようなアンカーと、filter.js が見る #app-grid を保つ。
  打ち込むものは block-<id>。
*/
function renderBlock(block: schema.Block, data: TopData): Rendered | null {
  const type = blockType(block.type)
  if (!type) return null
  const { members, apps, works, platforms } = data
  const id = type.kind === 'fixed' ? type.key : `block-${block.id}`
  // 見出しが空なら、フォームの初期値と同じ名前（それも無ければ種類の名前）
  const title = block.title || ('title' in type && type.title) || type.label

  switch (block.type) {
    case 'hero':
      return {
        id,
        nav: null,
        node: (
          <header class="hero">
            <h1>{SITE.heroTitle}</h1>
            <p>{SITE.heroLead}</p>
          </header>
        ),
      }

    case 'apps':
      if (!apps.length) return null
      return {
        id,
        nav: 'Apps',
        node: (
          <section id={id}>
            <SectionHead title="Apps" note="個人開発" />
            <Filters
              platforms={usedPlatforms(apps, platforms)}
              members={members.map((member) => ({ slug: member.slug, name: member.name }))}
            />
            <div class="grid" id="app-grid">
              {apps.map((item) => (
                <ItemCard key={item.id} item={item} showMember={members.length > 1} />
              ))}
            </div>
            <p class="filter-empty" hidden>
              この条件に当てはまるものはまだありません
            </p>
          </section>
        ),
      }

    case 'works':
      if (!works.length) return null
      return {
        id,
        nav: 'Works',
        node: (
          <section id={id}>
            <SectionHead title="Works" note="業務" />
            <div class="grid" id="work-grid">
              {works.map((item) => (
                <ItemCard key={item.id} item={item} showMember={members.length > 1} />
              ))}
            </div>
          </section>
        ),
      }

    case 'team':
      if (!members.length) return null
      return {
        id,
        nav: 'Team',
        node: (
          <section id={id}>
            <SectionHead
              title="Team"
              note={`${members.length} member${members.length > 1 ? 's' : ''}`}
            />
            {/* 1〜2人なら横長、3人以上でグリッド。人数で決める、画面幅では決めない */}
            {members.length <= 2 ? (
              <div class="team-list">
                {members.map((member) => (
                  <MemberCardWide key={member.id} member={member} />
                ))}
              </div>
            ) : (
              <div class="team-grid">
                {members.map((member) => (
                  <MemberCardCompact key={member.id} member={member} />
                ))}
              </div>
            )}
          </section>
        ),
      }

    case 'contact':
      return {
        id,
        nav: 'Contact',
        node: <Contact title={SITE.contactTitle} lead={SITE.contactLead} email={SITE.email} />,
      }

    // ここから打ち込むもの。目次に載せるのは見出しを持つものだけ

    case 'statement': {
      if (!block.title) return null
      return {
        id,
        nav: null,
        node: (
          <section id={id}>
            <Statement text={block.title} notes={paragraphs(block.body)} />
          </section>
        ),
      }
    }

    case 'now': {
      const rows = parseLines(block.body)
      if (!rows.length) return null
      return {
        id,
        nav: title,
        node: (
          <section id={id}>
            <SectionHead title={title} />
            <NowList rows={rows} />
          </section>
        ),
      }
    }

    case 'numbers': {
      const rows = parseLines(block.body)
      if (!rows.length) return null
      return {
        id,
        nav: title,
        node: (
          <section id={id}>
            <SectionHead title={title} />
            <Numbers rows={rows} />
          </section>
        ),
      }
    }

    case 'links': {
      const rows = parseLines(block.body).filter(([, url]) => isSafeUrl(url))
      if (!rows.length) return null
      return {
        id,
        nav: title,
        node: (
          <section id={id}>
            <SectionHead title={title} />
            <LinkList rows={rows} />
          </section>
        ),
      }
    }

    case 'timeline': {
      const rows = parseLines(block.body)
      if (!rows.length) return null
      return {
        id,
        nav: title,
        node: (
          <section id={id}>
            <SectionHead title={title} />
            <Timeline rows={rows} />
          </section>
        ),
      }
    }

    case 'note': {
      const texts = paragraphs(block.body)
      if (!texts.length) return null
      return {
        id,
        nav: block.title || null,
        node: (
          <section id={id}>
            {block.title ? <SectionHead title={block.title} /> : null}
            <Note paragraphs={texts} />
          </section>
        ),
      }
    }
  }
}

publicRoutes.get('/', async (c) => {
  const db = drizzle(c.env.DB, { schema })
  const [members, apps, works, platforms, theme, blocks] = await Promise.all([
    listPublishedMembers(db),
    listPublishedItems(db, 'app'),
    listPublishedItems(db, 'work'),
    listPlatforms(db),
    loadTheme(db),
    publishedBlocks(db),
  ])

  // 管理の「構成」で置いた順に描く。中身の無い節は落ちる
  const sections = blocks
    .map((block) => renderBlock(block, { members, apps, works, platforms }))
    .filter((section) => section !== null)
  const nav: NavItem[] = sections
    .filter((section) => section.nav !== null)
    .map((section) => ({ href: `#${section.id}`, label: section.nav ?? '' }))

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: SITE.name,
    url: SITE.origin,
    description: SITE.heroLead,
    sameAs: [SITE.github],
    member: members.map((member) => ({
      '@type': 'Person',
      name: member.name,
      jobTitle: member.role,
      url: `${SITE.origin}/members/${member.slug}`,
    })),
  }

  return c.html(
    <Layout
      title={`${SITE.name} — Apps & Works`}
      description={SITE.heroLead}
      canonical={`${SITE.origin}/`}
      jsonLd={jsonLd}
      nav={nav}
      theme={theme}
      withFilterScript={sections.some((section) => section.id === 'apps') || members.length > 1}
      sidebar={
        <div class="identity">
          <Brand />
          <span class="identity__tagline">{SITE.tagline}</span>
          <Socials github={SITE.github} email={SITE.email} />
        </div>
      }
    >
      {sections.map((section) => section.node)}
    </Layout>,
  )
})

publicRoutes.get('/members/:slug', async (c) => {
  const db = drizzle(c.env.DB, { schema })
  const [member, theme] = await Promise.all([
    findPublishedMember(db, c.req.param('slug')),
    loadTheme(db),
  ])
  if (!member) return c.notFound()

  const counts = await countMemberItems(db, member.id)
  const skills = parseSkills(member.skillsText)
  const career = parseLines(member.careerText)
  const bio = paragraphs(member.bio)
  const total = counts.app + counts.work

  const nav = [
    { href: '#about', label: 'About' },
    total ? { href: `/?member=${member.slug}#apps`, label: 'Apps · Works' } : null,
    { href: '#contact', label: 'Contact' },
  ].filter((item) => item !== null)

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Person',
    name: member.name,
    jobTitle: member.role,
    url: `${SITE.origin}/members/${member.slug}`,
    ...(member.github ? { sameAs: [member.github] } : {}),
    worksFor: { '@type': 'Organization', name: SITE.name, url: SITE.origin },
  }

  return c.html(
    <Layout
      title={`${member.name} — ${SITE.name}`}
      description={member.headline || bio[0] || `${member.name}（${member.role}）のプロフィール`}
      canonical={`${SITE.origin}/members/${member.slug}`}
      jsonLd={jsonLd}
      nav={nav}
      theme={theme}
      sidebar={
        <div class="identity">
          <Brand size="sm" />
          <Avatar src={member.avatarUrl} name={member.name} size={72} />
          <h1 class="identity__name">{member.name}</h1>
          {member.role ? <span class="identity__role">{member.role}</span> : null}
          {member.location ? <span class="identity__place">{member.location}</span> : null}
          <Socials github={member.github} email={member.email ?? SITE.email} />
        </div>
      }
    >
      <header class="hero">
        <h2 class="hero__headline">{member.headline || member.name}</h2>
      </header>

      <section id="about">
        <SectionHead title="About" note="経歴 / 技術" />
        <div class="about">
          <Note paragraphs={bio}>
            {bio.length ? null : <Empty>準備中です</Empty>}

            {skills.length ? (
              <div class="skills">
                {skills.map((group) => (
                  <div class="skill-group" key={group.heading}>
                    {group.heading ? <p class="side-head">{group.heading}</p> : null}
                    <ul>
                      {group.skills.map((skill) => (
                        <li key={skill.label}>
                          {skill.label}
                          {skill.note ? <span class="exp">{skill.note}</span> : null}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            ) : null}
          </Note>

          {career.length ? (
            <div>
              <p class="side-head">CAREER</p>
              {/* トップの「できごと」と同じ部品。同じ形のものを2度書かない */}
              <Timeline rows={career} />
            </div>
          ) : null}
        </div>
      </section>

      {total ? (
        <section>
          {/* ここでカードを複製しない。トップの一覧をこのメンバーで絞り込んだ状態へ送る */}
          <a class="band" href={`/?member=${member.slug}#apps`}>
            <span class="band__body">
              <strong>このメンバーの Apps · Works</strong>
              <span class="band__meta">
                Apps {counts.app} · Works {counts.work}
              </span>
            </span>
            <span class="band__go">一覧で見る →</span>
          </a>
        </section>
      ) : null}

      <Contact
        title={SITE.contactTitle}
        lead={SITE.contactLead}
        email={member.email ?? SITE.email}
      />
    </Layout>,
  )
})

/*
  管理画面からアップロードした画像。KV から出す。

  同じ KV にはログイン試行回数（login:<メールアドレス>）も入っている。
  ここでキーの形を縛らないと、そのまま読み出せてしまう。
  avatars/ 配下の、こちらが付けた名前だけを通す。
*/
const AVATAR_KEY = /^avatars\/[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/

publicRoutes.get('/images/*', async (c) => {
  const key = c.req.path.replace(/^\/images\//, '')
  if (!AVATAR_KEY.test(key)) return c.notFound()

  const object = await c.env.MEDIA.getWithMetadata<{ contentType?: string }>(key, 'arrayBuffer')
  if (!object.value) return c.notFound()

  return new Response(object.value, {
    headers: {
      'content-type': object.metadata?.contentType ?? 'application/octet-stream',
      'cache-control': 'public, max-age=31536000, immutable',
    },
  })
})
