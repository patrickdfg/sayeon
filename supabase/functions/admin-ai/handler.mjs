import {MODELS,generate,verifyAdmin,clean} from '../../../admin/ai-core.mjs';
const ORIGIN='https://patrickdfg.github.io';
export function createHandler({env,fetcher=fetch}){
 return async function handler(req){
  const origin=req.headers.get('Origin');
  const headers={'Content-Type':'application/json','Cache-Control':'no-store','Vary':'Origin',...(origin===ORIGIN?{'Access-Control-Allow-Origin':ORIGIN,'Access-Control-Allow-Headers':'authorization,apikey,content-type','Access-Control-Allow-Methods':'POST,OPTIONS'}:{})};
  const reply=(data,status=200)=>new Response(JSON.stringify(data),{status,headers});
  if(origin&&origin!==ORIGIN)return reply({error:'허용되지 않은 요청 출처입니다.'},403);
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
  if(req.method!=='POST')return reply({error:'POST 요청만 허용합니다.'},405);
  const auth=req.headers.get('Authorization')||'';
  if(!/^Bearer \S+$/.test(auth))return reply({error:'관리자 로그인이 필요합니다.'},401);
  const token=auth.slice(7),config={enabled:true,supabaseUrl:env('SUPABASE_URL')||'https://maoylwwnluyyfmwqfkfl.supabase.co',supabaseAnonKey:env('SUPABASE_ANON_KEY')||'sb_publishable_RR5lrEd5ZidVI1fY1v9haw_Hd7pOH1V'};
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),50000);
  try{
   try{await verifyAdmin(config,token,fetcher,controller.signal);}catch{return reply({error:'관리자 권한을 확인하지 못했습니다. 다시 로그인해 주세요.'},403);}
   let raw='';if(req.body){const reader=req.body.getReader(),decoder=new TextDecoder();let bytes=0;while(true){const part=await reader.read();if(part.done)break;bytes+=part.value.byteLength;if(bytes>40000){await reader.cancel();return reply({error:'요청 크기가 너무 큽니다.'},413);}raw+=decoder.decode(part.value,{stream:true});}raw+=decoder.decode();}
   let body;try{body=JSON.parse(raw);}catch{return reply({error:'요청 형식을 확인해 주세요.'},400);}
   if(!body||typeof body!=='object'||Array.isArray(body))return reply({error:'요청 형식을 확인해 주세요.'},400);
   const rpc=async reserve=>{
    const r=await fetcher(config.supabaseUrl+'/rest/v1/rpc/ai_lab_quota',{method:'POST',headers:{apikey:config.supabaseAnonKey,Authorization:auth,'Content-Type':'application/json'},body:JSON.stringify({p_reserve:reserve}),signal:controller.signal});
    if(!r.ok)throw new Error('서버 호출 제한 설정이 준비되지 않았습니다. 관리자에게 확인해 주세요.');
    const d=await r.json();if(!d||typeof d.allowed!=='boolean'||!Number.isInteger(d.used)||!Number.isInteger(d.remaining))throw new Error('서버 호출 제한 응답을 확인하지 못했습니다.');return d;
   };
   if(body.action==='status'){
    const quota=await rpc(false);
    return reply({ready:true,models:Object.entries(MODELS).filter(([,m])=>!!env(m.provider==='gemini'?'GEMINI_API_KEY':'GROQ_API_KEY')).map(([id])=>id),quota});
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
   const quota=await rpc(true);if(!quota.allowed)return reply({error:quota.reason==='rate'?'요청 간격은 10초 이상입니다. 잠시 후 다시 질문해 주세요.':'관리자 테스트의 하루 호출 한도에 도달했습니다.',quota},429);
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
