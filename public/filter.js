/*
  Apps の絞り込み。プラットフォームとメンバーの2軸を同時に効かせる。
  これが動かなくても全件が出たままになるように、初期状態では何も隠さない。
*/
{
  const grid = document.querySelector('#app-grid')
  const buttons = [...document.querySelectorAll('.filters button')]
  const emptyNote = document.querySelector('.filter-empty')

  if (grid && buttons.length) {
    const cards = [...grid.querySelectorAll('.card')]
    const state = { platform: 'all', member: '' }

    const apply = () => {
      let shown = 0
      for (const card of cards) {
        const platformOk =
          state.platform === 'all' || card.dataset.platform === state.platform
        const memberOk = !state.member || card.dataset.member === state.member
        const visible = platformOk && memberOk
        card.hidden = !visible
        if (visible) shown++
      }
      if (emptyNote) emptyNote.hidden = shown > 0

      for (const button of buttons) {
        const isMember = 'filterMember' in button.dataset
        const pressed = isMember
          ? button.dataset.filterMember === state.member
          : button.dataset.filter === state.platform && !state.member
        button.setAttribute('aria-pressed', String(pressed))
      }
    }

    for (const button of buttons) {
      button.addEventListener('click', () => {
        if ('filterMember' in button.dataset) {
          state.member = state.member === button.dataset.filterMember ? '' : button.dataset.filterMember
        } else {
          state.platform = button.dataset.filter
          state.member = ''
        }
        apply()
      })
    }

    // 個人ページから ?member=slug で来たときは、その人で絞った状態で開く
    const requested = new URLSearchParams(location.search).get('member')
    if (requested && cards.some((card) => card.dataset.member === requested)) {
      state.member = requested
      apply()
    }
  }
}
