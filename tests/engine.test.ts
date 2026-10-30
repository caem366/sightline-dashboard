import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Assumption, Project, Vendor } from '../src/shared/contracts.js';
import { bridge, evaluate, switchingDiscount } from '../src/server/finance/engine.js';
import { inspectWorkbook, makeWorkbook } from '../src/server/export/workbook.js';
import { parseDocument } from '../src/server/documents/parse.js';
import { detectFindings } from '../src/server/intelligence/inspect.js';

const project:Project={id:'p',name:'CRM',objective:'Compare',currency:'CAD',years:5,seats:10,usage:0,growthPercent:0,currentModelId:null,createdAt:'2026-01-01'};
const vendors:Vendor[]=[{id:'a',projectId:'p',name:'A'},{id:'b',projectId:'p',name:'B'}];
const a=(id:string,vendorId:string,kind:Assumption['kind'],value:string):Assumption=>({id,vendorId,kind,value,currency:'CAD',unit:'CAD',startMonth:0,endMonth:null,note:'',sourcePassageId:null,status:'approved',revision:1,provenance:'user',documentVersionId:null});
const inputs=[a('a-price','a','seat_monthly','100'),a('a-impl','a','implementation','1000'),a('a-support','a','support_annual','0'),a('b-price','b','seat_monthly','95'),a('b-impl','b','implementation','5000'),a('b-support','b','support_annual','0')];

test('five-year vendor ranking reverses after an approved escalation term',()=>{
  const baseline=evaluate(project,vendors,inputs);assert.equal(baseline.comparable,true);assert.equal(baseline.vendors[0].total,'61000.00');assert.equal(baseline.vendors[1].total,'62000.00');assert.equal(baseline.cheaperVendorId,'a');
  const revised=evaluate(project,vendors,[...inputs,a('escalation','a','escalation_percent','10')]);assert.equal(revised.cheaperVendorId,'b');assert.equal(revised.vendors[0].total,'74261.20');const delta=bridge(baseline,revised)[0];assert.equal(delta.delta,'13261.20');assert.equal(delta.annual.reduce((n,v)=>n+Number(v),0).toFixed(2),delta.delta);
});
test('missing cost and mixed currency prevent firm ranking',()=>{
  const missing=evaluate(project,vendors,inputs.filter(x=>x.id!=='b-impl'));assert.equal(missing.comparable,false);assert.match(missing.warnings.join(' '),/implementation cost is unknown/);
  const usd=evaluate(project,vendors,inputs.map(x=>x.id==='a-price'?{...x,currency:'USD'}:x));assert.equal(usd.comparable,false);assert.match(usd.warnings.join(' '),/currency conversion/);
});
test('benefit metrics require explicit annual benefit and discount rate',()=>{
  const oneYear={...project,years:1};
  const base=evaluate(oneYear,[vendors[0]],inputs);assert.equal(base.vendors[0].decisionMetrics,undefined);
  const withBenefit=[...inputs,a('benefit','a','benefit_annual','20000')];
  assert.equal(evaluate(oneYear,[vendors[0]],withBenefit).vendors[0].decisionMetrics,undefined);
  const actual=evaluate(oneYear,[vendors[0]],[...withBenefit,a('rate','a','discount_rate','10')]).vendors[0].decisionMetrics;
  assert.deepEqual(actual,{annualBenefits:['20000.00'],roiPercent:'53.85',npv:'6363.64',paybackYear:1});
});
test('anomaly detection labels a large annual change as a candidate',()=>{
  const p={...project,years:2};const terms=[a('price','a','seat_monthly','100'),a('implementation','a','implementation','0'),a('support','a','support_annual','0'),a('escalation','a','escalation_percent','30')];
  const findings=detectFindings(evaluate(p,[vendors[0]],terms));
  assert.ok(findings.some(f=>f.rule==='annual_change_over_25_percent'&&f.status==='candidate'&&f.evidenceIds.includes('annual:a:1')));
});
test('duplicate fees and overlapping rates are flagged rather than silently accepted',()=>{
  const duplicate=evaluate(project,vendors,[...inputs,a('a-impl-again','a','implementation','1000')]);assert.equal(duplicate.comparable,false);assert.match(duplicate.warnings.join(' '),/possible duplicate/);
  const conflict=evaluate(project,vendors,[...inputs,a('a-other-price','a','seat_monthly','110')]);assert.equal(conflict.comparable,false);assert.match(conflict.warnings.join(' '),/conflicting overlapping/);
});
test('tier boundary, minimum floor, scenario immutability and exact cents',()=>{
  const tier:Assumption={...a('tier','a','tier_monthly','0'),tiers:[{upTo:10,price:'10.01'},{upTo:null,price:'9.99'}],tierMode:'graduated'};
  const list=[tier,a('impl','a','implementation','0'),a('support','a','support_annual','0')];
  const p={...project,years:1,seats:11};const baseline=evaluate(p,[vendors[0]],list);assert.equal(baseline.vendors[0].total,'1321.08');
  const scenario=evaluate(p,[vendors[0]],list,{seats:10,overrides:{}});assert.equal(scenario.vendors[0].total,'1201.20');assert.equal(evaluate(p,[vendors[0]],list).vendors[0].total,baseline.vendors[0].total);
  const floor=evaluate({...p,seats:0},[vendors[0]],[...list,a('min','a','minimum_annual','500')]);assert.equal(floor.vendors[0].total,'500.00');
});
test('mid-contract escalation begins at its effective anniversary and respects a cap',()=>{
  const escalation={...a('mid','a','escalation_percent','10'),startMonth:24,capPercent:'5'};
  const out=evaluate(project,[vendors[0]],[...inputs.filter(x=>x.vendorId==='a'),escalation]);
  assert.deepEqual(out.vendors[0].years,['13000.00','12000.00','12000.00','12600.00','13230.00']);
  assert.equal(out.vendors[0].total,'62830.00');
});
test('switching discount is found by recomputing the model',()=>{
  const threshold=switchingDiscount(project,vendors,inputs,'b');assert.equal(threshold?.totalDiscountPercent,'1.76');
  const bWithDiscount={...a('discount','b','discount_percent',threshold!.totalDiscountPercent)};
  assert.equal(evaluate(project,vendors,[...inputs,bWithDiscount]).cheaperVendorId,'b');
  assert.equal(evaluate(project,vendors,[...inputs,{...bWithDiscount,value:'1.75'}]).cheaperVendorId,'a');
});
test('workbook contains editable inputs, formulas and matching cached server totals',async()=>{
  const result=evaluate(project,vendors,inputs);const bytes=makeWorkbook(project,vendors,inputs,result);const info=inspectWorkbook(bytes);assert.equal(info.sheets.length,6);assert.ok(info.formulaCount>100);assert.match(info.comparison,/61000\.00/);assert.match(info.comparison,/62000\.00/);
  const passages=await parseDocument(bytes,'model.xlsx');assert.ok(passages.some(p=>p.text.includes('61000.00')));
});
