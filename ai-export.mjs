// Browser-only editable document export. No answer or source text is uploaded.
const encoder=new TextEncoder();
export function xmlText(value){if(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(String(value??'')))throw new Error('문서로 저장할 수 없는 제어 문자가 포함되어 있습니다.');return String(value??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
export function exportRows(title,sections){
 if(!Array.isArray(sections)||!sections.length)throw new Error('먼저 정리 결과를 생성해 주세요.');
 const rows=[{kind:'title',text:String(title||'원문 종합 정리')}];
 sections.forEach((s,i)=>{rows.push({kind:'heading',text:(i+1)+'. '+s.title});s.points.forEach(p=>{String(p.text).split(/\n/).forEach(text=>rows.push({kind:'body',text}));});});return rows;
}
const crcTable=Uint32Array.from({length:256},(_,n)=>{let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;return c>>>0;});
function crc(bytes){let c=0xffffffff;for(const b of bytes)c=crcTable[(c^b)&255]^(c>>>8);return (c^0xffffffff)>>>0;}
function record(size){const bytes=new Uint8Array(size);return {bytes,view:new DataView(bytes.buffer)};}
export function zipStore(files){
 const local=[],central=[];let offset=0;
 for(const [path,text] of Object.entries(files)){
  const name=encoder.encode(path),body=typeof text==='string'?encoder.encode(text):text,check=crc(body),h=record(30+name.length),v=h.view;
  v.setUint32(0,0x04034b50,true);v.setUint16(4,20,true);v.setUint16(6,0x800,true);v.setUint16(12,33,true);v.setUint32(14,check,true);v.setUint32(18,body.length,true);v.setUint32(22,body.length,true);v.setUint16(26,name.length,true);h.bytes.set(name,30);local.push(h.bytes,body);
  const c=record(46+name.length),w=c.view;w.setUint32(0,0x02014b50,true);w.setUint16(4,20,true);w.setUint16(6,20,true);w.setUint16(8,0x800,true);w.setUint16(14,33,true);w.setUint32(16,check,true);w.setUint32(20,body.length,true);w.setUint32(24,body.length,true);w.setUint16(28,name.length,true);w.setUint32(42,offset,true);c.bytes.set(name,46);central.push(c.bytes);offset+=h.bytes.length+body.length;
 }
 const size=central.reduce((n,b)=>n+b.length,0),end=record(22);end.view.setUint32(0,0x06054b50,true);end.view.setUint16(8,central.length,true);end.view.setUint16(10,central.length,true);end.view.setUint32(12,size,true);end.view.setUint32(16,offset,true);
 const result=new Uint8Array(offset+size+22);let p=0;for(const b of [...local,...central,end.bytes]){result.set(b,p);p+=b.length;}return result;
}
const W='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
export function docxBytes(title,sections){
 const paragraphs=exportRows(title,sections).map(row=>{const style={title:'Title',heading:'Heading1',label:'Heading2',body:'Normal'}[row.kind];return '<w:p><w:pPr><w:pStyle w:val="'+style+'"/></w:pPr><w:r><w:t xml:space="preserve">'+xmlText(row.text)+'</w:t></w:r></w:p>';}).join('');
 const styles=[['Normal',22,false,'222222'],['Title',40,true,'1E3A5F'],['Heading1',28,true,'1E3A5F'],['Heading2',22,true,'222222']].map(([id,size,bold,color])=>'<w:style w:type="paragraph" w:styleId="'+id+'"><w:name w:val="'+id+'"/>'+(id!=='Normal'?'<w:basedOn w:val="Normal"/><w:next w:val="Normal"/>':'')+'<w:pPr><w:spacing w:before="'+(id==='Heading1'?240:80)+'" w:after="120" w:line="360" w:lineRule="auto"/>'+(id!=='Normal'?'<w:keepNext/>':'')+'</w:pPr><w:rPr><w:rFonts w:ascii="Malgun Gothic" w:hAnsi="Malgun Gothic" w:eastAsia="맑은 고딕"/><w:sz w:val="'+size+'"/>'+(bold?'<w:b/>':'')+'<w:color w:val="'+color+'"/></w:rPr></w:style>').join('');
 return zipStore({
 '[Content_Types].xml':'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>',
 '_rels/.rels':'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
 'word/document.xml':'<w:document xmlns:w="'+W+'"><w:body>'+paragraphs+'<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="567" w:footer="567"/></w:sectPr></w:body></w:document>',
 'word/styles.xml':'<w:styles xmlns:w="'+W+'">'+styles+'</w:styles>',
 'word/_rels/document.xml.rels':'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'});
}
export function hwpxBytes(title,sections,template){
 const rows=exportRows(title,sections);const styles={body:[23,20,7],title:[24,21,8],heading:[25,22,9],label:[26,23,10]};
 const paragraphs=rows.map((row,i)=>{const [style,para,char]=styles[row.kind];return '<hp:p id="'+i+'" paraPrIDRef="'+para+'" styleIDRef="'+style+'" pageBreak="0" columnBreak="0" merged="0">'+(i===0?template.sectionProperties:'')+'<hp:run charPrIDRef="'+char+'"><hp:t>'+xmlText(row.text)+'</hp:t></hp:run></hp:p>';}).join('');
 const files={mimetype:'application/hwp+zip',...template.files,'Contents/section0.xml':template.sectionOpen+paragraphs+'</hs:sec>','Preview/PrvText.txt':rows.map(r=>r.text).join('\n\n')};return zipStore(files);
}
export async function saveOverview(title,sections,format){
 let bytes,mime;if(format==='docx'){bytes=docxBytes(title,sections);mime='application/vnd.openxmlformats-officedocument.wordprocessingml.document';}else if(format==='hwpx'){
  const r=await fetch(new URL('./assets/ai-export-hwpx.json?v=1',import.meta.url));if(!r.ok)throw new Error('한글 문서 서식을 불러오지 못했습니다.');bytes=hwpxBytes(title,sections,await r.json());mime='application/hwp+zip';
 }else throw new Error('지원하지 않는 문서 형식입니다.');
 const name=String(title||'원문_종합정리').replace(/[\\/:*?"<>|\u0000-\u001f]/g,'_').slice(0,100)+'.'+format;
 const url=URL.createObjectURL(new Blob([bytes],{type:mime})),link=document.createElement('a');link.href=url;link.download=name;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
}
