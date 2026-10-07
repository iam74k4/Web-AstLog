/*
  初期描画が済んでから、装飾ごとに CSS animation を開始する小さな補助。
  内容とリンクは SSR のまま。JS 無効・API 未対応では通常の CSS animation が動く。
  群ごとの開始時刻を渡し、奥と手前・星屑と天体・回転と打ち消しをそろえる。
  待機中は最初のフレームで止め、過去の時計へ送らない。画像の load 完了も待たない。
  CSS が適用された最初の描画直後に、hero の背景と星を始める。小さい粒だけは1 frameずつ
  始めるが、長い固定待ちを置かない。
  最後に root の印を消すと図全体を再計算するので残す。開始し終えたら処理は終わる。
  この文字列だけを CSP の SHA-256 で許可する（ハッシュは headers.test.ts が検査する）。
*/
export const MOTION_START = `(()=>{if(!document.timeline||!Element.prototype.getAnimations||matchMedia('(prefers-reduced-motion: reduce)').matches)return;const root=document.documentElement;root.setAttribute('data-motion-staged','');addEventListener('DOMContentLoaded',()=>{Promise.all([...document.querySelectorAll('link[rel="stylesheet"]')].map(link=>link.sheet?Promise.resolve():new Promise(resolve=>link.addEventListener('load',resolve,{once:true})))).then(()=>requestAnimationFrame(()=>{const q=[];const add=unit=>{if(unit.length)q.push(unit)};add([...document.querySelectorAll('.stardust .orbit-spin,.orbit-bodies :is(.orbit-spin,.orbit-unspin,.orbit-body),.brand__word .logo-art,.hole__art,.cosmos__nebula,.cosmos__twinkle,.cosmos__meteor,.orbit-grain__dot')]);const layers=[...document.querySelectorAll('.orbit-flows')].map(el=>[...el.querySelectorAll('.orbit-flow')]);for(let i=0;i<(layers[0]?.length||0);i++)add(layers.map(layer=>layer[i]).filter(Boolean).flatMap(el=>[el,...el.querySelectorAll('.orbit-flow__tail')]));const next=()=>{if(!root.hasAttribute('data-motion-staged'))return;const unit=q.shift()||[];const clock=document.timeline.currentTime;for(const el of unit)el.setAttribute('data-motion-ready','');for(const el of unit)for(const animation of el.getAnimations())animation.startTime=clock;if(q.length)requestAnimationFrame(next)};next()}))},{once:true})})();`

export const MOTION_CSP = 'sha256-IpQyQWkI8cN/9jf0WPVVCj8asMNafvnJC1PcWcCR6NQ='
