import {test} from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {exportRows,docxBytes,hwpxBytes,xmlText} from '../ai-export.mjs';
const sections=[{title:'핵심 & 과정',points:[{label:'의미 <실천>',text:'첫 설명입니다.\n뒤의 설명도 보존합니다.',sources:[{quote:'출처 제외 테스트',doc:{url:'/원문주소'}}]}]}];
function entries(bytes){const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),files={};let p=0;while(view.getUint32(p,true)===0x04034b50){assert.equal(view.getUint16(p+8,true),0);const size=view.getUint32(p+18,true),n=view.getUint16(p+26,true),extra=view.getUint16(p+28,true),name=new TextDecoder().decode(bytes.slice(p+30,p+30+n)),begin=p+30+n+extra;files[name]=new TextDecoder().decode(bytes.slice(begin,begin+size));p=begin+size;}assert.equal(view.getUint32(p,true),0x02014b50);return files;}
test('두 문서는 제목·소제목·줄바꿈 본문 순서와 XML 특수문자를 보존하고 출처 제외',()=>{
 const rows=exportRows('말씀 정리',sections);assert.deepEqual(rows.map(r=>r.kind),['title','heading','body','body']);
 const template=JSON.parse(readFileSync(new URL('../assets/ai-export-hwpx.json',import.meta.url),'utf8'));
 const docx=entries(docxBytes('말씀 정리',sections)),hwpx=entries(hwpxBytes('말씀 정리',sections,template));
 assert.equal(Object.keys(hwpx)[0],'mimetype');assert.equal(hwpx.mimetype,'application/hwp+zip');
 for(const xml of [docx['word/document.xml'],hwpx['Contents/section0.xml']]){assert(xml.includes('핵심 &amp; 과정'));assert(!xml.includes('의미 &lt;실천&gt;'));assert(xml.indexOf('첫 설명입니다.')<xml.indexOf('뒤의 설명도'));assert(!xml.includes('출처 제외 테스트'));assert(!xml.includes('원문주소'));}
 assert.equal(hwpx['Preview/PrvText.txt'],rows.map(r=>r.text).join('\n\n'));
});
test('지원 불가능한 XML 제어문자를 몰래 삭제하지 않음',()=>{assert.throws(()=>xmlText('앞\u0000뒤'),/제어 문자/);assert.equal(xmlText('한글 " & < >'),'한글 &quot; &amp; &lt; &gt;');});
