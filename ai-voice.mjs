// Voice input is started only by the user's microphone click; it never sends a question.
export function createVoiceInput({button,input,notify,canStart,Recognition=globalThis.SpeechRecognition||globalThis.webkitSpeechRecognition}){
 let recognition=null,base='',active=false,generation=0;
 const paint=()=>{button.classList.toggle('listening',active);button.setAttribute('aria-pressed',String(active));button.setAttribute('aria-label',active?'음성 입력 중단':'음성으로 질문 입력');button.title=active?'음성 입력 중단':'음성으로 질문 입력';};
 const stop=()=>{generation++;active=false;const old=recognition;recognition=null;paint();try{old?.abort();}catch{}};
 const start=()=>{
  if(active){stop();return;}
  if(!canStart())return;
  if(!Recognition){notify('이 브라우저는 음성 입력을 지원하지 않습니다. Chrome 또는 Edge에서 이용해 주세요.');return;}
  const epoch=++generation;const current=new Recognition();recognition=current;
  current.lang='ko-KR';current.interimResults=true;current.continuous=false;
  base=input.value.trimEnd();active=true;paint();
  current.onresult=event=>{
   if(epoch!==generation||!canStart())return;
   let speech='';for(let i=0;i<event.results.length;i++)speech+=event.results[i][0].transcript;
   const merged=(base?base+' ':'')+speech;
   input.value=merged.slice(0,input.maxLength>0?input.maxLength:600);
   input.dispatchEvent(new Event('input',{bubbles:true}));
  };
  current.onerror=event=>{if(epoch!==generation)return;notify(event.error==='not-allowed'?'브라우저에서 마이크 사용을 허용해 주세요.':event.error==='no-speech'?'음성이 감지되지 않았습니다. 마이크를 다시 눌러 주세요.':'음성 입력을 완료하지 못했습니다. 다시 시도해 주세요.');};
  current.onend=()=>{if(epoch!==generation)return;active=false;recognition=null;paint();input.focus();};
  try{current.start();notify('듣고 있습니다. 질문을 말한 뒤 내용을 확인하고 보내 주세요.');}
  catch{stop();notify('마이크를 시작하지 못했습니다. 브라우저의 마이크 권한을 확인해 주세요.');}
 };
 button.addEventListener('click',start);paint();
 return {stop};
}
