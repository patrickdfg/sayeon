// Each lesson has ten playable challenges. Targets are derived from executable
// reference programs, so the drawing and maze goals cannot drift from the rules.
export const lessons = [
  {title:'로봇과 첫 번째 모험', group:'순서대로 실행하기', desc:'이동과 방향 전환 · 미로', mode:'maze', topic:'sequence', intro:'컴퓨터는 위에서 아래로, 연결된 블록 순서대로 움직여요.'},
  {title:'틀린 블록을 찾아라', group:'순서대로 실행하기', desc:'예측하고 고치기 · 디버깅', mode:'maze', topic:'debug', intro:'먼저 실행 결과를 예상해 보세요. 잘못된 방향이나 이동 횟수를 고치면 돼요.'},
  {title:'꼬마 화가의 작업실', group:'순서대로 실행하기', desc:'이동 거리와 회전 각도 · 그림', mode:'art', topic:'draw', intro:'화가는 앞으로 가며 선을 그려요. 오른쪽으로 회전하면 바라보는 방향이 바뀌어요.'},
  {title:'반복하면 간단해져요', group:'반복으로 표현하기', desc:'같은 명령 묶기 · 미로', mode:'maze', topic:'repeat', intro:'같은 블록을 여러 번 연결하는 대신 반복 블록 안에 넣어 보세요.'},
  {title:'반복으로 그리는 도형', group:'반복으로 표현하기', desc:'정사각형부터 별까지 · 그림', mode:'art', topic:'polygon', intro:'도형의 바깥쪽 회전 각도를 생각해 보세요. 정사각형은 90도씩 돌아요.'},
  {title:'길을 보고 결정해요', group:'조건으로 판단하기', desc:'만약과 아니면 · 미로', mode:'maze', topic:'condition', intro:'조건 블록은 지금 앞에 길이 있는지 확인해요. 결과에 따라 서로 다른 블록을 실행해요.'},
  {title:'도착할 때까지 탐험', group:'조건으로 판단하기', desc:'목표를 만날 때까지 반복 · 미로', mode:'maze', topic:'until', intro:'도착할 때까지 반복은 목표에 닿으면 멈춰요. 안쪽에는 앞으로 갈 방법을 넣어야 해요.'},
  {title:'반복 안에 또 반복', group:'반복을 더 깊이 배우기', desc:'중첩 반복 · 패턴 그림', mode:'art', topic:'nested', intro:'안쪽 반복은 작은 도형을, 바깥쪽 반복은 도형 여러 개를 만들어요.'},
  {title:'내가 움직이는 캐릭터', group:'이벤트와 나의 작품', desc:'화살표 이벤트 · 별 모으기', mode:'sprite', topic:'event', intro:'이벤트는 어떤 일이 일어났을 때 코드를 시작해요. 화살표 버튼을 누르면 해당 블록이 실행돼요.'},
  {title:'마지막 탐험 도전', group:'이벤트와 나의 작품', desc:'순서·반복·조건 종합 · 미로', mode:'maze', topic:'final', intro:'지금까지 배운 것을 함께 써 보세요. 긴 길도 짧은 프로그램으로 해결할 수 있어요.'},
];
const act = (type, value) => ({type, ...(value === undefined ? {} : {value})});
const repeat = (n, body) => ({type:'repeat',value:n,body});
const routes = [
  [[0,2]], [[0,3]], [[0,4]], [[0,3],[3,2]], [[0,2],[3,3]],
  [[0,4],[3,3]], [[0,4],[3,2],[2,2]], [[0,2],[3,4],[0,3]],
  [[0,4],[3,4],[2,3]], [[0,4],[3,2],[2,3],[3,2],[0,4]],
];
const longRoutes = [
  [[0,4]], [[0,5],[3,4]], [[0,4],[3,3],[2,3]],
  [[0,2],[3,4],[0,3]], [[0,5],[3,2],[2,4],[3,2]],
  [[0,5],[3,4],[2,4],[1,2],[0,2]],
  [[0,4],[3,2],[2,3],[3,2],[0,4]],
  [[0,5],[3,5],[2,5]], [[0,5],[3,2],[2,4],[3,3],[0,4]],
  [[0,5],[3,5],[2,5],[1,3],[0,3],[3,1]],
];
function mazeSpec(route, variant) {
  // Rotate the whole route; both the robot heading and reference program rotate.
  const rotate = ([x,y]) => {for(let i=0;i<variant%4;i++) [x,y]=[7-y,x]; return [x,y];};
  let p=[1,6], dir=variant%4, path=[rotate(p)], program=[];
  for(const [d,n] of route){
    const wanted=(d+variant)%4;
    let delta=(wanted-dir+4)%4;
    if(delta===3) program.push(act('left'));
    else for(let i=0;i<delta;i++) program.push(act('right'));
    dir=wanted;
    for(let i=0;i<n;i++){
      const [dx,dy]=[[1,0],[0,1],[-1,0],[0,-1]][d];
      p=[p[0]+dx,p[1]+dy]; path.push(rotate(p)); program.push(act('move'));
    }
  }
  const grid=Array.from({length:8},()=>Array(8).fill(0));
  for(const [x,y] of path) grid[y][x]=1;
  return {grid,start:path[0],goal:path.at(-1),dir:variant%4,reference:program};
}
function compress(program){
  const out=[];
  for(let i=0;i<program.length;){let j=i+1;while(j<program.length&&program[j].type===program[i].type)j++;
    out.push(j-i>1?repeat(j-i,[program[i]]):program[i]);i=j;}
  return out;
}
function artSpec(topic,k){
  const forward=n=>act('draw',n),turn=n=>act('turn',n);
  let reference,start=[100,280],dir=0,title,required=[];
  if(topic==='draw'){
    const patterns=[
      [forward(100)], [forward(150)], [forward(100),turn(-90),forward(100)],
      [forward(140),turn(-90),forward(70)],
      [forward(80),turn(-90),forward(80),turn(90),forward(80)],
      [forward(120),turn(-90),forward(120),turn(-90),forward(120)],
      [forward(100),turn(-90),forward(100),turn(-90),forward(100),turn(-90),forward(100)],
      [forward(150),turn(-120),forward(150),turn(-120),forward(150)],
      [forward(90),turn(-60),forward(90),turn(-120),forward(90),turn(-60),forward(90)],
      [forward(60),turn(-90),forward(60),turn(90),forward(60),turn(-90),forward(60),turn(90),forward(60)],
    ];reference=patterns[k];title=['첫 번째 선','긴 선 그리기','직각으로 꺾기','서로 다른 길이','계단 한 칸','세 변 그리기','정사각형','정삼각형','평행사변형','계단 세 칸'][k];
  }else if(topic==='polygon'){
    const sides=[4,3,4,5,6,8,3,5,6,5][k],len=[100,140,150,90,80,65,180,100,100,150][k];
    const angle=k===9?-144:-360/sides;
    reference=[repeat(sides,[forward(len),turn(angle)])];title=k===9?'별 그리기':`${sides}개의 변으로 도형 그리기`;required=['repeat'];
    start=k===9?[130,300]:[120,300];
  }else{
    const n=[2,3,4,5,6,3,4,5,6,8][k],sides=[4,4,3,3,3,5,4,5,6,3][k],len=[65,65,80,75,60,70,60,55,45,50][k];
    start=[210,210];
    reference=[repeat(n,[repeat(sides,[forward(len),turn(-360/sides)]),turn(360/n)])];
    title=`${n}송이 도형 꽃`;required=['nested'];
  }
  return {reference,start,dir, title,required};
}
export function makeLevel(lesson,index){
  const meta=lessons[lesson],id=`${lesson+1}-${index+1}`;
  const base={...meta,id,lesson,index,required:[],maxBlocks:40};
  if(meta.mode==='art'){
    const spec=artSpec(meta.topic,index);return {...base,...spec,maxBlocks:meta.topic==='draw'?20:meta.topic==='nested'?9:5,
      goalText:'점선을 따라 같은 그림을 완성하세요.',hint:`이동 거리와 회전 각도는 화면에 표시되어 있어요. ${meta.topic==='nested'?'반복 안에 반복을 넣고, 도형 하나를 그린 뒤 방향을 바꿔 보세요.':meta.topic==='polygon'?'앞으로 이동과 회전을 반복 안에 넣어 보세요.':'블록의 거리와 각도를 바꾸어 점선을 따라가세요.'}`};
  }
  if(meta.mode==='sprite'){
    const sets=[[[4,3]],[[2,3]],[[3,2]],[[3,4]],[[2,3],[4,3]],[[3,2],[3,4]],[[1,3],[5,3]],[[2,2],[4,4]],[[1,1],[5,5],[1,5]],[[1,1],[5,1],[5,5],[1,5]]];
    return {...base,title:`별 모으기 ${index+1}`,grid:Array.from({length:7},()=>Array(7).fill(1)),start:[3,3],dir:0,stars:sets[index],required:['event'],maxBlocks:20,reference:[],
      goalText:`화살표 이벤트를 만들어 별 ${sets[index].length}개를 모두 모으세요.`,hint:'화살표를 눌렀을 때 블록 아래에 해당 방향으로 한 칸 이동을 연결하세요. 실행 후 화면의 화살표 버튼을 누르세요.'};
  }
  const route=(lesson<=1?routes:longRoutes)[index];
  const spec=mazeSpec(route,index);
  let reference=spec.reference;
  if(meta.topic==='repeat'||meta.topic==='final') reference=compress(reference);
  if(meta.topic==='condition') reference=compress(reference).map(a=>a.type==='repeat'?{...a,body:[{type:'if',body:a.body,otherwise:[]}]}:a.type==='move'?{type:'if',body:[a],otherwise:[]}:a);
  if(meta.topic==='until'){
    const seq=spec.reference;
    reference=[...seq.slice(0,-route.at(-1)[1]),{type:'until',body:[act('move')]}];
  }
  const required=meta.topic==='repeat'||meta.topic==='final'?['repeat']:meta.topic==='condition'?['if']:meta.topic==='until'?['until']:[];
  const title=meta.topic==='debug'?`오류를 고치는 탐정 ${index+1}`:meta.topic==='final'?`종합 탐험 ${index+1}`:`목표까지 가는 길 ${index+1}`;
  return {...base,...spec,reference,title,required,maxBlocks:meta.topic==='repeat'||meta.topic==='final'?compress(spec.reference).reduce((n,a)=>n+(a.body?2:1),0)+2:40,
    goalText:`로봇을 별까지 이동시키세요.${required.length?' 이번에는 '+({repeat:'반복',if:'조건',until:'도착할 때까지 반복'}[required[0]])+' 블록을 사용하세요.':''}`,
    hint:meta.topic==='condition'?'만약 앞에 길이 있다면 안에 앞으로 이동을 넣어 보세요. 모퉁이에서는 방향을 바꿔야 해요.':meta.topic==='until'?'마지막 직선 길은 도착할 때까지 반복 안에 앞으로 이동을 넣으면 돼요.':meta.topic==='repeat'||meta.topic==='final'?'연속으로 앞으로 가는 칸 수를 세고, 이동 블록 하나를 반복 안에 넣어 보세요.':'로봇이 바라보는 방향을 확인하세요. 회전은 자리에서 방향만 바꾸고, 이동은 한 칸 앞으로 가요.'};
}
export const allLevels=lessons.flatMap((_,l)=>Array.from({length:10},(_,i)=>makeLevel(l,i)));
