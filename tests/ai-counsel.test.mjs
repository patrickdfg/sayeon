// 고민 상담 — 서버의 고민 분석(keywords)과 화면의 말씀 찾기가 약속대로 동작하는지 본다.
import {test} from 'node:test';import assert from 'node:assert/strict';
import {createHandler} from '../supabase/functions/admin-ai/handler.mjs';
import {analyzeViaServer,validateKeywords} from '../admin/ai-core.mjs';
const config={supabaseUrl:'https://maoylwwnluyyfmwqfkfl.supabase.co',supabaseAnonKey:'public'};
const analysis={kind:'worry',summary:'직장 동료와 오해가 생겨 마음이 힘들다.',themes:['오해와 관계','낙심'],keywords:['오해','풀고','형제','용서','화평','낙심','실족','인내']};
function setup({quota=true,primary='fixture-primary',backup=null,primaryStatus=200,reason}={}){
 const events=[],calls=[];let reserved=0;
 const env=n=>({GEMINI_API_KEY:primary,GEMINI_API_KEY_BACKUP:backup})[n]??null;
 const fetcher=async(url,o)=>{
  calls.push({url,o});
  if(url.endsWith('/ai_chat_membership'))return new Response(JSON.stringify({approved:true,status:'approved',isAdmin:false}));
  if(url.endsWith('/ai_lab_model_quota')){const b=JSON.parse(o.body);events.push(b.p_reserve?'reserve':'status');if(b.p_reserve)reserved++;return new Response(JSON.stringify({allowed:quota,used:reserved,remaining:30-reserved,reason:quota?'':'daily'}));}
  if(url.includes('generativelanguage.googleapis.com')){
   const key=o.headers['x-goog-api-key'],isBackup=key===backup;events.push(isBackup?'backup':'primary');
   if(!isBackup&&primaryStatus!==200)return new Response(JSON.stringify({error:{message:'API key not valid',details:reason?[{reason}]:[]}}),{status:primaryStatus});
   return new Response(JSON.stringify({candidates:[{content:{parts:[{text:JSON.stringify(analysis)}]}}],usageMetadata:{}}));
  }
  throw new Error('Unexpected request '+url);
 };
 return {handler:createHandler({env,fetcher,waitForBackup:async()=>{events.push('wait');}}),calls,events};
}
const req=(body,{auth=true}={})=>new Request('https://example/functions/v1/clever-action',{method:'POST',headers:{Origin:'https://patrickdfg.github.io',...(auth?{Authorization:'Bearer user-token'}:{}),'Content-Type':'application/json'},body:JSON.stringify(body)});
const body={action:'keywords',modelId:'gemini-lite',question:'직장 동료와 오해가 생겨서 힘들어요',freeOnly:true};

test('고민 분석은 고민 글만 업체에 보내고 낱말·요약만 돌려받는다',async()=>{
 const s=setup(),r=await s.handler(req(body)),raw=await r.text(),d=JSON.parse(raw);
 assert.equal(r.status,200);assert.deepEqual(d.analysis,analysis);assert.deepEqual(s.events,['reserve','primary']);
 const sent=JSON.parse(s.calls.find(c=>c.url.includes('generativelanguage')).o.body);
 assert.equal(sent.contents[0].parts[0].text,JSON.stringify({worry:body.question}));
 assert(!raw.includes('fixture-primary'));assert(!sent.generationConfig.responseJsonSchema.properties.claims);
});
test('고민 분석도 승인·무료 확인·모델·길이·허용 필드를 업체 호출 전에 검사한다',async()=>{
 for(const [b,code] of [[{...body,freeOnly:false},400],[{...body,modelId:'constructor'},400],[{...body,question:'가'},400],[{...body,question:'가'.repeat(601)},400],[{...body,evidence:[]},400],[{...body,extra:1},400]]){
  const s=setup();assert.equal((await s.handler(req(b))).status,code);assert.deepEqual(s.events,[]);
 }
 const s=setup();assert.equal((await s.handler(req(body,{auth:false}))).status,401);assert.deepEqual(s.events,[]);
});
test('고민 분석도 하루 한도를 쓰고 한도가 차면 업체를 부르지 않는다',async()=>{
 const s=setup({quota:false}),r=await s.handler(req(body));assert.equal(r.status,429);assert.deepEqual(s.events,['reserve']);
});
test('고민 분석의 키 인증 오류는 보조키로 한 번만 전환한다',async()=>{
 const s=setup({backup:'fixture-backup',primaryStatus:401}),r=await s.handler(req(body)),d=await r.json();
 assert.equal(r.status,200);assert.deepEqual(s.events,['reserve','primary','wait','reserve','backup']);assert.equal(d.keySource,'backup');assert.equal(d.attempts,2);
 const other=setup({backup:'fixture-backup',primaryStatus:429});assert.notEqual((await other.handler(req(body))).status,200);assert.deepEqual(other.events,['reserve','primary']);
});
test('분석 결과는 낱말만 남기고 중복·너무 긴 것·모자란 응답은 거절한다',async()=>{
 const ok=validateKeywords(JSON.stringify({summary:' 요약 ',themes:['관계','관계'],keywords:['오해','오해','풀고','용서','가'.repeat(30),'화평']}));
 assert.equal(ok.kind,'question');   // kind 가 없거나 worry 가 아니면 question(기존 방식)으로 둔다
 assert.deepEqual(ok.keywords,['오해','풀고','용서','화평']);
 assert.equal(validateKeywords(JSON.stringify({kind:'worry',summary:'a',themes:[],keywords:['오해','용서','화평']})).kind,'worry');assert.deepEqual(ok.themes,['관계']);
 assert.throws(()=>validateKeywords(JSON.stringify({summary:'a',themes:[],keywords:['오해']})),/낱말/);
 assert.throws(()=>validateKeywords('not json'),/형식/);
});
test('브라우저는 사용자 토큰과 고민만 보내고 결과를 다시 검증한다',async()=>{
 const s=setup(),got=await analyzeViaServer(config,'user-token','gemini-lite',body.question,async(url,o)=>s.handler(new Request(url,{method:o.method,headers:o.headers,body:o.body})));
 assert.deepEqual(got.analysis,analysis);
 await assert.rejects(analyzeViaServer(config,'user-token','constructor','고민',async()=>{throw new Error('no call');}),/허용되지 않은 모델/);
 await assert.rejects(analyzeViaServer(config,'','gemini-lite','고민'),/로그인/);
});
