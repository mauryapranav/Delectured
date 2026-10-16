// Keep native values/change events for application code; render a themed,
// keyboard-accessible single-select popup instead of the OS blue picker.
const controls = new WeakMap();
let openControl;
function enhance(select) {
    if (controls.has(select) || select.multiple || select.size > 1) return;
    const wrap = document.createElement('span'); wrap.className = 'select-control';
    select.before(wrap); wrap.append(select); select.classList.add('select-native');
    select.tabIndex = -1; select.setAttribute('aria-hidden', 'true');
    const button = document.createElement('button'); button.type = 'button'; button.className = 'select-trigger';
    button.id = select.id + '-choice'; button.setAttribute('role', 'combobox');
    button.setAttribute('aria-haspopup', 'listbox'); button.setAttribute('aria-expanded', 'false');
    const label = select.getAttribute('aria-label') || [...select.labels].map(l=>l.textContent.trim()).join(' ') || 'Choose an option';
    const name = document.createElement('span'); name.className = 'sr-only'; name.id=select.id+'-label';name.textContent=label;
    const value = document.createElement('span'); value.className = 'select-value'; value.id=select.id+'-value';
    button.setAttribute('aria-labelledby',`${name.id} ${value.id}`);
    const arrow = document.createElement('span'); arrow.className = 'select-chevron'; arrow.textContent = '⌄'; arrow.setAttribute('aria-hidden', 'true');
    button.append(name,value, arrow);
    const list = document.createElement('span'); list.className = 'select-options'; list.id = select.id + '-options'; list.hidden = true;
    list.setAttribute('role','listbox'); list.setAttribute('aria-label',label); button.setAttribute('aria-controls',list.id);
    wrap.append(button,list);
    let pending = -1, typed = '', typingTimer;
    function highlight(index) {
        const options=[...select.options];
        if(index<0 || index>=options.length || options[index].disabled)return;
        pending=index;
        [...list.children].forEach((node,i)=>node.classList.toggle('is-active',i===pending));
        const active=list.children[pending];
        if(active) {button.setAttribute('aria-activedescendant',active.id);active.scrollIntoView({block:'nearest',behavior:'instant'});}
    }
    function close() {
        list.hidden=true;button.setAttribute('aria-expanded','false');button.removeAttribute('aria-activedescendant');
        wrap.classList.remove('is-open');if(openControl===control)openControl=null;
        clearTimeout(typingTimer);typed='';
    }
    function show() {
        if(button.disabled)return;openControl?.close();sync();
        openControl=control;list.hidden=false;wrap.classList.add('is-open');button.setAttribute('aria-expanded','true');
        const rect=button.getBoundingClientRect(),below=innerHeight-rect.bottom,above=rect.top;
        const upwards=below<180&&above>below;wrap.classList.toggle('opens-up',upwards);
        list.style.maxHeight=`${Math.max(80,Math.min(260,(upwards?above:below)-18))}px`;
        highlight(select.selectedIndex>=0?select.selectedIndex:0);
    }
    function commit(index) {
        if(!select.options[index]||select.options[index].disabled)return;
        select.selectedIndex=index;close();sync();
        select.dispatchEvent(new Event('input',{bubbles:true}));select.dispatchEvent(new Event('change',{bubbles:true}));
    }
    function sync() {
        value.textContent=select.selectedOptions[0]?.textContent||'Choose an option';button.disabled=select.disabled||!select.options.length;
        list.replaceChildren();[...select.options].forEach((option,i)=>{
            const row=document.createElement('span');row.className='select-option';row.id=`${select.id}-option-${i}`;
            row.setAttribute('role','option');row.setAttribute('aria-selected',String(option.selected));
            if(option.disabled)row.setAttribute('aria-disabled','true');
            row.textContent=option.textContent;row.addEventListener('pointerdown',e=>e.preventDefault());
            row.addEventListener('click',()=>{commit(i);button.focus();});list.append(row);
        });
    }
    const control={close,sync};controls.set(select,control);
    button.addEventListener('click',()=>list.hidden?show():close());
    button.addEventListener('blur',close);
    button.addEventListener('keydown',event=>{
        const options=[...select.options],enabled=options.map((o,i)=>o.disabled?-1:i).filter(i=>i>=0);
        if(event.key==='Escape'&&!list.hidden){event.preventDefault();event.stopPropagation();close();return;}
        if(event.key==='Tab'){close();return;}
        if(['ArrowDown','ArrowUp','Home','End','Enter',' '].includes(event.key)) {
            event.preventDefault();
            if(event.key==='Enter'||event.key===' '){if(list.hidden)show();else commit(pending);return;}
            if(list.hidden){show();if(event.key==='ArrowDown'||event.key==='ArrowUp')return;}
            const position=enabled.indexOf(pending);
            highlight(event.key==='Home'?enabled[0]:event.key==='End'?enabled.at(-1):enabled[Math.max(0,Math.min(enabled.length-1,position+(event.key==='ArrowDown'?1:-1)))]);
        }else if(event.key.length===1&&!event.ctrlKey&&!event.altKey&&!event.metaKey){
            clearTimeout(typingTimer);typed+=event.key.toLocaleLowerCase();typingTimer=setTimeout(()=>typed='',600);
            const match=enabled.find(i=>options[i].textContent.toLocaleLowerCase().startsWith(typed));
            if(match!==undefined){if(list.hidden)commit(match);else highlight(match);}
        }
    });
    for(const labelNode of select.labels)labelNode.addEventListener('click',event=>{event.preventDefault();button.focus();});
    select.addEventListener('change',sync);
    new MutationObserver(sync).observe(select,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:['disabled','selected','label']});
    sync();
}
document.addEventListener('pointerdown',event=>{if(openControl&&!event.target.closest('.select-control'))openControl.close();});
window.addEventListener('resize',()=>openControl?.close());
export function refreshSelects(root=document) {
    for(const select of root.querySelectorAll('select')){enhance(select);controls.get(select)?.sync();}
}
