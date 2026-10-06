import {test} from 'node:test';
import assert from 'node:assert/strict';
import {membershipStatus,createMemberStore} from '../ai-members.mjs';

test('가입 대기·승인은 서버 상태만 인정하고 불일치·오류 응답은 입장시키지 않는다',async()=>{
 for(const status of ['pending','approved','rejected','revoked']){
  const data={status,approved:status==='approved',isAdmin:false};
  assert.deepEqual(await membershipStatus({rpc:async()=>({data})}),data);
 }
 for(const data of [null,{status:'pending',approved:true,isAdmin:false},{status:'approved',approved:'true',isAdmin:false}])
  await assert.rejects(membershipStatus({rpc:async()=>({data})}),/승인 상태/);
 await assert.rejects(membershipStatus({rpc:async()=>({error:{message:'private upstream details'}})}),/승인 상태/);
});
test('관리자 검토는 지정 회원·상태·이전 revision만 전달하고 충돌 시 재승인하지 않는다',async()=>{
 const calls=[],client={rpc:async(name,args)=>{calls.push({name,args});return {error:{code:'40001',message:'private'}};}},store=createMemberStore(client);
 await assert.rejects(store.review({user_id:'member-id',revision:4,email:'untrusted@example.test',is_admin:true},'approved'),/다른 관리자/);
 assert.deepEqual(calls,[{name:'ai_chat_review_member',args:{p_user_id:'member-id',p_status:'approved',p_revision:4}}]);
});
test('권한 없는 회원 목록과 확인되지 않은 변경 결과는 성공으로 표시하지 않는다',async()=>{
 await assert.rejects(createMemberStore({rpc:async()=>({error:{code:'42501'}})}).list(),/관리자 계정/);
 await assert.rejects(createMemberStore({rpc:async()=>({data:{status:'pending'}})}).review({user_id:'id',revision:0},'approved'),/변경 결과/);
});
