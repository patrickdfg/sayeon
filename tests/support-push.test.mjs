import test from 'node:test';import assert from 'node:assert/strict';
import {createNotificationHandler,notificationPayload} from '../supabase/functions/support-notify/handler.mjs';
import {createSupportNotifications,SUPPORT_PUSH_SCOPE} from '../contact-push.mjs';
const token='a'.repeat(64),endpoint='https://fcm.googleapis.com/fcm/send/fixture';
test('dispatch rejects missing token and invalid Vault token without sending',async()=>{
 let calls=0;const h=createNotificationHandler({rpc:async()=>{calls++;throw Object.assign(new Error('denied'),{status:403});},buildRequest:()=>{throw Error('sent');}});
 assert.equal((await h(new Request('https://fixture.invalid',{method:'POST'}))).status,401);assert.equal(calls,0);
 assert.equal((await h(new Request('https://fixture.invalid',{method:'POST',headers:{'x-support-token':token}}))).status,403);assert.equal(calls,1);
});
test('push contains no inquiry text; each device is acknowledged under its own lease',async()=>{
 const ack=[],sent=[];const jobs=[{id:'one',lease:'lease1',endpoint,p256dh:'p',auth:'a',test:false},{id:'two',lease:'lease2',endpoint:endpoint+'2',p256dh:'p',auth:'a',test:true}];
 const h=createNotificationHandler({rpc:async(n,a)=>{if(n==='support_push_claim')return {jobs,finishToken:'private-completion-token',vapid:{publicKey:'public',privateKey:'private'}};ack.push(a);},buildRequest:(s,p)=>{sent.push(JSON.parse(p));return {endpoint:s.endpoint,method:'POST',headers:{},body:'encrypted'};},fetcher:async(u,o)=>{assert.equal(o.redirect,'error');return new Response(null,{status:u.endsWith('2')?410:201});}});
 const r=await h(new Request('https://fixture.invalid',{method:'POST',headers:{'x-support-token':token}}));assert.deepEqual(await r.json(),{processed:2,sent:1});assert.equal(ack[0].p_token,'private-completion-token');assert.equal(ack[0].p_lease,'lease1');assert.equal(ack[1].p_status,410);assert.equal(sent[0].url,'/sayeon/contact.html');assert.ok(!Object.keys(sent[0]).includes('conversation'));assert.equal(notificationPayload().title,'새 문의가 도착했습니다');assert.notEqual(notificationPayload(false,'one').tag,notificationPayload(false,'two').tag);assert.equal(notificationPayload(false,'one').tag,sent[0].tag);
});
test('unapproved host cannot receive a push and network failure is retriable',async()=>{
 const statuses=[];let fetches=0;const h=createNotificationHandler({rpc:async(n,a)=>n==='support_push_claim'?{jobs:[{id:'bad',lease:'1',endpoint:'https://attacker.invalid/',test:false},{id:'ok',lease:'2',endpoint,test:false}],vapid:{publicKey:'p',privateKey:'s'}}:statuses.push(a.p_status),buildRequest:s=>({endpoint:s.endpoint}),fetcher:async()=>{fetches++;throw Error('offline');}});
 await h(new Request('https://fixture.invalid',{method:'POST',headers:{'x-support-token':token}}));assert.equal(fetches,1);assert.deepEqual(statuses.sort(),[400,503]);
});
function browserFixture(permission='granted'){
 const panel={},on={},off={},trial={},info={},events=[];let owner=true,subscribed=null;
 const subscription={endpoint,toJSON:()=>({endpoint,keys:{p256dh:'B'.repeat(87),auth:'a'.repeat(22)}}),unsubscribe:async()=>{events.push('unsubscribe');subscribed=null;}};
 const root={scope:'https://fixture.invalid/sayeon/',pushManager:{getSubscription:async()=>{throw Error('public story subscription touched');}}};
 const reg={scope:'https://fixture.invalid'+SUPPORT_PUSH_SCOPE,active:{state:'activated'},pushManager:{getSubscription:async()=>subscribed,subscribe:async()=>{events.push('subscribe');return subscribed=subscription;}}};
 let registered=false;const nav={serviceWorker:{getRegistration:async()=>registered?reg:root,register:async(url,o)=>{assert.equal(o.scope,SUPPORT_PUSH_SCOPE);assert.equal(url,'/sayeon/support-sw.js');registered=true;return reg;}}};
 const win={location:{origin:'https://fixture.invalid'},PushManager:{},Notification:{requestPermission:async()=>{events.push('permission');return permission;}}};
 const store={pushConfig:async()=>({publicKey:'B'.repeat(87)}),pushSave:async()=>events.push('save'),pushStatus:async()=>true,pushRemove:async()=>events.push('remove'),pushTest:async()=>events.push('test')};
 const controller=createSupportNotifications({store,panel,on,off,test:trial,info,isAdmin:()=>owner,nav,win});return {controller,panel,on,off,trial,info,events,setOwner:v=>owner=v};
}
test('Android opt-in uses separate worker, permission first; disable removes server registration first',async()=>{
 const f=browserFixture();await f.controller.refresh();assert.equal(f.on.hidden,false);await f.on.onclick();assert.deepEqual(f.events,['permission','subscribe','save']);assert.equal(f.trial.hidden,false);await f.trial.onclick();assert.equal(f.events.at(-1),'test');await f.off.onclick();assert.deepEqual(f.events.slice(-2),['remove','unsubscribe']);assert.equal(f.on.hidden,false);
});
test('denied permission or signed-out owner cannot register or send notifications',async()=>{
 const f=browserFixture('denied');await f.on.onclick();assert.deepEqual(f.events,['permission']);assert.match(f.info.textContent,/허용/);f.setOwner(false);f.controller.setAdmin(false);assert.equal(f.panel.hidden,true);await f.on.onclick();await f.trial.onclick();assert.equal(f.events.length,1);
});
