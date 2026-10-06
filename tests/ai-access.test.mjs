import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
function setup(){
 class Element{
  constructor(){this.value='';this.textContent='';this.children=[];this.disabled=false;this.checked=false;this.style={};this.classes=new Set();this.classList={add:x=>this.classes.add(x),remove:x=>this.classes.delete(x),toggle:(x,on)=>on?this.classes.add(x):this.classes.delete(x)};}
  append(...values){this.children.push(...values);}replaceChildren(...values){this.children=values;}setAttribute(){}focus(){}select(){}remove(){}
 }
 const elements=new Map(),get=id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id);};get('lab').classes.add('hidden');get('freeOnly').checked=true;
 const writes=[],calls=[],copied=[];
 const context={document:{getElementById:get,createElement:()=>new Element(),querySelectorAll:()=>[],body:new Element()},window:{SAYEON_ANALYTICS_CONFIG:{},SaCrypt:{ready:()=>false,resume:async()=>false},addEventListener:()=>{}},localStorage:{getItem:()=>null,setItem:(...args)=>writes.push(args)},crypto:webcrypto,AbortController,setTimeout,clearTimeout,fetch:async()=>{},navigator:{clipboard:{writeText:async s=>copied.push(s)}},MODELS:{},SOURCES:[],toChunks:()=>[],retrieve:()=>[],clean:x=>x,sourceCaption:()=>'',requestServer:async(config,token)=>{calls.push({...token});if(token.password!=='fixture-pass')throw new Error('AI 챗봇 비밀번호가 맞지 않습니다.');return {ready:true,models:[],quota:{remaining:30}};},generateViaServer:()=>{}};
 vm.createContext(context);const source=readFileSync(new URL('../ai-lab.mjs',import.meta.url),'utf8').replace(/^import .*;\n/gm,'');vm.runInContext(source,context);return {context,get,writes,calls,copied};
}
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
