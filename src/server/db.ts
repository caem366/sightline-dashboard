import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Assumption, ModelResult, Project, ProjectInput, Term, Vendor } from '../shared/contracts.js';
import { evaluate } from './finance/engine.js';

export class Store {
  db:DatabaseSync;
  private transactionDepth=0;
  constructor(path='data/financial.sqlite'){
    mkdirSync(dirname(path),{recursive:true});this.db=new DatabaseSync(path);this.db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY,name TEXT NOT NULL,objective TEXT NOT NULL,currency TEXT NOT NULL,years INTEGER NOT NULL,seats INTEGER NOT NULL,usage REAL NOT NULL,growth_percent REAL NOT NULL,current_model_id TEXT,created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS vendors(id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects(id),name TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS documents(id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects(id),vendor_id TEXT NOT NULL REFERENCES vendors(id),kind TEXT NOT NULL,name TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS document_versions(id TEXT PRIMARY KEY,document_id TEXT NOT NULL REFERENCES documents(id),version_no INTEGER NOT NULL,sha256 TEXT NOT NULL,storage_key TEXT NOT NULL,predecessor_id TEXT,base_model_id TEXT,created_at TEXT NOT NULL,UNIQUE(document_id,version_no));
      CREATE TABLE IF NOT EXISTS source_passages(id TEXT PRIMARY KEY,version_id TEXT NOT NULL REFERENCES document_versions(id),location TEXT NOT NULL,text TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS claims(id TEXT PRIMARY KEY,passage_id TEXT NOT NULL REFERENCES source_passages(id),vendor_id TEXT NOT NULL REFERENCES vendors(id),term_json TEXT NOT NULL,raw_excerpt TEXT NOT NULL,status TEXT NOT NULL,ambiguity TEXT NOT NULL,model_run_id TEXT);
      CREATE TABLE IF NOT EXISTS claim_assumptions(claim_id TEXT NOT NULL REFERENCES claims(id),assumption_id TEXT NOT NULL,revision INTEGER NOT NULL,PRIMARY KEY(claim_id,assumption_id,revision));
      CREATE TABLE IF NOT EXISTS assumptions(id TEXT NOT NULL,revision INTEGER NOT NULL,vendor_id TEXT NOT NULL REFERENCES vendors(id),document_version_id TEXT,source_passage_id TEXT,provenance TEXT NOT NULL,status TEXT NOT NULL,term_json TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(id,revision));
      CREATE TABLE IF NOT EXISTS models(id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects(id),version_no INTEGER NOT NULL,parent_id TEXT,result_json TEXT NOT NULL,inputs_json TEXT NOT NULL,created_at TEXT NOT NULL,UNIQUE(project_id,version_no));
      CREATE TABLE IF NOT EXISTS model_inputs(model_id TEXT NOT NULL REFERENCES models(id),assumption_id TEXT NOT NULL,revision INTEGER NOT NULL,PRIMARY KEY(model_id,assumption_id));
      CREATE TABLE IF NOT EXISTS calculated_results(id TEXT PRIMARY KEY,model_id TEXT NOT NULL REFERENCES models(id),vendor_id TEXT NOT NULL,year INTEGER NOT NULL,category TEXT NOT NULL,amount TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS dependency_edges(id TEXT PRIMARY KEY,model_id TEXT NOT NULL REFERENCES models(id),from_type TEXT NOT NULL,from_id TEXT NOT NULL,to_type TEXT NOT NULL,to_id TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS scenarios(id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects(id),base_model_id TEXT NOT NULL REFERENCES models(id),name TEXT NOT NULL,overrides_json TEXT NOT NULL,result_json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS review_decisions(id TEXT PRIMARY KEY,claim_id TEXT NOT NULL REFERENCES claims(id),action TEXT NOT NULL,reason TEXT NOT NULL,at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS audit_events(id TEXT PRIMARY KEY,project_id TEXT NOT NULL,event_type TEXT NOT NULL,detail_json TEXT NOT NULL,at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS exports(id TEXT PRIMARY KEY,model_id TEXT NOT NULL REFERENCES models(id),storage_key TEXT NOT NULL,sha256 TEXT NOT NULL,verified INTEGER NOT NULL,created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,version_id TEXT NOT NULL,state TEXT NOT NULL,error TEXT,created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS model_runs(id TEXT PRIMARY KEY,version_id TEXT NOT NULL,model_id TEXT NOT NULL,outcome TEXT NOT NULL,created_at TEXT NOT NULL);
    `);
  }
  one<T>(sql:string,...params:any[]):T|undefined{return this.db.prepare(sql).get(...params) as T|undefined;}
  all<T>(sql:string,...params:any[]):T[]{return this.db.prepare(sql).all(...params) as T[];}
  run(sql:string,...params:any[]){return this.db.prepare(sql).run(...params);}
  transaction<T>(fn:()=>T):T{
    if(this.transactionDepth){this.transactionDepth++;try{return fn();}finally{this.transactionDepth--;}}
    this.db.exec('BEGIN IMMEDIATE');this.transactionDepth=1;
    try{const v=fn();this.db.exec('COMMIT');return v;}catch(e){this.db.exec('ROLLBACK');throw e;}finally{this.transactionDepth=0;}
  }
  event(projectId:string,type:string,detail:object={}){this.run('INSERT INTO audit_events VALUES(?,?,?,?,?)',crypto.randomUUID(),projectId,type,JSON.stringify(detail),new Date().toISOString());}
  createProject(input:ProjectInput):Project{const id=crypto.randomUUID(),now=new Date().toISOString();this.run('INSERT INTO projects VALUES(?,?,?,?,?,?,?,?,?,?)',id,input.name,input.objective,input.currency,input.years,input.seats,input.usage,input.growthPercent,null,now);this.event(id,'project.created');return {...input,id,currentModelId:null,createdAt:now};}
  project(id:string):Project|undefined{const r=this.one<any>('SELECT * FROM projects WHERE id=?',id);return r&&{id:r.id,name:r.name,objective:r.objective,currency:r.currency,years:r.years,seats:r.seats,usage:r.usage,growthPercent:r.growth_percent,currentModelId:r.current_model_id,createdAt:r.created_at};}
  configureProject(id:string,settings:Pick<ProjectInput,'currency'|'years'|'seats'|'usage'|'growthPercent'>){
    const project=this.project(id);if(!project)throw new Error('Project not found');
    if(project.currentModelId)throw new Error('Baseline settings are locked after the first model. Use a scenario to test changes.');
    this.transaction(()=>{this.run('UPDATE projects SET currency=?,years=?,seats=?,usage=?,growth_percent=? WHERE id=?',settings.currency,settings.years,settings.seats,settings.usage,settings.growthPercent,id);this.event(id,'project.model_configured',settings);});
    return this.project(id)!;
  }
  projects():Project[]{return this.all<{id:string}>('SELECT id FROM projects ORDER BY created_at DESC').map(r=>this.project(r.id)!);}
  vendor(projectId:string,name:string):Vendor{if(!this.project(projectId))throw new Error('Project not found');const id=crypto.randomUUID();this.run('INSERT INTO vendors VALUES(?,?,?)',id,projectId,name);this.event(projectId,'vendor.created',{vendorId:id});return {id,projectId,name};}
  vendors(projectId:string):Vendor[]{return this.all<any>('SELECT * FROM vendors WHERE project_id=? ORDER BY rowid',projectId).map(r=>({id:r.id,projectId:r.project_id,name:r.name}));}
  assumptions(projectId:string):Assumption[]{
    const rows=this.all<any>(`SELECT a.* FROM assumptions a JOIN vendors v ON v.id=a.vendor_id WHERE v.project_id=? AND a.revision=(SELECT MAX(revision) FROM assumptions x WHERE x.id=a.id)`,projectId);
    return rows.map(r=>({...JSON.parse(r.term_json),id:r.id,vendorId:r.vendor_id,sourcePassageId:r.source_passage_id,status:r.status,revision:r.revision,provenance:r.provenance,documentVersionId:r.document_version_id}));
  }
  addAssumption(projectId:string,vendorId:string,term:Term,sourcePassageId:string|null,provenance:'document'|'user',status:'approved'|'ambiguous'='approved',claimId:string|null=null){
    if(!this.vendors(projectId).some(v=>v.id===vendorId))throw new Error('Vendor not in project');
    if(sourcePassageId){const p=this.one<any>('SELECT d.project_id,d.vendor_id,dv.id version_id FROM source_passages s JOIN document_versions dv ON dv.id=s.version_id JOIN documents d ON d.id=dv.document_id WHERE s.id=?',sourcePassageId);if(!p||p.project_id!==projectId||p.vendor_id!==vendorId)throw new Error('Source not in vendor project');}
    return this.transaction(()=>{
      const id=crypto.randomUUID();const versionId=sourcePassageId?this.one<any>('SELECT version_id FROM source_passages WHERE id=?',sourcePassageId)?.version_id:null;
      this.run('INSERT INTO assumptions VALUES(?,?,?,?,?,?,?,?,?)',id,1,vendorId,versionId,sourcePassageId,provenance,status,JSON.stringify(term),new Date().toISOString());
      if(claimId)this.run('INSERT INTO claim_assumptions VALUES(?,?,?)',claimId,id,1);
      this.event(projectId,'assumption.created',{assumptionId:id,sourcePassageId,status});
      if(status==='approved')this.publish(projectId);return id;
    });
  }
  reviseAssumption(projectId:string,id:string,term:Term,sourcePassageId:string|null,status:'approved'|'ambiguous'='approved',claimId:string|null=null){
    const old=this.assumptions(projectId).find(a=>a.id===id);if(!old)throw new Error('Assumption not found');
    let versionId:string|null=null;
    if(sourcePassageId){const source=this.one<any>('SELECT v.id version_id,d.project_id,d.vendor_id FROM source_passages s JOIN document_versions v ON v.id=s.version_id JOIN documents d ON d.id=v.document_id WHERE s.id=?',sourcePassageId);if(!source||source.project_id!==projectId||source.vendor_id!==old.vendorId)throw new Error('Source not in vendor project');versionId=source.version_id;}
    this.transaction(()=>{
      this.run('INSERT INTO assumptions VALUES(?,?,?,?,?,?,?,?,?)',id,old.revision+1,old.vendorId,versionId,sourcePassageId,sourcePassageId?'document':'user',status,JSON.stringify(term),new Date().toISOString());
      if(claimId)this.run('INSERT INTO claim_assumptions VALUES(?,?,?)',claimId,id,old.revision+1);
      this.event(projectId,'assumption.revised',{assumptionId:id,revision:old.revision+1,sourcePassageId,status});
      if(status==='approved')this.publish(projectId);
    });
  }
  publish(projectId:string){
    return this.transaction(()=>{
      const project=this.project(projectId);if(!project)throw new Error('Project not found');
      const inputs=this.assumptions(projectId);const result=evaluate(project,this.vendors(projectId),inputs);
      const id=crypto.randomUUID();const version=(this.one<any>('SELECT MAX(version_no) n FROM models WHERE project_id=?',projectId)?.n??0)+1;
      this.run('INSERT INTO models VALUES(?,?,?,?,?,?,?)',id,projectId,version,project.currentModelId,JSON.stringify(result),JSON.stringify(inputs),new Date().toISOString());
      for(const a of inputs.filter(a=>a.status==='approved')){
        this.run('INSERT INTO model_inputs VALUES(?,?,?)',id,a.id,a.revision);
        if(a.sourcePassageId){
          this.run('INSERT INTO dependency_edges VALUES(?,?,?,?,?,?)',crypto.randomUUID(),id,'document_version',a.documentVersionId,'source_passage',a.sourcePassageId);
          const claim=this.one<any>('SELECT claim_id FROM claim_assumptions WHERE assumption_id=? AND revision=? ORDER BY rowid DESC LIMIT 1',a.id,a.revision);
          if(claim){this.run('INSERT INTO dependency_edges VALUES(?,?,?,?,?,?)',crypto.randomUUID(),id,'source_passage',a.sourcePassageId,'claim',claim.claim_id);this.run('INSERT INTO dependency_edges VALUES(?,?,?,?,?,?)',crypto.randomUUID(),id,'claim',claim.claim_id,'assumption',a.id);}
          else this.run('INSERT INTO dependency_edges VALUES(?,?,?,?,?,?)',crypto.randomUUID(),id,'source_passage',a.sourcePassageId,'assumption',a.id);
        }
        this.run('INSERT INTO dependency_edges VALUES(?,?,?,?,?,?)',crypto.randomUUID(),id,'assumption',a.id,'formula',a.kind+':'+a.vendorId);
      }
      for(const vendor of result.vendors)for(let year=0;year<vendor.years.length;year++){
        this.run('INSERT INTO calculated_results VALUES(?,?,?,?,?,?)',crypto.randomUUID(),id,vendor.vendorId,year,'total',vendor.years[year]);
        this.run('INSERT INTO dependency_edges VALUES(?,?,?,?,?,?)',crypto.randomUUID(),id,'annual_result',vendor.vendorId+':'+year,'decision',id);
      }
      const extra=new Set<string>();
      for(const line of result.vendors.flatMap(v=>v.lines)){
        const formula=line.formulaKey+':'+line.vendorId,annual=line.vendorId+':'+line.year,key=`${formula}>${annual}`;
        if(!extra.has(key)){this.run('INSERT INTO dependency_edges VALUES(?,?,?,?,?,?)',crypto.randomUUID(),id,'formula',formula,'annual_result',annual);extra.add(key);}
        for(const inputId of line.assumptionIds){const input=inputs.find(a=>a.id===inputId);if(!input||`${input.kind}:${input.vendorId}`===formula)continue;const dependency=`${inputId}>${formula}`;if(!extra.has(dependency)){this.run('INSERT INTO dependency_edges VALUES(?,?,?,?,?,?)',crypto.randomUUID(),id,'assumption',inputId,'formula',formula);extra.add(dependency);}}
      }
      this.run('UPDATE projects SET current_model_id=? WHERE id=?',id,projectId);this.event(projectId,'model.published',{modelId:id,version});return this.model(id);
    });
  }
  model(id:string){const r=this.one<any>('SELECT * FROM models WHERE id=?',id);return r&&{id:r.id,projectId:r.project_id,version:r.version_no,parentId:r.parent_id,result:JSON.parse(r.result_json) as ModelResult,inputs:JSON.parse(r.inputs_json) as Assumption[],createdAt:r.created_at};}
  models(projectId:string){return this.all<any>('SELECT id FROM models WHERE project_id=? ORDER BY version_no DESC',projectId).map(r=>this.model(r.id));}
  close(){this.db.close();}
}
