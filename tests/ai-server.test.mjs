import {test} from 'node:test';import assert from 'node:assert/strict';
import {createHandler} from '../supabase/functions/admin-ai/handler.mjs';
import {generateViaServer,requestServer} from '../admin/ai-core.mjs';
const approvedFetch=fetcher=>async(url,o)=>url.endsWith('/ai_chat_membership')?new Response(JSON.stringify({approved:true,status:'approved',isAdmin:false})):fetcher(url,o);
const secret='server-test-secret-never-return',config={supabaseUrl:'https://maoylwwnluyyfmwqfkfl.supabase.co',supabaseAnonKey:'public'};
const evidence=[{id:'malsseum:7:0',title:'인내',text:'끝까지 인내하며 믿음을 지켜야 합니다.',label:'말씀',pi:0,url:'/sayeon/malsseum/#n=7'}];
const answer={supported:true,claims:[{text:'인내하며 믿음을 지키라고 설명합니다.',kind:'source',sources:[{id:evidence[0].id,quote:evidence[0].text}]}]};
answer.overview=[{title:'인내의 의미',points:[{label:'믿음과 실천',text:'자료는 인내하며 믿음을 지키라고 설명합니다. 이 태도를 일상의 실천과 연결해 정리합니다.',kind:'inference',sources:answer.claims[0].sources}]}];
const payload={action:'generate',modelId:'gemini-lite',question:'인내를 알려줘',evidence,freeOnly:true};
test('긴 한글 원고 전체를 하나의 근거로 한 번만 전송하고 처음·중간·끝 보존',async()=>{
 const full={...evidence[0],whole:true,text:'처음의 핵심 내용입니다.\n\n'+evidence[0].text+'\n'+('중간의 전개와 사례를 설명합니다.\n').repeat(1600)+'\n끝의 결론을 정리합니다.'};
 const s=setup();
 const result=await generateViaServer(config,'user-token','gemini-lite','전체 원고 요약', [full],true,async(url,o)=>s.handler(new Request(url,{method:o.method,headers:o.headers,body:o.body})),undefined,true);
 const upstream=s.calls.filter(c=>c.url.includes('googleapis'));assert.equal(upstream.length,1);
 const input=JSON.parse(JSON.parse(upstream[0].o.body).contents[0].parts[0].text);
 assert.equal(input.evidence.length,1);assert.equal(input.evidence[0].text,full.text);
 assert(input.evidence[0].quoteChoices.some(c=>c.quote==='처음의 핵심 내용입니다.'));
 assert(input.evidence[0].quoteChoices.some(c=>c.quote==='끝의 결론을 정리합니다.'));
 assert.equal(result.answer.claims[0].sources[0].doc,full);
});
test('전체 요청의 여러 원고·초과 길이·잘못된 플래그는 예약과 AI 호출 전 거부',async()=>{
 for(const body of [{...payload,whole:true,evidence:[...evidence,...evidence]}, {...payload,whole:true,evidence:[{...evidence[0],text:'가'.repeat(80001)}]}, {...payload,whole:'true'}]){
  const s=setup();assert.equal((await s.handler(req(body))).status,400);
  assert(!s.calls.some(c=>c.url.endsWith('/ai_lab_model_quota')||c.url.includes('googleapis')));
 }
 let calls=0;await assert.rejects(generateViaServer(config,'user-token','gemini-lite','전체',[{...evidence[0],text:'가'.repeat(80001)}],true,async()=>{calls++;},undefined,true),/자르거나 나누지/);assert.equal(calls,0);
});
function setup({admin=true,quota=true,key=true,upstream=200}={}){const calls=[];const env=name=>name==='GEMINI_API_KEY'&&key?secret:null;const fetcher=async(url,o)=>{calls.push({url,o});if(url.endsWith('/ai_chat_membership'))return new Response(JSON.stringify({approved:admin,status:admin?'approved':'pending',isAdmin:false}));if(url.endsWith('/ai_lab_model_quota'))return new Response(JSON.stringify({allowed:quota,used:1,remaining:29,reason:quota?'':'daily'}));if(url.includes('generativelanguage.googleapis.com'))return new Response(JSON.stringify({candidates:[{content:{parts:[{text:JSON.stringify(answer)}]}}]}),{status:upstream});throw new Error('Unexpected request');};return {handler:createHandler({env,fetcher}),calls};}
function req(body=payload,{auth=true,origin='https://patrickdfg.github.io'}={}){return new Request('https://example/functions/v1/admin-ai',{method:'POST',headers:{Origin:origin,...(auth?{Authorization:'Bearer user-token'}:{}),'Content-Type':'application/json'},body:JSON.stringify(body)});}
test('미로그인·다른 출처·비관리자 요청이 AI 호출 전에 차단됨',async()=>{for(const [options,settings,code] of [[{auth:false},{},401],[{origin:'https://evil.example'},{},403],[{},{admin:false},403]]){const s=setup(settings);assert.equal((await s.handler(req(payload,options))).status,code);assert(!s.calls.some(x=>x.url.includes('googleapis')));}});
test('서버 키는 업체 헤더에서만 사용, 응답·요청 본문에는 없음',async()=>{const s=setup();const r=await s.handler(req());const raw=await r.text();assert.equal(r.status,200);assert(!raw.includes(secret));const call=s.calls.find(x=>x.url.includes('googleapis'));assert.equal(call.o.headers['x-goog-api-key'],secret);assert(!call.url.includes(secret));assert(!call.o.body.includes(secret));assert.equal(JSON.parse(raw).answer.claims[0].sources[0].doc,undefined);assert.equal(JSON.parse(s.calls.find(x=>x.url.endsWith('/ai_lab_model_quota')).o.body).p_reserve,true);});
test('키 미등록·서버 하루 한도·무료 확인 누락 시 업체 호출 없음',async()=>{for(const [settings,body,code] of [[{key:false},payload,503],[{quota:false},payload,429],[{}, {...payload,freeOnly:false},400]]){const s=setup(settings);assert.equal((await s.handler(req(body))).status,code);assert(!s.calls.some(x=>x.url.includes('googleapis')));}});
test('모델 변조·임의 원문 ID·큰 근거·중복 ID·클라이언트 키 차단',async()=>{for(const body of [{...payload,modelId:'constructor'},{...payload,evidence:[{...evidence[0],id:'upload:1:0'}]},{...payload,evidence:[{...evidence[0],text:'x'.repeat(1801)}]},{...payload,evidence:[...evidence,...evidence]},{...payload,key:'client-key'}]){const s=setup();assert.equal((await s.handler(req(body))).status,400);assert(!s.calls.some(x=>x.url.endsWith('/ai_lab_model_quota')||x.url.includes('googleapis')));}});
test('상태 확인은 키 값 없이 사용 가능한 모델만, 호출 한도 예약 없음',async()=>{const s=setup();const r=await s.handler(req({action:'status'}));const d=await r.json();assert.equal(d.ready,true);assert.deepEqual(d.models,['gemini-lite','gemini-flash']);assert(!JSON.stringify(d).includes(secret));assert.equal(JSON.parse(s.calls.find(x=>x.url.endsWith('/ai_lab_model_quota')).o.body).p_reserve,false);});
test('업체 무료 한도 오류를 서버에서 429로 전달',async()=>{const s=setup({upstream:429});const r=await s.handler(req());assert.equal(r.status,429);assert.match((await r.json()).error,/무료 한도/);});
test('브라우저는 사용자 토큰과 근거만 서버로 전달, 응답 인용 다시 검증',async()=>{const result=await generateViaServer(config,'user-token','gemini-lite','인내',evidence,true,async(url,o)=>{assert(url.endsWith('/functions/v1/admin-ai'));assert.equal(o.headers.Authorization,'Bearer user-token');const b=JSON.parse(o.body);assert.deepEqual(b.evidence,[{id:evidence[0].id,title:'인내',text:evidence[0].text}]);assert(!('key' in b));return new Response(JSON.stringify({answer,quota:{used:1,remaining:29}}));});assert.equal(result.answer.claims[0].sources[0].doc.url,evidence[0].url);await assert.rejects(generateViaServer(config,'user-token','gemini-lite','인내',evidence,true,async()=>new Response(JSON.stringify({answer:{...answer,claims:[{...answer.claims[0],sources:[{id:'fake',quote:evidence[0].text}]}]}}))),/없는 인용/);});

test('기존 clever-action 함수로 연결 및 잘못된 함수 경로 차단',async()=>{let calls=0;const c={...config,aiFunctionName:'clever-action'};await requestServer(c,'user-token',{action:'status'},async(url)=>{calls++;assert.equal(url,config.supabaseUrl+'/functions/v1/clever-action');return new Response('{"ready":true}');});assert.equal(calls,1);await assert.rejects(requestServer({...c,aiFunctionName:'../other'},'user-token',{action:'status'},async()=>{calls++;}),/함수 이름/);assert.equal(calls,1);});

test('서버 종합 정리가 브라우저까지 전달되고 모든 항목의 인용을 다시 검증',async()=>{
 const s=setup();const response=await s.handler(req());assert.equal(response.status,200);
 const raw=await response.text(),d=JSON.parse(raw);
 assert.equal(d.answer.overview[0].title,'인내의 의미');
 assert(!raw.includes('"doc"'));assert(!raw.includes(secret));
 const result=await generateViaServer(config,'user-token','gemini-lite','인내',evidence,true,async()=>new Response(raw));
 assert.equal(result.answer.overview[0].points[0].sources[0].doc.url,evidence[0].url);
 const changed=structuredClone(d);changed.answer.overview[0].points[0].sources[0].quote='원문에 없는 인용입니다.';
 await assert.rejects(generateViaServer(config,'user-token','gemini-lite','인내',evidence,true,async()=>new Response(JSON.stringify(changed))),/없는 인용/);
});

const clientId='12345678-1234-4123-8123-123456789abc',fixturePassword='fixture-pass',serviceSecret='fixture-service-role-secret';
function sharedSetup({password=fixturePassword,service=serviceSecret,quota=true}={}){
 const base=setup({quota});const env=name=>({AI_LAB_PASSWORD:password,SUPABASE_SERVICE_ROLE_KEY:service,GEMINI_API_KEY:secret})[name];
 const fetcher=async(url,o)=>{if(url.endsWith('/ai_lab_model_quota')){base.calls.push({url,o});return new Response(JSON.stringify({allowed:quota,used:1,remaining:29,reason:quota?'':'daily'}));}if(url.endsWith('/get_analytics_dashboard'))throw new Error('public request must not use admin RPC');base.calls.push({url,o});return new Response(JSON.stringify({candidates:[{content:{parts:[{text:JSON.stringify(answer)}]}}]}));};
 return {handler:createHandler({env,fetcher:approvedFetch(fetcher)}),calls:base.calls};
}
function sharedReq(body=payload,{password=fixturePassword,client=clientId}={}){return new Request('https://example/functions/v1/clever-action',{method:'POST',headers:{Origin:'https://patrickdfg.github.io',Authorization:'Bearer user-token','X-AI-Password':password,'X-AI-Client':client,'Content-Type':'application/json'},body:JSON.stringify(body)});}

function backupSetup({primaryStatus=401,reason,backupStatus=200,secondQuota=true,primary='fixture-primary-key',backup='fixture-backup-key',abortWait=false}={}){
 const events=[],calls=[];let reserved=0;
 const env=n=>({GEMINI_API_KEY:primary,GEMINI_API_KEY_BACKUP:backup,AI_LAB_PASSWORD:fixturePassword,SUPABASE_SERVICE_ROLE_KEY:serviceSecret})[n];
 const fetcher=async(url,o)=>{
  calls.push({url,o});
  if(url.endsWith('/ai_lab_model_quota')){const b=JSON.parse(o.body);events.push(b.p_reserve?'reserve':'status');if(b.p_reserve)reserved++;return new Response(JSON.stringify({allowed:reserved<2||secondQuota,used:reserved,remaining:30-reserved,reason:reserved>=2&&!secondQuota?'daily':''}));}
  if(o.method!=='POST')return new Response(JSON.stringify({name:'models/gemini-3.5-flash-lite',supportedGenerationMethods:['generateContent'],private:backup}),{status:backupStatus});
  const isBackup=o.headers['x-goog-api-key']===backup&&backup!==primary;events.push(isBackup?'backup':'primary');
  const status=isBackup?backupStatus:primaryStatus;
  return new Response(JSON.stringify(status===200?{candidates:[{content:{parts:[{text:JSON.stringify(answer)}]}}]}:{error:{message:'private provider body '+primary+' '+backup,details:reason?[{reason}]:[]}}),{status});
 };
 const waitForBackup=async signal=>{events.push('wait');assert.equal(signal.aborted,false);if(abortWait)throw new DOMException('Aborted','AbortError');};
 return {handler:createHandler({env,fetcher:approvedFetch(fetcher),waitForBackup}),events,calls};
}

test('Gemini 키 인증 오류는 간격 대기·별도 한도 예약 뒤 보조키로 한 번만 전환',async()=>{
 for(const [primaryStatus,reason] of [[401,undefined],[400,'API_KEY_INVALID'],[400,'API_KEY_SERVICE_BLOCKED'],[403,'API_KEY_SERVICE_BLOCKED']]){
  const s=backupSetup({primaryStatus,reason}),r=await s.handler(sharedReq());assert.equal(r.status,200);const raw=await r.text(),d=JSON.parse(raw);
  assert.deepEqual(s.events,['reserve','primary','wait','reserve','backup']);assert.equal(d.keySource,'backup');assert.equal(d.attempts,2);assert.equal(d.quota.used,2);
  assert(!raw.includes('fixture-primary-key'));assert(!raw.includes('fixture-backup-key'));assert(!raw.includes('keyFailure'));assert(!raw.includes(serviceSecret));
  const modelCalls=s.calls.filter(c=>c.url.includes(':generateContent'));assert.equal(modelCalls[0].o.body,modelCalls[1].o.body);
 }
});

test('한도·결제·지역·서비스·모델·입력 오류와 일반 권한 거절에는 계정 전환 없음',async()=>{
 for(const [primaryStatus,reason] of [[429,undefined],[402,undefined],[503,undefined],[502,undefined],[413,undefined],[404,undefined],[400,undefined],[400,'FAILED_PRECONDITION'],[400,'LOCATION_NOT_SUPPORTED'],[403,undefined],[403,'BILLING_DISABLED']]){
  const s=backupSetup({primaryStatus,reason}),r=await s.handler(sharedReq());assert.notEqual(r.status,200);assert.deepEqual(s.events,['reserve','primary']);
 }
});

test('보조키 전환에서도 긴 원고는 같은 원문 전체 하나를 그대로 전송',async()=>{
 const full={...payload,whole:true,evidence:[{...evidence[0],text:evidence[0].text+'\n\n'+('중간 전개와 사례를 보존하는 원문입니다.\n').repeat(500)+'\n마지막 결론을 보존하는 원문입니다.'}]};
 const s=backupSetup(),r=await s.handler(sharedReq(full));assert.equal(r.status,200);
 const calls=s.calls.filter(c=>c.url.includes(':generateContent'));assert.equal(calls.length,2);assert.equal(calls[0].o.body,calls[1].o.body);
 for(const call of calls){const input=JSON.parse(JSON.parse(call.o.body).contents[0].parts[0].text);assert.equal(input.evidence.length,1);assert.equal(input.evidence[0].text,full.evidence[0].text);}
});

test('보조키 실패·한도 부족·취소는 세 번째 호출 없이 종료',async()=>{
 const failed=backupSetup({backupStatus:401});assert.equal((await failed.handler(sharedReq())).status,502);assert.deepEqual(failed.events,['reserve','primary','wait','reserve','backup']);
 const limited=backupSetup({secondQuota:false});assert.equal((await limited.handler(sharedReq())).status,429);assert.deepEqual(limited.events,['reserve','primary','wait','reserve']);
 const aborted=backupSetup({abortWait:true});assert.equal((await aborted.handler(sharedReq())).status,502);assert.deepEqual(aborted.events,['reserve','primary','wait']);
});

test('정상 주키·보조키 없음·같은 값의 보조키는 불필요한 추가 호출 없음',async()=>{
 const healthy=backupSetup({primaryStatus:200});const d=await (await healthy.handler(sharedReq())).json();assert.deepEqual(healthy.events,['reserve','primary']);assert.equal(d.keySource,'primary');assert.equal(d.attempts,1);
 for(const backup of ['', 'fixture-primary-key']){const s=backupSetup({backup});assert.equal((await s.handler(sharedReq())).status,502);assert.equal(s.calls.filter(c=>c.url.includes(':generateContent')).length,1);assert(!s.events.includes('wait'));}
 const onlyBackup=backupSetup({primary:''});const b=await (await onlyBackup.handler(sharedReq())).json();assert.equal(b.keySource,'backup');assert.equal(b.attempts,1);assert.deepEqual(onlyBackup.events,['reserve','backup']);
});

test('보조키 모델 연결 진단은 서버 인증 유지·값 비공개·생성 및 한도 예약 없음',async()=>{
 const s=backupSetup(),r=await s.handler(sharedReq({action:'check-provider',provider:'gemini',keySource:'backup'}));const raw=await r.text();assert.equal(r.status,200);assert.equal(JSON.parse(raw).connected,true);assert.equal(s.calls.length,1);assert.equal(s.calls[0].o.method,undefined);assert.equal(s.calls[0].o.body,undefined);assert(!raw.includes('fixture-backup-key'));assert.deepEqual(s.events,[]);
 const missing=backupSetup({backup:''});assert.equal((await (await missing.handler(sharedReq({action:'check-provider',provider:'gemini',keySource:'backup'}))).json()).reason,'key_missing');assert.equal(missing.calls.length,0);
 for(const body of [{action:'check-provider',provider:'gemini',keySource:'primary'},{action:'check-provider',provider:'gemini',keySource:'backup',url:'https://evil.example'}]){const s=backupSetup();assert.equal((await s.handler(sharedReq(body))).status,400);assert.equal(s.calls.length,0);}
 const denied=backupSetup(),deniedRequest=sharedReq({action:'check-provider',provider:'gemini',keySource:'backup'});deniedRequest.headers.delete('Authorization');assert.equal((await denied.handler(deniedRequest)).status,401);assert.equal(denied.calls.length,0);
});

test('보조키 구성 상태와 사용 표시에는 값 노출이나 클라이언트 강제 선택 없음',async()=>{
 const s=backupSetup(),status=await (await s.handler(sharedReq({action:'status'}))).json();assert.deepEqual(status.providers.gemini,{configured:true,primaryConfigured:true,backupConfigured:true});
 const forced=backupSetup();assert.equal((await forced.handler(sharedReq({...payload,keySource:'backup'}))).status,400);assert.equal(forced.calls.length,0);
 const result=await generateViaServer(config,'user-token','gemini-lite','인내',evidence,true,async()=>new Response(JSON.stringify({answer,keySource:'backup',attempts:2})));assert.equal(result.usedBackup,true);assert.equal(result.attempts,2);
});
test('비밀번호와 클라이언트 ID만으로 승인 계정 인증을 우회할 수 없다',async()=>{
 const s=sharedSetup(),request=sharedReq();request.headers.delete('Authorization');
 assert.equal((await s.handler(request)).status,401);assert.equal(s.calls.length,0);
});
test('승인된 Google JWT는 기존 비밀번호 Secret·클라이언트 ID 없이 같은 제한을 사용한다',async()=>{
 const s=sharedSetup({password:'',service:''}),request=sharedReq({action:'status'});request.headers.delete('X-AI-Password');request.headers.delete('X-AI-Client');
 const r=await s.handler(request);assert.equal(r.status,200);const call=s.calls.find(c=>c.url.endsWith('/ai_lab_model_quota'));
 assert.equal(call.o.headers.Authorization,'Bearer user-token');assert.equal(JSON.parse(call.o.body).p_client,null);assert.equal(JSON.parse(call.o.body).p_reserve,false);
});
test('공유 요청도 무료 확인·전역 한도·인용 검증과 키 비공개 유지',async()=>{
 for(const [options,body,status] of [[{},payload,200],[{quota:false},payload,429],[{}, {...payload,freeOnly:false},400]]){
  const s=sharedSetup(options),r=await s.handler(sharedReq(body));assert.equal(r.status,status);const raw=await r.text();for(const value of [fixturePassword,serviceSecret,secret])assert(!raw.includes(value));
  const calls=s.calls.filter(x=>x.url.includes('googleapis'));assert.equal(calls.length,status===200?1:0);if(calls.length){assert(!calls[0].o.body.includes(fixturePassword));assert(!calls[0].o.body.includes(serviceSecret));assert.equal(JSON.parse(raw).answer.overview[0].points[0].sources[0].doc,undefined);}
 }
});
test('브라우저는 Google JWT만 보내고 공유 비밀번호 객체는 거부한다',async()=>{
 await assert.rejects(requestServer(config,{password:fixturePassword,clientId},{action:'status'},async()=>{throw new Error('must not fetch');}),/Google/);
 await requestServer(config,'user-token',{action:'status'},async(url,o)=>{assert.equal(o.headers.Authorization,'Bearer user-token');assert.equal(o.headers['X-AI-Password'],undefined);return new Response('{}');});
});
test('공유 경로의 CORS preflight는 인증 헤더 허용, AI 호출 없음',async()=>{
 const s=sharedSetup(),r=await s.handler(new Request('https://example',{method:'OPTIONS',headers:{Origin:'https://patrickdfg.github.io'}}));assert.equal(r.status,204);assert.match(r.headers.get('Access-Control-Allow-Headers'),/x-ai-password/);assert.match(r.headers.get('Access-Control-Allow-Headers'),/x-ai-client/);assert.equal(s.calls.length,0);
});


test('선택한 업체만 SQL 예약에 전달하고 상태 확인은 예약하지 않음',async()=>{
 const s=setup();await s.handler(req());const call=s.calls.find(x=>x.url.endsWith('/ai_lab_model_quota'));assert.equal(JSON.parse(call.o.body).p_provider,'gemini');assert.equal(JSON.parse(call.o.body).p_client,null);
 const publicServer=sharedSetup();await publicServer.handler(sharedReq({action:'status'}));assert.equal(JSON.parse(publicServer.calls[0].o.body).p_provider,null);assert.equal(JSON.parse(publicServer.calls[0].o.body).p_reserve,false);
});
test('Groq 키가 남아 있어도 모델·연결 기능은 거절하고 업체를 호출하지 않는다',async()=>{
 const s=sharedSetup({GROQ_API_KEY:'gsk_fixture_unused'});
 for(const body of [{action:'check-provider',provider:'groq'},{...payload,modelId:'groq-oss'}]){const r=await s.handler(sharedReq(body));assert.equal(r.status,400);assert.equal(s.calls.length,0);}
 const r=await s.handler(sharedReq({action:'status'})),d=await r.json();assert(!d.models.includes('groq-oss'));assert(!('groq' in d.providers));
});
test('Groq 연결 진단도 비밀번호·업체 allowlist·요청 필드 검증',async()=>{
 for(const [body,options,code] of [[{action:'check-provider',provider:'other'},{},400],[{action:'check-provider',provider:'groq',url:'https://evil.example'},{},400]]){
  const s=sharedSetup(),r=await s.handler(sharedReq(body,options));assert.equal(r.status,code);assert.equal(s.calls.length,0);
 }
});
test('업체별 잔여량은 서버 SQL 값을 그대로 반환하고 browser 값으로 덮어쓰지 않음',async()=>{
 const quota={allowed:true,used:13,remaining:47,providers:{gemini:{used:13,limit:30,remaining:17},groq:{used:0,limit:30,remaining:30}}};
 const env=n=>({AI_LAB_PASSWORD:fixturePassword,SUPABASE_SERVICE_ROLE_KEY:serviceSecret,GEMINI_API_KEY:secret})[n];
 const handler=createHandler({env,fetcher:approvedFetch(async(url)=>{assert(url.endsWith('/ai_lab_model_quota'));return new Response(JSON.stringify(quota));})});
 const r=await handler(sharedReq({action:'status'}));assert.deepEqual((await r.json()).quota.providers,quota.providers);
});

test('검토 메모 인용 후보는 원문 일부만 허용하고 업체 호출 전에 검증',async()=>{
 for(const quotes of [['가짜 원문 구절입니다.'],[],Array(7).fill(evidence[0].text),['x'.repeat(121)]]){const s=setup();const r=await s.handler(req({...payload,evidence:[{...evidence[0],quotes}]}));assert.equal(r.status,400);assert(!s.calls.some(x=>x.url.endsWith('/ai_lab_model_quota')||x.url.includes('googleapis')));}
 const s=setup(),r=await s.handler(req({...payload,evidence:[{...evidence[0],quotes:[evidence[0].text]}]}));assert.equal(r.status,200);
 const body=JSON.parse(s.calls.find(x=>x.url.includes('googleapis')).o.body);assert.deepEqual(JSON.parse(body.contents[0].parts[0].text).evidence[0].quoteChoices.map(c=>c.quote),[evidence[0].text]);
});

test('대기·거절·승인 취소·잘못된 JWT는 상태·생성·연결 확인 전에 차단한다',async()=>{
 for(const status of ['pending','rejected','revoked'])for(const body of [payload,{action:'status'},{action:'check-provider',provider:'gemini',keySource:'backup'}]){
  const calls=[],handler=createHandler({env:n=>n==='GEMINI_API_KEY'?secret:null,fetcher:async(url)=>{calls.push(url);return new Response(JSON.stringify({approved:false,status,isAdmin:false}));}});
  const r=await handler(req(body));assert.equal(r.status,403);assert.equal((await r.json()).membershipStatus,status);assert.deepEqual(calls,[config.supabaseUrl+'/rest/v1/rpc/ai_chat_membership']);
 }
 const invalid=createHandler({env:()=>null,fetcher:async()=>new Response('{}',{status:401})});assert.equal((await invalid(req())).status,401);
});
test('회원 상태의 부정확한 응답은 접근 권한으로 인정하지 않는다',async()=>{
 for(const data of [{approved:true,status:'pending'},{approved:'true',status:'approved'},{}]){
  let count=0;const handler=createHandler({env:()=>null,fetcher:async()=>{count++;return new Response(JSON.stringify(data));}});
  assert.equal((await handler(req())).status,403);assert.equal(count,1);
 }
});

test('날짜 지정 전체 정리를 문단 검색 모드로 보내면 예약·업체 호출 전에 거부',async()=>{
 const s=setup();const response=await s.handler(req({...payload,question:'10월 4일 주일 말씀 전체 하나로 정리해줘'}));
 assert.equal(response.status,400);assert.match((await response.json()).error,/원고 한 편 전체/);
 assert(!s.calls.some(c=>c.url.endsWith('/ai_lab_model_quota')||c.url.includes('googleapis')));
});
