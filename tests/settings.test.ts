import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';

test('project creation stays simple and model baseline locks after publication',async()=>{
  process.env.NODE_ENV='test';process.env.FDW_DB=`data/settings-${randomUUID()}.sqlite`;process.env.FDW_FILES=`data/settings-files-${randomUUID()}`;
  const {app,store}=await import('../src/server/index.js');
  const server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));
  const address=server.address();assert.ok(address&&typeof address==='object');const base=`http://127.0.0.1:${address.port}/api`;
  const request=async(path:string,method:string,body:object)=>{const response=await fetch(base+path,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:response.status,data:await response.json()};};
  try{
    const created=await request('/projects','POST',{name:'Fictional review',objective:'Compare costs'});assert.equal(created.status,201);assert.equal(created.data.seats,100);
    const id=created.data.id;
    const configured=await request(`/projects/${id}/settings`,'PATCH',{currency:'CAD',years:3,seats:42,usage:300,growthPercent:5});assert.equal(configured.status,200);assert.equal(configured.data.seats,42);
    const vendor=await request(`/projects/${id}/vendors`,'POST',{name:'Example vendor'});assert.equal(vendor.status,201);
    const term={kind:'seat_monthly',value:'10',currency:'CAD',unit:'CAD/seat/month',startMonth:0,endMonth:null,note:''};
    const assumption=await request(`/projects/${id}/assumptions`,'POST',{vendorId:vendor.data.id,term});assert.equal(assumption.status,201);
    const model=store.model(store.project(id)!.currentModelId!);assert.ok(model);assert.equal(model.result.vendors[0].years[0],'5040.00');
    const locked=await request(`/projects/${id}/settings`,'PATCH',{currency:'CAD',years:3,seats:43,usage:300,growthPercent:5});assert.equal(locked.status,400);assert.match(locked.data.error,/locked/);assert.equal(store.project(id)?.seats,42);
  }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));store.close();}
});
