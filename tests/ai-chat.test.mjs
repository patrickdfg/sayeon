import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateAnswer} from '../admin/ai-core.mjs';
import {newThread,makeMessage,packResult,unpackResult,pendingConversation,followUpEvidence,followUpQuestion,createChatStore} from '../ai-chat.mjs';

function mockClient(responses){
 const calls=[];
 return {calls,from(table){const call={table,steps:[]};calls.push(call);const request={then(resolve,reject){return Promise.resolve(responses.shift()).then(resolve,reject);}};
  for(const method of ['select','order','range','ilike','insert','update','eq','delete','single','maybeSingle'])request[method]=(...args)=>{call.steps.push([method,...args]);return request;};return request;}};
}
const doc={id:'malsseum:2026:39:whole',title:'10월 4일 주일말씀',text:'처음의 설명과 중간의 교훈입니다. 마지막 결론까지 하나의 원고입니다.',whole:true,url:'/malsseum/#n=39'};
function result(){const statement={label:'전체 흐름',text:'처음부터 결론까지 설명합니다.',kind:'source',sources:[{id:doc.id,quote:'마지막 결론까지 하나의 원고입니다.'}]};return {model:'Gemini 3.5 Flash-Lite',usedBackup:true,attempts:1,wholeTitle:doc.title,wholeIntent:'summary',answer:validateAnswer(JSON.stringify({supported:true,overview:[{title:'전체 요약',points:[statement]}],claims:[statement]}),[doc])};}

test('클라우드 기록은 원고 전체 한 건을 보존하고 인용·문서 저장 구조를 복원한다',()=>{
 const message=makeMessage('assistant','',{result:packResult(result()),evidence:[doc]});
 const restored=unpackResult(JSON.parse(JSON.stringify(message)));
 assert.equal(message.evidence.length,1);assert.equal(message.evidence[0].text,doc.text);
 assert.equal(restored.answer.overview[0].points[0].sources[0].doc.text,doc.text);
 assert.equal(restored.answer.claims[0].sources[0].doc.id,doc.id);assert.equal(restored.usedBackup,true);
 assert.equal(JSON.stringify(message).split(doc.text).length-1,1);
 const bad=structuredClone(message);bad.result.answer.claims[0].sources[0].quote='등록된 원고에 없는 조작 문장입니다.';assert.throws(()=>unpackResult(bad));
});
test('명시적인 후속 질문은 앞선 원문 전체를 이어 읽고 새 날짜·주제는 새로 검색한다',()=>{
 const messages=[makeMessage('user','10월 4일 주일말씀 요약해줘'),makeMessage('assistant','',{evidence:[doc],title:doc.title})];
 const follow=followUpEvidence('이 말씀을 더 자세히 정리해줘',messages);
 assert.equal(follow.mode,'whole');assert.equal(follow.intent,'organize');assert.equal(follow.found[0].text,doc.text);
 assert.equal(followUpEvidence('10월 7일 말씀 요약해줘',messages),null);
 assert.equal(followUpEvidence('감사에 대해 알려줘',messages),null);
 assert.equal(followUpEvidence('이 말씀의 사례가 뭐야?',messages).intent,null);
 assert.equal(followUpQuestion('이걸 더 자세히 알려줘',['첫 주제: 믿음과 실천']).includes('믿음과 실천'),true);
 const long='질문'.repeat(300);assert.equal(followUpQuestion(long,['아주 긴 항목명']),long);
});
test('새 대화 저장은 서버 소유자 기본값을 사용하고 비밀번호·키·JWT를 기록하지 않는다',async()=>{
 const client=mockClient([{data:{id:'thread',revision:0},error:null}]),store=createChatStore(client),thread=newThread(()=> 'thread');
 thread.messages=[makeMessage('user','질문입니다.',{},()=> 'message')];
 await store.save(thread);
 const payload=client.calls[0].steps.find(s=>s[0]==='insert')[1];
 assert.deepEqual(Object.keys(payload).sort(),['id','messages','model_id','scope','title']);
 assert(!JSON.stringify(payload).includes('user_id'));assert(!JSON.stringify(payload).includes('password'));assert(!JSON.stringify(payload).includes('access_token'));
});
test('다른 기기 수정이 있으면 오래된 대화로 덮어쓰지 않는다',async()=>{
 const thread={...newThread(()=> 'thread'),revision:2,messages:[makeMessage('user','현재 질문',{},()=> 'now')]};
 const latest={...thread,revision:3,messages:[makeMessage('user','다른 기기 질문',{},()=> 'other')]};
 const client=mockClient([{data:null,error:null},{data:latest,error:null}]);
 await assert.rejects(createChatStore(client).save(thread),e=>e.conflict===true);
 assert(client.calls[0].steps.some(s=>s[0]==='eq'&&s[1]==='revision'&&s[2]===2));
 assert.equal(client.calls.filter(c=>c.steps.some(s=>s[0]==='update')).length,1);
});
test('저장 응답 유실 후 같은 메시지의 재저장은 JSONB 필드 순서와 무관하게 성공 처리한다',async()=>{
 const thread={...newThread(()=> 'thread'),revision:0,messages:[{id:'a',role:'user',content:'질문'}]};
 const latest={...thread,revision:1,messages:[{content:'질문',role:'user',id:'a'}]};
 const client=mockClient([{data:null,error:null},{data:latest,error:null}]);
 assert.equal((await createChatStore(client).save(thread)).revision,1);
});
test('대화 검색·페이지 구분과 제목 변경·삭제는 지정 대화만 요청한다',async()=>{
 const client=mockClient([{data:[],error:null},{data:{id:'thread',title:'새 제목',revision:2},error:null},{data:null,error:null}]),store=createChatStore(client);
 await store.list(50,'100%_');await store.rename({id:'thread',revision:1},'새 제목');await store.remove('thread');
 assert(client.calls[0].steps.some(s=>s[0]==='range'&&s[1]===50&&s[2]===99));
 assert(client.calls[0].steps.some(s=>s[0]==='ilike'&&s[2]==='%100\\%\\_%'));
 assert(client.calls[1].steps.some(s=>s[0]==='eq'&&s[1]==='revision'&&s[2]===1));
 assert(client.calls[2].steps.some(s=>s[0]==='eq'&&s[1]==='id'&&s[2]==='thread'));
});
test('기록 용량·권한 오류는 원문 오류를 노출하지 않고 저장 실패로 안내한다',async()=>{
 const client=mockClient([{data:null,error:{code:'23514',message:'upstream raw secret'}}]),store=createChatStore(client);
 await assert.rejects(store.save(newThread()),/새 대화/);
 await assert.rejects(createChatStore(mockClient([])).save({...newThread(),messages:Array(121).fill({role:'user'})}),/새 대화/);
});
test('용량 초과·다른 기기 충돌은 저장되지 않은 마지막 질문과 답변만 새 대화로 보존한다',()=>{
 const oldUser={id:'old-user',role:'user',content:'이전 질문'},oldReply={id:'old-reply',role:'assistant',content:'이전 답변'},currentUser={id:'current-user',role:'user',content:'후속 질문'},currentReply={id:'current-reply',role:'assistant',evidence:[doc],result:packResult(result())};
 const original={...newThread(()=> 'old-thread'),messages:[oldUser,oldReply,currentUser,currentReply],revision:5};
 for(const saved of [new Set(['old-user','old-reply']),new Set(['old-user','old-reply','current-user'])]){
  const copy=pendingConversation(original,saved,()=> 'new-thread');assert.equal(copy.id,'new-thread');assert.equal(copy.revision,null);
  assert.deepEqual(copy.messages.map(m=>m.id),['current-user','current-reply']);assert.equal(copy.messages[1].evidence[0].text,doc.text);
 }
 assert.equal(original.messages.length,4);assert.equal(original.revision,5);
});
