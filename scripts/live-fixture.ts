import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

if(!process.env.BASETEN_API_KEY)throw new Error('Set BASETEN_API_KEY for the fictional live fixture');
process.env.NODE_ENV='test';
process.env.FDW_DB=`data/live-${randomUUID()}.sqlite`;
process.env.FDW_FILES=`data/live-files-${randomUUID()}`;

function pdf(text:string):Buffer{
  const body=`BT /F1 12 Tf 72 720 Td (${text.replace(/[\\()]/g,'\\$&')}) Tj ET`;
  const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',`<< /Length ${Buffer.byteLength(body)} >>\nstream\n${body}\nendstream`,'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  let out='%PDF-1.4\n';const positions=[0];for(let i=0;i<objects.length;i++){positions.push(Buffer.byteLength(out));out+=`${i+1} 0 obj\n${objects[i]}\nendobj\n`;}const xref=Buffer.byteLength(out);out+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`;for(const p of positions.slice(1))out+=`${String(p).padStart(10,'0')} 00000 n \n`;return Buffer.from(out+`trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`);
}

const {app,store}=await import('../src/server/index.js');
const server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));
const address=server.address();assert.ok(address&&typeof address==='object');const base=`http://127.0.0.1:${address.port}/api`;
async function request(path:string,method='GET',body?:object|Buffer){const response=await fetch(base+path,{method,headers:{'Content-Type':body instanceof Buffer?'application/pdf':'application/json'},body:body instanceof Buffer?body:body?JSON.stringify(body):undefined});const data=await response.json();if(!response.ok)throw new Error(JSON.stringify(data));return data;}
const term=(kind:string,value:string)=>({kind,value,currency:'CAD',unit:kind==='seat_monthly'?'CAD/seat/month':'CAD',startMonth:0,endMonth:null,note:''});
async function upload(projectId:string,vendorId:string,name:string,content:string,documentId?:string){const query=new URLSearchParams({vendorId,name});if(documentId)query.set('documentId',documentId);const document=await request(`/projects/${projectId}/documents?${query}`,'POST',pdf(content));assert.ok(document.jobId);let job;for(let i=0;i<60;i++){await new Promise(r=>setTimeout(r,2000));job=await request(`/jobs/${document.jobId}`);if(job.state==='complete'||job.state==='failed')break;}assert.equal(job?.state,'complete',job?.error??'Muse job did not complete');return document;}
async function approveExact(projectId:string,versionId:string,kind:string,value:string){const claims=await request(`/projects/${projectId}/claims`);const forVersion=claims.filter((c:any)=>c.version_id===versionId);console.log(JSON.stringify({versionId,claims:forVersion.map((c:any)=>({kind:c.term.kind,value:c.term.value,excerpt:c.raw_excerpt,ambiguity:c.ambiguity}))}));const claim=forVersion.find((c:any)=>c.term.kind===kind&&c.term.value===value);assert.ok(claim,`Muse did not extract ${kind} ${value}`);await request(`/claims/${claim.id}/review`,'POST',{action:'approve'});}
try{
  const project=await request('/projects','POST',{name:'Fictional CRM procurement',objective:'Compare fictional offers',currency:'CAD',years:5,seats:10,usage:0,growthPercent:0});
  const a=await request(`/projects/${project.id}/vendors`,'POST',{name:'Fictional A'}),b=await request(`/projects/${project.id}/vendors`,'POST',{name:'Fictional B'});
  const [ad,bd]=await Promise.all([upload(project.id,a.id,'a.pdf','Fictional A subscription: CAD 100 per seat per month.'),upload(project.id,b.id,'b.pdf','Fictional B subscription: CAD 95 per seat per month.')]);
  await approveExact(project.id,ad.versionId,'seat_monthly','100');await approveExact(project.id,bd.versionId,'seat_monthly','95');
  for(const [vendorId,implementation] of [[a.id,'1000'],[b.id,'5000']])for(const [kind,value] of [['implementation',implementation],['support_annual','0']])await request(`/projects/${project.id}/assumptions`,'POST',{vendorId,term:term(kind,value)});
  const before=await request(`/projects/${project.id}/model`);assert.equal(before.result.cheaperVendorId,a.id);
  const amendment=await upload(project.id,a.id,'amendment.pdf','Amendment to Fictional A: annual escalation 10 percent.',ad.documentId);await approveExact(project.id,amendment.versionId,'escalation_percent','10');
  const after=await request(`/projects/${project.id}/model`);assert.equal(after.result.cheaperVendorId,b.id);
  console.log(JSON.stringify({liveMuse:true,before:before.result.vendors.map((v:any)=>v.total),after:after.result.vendors.map((v:any)=>v.total),modelVersions:[before.version,after.version],database:process.env.FDW_DB}));
}finally{await new Promise<void>(r=>server.close(()=>r()));store.close();}
