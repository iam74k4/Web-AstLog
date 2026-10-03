/*
  初期描画が済んでから、装飾ごとに CSS animation を開始する小さな補助。
  内容とリンクは SSR のまま。JS 無効・API 未対応では通常の CSS animation が動く。
  同じ時刻を startTime に渡し、奥と手前・回転と打ち消し・60Hz の更新をそろえる。
  最後に root の印を消すと図全体を再計算するので残す。開始し終えたら処理は終わる。
  この文字列だけを CSP の SHA-256 で許可する（ハッシュは headers.test.ts が検査する）。
*/
export const MOTION_START = `(()=>{if(!document.timeline||!Element.prototype.getAnimations||matchMedia('(prefers-reduced-motion: reduce)').matches)return;const root=document.documentElement;root.setAttribute('data-motion-staged','');addEventListener('load',()=>setTimeout(()=>{const q=[];for(const selector of ['.stardust .orbit-spin','.orbit-bodies :is(.orbit-spin,.orbit-unspin,.orbit-body)','.hole__art','.cosmos__nebula'])q.push([...document.querySelectorAll(selector)]);const layers=[...document.querySelectorAll('.orbit-flows')].map(el=>[...el.querySelectorAll('.orbit-flow')]);for(let i=0;i<(layers[0]?.length||0);i++)q.push(layers.map(layer=>layer[i]).filter(Boolean).flatMap(el=>[el,...el.querySelectorAll('.orbit-flow__tail')]));for(const selector of ['.cosmos__twinkle','.cosmos__meteor','.orbit-grain__dot'])q.push([...document.querySelectorAll(selector)]);const clock=document.timeline.currentTime;const next=()=>{if(!root.hasAttribute('data-motion-staged'))return;const unit=q.shift()||[];for(const el of unit)el.setAttribute('data-motion-ready','');for(const el of unit)for(const animation of el.getAnimations())animation.startTime=clock;if(q.length)setTimeout(()=>requestAnimationFrame(next),350)};requestAnimationFrame(next)},1200),{once:true})})();`

export const MOTION_CSP = 'sha256-jje1+5qemlaYHHn4oOzMlZJlgq8EnoyNDMzgUiKktKw='
