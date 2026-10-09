import {lessons,allLevels} from './curriculum.mjs';
import {initialState,advance,execute,simulate,solved,commandFeatures} from './engine.mjs';
const $=id=>document.getElementById(id);
const storageKey='codingPlayground_v1';
let saved={done:[],work:{},last:0};
try{const data=JSON.parse(localStorage.getItem(storageKey));if(data&&Array.isArray(data.done)&&data.work&&typeof data.work==='object')saved={...saved,...data};}catch{}
saved.done=[...new Set(saved.done.filter(x=>allLevels.some(l=>l.id===x)))];
let level,levelNumber=0,state,workspace,workspaceNarrow=false,iterator=null,program=[],running=false,armed=false,token=0,loading=false;
function persist(){try{localStorage.setItem(storageKey,JSON.stringify(saved));}catch{$('status').textContent='이 브라우저에서는 진도를 저장할 수 없어요. 현재 미션은 계속할 수 있어요.';}}
function saveWork(){if(!workspace||!level||loading)return;saved.work[level.id]=Blockly.serialization.workspaces.save(workspace);saved.last=levelNumber;persist();}
function status(text,type=''){$('status').textContent=text;$('status').className=type;}
function course(){stop();saveWork();$('activity').hidden=true;$('course').hidden=false;renderCourse();history.replaceState(null,'',location.pathname);window.scrollTo(0,0);}
function renderCourse(){
  $('progressLabel').textContent=`100단계 중 ${saved.done.length}단계 완료`;$('totalProgress').value=saved.done.length;
  const host=$('lessons');host.replaceChildren();let section,lastGroup;
  lessons.forEach((meta,l)=>{
    if(lastGroup!==meta.group){section=document.createElement('section');section.className='unit';const h=document.createElement('h2');h.textContent='▾ '+meta.group;section.append(h);host.append(section);lastGroup=meta.group;}
    const row=document.createElement('div');row.className='lesson-row';const info=document.createElement('div');info.className='lesson-info';
    const name=document.createElement('strong');name.textContent=`${l+1}. ${meta.title}`;const desc=document.createElement('small');desc.textContent=meta.desc;info.append(name,desc);
    const bubbles=document.createElement('div');bubbles.className='bubbles';bubbles.setAttribute('aria-label',meta.title+' 단계');
    for(let i=0;i<10;i++)bubbles.append(levelButton(l*10+i));row.append(info,bubbles);section.append(row);
  });
  $('continueBtn').textContent=saved.done.length?'이어서 학습하기 →':'학습 시작하기 →';
}
function levelButton(n){const l=allLevels[n],b=document.createElement('button');b.textContent=l.index+1;b.className='bubble'+(saved.done.includes(l.id)?' done':'')+(saved.last===n?' current':'');b.title=`${l.title}${saved.done.includes(l.id)?' · 완료':''}`;b.setAttribute('aria-label',`${l.index+1}단계 ${l.title}${saved.done.includes(l.id)?', 완료':''}`);b.onclick=()=>navigate(n);return b;}
function navigate(n){location.hash=`lesson=${n+1}`;if(levelNumber===n&&!$('activity').hidden)loadLevel(n);}
function setupBlocks(){
  const action=(type,message,colour,args=[])=>({type,message0:message,args0:args,previousStatement:null,nextStatement:null,colour});
  Blockly.defineBlocksWithJsonArray([
    {type:'cp_start',message0:'▶ 실행했을 때',nextStatement:null,colour:45},
    action('cp_move','앞으로 한 칸 이동',190),action('cp_left','왼쪽으로 90° 회전 ↶',190),action('cp_right','오른쪽으로 90° 회전 ↷',190),
    action('cp_draw','앞으로 %1 만큼 그리기',190,[{type:'field_number',name:'VALUE',value:100,min:1,max:200,precision:1}]),
    action('cp_turn','%1 ° 회전 (＋오른쪽 / −왼쪽)',190,[{type:'field_number',name:'VALUE',value:-90,min:-360,max:360}]),
    {type:'cp_repeat',message0:'%1 번 반복',args0:[{type:'field_number',name:'VALUE',value:3,min:1,max:50,precision:1}],message1:'%1',args1:[{type:'input_statement',name:'BODY'}],previousStatement:null,nextStatement:null,colour:120},
    {type:'cp_if',message0:'만약 앞에 길이 있다면',message1:'%1',args1:[{type:'input_statement',name:'BODY'}],message2:'아니면 %1',args2:[{type:'input_statement',name:'ELSE'}],previousStatement:null,nextStatement:null,colour:260},
    {type:'cp_until',message0:'★ 도착할 때까지 반복',message1:'%1',args1:[{type:'input_statement',name:'BODY'}],previousStatement:null,nextStatement:null,colour:120},
    {type:'cp_event',message0:'%1 화살표를 눌렀을 때',args0:[{type:'field_dropdown',name:'VALUE',options:[['→ 오른쪽','0'],['↓ 아래쪽','1'],['← 왼쪽','2'],['↑ 위쪽','3']]}],nextStatement:null,colour:45},
    action('cp_step','%1 한 칸 이동',190,[{type:'field_dropdown',name:'VALUE',options:[['→ 오른쪽','0'],['↓ 아래쪽','1'],['← 왼쪽','2'],['↑ 위쪽','3']]}]),
  ]);
}
function toolbox(){
  let types=level.mode==='art'?['draw','turn']:level.mode==='sprite'?['event','step']:['move','left','right'];
  if(['repeat','polygon','condition','until','nested','final'].includes(level.topic))types.push('repeat');
  if(['condition','until','final'].includes(level.topic))types.push('if');
  if(['until','final'].includes(level.topic))types.push('until');
  return {kind:'flyoutToolbox',contents:types.map(t=>({kind:'block',type:'cp_'+t}))};
}
function toBlockChain(items){
  if(!items.length)return undefined;
  const [a,...rest]=items;const block={type:'cp_'+a.type};
  if(a.value!==undefined)block.fields={VALUE:a.value};
  if(a.body?.length)block.inputs={BODY:{block:toBlockChain(a.body)}};
  if(a.otherwise?.length)block.inputs={...block.inputs,ELSE:{block:toBlockChain(a.otherwise)}};
  if(rest.length)block.next={block:toBlockChain(rest)};
  return block;
}
function starter(){
  if(level.mode==='sprite')return {blocks:{languageVersion:0,blocks:[{type:'cp_event',x:30,y:35,fields:{VALUE:'0'},next:{block:{type:'cp_step',fields:{VALUE:'0'}}}}]}};
  let chain;
  if(level.topic==='debug'){
    const wrong=structuredClone(level.reference);const turn=wrong.find(a=>a.type==='left'||a.type==='right');
    if(turn)turn.type=turn.type==='left'?'right':'left';else wrong.pop();chain=toBlockChain(wrong);
  }
  return {blocks:{languageVersion:0,blocks:[{type:'cp_start',x:35,y:35,...(chain?{next:{block:chain}}:{})}]}};
}
function loadLevel(n){
  stop();saveWork();if($('successDialog').open)$('successDialog').close();
  levelNumber=Math.max(0,Math.min(99,n));level=allLevels[levelNumber];saved.last=levelNumber;
  $('course').hidden=true;$('activity').hidden=false;$('hint').hidden=true;
  $('lessonLabel').textContent=`${level.lesson+1}번째 수업 · ${level.index+1}/10단계`;$('levelTitle').textContent=level.title;
  $('goalText').textContent=level.goalText;$('instructionText').textContent=level.intro;
  $('stageLabel').textContent=level.mode==='art'?'점선을 따라 그려요':level.mode==='sprite'?'별을 모아요':'별까지 탐험해요';
  $('eventControls').hidden=level.mode!=='sprite';$('stepBtn').disabled=level.mode==='sprite';
  $('prevBtn').disabled=levelNumber===0;$('nextBtn').disabled=levelNumber===99;
  $('levelNav').replaceChildren(...Array.from({length:10},(_,i)=>levelButton(level.lesson*10+i)));
  loading=true;
  if(!workspace){
    workspaceNarrow=window.innerWidth<=850;
    workspace=Blockly.inject('blockly',{toolbox:toolbox(),horizontalLayout:workspaceNarrow,toolboxPosition:'start',media:'vendor/media/',trashcan:true,scrollbars:true,grid:{spacing:22,length:2,colour:'#d7dee4',snap:true},zoom:{controls:true,wheel:false,startScale:workspaceNarrow?.75:.9,maxScale:1.3,minScale:.5},move:{drag:true,wheel:true},sounds:false});
    workspace.addChangeListener(e=>{if(loading||e.isUiEvent)return;stop();saveWork();updateWorkspaceInfo();});
  }else{workspace.clear();workspace.updateToolbox(toolbox());}
  try{Blockly.serialization.workspaces.load(saved.work[level.id]||starter(),workspace);}catch{workspace.clear();Blockly.serialization.workspaces.load(starter(),workspace);}
  for(const b of workspace.getAllBlocks(false))if(b.type==='cp_start'){b.setDeletable(false);b.setMovable(true);}
  loading=false;Blockly.svgResize(workspace);state=initialState(level);draw();requestAnimationFrame(draw);updateWorkspaceInfo();
  status(level.topic==='debug'?'이미 놓인 블록에 오류가 있어요. 실행해 보고 고쳐 주세요.':'블록 목록에서 블록을 끌어와 연결하세요.');
  persist();window.scrollTo(0,0);
}
function readChain(block){
  const items=[];
  for(let b=block;b;b=b.getNextBlock()){
    if(b.isEnabled&& !b.isEnabled())continue;
    const type=b.type.replace('cp_','');const a={type,id:b.id};
    const value=b.getFieldValue('VALUE');if(value!==null)a.value=Number(value);
    if(type==='repeat'||type==='until'||type==='if')a.body=readChain(b.getInputTargetBlock('BODY'));
    if(type==='if')a.otherwise=readChain(b.getInputTargetBlock('ELSE'));
    items.push(a);
  }return items;
}
function getProgram(){
  const tops=workspace.getTopBlocks(true);
  if(level.mode==='sprite')return tops.filter(b=>b.type==='cp_event').map(b=>({type:'event',value:Number(b.getFieldValue('VALUE')),body:readChain(b.getNextBlock()),id:b.id}));
  const start=tops.find(b=>b.type==='cp_start');return start?readChain(start.getNextBlock()):[];
}
function describe(items,indent=''){
  const lines=[];for(const a of items){
    const names={move:'앞으로 한 칸 이동',left:'왼쪽으로 회전',right:'오른쪽으로 회전',draw:`앞으로 ${a.value}만큼 그리기`,turn:`${a.value}° 회전`,step:['오른쪽','아래쪽','왼쪽','위쪽'][a.value]+' 이동',repeat:`${a.value}번 반복`,until:'도착할 때까지 반복',if:'만약 앞에 길이 있다면',event:['오른쪽','아래쪽','왼쪽','위쪽'][a.value]+' 화살표를 눌렀을 때'};
    lines.push(indent+names[a.type]);if(a.body)lines.push(describe(a.body,indent+'  '));if(a.otherwise?.length)lines.push(indent+'아니면',describe(a.otherwise,indent+'  '));
  }return lines.join('\n');
}
function updateWorkspaceInfo(){const count=workspace.getAllBlocks(false).filter(b=>b.type!=='cp_start'&&b.type!=='cp_event').length;$('blockCount').textContent=`블록 ${count}/${level.maxBlocks}개`;$('codeText').textContent=describe(getProgram())||'실행 블록 아래에 블록을 연결해 보세요.';}
function validate(){
  program=getProgram();const count=workspace.getAllBlocks(false).filter(b=>b.type!=='cp_start'&&b.type!=='cp_event').length;
  if(!program.length)throw new Error('실행 블록 아래에 블록을 연결해 주세요.');
  if(count>level.maxBlocks)throw new Error(`이번 미션은 블록 ${level.maxBlocks}개까지 사용할 수 있어요. 반복으로 줄여 보세요.`);
  const connectedIds=new Set();function ids(items){for(const a of items){connectedIds.add(a.id);if(a.body)ids(a.body);if(a.otherwise)ids(a.otherwise);}}ids(program);
  if(workspace.getAllBlocks(false).some(b=>b.type!=='cp_start'&&!connectedIds.has(b.id)))throw new Error('연결되지 않은 블록이 있어요. 실행·이벤트 블록에 연결하거나 휴지통에 넣어 주세요.');
  const f=commandFeatures(program),missing=level.required.filter(x=>!f.has(x));
  if(missing.length)throw new Error('이번에 배우는 '+missing.map(x=>({repeat:'반복',if:'조건',until:'도착할 때까지 반복',nested:'반복 안의 반복',event:'이벤트'}[x])).join(', ')+' 블록을 사용해 주세요.');
  saveWork();
}
function stop(){token++;running=false;armed=false;iterator=null;$('runBtn').disabled=false;$('stopBtn').disabled=true;if(workspace)workspace.highlightBlock(null);}
function reset(){stop();state=initialState(level);draw();status('처음 위치로 돌아왔어요. 블록을 고쳐 다시 실행해 보세요.');}
function finish(){
  iterator=null;running=false;$('runBtn').disabled=false;$('stopBtn').disabled=!armed;workspace.highlightBlock(null);
  if(solved(level,state,program)){
    armed=false;$('stopBtn').disabled=true;if(!saved.done.includes(level.id))saved.done.push(level.id);persist();
    $('levelNav').replaceChildren(...Array.from({length:10},(_,i)=>levelButton(level.lesson*10+i)));
    status('성공! 목표를 완성했어요.','success');$('successText').textContent=`${lessons[level.lesson].title} ${level.index+1}단계를 완료했어요. (전체 ${saved.done.length}/100)`;
    $('successNext').textContent=levelNumber===99?'수업 목록으로':'다음 단계 →';if(!$('successDialog').open)$('successDialog').showModal();
  }else status(level.mode==='art'?'아직 점선과 그림이 달라요. 거리·각도·반복 횟수를 확인해 보세요.':'아직 별에 도착하지 못했어요. 이동 횟수와 방향을 확인해 보세요.','error');
}
function fail(e){stop();status(e.message,'error');}
function prepare(){validate();state=initialState(level);draw();iterator=execute(program,level,()=>state);}
function tick(){
  const next=iterator.next();if(next.done){finish();return false;}
  workspace.highlightBlock(next.value.id||null);state=advance(level,state,next.value);draw();status(`실행 중 · ${state.steps}번째 명령`);return true;
}
async function run(){
  if(running)return;
  try{
    if(level.mode==='sprite'){stop();validate();state=initialState(level);draw();armed=true;$('stopBtn').disabled=false;status('이벤트가 준비됐어요! 화살표 버튼을 누르거나 실행 화면을 선택하고 화살표 키를 눌러 보세요.');$('stage').focus();return;}
    if(!iterator)prepare();running=true;$('runBtn').disabled=true;$('stopBtn').disabled=false;const current=++token;
    while(current===token&&running&&tick())await new Promise(r=>setTimeout(r,Number($('speed').value)));
  }catch(e){fail(e);}
}
async function eventMove(direction){
  if(!armed||running)return;
  const handlers=program.filter(a=>a.type==='event'&&a.value===direction);
  if(!handlers.length){status('이 방향의 이벤트 블록을 만들어 주세요.','error');return;}
  try{
    running=true;const current=++token;
    for(const handler of handlers){for(const a of execute(handler.body,level,()=>state)){if(current!==token)return;workspace.highlightBlock(a.id);state=advance(level,state,a);draw();await new Promise(r=>setTimeout(r,Number($('speed').value)));if(current!==token)return;}}
    running=false;workspace.highlightBlock(null);if(solved(level,state,program))finish();else status(`별 ${state.collected.length}/${level.stars.length}개를 모았어요. 화살표로 계속 움직여 보세요.`);
  }catch(e){fail(e);}
}
const canvas=$('stage'),ctx=canvas.getContext('2d');
function star(x,y,r=13){ctx.beginPath();for(let i=0;i<10;i++){const a=-Math.PI/2+i*Math.PI/5,rr=i%2?r*.45:r;ctx.lineTo(x+Math.cos(a)*rr,y+Math.sin(a)*rr);}ctx.closePath();ctx.fillStyle='#f5bc35';ctx.fill();ctx.strokeStyle='#c18a13';ctx.lineWidth=2;ctx.stroke();}
function robot(x,y,angle,r=16){ctx.save();ctx.translate(x,y);ctx.rotate(angle);ctx.fillStyle='#087f8c';ctx.strokeStyle='white';ctx.lineWidth=3;ctx.beginPath();ctx.roundRect(-r,-r,r*2,r*2,7);ctx.fill();ctx.stroke();ctx.fillStyle='white';ctx.beginPath();ctx.arc(2,-6,3,0,Math.PI*2);ctx.arc(2,6,3,0,Math.PI*2);ctx.fill();ctx.fillStyle='#74d4c9';ctx.beginPath();ctx.moveTo(r+7,0);ctx.lineTo(r-2,-6);ctx.lineTo(r-2,6);ctx.closePath();ctx.fill();ctx.restore();}
function draw(){
  ctx.clearRect(0,0,420,420);
  if(level.mode==='art'){
    ctx.fillStyle='#fffdf6';ctx.fillRect(0,0,420,420);ctx.fillStyle='#e7e4d8';for(let x=10;x<420;x+=20)for(let y=10;y<420;y+=20)ctx.fillRect(x,y,1.5,1.5);
    const target=simulate(level,level.reference).segments;
    ctx.lineWidth=4;ctx.strokeStyle='#b9c3d0';ctx.setLineDash([6,5]);for(const [x,y,u,v]of target){ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(u,v);ctx.stroke();}ctx.setLineDash([]);
    if(level.topic!=='nested'){
      ctx.fillStyle='#677781';ctx.font='12px sans-serif';for(const [x,y,u,v]of target){const distance=Math.round(Math.hypot(u-x,v-y));ctx.fillText(String(distance),(x+u)/2+5,(y+v)/2-8);}
    }
    ctx.strokeStyle='#087f8c';ctx.lineWidth=4;ctx.lineCap='round';for(const [x,y,u,v]of state.segments){ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(u,v);ctx.stroke();}
    robot(state.x,state.y,state.dir*Math.PI/180,11);
    ctx.fillStyle='#506571';ctx.font='12px sans-serif';
    const f=level.reference.flatMap(a=>a.body||[a]);const turn=f.find(a=>a.type==='turn');
    const nested=f.find(a=>a.type==='repeat');
    let info=level.topic==='draw'?'角도: '+level.reference.filter(a=>a.type==='turn').map(a=>a.value+'°').join(', '):turn?'회전 '+Number(turn.value.toFixed(2))+'°':'';
    if(nested)info=`작은 도형: ${nested.value}변 · 길이 ${nested.body[0].value} · 바깥 회전 ${Number(turn.value.toFixed(2))}°`;
    ctx.fillText(info.replace('角도','각도'),12,24);return;
  }
  const size=level.grid.length,cell=420/size;
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    ctx.fillStyle=level.grid[y][x]?'#f9f3df':(x+y)%2?'#c5dfce':'#b8d5c3';ctx.fillRect(x*cell,y*cell,cell,cell);
    ctx.strokeStyle=level.grid[y][x]?'#e9e2cc':'#a7c8b3';ctx.lineWidth=1;ctx.strokeRect(x*cell,y*cell,cell,cell);
    if(!level.grid[y][x]){ctx.fillStyle='#94b9a0';ctx.beginPath();ctx.arc(x*cell+cell/2,y*cell+cell/2,6,0,Math.PI*2);ctx.fill();}
  }
  if(level.goal)star((level.goal[0]+.5)*cell,(level.goal[1]+.5)*cell);
  level.stars?.forEach(([x,y],i)=>{if(!state.collected.includes(i))star((x+.5)*cell,(y+.5)*cell);});
  robot((state.x+.5)*cell,(state.y+.5)*cell,state.dir*Math.PI/2);
}
$('courseBtn').onclick=course;$('backBtn').onclick=course;
$('continueBtn').onclick=()=>navigate(Math.max(0,Math.min(99,Number(saved.last)||0)));
$('hintBtn').onclick=()=>{$('hint').textContent=level.hint;$('hint').hidden=!$('hint').hidden;};
$('runBtn').onclick=run;$('resetBtn').onclick=reset;$('stopBtn').onclick=()=>{stop();status('멈췄어요. 실행하면 처음부터 다시 시작해요.');};
$('stepBtn').onclick=()=>{if(running)return;try{if(!iterator)prepare();if(tick())$('stopBtn').disabled=false;}catch(e){fail(e);}};
$('clearBtn').onclick=()=>{stop();loading=true;workspace.clear();Blockly.serialization.workspaces.load(starter(),workspace);for(const b of workspace.getAllBlocks(false))if(b.type==='cp_start')b.setDeletable(false);loading=false;saveWork();updateWorkspaceInfo();reset();};
$('prevBtn').onclick=()=>navigate(levelNumber-1);$('nextBtn').onclick=()=>navigate(levelNumber+1);
$('successClose').onclick=()=>$('successDialog').close();$('successNext').onclick=()=>{$('successDialog').close();if(levelNumber===99)course();else navigate(levelNumber+1);};
document.querySelectorAll('[data-dir]').forEach(b=>b.onclick=()=>eventMove(Number(b.dataset.dir)));
canvas.addEventListener('keydown',e=>{const d={ArrowRight:0,ArrowDown:1,ArrowLeft:2,ArrowUp:3}[e.key];if(d!==undefined&&level?.mode==='sprite'){e.preventDefault();eventMove(d);}});
window.addEventListener('resize',()=>{
  if(!workspace)return;
  if(workspaceNarrow!==(window.innerWidth<=850)){
    saveWork();workspace.dispose();workspace=null;
    if(!$('activity').hidden)loadLevel(levelNumber);
  }else Blockly.svgResize(workspace);
  if(state)requestAnimationFrame(draw);
});
window.addEventListener('pagehide',saveWork);
function route(){const match=/^#lesson=(\d+)$/.exec(location.hash);if(match)loadLevel(Number(match[1])-1);else course();}
window.addEventListener('hashchange',route);
if(typeof Blockly==='undefined'){$('continueBtn').disabled=true;$('continueBtn').textContent='블록 편집기를 불러오지 못했어요. 새로고침해 주세요.';renderCourse();}
else{setupBlocks();renderCourse();route();}
