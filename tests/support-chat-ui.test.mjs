import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync} from 'node:fs';import {webcrypto} from 'node:crypto';
import {guestIdentity,createSupportStore,GUEST_KEY} from '../contact-store.mjs';
function fixture(){
 const state={rows:[],messages:[],seq:0};
 const fetcher=async(url,options)=>{const name=url.split('/').at(-1),a=JSON.parse(options.body);let value;
  if(name==='support_admin_status')value=true;
  if(name==='support_admin_list')value=state.rows;
  if(name==='support_guest_send'||name==='support_admin_send'){
   let row=state.rows.find(x=>x.id===a.p_id);if(!row){row={id:a.p_id,display_name:a.p_name,subject:a.p_body,unread:true};state.rows.push(row);}
   if(!state.messages.some(m=>m.client_id===a.p_message_id))state.messages.push({seq:++state.seq,client_id:a.p_message_id,conversation:a.p_id,sender:name==='support_admin_send'?'admin':'guest',body:a.p_body,created_at:new Date().toISOString()});value={messageId:a.p_message_id};
  }
  if(name==='support_guest_read'||name==='support_admin_read')value={messages:state.messages.filter(m=>m.conversation===a.p_id&&m.seq>a.p_after),more:false};
  return {ok:true,json:async()=>structuredClone(value)};
 };return {state,fetcher};
}
async function page(f,admin=false,saved=new Map()){
 class Element {constructor(){this.children=[];this.value='';this.textContent='';this.classList={toggle(){}};}append(...nodes){this.children.push(...nodes);}replaceChildren(...nodes){this.children=nodes;}addEventListener(){}focus(){}scrollIntoView(){}get lastElementChild(){return this.children.at(-1);}}
 const nodes=new Map(),get=id=>{if(!nodes.has(id))nodes.set(id,new Element());return nodes.get(id);},events=[];
 const user={id:'fixture-owner',email:'owner@example.invalid'},session=admin?{user,access_token:'fixture-owner-token'}:null;
 const ctx={console,URL,Date,Map,JSON,Number,crypto:webcrypto,AbortController,AbortSignal,localStorage:{getItem:k=>saved.get(k)||null,setItem:(k,v)=>saved.set(k,v),removeItem:k=>saved.delete(k)},location:{origin:'https://fixture.invalid'},setInterval:()=>1,setTimeout,clearTimeout,fetch:f.fetcher,document:{getElementById:get,createElement:()=>new Element(),hidden:false,body:new Element(),addEventListener(){}},window:{SAYEON_ANALYTICS_CONFIG:{enabled:true,supabaseUrl:'https://fixture.invalid',supabaseAnonKey:'public'},supabase:{createClient:()=>({auth:{getSession:async()=>({data:{session}}),getUser:async()=>({data:{user},error:null}),onAuthStateChange:cb=>events.push(cb)}})}},guestIdentity,createSupportStore:(cfg,o)=>createSupportStore(cfg,{...o,fetcher:f.fetcher}),GUEST_KEY};
 ctx.createSupportNotifications=()=>({setAdmin(){}});
 ctx.mountInquiryBadge=()=>{};
 vm.createContext(ctx);let source=readFileSync(new URL('../contact.mjs',import.meta.url),'utf8').replace(/^import.*\r?\n/gm,'').replace('draw();void boot();','draw();globalThis.ready=boot();');vm.runInContext(source,ctx);await ctx.ready;return {ctx,get,events,saved};
}
test('문의 화면에서 로그인 없이 전송하고 같은 대화의 관리자 답변을 이어 읽음',async()=>{
 const f=fixture(),guest=await page(f);guest.get('body').value='<script>문의 내용</script>';await vm.runInContext('send()',guest.ctx);
 assert.equal(f.state.rows.length,1);assert.equal(guest.get('body').value,'');assert.equal(guest.get('messages').children.length,1);assert.equal(guest.get('messages').children[0].children[1].textContent,'<script>문의 내용</script>');
 const admin=await page(f,true);await admin.get('threadList').children[0].onclick();admin.get('body').value='관리자 답변';await vm.runInContext('send()',admin.ctx);await vm.runInContext('read()',guest.ctx);
 assert.equal(guest.get('messages').children.length,2);assert.equal(guest.get('messages').children[1].children[0].textContent,'관리자');assert.equal(guest.get('messages').children[1].children[1].textContent,'관리자 답변');const restored=await page(f,false,guest.saved);assert.equal(restored.get('messages').children.length,2);assert.equal(f.state.rows.length,1);
});
test('관리자 로그아웃은 열려 있는 개인 문의 내용을 즉시 지움',async()=>{
 const f=fixture(),guest=await page(f);guest.get('body').value='비공개 문의';await vm.runInContext('send()',guest.ctx);const admin=await page(f,true);await admin.get('threadList').children[0].onclick();assert.equal(admin.get('messages').children[0].children[1].textContent,'비공개 문의');
 admin.events[0]('SIGNED_OUT',null);assert.equal(admin.get('inbox').hidden,true);assert.equal(admin.get('title').textContent,'관리자에게 문의하기');assert.equal(admin.get('messages').children[0].textContent,'궁금한 점이나 수정이 필요한 내용을 남겨 주세요.');
});
