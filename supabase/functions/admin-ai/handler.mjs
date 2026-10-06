import {requestsWholeManuscript,MODELS,generate,clean,MAX_WHOLE_CHARS} from '../../../admin/ai-core.mjs';
const ORIGIN='https://patrickdfg.github.io';
function delayForBackup(signal){return new Promise((resolve,reject)=>{
 const abort=()=>{clearTimeout(timer);signal.removeEventListener('abort',abort);reject(new DOMException('Aborted','AbortError'));};
 const timer=setTimeout(()=>{signal.removeEventListener('abort',abort);resolve();},12000);
 signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
});}
export function createHandler({env,fetcher=fetch,waitForBackup=delayForBackup}){
 return async function handler(req){
  const origin=req.headers.get('Origin');
  const headers={'Content-Type':'application/json','Cache-Control':'no-store','Vary':'Origin',...(origin===ORIGIN?{'Access-Control-Allow-Origin':ORIGIN,'Access-Control-Allow-Headers':'authorization,apikey,content-type,x-ai-password,x-ai-client','Access-Control-Allow-Methods':'POST,OPTIONS'}:{})};
  const reply=(data,status=200)=>new Response(JSON.stringify(data),{status,headers});
  if(origin&&origin!==ORIGIN)return reply({error:'허용되지 않은 요청 출처입니다.'},403);
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
  if(req.method!=='POST')return reply({error:'POST 요청만 허용합니다.'},405);
  const auth=req.headers.get('Authorization')||'';
  if(!/^Bearer \S+$/.test(auth))return reply({error:'Google로 로그인한 승인 계정이 필요합니다.'},401);
  const config={enabled:true,supabaseUrl:env('SUPABASE_URL')||'https://maoylwwnluyyfmwqfkfl.supabase.co',supabaseAnonKey:env('SUPABASE_ANON_KEY')||'sb_publishable_RR5lrEd5ZidVI1fY1v9haw_Hd7pOH1V'};
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),110000);
  try{
   // PostgREST validates the JWT; the RPC checks live Google identity and approval in Auth/DB.
   // Existing password Secrets stay intact but can no longer bypass membership approval.
   const access=await fetcher(config.supabaseUrl+'/rest/v1/rpc/ai_chat_membership',{method:'POST',headers:{apikey:config.supabaseAnonKey,Authorization:auth,'Content-Type':'application/json'},body:'{}',signal:controller.signal});
   if(!access.ok)return reply({error:'Google 로그인과 회원 승인 상태를 확인해 주세요.'},access.status===401?401:403);
   let membership;try{membership=await access.json();}catch{return reply({error:'회원 승인 상태를 확인하지 못했습니다.'},503);}
   if(membership?.approved!==true||membership.status!=='approved')return reply({error:'관리자 승인 후 이용할 수 있습니다.',membershipStatus:['pending','rejected','revoked'].includes(membership?.status)?membership.status:'pending'},403);
   let raw='';if(req.body){const reader=req.body.getReader(),decoder=new TextDecoder();let bytes=0;while(true){const part=await reader.read();if(part.done)break;bytes+=part.value.byteLength;if(bytes>512000){await reader.cancel();return reply({error:'요청 크기가 너무 큽니다.'},413);}raw+=decoder.decode(part.value,{stream:true});}raw+=decoder.decode();}
   let body;try{body=JSON.parse(raw);}catch{return reply({error:'요청 형식을 확인해 주세요.'},400);}
   if(!body||typeof body!=='object'||Array.isArray(body))return reply({error:'요청 형식을 확인해 주세요.'},400);
   const rpc=async (reserve,provider=null)=>{
    const r=await fetcher(config.supabaseUrl+'/rest/v1/rpc/'+'ai_lab_model_quota',{method:'POST',headers:{apikey:config.supabaseAnonKey,Authorization:auth,'Content-Type':'application/json'},body:JSON.stringify({p_client:null,p_provider:provider,p_reserve:reserve}),signal:controller.signal});
    if(!r.ok)throw new Error('서버 호출 제한 설정이 준비되지 않았습니다. 관리자에게 확인해 주세요.');
    const d=await r.json();if(!d||typeof d.allowed!=='boolean'||!Number.isInteger(d.used)||!Number.isInteger(d.remaining))throw new Error('서버 호출 제한 응답을 확인하지 못했습니다.');return d;
   };
   if(body.action==='status'){
    const quota=await rpc(false);
    const primaryConfigured=!!env('GEMINI_API_KEY')?.trim(),backupConfigured=!!env('GEMINI_API_KEY_BACKUP')?.trim();
    return reply({ready:true,providers:{gemini:{configured:primaryConfigured||backupConfigured,primaryConfigured,backupConfigured}},models:primaryConfigured||backupConfigured?Object.keys(MODELS):[],quota});
   }
   if(body.action==='check-provider'&&body.provider==='gemini'){
    if(body.keySource!=='backup'||Object.keys(body).some(k=>!['action','provider','keySource'].includes(k)))return reply({error:'허용되지 않은 연결 확인입니다.'},400);
    const key=env('GEMINI_API_KEY_BACKUP')?.trim();
    if(!key)return reply({connected:false,keySource:'backup',reason:'key_missing',message:'Supabase Secrets에 GEMINI_API_KEY_BACKUP이 등록되지 않았습니다.'});
    const r=await fetcher('https://generativelanguage.googleapis.com/v1beta/models/'+MODELS['gemini-lite'].model,{headers:{'x-goog-api-key':key},signal:controller.signal});
    if(!r.ok)return reply({connected:false,keySource:'backup',reason:'provider_error',message:'Gemini 보조키 연결을 확인하지 못했습니다 ('+r.status+'). 키의 API 제한과 프로젝트 설정을 확인해 주세요.'});
    const data=await r.json(),active=data.name==='models/'+MODELS['gemini-lite'].model&&Array.isArray(data.supportedGenerationMethods)&&data.supportedGenerationMethods.includes('generateContent');
    return reply({connected:active,keySource:'backup',reason:active?'ready':'model_unavailable',message:active?'Gemini 보조키 연결 확인 완료 · Flash-Lite 모델 사용 가능':'Gemini 보조키의 Flash-Lite 모델 지원을 확인하지 못했습니다.'});
   }
   if(body.action==='check-provider')return reply({error:'허용되지 않은 연결 확인입니다.'},400);
   if(body.action!=='generate'||Object.keys(body).some(k=>!['action','modelId','question','evidence','freeOnly','whole'].includes(k))||body.whole!==undefined&&body.whole!==true)return reply({error:'허용되지 않은 요청입니다.'},400);
   const whole=body.whole===true;
   if(!whole&&requestsWholeManuscript(body.question))return reply({error:'말씀 전체 정리 요청에는 지정한 원고 한 편 전체가 필요합니다. 문단 검색 결과로 대신 답하지 않았습니다.'},400);
   if(body.freeOnly!==true)return reply({error:'결제가 연결되지 않은 무료 키인지 확인해 주세요.'},400);
   const model=typeof body.modelId==='string'&&Object.hasOwn(MODELS,body.modelId)?MODELS[body.modelId]:null;
   if(!model)return reply({error:'허용되지 않은 모델입니다.'},400);
   if(typeof body.question!=='string'||body.question.trim().length<2||body.question.length>600)return reply({error:'질문은 2~600글자로 입력해 주세요.'},400);
   if(!Array.isArray(body.evidence)||!body.evidence.length||body.evidence.length>6)return reply({error:'기존 원고에서 찾은 근거 문단이 필요합니다.'},400);
   if(whole&&body.evidence.length!==1)return reply({error:'전체 요약·정리는 한 편의 원고 전체를 하나로 보내 주세요.'},400);
   const ids=new Set();let total=0;const evidence=[];
   for(const d of body.evidence){
    if(!d||typeof d.id!=='string'||! /^(sayeon2026|sayeon2025|malsseum|stones):[^:]{1,80}:\d+$/.test(d.id)||ids.has(d.id)||typeof d.title!=='string'||d.title.length>300||typeof d.text!=='string'||!d.text.trim()||d.text.length>(whole?MAX_WHOLE_CHARS:1800))return reply({error:whole?'원고 전체는 한 편, 최대 80,000글자까지 한 번에 처리합니다. 원문은 자르거나 나누지 않았습니다.':'근거 문단 형식을 확인해 주세요.'},400);
    if(d.quotes!==undefined&&(!Array.isArray(d.quotes)||!d.quotes.length||d.quotes.length>6||d.quotes.some(q=>typeof q!=='string'||clean(q).length<8||q.length>120||!clean(d.text).includes(clean(q)))))return reply({error:'검토 메모의 원문 인용 형식을 확인해 주세요.'},400);
    ids.add(d.id);total+=d.text.length;evidence.push({id:d.id,title:d.title,text:d.text,...(whole?{whole:true}:{}),...(d.quotes===undefined?{}:{quotes:d.quotes.map(clean)})});
   }
   if(total>(whole?MAX_WHOLE_CHARS:8000))return reply({error:'근거 원문의 길이 제한을 초과했습니다.'},400);
   const primary=env('GEMINI_API_KEY')?.trim()||'',backup=env('GEMINI_API_KEY_BACKUP')?.trim()||'';
   const key=primary||backup;if(!key)return reply({error:'선택한 모델의 서버 키가 등록되지 않았습니다.'},503);
   let quota=await rpc(true,model.provider);const limited=()=>reply({error:quota.reason==='rate'?'요청 간격은 10초 이상입니다. 잠시 후 다시 질문해 주세요.':'AI 챗봇의 하루 호출 한도에 도달했습니다.',quota},429);
   if(!quota.allowed)return limited();
   let result,keySource=!primary?'backup':'primary',attempts=1;
   try{result=await generate(body.modelId,key,clean(body.question),evidence,fetcher,controller.signal);}
   catch(e){
    if(!primary||!backup||backup===primary||e.keyFailure!==true||controller.signal.aborted)throw e;
    // Credential recovery only: no switching on quota, billing, content or service errors.
    await waitForBackup(controller.signal);if(controller.signal.aborted)throw new DOMException('Aborted','AbortError');
    quota=await rpc(true,model.provider);if(!quota.allowed)return limited();
    keySource='backup';attempts=2;
    result=await generate(body.modelId,backup,clean(body.question),evidence,fetcher,controller.signal);
   }
   const strip=c=>({text:c.text,kind:c.kind,sources:c.sources.map(s=>({id:s.id,quote:s.quote}))});
   const answer={supported:result.answer.supported,overview:result.answer.overview.map(section=>({title:section.title,points:section.points.map(p=>({label:p.label,...strip(p)}))})),claims:result.answer.claims.map(strip)};
   return reply({answer,model:result.model,usage:result.usage,quota,keySource,attempts});
  }catch(e){
   // Never return upstream bodies, request data, tokens or secret values.
   const msg=e.name==='AbortError'?'AI 요청 시간이 초과됐습니다. 질문을 좁혀 다시 시도해 주세요.':e instanceof TypeError?'AI 서버 연결에 실패했습니다.':String(e.message||'AI 요청 처리에 실패했습니다.');
   const safe=msg.replace(/(?:AIza[\w-]+|gsk_[\w-]+)/g,'[비공개]');
   return reply({error:safe},msg.includes('무료 한도')?429:502);
  }finally{clearTimeout(timer);}
 };
}
