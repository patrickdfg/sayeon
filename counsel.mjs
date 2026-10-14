// 고민 상담 화면의 동작 — 올린 말씀 안에서만 찾아 위로와 조언을 하고, 원문은 숨긴 단추 뒤에 둔다.
import {SOURCES,toChunks,generateViaServer,analyzeViaServer,requestServer,sourceCaption} from './admin/ai-core.mjs?v=22';
import {findEvidence,counselQuestion,loadCounselGuide,CRISIS,GAP_MS,sleep} from './ai-counsel-core.mjs?v=2';
import {MEMBER_LABELS,membershipStatus} from './ai-members.mjs?v=1';

const $=id=>document.getElementById(id),config=window.SAYEON_ANALYTICS_CONFIG||{};
let authClient=null,googleUser=null,token='',authorized=false,chunks=[],busy=false,epoch=0,controller=null;
const text=(el,s)=>{el.textContent=s;};
const node=(tag,s,cls)=>{const el=document.createElement(tag);if(s!=null)el.textContent=s;if(cls)el.className=cls;return el;};

/* ===== 고민 → 말씀에서 찾을 낱말 =====
 * 고민을 쓰는 낱말('불안해요')과 말씀에 나오는 낱말('염려·믿음')이 달라 그대로는 못 찾는 일이 많다.
 * 자주 있는 고민의 말씀 쪽 낱말을 덧붙여 여러 번 찾고 합친다. 찾는 일을 돕는 것일 뿐
 * 답은 찾아 온 말씀에 있는 뜻으로만 쓴다(서버가 원문 인용을 검사한다). */
/* 찾기·요청문·위험한 말 규칙은 ai-counsel-core.mjs (AI 챗봇과 같이 쓴다) */
/* ===== 화면 ===== */
function showSources(found,answer){
 const box=$('sources');box.replaceChildren();
 const cited=new Map();
 const add=s=>{if(s?.id&&s.quote){if(!cited.has(s.id))cited.set(s.id,[]);if(!cited.get(s.id).includes(s.quote))cited.get(s.id).push(s.quote);}};
 (answer.overview||[]).forEach(sec=>(sec.points||[]).forEach(p=>(p.sources||[]).forEach(add)));
 (answer.claims||[]).forEach(c=>(c.sources||[]).forEach(add));
 found.forEach(doc=>{
  const d=node('details',null,'src');d.open=true;d.append(node('summary',sourceCaption(doc)));   // 원문 보기를 누르면 바로 읽을 수 있게 펼쳐 둔다
  const quotes=cited.get(doc.id)||[];
  quotes.forEach(q=>d.append(node('blockquote','“'+q+'”')));
  const full=node('p',doc.text,'full');d.append(full);
  if(doc.url){try{const url=new URL(doc.url,'https://patrickdfg.github.io');if(url.origin==='https://patrickdfg.github.io'&&/^\/(?:sayeon|malsseum)\//.test(url.pathname)){const a=node('a','이 말씀 열어 보기');a.href=url.href;a.target='_blank';a.rel='noopener noreferrer';d.append(a);}}catch{}}
  box.append(d);
 });
}
function showAnswer(result,found,analysis=null){
 const out=$('answer');out.replaceChildren();
 const a=result.answer;
 if(analysis?.summary)out.append(node('p','고민을 이렇게 이해했습니다 — '+analysis.summary,'gist'));
 if(!a.supported||!a.overview?.length){out.append(node('p','이 고민에 맞는 말씀을 올려 둔 자료에서 찾지 못했습니다. 상황을 조금 더 구체적으로 적어 주세요.','muted'));$('toggleSources').classList.add('hidden');$('sources').classList.add('hidden');return;}
 a.overview.forEach(sec=>{
  const s=node('section',null,'sec');s.append(node('h3',sec.title));
  sec.points.forEach(p=>{const row=node('div',null,'pt');if(p.label)row.append(node('strong',p.label));row.append(node('p',p.text));s.append(row);});
  out.append(s);
 });
 showSources(found,a);
 const btn=$('toggleSources');btn.classList.remove('hidden');btn.setAttribute('aria-expanded','false');text(btn,'📖 원문 보기');$('sources').classList.add('hidden');
}
$('toggleSources').onclick=()=>{
 const open=$('sources').classList.toggle('hidden')===false;
 $('toggleSources').setAttribute('aria-expanded',String(open));text($('toggleSources'),open?'원문 숨기기':'📖 원문 보기');
};
function status(s,error=false){text($('status'),s);$('status').classList.toggle('error',error);}
function setBusy(v){busy=v;$('ask').disabled=v||$('worry').value.trim().length<4;$('worry').disabled=v;$('cancel').classList.toggle('hidden',!v);$('ask').classList.toggle('hidden',v);}

async function check(){
 const {data,error}=await authClient.auth.getSession();
 if(error||!data.session||data.session.user.id!==googleUser.id)throw new Error('Google로 다시 로그인해 주세요.');
 token=data.session.access_token;
}
async function load(){
 if(!window.SaCrypt.ready()&&!await window.SaCrypt.resume()){$('unlockBox').classList.remove('hidden');status('원고가 잠겨 있습니다. 앱에서 쓰는 원고 암호를 넣어 주세요.');return false;}
 $('unlockBox').classList.add('hidden');
 const results=await Promise.allSettled(SOURCES.map(async s=>toChunks(await window.SaCrypt.json(s.url),s)));
 const docs=[];results.forEach(r=>{if(r.status==='fulfilled')docs.push(...r.value);});
 if(!docs.length)throw new Error('올린 말씀을 불러오지 못했습니다.');
 chunks=docs;status('올린 말씀 '+new Set(docs.map(d=>d.scope+':'+d.no)).size+'편을 불러왔습니다.');return true;
}
$('unlock').onclick=async()=>{
 if(!await window.SaCrypt.unlock($('contentPassword').value)){status('원고 암호를 확인해 주세요.',true);return;}
 $('contentPassword').value='';
 try{await load();}catch(e){status(e.message,true);}
};

async function ask(){
 const worry=$('worry').value.trim();
 if(worry.length<4||busy||!authorized)return;
 $('crisis').classList.toggle('hidden',!CRISIS.test(worry));
 if(CRISIS.test(worry)){status('');return;}   // 생명이 걸린 말은 AI 답 대신 도움 연락처를 먼저 보여 준다
 if(!chunks.length&&!await load()){return;}
 const mine=epoch;controller=new AbortController();setBusy(true);
 const timer=setTimeout(()=>controller.abort(),120000);
 try{
  await check();
  // 1) AI 가 고민의 뜻을 헤아려 말씀에서 찾을 낱말을 만든다(말씀 원문은 보내지 않는다)
  status('고민의 뜻을 헤아리고 있습니다…');
  const started=Date.now();let analysis=null,reserved=true;
  try{analysis=(await analyzeViaServer(config,token,'gemini-lite',worry,fetch,controller.signal)).analysis;}
  catch(e){
   if(controller.signal.aborted||e.status===401||e.status===403||e.status===429)throw e;
   // 서버가 아직 이 기능을 모르면(400) 호출이 없었던 것이다. 그 밖의 실패는 호출이 있었을 수 있다.
   reserved=e.status!==400;analysis=null;
  }
  if(mine!==epoch)return;
  // 2) 찾은 낱말로 올린 말씀에서 문단을 고른다
  const found=findEvidence(chunks,worry,analysis);
  if(!found.length){showAnswer({answer:{supported:false,overview:[],claims:[]}},[],analysis);status('찾은 말씀이 없습니다.');return;}
  // 3) 서버의 호출 간격(10초)을 채운 뒤, 찾은 말씀만 근거로 위로와 조언을 쓴다
  if(reserved){
   const left=GAP_MS()-(Date.now()-started);
   if(left>0){status(analysis?'말씀 '+found.length+'곳을 찾았습니다. 잠시 뒤 답을 씁니다…':'말씀 '+found.length+'곳을 찾았습니다…');await sleep(left,controller.signal);}
  }
  if(mine!==epoch)return;
  status('말씀 '+found.length+'곳을 읽고 답을 쓰고 있습니다…');
  const result=await generateViaServer(config,token,'gemini-lite',counselQuestion(worry,analysis,await loadCounselGuide()),found,true,fetch,controller.signal);
  if(mine!==epoch)return;
  showAnswer(result,found,analysis);status(analysis?'완료 · AI가 뜻으로 찾은 말씀만 근거로 했고 원문 인용을 확인했습니다.':'완료 · 낱말로 찾은 말씀만 근거로 했고 원문 인용을 확인했습니다. (AI 고민 분석은 쓰지 못했습니다)');
 }catch(e){
  if(mine!==epoch)return;
  status(e.name==='AbortError'?'답변 생성을 중단했습니다.':e.message,true);
 }finally{clearTimeout(timer);if(mine===epoch){setBusy(false);controller=null;}}
}
$('cancel').onclick=()=>controller?.abort();
$('composer').addEventListener('submit',e=>{e.preventDefault();void ask();});
$('worry').addEventListener('input',()=>{$('ask').disabled=busy||$('worry').value.trim().length<4;});

/* ===== 로그인·승인 (AI 챗봇과 같은 Google 로그인·같은 승인 명단을 쓴다) ===== */
function lock(){
 epoch++;authorized=false;controller?.abort();controller=null;busy=false;token='';chunks=[];
 $('worry').value='';$('answer').replaceChildren();$('sources').replaceChildren();$('crisis').classList.add('hidden');
 $('main').classList.add('hidden');$('gate').classList.remove('hidden');$('toggleSources').classList.add('hidden');status('');
}
function showUser(user){
 if(googleUser?.id!==user?.id)lock();
 googleUser=user;const signed=!!user;
 $('accountBox').classList.toggle('hidden',!signed);$('googleLogin').classList.toggle('hidden',signed);$('start').classList.add('hidden');
 if(signed){text($('signedAccount'),user.email||'Google 계정으로 로그인됨');text($('gateMessage'),'승인 상태를 확인하고 있습니다.');void refreshMembership(true);}
 else{text($('gateMessage'),'AI 챗봇과 같은 Google 계정·같은 승인으로 들어옵니다.');text($('signedAccount'),'');}
}
async function refreshMembership(enter=false){
 if(!googleUser||!authClient)return;
 const mine=epoch,id=googleUser.id;
 try{
  const access=await membershipStatus(authClient);
  if(mine!==epoch||id!==googleUser?.id)return;
  if(!access.approved&&authorized)lock();
  $('start').classList.toggle('hidden',!access.approved);
  text($('gateMessage'),access.approved?'승인된 계정입니다.':access.status==='pending'?'가입 신청이 완료되었습니다. 관리자가 승인하면 이용할 수 있습니다. (AI 챗봇 화면에서 가입 신청을 할 수 있습니다.)':'이용 승인이 되어 있지 않습니다. 관리자에게 문의해 주세요.');
  if(enter&&access.approved&&!authorized)await enter_();
 }catch(e){if(mine===epoch)text($('gateMessage'),e.message);}
}
async function enter_(){
 if($('start').disabled)return;$('start').disabled=true;
 const mine=epoch,pending=new AbortController(),timer=setTimeout(()=>pending.abort(),20000);
 try{
  const {data,error}=await authClient.auth.getSession();if(error||!data.session||data.session.user.id!==googleUser.id)throw new Error('Google로 다시 로그인해 주세요.');
  token=data.session.access_token;
  const info=await requestServer(config,token,{action:'status'},fetch,pending.signal);
  if(mine!==epoch)return;
  if(info.ready!==true||!Array.isArray(info.models))throw new Error('서버 응답을 확인하지 못했습니다.');
  authorized=true;$('gate').classList.add('hidden');$('main').classList.remove('hidden');
  try{await load();}catch(e){status(e.message,true);}
  $('worry').focus();
 }catch(e){if(mine===epoch){lock();text($('gateMessage'),e.name==='AbortError'?'서버 응답 시간이 초과됐습니다. 다시 시도해 주세요.':e instanceof TypeError?'서버 연결을 확인해 주세요.':e.message);}}
 finally{clearTimeout(timer);$('start').disabled=false;}
}
$('start').onclick=()=>void enter_();

async function boot(){
 try{
  if(!window.supabase?.createClient)throw new Error('Google 로그인 연결을 불러오지 못했습니다. 화면을 새로고침해 주세요.');
  // 저장 위치 이름이 AI 챗봇과 같아서 한쪽에서 로그인하면 다른 쪽에서도 로그인되어 있다
  authClient=window.supabase.createClient(config.supabaseUrl,config.supabaseAnonKey,{auth:{flowType:'pkce',storageKey:'sayeon-ai-google-session',persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
  const {data,error}=await authClient.auth.getSession();if(error)throw error;
  if(data.session){const v=await authClient.auth.getUser();if(v.error)throw v.error;showUser(v.data.user);}
  authClient.auth.onAuthStateChange((_e,session)=>{
   const user=session?.user;if(googleUser?.id===user?.id)return;
   if(!user){showUser(null);return;}
   setTimeout(async()=>{const mine=epoch,v=await authClient.auth.getUser();if(mine===epoch&&v.data.user?.id===user.id)showUser(v.error?null:v.data.user);},0);
  });
  const params=new URLSearchParams(location.search);
  if(params.has('code')||params.has('error'))history.replaceState(null,'',location.pathname);
 }catch{showUser(null);text($('gateMessage'),'Google 로그인 연결을 확인하지 못했습니다. 화면을 새로고침해 주세요.');}
}
$('googleLogin').onclick=async()=>{
 if(!authClient){text($('gateMessage'),'로그인 연결을 준비하고 있습니다. 잠시 후 다시 눌러 주세요.');return;}
 $('googleLogin').disabled=true;
 try{const {error}=await authClient.auth.signInWithOAuth({provider:'google',options:{redirectTo:new URL('./ai-lab.html',location.href).href,queryParams:{prompt:'select_account'}}});if(error)throw error;}
 catch{text($('gateMessage'),'Google 로그인을 시작하지 못했습니다. 다시 시도해 주세요.');$('googleLogin').disabled=false;}
};
$('logout').onclick=async()=>{const c=authClient;lock();showUser(null);try{await c?.auth.signOut({scope:'local'});}catch{}};
window.addEventListener('pagehide',lock);
window.addEventListener('pageshow',e=>{if(e.persisted){lock();showUser(googleUser);}});
window.addEventListener('load',boot,{once:true});if(document.readyState==='complete')void boot();
