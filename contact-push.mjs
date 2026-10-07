export const SUPPORT_PUSH_SCOPE='/sayeon/contact.html';
export function keyBytes(value){return Uint8Array.from(atob(value.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-value.length%4)%4)),c=>c.charCodeAt(0));}
export function createSupportNotifications({store,panel,on,off,test,info,isAdmin,nav=navigator,win=window}){
 let enabled=false,busy=false,version=0,sub=null;
 const supported=()=>!!nav.serviceWorker&&'PushManager' in win&&'Notification' in win;
 const say=text=>{info.textContent=text;};
 function paint(){on.hidden=enabled;off.hidden=!enabled;test.hidden=!enabled;on.disabled=off.disabled=test.disabled=busy;}
 async function current(){
  const reg=await nav.serviceWorker.getRegistration(SUPPORT_PUSH_SCOPE);
  return reg?.scope===new URL(SUPPORT_PUSH_SCOPE,win.location.origin).href?await reg.pushManager.getSubscription():null;
 }
 function active(reg){
  if(reg.active?.state==='activated')return Promise.resolve();
  return new Promise((resolve,reject)=>{
   const worker=reg.installing||reg.waiting||reg.active;
   if(!worker)return reject(new Error('알림 연결을 새로고침해 주세요.'));
   const timer=setTimeout(()=>{worker.removeEventListener('statechange',change);reject(new Error('알림 연결이 늦습니다. 다시 눌러 주세요.'));},20000);
   function change(){if(worker.state==='activated'||worker.state==='redundant'){clearTimeout(timer);worker.removeEventListener('statechange',change);worker.state==='activated'?resolve():reject(new Error('알림 연결을 다시 시도해 주세요.'));}}
   worker.addEventListener('statechange',change);change();
  });
 }
 async function refresh(){
  const rev=++version;panel.hidden=!isAdmin();if(!isAdmin())return;
  if(!supported()){enabled=false;paint();on.disabled=true;say('Android Chrome 또는 삼성 인터넷에서 열어 주세요. 아이폰은 홈 화면에 추가한 앱에서 알림을 받을 수 있습니다.');return;}
  try{sub=await current();const saved=sub&&await store.pushStatus(sub.endpoint);if(rev!==version||!isAdmin())return;enabled=!!saved;
   say(enabled?'이 기기에서 새 문의 알림을 받습니다. 화면을 닫아도 알림이 옵니다.':'휴대폰에서 알림 받기를 누르고 알림을 허용해 주세요.');
  }catch{if(rev===version)say('알림 연결 상태를 확인하지 못했습니다. 다시 시도해 주세요.');}paint();
 }
 async function action(work){
  if(busy||!isAdmin())return;busy=true;const rev=version;paint();
  try{await work();if(rev!==version||!isAdmin())return;}catch(e){if(rev===version&&isAdmin())say(e.message||'알림 연결을 다시 확인해 주세요.');}finally{busy=false;if(rev===version)paint();}
 }
 on.onclick=()=>action(async()=>{
  if(!supported())throw new Error('Android Chrome 또는 삼성 인터넷에서 열어 주세요.');
  // Permission must be requested directly from the administrator's button tap.
  const permission=await win.Notification.requestPermission();
  if(permission!=='granted')throw new Error('브라우저의 사이트 알림 설정에서 알림을 허용해 주세요.');
  const cfg=await store.pushConfig();if(!isAdmin())return;
  if(!cfg?.publicKey)throw new Error('문의 알림 연결을 준비하고 있습니다. 다시 시도해 주세요.');
  const reg=await nav.serviceWorker.register('/sayeon/support-sw.js',{scope:SUPPORT_PUSH_SCOPE});await active(reg);
  sub=await reg.pushManager.getSubscription();
  if(!sub)sub=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:keyBytes(cfg.publicKey)});
  if(!isAdmin())return;
  const j=sub.toJSON();await store.pushSave(j);enabled=true;say('문의 알림을 켰습니다. 알림 시험을 눌러 휴대폰에 도착하는지 확인해 주세요.');
 });
 off.onclick=()=>action(async()=>{sub=await current();if(sub){await store.pushRemove(sub.endpoint);await sub.unsubscribe();}sub=null;enabled=false;say('이 기기의 문의 알림을 껐습니다.');});
 test.onclick=()=>action(async()=>{sub=await current();if(!sub)throw new Error('이 기기에서 알림 받기를 먼저 눌러 주세요.');await store.pushTest(sub.endpoint);say('시험 알림을 보냈습니다. 휴대폰 알림창을 확인해 주세요.');});
 return {setAdmin(visible){panel.hidden=!visible;if(!visible){version++;return;}void refresh();},refresh};
}
