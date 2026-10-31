import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildNoteNetwork,layoutNetwork} from '../js/note-network.js';

test('note links use shared concepts and course membership, not unrelated titles',()=>{
    const notes=[{id:'a',title:'One',analysis:{concepts:[{term:' Vector '},{term:'Vector'}]}},{id:'b',title:'Two',analysis:{concepts:[{term:'vector'}]},courseMemberships:[{id:'math'}]},{id:'c',title:'Three',courseMemberships:[{id:'math'}]},{id:'d',title:'One'}];
    const graph=buildNoteNetwork(notes);
    assert.equal(graph.edges.length,2);
    assert.deepEqual(graph.edges.map(e=>[e.from,e.to]),[['a','b'],['b','c']]);
    assert.equal(graph.edges[0].relation,'Shared concepts: vector');
    assert.equal(graph.edges[1].relation,'Same course');
    assert.equal(notes[0].analysis.concepts.length,2);
});
test('spatial graph stays bounded, deterministic and non-collinear, including isolated nodes',()=>{
    const nodes=Array.from({length:30},(_,i)=>({id:String(i)}));
    const edges=nodes.slice(1).map(n=>({from:'0',to:n.id}));
    const a=layoutNetwork(nodes,edges),b=layoutNetwork(nodes,edges);
    assert.deepEqual(a,b);
    for(const p of a.values()){assert.ok(Number.isFinite(p.x)&&Number.isFinite(p.y));assert.ok(p.x>=90&&p.x<=810&&p.y>=55&&p.y<=465);}
    assert.ok(new Set([...a.values()].map(p=>Math.round(p.y))).size>5);
    assert.equal(layoutNetwork([],[]).size,0);
    assert.doesNotThrow(()=>layoutNetwork(nodes,[{from:'missing',to:'0'}]));
    assert.equal(buildNoteNetwork(Array.from({length:80},(_,id)=>({id}))).nodes.length,60);
});
