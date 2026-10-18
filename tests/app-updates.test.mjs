import {test} from 'node:test';
import assert from 'node:assert/strict';
import {watchAppUpdates} from '../js/app-updates.js';

test('waiting updates are announced without activating or reloading them',()=>{
    const registration=new EventTarget();
    registration.waiting={postMessage:()=>assert.fail('Must not force activation')};
    let announcements=0;
    watchAppUpdates(registration,{controller:{}},()=>announcements++);
    assert.equal(announcements,1);
});
test('new update is announced when installation finishes; first install stays quiet',()=>{
    const registration=new EventTarget(), serviceWorker={controller:null};
    registration.installing=new EventTarget();
    let announcements=0;
    watchAppUpdates(registration,serviceWorker,()=>announcements++);
    registration.waiting={};
    registration.installing.dispatchEvent(new Event('statechange'));
    assert.equal(announcements,0);
    serviceWorker.controller={};
    registration.installing=new EventTarget();
    registration.waiting=null;
    registration.dispatchEvent(new Event('updatefound'));
    registration.waiting={};
    registration.installing.dispatchEvent(new Event('statechange'));
    assert.equal(announcements,1);
});
