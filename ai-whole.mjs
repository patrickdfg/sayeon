// Combine validated reading notes into one balanced summary. Final citations
// are checked again against the original manuscript, not against AI notes.
import {clean,validateAnswer,evidenceBatches} from './admin/ai-core.mjs?v=12';
export function synthesisEvidence(overview){
 const notes=[];
 for(const section of overview)for(const point of section.points){
  const refs=point.sources.map(s=>s.doc);
  // Every prose fragment carries literal primary-source choices. Never split a quote.
  const quotes=[...new Set(point.sources.map(s=>clean(s.quote).slice(0,96)))];
  const prose=section.title+' / '+point.label+'\n검증된 부분 정리: '+point.text;
  for(let i=0;i<prose.length;i+=1100){
   const original=refs[0];
   notes.push({...original,id:original.scope+':'+original.no+':'+(2000000+notes.length),title:original.title+' · 전체 요약용 검토 메모',text:prose.slice(i,i+1100)+'\n원문 인용:\n'+quotes.join('\n'),refs,quotes});
  }
 }
 return notes;
}
export function synthesisQuestion(title){return clean(title).slice(0,100)+' 전체 핵심 요약정리. 입력은 원고를 읽어 검증한 부분별 정리와 실제 원문 인용입니다. 중복을 합치고 입력 전체의 앞·중간·끝의 서로 다른 핵심과 논리 흐름을 고르게 보존하세요. 소제목 수·항목 수·설명 분량은 원고 길이와 실제 핵심에 따라 자유롭게 정하세요. 특정 개수나 글자 수에 맞추려고 생략하거나 늘리지 마세요. 각 항목은 짧은 label과 자연스러운 설명으로 쓰고 주제·책임·대표 사례의 의미·실천·결론 중 원문에 있는 내용을 보존하세요. sources.quote는 원문 인용 아래의 실제 원문 일부만 사용하고 검토 메모 문장을 인용하지 마세요. 모든 검토 묶음을 반영하세요. 외부 지식/새 주장/원문에 없는 용어는 금지하며 종합은 inference로 구분하세요.';}
export function validateSynthesis(answer,notes,original){
 const byId=new Map(notes.map(n=>[n.id,n]));
 const remap=statement=>({...statement,kind:'inference',sources:statement.sources.map(s=>{
  const note=byId.get(s.id),quote=clean(s.quote);
  const doc=note?.refs.find(d=>quote.length>=8&&clean(d.text).includes(quote));
  if(!doc)throw new Error('통합 요약의 인용이 원문과 일치하지 않아 결과를 보류했습니다.');
  return {id:doc.id,quote:s.quote};
 })});
 const raw={supported:answer.supported,overview:answer.overview.map(s=>({...s,points:s.points.map(remap)})),claims:answer.claims.map(remap)};
 return validateAnswer(JSON.stringify(raw),original,{requireOverview:true});
}

// Reduce large note sets until the final call can see the entire sermon together.
// These are planned reading/integration stages, never retries after an error.
export async function synthesizeWhole({overview,original,title,generate,checkBudget,pause,onProgress=()=>{},signal}){
 let notes=synthesisEvidence(overview),calls=0;
 for(let round=0;round<8;round++){
  if(signal?.aborted)throw new DOMException('Aborted','AbortError');
  const groups=evidenceBatches(notes,6000),final=groups.length===1;
  if(!groups.length)throw new Error('통합할 전체 원고 정리가 없습니다.');
  await checkBudget(groups.length+(final?0:1));
  const merged=[];let result;
  for(let i=0;i<groups.length;i++){
   if(signal?.aborted)throw new DOMException('Aborted','AbortError');
   onProgress({round,index:i,total:groups.length,final,calls});const started=Date.now();
   const question=final?synthesisQuestion(title):clean(title).slice(0,100)+' 전체 말씀 통합을 위한 중간 검토 메모를 작성하세요. 다음 입력을 모두 읽고 서로 다른 핵심·전환·사례의 의미·실천·결론을 보존하면서 중복과 반복 설명을 충분히 압축하세요. 여러 부분을 한 편으로 이해하세요. 최종 답변은 다음 단계에서 작성합니다. 내용에 따라 주제 수는 자유롭게 정하고 부차적 설명은 생략하세요. 원문에 없는 주장은 금지합니다. 인용은 quoteChoices에서 그대로 선택하세요.';
   result=await generate(question,groups[i]);calls++;
   if(!result.answer.supported)throw new Error('전체 통합 요약을 검증하지 못했습니다.');
   const checked=validateSynthesis(result.answer,groups[i],original);
   if(final)return {...result,answer:checked,calls};
   merged.push(...checked.overview);
   await pause(started,signal);
  }
  const next=synthesisEvidence(merged);
  if(next.length>=notes.length&&next.reduce((n,d)=>n+d.text.length,0)>=notes.reduce((n,d)=>n+d.text.length,0))throw new Error('전체 내용을 한 번에 통합할 만큼 중간 정리가 압축되지 않았습니다. 결과를 보류했습니다.');
  notes=next;
 }
 throw new Error('전체 말씀 통합 단계를 완료하지 못했습니다.');
}
