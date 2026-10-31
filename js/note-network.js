/** Deterministic, bounded graphs. Shared terms indicate overlap, not verified agreement. */
export function buildNoteNetwork(lectures) {
    const notes = lectures.slice(0, 60);
    const terms = notes.map(l => new Set((l.analysis?.concepts || []).map(c => c.term?.normalize('NFKC').toLocaleLowerCase().trim()).filter(Boolean)));
    const nodes = notes.map(l => ({id:l.id,label:l.title || 'Untitled lecture'}));
    const edges = [];
    for (let i=0;i<notes.length;i++) for (let j=i+1;j<notes.length;j++) {
        const shared = [...terms[i]].filter(t=>terms[j].has(t));
        const courses = (notes[i].courseMemberships || []).filter(c=>(notes[j].courseMemberships || []).some(d=>d.id===c.id));
        if (shared.length || courses.length) edges.push({from:notes[i].id,to:notes[j].id,relation:shared.length ? `Shared concepts: ${shared.slice(0,4).join(', ')}` : 'Same course'});
    }
    return {nodes,edges};
}

export function layoutNetwork(nodes, edges, width=900, height=520) {
    const positions = new Map(nodes.map((n,i)=>{const a=i*2.399963;const r=45+Math.sqrt(i)*26;return [n.id,{x:width/2+Math.cos(a)*r,y:height/2+Math.sin(a)*r}];}));
    const links=edges.filter(e=>e.from!==e.to && positions.has(e.from)&&positions.has(e.to));
    for(let step=0;step<180;step++) {
        const forces=new Map(nodes.map(n=>[n.id,{x:0,y:0}]));
        for(let i=0;i<nodes.length;i++) for(let j=i+1;j<nodes.length;j++) {
            const a=positions.get(nodes[i].id),b=positions.get(nodes[j].id),dx=a.x-b.x,dy=a.y-b.y,d=Math.max(18,Math.hypot(dx,dy)),f=12000/(d*d);
            forces.get(nodes[i].id).x+=dx/d*f;forces.get(nodes[i].id).y+=dy/d*f;
            forces.get(nodes[j].id).x-=dx/d*f;forces.get(nodes[j].id).y-=dy/d*f;
        }
        for(const e of links) {
            const a=positions.get(e.from),b=positions.get(e.to),dx=b.x-a.x,dy=b.y-a.y,d=Math.max(1,Math.hypot(dx,dy)),f=(d-210)*.016;
            forces.get(e.from).x+=dx/d*f;forces.get(e.from).y+=dy/d*f;forces.get(e.to).x-=dx/d*f;forces.get(e.to).y-=dy/d*f;
        }
        for(const n of nodes) {const p=positions.get(n.id),f=forces.get(n.id);p.x=Math.max(90,Math.min(width-90,p.x+Math.max(-6,Math.min(6,f.x+(width/2-p.x)*.003))));p.y=Math.max(55,Math.min(height-55,p.y+Math.max(-6,Math.min(6,f.y+(height/2-p.y)*.003))));}
    }
    return positions;
}

const ns='http://www.w3.org/2000/svg';
const svgEl=(tag,attrs={})=>{const e=document.createElementNS(ns,tag);for(const [k,v] of Object.entries(attrs))e.setAttribute(k,String(v));return e;};
export function mountNetwork(host, {nodes,edges}, {onSelect=()=>{},selectedId=null}={}) {
    host.replaceChildren();
    if(!nodes.length){const p=document.createElement('p');p.className='network-empty';p.textContent='Your connections start here. Save lectures with shared concepts to build your map.';host.append(p);return;}
    const positions=layoutNetwork(nodes,edges),svg=svgEl('svg',{viewBox:'0 0 900 520',class:'note-network',role:'group','aria-label':'Connected notes. Select a node to explore it.'});
    const layer=svgEl('g');svg.append(layer);
    for(const e of edges){const a=positions.get(e.from),b=positions.get(e.to);if(!a||!b)continue;const path=svgEl('path',{d:`M ${a.x} ${a.y} Q ${(a.x+b.x)/2+22} ${(a.y+b.y)/2-25} ${b.x} ${b.y}`,class:'network-edge'});const title=svgEl('title');title.textContent=e.relation;path.append(title);layer.append(path);}
    for(const [i,n] of nodes.entries()) {
        const p=positions.get(n.id),g=svgEl('g',{transform:`translate(${p.x} ${p.y})`,class:'network-node',role:'button',tabindex:0,'aria-label':n.label,'aria-pressed':n.id===selectedId});
        g.append(svgEl('circle',{r:26,class:'network-hit'}));
        g.append(svgEl('circle',{r:15+(i%3)*3,class:'network-disc'}),svgEl('circle',{r:5,class:'network-core'}));
        const label=svgEl('text',{y:39,'text-anchor':'middle'});label.textContent=n.label.length>26?n.label.slice(0,24)+'…':n.label;g.append(label);const title=svgEl('title');title.textContent=n.label;g.append(title);
        const choose=()=>{host.querySelectorAll('.network-node').forEach(e=>e.setAttribute('aria-pressed','false'));g.setAttribute('aria-pressed','true');onSelect(n);};g.addEventListener('click',choose);g.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();choose();}});layer.append(g);
    }
    let zoom=1;const controls=document.createElement('div');controls.className='network-controls';
    for(const [label,action] of [['Zoom in',()=>zoom=Math.min(2,zoom+.2)],['Zoom out',()=>zoom=Math.max(.6,zoom-.2)],['Reset view',()=>zoom=1]]) {const b=document.createElement('button');b.type='button';b.textContent=label;b.addEventListener('click',()=>{action();layer.setAttribute('transform',`translate(${450*(1-zoom)} ${260*(1-zoom)}) scale(${zoom})`);});controls.append(b);}
    host.append(svg,controls);
}
