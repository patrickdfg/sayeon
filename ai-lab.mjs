import {saveOverview} from './ai-export.mjs?v=1';
import {MODELS,SOURCES,toChunks,retrieve,generateViaServer,requestServer,clean,sourceCaption,resolveQuestion,wholeRequest,checkWholeCoverage,normalizeScope} from './admin/ai-core.mjs?v=17';
import {newThread,makeMessage,packResult,unpackResult,pendingConversation,followUpEvidence,followUpQuestion,createChatStore} from './ai-chat.mjs?v=4';
import {MEMBER_LABELS,membershipStatus,createMemberStore} from './ai-members.mjs?v=1';
const $=id=>document.getElementById(id),config=window.SAYEON_ANALYTICS_CONFIG||{};
let token='',authorized=false,chunks=[],cache=new Map(),controller=null,busy=false,providerStatus={};
let googleUser=null,authClient=null,chatStore=null,thread=newThread(),threads=[],savedMessageIds=new Set(),dirty=false,saveConflict=false,sessionVersion=0,historySequence=0,historyOffset=0,dialogThread=null,currentTurn=null;
const text=(el,s)=>{el.textContent=s;};
function showQuota(quota){
 $('usage').replaceChildren();
 for(const [provider,label] of [['gemini','Gemini']]){
  const q=quota?.providers?.[provider],configured=providerStatus[provider]?.configured;
  const known=Number.isInteger(q?.remaining)&&Number.isInteger(q?.limit)&&q.limit>0;
  const percent=known?Math.round(Math.max(0,Math.min(q.limit,q.remaining))/q.limit*100):null;
  const value=configured===false?'연결 필요':percent===null?'업체별 집계 준비 중':percent+'% 남음';
  $('usage').append(node('div',label+' '+value));
 }
 if(quota?.unassignedUsed>0)$('usage').append(node('div','이전 사용 '+quota.unassignedUsed+'회는 공통 한도에 반영됩니다.','fine'));
}
function applyServerInfo(info){
 providerStatus=info.providers||{gemini:{configured:info.models.some(id=>id.startsWith('gemini-'))}};
 document.querySelectorAll('#model option').forEach(o=>{if(o.value!=='search')o.disabled=!info.models.includes(o.value);});
 showQuota(info.quota);
}
function status(s,error=false){text($('status'),s);$('status').classList.toggle('error',error);$('status').classList.toggle('quiet',!error&&/^(완료|기존 등록|저장된 답변|원문 검색|새 자료)/.test(s));}
async function check(){
 if(!authorized||!googleUser)throw new Error('승인된 Google 계정으로 로그인해 주세요.');
 const access=await refreshMembership();if(!access?.approved||!authorized)throw new Error('관리자 승인 후 이용할 수 있습니다.');
 const {data,error}=await authClient.auth.getSession();
 if(error||!data.session||data.session.user.id!==googleUser.id)throw new Error('Google로 다시 로그인해 주세요.');
 token=data.session.access_token;
}
function node(tag,s,cls){const el=document.createElement(tag);if(s!=null)el.textContent=s;if(cls)el.className=cls;return el;}
function link(doc){const a=node('a',sourceCaption(doc));if(doc.url){try{const url=new URL(doc.url,'https://patrickdfg.github.io');if(url.origin==='https://patrickdfg.github.io'&&/^\/(?:sayeon|malsseum)\//.test(url.pathname)){a.href=url.href;a.target='_blank';a.rel='noopener noreferrer';}}catch{}}return a;}
function showEvidence(found,target=$('evidence')){target.replaceChildren();if(!found.length){text(target,'등록된 자료에서 질문에 맞는 근거를 찾지 못했습니다. 질문을 구체적으로 바꿔 주세요.');return;}found.forEach(doc=>{const box=node('details',null,'source');box.append(node('summary',sourceCaption(doc)),node('p',doc.text),link(doc));target.append(box);});}
function overviewText(sections){
 return sections.map((section,i)=>(i+1)+'. '+section.title+'\n\n'+section.points.map(p=>'- '+p.label+': '+p.text).join('\n\n')).join('\n\n');
}
async function copyText(value,button){
 if(!authorized||!token)return;
 const original=button.textContent,originalTitle=button.title;button.disabled=true;
 try{
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
 finally{button.disabled=false;setTimeout(()=>{button.textContent=original;button.title=originalTitle;},2000);}
}
async function copyOverview(sections,button){return copyText(overviewText(sections),button);}
function showAnswer(result,target=$('answer'),questionText=$('question').value.trim()){
 target.replaceChildren();
 if(!result.answer.supported){text(target,'등록된 자료에서 답을 뒷받침할 근거를 찾지 못했습니다.');return;}
 const docs=new Map(),sections=result.answer.overview||[];
 const remember=s=>{if(s.doc&&!docs.has(s.id))docs.set(s.id,s.doc);};
 const quoteBox=s=>{
  remember(s);const box=node('blockquote',null,'answer-quote');box.append(node('p',s.quote));
  const cite=node('cite');cite.append(link(s.doc));box.append(cite);return box;
 };
 const meta=node('p',result.model+(result.usedBackup?' · 보조키로 처리':'')+' · 원문 확인','answer-meta');target.append(meta);
 if(result.wholeTitle)target.append(node('p',result.wholeTitle+(result.wholeIntent==='organize'?' · 전체 정리':result.wholeIntent==='summary'?' · 전체 요약':''),'answer-context'));
 const overview=node('section',null,'overview');
 sections.forEach((section,i)=>{
  const part=node('section',null,'answer-section');part.append(node('h3',(i+1)+'. '+section.title));
  const quotes=new Map();
  section.points.forEach(p=>{
   const paragraph=node('p',null,'answer-paragraph');paragraph.append(node('strong',p.label+'. '),node('span',p.text));part.append(paragraph);
   if(p.kind==='inference')part.append(node('span','자료를 종합한 해석','summary-kind'));
   p.sources.forEach(source=>{remember(source);const key=source.id+'\n'+source.quote;if(!quotes.has(key))quotes.set(key,source);});
  });
  for(const source of quotes.values())part.append(quoteBox(source));overview.append(part);
 });
 target.append(overview);
 const claims=node(sections.length?'details':'section',null,'answer-support');
 if(sections.length)claims.append(node('summary','근거별 설명 더 보기'));
 else claims.append(node('h3','근거별 설명'));
 result.answer.claims.forEach(c=>{
  const box=node('article',null,'claim');box.append(node('p',c.text));
  if(c.kind==='inference')box.append(node('span','자료를 종합한 해석','summary-kind'));
  c.sources.forEach(source=>box.append(quoteBox(source)));claims.append(box);
 });target.append(claims);
 if(docs.size){
  const references=node('section',null,'answer-references');references.append(node('h3','인용 출처'));
  const list=node('ul');for(const doc of docs.values()){const item=node('li');item.append(link(doc));list.append(item);}references.append(list);target.append(references);
 }
 if(sections.length){
  const actions=node('div',null,'answer-actions');
  const copy=node('button','복사','tool-button ui-copy');copy.type='button';copy.title='출처를 제외하고 종합 정리 복사';copy.setAttribute('aria-label',copy.title);copy.onclick=()=>copyOverview(sections,copy);actions.append(copy);
  const mapButton=node('button','마인드맵','tool-button ui-map');mapButton.type='button';mapButton.setAttribute('aria-expanded','false');actions.append(mapButton);
  const map=node('div',null,'mindmap hidden');map.setAttribute('role','region');map.setAttribute('aria-label','요약 마인드맵');
  map.append(node('div',result.wholeTitle||questionText||'원문 종합 정리','mindmap-root'));
  const branches=node('ul',null,'mindmap-branches');
  result.answer.overview.forEach(section=>{
   const branch=node('li',null,'mindmap-branch');branch.append(node('strong',section.title,'mindmap-topic'));
   const leaves=node('ul');section.points.forEach(p=>{const leaf=node('li');const detail=node('details');detail.append(node('summary',p.label),node('p',p.text));leaf.append(detail);leaves.append(leaf);});branch.append(leaves);branches.append(branch);
  });map.append(branches);target.append(map);
  mapButton.onclick=()=>{const open=map.classList.toggle('hidden')===false;mapButton.setAttribute('aria-expanded',String(open));mapButton.textContent=open?'마인드맵 닫기':'마인드맵';};

  const saveMenu=node('details',null,'save-menu');saveMenu.append(node('summary','문서 저장'));
  const documentTitle=(result.wholeTitle||questionText||'원문 종합 정리')+(result.wholeIntent==='organize'?' 상세 정리':result.wholeIntent==='summary'?' 핵심 요약':'');
  for(const [format,label] of [['docx','DOCX 저장'],['hwpx','HWPX 저장']]){
   const save=node('button',label,'tool-button');save.type='button';save.onclick=async()=>{if(!authorized||!token)return;save.disabled=true;try{await saveOverview(documentTitle,sections,format);save.textContent='저장 요청됨';}catch(e){status(e.message,true);}finally{save.disabled=false;setTimeout(()=>{save.textContent=label;},2000);}};saveMenu.append(save);
  }
  actions.append(saveMenu);target.append(actions);
 }
}
function evidenceForQuestion(){const q=$('question').value.trim();if(q.length<2)throw new Error('질문을 두 글자 이상 입력해 주세요.');const previous=thread.scope===$('scope').value?followUpEvidence(q,thread.messages):null;if(previous)return {q,...previous};if(!chunks.length){toggleSettings(true);throw new Error('자료·설정에서 기존 원고 암호를 입력해 주세요.');}return {q,...resolveQuestion(chunks,q,$('scope').value)};}
function setBusy(value){
 busy=value;['ask','preview','loadCorpus','unlock','serverCheck','clear','newChatHeader','model','scope','historySearch','moreHistory','retrySave','saveAsNew'].forEach(id=>$(id).disabled=value);
 document.querySelectorAll('.question-actions button[aria-label="질문 다시 쓰기"]').forEach(button=>button.disabled=value);
 $('cancel').disabled=!value;$('cancel').classList.toggle('hidden',!value);$('ask').classList.toggle('hidden',value);syncSendButton();
}
async function operation(fn,timeoutMs=60000){
 if(busy){status('요청이 진행 중입니다. 기다리거나 중단 버튼을 눌러 주세요.');return;}
 controller=new AbortController();const active=controller,epoch=sessionVersion;setBusy(true);
 const timeout=setTimeout(()=>active.abort(),timeoutMs);
 try{await check();await fn();}
 catch(e){
  if(epoch!==sessionVersion)return;
  const message=e.name==='AbortError'?'답변 생성을 중단했습니다.':e.message;
  status(message,true);
  if(currentTurn&&authorized&&thread.id===currentTurn.threadId){
   thread.messages.push(makeMessage('assistant',message,{failed:true}));drawConversation(true);
   if(!dirty)await persistThread();else setSaveState('저장되지 않은 대화가 있습니다.',true);
  }
 }finally{clearTimeout(timeout);if(controller===active){setBusy(false);controller=null;currentTurn=null;if(authorized){drawConversation(false);drawThreads();}}}
}
async function load(){status('기존 등록 말씀·사연을 자동으로 확인하는 중…');if(!window.SaCrypt.ready()&&!await window.SaCrypt.resume()){$('unlockBox').classList.remove('hidden');toggleSettings(true);text($('corpusStatus'),'기존 원고가 잠겨 있습니다. 앱에서 사용하던 원고 암호로 열면 등록 자료 전체에서 검색합니다.');status('새 자료 업로드 없이 기존 원고를 사용합니다.');return;}const results=await Promise.allSettled(SOURCES.map(async source=>toChunks(await window.SaCrypt.json(source.url),source)));if(controller.signal.aborted||!authorized)return;const docs=[],ok=[],failed=[];results.forEach((r,i)=>{if(r.status==='fulfilled'){docs.push(...r.value);const group=SOURCES[i].key.startsWith('sayeon')?'성령사연':SOURCES[i].label;ok.push({group,count:r.value.length});}else failed.push(SOURCES[i].label);});chunks=docs;cache.clear();$('unlockBox').classList.add('hidden');$('contentPassword').value='';text($('corpusStatus'),[...new Set(ok.map(v=>v.group))].map(group=>group+': '+ok.filter(v=>v.group===group).reduce((n,v)=>n+v.count,0)+'문단').join(' / ')+(failed.length?'\n불러오지 못한 자료: '+failed.join(', '):'')+'\n총 '+chunks.length+'문단 · 새 원고는 화면 새로고침 시 자동 반영');status(failed.length?'일부 자료를 불러오지 못했습니다. 불러온 자료만 검색합니다.':'기존 등록 자료에서 바로 질문할 수 있습니다.',!!failed.length);}
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
async function persistThread(){
 if(!authorized||!googleUser||!chatStore)return false;
 const epoch=sessionVersion,savingThread=thread;dirty=true;setSaveState('대화 저장 중…');
 try{
  const saved=await chatStore.save(savingThread);
  if(epoch!==sessionVersion||savingThread!==thread||!authorized)return false;
  Object.assign(thread,saved);savedMessageIds=new Set(thread.messages.map(message=>message.id));dirty=false;saveConflict=false;setSaveState('나의 계정에 저장됨');
  await loadHistory(false);return true;
 }catch(e){
  if(epoch!==sessionVersion)return false;
  saveConflict=!!e.conflict;setSaveState(e.message,true);return false;
 }
}
function setSaveState(message,error=false){
 text($('saveStatus'),message);$('saveStatus').classList.toggle('error',error);
 $('retrySave').classList.toggle('hidden',!error||saveConflict);$('saveAsNew').classList.toggle('hidden',!error);
}
function toggleSettings(open){$('settingsPanel').classList.toggle('hidden',!open);$('openSettings').setAttribute('aria-expanded',String(open));}
let desktopSidebarCollapsed=false;
const mobileSidebar=window.matchMedia?.('(max-width:760px)');
function toggleSidebar(open){
 if(mobileSidebar?.matches){$('sidebar').classList.toggle('open',open);$('sidebarBackdrop').classList.toggle('hidden',!open);}
 else{desktopSidebarCollapsed=!open;$('lab').classList.toggle('sidebar-collapsed',!open);}
 syncSidebarAccess();
 if(open&&mobileSidebar?.matches)$('closeSidebar').focus();else $('openSidebar').focus();
}
function syncSidebarAccess(){
 const mobile=!!mobileSidebar?.matches,open=$('sidebar').classList.contains('open');
 $('sidebar').inert=mobile?!open:desktopSidebarCollapsed;$('chatMain').inert=mobile&&open;
 const visible=mobile?open:!desktopSidebarCollapsed;$('sidebarBackdrop').classList.toggle('hidden',!mobile||!open);$('openSidebar').setAttribute('aria-expanded',String(visible));$('openSidebar').setAttribute('aria-label',visible?'대화 목록 접기':'대화 목록 열기');
}
mobileSidebar?.addEventListener('change',syncSidebarAccess);syncSidebarAccess();
function updateScrollButton(){
 const area=$('messageScroll');$('scrollBottom').classList.toggle('hidden',!authorized||area.scrollHeight-area.scrollTop-area.clientHeight<100||!thread.messages.length);
}
$('messageScroll').addEventListener('scroll',updateScrollButton,{passive:true});
$('scrollBottom').onclick=()=>{const area=$('messageScroll');area.scrollTop=area.scrollHeight;};
if(typeof ResizeObserver==='function')new ResizeObserver(entries=>{
 $('chatMain').style.setProperty('--composer-height',$('composer').parentElement.offsetHeight+'px');updateScrollButton();
}).observe($('composer').parentElement);
function questionActions(content){
 const actions=node('div',null,'question-actions'),copy=node('button','복사','tool-button ui-copy'),edit=node('button','다시 쓰기','tool-button ui-edit');copy.type=edit.type='button';
 copy.setAttribute('aria-label','질문 복사');edit.setAttribute('aria-label','질문 다시 쓰기');copy.onclick=()=>copyText(content,copy);
 edit.disabled=busy;edit.onclick=()=>{if(busy||!authorized)return;$('question').value=content;resizeQuestion();$('question').focus();};actions.append(copy,edit);return actions;
}
function drawConversation(scroll=false){
 const box=$('conversation');box.replaceChildren();box.classList.toggle('hidden',thread.messages.length===0);$('welcome').classList.toggle('hidden',thread.messages.length>0);
 let question='';
 for(const message of thread.messages){
  const article=node('article',null,'message '+(message.role==='user'?'message-user':'message-assistant'));
  if(message.role==='user'){question=message.content;article.append(node('div',message.content,'user-bubble'),questionActions(message.content));}
  else{
   const label=node('div',null,'assistant-label');label.append(node('span','✦'),node('strong',message.failed?'답변 안내':'말씀과 사연'));article.append(label);
   const content=node('div',null,'assistant-content');
   try{const result=unpackResult(message);if(result)showAnswer(result,content,question);else content.append(node('p',message.content||'원문 검색 결과입니다.'));}
   catch{content.append(node('p','저장된 답변의 인용을 확인하지 못했습니다. 원문을 다시 검색해 주세요.','error'));}
   article.append(content);
   if(message.evidence?.length){
    const sources=node('details',null,'message-source');sources.append(node('summary',message.evidence.length===1&&message.evidence[0].whole?'원문 보기 · 원고 전체 1편':'원문 보기 · '+message.evidence.length+'개 근거'));
    const evidence=node('div');showEvidence(message.evidence,evidence);sources.append(evidence);article.append(sources);
   }
  }
  box.append(article);
 }
 if(busy&&currentTurn&&thread.messages.at(-1)?.role==='user'){
  const pending=node('div',null,'pending-message'),dots=node('span',null,'pending-dots');dots.append(node('i'),node('i'),node('i'));pending.append(dots,node('span','원문을 읽고 답변을 준비하고 있습니다…'));box.append(pending);
 }
 if(scroll){const area=$('messageScroll');area.scrollTop=area.scrollHeight;}
 if(typeof requestAnimationFrame==='function')requestAnimationFrame(updateScrollButton);
}
function drawThreads(){
 $('threadList').replaceChildren();
 for(const row of threads){
  const item=node('div',null,'thread-row'+(row.id===thread.id?' active':'')),button=node('button',row.title,'thread-button'),menu=node('button','⋯','thread-menu');
  button.type=menu.type='button';button.title=row.title;button.setAttribute('aria-current',row.id===thread.id?'page':'false');button.disabled=menu.disabled=busy;
  button.onclick=()=>openThread(row.id);menu.setAttribute('aria-label',row.title+' 제목 변경 및 삭제');menu.onclick=()=>openThreadMenu(row);
  item.append(button,menu);$('threadList').append(item);
 }
 if(!threads.length)$('threadList').append(node('p',$('historySearch').value.trim()?'찾는 대화가 없습니다.':'첫 질문을 보내면 여기에 대화가 남습니다.','sidebar-status'));
}
async function loadHistory(append=false){
 if(!authorized||!chatStore)return;
 const epoch=sessionVersion,sequence=++historySequence,offset=append?historyOffset:0;
 try{
  const rows=await chatStore.list(offset,$('historySearch').value);
  if(epoch!==sessionVersion||sequence!==historySequence||!authorized)return;
  threads=append?[...new Map([...threads,...rows].map(t=>[t.id,t])).values()]:rows;historyOffset=offset+rows.length;
  $('moreHistory').classList.toggle('hidden',rows.length<50);text($('historyStatus'),'');drawThreads();
 }catch(e){if(epoch===sessionVersion&&sequence===historySequence)text($('historyStatus'),e.message);}
}
async function openThread(id){
 if(busy)return;if(dirty){setSaveState('현재 대화를 먼저 저장해 주세요.',true);return;}
 const epoch=sessionVersion;setBusy(true);text($('historyStatus'),'대화 불러오는 중…');
 try{
  const loaded=await chatStore.load(id);if(epoch!==sessionVersion||!authorized)return;
  thread={...loaded,scope:normalizeScope(loaded.scope),model_id:Object.hasOwn(MODELS,loaded.model_id)||loaded.model_id==='search'?loaded.model_id:'gemini-lite'};savedMessageIds=new Set(thread.messages.map(message=>message.id));cache.clear();$('model').value=Object.hasOwn(MODELS,thread.model_id)||thread.model_id==='search'?thread.model_id:'gemini-lite';$('scope').value=thread.scope;
  $('question').value='';resizeQuestion();drawConversation(true);drawThreads();setSaveState('나의 계정에 저장됨');status('');if(mobileSidebar?.matches)toggleSidebar(false);
 }catch(e){if(epoch===sessionVersion)status(e.message,true);}
 finally{if(epoch===sessionVersion){setBusy(false);text($('historyStatus'),'');drawThreads();}}
}
function startNew(){
 if(busy)return;if(dirty){setSaveState('현재 대화를 먼저 저장해 주세요.',true);return;}
 thread=newThread();savedMessageIds=new Set();thread.model_id=$('model').value||'gemini-lite';thread.scope=$('scope').value||'all';cache.clear();$('question').value='';
 text($('answer'),'질문하면 여기에 결과가 나옵니다.');text($('evidence'),'관련 원문을 먼저 찾아보세요.');$('freeOnly').checked=true;
 resizeQuestion();drawConversation();drawThreads();setSaveState('');status('');if(mobileSidebar?.matches)toggleSidebar(false);$('question').focus();
}
function openThreadMenu(row){
 if(busy||dirty)return;dialogThread=row;$('renameInput').value=row.title;text($('dialogTitle'),'대화 관리');text($('dialogDescription'),'제목을 바꾸거나 이 대화를 삭제할 수 있습니다.');
 $('renameLabel').classList.remove('hidden');$('renameInput').classList.remove('hidden');$('dialogConfirm').textContent='제목 저장';$('dialogDelete').classList.remove('hidden');text($('dialogError'),'');$('threadDialog').showModal();$('renameInput').focus();
}
$('threadDialogForm').onsubmit=async event=>{
 event.preventDefault();if(!dialogThread||$('dialogConfirm').disabled)return;
 const epoch=sessionVersion;$('dialogConfirm').disabled=true;
 try{const updated=await chatStore.rename(dialogThread,$('renameInput').value);if(epoch!==sessionVersion)return;if(thread.id===updated.id)Object.assign(thread,updated);$('threadDialog').close();await loadHistory();}
 catch(e){if(epoch===sessionVersion)text($('dialogError'),e.message);}
 finally{$('dialogConfirm').disabled=false;}
};
$('dialogDelete').onclick=async()=>{
 if(!dialogThread||$('dialogDelete').disabled)return;
 if($('dialogDelete').dataset.confirmed!=='yes'){
  $('dialogDelete').dataset.confirmed='yes';$('dialogDelete').textContent='삭제 확인';text($('dialogDescription'),'이 대화의 질문과 답변을 모두 삭제합니다. 다른 기기에서도 삭제되며 되돌릴 수 없습니다.');return;
 }
 const epoch=sessionVersion;$('dialogDelete').disabled=true;
 try{await chatStore.remove(dialogThread.id);if(epoch!==sessionVersion)return;if(thread.id===dialogThread.id){dirty=false;startNew();}$('threadDialog').close();await loadHistory();}
 catch(e){if(epoch===sessionVersion)text($('dialogError'),e.message);}
 finally{$('dialogDelete').disabled=false;}
};
$('threadDialog').addEventListener('close',()=>{$('dialogDelete').dataset.confirmed='';$('dialogDelete').textContent='대화 삭제';dialogThread=null;});
$('dialogCancel').onclick=()=>$('threadDialog').close();
$('preview').onclick=()=>sendQuestion(true);
$('ask').onclick=event=>{event?.preventDefault();return sendQuestion(false);};
$('composer').onsubmit=event=>{event.preventDefault();return sendQuestion(false);};
async function sendQuestion(previewOnly=false){
 if(dirty){setSaveState('현재 대화를 먼저 저장해 주세요.',true);return;}
 return operation(async()=>{
  const {q,found,mode,title,intent,followUp,outline}=evidenceForQuestion(),modelId=$('model').value;
  showEvidence(found);text($('answer'),'');
  if(modelId!=='search'&&!previewOnly&&!$('freeOnly').checked)throw new Error('무료 등급 API 키 확인이 필요합니다.');
  if(thread.messages.length>=119)throw new Error('이 대화의 저장 용량에 도달했습니다. 새 대화를 시작해 주세요.');
  if(!thread.messages.length)thread.title=q.slice(0,80);
  thread.model_id=modelId;thread.scope=$('scope').value;
  thread.messages.push(makeMessage('user',q));currentTurn={threadId:thread.id};drawConversation(true);
  if(!await persistThread())throw new Error('질문을 저장하지 못해 답변 생성을 보류했습니다. 저장을 다시 시도해 주세요.');
  if(!authorized)return;if(controller.signal.aborted)throw new DOMException('Aborted','AbortError');
  $('question').value='';resizeQuestion();
  if(previewOnly||modelId==='search'||!found.length){
   const content=!found.length?'등록된 자료에서 질문에 맞는 근거를 찾지 못했습니다. 날짜나 주제를 구체적으로 알려 주세요.':'관련 원문을 찾았습니다. 아래에서 원문과 출처를 확인해 주세요.';
   thread.messages.push(makeMessage('assistant',content,{evidence:found,title}));text($('answer'),content);drawConversation(true);await persistThread();status('원문 검색 · AI 호출 없음');return;
  }
  const model=MODELS[modelId];if(!model)throw new Error('모델을 선택해 주세요.');
  const instruction=mode==='whole'&&intent?wholeRequest(title,intent):null;
  const combined=instruction?instruction+' 사용자 요청: '+q:'';
  const question=instruction?(combined.length<=600?combined:q):followUp?followUpQuestion(q,outline):q;
  const ck=JSON.stringify([modelId,clean(question),$('scope').value,found.map(c=>[c.id,c.text])]);
  let result;
  if($('useCache').checked&&cache.has(ck)){result=cache.get(ck);status('저장된 답변 재사용 · 새 AI 호출 없음');}
  else{
   status(mode==='whole'?title+' · 원고 한 편 전체를 읽는 중…':model.label+' 답변 생성 중…');
   try{result=await generateViaServer(config,token,modelId,question,found,true,fetch,controller.signal,mode==='whole');}
   catch(e){if(!controller.signal.aborted&&authorized)await serverInfo();throw e;}
   if(mode==='whole'){checkWholeCoverage(result.answer,found,intent);result={...result,wholeTitle:title,wholeIntent:intent};}
   cache.set(ck,result);showQuota(result.quota);
  }
  if(!authorized)return;if(controller.signal.aborted)throw new DOMException('Aborted','AbortError');
  showAnswer(result,$('answer'),q);thread.messages.push(makeMessage('assistant','',{result:packResult(result),evidence:found,title}));drawConversation(true);await persistThread();
  status(mode==='whole'?'완료 · 원고 전체 한 편 · '+(result.attempts===2?2:1)+'회 사용 · 원문 인용 확인':'완료 · 원문 인용 확인');
 },120000);
}
function syncSendButton(){$('ask').disabled=busy||!authorized||$('question').value.trim().length<2;}
function resizeQuestion(){$('question').style.height='auto';$('question').style.height=Math.min(160,$('question').scrollHeight||43)+'px';syncSendButton();}
$('question').addEventListener('input',resizeQuestion);
$('question').addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing&&event.keyCode!==229){event.preventDefault();void sendQuestion(false);}});
$('cancel').onclick=()=>controller?.abort();$('clear').onclick=$('newChatHeader').onclick=startNew;
$('retrySave').onclick=()=>operation(async()=>{await persistThread();});
$('saveAsNew').onclick=()=>operation(async()=>{
 thread=pendingConversation(thread,savedMessageIds);savedMessageIds=new Set();
 saveConflict=false;drawConversation();if(!await persistThread())status('새 대화 저장을 다시 시도해 주세요.',true);else drawThreads();
});
$('openSettings').onclick=()=>toggleSettings($('settingsPanel').classList.contains('hidden'));$('closeSettings').onclick=()=>toggleSettings(false);
$('openSidebar').onclick=()=>toggleSidebar(mobileSidebar?.matches?!$('sidebar').classList.contains('open'):desktopSidebarCollapsed);$('closeSidebar').onclick=()=>toggleSidebar(false);$('sidebarBackdrop').onclick=()=>toggleSidebar(false);
document.addEventListener('keydown',event=>{
 if(event.key==='Escape'){toggleSettings(false);if($('sidebar').classList.contains('open'))if(mobileSidebar?.matches)toggleSidebar(false);}
 if(event.key==='Tab'&&mobileSidebar?.matches&&$('sidebar').classList.contains('open')){
  const items=[...$('sidebar').querySelectorAll('a[href],button:not([disabled]),input:not([disabled])')].filter(el=>el.offsetParent!==null),first=items[0],last=items.at(-1);
  if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
 }
});
document.querySelectorAll('.example').forEach(button=>button.onclick=()=>{$('question').value=button.dataset.question||button.textContent;resizeQuestion();$('question').focus();});
let searchTimer;
$('historySearch').addEventListener('input',()=>{clearTimeout(searchTimer);searchTimer=setTimeout(()=>loadHistory(false),250);});
$('moreHistory').onclick=()=>loadHistory(true);
function lockChat(){
 sessionVersion++;historySequence++;authorized=false;controller?.abort();controller=null;setBusy(false);token='';cache.clear();chunks=[];thread=newThread();threads=[];savedMessageIds=new Set();dirty=false;saveConflict=false;currentTurn=null;
 ['contentPassword','question','historySearch'].forEach(id=>$(id).value='');$('conversation').replaceChildren();$('threadList').replaceChildren();text($('answer'),'');text($('evidence'),'');
 $('lab').classList.add('hidden');$('gate').classList.remove('hidden');toggleSettings(false);$('sidebar').classList.remove('open');$('sidebarBackdrop').classList.add('hidden');syncSidebarAccess();$('scrollBottom').classList.add('hidden');setSaveState('');status('');
 if($('threadDialog').open)$('threadDialog').close();
 if($('membersDialog').open)$('membersDialog').close();$('memberList').replaceChildren();$('manageMembers').classList.add('hidden');membership=null;memberSequence++;
}
let membership=null,membershipSequence=0,memberSequence=0,memberOffset=0;
function showGoogleUser(user){
 if(googleUser?.id!==user?.id)lockChat();
 googleUser=user;const signed=!!user;
 $('membershipBox').classList.toggle('hidden',!signed);$('accountBox').classList.toggle('hidden',!signed);$('googleLogin').classList.toggle('hidden',signed);$('login').classList.add('hidden');
 if(signed){text($('signedAccount'),user.email||'Google 계정으로 로그인됨');text($('accountName'),user.email?.split('@')[0]||'나의 계정');text($('accountEmail'),user.email||'');text($('gateMessage'),'회원 승인 상태를 확인하고 있습니다.');void refreshMembership(true);}
 else{text($('gateMessage'),'Google로 가입하면 관리자에게 승인 요청이 등록됩니다.');text($('signedAccount'),'');text($('accountName'),'나의 계정');text($('accountEmail'),'');}
}
async function refreshMembership(enter=false){
 if(!googleUser||!authClient)return null;
 const epoch=sessionVersion,userId=googleUser.id,sequence=++membershipSequence;
 $('membershipRefresh').disabled=true;
 try{
  const access=await membershipStatus(authClient);
  if(epoch!==sessionVersion||userId!==googleUser?.id||sequence!==membershipSequence)return null;
  if(!access.approved&&authorized)lockChat();
  membership=access;text($('membershipLabel'),MEMBER_LABELS[access.status]);$('manageMembers').classList.toggle('hidden',!access.isAdmin);
  $('login').classList.toggle('hidden',!access.approved);
  text($('gateMessage'),access.approved?'승인된 계정입니다. 대화를 시작할 수 있습니다.':access.status==='pending'?'가입 신청이 완료되었습니다. 관리자가 승인하면 대화를 시작할 수 있습니다.':access.status==='rejected'?'가입 신청이 승인되지 않았습니다. 관리자에게 문의해 주세요.':'이용 승인이 취소되었습니다. 관리자에게 문의해 주세요.');
  if(enter&&access.approved&&!authorized)await enterChat();
  return access;
 }catch(e){if(epoch===sessionVersion){if(authorized)lockChat();text($('gateMessage'),e.message);}return null;}
 finally{if(sequence===membershipSequence)$('membershipRefresh').disabled=false;}
}
async function enterChat(){
 if($('login').disabled)return;
 if(!googleUser||!chatStore){text($('gateMessage'),'Google로 먼저 로그인해 주세요.');return;}
 const epoch=sessionVersion;$('login').disabled=true;const pending=new AbortController(),timer=setTimeout(()=>pending.abort(),20000);
 try{
  const {data,error}=await authClient.auth.getSession();if(error||!data.session||data.session.user.id!==googleUser.id)throw new Error('Google로 다시 로그인해 주세요.');
  token=data.session.access_token;text($('gateMessage'),'이용 승인 확인 중…');
  const info=await requestServer(config,token,{action:'status'},fetch,pending.signal);
  if(!token||pending.signal.aborted||epoch!==sessionVersion)return;
  if(info.ready!==true||!Array.isArray(info.models))throw new Error('서버 응답을 확인하지 못했습니다.');
  authorized=true;$('gate').classList.add('hidden');$('lab').classList.remove('hidden');applyServerInfo(info);
  await loadHistory();drawConversation();await operation(load);$('question').focus();
  if(location.hash==='#members'&&membership?.isAdmin){history.replaceState(null,'',location.pathname);$('membersDialog').showModal();await loadMembers();}
 }catch(e){if(epoch===sessionVersion){lockChat();text($('gateMessage'),e.name==='AbortError'?'서버 응답 시간이 초과됐습니다. 다시 시도해 주세요.':e instanceof TypeError?'서버 연결을 확인해 주세요.':e.message);}}
 finally{clearTimeout(timer);$('login').disabled=false;}
}
async function loadMembers(){
 if(!authorized||!membership?.isAdmin)return;
 const epoch=sessionVersion,sequence=++memberSequence,store=createMemberStore(authClient);
 text($('membersStatus'),'회원 목록 확인 중…');$('memberList').replaceChildren();$('refreshMembers').disabled=true;
 try{
  const rows=await store.list($('memberFilter').value||'pending',memberOffset);
  if(epoch!==sessionVersion||sequence!==memberSequence||!authorized)return;
  for(const member of rows){
   const card=node('article',null,'member-card'),details=node('div');details.append(node('strong',member.display_name||'Google 계정'),node('div',member.email||''),node('small',MEMBER_LABELS[member.status]+' · 신청 '+new Date(member.requested_at).toLocaleDateString('ko-KR')));card.append(details);
   const actions=node('div',null,'row');
   if(member.is_admin)actions.append(node('span','관리자','badge'));
   else for(const [value,label] of member.status==='approved'?[['revoked','승인 취소']]:member.status==='pending'?[['approved','승인'],['rejected','거절']]:[['approved','승인']]){
    const button=node('button',label,value==='approved'?'primary':'secondary');button.type='button';
    button.onclick=async()=>{
     if(value!=='approved'&&button.dataset.confirmed!=='yes'){button.dataset.confirmed='yes';button.textContent=label+' 확인';text($('membersStatus'),(member.email||'이 회원')+'의 '+label+'를 한 번 더 눌러 확인하세요.');return;}
     const current=sessionVersion;actions.querySelectorAll('button').forEach(b=>b.disabled=true);
     try{await store.review(member,value);if(current!==sessionVersion)return;await loadMembers();text($('membersStatus'),label+'했습니다.');}
     catch(e){if(current===sessionVersion){text($('membersStatus'),e.message);actions.querySelectorAll('button').forEach(b=>b.disabled=false);}}
    };actions.append(button);
   }
   card.append(actions);$('memberList').append(card);
  }
  text($('membersStatus'),rows.length?rows.length+'명 표시':'해당 상태의 회원이 없습니다.');$('previousMembers').disabled=memberOffset===0;$('nextMembers').disabled=rows.length<50;
 }catch(e){if(epoch===sessionVersion)text($('membersStatus'),e.message);}
 finally{if(epoch===sessionVersion&&sequence===memberSequence)$('refreshMembers').disabled=false;}
}
$('membershipRefresh').onclick=()=>refreshMembership(true);$('login').onclick=enterChat;
$('manageMembers').onclick=()=>{$('membersDialog').showModal();memberOffset=0;return loadMembers();};$('closeMembers').onclick=()=>$('membersDialog').close();
$('memberFilter').onchange=()=>{memberOffset=0;return loadMembers();};$('refreshMembers').onclick=loadMembers;
$('previousMembers').onclick=()=>{memberOffset=Math.max(0,memberOffset-50);return loadMembers();};$('nextMembers').onclick=()=>{memberOffset+=50;return loadMembers();};
async function bootGoogle(){
 try{
  if(!window.supabase?.createClient)throw new Error('Google 로그인 연결을 불러오지 못했습니다. 화면을 새로고침해 주세요.');
  authClient=window.supabase.createClient(config.supabaseUrl,config.supabaseAnonKey,{auth:{flowType:'pkce',storageKey:'sayeon-ai-google-session',persistSession:true,autoRefreshToken:true,detectSessionInUrl:true},global:{fetch:async(input,options={})=>{
   const pending=new AbortController(),timer=setTimeout(()=>pending.abort(),20000),signal=options.signal?AbortSignal.any([options.signal,pending.signal]):pending.signal;
   try{return await fetch(input,{...options,signal});}finally{clearTimeout(timer);}
  }}});
  chatStore=createChatStore(authClient);
  const {data,error}=await authClient.auth.getSession();if(error)throw error;
  if(data.session){const verified=await authClient.auth.getUser();if(verified.error)throw verified.error;showGoogleUser(verified.data.user);}
  authClient.auth.onAuthStateChange((_event,session)=>{
   const user=session?.user;if(googleUser?.id===user?.id)return;
   if(!user){showGoogleUser(null);return;}
   setTimeout(async()=>{const epoch=sessionVersion,verified=await authClient.auth.getUser();if(epoch===sessionVersion&&verified.data.user?.id===user.id)showGoogleUser(verified.error?null:verified.data.user);},0);
  });
  const params=new URLSearchParams(location.search);if(params.get('error')){text($('gateMessage'),'Google 로그인을 완료하지 못했습니다. 다시 로그인해 주세요.');}
  if(params.has('code')||params.has('error'))history.replaceState(null,'',location.pathname);
 }catch{showGoogleUser(null);text($('gateMessage'),'Google 로그인 연결을 확인하지 못했습니다. 화면을 새로고침해 주세요.');}
}
$('googleLogin').onclick=async()=>{
 if(!authClient){text($('gateMessage'),'로그인 연결을 준비하고 있습니다. 잠시 후 다시 눌러 주세요.');return;}
 $('googleLogin').disabled=true;
 try{const {error}=await authClient.auth.signInWithOAuth({provider:'google',options:{redirectTo:location.origin+location.pathname,queryParams:{prompt:'select_account'}}});if(error)throw error;}
 catch{text($('gateMessage'),'Google 로그인을 시작하지 못했습니다. 다시 시도해 주세요.');$('googleLogin').disabled=false;}
};
async function signOut(){
 const currentClient=authClient;lockChat();showGoogleUser(null);$('googleLogin').disabled=true;
 try{await currentClient?.auth.signOut({scope:'local'});}finally{$('googleLogin').disabled=false;}
}
$('logout').onclick=signOut;$('switchAccount').onclick=signOut;
window.addEventListener('pagehide',lockChat);
window.addEventListener('pageshow',event=>{if(event.persisted){lockChat();showGoogleUser(googleUser);}});
window.addEventListener('focus',()=>{if(googleUser&&!busy)void refreshMembership(!authorized);});
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&googleUser&&!busy)void refreshMembership(!authorized);});
window.addEventListener('load',bootGoogle,{once:true});if(document.readyState==='complete')void bootGoogle();
