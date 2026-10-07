export const GUEST_KEY='sayeon-support-guest-v1';
export function guestIdentity(storage,cryptoApi=crypto){
 let saved;try{saved=JSON.parse(storage.getItem(GUEST_KEY)||'null');}catch{}
 if(saved&&/^[0-9a-f-]{36}$/.test(saved.id)&&/^[0-9a-f]{64}$/.test(saved.token))return saved;
 const bytes=cryptoApi.getRandomValues(new Uint8Array(32));
 const value={id:cryptoApi.randomUUID(),token:Array.from(bytes,x=>x.toString(16).padStart(2,'0')).join('')};
 storage.setItem(GUEST_KEY,JSON.stringify(value));return value;
}
export function createSupportStore(config,{fetcher=fetch,getAccessToken=async()=>null}={}){
 async function rpc(name,args,admin=false){
  const headers={'Content-Type':'application/json',apikey:config.supabaseAnonKey};
  if(admin){const token=await getAccessToken();if(!token)throw new Error('관리자 Google 로그인이 필요합니다.');headers.Authorization='Bearer '+token;}
  const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),20000);
  try{
   const r=await fetcher(config.supabaseUrl+'/rest/v1/rpc/'+name,{method:'POST',headers,body:JSON.stringify(args),credentials:'omit',signal:ctrl.signal});
   const data=await r.json();if(!r.ok){const allowed=/^(이 브라우저의 문의 기록|문의 내용은|메시지를 너무 빠르게|지정된 관리자|문의 기록을 찾지|전송 기록이 달라|답변은)/;throw new Error(allowed.test(data?.message||'')?data.message:'문의 연결을 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.');}return data;
  }catch(e){if(e.name==='AbortError')throw new Error('연결이 늦어지고 있습니다. 같은 내용으로 다시 보내면 중복 없이 확인합니다.');if(e instanceof TypeError)throw new Error('인터넷 연결을 확인해 주세요.');throw e;}finally{clearTimeout(timer);}
 }
 return {
  guestRead:(guest,after=0)=>rpc('support_guest_read',{p_id:guest.id,p_token:guest.token,p_after:after}),
  guestSend:(guest,message,name)=>rpc('support_guest_send',{p_id:guest.id,p_token:guest.token,p_message_id:message.id,p_body:message.body,p_name:name||'방문자'}),
  adminStatus:()=>rpc('support_admin_status',{},true),
  adminList:(offset=0)=>rpc('support_admin_list',{p_offset:offset},true),
  adminRead:(id,after=0)=>rpc('support_admin_read',{p_id:id,p_after:after},true),
  adminSend:(id,message)=>rpc('support_admin_send',{p_id:id,p_message_id:message.id,p_body:message.body},true)
 };
}
