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
 const elements=new Map(),get=id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id);};get('lab').classes.add('hidden');
 const writes=[],calls=[],copied=[];
 const context={document:{getElementById:get,createElement:()=>new Element(),querySelectorAll:()=>[],body:new Element()},window:{SAYEON_ANALYTICS_CONFIG:{},SaCrypt:{ready:()=>false,resume:async()=>false},addEventListener:()=>{}},localStorage:{getItem:()=>null,setItem:(...args)=>writes.push(args)},crypto:webcrypto,AbortController,setTimeout,clearTimeout,fetch:async()=>{},navigator:{clipboard:{writeText:async s=>copied.push(s)}},MODELS:{},SOURCES:[],toChunks:()=>[],retrieve:()=>[],clean:x=>x,sourceCaption:()=>'',requestServer:async(config,token)=>{calls.push({...token});if(token.password!=='fixture-pass')throw new Error('AI 챗봇 비밀번호가 맞지 않습니다.');return {ready:true,models:[],quota:{remaining:30}};},generateViaServer:()=>{}};
 vm.createContext(context);const source=readFileSync(new URL('../ai-lab.mjs',import.meta.url),'utf8').replace(/^import .*;\n/,'');vm.runInContext(source,context);return {context,get,writes,calls,copied};
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
