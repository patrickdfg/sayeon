import {test} from 'node:test';import assert from 'node:assert/strict';import {toChunks,retrieve,validateAnswer,verifyAdmin,generate,SOURCES,MODELS,sourceCaption} from '../admin/ai-core.mjs';
const documents=toChunks([{no:7,title:'인내의 말씀',paragraphs:[['끝까지 인내하며 믿음을 지켜야 합니다.','포기하지 않고 하나님과 함께 살아갑니다.'],{p:['감사하는 마음으로 하루를 살아갑니다.'],sp:'god'},{hr:true},{h:'본문'}]}],SOURCES[3]);
test('원고 구조, 화자 p, 빈 구분선, 앱 내부 말씀 출처',()=>{assert.equal(documents.length,3);assert(documents[1].text.includes('감사'));assert(documents[0].url.startsWith('/sayeon/malsseum/#'));assert.equal(documents[1].pi,1);});
test('월명동 구조와 연도별 고유 id 보존',()=>{const a=toChunks([{num:'21-4',title:'바위',sections:[{type:'p',text:'하나님께 감사하는 마음입니다.'}]}],SOURCES[2]);assert.equal(a[0].no,'21-4');assert(a[0].url.includes('n=21-4'));const b=toChunks([{no:7,paragraphs:[['인내하며 끝까지 살아갑니다.']]}],SOURCES[1]);assert.notEqual(b[0].id,documents[0].id);assert(b[0].url.includes('y=2025'));});
test('질문 관련 검색과 자료 범위 제한, 무관 질문 보류',()=>{assert(retrieve(documents,'인내에 대해 알려줘').length>0);assert.equal(retrieve(documents,'내일 날씨는 어때?').length,0);assert.equal(retrieve(documents,'인내에 대해 알려줘','stones').length,0);assert.equal(retrieve(documents,'알려줘 설명해줘').length,0);});
const good=JSON.stringify({supported:true,claims:[{text:'자료에서는 인내하며 믿음을 지키라고 설명합니다.',kind:'source',sources:[{id:documents[0].id,quote:'끝까지 인내하며 믿음을 지켜야 합니다.'}]}]});
const complete=JSON.stringify({...JSON.parse(good),overview:[{title:'인내와 감사',points:[{label:'인내의 실천',text:'자료에서는 끝까지 인내하며 믿음을 지키라고 설명합니다. 포기하지 않고 함께 살아가는 태도와 연결해 이해할 수 있습니다.',kind:'inference',sources:[{id:documents[0].id,quote:'끝까지 인내하며 믿음을 지켜야 합니다.'},{id:documents[1].id,quote:'감사하는 마음으로 하루를 살아갑니다.'}]}]}]});
test('실제 연속 인용 검증 및 추론 표시',()=>{assert.equal(validateAnswer(good,documents).claims[0].kind,'source');assert.equal(validateAnswer(good.replace('"kind":"source"','"kind":"inference"'),documents).claims[0].kind,'inference');assert.equal(validateAnswer('{"supported":false,"claims":[]}',documents).supported,false);});
test('없는 출처, 조작 인용, 인용 없는 주장, 잘린 JSON 차단',()=>{assert.throws(()=>validateAnswer(good.replace(documents[0].id,'fake-id'),documents));assert.throws(()=>validateAnswer(good.replace('끝까지 인내하며 믿음을 지켜야 합니다.','없는 내용으로 성공을 보장합니다.'),documents));assert.throws(()=>validateAnswer('{"supported":true,"claims":[{"text":"주장","kind":"source","sources":[]}]}',documents));assert.throws(()=>validateAnswer('{',documents));});
const cfg={enabled:true,supabaseUrl:'https://example.supabase.co',supabaseAnonKey:'public-only'};
test('로그인 없음: 네트워크 전에 차단',async()=>{let calls=0;await assert.rejects(verifyAdmin(cfg,'',async()=>{calls++;}));assert.equal(calls,0);});
test('일반 사용자·만료 토큰·응답 변조 차단',async()=>{await assert.rejects(verifyAdmin(cfg,'nonadmin',async()=>({ok:false,status:403})));await assert.rejects(verifyAdmin(cfg,'expired',async()=>({ok:false,status:401})));await assert.rejects(verifyAdmin(cfg,'fake',async()=>({ok:true,json:async()=>({})})));});
test('허가된 관리자 서버 RPC 확인',async()=>{let request;assert.equal(await verifyAdmin(cfg,'authorized',async(url,options)=>{request={url,options};return {ok:true,json:async()=>({totalVisitors:0})};}),true);assert.equal(request.options.headers.Authorization,'Bearer authorized');assert(request.url.endsWith('/rpc/get_analytics_dashboard'));});
test('Gemini 선택 모델 및 원고만 전송, 도구·웹 검색 없음, 키 URL 노출 없음',async()=>{let request;const result=await generate('gemini-lite','test-key','인내',documents,async(url,options)=>{request={url,options};return {ok:true,json:async()=>({candidates:[{content:{parts:[{text:complete}]}}],usageMetadata:{totalTokenCount:100}})};});const payload=JSON.parse(request.options.body);assert(!request.url.includes('test-key'));assert.equal(request.options.headers['x-goog-api-key'],'test-key');assert(!('tools'in payload));assert(payload.contents[0].parts[0].text.includes(documents[0].id));assert(result.answer.supported);});
test('Groq 경로, JSON 답변과 키 헤더',async()=>{const r=await generate('groq-oss','groq-test','인내',documents,async(url,o)=>{assert.equal(url,'https://api.groq.com/openai/v1/chat/completions');const body=JSON.parse(o.body);assert.equal(body.model,MODELS['groq-oss'].model);assert.equal(body.max_completion_tokens,4096);assert.equal(body.reasoning_effort,'low');assert.equal(body.include_reasoning,false);assert(!('tools'in body));return {ok:true,json:async()=>({choices:[{message:{content:complete}}]})};});assert(r.answer.supported);});
test('429·없는 모델·없는 키를 숨기거나 유료 자동전환하지 않음',async()=>{let calls=0;await assert.rejects(generate('paid-unknown','key','질문',documents,async()=>{calls++;}));assert.equal(calls,0);await assert.rejects(generate('gemini-lite','','질문',documents));await assert.rejects(generate('gemini-lite','key','질문',documents,async()=>({ok:false,status:429})),/무료 한도/);});

test('최신 Gemini 두 모델의 실제 요청 경로와 추론 설정',async()=>{for(const [id,model] of [['gemini-lite','gemini-3.5-flash-lite'],['gemini-flash','gemini-3.8-flash']]){await generate(id,'test-key','인내',documents,async(url,o)=>{assert(url.endsWith('/'+model+':generateContent'));const config=JSON.parse(o.body).generationConfig;assert.equal(config.thinkingConfig.thinkingLevel,'LOW');assert.equal(config.maxOutputTokens,8192);assert(!('temperature' in config));return {ok:true,json:async()=>({candidates:[{content:{parts:[{text:complete}]}}]})};});}await assert.rejects(generate('gemini-flash','test-key','인내',documents,async()=>({ok:true,json:async()=>({candidates:[{finishReason:'MAX_TOKENS',content:{parts:[{text:complete}]}}]})})),/길이 제한/);});

test('Gemini 400 원인은 분류하되 업체 메시지·키·원문은 반환하지 않음',async()=>{
 const cases=[
  [{message:'API key not valid: AIza-secret 원문',details:[{reason:'API_KEY_INVALID'}]},/키가 유효하지/],
  [{message:'Unsupported thinkingLevel LOW: 비공개원문'},/추론 옵션/],
  [{message:'Unsupported responseMimeType: 비공개원문'},/JSON 출력 옵션/],
  [{message:'User location is not supported: 비공개원문'},/서버 지역/],
  [{message:'Unknown invalid input AIza-secret 비공개원문'},/요청 형식/]
 ];
 for(const [error,pattern] of cases){
  await assert.rejects(generate('gemini-lite','key','질문',documents,async()=>({ok:false,status:400,json:async()=>({error})})),e=>{
   assert.match(e.message,pattern);assert.doesNotMatch(e.message,/AIza-secret|비공개원문/);return true;
  });
 }
});

test('주제별 긴 종합 정리와 여러 원문 출처를 함께 검증',()=>{
 const d=validateAnswer(complete,documents,{requireOverview:true});
 assert.equal(d.overview[0].title,'인내와 감사');
 assert.equal(d.overview[0].points[0].sources[1].doc,documents[1]);
 assert.equal(d.overview[0].points[0].kind,'inference');
 assert.throws(()=>validateAnswer(good,documents,{requireOverview:true}),/종합 정리/);
 assert.equal(validateAnswer(good,documents).overview.length,0);
});
test('종합 정리의 조작 인용·출처 없음·초과 항목은 기존 핵심 답변이 맞아도 차단',()=>{
 const d=JSON.parse(complete);
 for(const alter of [
  p=>{p.sources=[{id:'unknown',quote:documents[0].text}];},
  p=>{p.sources=[{id:documents[0].id,quote:'자료에 실제 없는 인용입니다.'}];},
  p=>{p.sources=[];},
  p=>{p.text='x'.repeat(1601);},
  p=>{p.label='';}
 ]){
  const x=structuredClone(d);alter(x.overview[0].points[0]);
  assert.throws(()=>validateAnswer(JSON.stringify(x),documents));
 }
 const x=structuredClone(d);x.overview[0].points=Array(5).fill(x.overview[0].points[0]);
 assert.throws(()=>validateAnswer(JSON.stringify(x),documents));
});
test('AI가 종합 정리를 빼거나 답변이 잘리면 자동 재호출 없이 보류',async()=>{
 let calls=0;
 await assert.rejects(generate('gemini-lite','test-key','인내',documents,async()=>{
  calls++;return {ok:true,json:async()=>({candidates:[{content:{parts:[{text:good}]}}]})};
 }),/종합 정리/);
 assert.equal(calls,1);
});

test('말씀 날짜와 성령사연 편 번호에 자료 연도를 넣고 모든 출처에 문단 유지',()=>{
 const mal=toChunks([{no:1,title:'1월 25일 주일말씀',paragraphs:[['검사용 예시 문단입니다.']]}],SOURCES[3])[0];
 assert.equal(mal.year,2026);assert.equal(sourceCaption(mal),'말씀 · 2026년 1월 25일 주일말씀 · 1번째 문단');
 assert.equal(sourceCaption({...mal,title:'2026년 1월 25일 주일말씀'}),'말씀 · 2026년 1월 25일 주일말씀 · 1번째 문단');
 const story=toChunks([{no:174,title:'성령 사연 174',paragraphs:[['검사용 예시 문단입니다.']]}],SOURCES[1])[0];
 assert.equal(sourceCaption(story),'2025년 성령사연 174번 · 1번째 문단');
 assert.equal(sourceCaption({...story,title:'예시 제목'}),'2025년 성령사연 174번 · 예시 제목 · 1번째 문단');
 assert(story.url.includes('y=2025'));assert(mal.url.startsWith('/sayeon/malsseum/'));
});

test('Groq 출력이 잘리면 유효한 일부 JSON처럼 보여도 답변 보류',async()=>{await assert.rejects(generate('groq-oss','fixture','인내',documents,async()=>({ok:true,json:async()=>({choices:[{finish_reason:'length',message:{content:complete}}]})})),/길이 제한/);});
