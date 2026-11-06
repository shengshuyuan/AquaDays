(() => {
  'use strict';
  const canvas=document.querySelector('#screen');
  const names={home:'鱼缸',select:'选鱼',size:'选择大小',clean:'擦缸'};
  let state, paused=false, heldTimer, held=false, heldKey=null;
  const errors=[];
  window.addEventListener('error',e=>errors.push(e.message));
  window.addEventListener('unhandledrejection',e=>errors.push(String(e.reason)));
  function dayString(date=new Date()) {
    return new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(date);
  }
  function reset() { state=AquaGame.create(dayString()); draw(); }
  function draw() {
    const now=new Date(), actualTime=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Shanghai',hour:'2-digit',minute:'2-digit',hour12:false}).format(now);
    const lighting=document.querySelector('#lighting').value;
    const time=lighting==='auto'?actualTime:lighting;
    const weekday=new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',weekday:'short'}).format(new Date(`${state.day}T12:00:00+08:00`));
    AquaRender.render(canvas,state,{time,date:state.day.replaceAll('-','.'),weekday});
    document.querySelector('#mode-label').textContent=names[state.mode];
    document.querySelector('#live-status').textContent=state.message&&state.age<state.messageUntil
      ?state.message:`${names[state.mode]} · ${state.fish.length}/${AquaGame.MAX_FISH} 位伙伴 · 今日喂食 ${state.fed}/2 · 水质 ${Math.round(state.water)}%`;
  }
  function action(key) { AquaGame.press(state,key); draw(); }
  function startKey(key) {
    if(heldKey) return;
    heldKey=key; held=false;
    if(key!=='ok') action(key);
    else heldTimer=setTimeout(()=>{held=true;action('back');},650);
  }
  function endKey() {
    clearTimeout(heldTimer); if(heldKey==='ok'&&!held) action('ok'); heldKey=null;
  }
  document.querySelectorAll('[data-key]').forEach(button=>{
    button.addEventListener('pointerdown',e=>{e.preventDefault();button.setPointerCapture(e.pointerId);startKey(button.dataset.key);});
    button.addEventListener('pointerup',endKey);
    button.addEventListener('pointercancel',()=>{held=true;endKey();});
    button.addEventListener('click',e=>{if(e.detail===0) action(button.dataset.key);});
  });
  window.addEventListener('keydown',e=>{
    const key={ArrowUp:'up',ArrowDown:'down',Enter:'ok',Escape:'back'}[e.key];
    if(!key||e.target.closest('button,a,input,select,textarea')) return;
    e.preventDefault(); if(e.repeat) return;
    if(key==='back') action(key); else startKey(key);
  });
  window.addEventListener('keyup',e=>{if(['ArrowUp','ArrowDown','Enter'].includes(e.key))endKey();});
  window.addEventListener('blur',()=>{held=true;endKey();});
  document.querySelectorAll('[data-scale]').forEach(button=>button.addEventListener('click',()=>{
    const scale=Number(button.dataset.scale); canvas.style.width=`${240*scale}px`;canvas.style.height=`${320*scale}px`;
    document.querySelectorAll('[data-scale]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));
  }));
  document.querySelector('#lighting').addEventListener('change',draw);
  document.querySelector('#reset').addEventListener('click',reset);
  document.querySelector('#next-day').addEventListener('click',()=>{
    const next=new Date(`${state.day}T12:00:00+08:00`);next.setUTCDate(next.getUTCDate()+1);
    AquaGame.nextDay(state,dayString(next));draw();
  });
  document.querySelector('#pause').addEventListener('click',e=>{
    paused=!paused;e.target.textContent=paused?'继续动画':'暂停动画';e.target.setAttribute('aria-pressed',String(paused));
  });
  reset();
  AquaRender.ready.then(()=>{draw();for(const name of ['home','select','feed','clean']) AquaRender.render(document.querySelector(`#shot-${name}`),AquaRender.scenario(name));}).catch(error=>{errors.push(error.message);document.querySelector('#live-status').textContent=error.message;});
  // shortcut: prototype runs in desktop canvas; ESP32 timing, storage, and display integration remain untested.
  setInterval(()=>{if(!paused&&!document.hidden){AquaGame.nextDay(state,dayString());AquaGame.update(state,1/12);draw();}},1000/12);
  window.AquaPreview={ get state(){return state;}, get errors(){return errors;}, action, draw, reset,
    setPaused(value){paused=value;}, setState(value){state=value;draw();} };
})();
