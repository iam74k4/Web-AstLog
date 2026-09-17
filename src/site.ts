/*
  サイト全体の文言と宛先。

  ここは管理画面から編集できない。トップの名乗りや連絡先は月に一度も
  変わらないので、変更する手段を用意するより、1か所に集めて直接書くほうが早い。
  変わるもの（メンバー・Apps・Works）だけを DB に置いている。
*/

export const SITE = {
  name: 'Noctifex',
  tagline: 'つくる人たちの、置き場所。',

  heroTitle: 'つくったものを、置いておく。',
  heroLead: '個人でつくったアプリと、仕事で取り組んだ開発効率化を、メンバーごとにまとめています。',

  contactTitle: 'AI 活用の話も、コードの話もしたい。',
  contactLead:
    '開発効率化や生成AIの活用、個人開発について話せる機会を探しています。お仕事のご相談も歓迎です。',

  email: 'iam74k4@gmail.com',
  github: 'https://github.com/iam74k4',
  origin: 'https://noctifex.dev',
} as const
