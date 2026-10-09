(async function(){
"use strict";
var cfg=window.SAYEON_ANALYTICS_CONFIG||{},token=sessionStorage.getItem("sayeonAdminToken")||"";
var msg=document.getElementById("guideAuthMessage");
if(!token){msg.textContent="관리자 페이지에서 Google 계정으로 로그인해 주세요.";return;}
try{
 var now=new Date(),from=new Date(now);from.setDate(from.getDate()-1);
 var r=await fetch(cfg.supabaseUrl.replace(/\/$/,"")+"/rest/v1/rpc/get_analytics_dashboard",{method:"POST",headers:{apikey:cfg.supabaseAnonKey,"Content-Type":"application/json",Authorization:"Bearer "+token},body:JSON.stringify({p_from:from.toISOString(),p_to:now.toISOString()})});
 var d=await r.json();
 if(!r.ok||!d||typeof d!=="object"||!("totalVisitors" in d))throw new Error("관리자 권한을 확인하지 못했습니다. 관리자 페이지에서 다시 로그인해 주세요.");
 var script=document.createElement("script");
 script.src="/sayeon/admin/stone-guide-viewer.js?v=1";
 script.onload=function(){document.getElementById("guideAuth").hidden=true;document.getElementById("app").hidden=false;};
 script.onerror=function(){msg.textContent="가이드 화면을 불러오지 못했습니다. 새로고침해 주세요.";};
 document.body.appendChild(script);
}catch(e){msg.textContent=e.message;}
})();
