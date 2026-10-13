// 앱 안에서 쓰는 읽어주기 연결(app-tts.js)이 브라우저 방식과 같은 모양으로 동작하는지 본다.
import {test} from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import vm from 'node:vm';
const code=readFileSync(new URL('../app-tts.js',import.meta.url),'utf8');
function load(app){const win={SayeonApp:app};win.window=win;vm.runInNewContext(code,win);return win;}
function fakeApp(rows){const calls=[];return {calls,voices:()=>JSON.stringify(rows),speak:(...a)=>calls.push(['speak',...a]),stop:()=>calls.push(['stop'])};}
const rows=[{id:'com.google.android.tts|ko-kr-x-ism-local',name:'Google ISM',lang:'ko-KR',local:true},{id:'com.google.android.tts|ko-kr-x-ism-network',name:'Google ISM',lang:'ko-KR',local:false}];

test('앱이 아니면 아무것도 바꾸지 않는다',()=>{const win={window:null};win.window=win;vm.runInNewContext(code,win);assert.equal(win.speechSynthesis,undefined);assert.equal(win.__sayeonTtsShim,undefined);});
test('목소리 목록을 브라우저 모양으로 내준다',()=>{const w=load(fakeApp(rows));const vs=w.speechSynthesis.getVoices();assert.equal(vs.length,2);assert.equal(vs[0].voiceURI,'com.google.android.tts|ko-kr-x-ism-local');assert.equal(vs[0].localService,true);assert.equal(vs[1].localService,false);assert.equal(vs[0].lang,'ko-KR');});
test('읽기 시작·끝 이벤트와 목소리·속도 전달',()=>{const app=fakeApp(rows),w=load(app),log=[];
 const u=new w.SpeechSynthesisUtterance('안녕');u.rate=0.8;u.voice=w.speechSynthesis.getVoices()[0];u.onstart=()=>log.push('start');u.onend=()=>log.push('end');
 w.speechSynthesis.speak(u);assert.deepEqual(app.calls[0],['speak','u1','안녕','com.google.android.tts|ko-kr-x-ism-local',0.8]);assert.equal(w.speechSynthesis.speaking,true);
 w.__sayeonTts.event('u1','start');w.__sayeonTts.event('u1','end');assert.deepEqual(log,['start','end']);assert.equal(w.speechSynthesis.speaking,false);});
test('끝 핸들러에서 바로 다음 발화를 부르면 이어서 읽는다',()=>{const app=fakeApp(rows),w=load(app);let n=0;
 const mk=t=>{const u=new w.SpeechSynthesisUtterance(t);u.onend=()=>{n++;if(n<2)w.speechSynthesis.speak(mk('둘'));};return u;};
 w.speechSynthesis.speak(mk('하나'));w.__sayeonTts.event('u1','end');assert.equal(app.calls.filter(c=>c[0]==='speak').length,2);assert.equal(app.calls[1][2],'둘');});
test('겹쳐 부르면 줄을 세워 하나씩 읽는다',()=>{const app=fakeApp(rows),w=load(app);
 w.speechSynthesis.speak(new w.SpeechSynthesisUtterance('가'));w.speechSynthesis.speak(new w.SpeechSynthesisUtterance('나'));
 assert.equal(app.calls.filter(c=>c[0]==='speak').length,1);w.__sayeonTts.event('u1','end');assert.equal(app.calls[1][2],'나');});
test('취소하면 멈춘 발화의 끝·오류를 알리지 않는다',()=>{const app=fakeApp(rows),w=load(app),log=[];
 const u=new w.SpeechSynthesisUtterance('가');u.onend=()=>log.push('end');u.onerror=()=>log.push('error');
 w.speechSynthesis.speak(u);w.speechSynthesis.cancel();w.__sayeonTts.event('u1','end');w.__sayeonTts.event('u1','error');
 assert.deepEqual(log,[]);assert.deepEqual(app.calls.at(-1),['stop']);});
test('오류는 onerror 로 전해지고 줄 선 것이 이어진다',()=>{const app=fakeApp(rows),w=load(app),log=[];
 const u=new w.SpeechSynthesisUtterance('가');u.onerror=e=>log.push(e.error);w.speechSynthesis.speak(u);w.speechSynthesis.speak(new w.SpeechSynthesisUtterance('나'));
 w.__sayeonTts.event('u1','error');assert.deepEqual(log,['synthesis-failed']);assert.equal(app.calls.filter(c=>c[0]==='speak').length,2);});
test('엔진이 늦게 준비되면 voiceschanged 로 알린다',()=>{const w=load(fakeApp([])),log=[];w.speechSynthesis.onvoiceschanged=()=>log.push('a');w.speechSynthesis.addEventListener('voiceschanged',()=>log.push('b'));
 w.__sayeonTts.ready();assert.deepEqual(log,['a','b']);});
