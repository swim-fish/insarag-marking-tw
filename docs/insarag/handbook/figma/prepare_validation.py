#!/usr/bin/env python3
"""Prepare a read-only Figma audit from the source text and saved node IDs."""
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
payload = json.loads((HERE / 'payload.json').read_text(encoding='utf-8'))
state = json.loads((HERE / 'state.json').read_text(encoding='utf-8'))
expected = [dict(number=p['number'], id=state['frameIds'][p['number']-1],
                 text=[op['text'] for op in p['text']]) for p in payload['pages']]
code = r'''
const page = await figma.getNodeByIdAsync('0:1');
await figma.setCurrentPageAsync(page);
const results=[];
const W=148*72/25.4,H=210*72/25.4;
for(const p of EXPECTED) {
  const frame=await figma.getNodeByIdAsync(p.id);
  if(!frame || frame.type!=='FRAME') throw new Error('Missing page: '+p.id);
  const nodes=frame.findAll(()=>true);
  const texts=nodes.filter(n=>n.type==='TEXT');
  const actual=texts.map(n=>n.characters).sort(), expected=[...p.text].sort();
  const missing=expected.filter((s,i)=>expected.slice(0,i+1).filter(t=>t===s).length>actual.filter(t=>t===s).length);
  const extra=actual.filter((s,i)=>actual.slice(0,i+1).filter(t=>t===s).length>expected.filter(t=>t===s).length);
  const pdf=await frame.exportAsync({format:'PDF',contentsOnly:true});
  let pdfString='';
  for(let i=0;i<pdf.length;i+=8192) pdfString+=String.fromCharCode(...pdf.slice(i,i+8192));
  const mediaBoxes=[...pdfString.matchAll(/\/MediaBox\s*\[([^\]]+)\]/g)].map(m=>m[1].trim().split(/\s+/).map(Number));
  const imageObjects=(pdfString.match(/\/Subtype\s*\/Image\b/g)||[]).length;
  const svg=await frame.exportAsync({format:'SVG_STRING',contentsOnly:true,svgOutlineText:true});
  const svgImages=(svg.match(/<image\b/g)||[]).length;
  const imageFills=nodes.filter(n=>Array.isArray(n.fills)&&n.fills.some(f=>f.type==='IMAGE')).map(n=>n.id);
  const fr=frame.absoluteBoundingBox;
  const overflow=texts.filter(n=>{const r=n.absoluteBoundingBox;return r&&(r.x<fr.x+14||r.x+r.width>fr.x+W-9||r.y<fr.y+9||r.y+r.height>fr.y+H-2);}).map(n=>({id:n.id,text:n.characters}));
  const dimsOk=Math.abs(frame.width-W)<.001&&Math.abs(frame.height-H)<.001;
  const pdfA5=mediaBoxes.length===1&&Math.abs(mediaBoxes[0][2]-mediaBoxes[0][0]-W)<.02&&Math.abs(mediaBoxes[0][3]-mediaBoxes[0][1]-H)<.02;
  results.push({number:p.number,id:p.id,name:frame.name,framePoints:[frame.width,frame.height],frameA5:dimsOk,
    editableTextNodes:texts.length,vectorNodes:nodes.filter(n=>n.type==='VECTOR').length,
    fonts:[...new Set(texts.map(n=>n.fontName.family+'/'+n.fontName.style))],missingText:missing,extraText:extra,textOverflow:overflow,
    imageFilledNodeIds:imageFills,pdf:{bytes:pdf.length,mediaBoxes,a5:pdfA5,imageObjects},svg:{characters:svg.length,imageElements:svgImages},
    dateOnSingleRow:p.number===2?texts.filter(n=>n.characters==='AAA-01   ASR 3   05 Oct').map(n=>({id:n.id,characters:n.characters,bounds:n.absoluteBoundingBox})):undefined,
    pass:dimsOk&&pdfA5&&!missing.length&&!extra.length&&!overflow.length&&!imageFills.length&&!imageObjects&&!svgImages});
}
return {createdNodeIds:[],mutatedNodeIds:[],fileKey:'NJHNxTRl5zdtYkATo6ig9N',pageId:'0:1',sectionId:'7:37',
  expectedMillimetres:[148,210],pages:results,pass:results.every(p=>p.pass)};
'''
(HERE / 'validate.js').write_text('const EXPECTED='+json.dumps(expected,ensure_ascii=False,separators=(',',':'))+';\n'+code,encoding='utf-8', newline='\n')
print('Prepared read-only audit for 12 A5 pages')
