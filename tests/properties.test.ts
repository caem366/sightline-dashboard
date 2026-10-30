import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import type { Assumption, Project, Vendor } from '../src/shared/contracts.js';
import { evaluate } from '../src/server/finance/engine.js';

const project:Project={id:'p',name:'Property case',objective:'',currency:'CAD',years:1,seats:0,usage:0,growthPercent:0,currentModelId:null,createdAt:'2026-01-01'};
const vendor:Vendor={id:'v',projectId:'p',name:'Vendor'};
const assumption=(id:string,kind:Assumption['kind'],cents:number):Assumption=>({id,vendorId:'v',kind,value:(cents/100).toFixed(2),currency:'CAD',unit:'CAD',startMonth:0,endMonth:null,note:'',status:'approved',revision:1,provenance:'user',sourcePassageId:null,documentVersionId:null});

test('per-seat monthly cost plus one-time fee reconciles to an independent integer-cent oracle',()=>{
  fc.assert(fc.property(fc.integer({min:0,max:1000}),fc.integer({min:0,max:20000}),fc.integer({min:0,max:1_000_000}),(seats,priceCents,feeCents)=>{
    const inputs=[assumption('price','seat_monthly',priceCents),assumption('fee','implementation',feeCents),assumption('support','support_annual',0)];
    const out=evaluate({...project,seats},[vendor],inputs).vendors[0];
    const expected=(seats*priceCents*12+feeCents)/100;
    assert.equal(Number(out.total),expected);
    assert.equal(out.years.reduce((n,v)=>n+Number(v),0),expected);
    assert.equal(evaluate({...project,seats},[vendor],[...inputs].reverse()).vendors[0].total,out.total);
  }),{numRuns:100});
});
