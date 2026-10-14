import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
import * as core from '../admin/ai-core.mjs';
import * as chat from '../ai-chat.mjs';
import * as members from '../ai-members.mjs';
import * as counselCore from '../ai-counsel-core.mjs';
function setup(){
 class Element{
  constructor(){this.value='';this.textContent='';this.children=[];this.disabled=false;this.checked=false;this.style={};this.dataset={};this.open=false;this.scrollHeight=100;this.classes=new Set();this.classList={add:x=>this.classes.add(x),remove:x=>this.classes.delete(x),contains:x=>this.classes.has(x),toggle:(x,on)=>{const enabled=on??!this.classes.has(x);if(enabled)this.classes.add(x);else this.classes.delete(x);return enabled;}};}
  append(...values){this.children.push(...values);}replaceChildren(...values){this.children=values;}setAttribute(){}focus(){}select(){}remove(){}addEventListener(){}showModal(){this.open=true;}close(){this.open=false;}
 }
 const elements=new Map(),get=id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id);};get('lab').classes.add('hidden');get('freeOnly').checked=true;
 const writes=[],calls=[],copied=[];
 const context={...chat,...members,...counselCore,analyzeViaServer:core.analyzeViaServer,createVoiceInput:()=>({stop(){}}),URL,location:{hash:"",pathname:"/ai-lab.html"},DOMException,TextEncoder,structuredClone,document:{getElementById:get,createElement:()=>new Element(),querySelectorAll:()=>[],addEventListener:()=>{},body:new Element()},window:{SAYEON_ANALYTICS_CONFIG:{},SaCrypt:{ready:()=>false,resume:async()=>false},addEventListener:()=>{}},localStorage:{getItem:()=>null,setItem:(...args)=>writes.push(args)},crypto:webcrypto,AbortController,setTimeout,clearTimeout,fetch:async()=>{},navigator:{clipboard:{writeText:async s=>copied.push(s)}},normalizeScope:core.normalizeScope,MODELS:{},SOURCES:[],toChunks:()=>[],retrieve:()=>[],clean:x=>x,sourceCaption:()=>'',requestServer:async(config,token)=>{calls.push(token);if(token!=='fixture-token')throw new Error('Google 로그인 확인이 필요합니다.');return {ready:true,models:[],quota:{remaining:30}};},generateViaServer:()=>{}};
 context.membershipFixture={approved:true,status:'approved',isAdmin:false};vm.createContext(context);const source=readFileSync(new URL('../ai-lab.mjs',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'');vm.runInContext(source,context);
 vm.runInContext("googleUser={id:'31dfdc34-a567-4e6d-9a15-d37ab6f517db',email:'fixture@example.test'};authClient={rpc:async()=>({data:membershipFixture,error:null}),auth:{signOut:async()=>{},getSession:async()=>({data:{session:{access_token:'fixture-token',user:googleUser}}})}};chatStore={list:async()=>[],save:async t=>({id:t.id,revision:(t.revision??-1)+1}),remove:async()=>{}}",context);
 return {context,get,writes,calls,copied};
}

// ===== AI 챗봇이 고민과 말씀 질문을 AI 로 파악해 처리하는 흐름 =====
globalThis.__counselGapMs=0;
const worryDocs=()=>core.toChunks([
 {no:1,title:'성령 말씀 1',paragraphs:[['신앙생활 하면서 하나님 오해하지 말고,','형제 오해하지 말아라.','오해하면 힘 빠지고 넘어진다.']]},
 {no:2,title:'성령 말씀 2',paragraphs:[['마음 단단히 먹고, 실족하지 말아라.','낙심하지 말고 열심히 하자.']]},
 {no:3,title:'성령 말씀 3',paragraphs:[['인내하며 믿음을 지켜야 한다.','끝까지 참고 견디는 것이 인내다.']]}],core.SOURCES[0]);
async function boot(){
 const s=setup();await vm.runInContext('refreshMembership(true)',s.context);
 Object.assign(s.context,{MODELS:core.MODELS,resolveQuestion:core.resolveQuestion,wholeRequest:core.wholeRequest,checkWholeCoverage:core.checkWholeCoverage,sourceCaption:core.sourceCaption});
 s.context.corpus=worryDocs();vm.runInContext('chunks=corpus',s.context);s.get('scope').value='all';s.get('model').value='gemini-lite';
 s.analysis=[];s.generated=[];
 s.context.generateViaServer=async(...args)=>{s.generated.push(args);const doc=args[4][0];const st={label:'핵심',text:'말씀에 있는 뜻을 풀어 전합니다.',kind:'source',sources:[{id:doc.id,quote:doc.text.slice(0,12)}]};
  return {model:'fixture',answer:core.validateAnswer(JSON.stringify({supported:true,overview:[{title:'위로',points:[st]},{title:'조언',points:[st]}],claims:[st]}),args[4])};};
 return s;
}
const analysisOf=(kind,keywords=['낙심','실족','열심'])=>({analysis:{kind,summary:'핵심 요약입니다.',themes:['낙심'],keywords}});
const lastAssistant=s=>vm.runInContext('thread.messages',s.context).filter(m=>m.role==='assistant').at(-1);

test('고민이면 AI 분석 → 낱말로 말씀 찾기 → 위로·조언 요청, 답에는 상담 표시와 이해한 내용을 저장',async()=>{
 const s=await boot();
 s.context.analyzeViaServer=async(...a)=>{s.analysis.push(a);return analysisOf('worry');};
 s.get('question').value='요즘 모든 게 버겁고 아무것도 하기 싫어요';await s.get('ask').onclick();
 assert.equal(s.analysis.length,1);assert.equal(s.analysis[0][2],'gemini-lite');assert.equal(s.generated.length,1);
 const [,,,question,evidence]=s.generated[0];
 assert(question.startsWith('[고민 상담] 요즘 모든 게'));assert(question.includes('핵심: 핵심 요약입니다.'));assert(question.length<=600);
 assert(evidence.some(d=>/낙심/.test(d.text)),'고민 글에 없는 낱말(낙심)로 찾은 말씀이 근거에 들어간다');
 const m=lastAssistant(s);assert.equal(m.result.counsel,true);assert.equal(m.result.understood,'핵심 요약입니다.');assert(m.evidence.length>=1);
 assert(!/\[고민 상담\]/.test(JSON.stringify(m.result)));
});
test('말씀 질문이면 AI 낱말로 근거를 찾되 질문은 그대로, 정리체 답(상담 표시 없음)',async()=>{
 const s=await boot();
 s.context.analyzeViaServer=async(...a)=>{s.analysis.push(a);return analysisOf('question',['인내','견디','참고']);};
 s.get('question').value='끝까지 해야 하는 이유가 뭐예요?';await s.get('ask').onclick();
 assert.equal(s.analysis.length,1);assert.equal(s.generated.length,1);assert.equal(s.generated[0][3],'끝까지 해야 하는 이유가 뭐예요?');
 assert(s.generated[0][4].some(d=>/인내/.test(d.text)));
 const m=lastAssistant(s);assert.equal(m.result.counsel,undefined);assert.equal(m.result.understood,'핵심 요약입니다.');
});
test('서버가 분석 기능을 모르면(400) 예전 방식으로 답하고, 한도·권한 오류는 답 생성 없이 멈춘다',async()=>{
 let s=await boot();
 s.context.analyzeViaServer=async()=>{throw Object.assign(new Error('허용되지 않은 요청입니다.'),{status:400});};
 s.get('question').value='인내가 뭐예요';await s.get('ask').onclick();
 assert.equal(s.generated.length,1);assert.equal(s.generated[0][3],'인내가 뭐예요');assert.equal(lastAssistant(s).result.understood,undefined);
 for(const status of [429,403,401]){
  s=await boot();s.context.analyzeViaServer=async()=>{throw Object.assign(new Error('거절'),{status});};
  s.get('question').value='인내가 뭐예요';await s.get('ask').onclick();assert.equal(s.generated.length,0);
 }
});
test('위험한 말은 AI 를 부르지 않고 109 안내를 대화에 남긴다',async()=>{
 const s=await boot();s.context.analyzeViaServer=async(...a)=>{s.analysis.push(a);return analysisOf('worry');};
 s.get('question').value='너무 힘들어서 죽고 싶어요';await s.get('ask').onclick();
 assert.equal(s.analysis.length,0);assert.equal(s.generated.length,0);assert.match(lastAssistant(s).content,/109/);
});
test('날짜 말씀 전체·검색 전용 모델에서는 AI 분석을 하지 않는다',async()=>{
 const s=await boot();s.context.analyzeViaServer=async(...a)=>{s.analysis.push(a);return analysisOf('worry');};
 s.context.corpus=core.toChunks([{no:73,title:'10월 4일 주일말씀',paragraphs:[['처음 내용입니다.'],['마지막 결론입니다.']]}],core.SOURCES[3]);vm.runInContext('chunks=corpus',s.context);
 s.get('question').value='10월 4일 주일말씀 요약해줘';await s.get('ask').onclick();assert.equal(s.analysis.length,0);assert.equal(s.generated.length,1);
 const t=await boot();t.context.analyzeViaServer=async(...a)=>{t.analysis.push(a);return analysisOf('worry');};
 t.get('model').value='search';t.get('question').value='인내가 뭐예요';await t.get('ask').onclick();assert.equal(t.analysis.length,0);assert.equal(t.generated.length,0);
});
