// Combine validated reading notes into one balanced summary. Final citations
// are checked again against the original manuscript, not against AI notes.
import {clean,validateAnswer} from './admin/ai-core.mjs?v=11';
export function synthesisEvidence(overview){
 const originalBlocks=overview.flatMap(section=>section.points.map(point=>({text:section.title+' / '+point.label+'\n검증된 부분 정리: '+point.text+'\n원문 인용:\n'+point.sources.map(s=>s.quote).join('\n'),refs:point.sources.map(s=>s.doc)})));
 const blocks=originalBlocks.flatMap(b=>Array.from({length:Math.ceil(b.text.length/1800)},(_,i)=>({...b,text:b.text.slice(i*1800,(i+1)*1800)})));
 const groups=[];let current={text:'',refs:[]};
 for(const block of blocks){
  if(current.text&&current.text.length+2+block.text.length>1800){groups.push(current);current={text:'',refs:[]};}
  current.text+=(current.text?'\n\n':'')+block.text;current.refs.push(...block.refs);
 }
 if(current.text)groups.push(current);
 return groups.map((g,i)=>{const original=g.refs[0];return {...original,id:original.scope+':'+original.no+':'+(2000000+i),title:original.title+' · 전체 요약용 검토 메모',text:g.text,refs:g.refs};});
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
