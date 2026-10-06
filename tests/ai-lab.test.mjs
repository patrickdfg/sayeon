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
test('제거한 Groq 모델은 업체 호출 전에 거절',async()=>{let calls=0;assert(!Object.hasOwn(MODELS,'groq-oss'));await assert.rejects(generate('groq-oss','fixture','정리',documents,async()=>{calls++;}),/허용되지 않은 모델/);assert.equal(calls,0);});
test('429·없는 모델·없는 키를 숨기거나 유료 자동전환하지 않음',async()=>{let calls=0;await assert.rejects(generate('paid-unknown','key','질문',documents,async()=>{calls++;}));assert.equal(calls,0);await assert.rejects(generate('gemini-lite','','질문',documents));await assert.rejects(generate('gemini-lite','key','질문',documents,async()=>({ok:false,status:429})),/무료 한도/);});

test('최신 Gemini 두 모델의 실제 요청 경로와 추론 설정',async()=>{for(const [id,model] of [['gemini-lite','gemini-3.5-flash-lite'],['gemini-flash','gemini-3.8-flash']]){await generate(id,'test-key','인내',documents,async(url,o)=>{assert(url.endsWith('/'+model+':generateContent'));const config=JSON.parse(o.body).generationConfig;assert.equal(config.thinkingConfig.thinkingLevel,'LOW');assert.equal(config.maxOutputTokens,8192);assert.deepEqual(config.responseJsonSchema.properties.overview.items.properties.points.items.required,['label','text','kind','sources']);assert(!('temperature' in config));return {ok:true,json:async()=>({candidates:[{content:{parts:[{text:complete}]}}]})};});}await assert.rejects(generate('gemini-flash','test-key','인내',documents,async()=>({ok:true,json:async()=>({candidates:[{finishReason:'MAX_TOKENS',content:{parts:[{text:complete}]}}]})})),/길이 제한/);});

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
 const x=structuredClone(d);x.overview[0].points=Array(13).fill(x.overview[0].points[0]);
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

test('Gemini 출력이 잘리면 유효한 일부 JSON처럼 보여도 답변 보류',async()=>{await assert.rejects(generate('gemini-lite','fixture','인내',documents,async()=>({ok:true,json:async()=>({candidates:[{finishReason:'MAX_TOKENS',content:{parts:[{text:complete}]}}]})})),/길이 제한/);});

test('Gemini 응답은 항목명·설명·출처가 필수인 schema로 요청',async()=>{
 await generate('gemini-lite','fixture','인내',documents,async(url,o)=>{
  const body=JSON.parse(o.body);
  const schema=body.generationConfig.responseJsonSchema,point=schema.properties.overview.items.properties.points.items;
  assert(point.required.includes('label'));assert(point.required.includes('sources'));assert.equal(point.properties.label.type,'string');assert.deepEqual(point.properties.kind.enum,['source','inference']);assert(point.properties.sources.items.properties.ref.enum.includes('c0_0'));
  const visit=s=>{if(s.type==='object'){assert.equal(s.additionalProperties,false);assert.deepEqual(s.required,Object.keys(s.properties));Object.values(s.properties).forEach(visit);}if(s.items)visit(s.items);if(s.anyOf)s.anyOf.forEach(visit);};visit(schema);
  return {ok:true,json:async()=>({candidates:[{content:{parts:[{text:complete}]}}]})};
 });
});
test('Gemini 응답에도 누락된 항목명·없는 인용은 보류하고 자동 재호출 안 함',async()=>{
 for(const change of [d=>{delete d.overview[0].points[0].label;},d=>{d.overview[0].points[0].sources[0].quote='원고에 없는 가짜 인용입니다.';}]){
  let calls=0;const d=JSON.parse(complete);change(d);
  await assert.rejects(generate('gemini-lite','fixture','인내',documents,async()=>{calls++;return {ok:true,json:async()=>({candidates:[{content:{parts:[{text:JSON.stringify(d)}]}}]})};}));assert.equal(calls,1);
 }
});

test('날짜 요약은 제목으로 한 편을 골라 검색어 없는 마지막 문단까지 보존',async()=>{
 const {resolveQuestion,evidenceBatches}=await import('../admin/ai-core.mjs');
 const data=toChunks([{no:73,title:'10월 4일 주일말씀',paragraphs:[['첫 주제입니다. '.repeat(500)],['중간 내용입니다. '.repeat(500)],['끝의 결론입니다.']]},{no:72,title:'10월 1일 수요말씀',paragraphs:[['10월 4일이라는 검색어가 본문에 나옵니다.']]}],SOURCES[3]);
 const result=resolveQuestion(data,'10월 4일 주일말씀 요약해줘');assert.equal(result.mode,'whole');assert(result.found.every(c=>c.no===73));assert(result.found.at(-1).text.includes('끝의 결론'));
 assert.equal(result.found.length,1);assert.equal(result.found[0].whole,true);
 assert.equal(result.found[0].text,data.filter(c=>c.no===73).map(c=>c.text).join('\n\n'));
 assert.equal(sourceCaption(result.found[0]),'말씀 · 2026년 10월 4일 주일말씀 · 원고 전체');
 assert.throws(()=>resolveQuestion(data,'10월 5일 주일말씀 요약해줘'),/찾지 못/);
 assert.throws(()=>resolveQuestion(data,'10월 4일 주일말씀 요약해줘','stones'),/찾지 못/);
 assert.equal(resolveQuestion(data,'인내에 대해 알려줘').mode,'search');
});
test('동일 날짜 여러 편은 임의 선택하지 않고 연도와 말씀 종류로 구분',async()=>{
 const {resolveQuestion}=await import('../admin/ai-core.mjs');
 const data=toChunks([{no:1,title:'2025년 10월 4일 주일말씀',paragraphs:[['첫 원고입니다.']]},{no:2,title:'2026년 10월 4일 주일말씀',paragraphs:[['둘째 원고입니다.']]}],SOURCES[3]);
 assert.throws(()=>resolveQuestion(data,'10월 4일 주일말씀 정리해줘'),/여러 편/);
 assert.equal(resolveQuestion(data,'2026년 10월 4일 주일말씀 요약해줘').found[0].no,2);
 assert.equal(resolveQuestion(data,'2025년 10월 4일 주일말씀 요약해줘').found[0].no,1);
});

test('전체 상세 정리와 핵심 요약은 다른 지침과 원고 처리 크기를 사용',async()=>{
 const {resolveQuestion,evidenceBatches,wholeRequest}=await import('../admin/ai-core.mjs');
 const data=toChunks([{no:73,title:'10월 4일 주일말씀',paragraphs:Array.from({length:8},(_,i)=>['주제 '+i+' 설명입니다. '.repeat(180)])}],SOURCES[3]);
 const a=resolveQuestion(data,'10월 4일 말씀 정리해줘'),b=resolveQuestion(data,'10월 4일 말씀 요약해줘');
 assert.equal(a.intent,'organize');assert.equal(b.intent,'summary');assert.deepEqual(a.found,b.found);
 assert.equal(a.found.length,1);assert.equal(b.found.length,1);assert(a.found[0].text.length>8000);
 assert.match(wholeRequest(a.title,a.intent,0,2),/비유·사례/);assert.match(wholeRequest(b.title,b.intent,0,2),/반복 표현과 부차적인 사례는 줄이/);
 for(const intent of ['organize','summary'])assert(wholeRequest('가'.repeat(500),intent,0,30).length<=600);
});
test('분량이나 모든 문단의 인용 여부로 요약을 오차단하지 않음',async()=>{
 const {checkWholeCoverage}=await import('../admin/ai-core.mjs');
 const evidence=[{id:'a',text:'첫 주제의 사례와 과정을 설명합니다. '.repeat(80)},{id:'b',text:'후반의 중요한 결론과 실천을 설명합니다. '.repeat(80)}];
 const answer={supported:true,overview:[{points:[{text:'자세한 전개 설명입니다. '.repeat(100),sources:[{id:'a'},{id:'b'}]}]}],claims:[]};
 assert.doesNotThrow(()=>checkWholeCoverage(answer,evidence,'organize'));
 assert.doesNotThrow(()=>checkWholeCoverage({...answer,overview:[{points:[{text:'짧은 두 맥락',sources:[{id:'a'},{id:'b'}]}]}]},evidence,'summary'));
 assert.doesNotThrow(()=>checkWholeCoverage({...answer,overview:[{points:[{text:answer.overview[0].points[0].text,sources:[{id:'a'}]}]}]},evidence,'organize'));assert.throws(()=>checkWholeCoverage({supported:false,overview:[]},evidence,'summary'),/받지 못/);
});

test('인용 스키마는 각 원문의 ID와 실제 구절 선택을 묶음',async()=>{
 const {citationQuotes,answerSchema,prompt}=await import('../admin/ai-core.mjs');
 for(const d of documents){const quotes=citationQuotes(d);assert.equal(!!quotes.length,d.text.trim().length>=8);assert(quotes.every(q=>q.length>=8&&d.text.normalize('NFKC').replace(/\s+/g,' ').trim().includes(q)));}
 const choices=answerSchema(documents).properties.claims.items.properties.sources.items.properties.ref.enum;assert(choices.includes('c0_0'));
 const note={...documents[0],text:'AI가 만든 검토 설명입니다. '+documents[0].text,quotes:[documents[0].text]};
 assert.deepEqual(JSON.parse(prompt('요약',[note])).evidence[0].quoteChoices.map(c=>c.quote),note.quotes.map(q=>q.replace(/\s+/g,' ').trim()));
});

test('인용 ref를 서버 원문의 구절로 복원하고 없는 선택은 차단',async()=>{
 const {resolveCitationRefs,citationChoices}=await import('../admin/ai-core.mjs');
 const choices=citationChoices(documents),d=JSON.parse(complete),ref=choices[0].ref;
 for(const section of d.overview)for(const p of section.points)p.sources=[{ref}];for(const p of d.claims)p.sources=[{ref}];
 const valid=validateAnswer(resolveCitationRefs(JSON.stringify(d),documents),documents,{requireOverview:true});assert.equal(valid.claims[0].sources[0].quote,choices[0].quote);
 d.claims[0].sources=[{ref:'does-not-exist'}];assert.throws(()=>resolveCitationRefs(JSON.stringify(d),documents),/선택값/);
});

test('한 편 전체는 전용 지침과 원문 인용 선택을 사용하며 처음부터 끝까지 한 번만 전송',async()=>{
 const doc={id:'malsseum:39:0',title:'10월 4일 주일말씀',whole:true,text:'처음 주제를 설명하는 원문입니다.\n\n'+('중간 전개와 사례를 설명하는 원문입니다.\n').repeat(300)+'\n마지막 실천과 결론을 설명하는 원문입니다.'};
 const {citationChoices,wholeRequest}=await import('../admin/ai-core.mjs');
 const choice=citationChoices([doc]).at(-1),point={contentId:'r0',label:'전체 흐름',text:'처음의 주제를 마지막 실천과 결론에 연결합니다.',kind:'inference',sources:[{ref:choice.ref}]};
 let calls=0;
 const result=await generate('gemini-lite','fixture-key',wholeRequest(doc.title,'organize'),[doc],async(url,o)=>{
  calls++;const b=JSON.parse(o.body),input=JSON.parse(b.contents[0].parts[0].text);
  assert.equal(b.generationConfig.maxOutputTokens,32768);assert.equal(b.generationConfig.thinkingConfig.thinkingLevel,'HIGH');assert(b.generationConfig.responseJsonSchema.required.includes('fullOrganization'));assert(!b.generationConfig.responseJsonSchema.required.includes('overview'));assert.match(input.question,/요약하지 말고/);assert.match(input.question,/부차적으로/);assert.equal(input.documentMode,'complete_manuscript');assert.equal(input.evidence.length,1);assert.equal(input.evidence[0].text,doc.text);
  assert.match(b.systemInstruction.parts[0].text,/짧은 핵심 요약으로 대체하지/);assert.match(input.readingRule,/마지막 결론/);
  assert.deepEqual(b.generationConfig.responseJsonSchema.properties.claims.items.properties.sources.items.properties.ref.enum,citationChoices([doc]).map(c=>c.ref));
  return {ok:true,json:async()=>({candidates:[{content:{parts:[{text:JSON.stringify({supported:true,fullOrganization:[{title:'원고 종합',points:[point]}],claims:[point]})}]}}]})};
 });
 assert.equal(calls,1);assert.equal(result.answer.overview[0].points[0].sources[0].quote,choice.quote);
});

test('전체 원고의 업체 입력 크기 거절은 분할·재시도·키 노출 없이 안내',async()=>{
 let calls=0;const key='fixture-private-key';
 const doc={id:'malsseum:39:0',whole:true,title:'전체 원고',text:'처음부터 끝까지 한 편으로 읽는 원고입니다.'};
 await assert.rejects(generate('gemini-lite',key,'전체 정리',[doc],async()=>{calls++;return {ok:false,status:413};}),e=>e.message.includes('413')&&e.message.includes('나누거나 줄이지 않았습니다')&&!e.message.includes(key));assert.equal(calls,1);
});

test('성령사연 범위는 두 해를 함께 찾고 출처 연도는 보존',async()=>{
 const {normalizeScope}=await import('../admin/ai-core.mjs');
 const stories=[...toChunks([{no:1,title:'사연',paragraphs:[['감사의 의미를 설명합니다.']]}],SOURCES[0]),...toChunks([{no:2,title:'사연',paragraphs:[['감사의 실천을 설명합니다.']]}],SOURCES[1]),...toChunks([{no:3,title:'말씀',paragraphs:[['감사의 말씀입니다.']]}],SOURCES[3])];
 for(const scope of ['sayeon','sayeon2025','sayeon2026']){const found=retrieve(stories,'감사',scope);assert.equal(found.length,2);assert.deepEqual(new Set(found.map(c=>c.year)),new Set([2025,2026]));assert(found.every(c=>c.scope.startsWith('sayeon')));}
 assert.equal(normalizeScope('sayeon2025'),'sayeon');assert.equal(normalizeScope('all'),'all');
});
test('요약 정리를 함께 요청하면 상세 정리를 우선',async()=>{
 const {resolveQuestion}=await import('../admin/ai-core.mjs');const data=toChunks([{no:39,title:'10월 4일 주일말씀',paragraphs:[['원고 전체를 정리합니다.']]}],SOURCES[3]);assert.equal(resolveQuestion(data,'10월 4일 말씀 전체 요약 정리해줘').intent,'organize');
});

test('전체 상세 정리는 짧은 overview를 대신 받지 않고 전용 본문의 모든 항목을 보존',async()=>{
 const {citationChoices}=await import('../admin/ai-core.mjs');
 const doc={id:'malsseum:39:0',whole:true,title:'긴 검사용 원고',text:'검사용 원고의 설명과 사례를 그대로 보존합니다.\n'.repeat(1000)};
 const point={contentId:'r0',label:'설명',text:'검사용 설명의 배경과 과정, 결과를 모두 본문에 보존합니다. '.repeat(25),kind:'source',sources:[{ref:citationChoices([doc])[0].ref}]};
 const sections=Array.from({length:12},(_,i)=>({title:'논점 '+i,points:[point,point,point]}));
 const response=data=>async()=>({ok:true,json:async()=>({candidates:[{content:{parts:[{text:JSON.stringify(data)}]}}]})});
 await assert.rejects(generate('gemini-lite','fixture','전체 상세 정리',[doc],response({supported:true,overview:sections,claims:[point]})),/상세 본문/);
 const result=await generate('gemini-lite','fixture','전체 상세 정리',[doc],response({supported:true,fullOrganization:sections,claims:[point]}));
 assert.equal(result.answer.overview.length,sections.length);assert.equal(result.answer.overview.reduce((n,s)=>n+s.points.length,0),36);assert.equal(result.answer.overview.at(-1).points.at(-1).text,point.text.trim());
 const connected=await generate('gemini-lite','fixture','전체 상세 정리',[doc],response({supported:true,fullOrganization:[{title:'한 편 전체의 연결된 설명',points:sections.flatMap(s=>s.points)}],claims:[point]}));assert.equal(connected.answer.overview.length,1);assert.equal(connected.answer.overview[0].points.length,36);
 const extended={...point,text:point.text.repeat(4),sources:Array(10).fill(point.sources[0])};const large=await generate('gemini-lite','fixture','전체 상세 정리',[doc],response({supported:true,fullOrganization:[{title:'연결된 상세 설명',points:[extended]}],claims:[point]}));assert.equal(large.answer.overview[0].points[0].text,extended.text.trim());assert.equal(large.answer.overview[0].points[0].sources.length,10);
 const fake={...point,sources:[{ref:'fake'}]};await assert.rejects(generate('gemini-lite','fixture','전체 상세 정리',[doc],response({supported:true,fullOrganization:[{title:'가짜',points:[fake]}],claims:[point]})),/인용/);
});

test('상세 정리는 원고 전체를 한 번 보내고 중간 위치 누락·순서 변경·다른 위치 인용을 차단',async()=>{
 const {readingSpans,citationChoices,clean}=await import('../admin/ai-core.mjs');
 const doc={id:'malsseum:39:0',whole:true,title:'위치 검사용 원고',text:['처음의 논점과 사례를 자세히 설명합니다. '.repeat(8),'중간의 다른 조건과 경과를 자세히 설명합니다. '.repeat(8),'끝의 실천과 결론을 자세히 설명합니다. '.repeat(8)].join('\n\n')};
 const spans=readingSpans(doc),choices=citationChoices([doc]);assert.equal(spans.length,3);assert.equal(spans[0].start,0);assert.equal(spans.at(-1).end,doc.text.length);
 const points=spans.map((s,i)=>({contentId:s.id,label:'논점 '+i,text:'해당 위치의 구체적 설명을 원고 전체의 흐름과 연결합니다.',kind:'source',sources:[{ref:choices.find(c=>clean(doc.text.slice(s.start,s.end)).includes(c.quote)).ref}]}));
 const run=async items=>{let calls=0;const result=await generate('gemini-lite','fixture','전체 상세 정리',[doc],async(url,o)=>{calls++;const input=JSON.parse(JSON.parse(o.body).contents[0].parts[0].text);assert.equal(input.evidence.length,1);assert.equal(input.evidence[0].text,doc.text);assert.deepEqual(input.readingPositions.map(s=>s.id),spans.map(s=>s.id));assert(input.readingPositions.every(s=>!('text' in s)));return {ok:true,json:async()=>({candidates:[{content:{parts:[{text:JSON.stringify({supported:true,fullOrganization:[{title:'한 편의 전체 정리',points:items}],claims:[points[0]]})}]}}]})};});assert.equal(calls,1);return result;};
 assert.equal((await run(points)).answer.overview[0].points.length,3);
 await assert.rejects(run([points[0],points[2]]),/일부 내용을 빠뜨린/);
 await assert.rejects(run([points[1],points[0],points[2]]),/원고 순서/);
 await assert.rejects(run([points[0],{...points[1],sources:points[0].sources},points[2]]),/해당 원문 위치/);
});
