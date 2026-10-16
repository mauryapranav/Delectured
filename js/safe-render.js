export function escapeHTML(str) {
    return String(str ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
}
function inline(text) {
    // Code spans are escaped separately so emphasis never rewrites code.
    return text.split(/(`[^`]+`)/g).map(part => part.startsWith('`') && part.endsWith('`')
        ? `<code>${escapeHTML(part.slice(1,-1))}</code>`
        : escapeHTML(part).replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>').replace(/\*([^*\n]+)\*/g,'<em>$1</em>')).join('');
}
export function renderMarkdown(text) {
    if (!text) return '';
    const lines=text.replace(/\r\n/g,'\n').split('\n'), output=[];
    let paragraph=[], list=[], listTag='', code=null;
    const flushP=()=>{if(paragraph.length)output.push(`<p>${paragraph.map(inline).join('<br>')}</p>`);paragraph=[];};
    const flushL=()=>{if(list.length)output.push(`<${listTag}>${list.map(l=>`<li>${inline(l)}</li>`).join('')}</${listTag}>`);list=[];listTag='';};
    for(const line of lines) {
        if(/^\s*```/.test(line)){flushP();flushL();if(code!==null){output.push(`<pre><code>${escapeHTML(code.join('\n'))}</code></pre>`);code=null;}else code=[];continue;}
        if(code!==null){code.push(line);continue;}
        if(!line.trim()){flushP();flushL();continue;}
        const heading=line.match(/^#{1,6}\s+(.+)/), item=line.match(/^\s*(?:([-*])|\d+\.)\s+(.+)/);
        if(heading){flushP();flushL();output.push(`<h3>${inline(heading[1])}</h3>`);}
        else if(item){flushP();const tag=item[1]?'ul':'ol';if(listTag&&listTag!==tag)flushL();listTag=tag;list.push(item[2]);}
        else {flushL();paragraph.push(line);}
    }
    flushP();flushL();if(code!==null)output.push(`<pre><code>${escapeHTML(code.join('\n'))}</code></pre>`);
    return output.join('\n');
}
