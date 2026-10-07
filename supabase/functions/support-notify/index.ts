import webpush from 'npm:web-push@3.6.7';
import {createNotificationHandler} from './handler.mjs';
const url=Deno.env.get('SUPABASE_URL')!,key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
async function rpc(name:string,args:unknown){
 const r=await fetch(url+'/rest/v1/rpc/'+name,{method:'POST',headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify(args),signal:AbortSignal.timeout(15000)});
 if(!r.ok){const error=new Error('Notification service unavailable');Object.assign(error,{status:r.status});throw error;}
 return await r.json();
}
// Gateway JWT verification is disabled for this Vault-authenticated database webhook.
// Both server RPCs require service_role. A single-use database wake authorizes claims;
// only the server receives Vault signing credentials and the completion token.
Deno.serve(createNotificationHandler({rpc,buildRequest:webpush.generateRequestDetails.bind(webpush)}));
