import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeAppearance,initAppearance,APPEARANCE_KEY} from '../js/appearance.js';
import {sectionAnnotation} from '../js/notes-annotations.js';

test('appearance values are allowlisted independently of light/dark', () => {
    assert.equal(normalizeAppearance('modern'),'modern');
    for (const value of ['classic','dark',null,'<script>']) assert.equal(normalizeAppearance(value),'classic');
});
test('annotations reuse substantive material without inventing topic filler', () => {
    assert.equal(sectionAnnotation({topics:['Large Language Models']}),null);
    const s={topics:['Tokens'],concepts:[{definition:'Tokens are the small units that the model processes.'}],flashcards:[{q:'How does tokenization affect the input to a language model?'}]};
    assert.equal(sectionAnnotation(s,0).text,s.concepts[0].definition);
    assert.equal(sectionAnnotation(s,2).label,'Study question');
    assert.equal(sectionAnnotation(s,1),null);
    const used=new Set([s.concepts[0].definition,s.flashcards[0].q]);
    assert.equal(sectionAnnotation(s,0,used),null);
    assert.equal(sectionAnnotation(s,0,new Set(['1','2','3','4','5','6'])),null);
});
test('appearance toggles persist without changing theme and synchronize tabs', () => {
    const previousDocument=globalThis.document, previousListener=globalThis.addEventListener;
    const listeners={},attrs={},root={dataset:{theme:'dark'}};
    const button={setAttribute:(k,v)=>attrs[k]=v,addEventListener:(k,fn)=>listeners[k]=fn};
    const values=new Map([[APPEARANCE_KEY,'modern']]);
    globalThis.document={getElementById:()=>button};
    globalThis.addEventListener=(name,fn)=>listeners[name]=fn;
    try {
        initAppearance(root,{getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v)});
        assert.equal(root.dataset.appearance,'modern');
        listeners.click();
        assert.equal(values.get(APPEARANCE_KEY),'classic');
        assert.equal(attrs['aria-pressed'],'true');
        assert.equal(root.dataset.theme,'dark');
        listeners.storage({key:APPEARANCE_KEY,newValue:'modern'});
        assert.equal(root.dataset.appearance,'modern');
        initAppearance(root,{getItem:()=>{throw Error();},setItem:()=>{throw Error();}});
        assert.doesNotThrow(()=>listeners.click());
        assert.equal(root.dataset.appearance,'modern');
    } finally {
        if(previousDocument===undefined)delete globalThis.document;else globalThis.document=previousDocument;
        if(previousListener===undefined)delete globalThis.addEventListener;else globalThis.addEventListener=previousListener;
    }
});
