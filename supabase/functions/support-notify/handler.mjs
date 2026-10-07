const ENDPOINT=/^https:\/\/(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|[a-z0-9.-]+\.notify\.windows\.com|web\.push\.apple\.com)\//;
export function notificationPayload(test=false,deliveryId=''){return {title:test?'문의 알림 시험':'새 문의가 도착했습니다',body:test?'이 알림이 보이면 문의 알림을 받을 수 있습니다.':'관리자 문의함에서 확인하고 답변해 주세요.',url:'/sayeon/contact.html',tag:(test?'support-test':'support-inquiry')+(deliveryId?'-'+deliveryId:'')};}
export function createNotificationHandler({rpc,buildRequest,fetcher=fetch}){
 return async req=>{
  if(req.method!=='POST')return new Response(null,{status:405});
  const token=req.headers.get('x-support-token');
  if(!token||!/^[0-9a-f]{64}$/.test(token))return new Response(null,{status:401});
  let batch;
  try{batch=await rpc('support_push_claim',{p_token:token});}catch(e){return new Response(null,{status:e.status===403?403:503});}
  if(!batch?.jobs?.length)return Response.json({processed:0});
  if(!batch.vapid?.publicKey||!batch.vapid?.privateKey)return new Response(null,{status:503});
  const outcomes=await Promise.all(batch.jobs.map(async job=>{
   let status=503;
   try{
    if(!ENDPOINT.test(job.endpoint))status=400;
    else{
     const details=buildRequest({endpoint:job.endpoint,keys:{p256dh:job.p256dh,auth:job.auth}},JSON.stringify(notificationPayload(job.test,job.id)),{
      vapidDetails:{subject:'https://patrickdfg.github.io',publicKey:batch.vapid.publicKey,privateKey:batch.vapid.privateKey},TTL:86400,urgency:'high'});
     const response=await fetcher(details.endpoint,{method:details.method,headers:details.headers,body:details.body,redirect:'error',signal:AbortSignal.timeout(10000)});
     status=response.status;await response.body?.cancel();
    }
   }catch{}
   try{await rpc('support_push_finish',{p_token:batch.finishToken,p_id:job.id,p_lease:job.lease,p_status:status});return status>=200&&status<300;}catch{return false;}
  }));
  return Response.json({processed:outcomes.length,sent:outcomes.filter(Boolean).length});
 };
}
