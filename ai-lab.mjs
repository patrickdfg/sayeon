import {MODELS,SOURCES,toChunks,retrieve,generateViaServer,requestServer,clean,sourceCaption} from './admin/ai-core.mjs?v=8';
const $=id=>document.getElementById(id),config=window.SAYEON_ANALYTICS_CONFIG||{};
let token={password:'',clientId:''},authorized=false,chunks=[],cache=new Map(),controller=null,busy=false,providerStatus={};
const text=(el,s)=>{el.textContent=s;};
function showQuota(quota){
 $('usage').replaceChildren();
 for(const [provider,label] of [['gemini','Gemini'],['groq','Groq']]){
  const q=quota?.providers?.[provider],configured=providerStatus[provider]?.configured;
  const known=Number.isInteger(q?.remaining)&&Number.isInteger(q?.limit)&&q.limit>0;
  const percent=known?Math.round(Math.max(0,Math.min(q.limit,q.remaining))/q.limit*100):null;
  const value=configured===false?'연결 필요':percent===null?'업체별 집계 준비 중':percent+'% 남음';
  $('usage').append(node('div',label+' '+value));
 }
 if(quota?.unassignedUsed>0)$('usage').append(node('div','이전 사용 '+quota.unassignedUsed+'회는 공통 한도에 반영됩니다.','fine'));
}
function applyServerInfo(info){
 providerStatus=info.providers||{gemini:{configured:info.models.some(id=>id.startsWith('gemini-'))},groq:{configured:info.models.includes('groq-oss')}};
 document.querySelectorAll('#model option').forEach(o=>{if(o.value!=='search')o.disabled=!info.models.includes(o.value);});
 showQuota(info.quota);
 if(providerStatus.groq?.configured===false)text($('groqStatus'),'Groq 키 연결이 필요합니다.');
}
function status(s,error=false){text($('status'),s);$('status').classList.toggle('error',error);}
function clearAll(){controller?.abort();chunks=[];cache.clear();['contentPassword','question'].forEach(id=>$(id).value='');$('freeOnly').checked=true;text($('answer'),'질문하면 여기에 결과가 나옵니다.');text($('evidence'),'관련 원문을 먼저 찾아보세요.');text($('corpusStatus'),'기존 등록 자료를 자동으로 확인합니다.');status('');}
async function check(){if(!authorized||!token.password)throw new Error('AI 챗봇 비밀번호를 입력해 주세요.');}
function node(tag,s,cls){const el=document.createElement(tag);if(s!=null)el.textContent=s;if(cls)el.className=cls;return el;}
function link(doc){const a=node('a',sourceCaption(doc));if(doc.url){a.href=doc.url;a.target='_blank';a.rel='noopener noreferrer';}return a;}
function showEvidence(found){$('evidence').replaceChildren();if(!found.length){text($('evidence'),'등록된 자료에서 질문에 맞는 근거를 찾지 못했습니다. 질문을 구체적으로 바꿔 주세요.');return;}found.forEach(doc=>{const box=node('details',null,'source');box.append(node('summary',sourceCaption(doc)),node('p',doc.text),link(doc));$('evidence').append(box);});}
function overviewText(sections){
 return sections.map((section,i)=>(i+1)+'. '+section.title+'\n\n'+section.points.map(p=>'- '+p.label+': '+p.text).join('\n\n')).join('\n\n');
}
async function copyOverview(sections,button){
 if(!authorized||!token.password)return;
 button.disabled=true;
 try{
  const value=overviewText(sections);
  try{
   if(!navigator.clipboard?.writeText)throw new Error('clipboard unavailable');
   await navigator.clipboard.writeText(value);
  }catch{
   const input=document.createElement('textarea'),active=document.activeElement;
   input.value=value;input.setAttribute('readonly','');input.style.cssText='position:fixed;top:0;left:0;width:1px;height:1px;opacity:0';
   document.body.append(input);
   try{input.select();if(!document.execCommand('copy'))throw new Error('copy failed');}
   finally{input.remove();active?.focus();}
  }
  button.textContent='복사됨';button.title='출처를 제외한 종합 정리를 복사했습니다.';
 }catch{button.textContent='복사 실패';button.title='브라우저의 클립보드 권한을 확인해 주세요.';}
 finally{button.disabled=false;setTimeout(()=>{button.textContent='복사';button.title='출처를 제외하고 종합 정리 복사';},2000);}
}
function showAnswer(result){
 $('answer').replaceChildren();
 if(!result.answer.supported){text($('answer'),'등록된 자료에서 답을 뒷받침할 근거를 찾지 못했습니다.');return;}
 $('answer').append(node('p',result.model+' · 인용 원문 확인','fine'));
 if(result.answer.overview?.length){
  const overview=node('section',null,'overview'),heading=node('div',null,'overview-heading');
  const copy=node('button','복사','secondary overview-copy');copy.type='button';copy.title='출처를 제외하고 종합 정리 복사';copy.setAttribute('aria-label','출처를 제외하고 종합 정리 복사');
  copy.onclick=()=>copyOverview(result.answer.overview,copy);
  heading.append(node('h3','근거 원문 종합 정리'),copy);overview.append(heading);
  result.answer.overview.forEach((section,i)=>{
   overview.append(node('h4',(i+1)+'. '+section.title));
   const list=node('ul');
   section.points.forEach(p=>{
    const item=node('li');item.append(node('strong',p.label+': '),node('span',p.text));
    if(p.kind==='inference')item.append(node('span','자료를 종합한 해석','summary-kind'));
    const refs=node('div',null,'summary-refs');
    const seen=new Set();p.sources.forEach(s=>{if(!seen.has(s.id)){seen.add(s.id);refs.append(link(s.doc));}});
    item.append(refs);list.append(item);
   });overview.append(list);
  });$('answer').append(overview);
 }else $('answer').append(node('p','종합 정리를 사용하려면 AI 서버 코드를 업데이트해 주세요.','fine'));
 $('answer').append(node('h3','근거별 설명과 인용'));
 result.answer.claims.forEach(c=>{const box=node('article',null,'claim');box.append(node('span',c.kind==='inference'?'자료를 종합한 해석':'자료 근거 설명','badge'),node('p',c.text));c.sources.forEach(s=>{box.append(node('blockquote',s.quote),link(s.doc));});$('answer').append(box);});
}
function evidenceForQuestion(){const q=$('question').value.trim();if(q.length<2)throw new Error('질문을 두 글자 이상 입력해 주세요.');if(!chunks.length)throw new Error('기존 등록 원고를 아직 열지 못했습니다. 아래 원고 암호 또는 연결 상태를 확인해 주세요.');return {q,found:retrieve(chunks,q,$('scope').value)};}
function setBusy(value){busy=value;['ask','preview','loadCorpus','unlock','serverCheck','groqReconnect'].forEach(id=>$(id).disabled=value);$('cancel').disabled=!value;}
async function operation(fn){if(busy){status('요청이 진행 중입니다. 기다리거나 중단 버튼을 눌러 주세요.');return;}controller=new AbortController();setBusy(true);const timeout=setTimeout(()=>controller?.abort(),60000);try{status('접속 확인 중…');await check();await fn();}catch(e){status(e.name==='AbortError'?'요청을 중단했습니다. 원문 검색은 다시 사용할 수 있습니다.':e.message,true);}finally{clearTimeout(timeout);setBusy(false);controller=null;}}
async function load(){status('기존 등록 말씀·사연을 자동으로 확인하는 중…');if(!window.SaCrypt.ready()&&!await window.SaCrypt.resume()){$('unlockBox').classList.remove('hidden');text($('corpusStatus'),'기존 원고가 잠겨 있습니다. 앱에서 사용하던 원고 암호로 열면 등록 자료 전체에서 검색합니다.');status('새 자료 업로드 없이 기존 원고를 사용합니다.');return;}const results=await Promise.allSettled(SOURCES.map(async source=>toChunks(await window.SaCrypt.json(source.url),source)));if(controller.signal.aborted||!authorized)return;const docs=[],ok=[],failed=[];results.forEach((r,i)=>{if(r.status==='fulfilled'){docs.push(...r.value);ok.push(SOURCES[i].label+': '+r.value.length+'문단');}else failed.push(SOURCES[i].label);});chunks=docs;cache.clear();$('unlockBox').classList.add('hidden');$('contentPassword').value='';text($('corpusStatus'),ok.join(' / ')+(failed.length?'\n불러오지 못한 자료: '+failed.join(', '):'')+'\n총 '+chunks.length+'문단 · 새 원고는 화면 새로고침 시 자동 반영');status(failed.length?'일부 자료를 불러오지 못했습니다. 불러온 자료만 검색합니다.':'기존 등록 자료에서 바로 질문할 수 있습니다.',!!failed.length);}
$('loadCorpus').onclick=()=>operation(load);
$('unlock').onclick=()=>operation(async()=>{if(!await window.SaCrypt.unlock($('contentPassword').value))throw new Error('원고 암호를 확인해 주세요.');await load();});
async function serverInfo(){
 const pending=new AbortController(),parent=controller?.signal;
 const abort=()=>pending.abort();parent?.addEventListener('abort',abort,{once:true});
 if(parent?.aborted)pending.abort();
 let timedOut=false;const timer=setTimeout(()=>{timedOut=true;pending.abort();},15000);
 text($('serverStatus'),'서버 응답 확인 중… (최대 15초)');
 try{
  const d=await requestServer(config,token,{action:'status'},fetch,pending.signal);
  if(d.ready!==true||!Array.isArray(d.models))throw new Error('서버 연결 응답을 확인하지 못했습니다.');
  text($('serverStatus'),'서버 연결됨 · 키는 Supabase에만 보관됩니다.');
  applyServerInfo(d);
 }catch(e){
  const message=timedOut?'서버가 15초 안에 응답하지 않았습니다.':e.name==='AbortError'?'서버 확인을 중단했습니다.':e instanceof TypeError?'서버 연결 실패: 배포 함수의 주소·CORS·인증 설정 확인이 필요합니다.':e.message;
  text($('serverStatus'),message+' 원문 검색은 계속 사용할 수 있습니다.');
 }finally{clearTimeout(timer);parent?.removeEventListener('abort',abort);}
}
$('serverCheck').onclick=()=>{text($('serverStatus'),busy?'다른 요청 진행 중입니다. 중단 후 다시 확인해 주세요.':'접속 확인 중…');return operation(serverInfo);};
$('model').onchange=()=>{$('keyBox').classList.add('hidden');};
$('groqReconnect').onclick=()=>operation(async()=>{
 text($('groqStatus'),'Groq 연결 확인 중…');
 try{
  const result=await requestServer(config,token,{action:'check-provider',provider:'groq'},fetch,controller.signal);
  await serverInfo();
  text($('groqStatus'),result.message||'Groq 연결 결과를 확인하지 못했습니다.');
  if(result.reason==='key_missing'){
   const a=node('a','Supabase Secrets 열기');a.href='https://supabase.com/dashboard/project/maoylwwnluyyfmwqfkfl/functions/secrets';a.target='_blank';a.rel='noopener noreferrer';$('groqStatus').append(node('br'),a);
  }
 }catch(e){text($('groqStatus'),e.name==='AbortError'?'Groq 연결 확인을 중단했습니다.':e.message);throw e;}
});
$('preview').onclick=()=>operation(async()=>{const {found}=evidenceForQuestion();showEvidence(found);text($('answer'),'원문 검색 결과입니다. AI 답변을 생성하지 않았습니다.');status(found.length+'개 관련 문단 · API 사용 없음');});
$('ask').onclick=()=>operation(async()=>{
 const {q,found}=evidenceForQuestion();showEvidence(found);text($('answer'),'');if(!found.length){text($('answer'),'등록된 자료에서 답을 찾지 못했습니다.');status('근거 부족 · AI를 호출하지 않았습니다.');return;}
 const modelId=$('model').value;if(modelId==='search'){text($('answer'),'아래 검색 결과에서 원문과 출처를 확인해 주세요.');status('원문 검색만 실행 · API 사용 없음');return;}
 if(!$('freeOnly').checked)throw new Error('결제를 연결하지 않은 무료 등급 API 키인지 먼저 확인해 주세요.');const model=MODELS[modelId];if(!model)throw new Error('모델을 선택해 주세요.');
 const ck=JSON.stringify([modelId,clean(q),$('scope').value,found.map(c=>[c.id,c.text])]);if($('useCache').checked&&cache.has(ck)){showAnswer(cache.get(ck));status('이 화면에 저장된 동일 질문 답변 재사용 · 새 API 호출 없음');return;}
 status(model.label+' 답변 생성 중…');
 let result;try{result=await generateViaServer(config,token,modelId,q,found,true,fetch,controller.signal);}catch(e){if(!controller.signal.aborted&&authorized)await serverInfo();if(e instanceof TypeError)throw new Error('AI 서버에 연결하지 못했습니다. 서버 연결 상태를 확인해 주세요.');throw e;}
 if(controller.signal.aborted||!authorized)return;showAnswer(result);cache.set(ck,result);showQuota(result.quota);status('완료 · 원문 인용 검사 통과');
});
$('cancel').onclick=()=>controller?.abort();$('clear').onclick=()=>{controller?.abort();cache.clear();['question'].forEach(id=>$(id).value='');$('freeOnly').checked=true;text($('answer'),'질문하면 여기에 결과가 나옵니다.');text($('evidence'),'관련 원문을 먼저 찾아보세요.');status('답변을 지웠습니다. 기존 등록 자료는 그대로 검색할 수 있습니다.');};$('logout').onclick=()=>{authorized=false;clearAll();token.password='';$('lab').classList.add('hidden');$('gate').classList.remove('hidden');text($('gateMessage'),'비밀번호를 입력해 주세요.');$('aiPassword').focus();};document.querySelectorAll('.example').forEach(b=>b.onclick=()=>{$('question').value=b.textContent;});window.addEventListener('pagehide',()=>{authorized=false;token.password='';clearAll();});window.addEventListener('pageshow',event=>{if(event.persisted){$('lab').classList.add('hidden');$('gate').classList.remove('hidden');text($('gateMessage'),'비밀번호를 다시 입력해 주세요.');}});
$('loginForm').onsubmit=async event=>{
 event.preventDefault();if($('login').disabled)return;
 $('login').disabled=true;const pending=new AbortController(),timer=setTimeout(()=>pending.abort(),15000);
 try{
  let clientId='';try{clientId=localStorage.getItem('aiLabClient')||'';}catch{}
  if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(clientId)){clientId=crypto.randomUUID();try{localStorage.setItem('aiLabClient',clientId);}catch{}}
  token={password:$('aiPassword').value,clientId};text($('gateMessage'),'비밀번호 확인 중…');
  const info=await requestServer(config,token,{action:'status'},fetch,pending.signal);
  if(!token.password||pending.signal.aborted)return;
  if(info.ready!==true||!Array.isArray(info.models))throw new Error('서버 응답을 확인하지 못했습니다.');
  authorized=true;$('aiPassword').value='';$('gate').classList.add('hidden');$('lab').classList.remove('hidden');
  text($('serverStatus'),'서버 연결됨 · 비밀번호 확인 완료');applyServerInfo(info);
  await operation(load);
 }catch(e){authorized=false;token.password='';text($('gateMessage'),e.name==='AbortError'?'서버 응답 시간이 초과됐습니다. 잠시 후 다시 시도해 주세요.':e instanceof TypeError?'서버 연결을 확인해 주세요.':e.message);}
 finally{clearTimeout(timer);$('login').disabled=false;}
};

