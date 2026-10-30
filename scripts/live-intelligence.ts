import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';

if(!process.env.BASETEN_API_KEY||!process.env.FDW_DB)throw new Error('Set BASETEN_API_KEY and FDW_DB to a fictional live fixture database');
process.env.NODE_ENV='test';
const {app,store}=await import('../src/server/index.js');
const server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));
const address=server.address();assert.ok(address&&typeof address==='object');
const project=store.projects()[0];assert.ok(project);const model=store.model(project.currentModelId!);assert.ok(model);const vendors=store.vendors(project.id);assert.equal(vendors.length,2);
const url=`http://127.0.0.1:${address.port}/api/projects/${project.id}/intelligence/ask`;
try{
  const questions=[
    {question:'Compare both vendors by their five-year modeled costs.',expected:'compare'},
    {question:`Explain the year 2 modeled outlay for ${vendors[0].name}.`,expected:'explain_result',context:{vendorId:vendors[0].id,year:2}},
    {question:'Identify candidate anomalies or unusual annual cost trends.',expected:'anomalies'},
    {question:'Write an executive financial summary of this model.',expected:'executive'}
  ];
  for(const q of questions){const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({modelId:model.id,...q})});const result=await response.json();if(!response.ok){const failure={at:new Date().toISOString(),modelId:model.id,question:q.question,status:response.status,error:result.error};writeFileSync('data/live-intelligence-failure.json',JSON.stringify(failure,null,2));console.error(JSON.stringify(failure));process.exitCode=1;break;}assert.equal(result.modelId,model.id);assert.equal(result.intent,q.expected,`Unexpected Muse intent for ${q.question}`);assert.ok(result.evidenceIds.length>0);console.log(JSON.stringify({question:q.question,intent:result.intent,answer:result.answer,evidenceIds:result.evidenceIds,modelVersion:result.modelVersion}));}
}finally{await new Promise<void>(r=>server.close(()=>r()));store.close();}
