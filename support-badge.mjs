const SESSION_KEY='sayeon-ai-google-session';
const STYLE=`#support-inquiry-badge{display:none;position:fixed;left:50%;bottom:calc(12px + env(safe-area-inset-bottom,0px));transform:translateX(-50%);z-index:80;max-width:calc(100vw - 28px);padding:12px 20px;border:1px solid #92b081;border-radius:24px;background:#edf6e8;color:#263b20;font:600 14px/1.4 Arial,'Noto Sans KR',sans-serif;text-decoration:none;box-shadow:0 3px 14px #0002;white-space:nowrap;touch-action:manipulation}#support-inquiry-badge[hidden]{display:none!important}@media(max-width:720px){#support-inquiry-badge{display:block}body.support-badge-visible{padding-bottom:76px}}`;
export function createInquiryBadge({link,getCounts,hasSession=()=>true,isVisible=()=>!document.hidden,onDisplay=()=>{}}){
 let epoch=0,working=false;
 function hide(){epoch++;link.hidden=true;link.textContent='';onDisplay(false);}
 async function refresh(){
  if(!hasSession()){hide();return;}if(working||!isVisible())return;
  working=true;const version=epoch;
  try{const counts=await getCounts();if(version!==epoch)return;if(!hasSession()){hide();return;}
   if(!Number.isSafeInteger(counts?.pending)||counts.pending<0)throw Error('Invalid count');
   link.textContent=`✉ 신규 문의 ${counts.pending}건 · 문의함 ›`;link.hidden=false;onDisplay(true);
  }catch{if(version===epoch)hide();}finally{working=false;}
 }
 return {refresh,hide};
}
function loadSDK(){
 if(window.supabase?.createClient)return Promise.resolve(window.supabase);
 return new Promise((resolve,reject)=>{const script=document.createElement('script');script.src='https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/dist/umd/supabase.js';script.integrity='sha384-Rj26LVGvoeRVR6+mwQmFfcR3QOBEwT+ZmuCWpuiqeTzJpCs0ER4ITAWGb4Hiy3Ok';script.crossOrigin='anonymous';script.onload=()=>window.supabase?.createClient?resolve(window.supabase):reject(Error('SDK unavailable'));script.onerror=()=>reject(Error('SDK unavailable'));document.head.appendChild(script);});
}
export function mountInquiryBadge({client,config=window.SAYEON_ANALYTICS_CONFIG}={}){
 if(document.getElementById('support-inquiry-badge'))return;
 const hasSession=()=>{try{return !!localStorage.getItem(SESSION_KEY);}catch{return false;}};
 const style=document.createElement('style');style.textContent=STYLE;document.head.appendChild(style);
 const link=document.createElement('a');link.id='support-inquiry-badge';link.href='/sayeon/contact.html';link.title='아직 답변하지 않은 문의';link.setAttribute('aria-live','polite');link.hidden=true;document.body.appendChild(link);
 let auth=client,starting=null;
 async function getClient(){
  if(auth)return auth;
  starting ||= loadSDK().then(sdk=>{
   auth=sdk.createClient(config.supabaseUrl,config.supabaseAnonKey,{auth:{flowType:'pkce',storageKey:SESSION_KEY,persistSession:true,autoRefreshToken:true,detectSessionInUrl:false}});
   auth.auth.onAuthStateChange((_event,session)=>{if(!session)badge.hide();else setTimeout(()=>void badge.refresh(),0);});return auth;
  }).catch(e=>{starting=null;throw e;});return starting;
 }
 const badge=createInquiryBadge({link,hasSession,onDisplay:visible=>document.body.classList.toggle('support-badge-visible',visible),getCounts:async()=>{
  if(!config?.supabaseUrl||!config.supabaseAnonKey)throw Error('No config');
  const c=await getClient(),{data}=await c.auth.getSession();if(!data.session)throw Error('No session');
  // The server checks the signed Google identity and designated owner on every request.
  const r=await fetch(config.supabaseUrl+'/rest/v1/rpc/support_admin_counts',{method:'POST',headers:{apikey:config.supabaseAnonKey,Authorization:'Bearer '+data.session.access_token,'Content-Type':'application/json'},body:'{}',credentials:'omit',signal:AbortSignal.timeout(15000)});
  if(!r.ok)throw Error('Not administrator');return await r.json();
 }});
 if(client)client.auth.onAuthStateChange((_event,session)=>{if(!session)badge.hide();else setTimeout(()=>void badge.refresh(),0);});
 window.addEventListener('storage',e=>{if(e.key===SESSION_KEY){badge.hide();void badge.refresh();}});
 window.addEventListener('pageshow',()=>void badge.refresh());document.addEventListener('visibilitychange',()=>{if(!document.hidden)void badge.refresh();});
 setInterval(()=>void badge.refresh(),15000);void badge.refresh();return badge;
}
if(typeof document!=='undefined'&&document.querySelector('script[data-inquiry-badge]'))mountInquiryBadge();
