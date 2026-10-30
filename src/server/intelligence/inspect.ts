import { Decimal } from 'decimal.js';
import type { Store } from '../db.js';
import type { Assumption, ModelResult, Project, Vendor } from '../../shared/contracts.js';

export type InspectionModel={id:string;projectId:string;version:number;parentId:string|null;createdAt:string;inputs:Assumption[];result:ModelResult};
const money=(value:Decimal)=>value.toDecimalPlaces(2,Decimal.ROUND_HALF_UP).toFixed(2);
export type Finding={id:string;status:'candidate';rule:string;observation:string;evidenceIds:string[]};
const ruleDescription=(category:string)=>({license:'Active seat, usage, and tier charges after escalation and discount; rounded monthly.',support:'Active support charge after escalation; annual charges post in their contract month.',implementation:'One-time implementation charge in its effective month.',migration:'One-time migration charge in its effective month.',minimum_annual:'Positive gap between the annual license minimum and license charges already posted.',tax_percent:'Tax rate applied to the current month taxable charges after their pricing adjustments.'} as Record<string,string>)[category]??'Active contract charge after any applicable escalation; rounded to cents.';

export function inspectModel(store:Store,project:Project,model:InspectionModel,vendors:Vendor[]){
  const sources=model.inputs.filter(a=>a.sourcePassageId).map(a=>{
    const p=store.one<any>('SELECT s.id,s.version_id,d.name,s.location,s.text FROM source_passages s JOIN document_versions v ON v.id=s.version_id JOIN documents d ON d.id=v.document_id WHERE s.id=?',a.sourcePassageId);
    return p&&{id:p.id,versionId:p.version_id,documentName:p.name,location:p.location,excerpt:p.text.slice(0,240)};
  }).filter(Boolean);
  const edges=store.all<any>('SELECT from_type fromType,from_id fromId,to_type toType,to_id toId FROM dependency_edges WHERE model_id=? LIMIT 3001',model.id);
  const scenarios=store.all<any>('SELECT id,name,overrides_json overrides,result_json result FROM scenarios WHERE base_model_id=? ORDER BY rowid DESC LIMIT 50',model.id).map(s=>({id:s.id,name:s.name,overrides:JSON.parse(s.overrides),result:JSON.parse(s.result) as ModelResult}));
  return {model:{id:model.id,version:model.version,createdAt:model.createdAt,parentId:model.parentId,projectId:project.id,currency:project.currency,years:project.years,objective:project.objective},vendors:vendors.map(v=>({id:v.id,name:v.name,years:model.result.vendors.find(r=>r.vendorId===v.id)?.years??[],total:model.result.vendors.find(r=>r.vendorId===v.id)?.total??null})),assumptions:model.inputs.filter(a=>a.status==='approved').map(a=>({id:a.id,revision:a.revision,vendorId:a.vendorId,kind:a.kind,value:a.value,unit:a.unit,startMonth:a.startMonth,endMonth:a.endMonth,sourcePassageId:a.sourcePassageId,documentVersionId:a.documentVersionId})),formulas:[...new Set(model.result.vendors.flatMap(v=>v.lines.map(l=>`${l.formulaKey}:${l.vendorId}`)))].map(id=>({id,rule:id.split(':')[0],vendorId:id.split(':')[1]})),dependencies:edges.slice(0,3000),dependenciesTruncated:edges.length>3000,results:{comparable:model.result.comparable,cheaperVendorId:model.result.cheaperVendorId,difference:model.result.difference,warnings:model.result.warnings},sources,scenarios:scenarios.map(s=>({id:s.id,name:s.name,overrides:s.overrides,totals:s.result.vendors.map(v=>({vendorId:v.vendorId,total:v.total}))})),findings:detectFindings(model.result)};
}

export function explainResult(store:Store,project:Project,model:InspectionModel,vendors:Vendor[],vendorId:string,year:number){
  if(!Number.isInteger(year)||year<0||year>=project.years)throw new Error('Year outside model horizon');
  const vendor=vendors.find(v=>v.id===vendorId),result=model.result.vendors.find(v=>v.vendorId===vendorId);if(!vendor||!result)throw new Error('Vendor not in model');
  const lines=result.lines.filter(l=>l.year===year);const sum=money(lines.reduce((n,l)=>n.plus(l.amount),new Decimal(0)));
  if(sum!==result.years[year])throw new Error('Stored model lines do not reconcile');
  const ids=[...new Set(lines.flatMap(l=>l.assumptionIds))];const assumptions=model.inputs.filter(a=>ids.includes(a.id)).map(a=>{
    const source=a.sourcePassageId?store.one<any>('SELECT s.id,s.version_id,d.name,s.location,s.text FROM source_passages s JOIN document_versions v ON v.id=s.version_id JOIN documents d ON d.id=v.document_id WHERE s.id=?',a.sourcePassageId):null;
    return {id:a.id,revision:a.revision,kind:a.kind,value:a.value,unit:a.unit,source:source?{id:source.id,versionId:source.version_id,documentName:source.name,location:source.location,excerpt:source.text.slice(0,240)}:null};
  });
  return {modelId:model.id,modelVersion:model.version,vendorId,vendorName:vendor.name,year:year+1,currency:project.currency,resultId:`annual:${vendorId}:${year}`,total:sum,lines:lines.map((l,i)=>({id:`line:${vendorId}:${year}:${i}`,month:l.month+1,category:l.category,amount:l.amount,formulaKey:l.formulaKey,rule:ruleDescription(l.category),assumptionIds:l.assumptionIds})),assumptions,relationship:'mathematical_dependency' as const};
}

export function detectFindings(result:ModelResult):Finding[]{
  const findings:Finding[]=result.warnings.map((warning,i)=>({id:`warning:${i}`,status:'candidate',rule:'model_validation',observation:warning,evidenceIds:[`warning:${i}`]}));
  for(const vendor of result.vendors)for(let y=1;y<vendor.years.length;y++){
    const before=new Decimal(vendor.years[y-1]),after=new Decimal(vendor.years[y]);
    if(before.greaterThan(0)&&after.minus(before).abs().div(before).greaterThan('0.25'))findings.push({id:`trend:${vendor.vendorId}:${y}`,status:'candidate',rule:'annual_change_over_25_percent',observation:`Year ${y+1} outlay changed ${after.minus(before).div(before).mul(100).toDecimalPlaces(1).toFixed(1)}% from year ${y}. Review contract timing, growth, fees, and escalation; this is not a confirmed error.`,evidenceIds:[`annual:${vendor.vendorId}:${y-1}`,`annual:${vendor.vendorId}:${y}`]});
  }
  return findings;
}
