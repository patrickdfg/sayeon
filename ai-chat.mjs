import {validateAnswer,MODELS,SOURCES,normalizeScope,resolveQuestion,requestsWholeManuscript} from './admin/ai-core.mjs?v=21';

export function newThread(uuid=()=>crypto.randomUUID()) {
 return {id:uuid(),title:'새 대화',model_id:'gemini-lite',scope:'all',messages:[],revision:null};
}
export function packResult(result) {
 const strip=statement=>({...statement,sources:statement.sources.map(({id,quote})=>({id,quote}))});
 return {model:result.model,usedBackup:!!result.usedBackup,attempts:result.attempts===2?2:1,
  ...(result.wholeTitle?{wholeTitle:result.wholeTitle,wholeIntent:result.wholeIntent}:{}),
  answer:{supported:result.answer.supported,overview:result.answer.overview.map(s=>({title:s.title,points:s.points.map(strip)})),claims:result.answer.claims.map(strip)}};
}
export function unpackResult(message) {
 const saved=message.result;if(!saved)return null;
 return {...saved,answer:validateAnswer(JSON.stringify(saved.answer),message.evidence||[])};
}
export function makeMessage(role,content,extra={},uuid=()=>crypto.randomUUID()) {
 return {id:uuid(),role,content,createdAt:new Date().toISOString(),...extra};
}
export function pendingConversation(thread,savedIds,uuid=()=>crypto.randomUUID()) {
 let start=thread.messages.findIndex(message=>!savedIds.has(message.id));
 if(start<0)start=Math.max(0,thread.messages.length-1);
 while(start>0&&thread.messages[start].role!=='user')start--;
 return {...newThread(uuid),title:thread.title,model_id:thread.model_id,scope:thread.scope,messages:structuredClone(thread.messages.slice(start))};
}
export function followUpEvidence(question,messages) {
 // Reuse the preceding verified source for explicit references to that answer.
 // Assistant prose never becomes evidence and unrelated questions search afresh.
 if(/\d{1,4}\s*(?:년|월|일)|(?:성령사연|월명동사연)\s*\d/.test(question))return null;
 if(!/^(?:[이그]\s*(?:걸|것|거|내용|말씀|부분|답변|원고)|방금|앞서|더\s|좀\s*더|계속|다시\s|자세히|짧게|요약해|정리해|(?:첫|두|세|네|다섯|마지막|\d+)\s*(?:째|번째|항목|주제))/.test(question.trim()))return null;
 const previous=[...messages].reverse().find(m=>m.role==='assistant'&&m.evidence?.length);
 if(!previous)return null;
 const intent=/정리|자세히|상세/.test(question)?'organize':/요약|짧게/.test(question)?'summary':null;
 return {found:previous.evidence,mode:previous.evidence.length===1&&previous.evidence[0].whole?'whole':'paragraph',title:previous.title||previous.evidence[0].title,intent,followUp:true,outline:previous.result?.answer?.overview?.map(section=>section.title+': '+section.points.map(p=>p.label).join(', '))||[]};
}
export function followUpQuestion(question,outline=[]) {
 // Keep the user's whole question, add only complete preceding headings that fit.
 // Prior headings provide conversation context; source evidence is unchanged.
 let value=question;const prefix='\n직전 답변의 항목명(대화 맥락): ';
 for(const heading of outline){const next=value+(value===question?prefix:' / ')+heading;if(next.length>600)break;value=next;}
 return value;
}
export function historyError(error) {
 const code=error?.code;
 if(code==='23514'||code==='54000'||code==='413')return '이 대화의 저장 용량에 도달했습니다. 새 대화를 시작해 주세요.';
 if(code==='42501'||error?.status===401)return '로그인을 다시 확인해 주세요. 대화는 현재 화면에 남아 있습니다.';
 return '대화 기록을 저장하지 못했습니다. 현재 답변은 남아 있으니 저장을 다시 시도해 주세요.';
}
function canonical(value) {
 if(Array.isArray(value))return value.map(canonical);
 if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])]));
 return value;
}
export function createChatStore(client) {
 const fields='id,title,model_id,scope,revision,updated_at';
 const unwrap=({data,error})=>{if(error)throw Object.assign(new Error(historyError(error)),{cause:error});return data;};
 return {
  async list(offset=0,query='') {
   let request=client.from('ai_chat_threads').select(fields).order('updated_at',{ascending:false}).order('id',{ascending:true});
   if(query.trim())request=request.ilike('title','%'+query.trim().replace(/[\\%_]/g,'\\$&')+'%');
   return unwrap(await request.range(offset,offset+49));
  },
  async load(id) {return unwrap(await client.from('ai_chat_threads').select('*').eq('id',id).single());},
  async save(thread) {
   if(thread.messages.length>120||new TextEncoder().encode(JSON.stringify(thread.messages)).length>4194304)throw new Error('이 대화의 저장 용량에 도달했습니다. 새 대화를 시작해 주세요.');
   if(!Object.hasOwn(MODELS,thread.model_id)&&thread.model_id!=='search')throw new Error('대화 모델을 확인해 주세요.');
   if(!['all','sayeon',...SOURCES.map(s=>s.key)].includes(thread.scope))throw new Error('대화 자료 범위를 확인해 주세요.');
   const payload={title:thread.title.slice(0,100),model_id:thread.model_id,scope:normalizeScope(thread.scope),messages:thread.messages};
   let request=client.from('ai_chat_threads');
   request=thread.revision==null?request.insert({id:thread.id,...payload}):request.update(payload).eq('id',thread.id).eq('revision',thread.revision);
   const response=await request.select(fields).maybeSingle();
   if(response.error?.code==='23505'||(!response.error&&!response.data)) {
    const latest=await this.load(thread.id);
    // A lost network response may have committed this exact snapshot already.
    if(JSON.stringify(canonical(latest.messages))===JSON.stringify(canonical(thread.messages)))return latest;
    throw Object.assign(new Error('다른 기기에서 이 대화가 변경됐습니다. 현재 대화를 새 대화로 저장해 주세요.'),{conflict:true});
   }
   return unwrap(response);
  },
  async remove(id) {unwrap(await client.from('ai_chat_threads').delete().eq('id',id));},
  async rename(thread,title) {
   const value=title.trim().slice(0,100);if(!value)throw new Error('대화 제목을 입력해 주세요.');
   const response=await client.from('ai_chat_threads').update({title:value}).eq('id',thread.id).eq('revision',thread.revision).select(fields).maybeSingle();
   const data=unwrap(response);if(!data)throw new Error('다른 기기에서 대화가 변경됐습니다. 다시 열어 주세요.');return data;
  }
 };
}

export function resolveChatQuestion(chunks,question,messages=[],scope='all'){
 // A named date always starts a fresh document selection, never conversational snippets.
 if(/\d{1,2}\s*월\s*\d{1,2}\s*일/.test(question))return resolveQuestion(chunks,question,scope);
 const previous=followUpEvidence(question,messages);
 const fullReference=/^(?:전체|전부|통째|하나\s*로)/.test(question.trim())&&!/자료|사연/.test(question)&&/정리|요약|통합|정돈/.test(question);
 if(fullReference||requestsWholeManuscript(question)||previous?.mode==='whole'||previous&&/전체|전부|통째|하나\s*로/.test(question)){
  const index=messages.findLastIndex(m=>m.role==='assistant'&&m.evidence?.length);
  const answer=index>=0?messages[index]:null;
  const user=index>=0?messages.slice(0,index).findLast(m=>m.role==='user'):null;
  const anchors=[answer?.result?.wholeTitle,answer?.title,user?.content].filter(Boolean);
  for(const anchor of anchors){
   if(/\d{1,2}\s*월\s*\d{1,2}\s*일/.test(anchor)&&(/말\s*씀|주일|수요|새벽|설교|원고/.test(anchor)||requestsWholeManuscript(anchor))){
    const date=anchor.match(/(?:(20\d{2})\s*년\s*)?\d{1,2}\s*월\s*\d{1,2}\s*일/)[0],kind=anchor.match(/주일|수요|새벽/)?.[0]||'';
    return resolveQuestion(chunks,date+' '+kind+'말씀 '+question,scope);
   }
  }
  // Only a single, unambiguous sermon can be expanded from existing verified evidence.
  const docs=answer?.evidence||[];
  const keys=new Set(docs.map(d=>d.scope+':'+d.no));
  if(docs.length&&keys.size===1&&docs.every(d=>d.scope==='malsseum'))
   return resolveQuestion(chunks,docs[0].title+' 말씀 '+question,scope);
  throw new Error('정리할 말씀의 날짜를 알려 주세요. 문단 검색 결과나 다른 말씀을 섞어 전체 원고로 사용하지 않았습니다.');
 }
 return previous||resolveQuestion(chunks,question,scope);
}
