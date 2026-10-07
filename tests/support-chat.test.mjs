import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {guestIdentity,createSupportStore,GUEST_KEY} from '../contact-store.mjs';
test('로그인 없이 브라우저마다 다른 256비트 문의 키를 만들고 같은 브라우저에서 복원',()=>{
 const storage=()=>{const map=new Map();return {getItem:k=>map.get(k)||null,setItem:(k,v)=>map.set(k,v)};};
 const a=storage(),b=storage(),one=guestIdentity(a,webcrypto);assert.equal(one.token.length,64);assert.deepEqual(guestIdentity(a,webcrypto),one);assert.notEqual(guestIdentity(b,webcrypto).token,one.token);
 a.setItem(GUEST_KEY,'invalid JSON');assert.notEqual(guestIdentity(a,webcrypto).token,one.token);
});
test('방문자 요청에는 로그인 토큰과 관리자 권한을 전송하지 않고 문의 키는 URL에 넣지 않음',async()=>{
 const requests=[];const config={supabaseUrl:'https://fixture.invalid',supabaseAnonKey:'fixture-public-key'};
 const store=createSupportStore(config,{getAccessToken:async()=>{throw new Error('guest asked for auth');},fetcher:async(url,opts)=>{requests.push({url,opts});return {ok:true,json:async()=>({messages:[],more:false})};}});
 const guest={id:webcrypto.randomUUID(),token:'a'.repeat(64)},message={id:webcrypto.randomUUID(),body:'문의 내용'};
 await store.guestSend(guest,message,'방문자');await store.guestRead(guest,5);
 for(const r of requests){assert.equal(r.opts.headers.Authorization,undefined);assert.equal(r.opts.credentials,'omit');assert(!r.url.includes(guest.token));assert.equal(JSON.parse(r.opts.body).p_token,guest.token);assert(!('sender' in JSON.parse(r.opts.body)));}
 assert.equal(JSON.parse(requests[0].opts.body).p_message_id,message.id);
});
test('관리자 요청은 매번 확인한 Google 세션을 사용하고 없는 세션은 호출 전에 차단',async()=>{
 let token=null,calls=0;const store=createSupportStore({supabaseUrl:'https://fixture.invalid',supabaseAnonKey:'public'},{getAccessToken:async()=>token,fetcher:async(url,o)=>{calls++;assert.equal(o.headers.Authorization,'Bearer verified-token');return {ok:true,json:async()=>true};}});
 await assert.rejects(store.adminStatus(),/Google/);assert.equal(calls,0);token='verified-token';assert.equal(await store.adminStatus(),true);assert.equal(calls,1);
});
test('응답 유실 후 재전송에도 같은 메시지 ID를 유지하고 서버 오류의 민감한 원문은 표시하지 않음',async()=>{
 const guest={id:webcrypto.randomUUID(),token:'b'.repeat(64)},msg={id:webcrypto.randomUUID(),body:'재전송 문의'},ids=[];
 const store=createSupportStore({supabaseUrl:'https://fixture.invalid',supabaseAnonKey:'public'},{fetcher:async(url,o)=>{ids.push(JSON.parse(o.body).p_message_id);return {ok:false,json:async()=>({message:'database leaked sensitive body',details:guest.token})};}});
 for(let i=0;i<2;i++)await assert.rejects(store.guestSend(guest,msg),e=>!e.message.includes('sensitive')&&!e.message.includes(guest.token));assert.deepEqual(ids,[msg.id,msg.id]);
});
