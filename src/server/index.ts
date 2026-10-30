import express from 'express';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Store } from './db.js';
import { parseDocument } from './documents/parse.js';
import { extractClaims, interpretScenario, planModelQuestion, selectNarrativeFacts, museConfigured } from './ai/muse.js';
import { bridge, evaluate, switchingDiscount } from './finance/engine.js';
import { projectSchema, scenarioSchema, termSchema } from '../shared/contracts.js';
import { makeWorkbook } from './export/workbook.js';
import { verifyWorkbookWithExcel } from './export/verify.js';
import { explainResult, inspectModel } from './intelligence/inspect.js';
import type { InspectionModel } from './intelligence/inspect.js';
import type { Assumption } from '../shared/contracts.js';

const app=express();const store=new Store(process.env.FDW_DB||'data/financial.sqlite');
const files=resolve(process.env.FDW_FILES||'data/files');mkdirSync(files,{recursive:true});
app.use(express.json({limit:'1mb'}));
const asyncRoute=(fn:(req:express.Request,res:express.Response)=>Promise<any>)=>(req:express.Request,res:express.Response,next:express.NextFunction)=>{Promise.resolve(fn(req,res)).catch(next);};
const needProject=(id:string)=>{const p=store.project(id);if(!p)throw new Error('Project not found');return p;};
const getModel=(projectId:string,modelId?:string):InspectionModel=>{const p=needProject(projectId),m=store.model(modelId||p.currentModelId||'');if(!m||m.projectId!==projectId)throw new Error('Model not found');return m as InspectionModel;};
const audit=(id:string)=>store.all<any>('SELECT * FROM audit_events WHERE project_id=? ORDER BY at DESC',id).map(r=>({id:r.id,type:r.event_type,detail:JSON.parse(r.detail_json),at:r.at}));
async function processExtraction(jobId:string,versionId:string,projectId:string,vendorId:string,passages?:Awaited<ReturnType<typeof parseDocument>>){
  const job=store.one<any>('SELECT state FROM jobs WHERE id=?',jobId);if(!job||job.state==='complete')return;
  store.run('UPDATE jobs SET state=?,error=NULL WHERE id=?','running',jobId);
  try{
    if(!passages){const source=store.one<any>('SELECT v.storage_key,d.name FROM document_versions v JOIN documents d ON d.id=v.document_id WHERE v.id=?',versionId);if(!source)throw new Error('Document version not found');passages=await parseDocument(readFileSync(source.storage_key),source.name);}
    const claims=await extractClaims(passages),sourceRows=store.all<any>('SELECT id FROM source_passages WHERE version_id=? ORDER BY rowid',versionId);
    store.transaction(()=>{const runId=randomUUID();store.run('INSERT INTO model_runs VALUES(?,?,?,?,?)',runId,versionId,process.env.BASETEN_MODEL_ID||'meta-models/muse-spark-open-1026','success',new Date().toISOString());for(const c of claims){const passageId=sourceRows[c.passageIndex]?.id;if(!passageId)continue;store.run('INSERT INTO claims VALUES(?,?,?,?,?,?,?,?)',randomUUID(),passageId,vendorId,JSON.stringify(c.term),c.excerpt,c.ambiguity?'ambiguous':'proposed',c.ambiguity,runId);}store.run('UPDATE jobs SET state=? WHERE id=?','complete',jobId);store.event(projectId,'extraction.complete',{versionId,count:claims.length});});
  }catch(e){store.run('UPDATE jobs SET state=?,error=? WHERE id=?','failed',String(e instanceof Error?e.message:e).slice(0,200),jobId);store.run('INSERT INTO model_runs VALUES(?,?,?,?,?)',randomUUID(),versionId,process.env.BASETEN_MODEL_ID||'meta-models/muse-spark-open-1026','failed',new Date().toISOString());store.event(projectId,'extraction.failed',{versionId});}
}

app.get('/api/health',(_q,r)=>r.json({ok:true,museConfigured:museConfigured(),mode:'local'}));
app.get('/api/projects',(_q,r)=>r.json(store.projects()));
app.post('/api/projects',(q,r)=>{const p=store.createProject(projectSchema.parse(q.body));r.status(201).json(p);});
app.get('/api/projects/:id',(q,r)=>{const p=needProject(q.params.id);r.json({...p,vendors:store.vendors(p.id),models:store.models(p.id).map(m=>({id:m.id,version:m.version,createdAt:m.createdAt}))});});
app.patch('/api/projects/:id/settings',(q,r)=>r.json(store.configureProject(q.params.id,projectSchema.pick({currency:true,years:true,seats:true,usage:true,growthPercent:true}).parse(q.body))));
app.post('/api/projects/:id/vendors',(q,r)=>{r.status(201).json(store.vendor(q.params.id,String(q.body?.name??'').trim().slice(0,120)));});
app.get('/api/projects/:id/assumptions',(q,r)=>{needProject(q.params.id);r.json(store.assumptions(q.params.id));});
app.post('/api/projects/:id/assumptions',(q,r)=>{
  const p=needProject(q.params.id),term=termSchema.parse(q.body?.term);const id=store.addAssumption(p.id,String(q.body?.vendorId),term,q.body?.sourcePassageId??null,q.body?.sourcePassageId?'document':'user');r.status(201).json({id,modelId:store.project(p.id)?.currentModelId});
});
app.post('/api/projects/:id/assumptions/:assumptionId/revise',(q,r)=>{const p=needProject(q.params.id);store.reviseAssumption(p.id,q.params.assumptionId,termSchema.parse(q.body?.term),q.body?.sourcePassageId??null);r.json({modelId:store.project(p.id)?.currentModelId});});

app.post('/api/projects/:id/documents',express.raw({type:['application/pdf','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/octet-stream'],limit:'12mb'}),asyncRoute(async(q,r)=>{
  const p=needProject(String(q.params.id)),vendorId=String(q.query.vendorId??'');if(!store.vendors(p.id).some(v=>v.id===vendorId))throw new Error('Vendor not in project');
  const name=String(q.query.name??'document.pdf').replace(/[\\/]/g,'_').slice(0,150);if(!Buffer.isBuffer(q.body))throw new Error('Upload requires PDF or XLSX bytes');
  const buffer=q.body as Buffer,passages=await parseDocument(buffer,name),sha=createHash('sha256').update(buffer).digest('hex');
  const existing=String(q.query.documentId??'');
  const duplicate=existing
    ?store.one<any>('SELECT d.id documentId,v.id versionId FROM documents d JOIN document_versions v ON v.document_id=d.id WHERE d.id=? AND d.project_id=? AND d.vendor_id=? AND v.sha256=? ORDER BY v.version_no DESC LIMIT 1',existing,p.id,vendorId,sha)
    :store.one<any>('SELECT d.id documentId,v.id versionId FROM documents d JOIN document_versions v ON v.document_id=d.id WHERE d.project_id=? AND d.vendor_id=? AND d.name=? AND v.sha256=? ORDER BY v.version_no DESC LIMIT 1',p.id,vendorId,name,sha);
  if(duplicate){const count=store.one<{n:number}>('SELECT COUNT(*) n FROM source_passages WHERE version_id=?',duplicate.versionId)?.n??0;const job=store.one<any>('SELECT id FROM jobs WHERE version_id=? ORDER BY created_at DESC LIMIT 1',duplicate.versionId);return r.json({...duplicate,passageCount:count,jobId:job?.id??null,extraction:'existing document version'});}
  const storageKey=join(files,sha+(name.toLowerCase().endsWith('.xlsx')?'.xlsx':'.pdf'));if(!existsSync(storageKey))writeFileSync(storageKey,buffer);
  const document=existing?store.one<any>('SELECT * FROM documents WHERE id=?',existing):undefined;
  if(existing&&(!document||document.project_id!==p.id||document.vendor_id!==vendorId))throw new Error('Document lineage mismatch');
  const documentId=document?.id??randomUUID(),versionId=randomUUID(),prior=document?store.one<any>('SELECT * FROM document_versions WHERE document_id=? ORDER BY version_no DESC LIMIT 1',documentId):undefined;
  store.transaction(()=>{
    if(!document)store.run('INSERT INTO documents VALUES(?,?,?,?,?)',documentId,p.id,vendorId,String(q.query.kind??'proposal'),name);
    store.run('INSERT INTO document_versions VALUES(?,?,?,?,?,?,?,?)',versionId,documentId,(prior?.version_no??0)+1,sha,storageKey,prior?.id??null,p.currentModelId,new Date().toISOString());
    for(let i=0;i<passages.length;i++){const passageId=randomUUID();store.run('INSERT INTO source_passages VALUES(?,?,?,?)',passageId,versionId,passages[i].location,passages[i].text);if(passages[i].image)writeFileSync(join(files,passageId+'.png'),passages[i].image!);}
    store.event(p.id,'document.uploaded',{documentId,versionId,revision:!!prior,pages:passages.length});
  });
  let jobId:string|null=null;
  if(museConfigured()){
    jobId=randomUUID();store.run('INSERT INTO jobs VALUES(?,?,?,?,?)',jobId,versionId,'queued',null,new Date().toISOString());
    setImmediate(()=>void processExtraction(jobId!,versionId,p.id,vendorId,passages));
  }
  r.status(201).json({documentId,versionId,passageCount:passages.length,jobId,extraction:jobId?'queued':'Muse not configured; passages available for manual review'});
}));
app.get('/api/jobs/:id',(q,r)=>{const j=store.one<any>('SELECT * FROM jobs WHERE id=?',q.params.id);if(!j)throw new Error('Job not found');r.json(j);});
app.get('/api/projects/:id/documents',(q,r)=>{needProject(q.params.id);r.json(store.all<any>('SELECT d.id documentId,d.vendor_id vendorId,d.name,d.kind,v.id versionId,v.version_no versionNo,v.predecessor_id predecessorId,v.base_model_id baseModelId,v.created_at createdAt FROM documents d JOIN document_versions v ON v.document_id=d.id WHERE d.project_id=? ORDER BY v.created_at DESC',q.params.id));});
app.get('/api/document-versions/:id/passages',(q,r)=>r.json(store.all<any>('SELECT id,location,text FROM source_passages WHERE version_id=? ORDER BY rowid',q.params.id)));
app.get('/api/passages/:id/image',(q,r)=>{const passage=store.one<any>('SELECT id FROM source_passages WHERE id=?',q.params.id);if(!passage)throw new Error('Passage not found');const file=join(files,passage.id+'.png');if(!existsSync(file))return r.status(404).end();r.type('png').send(readFileSync(file));});
app.get('/api/projects/:id/claims',(q,r)=>{needProject(q.params.id);r.json(store.all<any>('SELECT c.*,s.location,s.text,s.version_id FROM claims c JOIN source_passages s ON s.id=c.passage_id JOIN document_versions dv ON dv.id=s.version_id JOIN documents d ON d.id=dv.document_id WHERE d.project_id=? ORDER BY c.rowid DESC',q.params.id).map(x=>({...x,term:JSON.parse(x.term_json)})));});
app.post('/api/projects/:id/claims',(q,r)=>{const p=needProject(q.params.id),passage=store.one<any>('SELECT s.*,d.vendor_id,d.project_id FROM source_passages s JOIN document_versions v ON v.id=s.version_id JOIN documents d ON d.id=v.document_id WHERE s.id=?',q.body?.passageId);if(!passage||passage.project_id!==p.id)throw new Error('Passage not found');const term=termSchema.parse(q.body?.term);const excerpt=String(q.body?.excerpt??'').trim();if(!excerpt||!passage.text.toLowerCase().includes(excerpt.toLowerCase()))throw new Error('Excerpt does not match source');const id=randomUUID();store.run('INSERT INTO claims VALUES(?,?,?,?,?,?,?,?)',id,passage.id,passage.vendor_id,JSON.stringify(term),excerpt,'proposed','',null);store.event(p.id,'claim.manually_proposed',{claimId:id});r.status(201).json({id});});
const claimContext=(id:string)=>{const c=store.one<any>('SELECT c.*,s.version_id,d.project_id,d.id document_id,v.predecessor_id FROM claims c JOIN source_passages s ON s.id=c.passage_id JOIN document_versions v ON v.id=s.version_id JOIN documents d ON d.id=v.document_id WHERE c.id=?',id);if(!c)throw new Error('Claim not found');return c;};
const revisionTargets=(c:any,kind:string)=>{
  if(!c.predecessor_id)return [];
  return store.assumptions(c.project_id).filter(a=>a.vendorId===c.vendor_id&&a.kind===kind&&a.sourcePassageId&&a.documentVersionId!==c.version_id).filter(a=>store.one<any>('SELECT v.document_id FROM source_passages s JOIN document_versions v ON v.id=s.version_id WHERE s.id=?',a.sourcePassageId)?.document_id===c.document_id);
};
app.post('/api/claims/:id/preview',(q,r)=>{
  const c=claimContext(q.params.id),term=termSchema.parse(q.body?.term??JSON.parse(c.term_json)),current=getModel(c.project_id),candidates=revisionTargets(c,term.kind);
  const requested=String(q.body?.targetAssumptionId??'');if(requested&&!candidates.some(a=>a.id===requested))throw new Error('Target assumption does not belong to this document lineage');
  const target=requested|| (candidates.length===1?candidates[0].id:'');
  const next=target?current.inputs.map((a:Assumption)=>a.id===target?{...a,...term,sourcePassageId:c.passage_id,documentVersionId:c.version_id}:a):[...current.inputs,{...term,id:'preview',vendorId:c.vendor_id,sourcePassageId:c.passage_id,status:'approved' as const,revision:1,provenance:'document' as const,documentVersionId:c.version_id}];
  const after=evaluate(needProject(c.project_id),store.vendors(c.project_id),next);
  r.json({targetAssumptionId:target||null,ambiguousTarget:candidates.length>1,before:current.result,after,bridge:bridge(current.result,after)});
});
app.post('/api/claims/:id/review',(q,r)=>{
  const c=claimContext(q.params.id);if(!['proposed','ambiguous'].includes(c.status))throw new Error('Claim already reviewed');
  const action=String(q.body?.action??'');if(!['approve','reject'].includes(action))throw new Error('Invalid review action');
  const term=termSchema.parse(q.body?.term??JSON.parse(c.term_json)),candidates=revisionTargets(c,term.kind),requested=String(q.body?.targetAssumptionId??'');
  if(requested&&!candidates.some(a=>a.id===requested))throw new Error('Target assumption does not belong to this document lineage');
  if(action==='approve'&&candidates.length>1&&!requested)throw new Error('Multiple matching assumptions; select one to revise');
  const target=requested|| (candidates.length===1?candidates[0].id:'');
  store.transaction(()=>{
    if(action==='approve'){
      if(target)store.reviseAssumption(c.project_id,target,term,c.passage_id,'approved',c.id);else store.addAssumption(c.project_id,c.vendor_id,term,c.passage_id,'document','approved',c.id);
    }
    store.run('UPDATE claims SET status=? WHERE id=?',action==='approve'?'approved':'rejected',c.id);
    store.run('INSERT INTO review_decisions VALUES(?,?,?,?,?)',randomUUID(),c.id,action,String(q.body?.reason??''),new Date().toISOString());
    store.event(c.project_id,'claim.reviewed',{claimId:c.id,action,approvedTerm:action==='approve'?term:undefined,targetAssumptionId:target||null});
  });
  r.json({status:action==='approve'?'approved':'rejected',modelId:store.project(c.project_id)?.currentModelId});
});
app.get('/api/projects/:id/revisions/:versionId',(q,r)=>{
  const v=store.one<any>('SELECT v.*,d.project_id,d.vendor_id FROM document_versions v JOIN documents d ON d.id=v.document_id WHERE v.id=?',q.params.versionId);if(!v||v.project_id!==q.params.id)throw new Error('Version not found');
  const newer=store.all<any>('SELECT location,text,id FROM source_passages WHERE version_id=? ORDER BY rowid',v.id),older=v.predecessor_id?store.all<any>('SELECT location,text,id FROM source_passages WHERE version_id=? ORDER BY rowid',v.predecessor_id):[];
  const changes=newer.map((n,i)=>({location:n.location,before:older[i]?.text??null,after:n.text,sourcePassageId:n.id,changed:older[i]?.text!==n.text})).filter(x=>x.changed);
  r.json({versionId:v.id,predecessorId:v.predecessor_id,baseModelId:v.base_model_id,changes,removed:older.slice(newer.length).map(o=>({location:o.location,before:o.text}))});
});
app.get('/api/projects/:id/models',(q,r)=>{needProject(q.params.id);r.json(store.models(q.params.id));});
app.get('/api/projects/:id/model',(q,r)=>r.json(getModel(q.params.id,q.query.modelId?String(q.query.modelId):undefined)));
app.get('/api/projects/:id/trace',(q,r)=>{const m=getModel(q.params.id,q.query.modelId?String(q.query.modelId):undefined);r.json(store.all<any>('SELECT from_type fromType,from_id fromId,to_type toType,to_id toId FROM dependency_edges WHERE model_id=?',m.id));});
app.get('/api/projects/:id/intelligence/inspect',(q,r)=>{const p=needProject(q.params.id),m=getModel(p.id,q.query.modelId?String(q.query.modelId):undefined);r.json(inspectModel(store,p,m,store.vendors(p.id)));});
app.get('/api/projects/:id/intelligence/explain',(q,r)=>{const p=needProject(q.params.id),m=getModel(p.id,q.query.modelId?String(q.query.modelId):undefined);r.json(explainResult(store,p,m,store.vendors(p.id),String(q.query.vendorId??''),Number(q.query.year)-1));});
app.post('/api/projects/:id/intelligence/ask',asyncRoute(async(q,r)=>{
  const p=needProject(String(q.params.id)),m=getModel(p.id,q.body?.modelId),vendors=store.vendors(p.id),question=String(q.body?.question??''),selectedVendorId=String(q.body?.context?.vendorId??''),selectedYear=Number(q.body?.context?.year??0);
  const audience=String(q.body?.audience??'analyst') as 'analyst'|'executive'|'reviewer';if(!['analyst','executive','reviewer'].includes(audience))throw new Error('Unsupported audience');
  if(selectedVendorId&&!vendors.some(v=>v.id===selectedVendorId))throw new Error('Selected vendor not in model');
  if(!Number.isInteger(selectedYear)||selectedYear<0||selectedYear>p.years)throw new Error('Selected year outside model');
  const plan=await planModelQuestion(question,{modelId:m.id,vendors:vendors.map(v=>({id:v.id,name:v.name})),years:p.years,selectedVendorId,selectedYear});
  const inspection=inspectModel(store,p,m,vendors),vendorId=plan.vendorId||selectedVendorId||vendors[0]?.id,year=plan.year||selectedYear||1;
  let answer='',evidenceIds:string[]=[],details:unknown=null,operation:unknown=null,status:'answered'|'preview'|'unsupported'='answered';
  if(plan.intent==='explain_result'){
    const explanation=explainResult(store,p,m,vendors,vendorId,year-1);details=explanation;evidenceIds=[explanation.resultId,...explanation.assumptions.map(a=>`assumption:${a.id}`)];answer=`${explanation.vendorName} year ${year} modeled outlay is ${p.currency} ${explanation.total}. It is the sum of ${explanation.lines.length} rounded charge lines; the linked assumptions are mathematical dependencies.${audience==='reviewer'?` Review ${explanation.assumptions.filter(a=>a.source).length} source-linked inputs in the evidence panel.`:''}`;
  }else if(plan.intent==='compare'){
    if(m.result.comparable){const rows=m.result.vendors.map(v=>`${vendors.find(x=>x.id===v.vendorId)?.name}: ${p.currency} ${v.total}`);answer=`${rows.join('; ')}. ${vendors.find(v=>v.id===m.result.cheaperVendorId)?.name} has the lowest modeled cost by ${p.currency} ${m.result.difference}. This is a cost comparison, not an overall procurement recommendation.`;evidenceIds=m.result.vendors.map(v=>`total:${v.vendorId}`);}else{answer=`A firm cost comparison is unavailable: ${m.result.warnings.join('; ')}`;evidenceIds=m.result.warnings.map((_,i)=>`warning:${i}`);}
  }else if(plan.intent==='anomalies'){details=inspection.findings;answer=inspection.findings.length?`${inspection.findings.length} candidate finding(s) need review. These are validation signals, not confirmed errors.`:'No candidate findings were identified by the implemented rules; this does not prove the model is error free.';evidenceIds=[`model:${m.id}`,...inspection.findings.flatMap(f=>f.evidenceIds)];
  }else if(plan.intent==='scenario'){const assumptions=m.inputs.filter(a=>a.status==='approved').map(a=>({id:a.id,kind:a.kind,value:a.value,vendor:vendors.find(v=>v.id===a.vendorId)?.name??''}));operation=await interpretScenario(question,{seats:p.seats,usage:p.usage,growthPercent:p.growthPercent,years:p.years,assumptions});answer='Review this proposed operation before running the deterministic scenario. The baseline is unchanged.';evidenceIds=[`model:${m.id}`];status='preview';
  }else if(plan.intent==='overview'||plan.intent==='executive'){const totals=m.result.vendors.map(v=>`${vendors.find(x=>x.id===v.vendorId)?.name}: ${p.currency} ${v.total}`);answer=`Model version ${m.version} compares ${vendors.length} vendors over ${p.years} years using ${m.inputs.filter(a=>a.status==='approved').length} approved assumptions. ${totals.join('; ')}. ${m.result.comparable?`The lowest modeled cost is ${vendors.find(v=>v.id===m.result.cheaperVendorId)?.name}.`:`The comparison is provisional: ${m.result.warnings.join('; ')}.`} ${plan.intent==='executive'||audience==='executive'?'Review non-price criteria before a purchase decision.':''}${audience==='reviewer'?` Inspect ${inspection.sources.length} source passages and ${m.result.warnings.length} validation warnings before sign-off.`:''}`;evidenceIds=[`model:${m.id}`,...m.result.vendors.map(v=>`total:${v.vendorId}`)];
  }else{status='unsupported';answer='This question is outside the supported native-model inspection tools.';}
  if(plan.intent==='executive'){
    const facts=[{id:`model:${m.id}`,statement:`Model version ${m.version} analyzes ${vendors.length} vendors over ${p.years} years.`},...m.result.vendors.map(v=>({id:`total:${v.vendorId}`,statement:`${vendors.find(x=>x.id===v.vendorId)?.name} has modeled cost ${p.currency} ${v.total}.`}))];
    if(m.result.comparable)facts.push({id:`comparison:${m.id}`,statement:`${vendors.find(v=>v.id===m.result.cheaperVendorId)?.name} has the lowest modeled cost by ${p.currency} ${m.result.difference}.`});
    else m.result.warnings.forEach((warning,i)=>facts.push({id:`warning:${i}`,statement:`Comparison limitation: ${warning}.`}));
    const previous=m.parentId?store.model(m.parentId):null;if(previous&&previous.projectId===p.id)for(const change of bridge(previous.result,m.result))if(change.delta!=='0.00')facts.push({id:`revision:${m.id}:${change.vendorId}`,statement:`${vendors.find(v=>v.id===change.vendorId)?.name} changed by ${p.currency} ${change.delta} from model version ${previous.version}.`});
    const selected=await selectNarrativeFacts(audience,facts.slice(0,24));answer=selected.map(id=>facts.find(f=>f.id===id)!.statement).join(' ')+' Modeled cost alone is not an overall purchasing recommendation.';evidenceIds=selected;details={selectedFacts:selected.map(id=>facts.find(f=>f.id===id))};
  }
  store.event(p.id,'intelligence.asked',{modelId:m.id,intent:plan.intent,status});
  r.json({status,modelId:m.id,modelVersion:m.version,intent:plan.intent,answer,evidenceIds:[...new Set(evidenceIds)],details,operation});
}));
app.post('/api/projects/:id/scenarios/interpret',asyncRoute(async(q,r)=>{const p=needProject(String(q.params.id)),assumptions=store.assumptions(p.id).filter(a=>a.status==='approved').map(a=>({id:a.id,kind:a.kind,value:a.value,vendor:store.vendors(p.id).find(v=>v.id===a.vendorId)?.name??''}));r.json(await interpretScenario(String(q.body?.question??''),{seats:p.seats,usage:p.usage,growthPercent:p.growthPercent,years:p.years,assumptions}));}));
app.post('/api/projects/:id/scenarios',(q,r)=>{const m=getModel(q.params.id,q.body?.baseModelId),s=scenarioSchema.parse(q.body?.scenario??{});for(const id of Object.keys(s.overrides))if(!m.inputs.some((a:Assumption)=>a.id===id&&a.status==='approved'))throw new Error('Scenario references unknown assumption');const p=needProject(q.params.id),result=evaluate({...p,years:s.years??p.years},store.vendors(q.params.id),m.inputs,s),id=randomUUID();store.run('INSERT INTO scenarios VALUES(?,?,?,?,?,?)',id,q.params.id,m.id,String(q.body?.name??'Scenario'),JSON.stringify(s),JSON.stringify(result));store.event(q.params.id,'scenario.created',{scenarioId:id});r.status(201).json({id,baseModelId:m.id,scenario:s,result});});
app.get('/api/projects/:id/impact',(q,r)=>{const current=getModel(q.params.id),old=current.parentId?store.model(current.parentId):null;r.json({before:old?.result??null,after:current.result,bridge:old?bridge(old.result,current.result):null});});
app.get('/api/projects/:id/switching-discount',(q,r)=>{const m=getModel(q.params.id,q.query.modelId?String(q.query.modelId):undefined),p=needProject(q.params.id),vendorId=String(q.query.vendorId??'');if(!store.vendors(p.id).some(v=>v.id===vendorId))throw new Error('Vendor not in project');r.json({vendorId,result:switchingDiscount(p,store.vendors(p.id),m.inputs,vendorId)});});
app.get('/api/projects/:id/audit',(q,r)=>{needProject(q.params.id);r.json(audit(q.params.id));});
app.post('/api/projects/:id/exports',(q,r)=>{const m=getModel(q.params.id),vendors=store.vendors(q.params.id),sources=m.inputs.filter((a:Assumption)=>a.sourcePassageId).map((a:Assumption)=>store.one<any>('SELECT s.id passageId,s.version_id versionId,d.name documentName,s.location,s.text FROM source_passages s JOIN document_versions v ON v.id=s.version_id JOIN documents d ON d.id=v.document_id WHERE s.id=?',a.sourcePassageId)).filter(Boolean),scenarios=store.all<any>('SELECT name,result_json FROM scenarios WHERE base_model_id=?',m.id).map(s=>({name:s.name,result:JSON.parse(s.result_json)})),bytes=makeWorkbook(needProject(q.params.id),vendors,m.inputs,m.result,sources,scenarios),sha=createHash('sha256').update(bytes).digest('hex'),id=randomUUID(),path=join(files,id+'.xlsx');writeFileSync(path,bytes);const verified=verifyWorkbookWithExcel(path,vendors,m.result);store.run('INSERT INTO exports VALUES(?,?,?,?,?,?)',id,m.id,path,sha,verified?1:0,new Date().toISOString());store.event(q.params.id,'export.created',{exportId:id,modelId:m.id,verified});r.status(201).json({id,url:`/api/exports/${id}`,verified});});
app.get('/api/exports/:id',(q,r)=>{const x=store.one<any>('SELECT * FROM exports WHERE id=?',q.params.id);if(!x)throw new Error('Export not found');r.download(x.storage_key,'financial-model.xlsx');});
app.use('/api',(e:unknown,_q:express.Request,r:express.Response,_n:express.NextFunction)=>{const message=e instanceof Error?e.message:'Unknown error';r.status(message.includes('not found')?404:400).json({error:message});});
if(existsSync('dist'))app.use(express.static('dist'));
if(museConfigured())for(const pending of store.all<any>(`SELECT j.id,j.version_id,d.project_id,d.vendor_id FROM jobs j JOIN document_versions v ON v.id=j.version_id JOIN documents d ON d.id=v.document_id WHERE j.state IN ('queued','running')`))setImmediate(()=>void processExtraction(pending.id,pending.version_id,pending.project_id,pending.vendor_id));
if(process.env.NODE_ENV!=='test'){const port=Number(process.env.PORT||4310);app.listen(port,'127.0.0.1',()=>console.log(`Financial Decision Workspace: http://127.0.0.1:${port}`));}
export {app,store};
