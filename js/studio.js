/** Direct manipulation of the illustrative study canvas; no inference requests. */
export function canvasRotation(x,y) {
    return {x:Math.max(-20,Math.min(20,x)),y:Math.max(-28,Math.min(28,y))};
}
export function initStudyCanvas(scene,reset) {
    if(!scene)return;
    let angle={x:7,y:-12},drag=null;
    const paint=()=>{scene.style.setProperty('--scene-x',`${angle.x}deg`);scene.style.setProperty('--scene-y',`${angle.y}deg`);};
    const finish=()=>{drag=null;scene.classList.remove('is-dragging');};
    scene.addEventListener('pointerdown',e=>{
        if(e.button!==0||!e.isPrimary)return;
        drag={id:e.pointerId,x:e.clientX,y:e.clientY,angle:{...angle}};
        scene.setPointerCapture(e.pointerId);scene.classList.add('is-dragging');
    });
    scene.addEventListener('pointermove',e=>{
        if(!drag||e.pointerId!==drag.id)return;
        angle=canvasRotation(drag.angle.x-(e.clientY-drag.y)*.12,drag.angle.y+(e.clientX-drag.x)*.12);paint();
    });
    scene.addEventListener('pointerup',finish);scene.addEventListener('pointercancel',finish);scene.addEventListener('lostpointercapture',finish);
    scene.addEventListener('keydown',e=>{
        if(!['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Home'].includes(e.key))return;
        e.preventDefault();angle=e.key==='Home'?{x:7,y:-12}:canvasRotation(angle.x+(e.key==='ArrowUp'?-3:e.key==='ArrowDown'?3:0),angle.y+(e.key==='ArrowLeft'?-3:e.key==='ArrowRight'?3:0));paint();
    });
    reset?.addEventListener('click',()=>{angle={x:7,y:-12};paint();});paint();
}
if(typeof document!=='undefined')initStudyCanvas(document.getElementById('study-object'),document.getElementById('reset-scene'));

export const normalizePalette=value=>['mineral','iris','rose'].includes(value)?value:'mineral';
export function initPalette(root=document.documentElement,storage=globalThis.localStorage) {
    const key='delectured-palette';
    const apply=value=>{root.dataset.palette=normalizePalette(value);document.querySelectorAll('button[data-palette]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.palette===root.dataset.palette)));};
    let saved;try{saved=storage.getItem(key);}catch{}apply(saved);
    document.querySelectorAll('button[data-palette]').forEach(button=>button.addEventListener('click',()=>{apply(button.dataset.palette);try{storage.setItem(key,root.dataset.palette);}catch{}}));
    globalThis.addEventListener('storage',e=>{if(e.key===key)apply(e.newValue);});
}
if(typeof document!=='undefined') {
    let storage;try{storage=globalThis.localStorage;}catch{storage={getItem:()=>null,setItem:()=>{}};}
    initPalette(document.documentElement,storage);
    const form=document.querySelector('.workspace-search'),button=form?.querySelector('button'),input=form?.querySelector('input');
    const close=()=>{form?.classList.remove('search-open');button?.setAttribute('aria-expanded','false');};
    button?.addEventListener('click',e=>{if(matchMedia('(max-width:700px)').matches&&!form.classList.contains('search-open')){e.preventDefault();form.classList.add('search-open');button.setAttribute('aria-expanded','true');input.focus();}});
    form?.addEventListener('submit',close);
    input?.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();close();button.focus();}});
    document.addEventListener('click',e=>{if(form&&!form.contains(e.target))close();});
}

/** Scroll transforms live on a parent, so direct manipulation remains independent. */
export function studyProgress(top,height,viewport,pinTop=110) {
    return Math.max(0,Math.min(1,(pinTop-top)/Math.max(1,height-viewport)));
}
export function studyPose(progress) {
    const p=Math.max(0,Math.min(1,progress));
    const smooth=t=>{t=Math.max(0,Math.min(1,t));return t*t*(3-2*t);};
    const open=smooth(p/.32), connect=smooth((p-.32)/.34), recall=smooth((p-.68)/.27);
    return {turn:-16*open+16*recall,lean:-6*open+6*recall,lift:0,
        depth:55*open*(1-recall),noteShift:-75*connect*(1-recall),recallRise:-100*recall};
}
export function initStudyScroll() {
    const track=document.getElementById('study-scroll');
    if(!track)return;
    const reduced=matchMedia('(prefers-reduced-motion: reduce)');
    const compact=matchMedia('(max-width: 700px), (max-height: 720px)');
    const pause=document.getElementById('wave-toggle');
    let paused=false,frame=0,rendered=null,lastTime=0;
    const paint=(time=performance.now())=>{
        frame=0;
        if(!track.getClientRects().length)return;
        const rect=track.getBoundingClientRect();
        const simple=reduced.matches||compact.matches;
        const target=simple?1:studyProgress(rect.top,rect.height,innerHeight);
        const dt=Math.min(64,Math.max(1,time-lastTime||16));lastTime=time;
        rendered=simple||rendered===null?target:rendered+(target-rendered)*(1-Math.exp(-dt/110));
        if(Math.abs(target-rendered)<.0001)rendered=target;
        const p=rendered;
        const pose=studyPose(p);
        track.style.setProperty('--scroll-turn',`${pose.turn}deg`);
        track.style.setProperty('--scroll-lean',`${pose.lean}deg`);
        track.style.setProperty('--scroll-lift',`${pose.lift}px`);
        track.style.setProperty('--layer-depth',`${pose.depth}px`);
        track.style.setProperty('--note-shift',`${pose.noteShift}px`);
        track.style.setProperty('--recall-rise',`${pose.recallRise}px`);
        const lower=document.querySelector('.lower-world');
        if(lower){const offset=reduced.matches?0:Math.max(-100,Math.min(100,(innerHeight-lower.getBoundingClientRect().top)*.08));lower.style.setProperty('--ambient-y',`${offset}px`);}
        track.dataset.stage=p<.32?'notes':p<.68?'evidence':'recall';
        track.classList.toggle('motion-simple',simple);
        track.classList.toggle('wave-running',!paused&&!reduced.matches&&rect.top<innerHeight&&rect.bottom>0&&(simple||p<1));
        if(rendered!==target)frame=requestAnimationFrame(paint);
    };
    const schedule=()=>{if(!frame)frame=requestAnimationFrame(paint);};
    pause?.addEventListener('click',()=>{paused=!paused;pause.setAttribute('aria-pressed',String(paused));pause.textContent=paused?'Play animation':'Pause animation';schedule();});
    addEventListener('scroll',schedule,{passive:true});addEventListener('resize',schedule);
    reduced.addEventListener('change',schedule);compact.addEventListener('change',schedule);
    new ResizeObserver(schedule).observe(track);
    paint();
}
export function initHomeFaq() {
    const reduced=matchMedia('(prefers-reduced-motion: reduce)');
    document.querySelectorAll('.home-faq details').forEach(details=>{
        const summary=details.querySelector('summary');
        const content=document.createElement('div');content.className='faq-answer';
        while(summary.nextSibling)content.append(summary.nextSibling);
        details.append(content);
        let animation=null,target=details.open;
        summary.addEventListener('click',event=>{
            event.preventDefault();target=!target;
            const start=details.getBoundingClientRect().height;
            animation?.cancel();details.open=true;
            const end=target?summary.getBoundingClientRect().height+content.getBoundingClientRect().height:summary.getBoundingClientRect().height;
            if(reduced.matches){details.open=target;return;}
            animation=details.animate({height:[`${start}px`,`${end}px`]}, {duration:260,easing:'cubic-bezier(.22,1,.36,1)'});
            animation.onfinish=()=>{details.open=target;animation=null;};
        });
    });
}
if(typeof document!=='undefined'){initStudyScroll();initHomeFaq();}

if(typeof document!=='undefined'){
    const pauseBackground=document.getElementById('pause-background');
    pauseBackground?.addEventListener('click',()=>{
        const paused=document.body.classList.toggle('ambient-paused');
        pauseBackground.setAttribute('aria-pressed',String(paused));
        pauseBackground.textContent=paused?'Play background motion':'Pause background motion';
    });
}
