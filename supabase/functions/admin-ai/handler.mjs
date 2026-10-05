import {MODELS,generate,verifyAdmin,clean} from '../../../admin/ai-core.mjs';
const ORIGIN='https://patrickdfg.github.io';
async function digest(value){return new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)));}
async function sameSecret(a,b){const x=await digest(a),y=await digest(b);let diff=0;for(let i=0;i<x.length;i++)diff|=x[i]^y[i];return diff===0;}
export function createHandler({env,fetcher=fetch}){
 return async function handler(req){
  const origin=req.headers.get('Origin');
  const headers={'Content-Type':'application/json','Cache-Control':'no-store','Vary':'Origin',...(origin===ORIGIN?{'Access-Control-Allow-Origin':ORIGIN,'Access-Control-Allow-Headers':'authorization,apikey,content-type,x-ai-password,x-ai-client','Access-Control-Allow-Methods':'POST,OPTIONS'}:{})};
  const reply=(data,status=200)=>new Response(JSON.stringify(data),{status,headers});
  if(origin&&origin!==ORIGIN)return reply({error:'허용되지 않은 요청 출처입니다.'},403);
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
  if(req.method!=='POST')return reply({error:'POST 요청만 허용합니다.'},405);
  const auth=req.headers.get('Authorization')||'';
  const shared=req.headers.has('X-AI-Password'),password=req.headers.get('X-AI-Password')||'',client=req.headers.get('X-AI-Client')||'';
  if(!shared&&!/^Bearer \S+$/.test(auth))return reply({error:'AI 챗봇 비밀번호 또는 관리자 로그인이 필요합니다.'},401);
  const token=auth.slice(7),config={enabled:true,supabaseUrl:env('SUPABASE_URL')||'https://maoylwwnluyyfmwqfkfl.supabase.co',supabaseAnonKey:env('SUPABASE_ANON_KEY')||'sb_publishable_RR5lrEd5ZidVI1fY1v9haw_Hd7pOH1V'};
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),50000);
  try{
   let publicId='',serviceKey='';
   if(shared){
    const expected=env('AI_LAB_PASSWORD');serviceKey=env('SUPABASE_SERVICE_ROLE_KEY');
    if(!expected||!serviceKey)return reply({error:'서버의 AI 챗봇 비밀번호 설정이 아직 준비되지 않았습니다.'},503);
    if(!password||password.length>128||!await sameSecret(password,expected))return reply({error:'AI 챗봇 비밀번호가 맞지 않습니다.'},401);
    if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(client))return reply({error:'브라우저 식별 정보를 확인해 주세요.'},400);
    const hash=Array.from(await digest('ai-lab-public:'+client.toLowerCase()),x=>x.toString(16).padStart(2,'0')).join('').slice(0,32);
    publicId=hash.slice(0,8)+'-'+hash.slice(8,12)+'-'+hash.slice(12,16)+'-'+hash.slice(16,20)+'-'+hash.slice(20);
   }else{try{await verifyAdmin(config,token,fetcher,controller.signal);}catch{return reply({error:'관리자 권한을 확인하지 못했습니다. 다시 로그인해 주세요.'},403);}}
   let raw='';if(req.body){const reader=req.body.getReader(),decoder=new TextDecoder();let bytes=0;while(true){const part=await reader.read();if(part.done)break;bytes+=part.value.byteLength;if(bytes>40000){await reader.cancel();return reply({error:'요청 크기가 너무 큽니다.'},413);}raw+=decoder.decode(part.value,{stream:true});}raw+=decoder.decode();}
   let body;try{body=JSON.parse(raw);}catch{return reply({error:'요청 형식을 확인해 주세요.'},400);}
   if(!body||typeof body!=='object'||Array.isArray(body))return reply({error:'요청 형식을 확인해 주세요.'},400);
   const rpc=async (reserve,provider=null)=>{
    const r=await fetcher(config.supabaseUrl+'/rest/v1/rpc/'+'ai_lab_model_quota',{method:'POST',headers:{apikey:shared?serviceKey:config.supabaseAnonKey,Authorization:shared?'Bearer '+serviceKey:auth,'Content-Type':'application/json'},body:JSON.stringify({p_client:shared?publicId:null,p_provider:provider,p_reserve:reserve}),signal:controller.signal});
    if(!r.ok)throw new Error('서버 호출 제한 설정이 준비되지 않았습니다. 관리자에게 확인해 주세요.');
    const d=await r.json();if(!d||typeof d.allowed!=='boolean'||!Number.isInteger(d.used)||!Number.isInteger(d.remaining))throw new Error('서버 호출 제한 응답을 확인하지 못했습니다.');return d;
   };
   if(body.action==='status'){
    const quota=await rpc(false);
    return reply({ready:true,providers:{gemini:{configured:!!env('GEMINI_API_KEY')},groq:{configured:!!env('GROQ_API_KEY')}},models:Object.entries(MODELS).filter(([,m])=>!!env(m.provider==='gemini'?'GEMINI_API_KEY':'GROQ_API_KEY')).map(([id])=>id),quota});
   }
   if(body.action==='check-provider'){
    if(body.provider!=='groq'||Object.keys(body).some(k=>!['action','provider'].includes(k)))return reply({error:'허용되지 않은 연결 확인입니다.'},400);
    const key=env('GROQ_API_KEY');
    if(!key?.trim())return reply({connected:false,reason:'key_missing',message:'Supabase Secrets에 GROQ_API_KEY가 등록되지 않았습니다.'});
    const r=await fetcher('https://api.groq.com/openai/v1/models',{headers:{Authorization:'Bearer '+key.trim()},signal:controller.signal});
    if(!r.ok)return reply({connected:false,reason:'provider_error',message:r.status===401?'Groq API 키가 유효하지 않거나 만료되었습니다. GROQ_API_KEY를 다시 저장해 주세요.':r.status===403?'Groq 계정 또는 모델 사용 권한을 확인해 주세요.':r.status===429?'Groq 호출 속도 제한입니다. 잠시 후 다시 확인해 주세요.':'Groq 연결을 확인하지 못했습니다 ('+r.status+').'});
    const data=await r.json(),active=Array.isArray(data.data)&&data.data.some(m=>m.id===MODELS['groq-oss'].model);
    return reply({connected:active,reason:active?'ready':'model_unavailable',message:active?'Groq 연결 확인 완료 · GPT OSS 20B 사용 가능':'Groq에는 연결됐지만 GPT OSS 20B 모델을 사용할 수 없습니다.'});
   }
   if(body.action!=='generate'||Object.keys(body).some(k=>!['action','modelId','question','evidence','freeOnly'].includes(k)))return reply({error:'허용되지 않은 요청입니다.'},400);
   if(body.freeOnly!==true)return reply({error:'결제가 연결되지 않은 무료 키인지 확인해 주세요.'},400);
   const model=typeof body.modelId==='string'&&Object.hasOwn(MODELS,body.modelId)?MODELS[body.modelId]:null;
   if(!model)return reply({error:'허용되지 않은 모델입니다.'},400);
   if(typeof body.question!=='string'||body.question.trim().length<2||body.question.length>600)return reply({error:'질문은 2~600글자로 입력해 주세요.'},400);
   if(!Array.isArray(body.evidence)||!body.evidence.length||body.evidence.length>6)return reply({error:'기존 원고에서 찾은 근거 문단이 필요합니다.'},400);
   const ids=new Set();let total=0;const evidence=[];
   for(const d of body.evidence){
    if(!d||typeof d.id!=='string'||! /^(sayeon2026|sayeon2025|malsseum|stones):[^:]{1,80}:\d+$/.test(d.id)||ids.has(d.id)||typeof d.title!=='string'||d.title.length>300||typeof d.text!=='string'||!d.text.trim()||d.text.length>1800)return reply({error:'근거 문단 형식을 확인해 주세요.'},400);
    ids.add(d.id);total+=d.text.length;evidence.push({id:d.id,title:d.title,text:d.text});
   }
   if(total>8000)return reply({error:'근거 원문은 총 8,000글자 이하로 제한합니다.'},400);
   const key=env(model.provider==='gemini'?'GEMINI_API_KEY':'GROQ_API_KEY');if(!key)return reply({error:'선택한 모델의 서버 키가 등록되지 않았습니다.'},503);
   const quota=await rpc(true,model.provider);if(!quota.allowed)return reply({error:quota.reason==='rate'?'요청 간격은 10초 이상입니다. 잠시 후 다시 질문해 주세요.':'AI 챗봇의 하루 호출 한도에 도달했습니다.',quota},429);
   const result=await generate(body.modelId,key,clean(body.question),evidence,fetcher,controller.signal);
   const strip=c=>({text:c.text,kind:c.kind,sources:c.sources.map(s=>({id:s.id,quote:s.quote}))});
   const answer={supported:result.answer.supported,overview:result.answer.overview.map(section=>({title:section.title,points:section.points.map(p=>({label:p.label,...strip(p)}))})),claims:result.answer.claims.map(strip)};
   return reply({answer,model:result.model,usage:result.usage,quota});
  }catch(e){
   // Never return upstream bodies, request data, tokens or secret values.
   const msg=e.name==='AbortError'?'AI 요청 시간이 초과됐습니다. 질문을 좁혀 다시 시도해 주세요.':e instanceof TypeError?'AI 서버 연결에 실패했습니다.':String(e.message||'AI 요청 처리에 실패했습니다.');
   const safe=msg.replace(/(?:AIza[\w-]+|gsk_[\w-]+)/g,'[비공개]');
   return reply({error:safe},msg.includes('무료 한도')?429:502);
  }finally{clearTimeout(timer);}
 };
}

