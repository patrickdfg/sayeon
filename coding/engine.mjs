export const vectors=[[1,0],[0,1],[-1,0],[0,-1]];
export function initialState(level){return {x:level.start[0],y:level.start[1],dir:level.dir,segments:[],collected:[],steps:0};}
export function atGoal(level,s){return level.goal&&s.x===level.goal[0]&&s.y===level.goal[1];}
export function pathAhead(level,s){const [dx,dy]=vectors[s.dir];return !!level.grid?.[s.y+dy]?.[s.x+dx];}
export function advance(level,s,a){
  const next={...s,steps:s.steps+1,segments:[...s.segments],collected:[...s.collected]};
  if(a.type==='move'||a.type==='step'){
    const d=a.type==='step'?Number(a.value):s.dir;
    const [dx,dy]=vectors[d];
    if(!level.grid?.[s.y+dy]?.[s.x+dx]) throw new Error('앞이 막혀 있어요. 이동하기 전에 방향이나 조건을 확인해 보세요.');
    next.x+=dx;next.y+=dy;next.dir=d;
  }else if(a.type==='left')next.dir=(s.dir+3)%4;
  else if(a.type==='right')next.dir=(s.dir+1)%4;
  else if(a.type==='draw'){
    const radians=s.dir*Math.PI/180;
    next.x+=Math.cos(radians)*Number(a.value);next.y+=Math.sin(radians)*Number(a.value);
    next.segments.push([s.x,s.y,next.x,next.y]);
    if(next.x<0||next.x>420||next.y<0||next.y>420)throw new Error('그림이 종이 밖으로 나갔어요. 거리나 회전 각도를 확인해 보세요.');
  }else if(a.type==='turn')next.dir=(s.dir+Number(a.value))%360;
  for(let i=0;i<(level.stars?.length||0);i++){
    const [x,y]=level.stars[i];if(next.x===x&&next.y===y&&!next.collected.includes(i))next.collected.push(i);
  }
  return next;
}
// Interpret only our small command language. User blocks never become eval code.
export function* execute(program,level,getState,depth=0,budget={remaining:1500}){
  if(depth>20)throw new Error('반복이 너무 깊어요. 블록을 조금 줄여 보세요.');
  for(const a of program){
    if(--budget.remaining<0)throw new Error('반복이 너무 오래 계속돼요. 이동이나 멈추는 조건을 확인해 보세요.');
    if(a.type==='repeat'){
      for(let n=0;n<Math.min(50,Math.max(1,Number(a.value)));n++)yield* execute(a.body,level,getState,depth+1,budget);
    }else if(a.type==='until'){
      while(!atGoal(level,getState())){
        if(--budget.remaining<0)throw new Error('도착 조건에 가까워지지 않아요. 반복 안에 이동 블록을 넣어 주세요.');
        yield* execute(a.body,level,getState,depth+1,budget);
      }
    }else if(a.type==='if'){
      yield* execute(pathAhead(level,getState())?a.body:a.otherwise,level,getState,depth+1,budget);
    }else if(a.type!=='event'&&a.type!=='start')yield a;
    else if(a.type==='start')yield* execute(a.body,level,getState,depth+1,budget);
  }
}
export function simulate(level,program){let s=initialState(level);for(const a of execute(program,level,()=>s))s=advance(level,s,a);return s;}
const near=(a,b)=>Math.abs(a-b)<1.5;
export function sameDrawing(actual,target){
  if(actual.length!==target.length)return false;
  const remaining=[...target];
  return actual.every(a=>{const i=remaining.findIndex(b=>a.every((v,j)=>near(v,b[j]))||a.every((v,j)=>near(v,b[(j+2)%4])));if(i<0)return false;remaining.splice(i,1);return true;});
}
export function commandFeatures(program,depth=0,out=new Set()){
  for(const a of program){out.add(a.type);if(a.type==='repeat'&&depth>0)out.add('nested');if(a.body)commandFeatures(a.body,depth+(a.type==='repeat'?1:0),out);if(a.otherwise)commandFeatures(a.otherwise,depth,out);}return out;
}
export function solved(level,state,program){
  const features=commandFeatures(program);
  if(!level.required.every(x=>features.has(x)))return false;
  if(level.mode==='art')return sameDrawing(state.segments,simulate(level,level.reference).segments);
  if(level.mode==='sprite')return state.collected.length===level.stars.length;
  return !!atGoal(level,state);
}
