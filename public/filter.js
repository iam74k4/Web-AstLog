/*
  絞り込み。プラットフォーム（Apps だけ）とメンバー（Apps と Works の両方）の
  2軸を同時に効かせる。

  これが動かなくても全件が出たままになるように、初期状態では何も隠さない。
*/
{
  const buttons = [...document.querySelectorAll('.filters button')]
  const appCards = [...document.querySelectorAll('#app-grid .card')]
  // メンバーでの絞り込みは Works にも効かせる。個人ページから
  // 「このメンバーの Apps · Works」で来たときに、Works だけ全員分が
  // 残っていると、絞り込んだことにならない
  const workCards = [...document.querySelectorAll('#work-grid .card')]
  const emptyNote = document.querySelector('.filter-empty')
  const workSection = document.querySelector('#works')

  const state = { platform: 'all', member: '' }

  const apply = () => {
    let shownApps = 0
    for (const card of appCards) {
      const platformOk = state.platform === 'all' || card.dataset.platform === state.platform
      const memberOk = !state.member || card.dataset.member === state.member
      const visible = platformOk && memberOk
      card.hidden = !visible
      if (visible) shownApps++
    }

    let shownWorks = 0
    for (const card of workCards) {
      const visible = !state.member || card.dataset.member === state.member
      card.hidden = !visible
      if (visible) shownWorks++
    }
    // Works が全部消えたら、見出しだけ残さず節ごと隠す
    if (workSection) workSection.hidden = workCards.length > 0 && shownWorks === 0

    if (emptyNote) emptyNote.hidden = shownApps > 0

    for (const button of buttons) {
      const pressed =
        'filterMember' in button.dataset
          ? button.dataset.filterMember === state.member
          : button.dataset.filter === state.platform && !state.member
      button.setAttribute('aria-pressed', String(pressed))
    }
  }

  for (const button of buttons) {
    button.addEventListener('click', () => {
      if ('filterMember' in button.dataset) {
        state.member =
          state.member === button.dataset.filterMember ? '' : button.dataset.filterMember
      } else {
        state.platform = button.dataset.filter
        state.member = ''
      }
      apply()
    })
  }

  // 個人ページから ?member=slug で来たときは、その人で絞った状態で開く。
  // Apps が0件のメンバーでも Works は絞られるように、カードの有無では判定しない
  const requested = new URLSearchParams(location.search).get('member')
  if (requested) {
    state.member = requested
    apply()
  }
}
