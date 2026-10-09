import test from 'node:test';
import assert from 'node:assert/strict';
import {allLevels,lessons} from '../coding/curriculum.mjs';
import {initialState,simulate,advance,execute,solved,sameDrawing} from '../coding/engine.mjs';

test('100 distinct challenges, with working reference programs and reachable targets',()=>{
  assert.equal(lessons.length,10);assert.equal(allLevels.length,100);assert.equal(new Set(allLevels.map(l=>l.id)).size,100);
  for(const l of allLevels){
    if(l.mode==='sprite')continue;
    const s=simulate(l,l.reference);assert.ok(solved(l,s,l.reference),l.id);
    assert.ok(!solved(l,initialState(l),[]),`empty program must not pass ${l.id}`);
    if(l.grid){for(const row of l.grid)assert.equal(row.length,l.grid.length);assert.ok(l.grid[l.start[1]][l.start[0]]);assert.ok(l.grid[l.goal[1]][l.goal[0]]);}
    let count=0;function blocks(p){for(const a of p){count++;if(a.body)blocks(a.body);if(a.otherwise)blocks(a.otherwise);}}blocks(l.reference);
    assert.ok(count<=l.maxBlocks,`${l.id} reference exceeds block limit: ${count}/${l.maxBlocks}`);
  }
});
test('all ten sprite challenges can collect every star through directional events',()=>{
  for(const l of allLevels.filter(l=>l.mode==='sprite')){
    let s=initialState(l);
    for(const [x,y]of l.stars){while(s.x!==x)s=advance(l,s,{type:'step',value:s.x<x?0:2});while(s.y!==y)s=advance(l,s,{type:'step',value:s.y<y?1:3});}
    assert.ok(solved(l,s,[{type:'event',value:0,body:[{type:'step',value:0}]}]),l.id);
  }
});
test('wall collisions, conditional branches and until termination',()=>{
  const l=allLevels[0];assert.throws(()=>simulate(l,[{type:'left'},{type:'move'}]),/막혀/);
  assert.equal(simulate(l,[{type:'if',body:[{type:'move'}],otherwise:[]}]).x,2);
  assert.equal(simulate(l,[{type:'left'},{type:'if',body:[{type:'move'}],otherwise:[{type:'right'}]}]).dir,0);
  assert.ok(solved(l,simulate(l,[{type:'until',body:[{type:'move'}]}]),[{type:'until',body:[{type:'move'}]}]));
  assert.throws(()=>simulate(l,[{type:'until',body:[]}]),/到|도착/);
  assert.throws(()=>simulate(l,[{type:'until',body:[{type:'right'}]}]),/반복|도착/);
});
test('drawing compares geometry, rejecting missing or extra lines',()=>{
  const l=allLevels[46],s=simulate(l,l.reference);
  assert.ok(sameDrawing(s.segments,[...s.segments].reverse().map(([x,y,u,v])=>[u,v,x,y])));
  assert.ok(!sameDrawing(s.segments,s.segments.slice(1)));
  assert.ok(!sameDrawing(s.segments,[...s.segments,s.segments[0]]));
  const distorted=s.segments.map(a=>a.map(n=>n+5));assert.ok(!sameDrawing(s.segments,distorted));
});
test('large and deeply nested loops have bounded execution',()=>{
  const l=allLevels[0];let p=[{type:'right'}];for(let i=0;i<10;i++)p=[{type:'repeat',value:50,body:p}];
  assert.throws(()=>simulate(l,p),/오래/);
  for(let i=0;i<15;i++)p=[{type:'repeat',value:1,body:p}];assert.throws(()=>simulate(l,p),/깊/);
});
