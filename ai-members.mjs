export const MEMBER_LABELS={pending:'승인 대기',approved:'승인됨',rejected:'가입 거절',revoked:'승인 취소'};
export async function membershipStatus(client) {
 const {data,error}=await client.rpc('ai_chat_membership');
 if(error||!data||!Object.hasOwn(MEMBER_LABELS,data.status)||typeof data.approved!=='boolean'||typeof data.isAdmin!=='boolean'||data.approved!==(data.status==='approved'))throw new Error('회원 승인 상태를 확인하지 못했습니다. 다시 로그인하거나 잠시 후 확인해 주세요.');
 return data;
}
export function createMemberStore(client) {
 return {
  async list(status='pending',offset=0) {
   const {data,error}=await client.rpc('ai_chat_list_members',{p_status:status,p_offset:offset});
   if(error||!Array.isArray(data))throw new Error('회원 목록을 확인하지 못했습니다. 관리자 계정으로 다시 로그인해 주세요.');
   return data;
  },
  async review(member,status) {
   const {data,error}=await client.rpc('ai_chat_review_member',{p_user_id:member.user_id,p_status:status,p_revision:member.revision});
   if(error)throw new Error(error.code==='40001'?'다른 관리자가 변경했습니다. 새로고침 후 다시 확인해 주세요.':'회원 상태를 변경하지 못했습니다. 관리자 권한과 현재 상태를 확인해 주세요.');
   if(data?.status!==status)throw new Error('변경 결과를 확인하지 못했습니다. 목록을 새로고침해 주세요.');
   return data;
  }
 };
}
