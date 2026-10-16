import {renderMarkdown} from './safe-render.js';
import {refreshRecent} from './shell.js';
import {refreshSelects} from './select-control.js';
let observer, initialized = false, activeTab = 'notes', currentData;
const el = id => document.getElementById(id);
const make = (tag, text, cls) => {const node=document.createElement(tag); if(text!==undefined)node.textContent=text; if(cls)node.className=cls; return node;};
function markdown(text) {const node=make('div');node.innerHTML=renderMarkdown(text);return node;}
function refs(parent, evidence = []) {
    const details = make('details', undefined, 'evidence-details section-source'); details.append(make('summary','From your lecture'));
    for(const e of evidence) details.append(make('blockquote', e.quote, 'quote'));
    if(evidence.length)parent.append(details);
}
function setTab(name, focus = false) {
    activeTab = name;
    document.querySelectorAll('[data-tab]').forEach(b => {const selected=b.dataset.tab===name;b.setAttribute('aria-selected',String(selected));b.tabIndex=selected?0:-1;if(selected&&focus)b.focus();});
    for(const key of ['notes','transcript','connections','recall']) el(`panel-${key}`).hidden=key!==name;
    document.querySelector('.mobile-contents').hidden=name!=='notes';
    if(name==='connections'&&currentData)renderGraph(currentData,el('concept-select').value);
}
function jump(id) {
    setTab('notes'); const target=el(id); if(!target)return;
    target.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'start'});
    mark(target.closest('.section-block')?.id || id); target.tabIndex=-1; target.focus({preventScroll:true});
}
function mark(id) {
    document.querySelectorAll('[data-section]').forEach(a=>{if(a.dataset.section===id)a.setAttribute('aria-current','location');else a.removeAttribute('aria-current');});
    el('contents-select').value=id;
    refreshSelects(document.querySelector('.mobile-contents'));
}
function init() {
    if(initialized)return;initialized=true;
    const buttons=[...document.querySelectorAll('[data-tab]')];
    buttons.forEach((b,i)=>{b.addEventListener('click',()=>setTab(b.dataset.tab));b.addEventListener('keydown',e=>{
        let next;if(e.key==='ArrowRight')next=(i+1)%buttons.length;if(e.key==='ArrowLeft')next=(i+buttons.length-1)%buttons.length;if(e.key==='Home')next=0;if(e.key==='End')next=buttons.length-1;
        if(next!==undefined){e.preventDefault();setTab(buttons[next].dataset.tab,true);}
    });});
    el('contents-select').addEventListener('change',e=>jump(e.target.value));
    el('concept-select').addEventListener('change',e=>renderGraph(currentData,e.target.value));
    const askToggle = el('mobile-ask-toggle');
    askToggle.addEventListener('click', () => {
        const open = askToggle.getAttribute('aria-expanded') !== 'true';
        askToggle.setAttribute('aria-expanded', String(open));
        if(open) el('lecture-question').focus();
    });
    const exportMenu = el('export-menu');
    document.querySelectorAll('[data-export]').forEach(button => button.addEventListener('click', () => {
        exportMenu.open = false; exportMenu.querySelector('summary').focus(); el(button.dataset.export).click();
    }));
    document.querySelectorAll('[data-report-action]').forEach(button=>button.addEventListener('click',()=>{
        button.closest('details').open=false;el(button.dataset.reportAction).click();
    }));
    document.addEventListener('click', e => {if(!exportMenu.contains(e.target))exportMenu.open=false;});
    exportMenu.addEventListener('keydown', e => {if(e.key==='Escape'){exportMenu.open=false;exportMenu.querySelector('summary').focus();}});
    matchMedia('(max-width: 660px)').addEventListener('change',()=>{if(currentData&&activeTab==='connections')renderGraph(currentData,el('concept-select').value);});
    const opened = [];
    window.addEventListener('beforeprint',()=>{document.querySelectorAll('.folio-page details:not([open])').forEach(d=>{opened.push(d);d.open=true;});});
    window.addEventListener('afterprint',()=>{opened.splice(0).forEach(d=>{d.open=false;});});
}
function navigation(sections) {
    el('topic-timeline').replaceChildren();el('page-contents').replaceChildren();el('contents-select').replaceChildren();
    for(const [id,label] of sections) {
        for(const container of ['topic-timeline','page-contents']) {const a=make('a',label);a.href=`#${id}`;a.dataset.section=id;a.addEventListener('click',e=>{e.preventDefault();jump(id);});el(container).append(a);}
        const option=make('option',label);option.value=id;el('contents-select').append(option);
    }
    observer?.disconnect();
    observer=new IntersectionObserver(()=>{
        if(activeTab!=='notes')return;
        const reached=sections.filter(([id])=>el(id).getBoundingClientRect().top<=innerHeight*.2);
        mark((reached.at(-1)||sections[0])[0]);
    },{rootMargin:'-5% 0px -65% 0px',threshold:0});
    sections.forEach(([id])=>observer.observe(el(id)));mark(sections[0][0]);
}
export function renderResults(data) {
    init();currentData=data;
    for(const key of ['clarity','density','pace'])el(`score-${key}`).textContent=data.scores?.[key]??'--';
    const notes=el('summary-content');notes.replaceChildren();
    const overview=make('section');overview.id='note-overview';overview.append(make('h2','Overview'),markdown(data.summary||'Notes are not ready yet. Your saved transcript is available in the Transcript tab.'));notes.append(overview);
    const sections=[['note-overview','Overview']];
    (data.sections??[]).forEach((s,i)=>{
        const section=make('section',undefined,'note-section');section.id=`note-section-${i}`;
        const label=s.topics?.[0]||`Section ${i+1}`, heading=make('h2');heading.append(make('span',String(i+1),'section-index'),document.createTextNode(label));
        const body=markdown(s.notes);
        const noteLine=[...body.querySelectorAll('p')].find(p=>/^margin note:/i.test(p.textContent));
        const savedNote=noteLine?.textContent.replace(/^margin note:\s*/i,'').trim();
        const explicitNote=savedNote&&savedNote.length<=110?savedNote:undefined;
        if(explicitNote)noteLine.remove();
        const timings=(data.timestamps??[]).filter(t=>t.sourceId===s.id);
        if(timings.length){
            const stamp=seconds=>`${Math.floor(seconds/60).toString().padStart(2,'0')}:${Math.floor(seconds%60).toString().padStart(2,'0')}`;
            heading.append(make('span',`${stamp(Math.min(...timings.map(t=>t.start)))} – ${stamp(Math.max(...timings.map(t=>t.end)))}`,'section-timing'));
        }
        section.append(heading,body);
        if(i===0 || explicitNote) {
            const keyIdea=[...body.querySelectorAll('p')].find(p=>/^key idea:/i.test(p.textContent));
            const text=keyIdea?.textContent.replace(/^key idea:\s*/i,'').trim();
            const firstDefinition=s.concepts?.[0]?.definition?.split(/(?<=[.!?])\s/)[0];
            const excerpt=explicitNote || (text&&text.length<=90?text:firstDefinition&&firstDefinition.length<=90?firstDefinition:label);
            if(excerpt.length<=110) {
                const annotation=make('aside',undefined,`margin-annotation${explicitNote?' explicit-note':''}`);
                const arrow=make('span','↗','annotation-arrow');arrow.setAttribute('aria-hidden','true');annotation.append(arrow,make('span',excerpt));
                if(!explicitNote)annotation.setAttribute('aria-hidden','true');
                else annotation.setAttribute('aria-label','Margin note');
                section.append(annotation);
            }
        }
        refs(section,s.evidence);notes.append(section);sections.push([section.id,label]);
    });
    el('topics-content').replaceChildren();const list=make('ul');(data.topics??[]).forEach(t=>list.append(make('li',t)));el('topics-content').append(list);el('topics-block').hidden=!list.children.length;
    el('concepts-content').replaceChildren();(data.concepts??[]).forEach((c,i)=>{const item=make('div',undefined,'concept-item');item.id=`concept-note-${i}`;item.append(make('h3',c.term,'concept-term'),make('p',c.definition,'concept-def'));el('concepts-content').append(item);});
    el('concepts-block').hidden=!data.concepts?.length;
    if(data.concepts?.length)sections.push(['concepts-block','Concepts, explained']);
    navigation(sections);
    const topic=(data.concepts?.[0]?.term||data.sections?.[0]?.topics?.[0]||'the main idea').slice(0,180);
    const suggestions=el('question-suggestions');suggestions.replaceChildren();
    for(const question of [`Explain ${topic} in simpler terms.`,`Give an example of ${topic} from this lecture.`]) {
        const button=make('button',question);button.type='button';button.addEventListener('click',()=>{
            el('lecture-question').value=question;el('lecture-question').focus();
        });suggestions.append(button);
    }
    el('flashcards-content').replaceChildren();
    (data.flashcards??[]).forEach((f,i)=>{const card=make('section',undefined,'recall-card');const detail=make('details');detail.append(make('summary','Reveal answer'),make('p',f.a));card.append(make('p',`Question ${i+1}`,'eyebrow'),make('h3',f.q),detail);el('flashcards-content').append(card);});
    if(!data.flashcards?.length)el('flashcards-content').append(make('p','No recall cards are saved for this lecture.','quiet'));
    el('analysis-warnings').replaceChildren(...(data.warnings??[]).map(w=>make('p',w)));
    el('timestamps-list').textContent=(data.timestamps??[]).map(t=>`${t.start.toFixed(1)}–${t.end.toFixed(1)} s: ${t.quote}`).join('\n\n')||'No verified timestamps available.';
    el('exam-signals-list').textContent=data.examEvidence?.length?data.examEvidence.map(s=>`${s.label}\n${s.evidence.map(e=>`“${e.quote}”`).join('\n')}`).join('\n\n'):(data.examSignals??[]).join('\n')||'No explicit exam cues were found. Repetition alone is not treated as an exam prediction.';
    el('dna-method').textContent=data.dna?.method||'No measured timing data is available.';el('dna-strip').replaceChildren();
    for(const w of data.dna?.windows??[]) {const item=make('div',undefined,'dna-window');item.append(make('p',`${Math.floor(w.start/60)}–${Math.floor(w.end/60)} min · ${w.coverageSeconds} seconds covered · ${w.concepts.join(', ')||'No concepts linked'}`));const meter=make('meter');meter.min=0;meter.max=w.end-w.start||1;meter.value=w.coverageSeconds;meter.setAttribute('aria-label',`${w.coverageSeconds} seconds of transcript segment coverage`);item.append(meter);el('dna-strip').append(item);}
    const select=el('concept-select');select.replaceChildren();for(const n of data.conceptGraph?.nodes??[]) {const o=make('option',n.label);o.value=n.id;select.append(o);}select.disabled=!select.children.length;
    refreshSelects();
    renderGraph(data,select.value);setTab('notes');
}
function renderGraph(data, selectedId) {
    const graph=el('concept-graph'), detail=el('concept-detail'), list=el('connections-list');graph.replaceChildren();detail.replaceChildren();list.replaceChildren();
    const {nodes=[],edges=[]}=data.conceptGraph??{};if(!nodes.length){graph.append(make('p','No concept connections are saved for this lecture. Its notes are still available.','quiet'));return;}
    const selected=nodes.find(n=>n.id===selectedId)||nodes[0];el('concept-select').value=selected.id;
    refreshSelects(document.querySelector('.graph-picker'));
    const related=edges.filter(e=>e.from===selected.id||e.to===selected.id), ids=new Set(related.flatMap(e=>[e.from,e.to]));ids.delete(selected.id);
    const neighbors=nodes.filter(n=>n.id!==selected.id&&(nodes.length<=7||ids.has(n.id))).slice(0,6), shown=[selected,...neighbors];const labels=new Map(nodes.map(n=>[n.id,n.label]));
    const mobile=matchMedia('(max-width: 660px)').matches, width=mobile?340:700, height=mobile?Math.max(230,140+neighbors.length*110):440;
    const coords=new Map([[selected.id,{x:width/2,y:mobile?45:220}]]);
    neighbors.forEach((n,i)=>{const angle=-Math.PI/2+i*2*Math.PI/Math.max(neighbors.length,1);coords.set(n.id,mobile?{x:width/2+35,y:145+i*110}:{x:350+240*Math.cos(angle),y:220+155*Math.sin(angle)});});
    if(!mobile&&nodes.length<=7)nodes.forEach((n,i)=>{const angle=-Math.PI/2+i*2*Math.PI/nodes.length;coords.set(n.id,{x:350+250*Math.cos(angle),y:220+175*Math.sin(angle)});});
    const ns='http://www.w3.org/2000/svg', svg=document.createElementNS(ns,'svg');svg.setAttribute('viewBox',`0 0 ${width} ${height}`);svg.classList.add('concept-svg');svg.setAttribute('role','group');svg.setAttribute('aria-label','Concept relationships. Select a concept for its explanation.');
    const defs=document.createElementNS(ns,'defs'), marker=document.createElementNS(ns,'marker');marker.id='graph-arrow';marker.setAttribute('viewBox','0 0 10 10');marker.setAttribute('refX','9');marker.setAttribute('refY','5');marker.setAttribute('markerWidth','6');marker.setAttribute('markerHeight','6');marker.setAttribute('orient','auto-start-reverse');const arrow=document.createElementNS(ns,'path');arrow.setAttribute('d','M 0 0 L 10 5 L 0 10 z');arrow.setAttribute('fill','var(--muted)');marker.append(arrow);defs.append(marker);svg.append(defs);
    for(const edge of edges.filter(e=>e.from!==e.to&&coords.has(e.from)&&coords.has(e.to))) {
        const a=coords.get(edge.from),b=coords.get(edge.to), path=document.createElementNS(ns,'path');
        if(mobile){path.setAttribute('d',`M ${a.x-76} ${a.y} C 15 ${a.y},15 ${b.y},${b.x-78} ${b.y}`);}
        else {const dx=b.x-a.x,dy=b.y-a.y,scale=1/Math.max(Math.abs(dx)/86,Math.abs(dy)/33);path.setAttribute('d',`M ${a.x+dx*scale} ${a.y+dy*scale} L ${b.x-dx*scale} ${b.y-dy*scale}`);}
        path.setAttribute('class','edge');path.setAttribute('marker-end','url(#graph-arrow)');const title=document.createElementNS(ns,'title');title.textContent=`${labels.get(edge.from)} — ${edge.relation} → ${labels.get(edge.to)}`;path.append(title);svg.append(path);
        if(!mobile){const label=document.createElementNS(ns,'text');label.setAttribute('x',String((a.x+b.x)/2));label.setAttribute('y',String((a.y+b.y)/2-12));label.setAttribute('text-anchor','middle');label.setAttribute('class','edge-label');label.textContent=edge.relation.length>24?edge.relation.slice(0,22)+'…':edge.relation;svg.append(label);}
    }
    for(const n of shown) {
        const {x,y}=coords.get(n.id),g=document.createElementNS(ns,'g');g.setAttribute('class','node');g.setAttribute('role','button');g.setAttribute('tabindex','0');g.setAttribute('aria-label',n.label);g.setAttribute('aria-pressed',String(n.id===selected.id));
        const rect=document.createElementNS(ns,'rect');for(const [k,v]of Object.entries({x:x-78,y:y-28,width:156,height:56,rx:5}))rect.setAttribute(k,String(v));g.append(rect);
        const text=document.createElementNS(ns,'text');text.setAttribute('text-anchor','middle');const words=n.label.split(/\s+/),lines=[''];for(const word of words){if((lines.at(-1)+' '+word).trim().length>20&&lines.at(-1))lines.push(word);else lines[lines.length-1]=(lines.at(-1)+' '+word).trim();}lines.slice(0,2).forEach((line,i)=>{const t=document.createElementNS(ns,'tspan');t.setAttribute('x',String(x));t.setAttribute('y',String(y+(i-(Math.min(lines.length,2)-1)/2)*17+5));t.textContent=line.length>21?line.slice(0,19)+'…':line+(i===1&&lines.length>2?'…':'');text.append(t);});g.append(text);
        const choose=()=>{renderGraph(data,n.id);(el('concept-select-choice')||el('concept-select')).focus();};g.addEventListener('click',choose);g.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();choose();}});svg.append(g);
    }
    graph.append(svg);if(ids.size>6)graph.append(make('p','Showing six nearby concepts. Select another concept to explore further.','quiet'));
    detail.append(make('h3',selected.label));const concept=data.concepts?.find(c=>c.term===selected.label);detail.append(make('p',concept?.definition||'No separate definition is saved. Use the quoted connections below.'));
    for(const edge of related) {const row=make('div',undefined,'connection-row');row.append(make('p',`${labels.get(edge.from)} — ${edge.relation} → ${labels.get(edge.to)}`));refs(row,edge.evidence);detail.append(row);}
    if(!related.length)detail.append(make('p','No relationships were extracted for this concept.','quiet'));
    const idx=data.concepts?.findIndex(c=>c.term===selected.label);if(idx>=0){const b=make('button','Read related notes');b.addEventListener('click',()=>jump(`concept-note-${idx}`));detail.append(b);}
    // The textual equivalent preserves all relationships, including those outside the local diagram.
    for(const e of edges)list.append(make('p',`${labels.get(e.from)} — ${e.relation} → ${labels.get(e.to)}`,'connection-row'));
}
export function renderLecture(lecture) {
    el('lecture-title').value=lecture.title;el('lecture-heading').textContent=lecture.title;
    el('lecture-date').textContent=new Date(lecture.createdAt).toLocaleDateString(undefined,{day:'numeric',month:'short',year:'numeric'});
    const seconds=Math.floor(lecture.durationMs/1000);el('lecture-duration').textContent=`${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`;
    el('report-state').textContent=lecture.analysisStatus==='ready'?'Saved lecture':'Partial study notes';
    el('lecture-context').textContent=({en:'English',hi:'Hindi','hi-en':'Hinglish'})[lecture.language] || 'Lecture notes';
    el('transcript-content').textContent=lecture.transcript||'No transcript is saved.';
    el('capture-gap-warning').textContent=lecture.captureGaps?.length?'This recording contains a capture gap. Missing audio cannot be reconstructed.':'';
    renderResults(lecture.analysis);refreshRecent(lecture.id);
}
