import {guestIdentity,createSupportStore,GUEST_KEY} from './contact-store.mjs?v=2';
import {createSupportNotifications} from './contact-push.mjs?v=1';
const $=id=>document.getElementById(id),config=window.SAYEON_ANALYTICS_CONFIG;
let guest,authClient,store,isAdmin=false,adminMode=false,selected=null,rows=[],offset=0,messages=[],cursor=0,busy=false,pending=null,epoch=0,polling=false,guestStarted=false,refreshingList=false,adminUserId=null;
const messageMap=new Map();
let notifications;
function status(text,error=false){$('status').textContent=text;$('status').classList.toggle('error',error);}
function sync(){ $('send').disabled=busy||!store||(!$('body').value.trim())||(adminMode&&!selected);$('body').disabled=busy||(adminMode&&!selected);$('name').disabled=busy||guestStarted; }
function draw(){
 $('messages').replaceChildren();
 if(!messages.length){const p=document.createElement('p');p.className='empty';p.textContent=adminMode?'문의 목록에서 대화를 선택해 주세요.':'궁금한 점이나 수정이 필요한 내용을 남겨 주세요.';$('messages').append(p);return;}
 for(const m of messages){
  const el=document.createElement('article');el.className='message'+(m.sender===(adminMode?'admin':'guest')?' mine':'');
  const label=document.createElement('div');label.className='speaker';label.textContent=m.sender==='admin'?'관리자':adminMode?(selected?.display_name||'방문자'):'나';
  const text=document.createElement('div');text.className='bubble';text.textContent=m.body;
  const time=document.createElement('time');time.dateTime=m.created_at;time.textContent=new Date(m.created_at).toLocaleString('ko-KR',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'});el.append(label,text,time);$('messages').append(el);
 }
}
function resetMessages(){epoch++;cursor=0;messages=[];messageMap.clear();pending=null;draw();sync();}
async function read(){
 if(polling||!store||(adminMode?!selected:!guestStarted))return;
 polling=true;const requestEpoch=epoch,mode=adminMode,id=selected?.id;let changed=false;
 try{
  for(let page=0;page<20;page++){
   const data=await (mode?store.adminRead(id,cursor):store.guestRead(guest,cursor));
   if(requestEpoch!==epoch)return;
   if(!Array.isArray(data.messages))throw new Error('대화 기록을 확인하지 못했습니다.');
   for(const m of data.messages){if(!Number.isSafeInteger(m.seq)||!['guest','admin'].includes(m.sender)||typeof m.body!=='string')throw new Error('대화 기록 형식을 확인하지 못했습니다.');if(!messageMap.has(m.seq)){messageMap.set(m.seq,m);changed=true;}cursor=Math.max(cursor,m.seq);}
   if(!data.more||!data.messages.length)break;
  }
  if(changed){messages=[...messageMap.values()].sort((a,b)=>a.seq-b.seq);draw();}
  if(requestEpoch===epoch&&!busy)status('');
 }catch(e){if(requestEpoch===epoch)status(e.message,true);}finally{polling=false;}
}
function drawList(){
 $('threadList').replaceChildren();
 for(const row of rows){const button=document.createElement('button');button.type='button';button.className='thread'+(selected?.id===row.id?' active':'');const name=document.createElement('strong');name.textContent=row.display_name;const subject=document.createElement('span');subject.textContent=row.subject;button.append(name,subject);if(row.unread){const badge=document.createElement('em');badge.textContent='새 메시지';button.append(badge);}button.onclick=async()=>{if(busy)return;selected=row;resetMessages();$('title').textContent=row.display_name+'님의 문의';drawList();await read();};$('threadList').append(button);}
 $('listStatus').textContent=rows.length?'':'아직 도착한 문의가 없습니다.';$('previous').disabled=offset===0;$('next').disabled=rows.length<50;
}
async function list(){if(refreshingList||!adminMode)return;refreshingList=true;const version=epoch;try{const data=await store.adminList(offset);if(!adminMode||version!==epoch)return;rows=data;drawList();}catch(e){status(e.message,true);}finally{refreshingList=false;}}
async function mode(admin){
 if(busy)return;adminMode=admin;selected=null;resetMessages();document.body.classList.toggle('admin',admin);$('inbox').hidden=!admin;$('nameLabel').hidden=admin;$('visitorNote').hidden=admin;$('title').textContent=admin?'관리자 문의함':'관리자에게 문의하기';$('description').textContent=admin?'문의자를 선택하면 대화와 답변창이 열립니다.':'로그인 없이 문의를 남겨 주세요. 관리자가 확인한 뒤 이 대화창에서 답변합니다.';notifications?.setAdmin(admin);
 $('guestMode').hidden=!isAdmin||!admin;$('inboxMode').hidden=!isAdmin||admin;$('body').placeholder=admin?'답변을 입력하세요…':'문의할 내용을 입력하세요…';sync();if(admin)await list();else await read();
}
async function send(event){
 event?.preventDefault();if(busy||!store)return;const body=$('body').value.trim();if(!body||body.length>4000||adminMode&&!selected)return;
 const id=adminMode?selected.id:guest.id;
 if(pending&&(pending.conversation!==id||pending.body!==body)){status('전송 결과가 확인되지 않은 내용입니다. 같은 내용으로 다시 보내 주세요.',true);return;}
 pending ||= {id:crypto.randomUUID(),body,conversation:id};busy=true;sync();status('보내는 중…');const message=pending,sendEpoch=epoch,sentMode=adminMode;
 try{
  await (sentMode?store.adminSend(id,message):store.guestSend(guest,message,$('name').value));
  if(sendEpoch!==epoch)return;
  if(!adminMode){guestStarted=true;localStorage.setItem(GUEST_KEY,JSON.stringify({...guest,started:true,name:$('name').value}));}
  $('body').value='';pending=null;status('문의가 전달됐습니다.');await read();if(adminMode)await list();$('messages').lastElementChild?.scrollIntoView({behavior:'smooth',block:'end'});
 }catch(e){if(sendEpoch===epoch)status(e.message,true);}finally{busy=false;sync();if(sendEpoch===epoch)$('body').focus();}
}
$('composer').addEventListener('submit',send);$('body').addEventListener('input',sync);$('body').addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();void send();}});
$('refreshList').onclick=list;$('previous').onclick=()=>{offset=Math.max(0,offset-50);void list();};$('next').onclick=()=>{offset+=50;void list();};$('guestMode').onclick=()=>mode(false);$('inboxMode').onclick=()=>mode(true);
$('adminLogin').onclick=async()=>{
 if(!authClient){status('관리자 로그인 연결을 준비하고 있습니다.',true);return;}
 try{localStorage.setItem('sayeon-support-login-return','1');const {error}=await authClient.auth.signInWithOAuth({provider:'google',options:{redirectTo:location.origin+'/sayeon/ai-lab.html',queryParams:{prompt:'select_account'}}});if(error)throw error;}catch{localStorage.removeItem('sayeon-support-login-return');status('Google 로그인 연결을 확인해 주세요.',true);}
};
async function boot(){
 try{
  guest=guestIdentity(localStorage);guestStarted=!!guest.started;$('name').value=guest.name||'';
  if(!config?.enabled||!window.supabase?.createClient)throw new Error('문의 연결을 불러오지 못했습니다. 새로고침해 주세요.');
  authClient=window.supabase.createClient(config.supabaseUrl,config.supabaseAnonKey,{auth:{flowType:'pkce',storageKey:'sayeon-ai-google-session',persistSession:true,autoRefreshToken:true,detectSessionInUrl:false},global:{fetch:async(input,options={})=>{const timeout=new AbortController(),timer=setTimeout(()=>timeout.abort(),15000);try{return await fetch(input,{...options,signal:options.signal?AbortSignal.any([options.signal,timeout.signal]):timeout.signal});}finally{clearTimeout(timer);}}}});
  store=createSupportStore(config,{getAccessToken:async()=>{const verified=await authClient.auth.getUser();if(verified.error||!verified.data.user)return null;const {data}=await authClient.auth.getSession();return data.session?.user.id===verified.data.user.id?data.session.access_token:null;}});
  notifications=createSupportNotifications({store,panel:$('pushPanel'),on:$('pushEnable'),off:$('pushDisable'),test:$('pushTest'),info:$('pushStatus'),isAdmin:()=>isAdmin});
  const {data}=await authClient.auth.getSession();if(data.session){try{isAdmin=await store.adminStatus()===true;adminUserId=isAdmin?data.session.user.id:null;}catch{}}
  $('adminLogin').hidden=isAdmin;await mode(isAdmin);
  authClient.auth.onAuthStateChange((_event,session)=>{if(isAdmin&&session?.user?.id!==adminUserId){isAdmin=false;adminUserId=null;busy=false;void mode(false);$('adminLogin').hidden=false;}});
  sync();setInterval(()=>{if(!document.hidden){void read();if(adminMode)void list();}},8000);document.addEventListener('visibilitychange',()=>{if(!document.hidden){void read();if(adminMode)void list();}});
 }catch(e){store=null;sync();status(e.message,true);}
}
draw();void boot();
