// 고민 상담의 순수한 부분 — 찾을 말 만들기, 말씀 문단 고르기, 답 요청문, 위험한 말 안내.
// 고민 상담 화면(counsel.mjs)과 AI 챗봇(ai-lab.mjs)이 같이 쓴다. 화면 요소는 건드리지 않는다.
import {retrieve,clean} from './admin/ai-core.mjs?v=22';

/* ===== 고민 → 말씀에서 찾을 낱말 =====
 * 서버의 고민 분석(keywords)이 만든 낱말을 우선 쓰고, 서버가 그 기능을 모르거나 분석이 실패하면
 * 자주 있는 고민 표(THEMES)로 대신한다. 찾는 일을 돕는 것일 뿐 답은 찾아 온 말씀의 뜻으로만 쓴다. */
export const THEMES=[
 {re:/불안|걱정|두려|무서|초조|염려|떨리|긴장/,words:['염려 근심 두려움 믿음','평안 담대 믿음']},
 {re:/힘들|지치|지쳐|낙심|우울|포기|좌절|무기력|의욕|눈물|슬프/,words:['낙심 실족 포기 인내','굳건 열심 다시 일어']},
 {re:/사람|관계|미워|미움|오해|갈등|싸우|서운|상처|배신|다툼|형제|동료/,words:['오해 형제 풀고','용서 사랑 화평']},
 {re:/가정|부부|남편|아내|결혼|자녀|아이|부모|엄마|아빠|시댁|처가/,words:['가정 부부 자녀 부모','사랑 인내 가정']},
 {re:/돈|재정|빚|가난|생활|직장|회사|일자리|사업|월급|취업|장사|살림/,words:['재정 생활 직장 사업','부지런 운영 축복']},
 {re:/건강|아프|병|질병|수술|통증|몸이/,words:['병 아픔 건강 치료','기도 믿음 건강']},
 {re:/기도|새벽|게으|나태|신앙|믿음이|말씀을 안|예배|흔들/,words:['기도 새벽 부지런 약속','믿음 열심 신앙생활']},
 {re:/화가|화를|분노|짜증|혈기|욱|참기|참을/,words:['혈기 분 참고 인내','다스리 마음 관리']},
 {re:/죄책|후회|실수|잘못|죄를|용서받|부끄/,words:['회개 용서 죄','실수 후회 다시']},
 {re:/외로|혼자|고독|쓸쓸/,words:['외로 함께 성령','사랑 하나님 함께']},
 {re:/미래|진로|결정|선택|방향|갈림길|이직|이사/,words:['방향 인도 결정','순종 하나님 뜻 인도']},
 {re:/자기|관리|습관|계획|시간|정리|미루/,words:['자기 관리 운영','부지런 습관 열심']}
];
const WORRY_MAX=320,PER_SEARCH=6,EVIDENCE_MAX=6,CHARS_MAX=8000,PER_DOC=2;
// 고민 분석과 답 생성은 서버가 호출 간격 10초를 요구한다(하루 한도 규칙). 분석을 마친 뒤 이만큼 채우고 보낸다.
export const GAP_MS=()=>Number.isFinite(globalThis.__counselGapMs)?globalThis.__counselGapMs:10300;

/** 찾을 말 목록. AI 분석이 있으면 그 낱말을 3개씩 묶어 찾고, 없으면 자주 있는 고민 표(THEMES)로 대신한다. */
export function searchQueries(worry,analysis=null){
 const q=clean(worry),out=[q];
 if(analysis?.keywords?.length){
  for(let i=0;i<analysis.keywords.length&&out.length<7;i+=3)out.push(analysis.keywords.slice(i,i+3).join(' '));
  (analysis.themes||[]).slice(0,2).forEach(t=>out.push(t));
  THEMES.forEach(t=>{if(t.re.test(q)&&out.length<10)out.push(t.words[0]);});   // AI 가 놓쳤을 때를 위한 보조
  return out.slice(0,10);
 }
 THEMES.forEach(t=>{if(t.re.test(q))out.push(...t.words);});
 return out.slice(0,6);
}
/** 여러 검색을 합쳐 점수가 높은 문단을 고른다. 한 편에서 둘까지, 전체 6개·8,000글자 안에서. */
export function findEvidence(all,worry,analysis=null,scope='all',search=retrieve){
 const score=new Map();
 searchQueries(worry,analysis).forEach((query,qi)=>{
  search(all,query,scope,PER_SEARCH).forEach((c,rank)=>{
   const prev=score.get(c.id)||{c,total:0};
   // 고민 글 그대로 찾은 것을 조금 더 쳐 준다
   prev.total+=(c.score||1)*(qi===0?1.5:1)+(PER_SEARCH-rank)*0.1;
   score.set(c.id,prev);
  });
 });
 const ranked=[...score.values()].sort((a,b)=>b.total-a.total||a.c.id.localeCompare(b.c.id));
 const perDoc=new Map(),out=[];let chars=0;
 for(const {c} of ranked){
  const key=c.scope+':'+c.no;if((perDoc.get(key)||0)>=PER_DOC)continue;
  const body=c.text.slice(0,1800);if(chars+body.length>CHARS_MAX)continue;
  out.push({...c,text:body});chars+=body.length;perDoc.set(key,(perDoc.get(key)||0)+1);
  if(out.length>=EVIDENCE_MAX)break;
 }
 return out;
}
/** 서버가 만드는 답의 모양(overview 소제목)을 위로와 조언으로 정해 주는 요청문. 600글자 이내. */
export function counselQuestion(worry,analysis=null){
 const w=clean(worry).slice(0,WORRY_MAX),gist=analysis?.summary?' (핵심: '+clean(analysis.summary).slice(0,70)+')':'';
 return '[고민 상담] '+w+gist+' — 이 고민을 가진 사람에게 제공된 말씀만 근거로 먼저 위로하고 이어서 조언하세요. overview 소제목은 "위로"와 "조언" 두 개로 하고 말씀에 있는 뜻만 따뜻한 합니다체로 쓰세요. 말씀에 없는 조언·진단·약속은 하지 마세요.';
}
export const CRISIS=/자살|죽고\s*싶|죽어\s*버리|목숨을?\s*끊|스스로\s*(?:생|목숨)|살기\s*싫|살고\s*싶지|자해|극단적\s*선택/;

export const CRISIS_TEXT='혼자 견디지 마세요. 지금 많이 힘드시다면 자살예방 상담전화 109(24시간, 무료)에 바로 전화해 주세요. 위험한 상황이면 119나 112에 연락해 주세요. 곁에 있는 사람에게도 지금 마음을 알려 주세요.';
export const sleep=(ms,signal)=>new Promise((resolve,reject)=>{const t=setTimeout(resolve,ms);signal?.addEventListener('abort',()=>{clearTimeout(t);reject(new DOMException('Aborted','AbortError'));},{once:true});});
