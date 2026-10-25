import {updatePersonalStudy, getLecture} from './store.js';
import {renderMarkdown} from './safe-render.js';
import {personalSections, quoteOffset, validateAnnotations, validatePersonalNotes} from './personal-notes-data.js';

let dispose = () => {};
let pendingChanges = () => false;
export function hasUnsavedPersonalNotes() {return pendingChanges();}
export function cleanupPersonalNotes() { dispose(); dispose = () => {}; }
const make = (tag, text, cls) => { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (cls) node.className = cls; return node; };
const button = (text, action) => { const node = make('button', text); node.type = 'button'; node.addEventListener('click', action); return node; };

export function mountPersonalNotes(lecture) {
    cleanupPersonalNotes();
    const root = document.getElementById('summary-content');
    if (!root) return;
    const controller = new AbortController(), signal = controller.signal;
    let alive = true, ready = false, busy = false, moving = null, notes = lecture.personalNotes || [], annotations = lecture.annotations || [];
    let dirty=false;
    pendingChanges=()=>alive && (dirty || busy);
    const toolbar = make('div', undefined, 'personal-toolbar personal-controls');
    const status = make('p', 'Personal notes are saved on this device.'); status.setAttribute('role', 'status');
    const editor = make('div', undefined, 'personal-editor personal-controls'); editor.hidden = true;
    editor.addEventListener('input',()=>{dirty=true;},{signal});
    editor.addEventListener('change',()=>{dirty=true;},{signal});
    const closeEditor=()=>{editor.hidden=true;dirty=false;};
    const unplaced = make('section', undefined, 'personal-unplaced');
    const sections = personalSections(lecture.analysis, notes).map((data, index) => {
        const node = document.getElementById(index === 0 ? 'note-overview' : `note-section-${index - 1}`);
        const body = node?.querySelector(':scope > div');
        return {...data, node, body, originalHTML:body?.innerHTML};
    }).filter(section => section.body);
    const controls = [];
    toolbar.append(status); root.prepend(toolbar); root.append(editor, unplaced);
    dispose = () => { alive = false; controller.abort(); root.classList.remove('personal-placement'); toolbar.remove(); editor.remove(); unplaced.remove(); controls.forEach(node => node.remove()); root.querySelectorAll('.personal-annotation,.personal-label').forEach(node => node.remove()); };

    async function save(nextNotes, nextAnnotations) {
        if (!ready || busy || !alive) return false;
        busy = true; toolbar.inert = true; editor.inert = true; status.textContent = 'Saving personal notes…';
        try {
            const result = await updatePersonalStudy(lecture.id, {personalNotes:validatePersonalNotes(nextNotes), annotations:validateAnnotations(nextAnnotations)}, {personalNotes:notes, annotations});
            if (!alive) return false;
            notes = result.personalNotes || []; annotations = result.annotations || [];
            lecture.personalNotes = notes; lecture.annotations = annotations;
            status.textContent = 'Personal notes saved on this device.'; render(); return true;
        } catch (error) { if (alive) status.textContent = `Could not save: ${error.message}. Your draft remains open.`; return false; }
        finally { busy = false; toolbar.inert = false; editor.inert = false; }
    }
    function blocks(section) { return [...section.body.children].filter(node => !node.classList.contains('personal-annotation')); }
    function targetFor(annotation) {
        const section = sections.find(item => item.id === annotation.sectionId);
        if (!section) return null;
        if (!annotation.quote) return {section, target:section.body};
        let occurrence = annotation.occurrence;
        for (const block of blocks(section)) {
            let index = -1;
            while ((index = block.textContent.indexOf(annotation.quote, index + 1)) >= 0) {
                if (occurrence-- === 0) return {section, target:block};
            }
        }
        return null;
    }
    function anchorFor(section, block) {
        const quote = block?.textContent.slice(0, 2000) || '';
        let occurrence = 0;
        for (const previous of blocks(section)) {
            if (previous === block) break;
            let index = -1;
            while (quote && (index = previous.textContent.indexOf(quote, index + 1)) >= 0) occurrence++;
        }
        return {sectionId:section.id, quote, occurrence};
    }
    function startMove(annotation) {
        moving = annotation;
        status.textContent = 'Tap a notes passage to move the arrow there, or choose a passage in Edit / position. Escape cancels.';
        root.classList.add('personal-placement');
    }
    function card(annotation, orphan = false) {
        const aside = make('aside', undefined, 'personal-annotation'); aside.dataset.annotationId = annotation.id;
        aside.append(make('strong', 'Personal annotation — not AI evidence', 'personal-label'));
        if (orphan) aside.append(make('p', 'Original passage is no longer available. Choose Edit / position to reattach it.'));
        const arrow = make('span', annotation.placement === 'after' ? '↑ ' : '↓ ', 'personal-arrow'); arrow.setAttribute('aria-hidden', 'true');
        const writing = make('p', undefined, 'personal-writing'); writing.append(arrow, document.createTextNode(annotation.text)); aside.append(writing);
        if (annotation.quote) aside.append(make('blockquote', annotation.quote, 'personal-anchor-quote'));
        if (ready) {
            const actions = make('div', undefined, 'personal-controls');
            actions.append(button('Edit / position', () => annotationEditor(annotation)), button('Move arrow', () => startMove(annotation)), button('Delete annotation', () => save(notes, annotations.filter(item => item.id !== annotation.id))));
            const drag = button('Drag to passage', () => startMove(annotation)); drag.draggable = true;
            drag.addEventListener('dragstart', event => { moving = annotation; event.dataTransfer.setData('text/plain', annotation.id); event.dataTransfer.effectAllowed = 'move'; });
            actions.append(drag); aside.append(actions);
        }
        return aside;
    }
    function render() {
        root.querySelectorAll('.personal-annotation,.personal-label').forEach(node => node.remove());
        for (const section of sections) {
            const override = notes.find(note => note.sectionId === section.id);
            section.body.innerHTML = override ? renderMarkdown(override.text) : section.originalHTML;
            const studyAnnotation = section.node.querySelector('.study-annotation');
            if (studyAnnotation) studyAnnotation.hidden = Boolean(override);
            if (override) section.body.before(make('p', 'Personal edit — not AI evidence', 'personal-label'));
        }
        unplaced.replaceChildren();
        const missingNotes = notes.filter(note => !sections.some(section => section.id === note.sectionId));
        for (const note of missingNotes) {
            const item = make('div', undefined, 'personal-orphan-note'); item.append(make('h3', `Personal edit: ${note.sectionId}`), make('p', note.text, 'personal-writing'));
            if (ready) item.append(button('Edit personal note', () => noteEditor({id:note.sectionId, label:note.sectionId, generated:''})), button('Delete personal note', () => save(notes.filter(item => item.sectionId !== note.sectionId), annotations)));
            unplaced.append(item);
        }
        for (const annotation of annotations) {
            const resolved = targetFor(annotation), node = card(annotation, !resolved);
            if (!resolved) unplaced.append(node);
            else if (annotation.placement === 'before') resolved.target.before(node);
            else resolved.target.after(node);
        }
        unplaced.hidden = !unplaced.children.length;
        if (!unplaced.hidden) unplaced.prepend(make('h2', 'Unplaced personal notes'), make('p', 'These saved notes remain available after generated content changes.'));
    }
    function openEditor(title) {
        if(dirty && !confirm('Discard your unsaved personal draft?'))return false;
        dirty=false;
        moving = null; root.classList.remove('personal-placement'); editor.replaceChildren(make('h3', title)); editor.hidden = false;
        editor.scrollIntoView({block:'nearest'});
        return true;
    }
    function noteEditor(section) {
        if(!openEditor(`Edit ${section.label}`))return;
        const label = make('label', 'Your version (Markdown supported)'); const input = make('textarea'); input.maxLength = 100000; input.rows = 10;
        input.value = notes.find(note => note.sectionId === section.id)?.text ?? section.generated; label.append(input);
        editor.append(label, make('p', 'This replaces the displayed text. Generated evidence is unchanged; only your latest edit is saved.'), button('Save personal edit', async () => {
            if (await save([...notes.filter(note => note.sectionId !== section.id), {sectionId:section.id, text:input.value}], annotations)) closeEditor();
        }), button('Use generated text', async () => { if (await save(notes.filter(note => note.sectionId !== section.id), annotations)) closeEditor(); }), button('Cancel', () => { closeEditor(); })); input.focus();
    }
    function annotationEditor(existing, initial) {
        if(!openEditor(existing ? 'Edit annotation / position' : 'Add personal annotation'))return;
        const input = make('textarea'); input.maxLength = 10000; input.rows = 3; input.value = existing?.text || '';
        const textLabel = make('label', 'Your typed annotation'); textLabel.append(input);
        const anchors = [], select = make('select'), locationLabel = make('label', 'Anchor passage');
        select.id='personal-anchor';select.setAttribute('aria-label','Anchor passage');
        for (const section of sections) {
            anchors.push({sectionId:section.id, quote:'', occurrence:0}); select.append(make('option', `${section.label} — whole section`));
            for (const block of blocks(section)) { anchors.push(anchorFor(section, block)); select.append(make('option', `${section.label} — ${block.textContent.slice(0, 100)}`)); }
        }
        const anchor = initial || existing;
        if (anchor) {
            let index = anchors.findIndex(item => item.sectionId === anchor.sectionId && item.quote === anchor.quote && item.occurrence === anchor.occurrence);
            if (index < 0) { index = anchors.length; anchors.push({sectionId:anchor.sectionId, quote:anchor.quote, occurrence:anchor.occurrence}); select.append(make('option', `Selected / original passage — ${anchor.quote.slice(0, 100) || anchor.sectionId}`)); }
            select.selectedIndex = index;
        }
        locationLabel.append(select);
        const placement = make('select'), positionLabel = make('label', 'Arrow position');
        placement.id='personal-position';placement.setAttribute('aria-label','Arrow position');
        for (const value of ['after','before']) { const option = make('option', `${value} passage`); option.value = value; placement.append(option); } placement.value = existing?.placement || 'after'; positionLabel.append(placement);
        editor.append(textLabel, locationLabel, positionLabel, button('Save annotation', async () => {
            if (!input.value.trim()) { status.textContent = 'Type your annotation before saving.'; input.focus(); return; }
            const annotation = {...anchors[select.selectedIndex], id:existing?.id || crypto.randomUUID(), text:input.value, placement:placement.value};
            if (await save(notes, [...annotations.filter(item => item.id !== annotation.id), annotation])) closeEditor();
        }), button('Cancel', () => { closeEditor(); })); input.focus();
    }
    function placementTarget(event) {
        const section = sections.find(section => section.body.contains(event.target));
        if (!section || event.target.closest('.personal-annotation')) return null;
        return {section, block:blocks(section).find(block => block.contains(event.target))};
    }
    function selectedAnchor() {
        const selection = window.getSelection();
        if (!selection?.rangeCount || selection.isCollapsed) return null;
        const range = selection.getRangeAt(0), section = sections.find(item => item.body.contains(range.startContainer) && item.body.contains(range.endContainer));
        if (!section) return null;
        const block = blocks(section).find(node => node.contains(range.startContainer) && node.contains(range.endContainer));
        const quote = selection.toString();
        if (!block || !quote.trim() || quote.length > 2000) return null;
        const before = range.cloneRange(); before.selectNodeContents(block); before.setEnd(range.startContainer, range.startOffset);
        const preceding = blocks(section).slice(0, blocks(section).indexOf(block)).map(node => node.textContent).join('\n') + '\n' + before.toString();
        let occurrence = 0;
        while (quoteOffset(preceding, quote, occurrence) >= 0) occurrence++;
        return {sectionId:section.id, quote, occurrence};
    }
    function place(event) {
        const target = placementTarget(event); if (!moving || !target || !ready) return;
        event.preventDefault(); const anchor = anchorFor(target.section, target.block), previous = moving; moving = null; root.classList.remove('personal-placement');
        if (previous.new) annotationEditor(null, anchor);
        else save(notes, annotations.map(item => item.id === previous.id ? {...item, ...anchor} : item));
    }
    root.addEventListener('click', place, {signal});
    root.addEventListener('dragover', event => { if (moving && placementTarget(event)) event.preventDefault(); }, {signal});
    root.addEventListener('drop', place, {signal});
    root.addEventListener('keydown', event => { if (event.key === 'Escape') { moving = null; root.classList.remove('personal-placement'); status.textContent = 'Placement cancelled.'; } }, {signal});
    render();
    // A demo can carry a plausible ID. Enable writes only for a persisted, ready lecture.
    if (lecture.id && lecture.status === 'ready' && lecture.analysisStatus === 'ready') getLecture(lecture.id).then(saved => {
        if (!alive || saved?.status !== 'ready' || saved.analysisStatus !== 'ready') return;
        ready = true;
        toolbar.prepend(button('Add annotation: tap a passage', () => { const anchor = selectedAnchor(); if (anchor) { annotationEditor(null, anchor); return; } moving = {new:true}; root.classList.add('personal-placement'); status.textContent = 'Tap a passage, or use Choose anchor for keyboard placement. Escape cancels.'; }), button('Choose anchor / type annotation', () => annotationEditor()));
        for (const section of sections) { const action = button('Edit section text', () => noteEditor(section)); action.className = 'personal-controls personal-edit-button'; section.node.querySelector('h2').after(action); controls.push(action); }
        render();
    }).catch(() => { if (alive) status.textContent = 'Personal editing is unavailable until saved lecture storage can be opened.'; });
}
