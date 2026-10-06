import {test} from 'node:test';
import assert from 'node:assert/strict';
import {toChunks,SOURCES,resolveQuestion,generateViaServer,clean} from '../admin/ai-core.mjs';
import {resolveChatQuestion} from '../ai-chat.mjs';
const mal=SOURCES.find(s=>s.key==='malsseum'),story=SOURCES[0];
const parts=['처음의 선과 악에 대한 가르침입니다.','중간의 책임과 고난에 대한 가르침입니다.','마지막의 변치 않는 사랑에 대한 결론입니다.'];
const selected=toChunks([{no:73,title:'2026년 10월 4일 주일말씀',paragraphs:parts.map(t=>[t])}],mal);
const unrelated=toChunks([{no:68,title:'인내',paragraphs:[['물에 떠내려가는 생명과 밧줄 이야기입니다.']]}],story).concat(toChunks([{no:40,title:'2026년 6월 14일 주일말씀',paragraphs:[['다른 날짜의 말씀입니다.']]}],mal));
const corpus=selected.concat(unrelated);
test('날짜 지정 표현이 달라도 말씀 한 편 전체만 선택하고 다른 말씀·성령사연 제외',()=>{
 for(const q of ['10월 4일 주일 말씀 전체 하나로 봐줘','10월4일 전체 정리','10월 4일 설교 통째로 정돈해줘','10월 4일 주일말씀에서 고난을 설명해줘']){
  const r=resolveChatQuestion(corpus,q);assert.equal(r.mode,'whole');assert.equal(r.found.length,1);assert.equal(r.found[0].whole,true);assert.equal(r.found[0].text,parts.join('\n\n'));assert.equal(r.found[0].scope,'malsseum');assert.equal(r.found[0].no,73);
 }
});
test('직전 검색이 여섯 문단이었어도 날짜 맥락으로 원래 한 편 전체를 다시 선택',()=>{
 const messages=[{role:'user',content:'10월 4일 주일말씀을 하나로 봐줘'},{role:'assistant',evidence:[selected[1],...unrelated]}];
 for(const q of ['이 말씀 전체 정리해줘','주일 말씀 전체 정리','전체 하나로 정리해줘']){
  const r=resolveChatQuestion(corpus,q,messages);assert.equal(r.mode,'whole');assert.equal(r.found[0].text,parts.join('\n\n'));assert.equal(r.found.length,1);
 }
});
test('원고를 특정할 수 없으면 다른 자료를 섞거나 문단 검색으로 내려가지 않음',()=>{
 assert.throws(()=>resolveChatQuestion(corpus,'주일 말씀 전체 정리'),/날짜/);
 assert.throws(()=>resolveQuestion(corpus,'10월 5일 주일말씀 정리'),/찾지 못/);
 const messages=[{role:'user',content:'고난에 대해'},{role:'assistant',evidence:[selected[1],...unrelated]}];
 assert.throws(()=>resolveChatQuestion(corpus,'이 말씀 전체 정리',messages),/날짜/);
});
test('선택 결과는 서버에 whole=true, 원고 전체 evidence 하나로 한 번만 전송',async()=>{
 const r=resolveChatQuestion(corpus,'10월 4일 주일말씀 전체 정리해줘');let calls=0;
 const doc=r.found[0],p={label:'핵심',text:'원고 전체의 가르침을 연결합니다.',kind:'source',sources:[{id:doc.id,quote:parts[0]}]};
 await generateViaServer({supabaseUrl:'https://test.supabase.co',supabaseAnonKey:'public',aiFunctionName:'clever-action'},'fixture','gemini-lite','10월 4일 주일말씀 전체 정리',r.found,true,async(_url,o)=>{
  calls++;const body=JSON.parse(o.body);assert.equal(body.whole,true);assert.equal(body.evidence.length,1);assert.equal(body.evidence[0].text,parts.join('\n\n'));assert(!body.evidence.some(d=>d.id.startsWith('sayeon')));
  return {ok:true,json:async()=>({answer:{supported:true,overview:[{title:'전체 말씀',points:[p]}],claims:[p]},quota:{}})};
 },undefined,true);assert.equal(calls,1);
});

test('이전 정리 요청의 표현을 새 요약 요청에 섞지 않으며 날짜만 있는 이전 요청도 복구',()=>{
 for(const content of ['10월 4일 주일말씀 정리해줘','10월 4일 전체 정리']){
  const history=[{role:'user',content},{role:'assistant',evidence:[selected[1],...unrelated]}];
  const r=resolveChatQuestion(corpus,'이 말씀 전체 요약해줘',history);assert.equal(r.intent,'summary');assert.equal(r.found[0].text,parts.join('\n\n'));
 }
});
