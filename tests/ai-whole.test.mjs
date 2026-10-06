import {test} from 'node:test';import assert from 'node:assert/strict';
import {synthesisEvidence,synthesisQuestion,validateSynthesis} from '../ai-whole.mjs';
import {validateAnswer,wholeRequest,evidenceBatches,generate} from '../admin/ai-core.mjs';
const doc={id:'malsseum:73:0',scope:'malsseum',no:73,pi:0,title:'10월 4일 말씀',text:'처음 사랑하고 좋아하던 대로 변치 않고 대하고 살아야 합니다.'};
const source={id:doc.id,quote:doc.text,doc};
const overview=[{title:'첫사랑',points:[{label:'지속',text:'변치 않는 사랑의 중요성을 설명합니다.',kind:'inference',sources:[source]}]}];
test('정리와 통합 지침은 고정 주제·항목·글자 수를 강요하지 않음',()=>{
 for(const q of [wholeRequest(doc.title,'summary',0,1),wholeRequest(doc.title,'organize',0,9),synthesisQuestion(doc.title)]){assert(q.length<=600);assert.match(q,/원고.*길이/);assert.match(q,/자유롭게/);assert(!/약 \d|\d~\d.*(?:글자|주제)|5개/.test(q));}
});
test('원고 핵심이 2개 또는 10개인 답변 모두 인용 검사 후 보존',()=>{
 for(const count of [2,10]){const raw={supported:true,overview:Array.from({length:count},(_,i)=>({...overview[0],title:'주제 '+i})),claims:[overview[0].points[0]]};assert.equal(validateAnswer(JSON.stringify(raw),[doc],{requireOverview:true}).overview.length,count);}
});
test('긴 검토 메모는 전체를 보존하고 서버 입력 크기에 맞춰 분할',()=>{
 const input=Array.from({length:50},(_,i)=>({title:'주제 '+i,points:[{...overview[0].points[0],text:('핵심 '+i+' 설명. ').repeat(25)}]}));
 const notes=synthesisEvidence(input),groups=evidenceBatches(notes,6000);assert(groups.length>1);
 const combined=notes.map(n=>n.text).join('\n');for(let i=0;i<50;i++)assert(combined.includes('주제 '+i));
 assert(groups.every(g=>g.length<=6&&g.reduce((n,d)=>n+d.text.length,0)<=6000));
});
test('통합 인용은 검토 메모가 아닌 실제 원고에서 다시 검증',()=>{
 const notes=synthesisEvidence(overview),point={...overview[0].points[0],sources:[{id:notes[0].id,quote:doc.text}]};
 const good={supported:true,overview:[{title:'통합',points:[point]}],claims:[point]};
 assert.equal(validateSynthesis(good,notes,[doc]).overview[0].points[0].sources[0].doc,doc);
 const fake={...point,sources:[{id:notes[0].id,quote:overview[0].points[0].text}]};
 assert.throws(()=>validateSynthesis({...good,overview:[{title:'통합',points:[fake]}]},notes,[doc]),/원문과 일치/);
});
test('503은 서비스 일시 오류로 표시하고 재호출·키 노출 없음',async()=>{
 let count=0;await assert.rejects(generate('gemini-flash','fixture-key','요약',[doc],async()=>{count++;return {ok:false,status:503};}),/Gemini 3.8 Flash 서비스가 일시적으로.*503/);assert.equal(count,1);
});
