import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
import * as core from '../admin/ai-core.mjs';
import * as chat from '../ai-chat.mjs';
function setup(){
 class Element{
  constructor(){this.value='';this.textContent='';this.children=[];this.disabled=false;this.checked=false;this.style={};this.dataset={};this.open=false;this.scrollHeight=100;this.classes=new Set();this.classList={add:x=>this.classes.add(x),remove:x=>this.classes.delete(x),contains:x=>this.classes.has(x),toggle:(x,on)=>{const enabled=on??!this.classes.has(x);if(enabled)this.classes.add(x);else this.classes.delete(x);return enabled;}};}
  append(...values){this.children.push(...values);}replaceChildren(...values){this.children=values;}setAttribute(){}focus(){}select(){}remove(){}addEventListener(){}showModal(){this.open=true;}close(){this.open=false;}
 }
 const elements=new Map(),get=id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id);};get('lab').classes.add('hidden');get('freeOnly').checked=true;
 const writes=[],calls=[],copied=[];
 const context={...chat,URL,DOMException,TextEncoder,structuredClone,document:{getElementById:get,createElement:()=>new Element(),querySelectorAll:()=>[],addEventListener:()=>{},body:new Element()},window:{SAYEON_ANALYTICS_CONFIG:{},SaCrypt:{ready:()=>false,resume:async()=>false},addEventListener:()=>{}},localStorage:{getItem:()=>null,setItem:(...args)=>writes.push(args)},crypto:webcrypto,AbortController,setTimeout,clearTimeout,fetch:async()=>{},navigator:{clipboard:{writeText:async s=>copied.push(s)}},MODELS:{},SOURCES:[],toChunks:()=>[],retrieve:()=>[],clean:x=>x,sourceCaption:()=>'',requestServer:async(config,token)=>{calls.push({...token});if(token.password!=='fixture-pass')throw new Error('AI 챗봇 비밀번호가 맞지 않습니다.');return {ready:true,models:[],quota:{remaining:30}};},generateViaServer:()=>{}};
 vm.createContext(context);const source=readFileSync(new URL('../ai-lab.mjs',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'');vm.runInContext(source,context);
 vm.runInContext("googleUser={id:'31dfdc34-a567-4e6d-9a15-d37ab6f517db',email:'fixture@example.test'};chatStore={list:async()=>[],save:async t=>({id:t.id,revision:(t.revision??-1)+1}),remove:async()=>{}}",context);
 return {context,get,writes,calls,copied};
}
test('날짜 말씀의 원문 카드는 하나이며 요약과 정리 모두 전체 원고를 한 번만 요청',async()=>{
 for(const verb of ['요약','정리']){
  const s=setup();s.get('aiPassword').value='fixture-pass';await s.get('loginForm').onsubmit({preventDefault(){}});
  Object.assign(s.context,{MODELS:core.MODELS,resolveQuestion:core.resolveQuestion,wholeRequest:core.wholeRequest,checkWholeCoverage:core.checkWholeCoverage,sourceCaption:core.sourceCaption});
  s.context.corpus=core.toChunks([{no:73,title:'10월 4일 주일말씀',paragraphs:[['처음 내용입니다. '.repeat(350)],['중간 내용입니다. '.repeat(350)],['마지막 결론입니다.']]}],core.SOURCES[3]);
  vm.runInContext('chunks=corpus',s.context);s.get('question').value='10월 4일 주일말씀 '+verb+'해줘';s.get('scope').value='all';s.get('model').value='gemini-lite';
  await s.get('preview').onclick();assert.equal(s.get('evidence').children.length,1);assert.match(s.get('evidence').children[0].children[0].textContent,/원고 전체/);
  const seen=[];s.context.generateViaServer=async(...args)=>{
   seen.push(args);const doc=args[4][0],statement={label:'전체 흐름',text:'처음과 중간의 내용을 결론과 연결해 설명합니다.',kind:'inference',sources:[{id:doc.id,quote:'마지막 결론입니다.'}]};
   return {model:'fixture',answer:core.validateAnswer(JSON.stringify({supported:true,overview:[{title:'한 편의 정리',points:[statement]}],claims:[statement]}),[doc])};
  };
  s.get('question').value='10월 4일 주일말씀 '+verb+'해줘';
  await s.get('ask').onclick();assert.equal(seen.length,1);assert.equal(seen[0][8],true);assert.equal(seen[0][4].length,1);
  assert.equal(seen[0][4][0].text,s.context.corpus.map(c=>c.text).join('\n\n'));assert.match(s.get('status').textContent,/1회 사용/);
 }
});
test('새 화면은 서버 승인 전 숨김, 틀린 비밀번호 차단·입장·나가기와 메모리 보관',async()=>{
 const s=setup(),event={preventDefault(){}};assert(s.get('lab').classes.has('hidden'));assert.equal(s.calls.length,0);
 s.get('aiPassword').value='wrong';await s.get('loginForm').onsubmit(event);assert(s.get('lab').classes.has('hidden'));assert.match(s.get('gateMessage').textContent,/맞지/);
 s.get('aiPassword').value='fixture-pass';await s.get('loginForm').onsubmit(event);assert(!s.get('lab').classes.has('hidden'));assert(s.get('gate').classes.has('hidden'));assert.equal(s.get('aiPassword').value,'');assert(s.writes.every(([key,value])=>key==='aiLabClient'&&!value.includes('fixture-pass')));
 s.get('logout').onclick();assert(s.get('lab').classes.has('hidden'));assert(!s.get('gate').classes.has('hidden'));assert.equal(vm.runInContext('token.password',s.context),'');assert.equal(vm.runInContext('authorized',s.context),false);
});
test('새 비밀번호 화면의 종합 정리 복사도 출처·인용 없이 제목과 설명만',async()=>{
 const s=setup();s.get('aiPassword').value='fixture-pass';await s.get('loginForm').onsubmit({preventDefault(){}});
 s.context.fixture=[{title:'길의 역사',points:[{label:'개척',text:'원고의 내용을 종합한 설명입니다.',sources:[{id:'source',quote:'원문 인용',doc:{url:'/출처주소'}}]}]}];
 const button=s.context.document.createElement('button');s.context.copyButton=button;await vm.runInContext('copyOverview(fixture,copyButton)',s.context);
 assert.equal(s.copied.length,1);assert.match(s.copied[0],/길의 역사/);assert.match(s.copied[0],/개척/);assert(!s.copied[0].includes('원문 인용'));assert(!s.copied[0].includes('출처주소'));assert.equal(button.textContent,'복사됨');
});


test('업체별 잔여율 각각 표시, Groq 미등록과 집계 미준비는 100%로 꾸미지 않음',()=>{
 const s=setup();s.context.quotaFixture={providers:{gemini:{remaining:17,limit:30},groq:{remaining:30,limit:30}}};
 vm.runInContext("providerStatus={gemini:{configured:true},groq:{configured:true}};showQuota(quotaFixture)",s.context);
 assert.equal(s.get('usage').children[0].textContent,'Gemini 57% 남음');assert.equal(s.get('usage').children[1].textContent,'Groq 100% 남음');
 vm.runInContext("providerStatus.groq.configured=false;showQuota(quotaFixture)",s.context);assert.equal(s.get('usage').children[1].textContent,'Groq 연결 필요');
 vm.runInContext("providerStatus.groq.configured=true;showQuota({remaining:30})",s.context);assert.match(s.get('usage').children[1].textContent,/집계 준비 중/);
});
test('무료 확인은 숨김 기본 체크 유지, 모델을 바꾸거나 답변을 지워도 보이지 않음',()=>{
 const s=setup();s.get('keyBox').classes.add('hidden');s.get('model').value='gemini-lite';s.get('model').onchange();assert(s.get('keyBox').classes.has('hidden'));s.get('clear').onclick();assert.equal(s.get('freeOnly').checked,true);
 const html=readFileSync(new URL('../ai-lab.html',import.meta.url),'utf8');assert.match(html,/id="freeOnly" type="checkbox" checked/);assert.match(html,/id="serverStatus" class="status hidden"/);assert.match(html,/id="serverCheck" class="secondary hidden"/);
});

test('Google 로그인 없이 공유 비밀번호만으로 개인 기록 화면에 들어갈 수 없다',async()=>{
 const s=setup();vm.runInContext('googleUser=null',s.context);s.get('aiPassword').value='fixture-pass';
 await s.get('loginForm').onsubmit({preventDefault(){}});
 assert.equal(s.calls.length,0);assert(s.get('lab').classes.has('hidden'));assert.match(s.get('gateMessage').textContent,/Google/);
});
test('로그아웃·계정 변경은 원고·대화·비밀번호를 즉시 지우고 이전 저장 응답을 무시한다',async()=>{
 const s=setup();s.get('aiPassword').value='fixture-pass';await s.get('loginForm').onsubmit({preventDefault(){}});
 let complete;s.context.deferredSave=new Promise(resolve=>{complete=resolve;});
 vm.runInContext("thread.messages=[makeMessage('user','이전 계정 비공개 질문')];chunks=[{text:'이전 원고'}];chatStore.save=()=>deferredSave",s.context);
 const saving=vm.runInContext('persistThread()',s.context);s.get('logout').onclick();
 assert.equal(vm.runInContext('thread.messages.length',s.context),0);assert.equal(vm.runInContext('chunks.length',s.context),0);assert.equal(vm.runInContext('token.password',s.context),'');
 complete({id:'old',revision:1});await saving;
 assert.equal(vm.runInContext('thread.messages.length',s.context),0);assert(s.get('lab').classes.has('hidden'));assert.equal(s.get('conversation').children.length,0);
});
test('기록 저장이 실패하면 AI를 호출하지 않고 현재 대화를 보존한다',async()=>{
 const s=setup();s.get('aiPassword').value='fixture-pass';await s.get('loginForm').onsubmit({preventDefault(){}});
 Object.assign(s.context,{MODELS:core.MODELS,resolveQuestion:core.resolveQuestion,wholeRequest:core.wholeRequest,checkWholeCoverage:core.checkWholeCoverage,sourceCaption:core.sourceCaption});
 s.context.corpus=core.toChunks([{no:39,title:'10월 4일 주일말씀',paragraphs:[['검사용 원고의 전체 문장입니다.']]}],core.SOURCES[3]);
 vm.runInContext("chunks=corpus;chatStore.save=async()=>{throw new Error('저장 실패')}",s.context);
 s.get('question').value='10월 4일 주일말씀 요약해줘';s.get('model').value='gemini-lite';s.get('scope').value='all';
 let aiCalls=0;s.context.generateViaServer=async()=>{aiCalls++;};await s.get('ask').onclick();
 assert.equal(aiCalls,0);assert.equal(vm.runInContext('dirty',s.context),true);assert.equal(vm.runInContext('thread.messages[0].content',s.context),'10월 4일 주일말씀 요약해줘');assert(!s.get('retrySave').classes.has('hidden'));
});
