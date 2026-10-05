import {test} from 'node:test';import assert from 'node:assert/strict';import {toChunks,retrieve,validateAnswer,verifyAdmin,generate,SOURCES,MODELS} from '../admin/ai-core.mjs';
const documents=toChunks([{no:7,title:'인내의 말씀',paragraphs:[['끝까지 인내하며 믿음을 지켜야 합니다.','포기하지 않고 하나님과 함께 살아갑니다.'],{p:['감사하는 마음으로 하루를 살아갑니다.'],sp:'god'},{hr:true},{h:'본문'}]}],SOURCES[3]);
test('원고 구조, 화자 p, 빈 구분선, 앱 내부 말씀 출처',()=>{assert.equal(documents.length,3);assert(documents[1].text.includes('감사'));assert(documents[0].url.startsWith('/sayeon/malsseum/#'));assert.equal(documents[1].pi,1);});
test('월명동 구조와 연도별 고유 id 보존',()=>{const a=toChunks([{num:'21-4',title:'바위',sections:[{type:'p',text:'하나님께 감사하는 마음입니다.'}]}],SOURCES[2]);assert.equal(a[0].no,'21-4');assert(a[0].url.includes('n=21-4'));const b=toChunks([{no:7,paragraphs:[['인내하며 끝까지 살아갑니다.']]}],SOURCES[1]);assert.notEqual(b[0].id,documents[0].id);assert(b[0].url.includes('y=2025'));});
test('질문 관련 검색과 자료 범위 제한, 무관 질문 보류',()=>{assert(retrieve(documents,'인내에 대해 알려줘').length>0);assert.equal(retrieve(documents,'내일 날씨는 어때?').length,0);assert.equal(retrieve(documents,'인내에 대해 알려줘','stones').length,0);assert.equal(retrieve(documents,'알려줘 설명해줘').length,0);});
const good=JSON.stringify({supported:true,claims:[{text:'자료에서는 인내하며 믿음을 지키라고 설명합니다.',kind:'source',sources:[{id:documents[0].id,quote:'끝까지 인내하며 믿음을 지켜야 합니다.'}]}]});
test('실제 연속 인용 검증 및 추론 표시',()=>{assert.equal(validateAnswer(good,documents).claims[0].kind,'source');assert.equal(validateAnswer(good.replace('"kind":"source"','"kind":"inference"'),documents).claims[0].kind,'inference');assert.equal(validateAnswer('{"supported":false,"claims":[]}',documents).supported,false);});
test('없는 출처, 조작 인용, 인용 없는 주장, 잘린 JSON 차단',()=>{assert.throws(()=>validateAnswer(good.replace(documents[0].id,'fake-id'),documents));assert.throws(()=>validateAnswer(good.replace('끝까지 인내하며 믿음을 지켜야 합니다.','없는 내용으로 성공을 보장합니다.'),documents));assert.throws(()=>validateAnswer('{"supported":true,"claims":[{"text":"주장","kind":"source","sources":[]}]}',documents));assert.throws(()=>validateAnswer('{',documents));});
const cfg={enabled:true,supabaseUrl:'https://example.supabase.co',supabaseAnonKey:'public-only'};
test('로그인 없음: 네트워크 전에 차단',async()=>{let calls=0;await assert.rejects(verifyAdmin(cfg,'',async()=>{calls++;}));assert.equal(calls,0);});
test('일반 사용자·만료 토큰·응답 변조 차단',async()=>{await assert.rejects(verifyAdmin(cfg,'nonadmin',async()=>({ok:false,status:403})));await assert.rejects(verifyAdmin(cfg,'expired',async()=>({ok:false,status:401})));await assert.rejects(verifyAdmin(cfg,'fake',async()=>({ok:true,json:async()=>({})})));});
test('허가된 관리자 서버 RPC 확인',async()=>{let request;assert.equal(await verifyAdmin(cfg,'authorized',async(url,options)=>{request={url,options};return {ok:true,json:async()=>({totalVisitors:0})};}),true);assert.equal(request.options.headers.Authorization,'Bearer authorized');assert(request.url.endsWith('/rpc/get_analytics_dashboard'));});
test('Gemini 선택 모델 및 원고만 전송, 도구·웹 검색 없음, 키 URL 노출 없음',async()=>{let request;const result=await generate('gemini-lite','test-key','인내',documents,async(url,options)=>{request={url,options};return {ok:true,json:async()=>({candidates:[{content:{parts:[{text:good}]}}],usageMetadata:{totalTokenCount:100}})};});const payload=JSON.parse(request.options.body);assert(!request.url.includes('test-key'));assert.equal(request.options.headers['x-goog-api-key'],'test-key');assert(!('tools'in payload));assert(payload.contents[0].parts[0].text.includes(documents[0].id));assert(result.answer.supported);});
test('Groq 경로, JSON 답변과 키 헤더',async()=>{const r=await generate('groq-oss','groq-test','인내',documents,async(url,o)=>{assert.equal(url,'https://api.groq.com/openai/v1/chat/completions');const body=JSON.parse(o.body);assert.equal(body.model,MODELS['groq-oss'].model);assert(!('tools'in body));return {ok:true,json:async()=>({choices:[{message:{content:good}}]})};});assert(r.answer.supported);});
test('429·없는 모델·없는 키를 숨기거나 유료 자동전환하지 않음',async()=>{let calls=0;await assert.rejects(generate('paid-unknown','key','질문',documents,async()=>{calls++;}));assert.equal(calls,0);await assert.rejects(generate('gemini-lite','','질문',documents));await assert.rejects(generate('gemini-lite','key','질문',documents,async()=>({ok:false,status:429})),/무료 한도/);});

test('최신 Gemini 두 모델의 실제 요청 경로와 추론 설정',async()=>{for(const [id,model] of [['gemini-lite','gemini-3.5-flash-lite'],['gemini-flash','gemini-3.8-flash']]){await generate(id,'test-key','인내',documents,async(url,o)=>{assert(url.endsWith('/'+model+':generateContent'));const config=JSON.parse(o.body).generationConfig;assert.equal(config.thinkingConfig.thinkingLevel,'LOW');assert.equal(config.maxOutputTokens,4096);assert(!('temperature' in config));return {ok:true,json:async()=>({candidates:[{content:{parts:[{text:good}]}}]})};});}await assert.rejects(generate('gemini-flash','test-key','인내',documents,async()=>({ok:true,json:async()=>({candidates:[{finishReason:'MAX_TOKENS',content:{parts:[{text:good}]}}]})})),/길이 제한/);});

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
