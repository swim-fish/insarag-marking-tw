#!/usr/bin/env python3
"""Prepare native-layer Figma sync scripts from the verified handbook sources.

Execute the generated scripts with the Figma use_figma connector. The scripts
do not fetch external content and never convert a complete page to a bitmap.
"""
import hashlib
import json
import xml.etree.ElementTree as ET
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
NS = 'http://www.w3.org/2000/svg'
ET.register_namespace('', NS)

HELPERS = r'''
const CREATED = [], MUTATED = [];
const W = 148 * 72 / 25.4, H = 210 * 72 / 25.4;
const FONT = 'Noto Sans TC';
const rgb = hex => ({r:parseInt(hex.slice(1,3),16)/255,g:parseInt(hex.slice(3,5),16)/255,b:parseInt(hex.slice(5,7),16)/255});
const paint = hex => [{type:'SOLID',color:rgb(hex)}];
const remember = node => { CREATED.push(node.id); return node; };
async function ensureStyles(fonts, saved) {
  const local = await figma.getLocalTextStylesAsync(), styles = {...saved};
  for (const spec of fonts) {
    const key = `${spec.size}/${spec.bold?'Bold':'Regular'}`, name = `INSARAG / ${spec.size} / ${spec.bold?'Bold':'Regular'}`;
    let style = local.find(s=>s.name===name);
    if (!style) {
      style = figma.createTextStyle(); style.name = name;
      style.fontName = {family:FONT,style:spec.bold?'Bold':'Regular'}; style.fontSize = spec.size;
      style.lineHeight = {unit:'PIXELS',value:spec.size*1.25}; style.letterSpacing = {unit:'PIXELS',value:0};
      CREATED.push(style.id);
    }
    styles[key] = style.id;
  }
  return styles;
}
async function init() {
  const page = await figma.getNodeByIdAsync('0:1');
  if (!page || page.type !== 'PAGE') throw new Error('Target page is unavailable');
  await figma.setCurrentPageAsync(page);
  await Promise.all(['Regular','Bold'].map(style=>figma.loadFontAsync({family:FONT,style})));
  return page;
}
function nativeText(op, baseline, styles, variables) {
  const n = remember(figma.createText());
  n.fontName = {family:FONT,style:op.bold?'Bold':'Regular'};
  n.fontSize = op.size;
  n.lineHeight = {unit:'PIXELS',value:op.size*1.25};
  n.letterSpacing = {unit:'PIXELS',value:0};
  n.textAutoResize = 'WIDTH_AND_HEIGHT';
  n.characters = op.text;
  n.name = op.text;
  const key = `${op.size}/${op.bold?'Bold':'Regular'}`;
  if (styles[key]) n.textStyleId = styles[key];
  const base = {type:'SOLID',color:rgb(op.color)};
  n.fills = variables[op.color] ? [figma.variables.setBoundVariableForPaint(base,'color',variables[op.color])] : [base];
  n.x = op.x - (op.align==='center'?n.width/2:op.align==='right'?n.width:0);
  n.y = op.y - op.size * baseline[op.bold?'Bold':'Regular'];
  return n;
}
'''

SETUP = r'''
const page = await init();
if (page.children.some(n=>n.name==='INSARAG / A5 Handbook')) throw new Error('Existing sync found; inspect state.json before updating');
const baseline = {}, removed = [];
for (const style of ['Regular','Bold']) {
  const sample = remember(figma.createText());
  sample.fontName = {family:FONT,style}; sample.fontSize=20;
  sample.lineHeight={unit:'PIXELS',value:25}; sample.characters='測試 Ag';
  sample.x=3500; sample.y=3500;
  const svg = await sample.exportAsync({format:'SVG_STRING',svgOutlineText:false});
  const match = svg.match(/<tspan[^>]*\by="([\d.\-]+)"/);
  if (!match) throw new Error('Cannot measure Figma text baseline: '+svg.slice(0,500));
  baseline[style] = Number(match[1])/20;
  removed.push(sample.id); sample.remove();
}
const collection = figma.variables.createVariableCollection('INSARAG / Print Colors');
const variables = {}, variableIds = [], mode=collection.modes[0].modeId;
collection.renameMode(mode,'Print');
for (const [hex,name] of Object.entries(DATA.colors)) {
  const primitive = figma.variables.createVariable('Source/'+name,collection,'COLOR');
  primitive.scopes=[]; primitive.setValueForMode(mode,{...rgb(hex),a:1});
  primitive.setVariableCodeSyntax('WEB',`var(--insarag-source-${name})`);
  const semantic = figma.variables.createVariable('Print/'+name,collection,'COLOR');
  semantic.scopes=['TEXT_FILL','FRAME_FILL','SHAPE_FILL','STROKE_COLOR'];
  semantic.setValueForMode(mode,{type:'VARIABLE_ALIAS',id:primitive.id});
  semantic.setVariableCodeSyntax('WEB',`var(--insarag-${name})`);
  variables[hex]=semantic; variableIds.push(primitive.id,semantic.id);
}
const styles = {}, styleIds=[];
for (const spec of DATA.fonts) {
  const s=figma.createTextStyle(); s.name=`INSARAG / ${spec.size} / ${spec.bold?'Bold':'Regular'}`;
  s.fontName={family:FONT,style:spec.bold?'Bold':'Regular'}; s.fontSize=spec.size;
  s.lineHeight={unit:'PIXELS',value:spec.size*1.25}; s.letterSpacing={unit:'PIXELS',value:0};
  styles[`${spec.size}/${spec.bold?'Bold':'Regular'}`]=s.id; styleIds.push(s.id);
}
const section=remember(figma.createSection());
section.name='INSARAG / A5 Handbook'; section.x=100; section.y=100;
section.resizeWithoutConstraints(W*4+60*3+80,H*3+70*2+80);
section.fills=paint('#e8eef0');
page.name='INSARAG｜A5 圖解手冊'; MUTATED.push(page.id);
const frameIds=[];
for (const p of DATA.pages) {
  const f=remember(figma.createFrame()); section.appendChild(f);
  f.name=`${String(p.number).padStart(2,'0')}｜${p.title}｜A5 148 × 210 mm`;
  f.resize(W,H); f.x=40+((p.number-1)%4)*(W+60); f.y=40+Math.floor((p.number-1)/4)*(H+70);
  f.fills=paint('#ffffff'); f.clipsContent=true;
  f.exportSettings=[{format:'PDF',contentsOnly:true},{format:'SVG',svgOutlineText:true,contentsOnly:true}];
  frameIds.push(f.id);
}
const gap = (parent,height) => {
  const s=remember(figma.createFrame()); parent.appendChild(s); s.name='Spacing'; s.resize(370,Math.max(.01,height)); s.fills=[];
};
const header=remember(figma.createComponent()); header.name='INSARAG / Page Header';
header.description='A5 共用頁首。標題與提示文字可由元件屬性編輯。';
header.layoutMode='VERTICAL'; header.primaryAxisSizingMode='FIXED'; header.counterAxisSizingMode='FIXED';
header.resize(370,82); header.fills=[]; header.itemSpacing=0; header.x=section.x+section.width+120; header.y=100;
const accent=remember(figma.createRectangle()); header.appendChild(accent); accent.name='Accent'; accent.resize(28,5);
accent.fills=[figma.variables.setBoundVariableForPaint({type:'SOLID',color:rgb('#b94612')},'color',variables['#b94612'])];
gap(header,64-20*baseline.Bold-26-5);
const title=nativeText({x:0,y:0,text:DATA.pages[0].title,size:20,color:'#183343',bold:true,align:'left'},baseline,styles,variables);
header.appendChild(title); title.textAutoResize='HEIGHT'; title.resize(370,title.height);
const titleProp=header.addComponentProperty('Title','TEXT',DATA.pages[0].title);
title.componentPropertyReferences={characters:titleProp};
gap(header,(91-10.5*baseline.Regular)-(64-20*baseline.Bold)-title.height);
const kicker=nativeText({x:0,y:0,text:DATA.pages[0].kicker,size:10.5,color:'#183343',bold:false,align:'left'},baseline,styles,variables);
header.appendChild(kicker); kicker.textAutoResize='HEIGHT'; kicker.resize(370,kicker.height);
const kickerProp=header.addComponentProperty('Kicker','TEXT',DATA.pages[0].kicker);
kicker.componentPropertyReferences={characters:kickerProp};
return {createdNodeIds:CREATED,mutatedNodeIds:MUTATED,removedNodeIds:removed,
  sectionId:section.id,frameIds,headerId:header.id,
  properties:{title:titleProp,kicker:kickerProp},
  baseline,styles,styleIds,collectionId:collection.id,variableIds,
  variables:Object.fromEntries(Object.entries(variables).map(([k,v])=>[k,v.id])),
  dimensions:{points:[W,H],millimetres:[148,210]},pageCount:frameIds.length};
'''

COMPOSE = r'''
await init();
const header = await figma.getNodeByIdAsync(STATE.headerId);
const REMOVED = [];
const styles = await ensureStyles(DATA.fonts, STATE.styles);
const variablePairs=await Promise.all(Object.entries(STATE.variables).map(async ([hex,id])=>[hex,await figma.variables.getVariableByIdAsync(id)]));
const variables=Object.fromEntries(variablePairs), results=[];
for (const p of DATA.pages) {
  const frame=await figma.getNodeByIdAsync(STATE.frameIds[p.number-1]);
  if (!frame || frame.type!=='FRAME') throw new Error('A5 frame is unavailable');
  if (frame.children.length && !REPLACE) throw new Error('Frame is already populated; inspect before retry: '+frame.id);
  // REPLACE rebuilds the page from the verified source; the frame itself and its ID are kept.
  for (const child of [...frame.children]) { REMOVED.push(child.id); child.remove(); }
  const art=figma.createNodeFromSvg(p.svg); frame.appendChild(art); art.name='Vector artwork'; art.x=0;art.y=0;
  CREATED.push(art.id,...art.findAll(()=>true).map(n=>n.id));
  const h=header.createInstance(); frame.appendChild(h); h.name='Page Header';h.x=25;h.y=26;
  h.setProperties({[STATE.properties.title]:p.title,[STATE.properties.kicker]:p.kicker});
  CREATED.push(h.id,...h.findAll(()=>true).map(n=>n.id));
  const labels=remember(figma.createFrame()); frame.appendChild(labels);labels.name='Editable diagram labels';labels.resize(W,H);labels.fills=[];labels.clipsContent=false;
  const bodyOps=[];
  for(const op of p.text) {
    if(op.y===64 || op.y===91) continue;
    if(op.y>=p.bodyStart) bodyOps.push(op);
    else { const t=nativeText(op,STATE.baseline,styles,variables); labels.appendChild(t); }
  }
  const rows=[...new Set(bodyOps.map(o=>o.y))].sort((a,b)=>a-b);
  if(rows.length) {
    const stack=remember(figma.createAutoLayout('VERTICAL'));frame.appendChild(stack);
    stack.name='Instructions and notes';stack.fills=[];stack.itemSpacing=0;stack.primaryAxisSizingMode='AUTO';stack.counterAxisSizingMode='FIXED';
    stack.resize(370,100);stack.x=25;
    const first=bodyOps.find(o=>o.y===rows[0]); stack.y=rows[0]-first.size*STATE.baseline[first.bold?'Bold':'Regular'];
    for(let i=0;i<rows.length;i++) {
      const ops=bodyOps.filter(o=>o.y===rows[i]).sort((a,b)=>a.x-b.x);
      const a=ops[0], top=rows[i]-a.size*STATE.baseline[a.bold?'Bold':'Regular'];
      const next=bodyOps.find(o=>o.y===rows[i+1]);
      const height=next ? rows[i+1]-next.size*STATE.baseline[next.bold?'Bold':'Regular']-top : a.size*1.25;
      const row=remember(figma.createAutoLayout('HORIZONTAL'));stack.appendChild(row);row.name=ops.map(o=>o.text).join(' ');
      row.fills=[];row.resize(370,height);row.primaryAxisSizingMode='FIXED';row.counterAxisSizingMode='FIXED';row.counterAxisAlignItems='BASELINE';row.paddingLeft=ops[0].x-25;
      let previous;
      for(const op of ops) {
        const text=nativeText(op,STATE.baseline,styles,variables);row.appendChild(text);
        if(previous) row.itemSpacing=op.x-previous.op.x-previous.node.width;
        previous={op,node:text};
      }
    }
  }
  MUTATED.push(frame.id);
  const descendants=frame.findAll(()=>true), counts={};
  const overflow=[];
  for(const n of descendants) {
    counts[n.type]=(counts[n.type]||0)+1;
    if(n.type==='TEXT') {
      if(n.fontName.family!==FONT) throw new Error('Unexpected font: '+n.id);
      const r=n.absoluteBoundingBox, fr=frame.absoluteBoundingBox;
      if(r && (r.x<fr.x+14 || r.x+r.width>fr.x+W-9 || r.y<fr.y+9 || r.y+r.height>fr.y+H-2)) overflow.push({id:n.id,text:n.characters,bounds:r});
    }
  }
  results.push({number:p.number,id:frame.id,name:frame.name,width:frame.width,height:frame.height,nodeCounts:counts,textOverflow:overflow,
    imageFilledNodeIds:descendants.filter(n=>Array.isArray(n.fills)&&n.fills.some(f=>f.type==='IMAGE')).map(n=>n.id)});
}
// The printed pages no longer carry a source footer; drop the unused component once nothing uses it.
let footerRemoved = false;
if (CLEANUP && STATE.footerId) {
  const footer = await figma.getNodeByIdAsync(STATE.footerId);
  if (footer && !(await footer.getInstancesAsync()).length) { REMOVED.push(footer.id); footer.remove(); footerRemoved = true; }
}
return {createdNodeIds:CREATED,mutatedNodeIds:MUTATED,removedNodeIds:REMOVED,styles,footerRemoved,pages:results};
'''


def main():
    scenes=json.loads((ROOT/'scenes.json').read_text(encoding='utf-8'))
    manual=json.loads((ROOT/'manual.json').read_text(encoding='utf-8'))
    pages=[]
    for i, (ops, entry) in enumerate(zip(scenes['pages'], manual['pages']),1):
        xml=ET.fromstring((ROOT/'pages'/f'{i:02d}.svg').read_text(encoding='utf-8'))
        xml.set('width',str(scenes['width']));xml.set('height',str(scenes['height']))
        for child in list(xml):
            tag=child.tag.rsplit('}',1)[-1]
            if tag in ('text','title','desc','metadata'):
                xml.remove(child)
            elif tag=='rect' and child.attrib.get('x')=='25' and child.attrib.get('y')=='26':
                xml.remove(child)
        pages.append(dict(number=i,title=entry['title'],kicker=entry['kicker'],source=entry['source'],
                          bodyStart={'triage':480,'terminology':486,'sources':318,'worksite':344}.get(entry['diagram'],356),
                          svg=ET.tostring(xml,encoding='unicode'),text=[op for op in ops if op['kind']=='text']))
    fonts=sorted({(op['size'],op['bold']) for pg in pages for op in pg['text']})
    data=dict(pages=pages,fonts=[dict(size=size,bold=bold) for size,bold in fonts],
              colors={'#183343':'ink','#52636b':'muted','#b94612':'marking'})
    (HERE/'payload.json').write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n',encoding='utf-8', newline='\n')
    setup_data={**data,'pages':[{k:pg[k] for k in ['number','title','kicker','source']} for pg in pages]}
    (HERE/'setup.js').write_text(HELPERS+'\nconst DATA='+json.dumps(setup_data,ensure_ascii=False,separators=(',',':'))+';\n'+SETUP,encoding='utf-8', newline='\n')
    state_path=HERE/'state.json'
    if state_path.exists():
        state=json.loads(state_path.read_text(encoding='utf-8'))
        # compose-*.js fills empty frames; update-*.js rebuilds populated frames in place.
        for prefix, replace in [('compose', False), ('update', True)]:
            for start in range(0,12,4):
                chunk={**data,'pages':pages[start:start+4]}
                flags=f'const REPLACE={str(replace).lower()}, CLEANUP={str(replace and start==8).lower()};\n'
                (HERE/f'{prefix}-{start+1:02d}-{start+4:02d}.js').write_text(HELPERS+'\nconst STATE='+json.dumps(state,ensure_ascii=False,separators=(',',':'))+';\nconst DATA='+json.dumps(chunk,ensure_ascii=False,separators=(',',':'))+';\n'+flags+COMPOSE,encoding='utf-8', newline='\n')
    manifest=dict(file_key='NJHNxTRl5zdtYkATo6ig9N',page_id='0:1',page_mm=[148,210],
                  source_sha256={name:hashlib.sha256((ROOT/name).read_bytes()).hexdigest() for name in ['manual.json','scenes.json','terminology.csv']},
                  font='Noto Sans TC',editable_text=True,vector_artwork=True)
    (HERE/'source-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n',encoding='utf-8', newline='\n')
    print(f'Prepared {len(pages)} A5 pages for Figma')


if __name__=='__main__':
    main()
