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

// ===== 연속 대화: 앞 답을 기억해 이어서 답한다 =====
import {buildHistory,isContinuation,counselFollowUp,DEFAULT_GUIDE} from '../ai-counsel-core.mjs';
async function afterWorryAnswer(){
 const s=await boot();
 s.context.analyzeViaServer=async(...a)=>{s.analysis.push(a);return analysisOf('worry');};
 s.get('question').value='요즘 모든 게 버겁고 아무것도 하기 싫어요';await s.get('ask').onclick();
 assert.equal(s.generated.length,1);s.analysis.length=0;return s;
}
test('상담 답 뒤 "더 길게 답해줘"는 새 검색 없이 같은 근거·상담 말투·앞 대화로 이어서 답한다',async()=>{
 const s=await afterWorryAnswer(),first=s.generated[0];
 s.get('question').value='더 길게 답해줘';await s.get('ask').onclick();
 assert.equal(s.analysis.length,0,'이어 말하기는 AI 분석을 다시 하지 않는다');assert.equal(s.generated.length,2);
 const [,,,question,evidence,,,,,history]=s.generated[1];
 assert(question.startsWith('[고민 상담 이어서] 더 길게 답해줘'));assert(question.endsWith(DEFAULT_GUIDE.slice(-20))||question.includes('목사님'));assert(question.length<=600);
 assert.deepEqual(evidence.map(d=>d.id),first[4].map(d=>d.id),'앞 답의 근거 그대로');
 assert.equal(history[0].role,'user');assert(history[0].text.startsWith('요즘 모든 게'));assert.equal(history.at(-1).role,'assistant');assert(history.at(-1).text.includes('말씀에 있는 뜻을 풀어 전합니다'));
 assert(!history.some(h=>h.text==='더 길게 답해줘'),'지금 보내는 말은 history 에 중복해 넣지 않는다');
 const m=lastAssistant(s);assert.equal(m.result.counsel,true);assert.equal(m.result.understood,'핵심 요약입니다.');
});
test('정규식에 안 걸리는 이어 말하기도 AI 가 followup 으로 가리면 앞 근거·앞 대화로 이어 간다',async()=>{
 const s=await afterWorryAnswer(),first=s.generated[0];
 s.context.analyzeViaServer=async(...a)=>{s.analysis.push(a);return analysisOf('followup',['낙심']);};
 s.get('question').value='그러니까 구체적으로 어떻게 하라는 건가요';await s.get('ask').onclick();
 assert.equal(s.analysis.length,1);assert(/이전 질문: 요즘 모든 게/.test(s.analysis[0][3]),'앞 대화 요지를 분석에 같이 보낸다');assert(/지금 글: 그러니까 구체적으로/.test(s.analysis[0][3]));assert(s.analysis[0][3].length<=600);
 const g=s.generated[1];assert.deepEqual(g[4].map(d=>d.id),first[4].map(d=>d.id));assert(g[3].startsWith('[고민 상담 이어서]'));assert(g[9].length>=2);
});
test('새 고민이면 앞 답이 있어도 새로 분석·검색하고 앞 대화는 섞지 않는다',async()=>{
 const s=await afterWorryAnswer();
 s.context.analyzeViaServer=async(...a)=>{s.analysis.push(a);return analysisOf('worry',['인내','견디']);};
 s.get('question').value='이번에는 가족 문제로 마음이 무거워요';await s.get('ask').onclick();
 assert.equal(s.analysis.length,1);const g=s.generated[1];assert(g[3].startsWith('[고민 상담] 이번에는 가족'));assert.equal((g[9]||[]).length,0,'새 질문에는 앞 대화를 보내지 않는다');
});
test('말씀 질문 답 뒤 이어 말하기는 정리체 요청에 앞 대화를 붙인다',async()=>{
 const s=await boot();s.context.analyzeViaServer=async(...a)=>{s.analysis.push(a);return analysisOf('question',['인내','견디']);};
 s.get('question').value='끝까지 해야 하는 이유가 뭐예요?';await s.get('ask').onclick();s.analysis.length=0;
 s.get('question').value='좀 더 자세히 알려줘';await s.get('ask').onclick();
 assert.equal(s.analysis.length,0);const g=s.generated[1];assert(!g[3].startsWith('[고민 상담'));assert(g[3].startsWith('좀 더 자세히 알려줘'));assert(g[9].length>=2);assert.equal(lastAssistant(s).result.counsel,undefined);
});
test('이어 말하기 판별과 대화 기록 만들기',()=>{
 for(const q of ['더 길게 답해줘','좀 더 자세히','조금 더 쉽게 설명해줘','계속','이어서 써줘','다시 짧게','예를 들어 주세요','길게 답해줘']) assert(isContinuation(q),q);
 for(const q of ['또 힘든 일이 있어요','오해를 어떻게 풀어요?','10월 4일 주일말씀 더 자세히','']) assert(!isContinuation(q),q);
 const long='가'.repeat(1900);
 const msgs=[{role:'user',content:'첫 질문'},{role:'assistant',content:'',result:{answer:{overview:[{title:'t',points:[{text:'답 하나'},{text:'답 둘'}]}]}}},{role:'assistant',content:'실패',failed:true},{role:'user',content:long},{role:'assistant',content:long},{role:'user',content:long},{role:'assistant',content:long}];
 const h=buildHistory(msgs);assert(h.length<=6);assert.equal(h[0].role,'user');assert(h.reduce((n,x)=>n+x.text.length,0)<=8000);assert(!h.some(x=>x.text==='실패'));
 assert.deepEqual(buildHistory(msgs.slice(0,3)),[{role:'user',text:'첫 질문'},{role:'assistant',text:'답 하나\n답 둘'}]);
 assert.equal(counselFollowUp('더 길게 답해줘','지침').length<=600,true);assert.equal(counselFollowUp('더 길게','지침'),'[고민 상담 이어서] 더 길게 — 지침');
});
