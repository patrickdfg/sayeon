import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
import * as core from '../admin/ai-core.mjs';
import * as chat from '../ai-chat.mjs';
import * as members from '../ai-members.mjs';
function setup(){
 class Element{
  constructor(){this.value='';this.textContent='';this.children=[];this.disabled=false;this.checked=false;this.style={};this.dataset={};this.open=false;this.scrollHeight=100;this.classes=new Set();this.classList={add:x=>this.classes.add(x),remove:x=>this.classes.delete(x),contains:x=>this.classes.has(x),toggle:(x,on)=>{const enabled=on??!this.classes.has(x);if(enabled)this.classes.add(x);else this.classes.delete(x);return enabled;}};}
  append(...values){this.children.push(...values);}replaceChildren(...values){this.children=values;}setAttribute(){}focus(){}select(){}remove(){}addEventListener(){}showModal(){this.open=true;}close(){this.open=false;}
 }
 const elements=new Map(),get=id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id);};get('lab').classes.add('hidden');get('freeOnly').checked=true;
 const writes=[],calls=[],copied=[];
 const context={...chat,...members,createVoiceInput:()=>({stop(){}}),URL,location:{hash:"",pathname:"/ai-lab.html"},DOMException,TextEncoder,structuredClone,document:{getElementById:get,createElement:()=>new Element(),querySelectorAll:()=>[],addEventListener:()=>{},body:new Element()},window:{SAYEON_ANALYTICS_CONFIG:{},SaCrypt:{ready:()=>false,resume:async()=>false},addEventListener:()=>{}},localStorage:{getItem:()=>null,setItem:(...args)=>writes.push(args)},crypto:webcrypto,AbortController,setTimeout,clearTimeout,fetch:async()=>{},navigator:{clipboard:{writeText:async s=>copied.push(s)}},normalizeScope:core.normalizeScope,MODELS:{},SOURCES:[],toChunks:()=>[],retrieve:()=>[],clean:x=>x,sourceCaption:()=>'',requestServer:async(config,token)=>{calls.push(token);if(token!=='fixture-token')throw new Error('Google 로그인 확인이 필요합니다.');return {ready:true,models:[],quota:{remaining:30}};},generateViaServer:()=>{}};
 context.membershipFixture={approved:true,status:'approved',isAdmin:false};vm.createContext(context);const source=readFileSync(new URL('../ai-lab.mjs',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'');vm.runInContext(source,context);
 vm.runInContext("googleUser={id:'31dfdc34-a567-4e6d-9a15-d37ab6f517db',email:'fixture@example.test'};authClient={rpc:async()=>({data:membershipFixture,error:null}),auth:{signOut:async()=>{},getSession:async()=>({data:{session:{access_token:'fixture-token',user:googleUser}}})}};chatStore={list:async()=>[],save:async t=>({id:t.id,revision:(t.revision??-1)+1}),remove:async()=>{}}",context);
 return {context,get,writes,calls,copied};
}
test('날짜 말씀은 원고 하나로 전송하며 같은 요약·정리 질문도 매번 새로 생성',async()=>{
 for(const verb of ['요약','정리']){
  const s=setup();await vm.runInContext('refreshMembership(true)',s.context);
  Object.assign(s.context,{MODELS:core.MODELS,resolveQuestion:core.resolveQuestion,wholeRequest:core.wholeRequest,checkWholeCoverage:core.checkWholeCoverage,sourceCaption:core.sourceCaption});
  s.context.corpus=core.toChunks([{no:73,title:'10월 4일 주일말씀',paragraphs:[['처음 내용입니다. '.repeat(350)],['중간 내용입니다. '.repeat(350)],['마지막 결론입니다.']]}],core.SOURCES[3]);
  vm.runInContext('chunks=corpus',s.context);s.get('question').value='10월 4일 주일말씀 '+verb+'해줘';s.get('scope').value='all';s.get('model').value='gemini-lite';
  await s.get('preview').onclick();assert.equal(s.get('evidence').children.length,1);assert.match(s.get('evidence').children[0].children[0].textContent,/원고 전체/);
  const seen=[];s.context.generateViaServer=async(...args)=>{
   seen.push(args);const doc=args[4][0],statement={label:'전체 흐름',text:'처음과 중간의 내용을 결론과 연결해 설명합니다.',kind:'inference',sources:[{id:doc.id,quote:'마지막 결론입니다.'}]};
   return {model:'fixture',answer:core.validateAnswer(JSON.stringify({supported:true,overview:[{title:'한 편의 정리',points:[statement]}],claims:[statement]}),[doc])};
  };
  s.get('useCache').checked=true; // 예전 화면의 기본값이 남아도 답변을 재사용하지 않는다.
  s.get('question').value='10월 4일 주일말씀 '+verb+'해줘';
  await s.get('ask').onclick();assert.equal(seen.length,1);assert.equal(seen[0][8],true);assert.equal(seen[0][4].length,1);
  assert.equal(seen[0][4][0].text,s.context.corpus.map(c=>c.text).join('\n\n'));assert.match(s.get('status').textContent,/1회 사용/);
  s.get('question').value='10월 4일 주일말씀 '+verb+'해줘';
  await s.get('ask').onclick();assert.equal(seen.length,2);assert.equal(seen[1][8],true);assert.equal(seen[1][4].length,1);
  assert.equal(seen[1][4][0].text,seen[0][4][0].text);
 }
});
test('Google 가입 대기는 화면·AI 입장을 막고 승인을 다시 확인하면 비밀번호 없이 입장한다',async()=>{
 const s=setup();s.context.membershipFixture={approved:false,status:'pending',isAdmin:false};await vm.runInContext('refreshMembership(true)',s.context);
 assert(s.get('lab').classes.has('hidden'));assert.equal(s.calls.length,0);assert.match(s.get('gateMessage').textContent,/관리자가 승인/);
 s.context.membershipFixture={approved:true,status:'approved',isAdmin:false};await vm.runInContext('refreshMembership(true)',s.context);
 assert(!s.get('lab').classes.has('hidden'));assert.equal(s.calls[0],'fixture-token');assert.equal(s.writes.length,0);
 s.context.membershipFixture={approved:false,status:'revoked',isAdmin:false};await vm.runInContext('refreshMembership()',s.context);
 assert(s.get('lab').classes.has('hidden'));assert.equal(vm.runInContext('token',s.context),'');assert.match(s.get('gateMessage').textContent,/취소/);
});
test('승인된 계정 화면의 종합 정리 복사도 출처·인용 없이 제목과 설명만',async()=>{
 const s=setup();await vm.runInContext('refreshMembership(true)',s.context);
 s.context.fixture=[{title:'길의 역사',points:[{label:'개척',text:'원고의 내용을 종합한 설명입니다.',sources:[{id:'source',quote:'원문 인용',doc:{url:'/출처주소'}}]}]}];
 const button=s.context.document.createElement('button');s.context.copyButton=button;await vm.runInContext('copyOverview(fixture,copyButton)',s.context);
 assert.equal(s.copied.length,1);assert.match(s.copied[0],/길의 역사/);assert.match(s.copied[0],/원고의 내용을 종합한 설명/);assert(!s.copied[0].includes('개척'));assert(!s.copied[0].includes('원문 인용'));assert(!s.copied[0].includes('출처주소'));assert.equal(button.textContent,'복사됨');
});


test('앱 집계를 실제 Gemini 잔여량으로 표시하지 않고 Groq는 제외',()=>{
 const s=setup();s.context.quotaFixture={providers:{gemini:{remaining:17,limit:30},groq:{remaining:30,limit:30}}};
 vm.runInContext("providerStatus={gemini:{configured:true}};showQuota(quotaFixture)",s.context);
 assert.equal(s.get('usage').children[0].textContent,'Gemini 실제 잔여량: 조회 연동 필요');assert(s.get('usage').children.some(el=>el.textContent.includes('17/30회 남음')));assert(!s.get('usage').children.some(el=>el.textContent.includes('Groq')||el.textContent.includes('57%')));
 vm.runInContext("providerStatus.gemini.configured=false;showQuota(quotaFixture)",s.context);assert.equal(s.get('usage').children[0].textContent,'Gemini 연결 필요');
 vm.runInContext("providerStatus.gemini.configured=true;showQuota({remaining:30})",s.context);assert.equal(s.get('usage').children.length,2);
});
test('무료 확인은 숨김 기본 체크 유지, 모델을 바꾸거나 답변을 지워도 보이지 않음',()=>{
 const s=setup();s.get('keyBox').classes.add('hidden');s.get('model').value='gemini-lite';s.get('model').onchange();assert(s.get('keyBox').classes.has('hidden'));s.get('clear').onclick();assert.equal(s.get('freeOnly').checked,true);
 const html=readFileSync(new URL('../ai-lab.html',import.meta.url),'utf8');assert.match(html,/id="freeOnly" type="checkbox" checked/);assert.match(html,/id="serverStatus" class="status hidden"/);assert.match(html,/id="serverCheck" class="secondary hidden"/);
});

test('Google 로그인 없이 개인 기록 화면에 들어갈 수 없다',async()=>{
 const s=setup();vm.runInContext('googleUser=null',s.context);await s.get('login').onclick();
 assert.equal(s.calls.length,0);assert(s.get('lab').classes.has('hidden'));assert.match(s.get('gateMessage').textContent,/Google/);
});
test('로그아웃·계정 변경은 원고·대화·비밀번호를 즉시 지우고 이전 저장 응답을 무시한다',async()=>{
 const s=setup();await vm.runInContext('refreshMembership(true)',s.context);
 let complete;s.context.deferredSave=new Promise(resolve=>{complete=resolve;});
 vm.runInContext("thread.messages=[makeMessage('user','이전 계정 비공개 질문')];chunks=[{text:'이전 원고'}];chatStore.save=()=>deferredSave",s.context);
 const saving=vm.runInContext('persistThread()',s.context);s.get('logout').onclick();
 assert.equal(vm.runInContext('thread.messages.length',s.context),0);assert.equal(vm.runInContext('chunks.length',s.context),0);assert.equal(vm.runInContext('token',s.context),'');
 complete({id:'old',revision:1});await saving;
 assert.equal(vm.runInContext('thread.messages.length',s.context),0);assert(s.get('lab').classes.has('hidden'));assert.equal(s.get('conversation').children.length,0);
});
test('기록 저장이 실패하면 AI를 호출하지 않고 현재 대화를 보존한다',async()=>{
 const s=setup();await vm.runInContext('refreshMembership(true)',s.context);
 Object.assign(s.context,{MODELS:core.MODELS,resolveQuestion:core.resolveQuestion,wholeRequest:core.wholeRequest,checkWholeCoverage:core.checkWholeCoverage,sourceCaption:core.sourceCaption});
 s.context.corpus=core.toChunks([{no:39,title:'10월 4일 주일말씀',paragraphs:[['검사용 원고의 전체 문장입니다.']]}],core.SOURCES[3]);
 vm.runInContext("chunks=corpus;chatStore.save=async()=>{throw new Error('저장 실패')}",s.context);
 s.get('question').value='10월 4일 주일말씀 요약해줘';s.get('model').value='gemini-lite';s.get('scope').value='all';
 let aiCalls=0;s.context.generateViaServer=async()=>{aiCalls++;};await s.get('ask').onclick();
 assert.equal(aiCalls,0);assert.equal(vm.runInContext('dirty',s.context),true);assert.equal(vm.runInContext('thread.messages[0].content',s.context),'10월 4일 주일말씀 요약해줘');assert(!s.get('retrySave').classes.has('hidden'));
});

test('이전 Groq·3.8 대화는 본문을 보존하고 다음 질문은 3.5, 원문 검색 대화는 검색으로 연다',async()=>{
 for(const [saved,selected] of [['groq-oss','gemini-lite'],['gemini-flash','gemini-lite'],['search','search']]){
  const s=setup();await vm.runInContext('refreshMembership(true)',s.context);Object.assign(s.context,{MODELS:core.MODELS});s.context.savedModel=saved;
  vm.runInContext("chatStore.load=async()=>({id:'old',title:'이전 대화',scope:'sayeon2025',model_id:savedModel,messages:[{id:'q',role:'user',content:'이전 질문'}],revision:2})",s.context);
  await vm.runInContext("openThread('old')",s.context);assert.equal(s.get('scope').value,'sayeon');assert.equal(s.get('model').value,selected);assert.equal(vm.runInContext('thread.messages[0].content',s.context),'이전 질문');
 }
});

test('문의 관리자 로그인은 고정 문의 주소로 돌아오고 일반 AI 로그인은 그대로 둠',()=>{
 const s=setup(),routes=[];s.context.location.replace=url=>routes.push(url);s.context.localStorage.getItem=()=> '1';s.context.localStorage.removeItem=()=>{};
 vm.runInContext("showGoogleUser({id:'fixture',email:'fixture@example.test'})",s.context);assert.deepEqual(routes,['./contact.html']);
});


test('저장된 원문 보기 옆 버튼은 전체 원문만 줄바꿈 그대로 복사·공유한다',async()=>{
 const s=setup();await vm.runInContext('refreshMembership(true)',s.context);
 const first='첫 원문입니다.\n둘째 줄입니다.\n\n마지막 문단입니다.',last='다른 근거 원문입니다.';
 s.context.sourceFixture=[{id:'one',title:'출처 제목',text:first,url:'/출처주소'},{id:'two',title:'다른 제목',text:last}];
 vm.runInContext("thread.messages=[makeMessage('assistant','관련 원문을 찾았습니다. 아래에서 원문과 출처를 확인해 주세요.',{evidence:sourceFixture})];drawConversation()",s.context);
 const all=el=>[el,...el.children.flatMap(all)];
 const buttons=all(s.get('conversation')),copy=buttons.find(el=>el.textContent==='원문만 복사'),share=buttons.find(el=>el.textContent==='원문 공유');
 assert(copy&&share);await copy.onclick();assert.equal(s.copied[0],first+'\n\n'+last);
 assert(!s.copied[0].includes('출처 제목'));assert(!s.copied[0].includes('관련 원문을 찾았습니다'));assert(!s.copied[0].includes('/출처주소'));
 const shared=[];s.context.navigator.share=async data=>shared.push(data);await share.onclick();
 assert.deepEqual(Object.keys(shared[0]),['text']);assert.equal(shared[0].text,s.copied[0]);assert.equal(share.disabled,false);
});

test('원문 공유 미지원은 복사 안내, 공유 취소는 오류·재전송 없이 끝낸다',async()=>{
 const s=setup();await vm.runInContext('refreshMembership(true)',s.context);
 s.context.sourceFixture=[{text:'한 편의 전체 원고입니다.'}];s.context.sourceButton=s.context.document.createElement('button');s.context.sourceButton.textContent='원문 공유';
 await vm.runInContext('shareSource(sourceFixture,sourceButton)',s.context);assert.equal(s.copied[0],'한 편의 전체 원고입니다.');assert.match(s.get('status').textContent,/공유할 앱에 붙여/);
 s.get('status').textContent='';s.context.navigator.share=async()=>{throw new DOMException('cancelled','AbortError');};
 await vm.runInContext('shareSource(sourceFixture,sourceButton)',s.context);assert.equal(s.copied.length,1);assert.equal(s.get('status').textContent,'');assert.equal(s.context.sourceButton.disabled,false);
 s.context.navigator.share=async()=>{throw new TypeError('share unavailable');};await vm.runInContext('shareSource(sourceFixture,sourceButton)',s.context);assert.match(s.get('status').textContent,/공유하지 못/);assert.equal(s.copied.length,1);
 vm.runInContext('authorized=false',s.context);let shared=0;s.context.navigator.share=async()=>{shared++;};await vm.runInContext('shareSource(sourceFixture,sourceButton)',s.context);assert.equal(shared,0);
});


test('AI 답변 아래에서도 원문 보기 옆 복사·공유를 표시하고 열기와 독립적으로 원문 전체를 복사한다',async()=>{
 const s=setup();await vm.runInContext('refreshMembership(true)',s.context);
 const doc={id:'whole',title:'검사용 말씀',whole:true,text:'검사용 전체 원고의 문장입니다.\n\n끝까지 그대로 보존합니다.'};
 const point={label:'설명',text:'AI가 생성한 설명입니다.',kind:'source',sources:[{id:doc.id,quote:'검사용 전체 원고의 문장입니다.'}]};
 s.context.answerFixture=chat.makeMessage('assistant','',{evidence:[doc],result:chat.packResult({model:'Gemini',answer:core.validateAnswer(JSON.stringify({supported:true,overview:[{title:'정리',points:[point]}],claims:[point]}),[doc])})});
 vm.runInContext('thread.messages=[answerFixture];drawConversation()',s.context);
 const all=el=>[el,...el.children.flatMap(all)],elements=all(s.get('conversation'));
 const heading=elements.find(el=>el.className==='source-heading'),view=heading.children[0],actions=heading.children[1],body=elements.find(el=>el.className==='source-evidence hidden');
 assert.equal(view.textContent,'원문 보기 · 원고 전체 1편');assert.equal(actions.children[0].textContent,'원문만 복사');assert.equal(actions.children[1].textContent,'원문 공유');assert(body.classes.has('hidden')||body.className.includes('hidden'));
 body.classList.add('hidden');view.onclick();assert(!body.classes.has('hidden'));view.onclick();assert(body.classes.has('hidden'));
 await actions.children[0].onclick();assert.equal(s.copied[0],doc.text);assert(!s.copied[0].includes(point.text));
});
