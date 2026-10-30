import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { parseDocument } from '../src/server/documents/parse.js';
import { inspectWorkbook } from '../src/server/export/workbook.js';

function pdf(text:string):Buffer{
  const escaped=text.replace(/[\\()]/g,'\\$&');const content=`BT /F1 12 Tf 72 720 Td (${escaped}) Tj ET`;
  const objects=[`<< /Type /Catalog /Pages 2 0 R >>`,`<< /Type /Pages /Kids [3 0 R] /Count 1 >>`,`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>`,`<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,`<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>`];
  let out='%PDF-1.4\n';const offsets=[0];for(let i=0;i<objects.length;i++){offsets.push(Buffer.byteLength(out));out+=`${i+1} 0 obj\n${objects[i]}\nendobj\n`;}const xref=Buffer.byteLength(out);out+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`;for(const pos of offsets.slice(1))out+=`${String(pos).padStart(10,'0')} 00000 n \n`;out+=`trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;return Buffer.from(out);
}

test('PDF parser yields exact page text and a page image',async()=>{
  const passages=await parseDocument(pdf('Subscription CAD 100 per seat monthly'),'offer.pdf');assert.equal(passages.length,1);assert.match(passages[0].text,/CAD 100/);assert.equal(passages[0].location,'page 1');assert.ok(passages[0].image?.length);
});

test('HTTP workflow: sources, review, model, revision, scenario and workbook',async()=>{
  process.env.NODE_ENV='test';process.env.FDW_DB=`data/test-${randomUUID()}.sqlite`;process.env.FDW_FILES=`data/test-files-${randomUUID()}`;
  const {app,store}=await import('../src/server/index.js');const server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));const addr=server.address();assert.ok(addr&&typeof addr==='object');const base=`http://127.0.0.1:${addr.port}/api`;
  const req=async(path:string,method='GET',body?:unknown)=>{const response=await fetch(base+path,{method,headers:body instanceof Buffer?{'Content-Type':'application/pdf'}:{'Content-Type':'application/json'},body:body===undefined?undefined:body instanceof Buffer?body:JSON.stringify(body)});const json=await response.json();assert.ok(response.ok,JSON.stringify(json));return json;};
  try{
    const p=await req('/projects','POST',{name:'CRM procurement',objective:'Compare two offers',currency:'CAD',years:5,seats:10,usage:0,growthPercent:0});
    const va=await req(`/projects/${p.id}/vendors`,'POST',{name:'A'}),vb=await req(`/projects/${p.id}/vendors`,'POST',{name:'B'});
    const term=(kind:string,value:string)=>({kind,value,currency:'CAD',unit:kind==='seat_monthly'?'CAD/seat/month':'CAD',startMonth:0,endMonth:null,note:''});
    const upload=async(vendorId:string,text:string,documentId?:string)=>{const q=new URLSearchParams({vendorId,name:'offer.pdf'});if(documentId)q.set('documentId',documentId);const doc=await req(`/projects/${p.id}/documents?${q}`,'POST',pdf(text));const passages=await req(`/document-versions/${doc.versionId}/passages`);assert.equal(passages.length,1);return {doc,passage:passages[0]};};
    const a=await upload(va.id,'A quote: CAD 100 per seat monthly');const b=await upload(vb.id,'B quote: CAD 95 per seat monthly');
    const retry=await upload(va.id,'A quote: CAD 100 per seat monthly');assert.equal(retry.doc.versionId,a.doc.versionId);
    const claim=async(passage:any,t:any)=>{const c=await req(`/projects/${p.id}/claims`,'POST',{passageId:passage.id,excerpt:passage.text.slice(0,20),term:t});await req(`/claims/${c.id}/review`,'POST',{action:'approve'});};
    await claim(a.passage,term('seat_monthly','100'));await claim(b.passage,term('seat_monthly','95'));
    for(const [vendorId,impl] of [[va.id,'1000'],[vb.id,'5000']]){await req(`/projects/${p.id}/assumptions`,'POST',{vendorId,term:term('implementation',impl)});await req(`/projects/${p.id}/assumptions`,'POST',{vendorId,term:term('support_annual','0')});}
    const baseline=await req(`/projects/${p.id}/model`);assert.equal(baseline.result.cheaperVendorId,va.id);assert.equal(baseline.result.vendors[0].total,'61000.00');
    const scenario=await req(`/projects/${p.id}/scenarios`,'POST',{name:'20 seats',scenario:{seats:20,overrides:{}}});assert.equal(scenario.result.vendors[0].total,'121000.00');assert.equal((await req(`/projects/${p.id}/model`)).id,baseline.id);
    const revision=await upload(va.id,'Amendment: annual escalation 10 percent',a.doc.documentId);await claim(revision.passage,term('escalation_percent','10'));
    const revisionRetry=await upload(va.id,'Amendment: annual escalation 10 percent',a.doc.documentId);assert.equal(revisionRetry.doc.versionId,revision.doc.versionId);
    const latest=await req(`/projects/${p.id}/model`);assert.equal(latest.result.cheaperVendorId,vb.id);assert.equal(latest.parentId!==null,true);
    const inspection=await req(`/projects/${p.id}/intelligence/inspect?modelId=${latest.id}`);assert.equal(inspection.model.version,latest.version);assert.ok(inspection.dependencies.some((e:any)=>e.fromType==='source_passage'&&e.toType==='claim'));assert.ok(inspection.sources.some((s:any)=>s.excerpt.includes('Amendment')));
    const explanation=await req(`/projects/${p.id}/intelligence/explain?modelId=${latest.id}&vendorId=${va.id}&year=2`);assert.equal(explanation.total,'13200.00');assert.equal(explanation.relationship,'mathematical_dependency');assert.ok(explanation.assumptions.some((a:any)=>a.source?.excerpt.includes('Amendment')));assert.ok(explanation.lines.some((l:any)=>l.category==='license'&&l.rule.includes('discount')&&l.assumptionIds.some((id:string)=>explanation.assumptions.some((a:any)=>a.id===id&&a.kind==='escalation_percent'))));
    const oldExplanation=await req(`/projects/${p.id}/intelligence/explain?modelId=${baseline.id}&vendorId=${va.id}&year=2`);assert.equal(oldExplanation.total,'12000.00');
    await req(`/projects/${p.id}/scenarios`,'POST',{name:'Post-revision 20 seats',scenario:{seats:20,overrides:{}}});
    const trace=await req(`/projects/${p.id}/trace`);assert.ok(trace.some((e:any)=>e.fromType==='document_version'&&e.toType==='source_passage'));assert.ok(trace.some((e:any)=>e.fromType==='claim'&&e.toType==='assumption'));assert.ok(trace.some((e:any)=>e.fromType==='annual_result'&&e.toType==='decision'));
    const impact=await req(`/projects/${p.id}/impact`);assert.equal(impact.bridge[0].delta,'13261.20');
    const diff=await req(`/projects/${p.id}/revisions/${revision.doc.versionId}`);assert.equal(diff.changes.length,1);assert.match(diff.changes[0].before,/CAD 100/);assert.match(diff.changes[0].after,/escalation/);
    const docs=await req(`/projects/${p.id}/documents`);assert.ok(docs.some((d:any)=>d.versionNo===2&&d.predecessorId));
    const x=await req(`/projects/${p.id}/exports`,'POST',{});const bytes=Buffer.from(await (await fetch(base.replace(/\/api$/,'')+x.url)).arrayBuffer());const wb=inspectWorkbook(bytes);assert.ok(wb.formulaCount>100);assert.match(wb.comparison,/74261\.20/);assert.match(wb.scenarios,/Post-revision 20 seats/);assert.match(wb.sources,/Amendment: annual escalation/);
    const imported=await parseDocument(bytes,'export.xlsx');assert.ok(imported.some(row=>row.text.includes('formula')&&row.text.includes('cached result unverified')));assert.ok(imported.some(row=>row.text.includes('Amendment: annual escalation')));
    const old=await req(`/projects/${p.id}/model?modelId=${baseline.id}`);assert.equal(old.result.vendors[0].total,'61000.00');
  }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));store.close();}
});
