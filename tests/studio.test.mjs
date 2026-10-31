import {test} from 'node:test';
import assert from 'node:assert/strict';
import {canvasRotation,initStudyCanvas,normalizePalette,initPalette} from '../js/studio.js';

test('workspace colours persist and synchronize without changing light/dark mode',()=>{
    const previousDocument=globalThis.document,previousListener=globalThis.addEventListener;
    const handlers={};const buttons=['mineral','iris','rose'].map(p=>({dataset:{palette:p},attrs:{},setAttribute(k,v){this.attrs[k]=v;},addEventListener(k,fn){handlers[p]=fn;}}));
    const root={dataset:{theme:'dark'}},values=new Map([['delectured-palette','iris']]);
    globalThis.document={querySelectorAll:()=>buttons};globalThis.addEventListener=(name,fn)=>handlers[name]=fn;
    try {
        initPalette(root,{getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v)});
        assert.equal(root.dataset.palette,'iris');assert.equal(buttons[1].attrs['aria-pressed'],'true');
        handlers.rose();assert.equal(values.get('delectured-palette'),'rose');assert.equal(root.dataset.theme,'dark');
        handlers.storage({key:'delectured-palette',newValue:'mineral'});assert.equal(root.dataset.palette,'mineral');
        assert.equal(normalizePalette('classic'),'mineral');assert.equal(normalizePalette(null),'mineral');
        assert.doesNotThrow(()=>initPalette(root,{getItem(){throw Error();},setItem(){throw Error();}}));
        assert.doesNotThrow(()=>handlers.iris());
    } finally {
        if(previousDocument===undefined)delete globalThis.document;else globalThis.document=previousDocument;
        if(previousListener===undefined)delete globalThis.addEventListener;else globalThis.addEventListener=previousListener;
    }
});

test('canvas rotation is direct, bounded, cancellable and keyboard accessible',()=>{
    const events={},properties={};let captures=0;
    const scene={addEventListener:(name,fn)=>events[name]=fn,style:{setProperty:(name,value)=>properties[name]=value},classList:{add(){},remove(){}},setPointerCapture(){captures++;}};
    const reset={addEventListener:(name,fn)=>events.reset=fn};
    initStudyCanvas(scene,reset);
    assert.equal(properties['--scene-y'],'-12deg');
    events.pointerdown({button:0,isPrimary:true,pointerId:1,clientX:0,clientY:0});
    events.pointermove({pointerId:2,clientX:100,clientY:100});
    assert.equal(properties['--scene-y'],'-12deg');
    events.pointermove({pointerId:1,clientX:1000,clientY:-1000});
    assert.equal(properties['--scene-y'],'28deg');assert.equal(properties['--scene-x'],'20deg');assert.equal(captures,1);
    events.pointercancel();events.pointermove({pointerId:1,clientX:-1000,clientY:1000});
    assert.equal(properties['--scene-y'],'28deg');
    events.keydown({key:'Home',preventDefault(){}});assert.equal(properties['--scene-y'],'-12deg');
    events.keydown({key:'ArrowRight',preventDefault(){}});assert.equal(properties['--scene-y'],'-9deg');
    events.reset();assert.equal(properties['--scene-y'],'-12deg');
    assert.deepEqual(canvasRotation(-999,999),{x:-20,y:28});
    assert.doesNotThrow(()=>initStudyCanvas(null,null));
});

test('scroll sequence clamps before entry and completes before release',async()=>{
    const {studyProgress}=await import('../js/studio.js');
    assert.equal(studyProgress(500,2300,1000),0);
    assert.equal(studyProgress(110,2300,1000),0);
    assert.equal(studyProgress(-540,2300,1000),.5);
    assert.equal(studyProgress(-1190,2300,1000),1);
    assert.equal(studyProgress(-2000,2300,1000),1);
    assert.ok(Number.isFinite(studyProgress(0,500,1000)));
});

test('study story separates notes, exposes connections, then brings recall forward',async()=>{
    const {studyPose}=await import('../js/studio.js');
    assert.deepEqual(studyPose(-1),studyPose(0));
    assert.deepEqual(studyPose(2),studyPose(1));
    assert.equal(studyPose(0).depth,0);
    assert.equal(studyPose(.32).depth,55);
    assert.equal(studyPose(.68).noteShift,-75);
    assert.equal(studyPose(1).turn,0);
    assert.equal(studyPose(1).depth,0);
    assert.equal(studyPose(1).recallRise,-100);
    for(let i=0;i<=100;i++) for(const value of Object.values(studyPose(i/100))) assert.ok(Number.isFinite(value));
});
