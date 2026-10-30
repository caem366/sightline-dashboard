import { Decimal } from 'decimal.js';
import type { Assumption, ModelResult, Project, ResultLine, Scenario, Vendor, VendorResult } from '../../shared/contracts.js';

Decimal.set({precision:32, rounding:Decimal.ROUND_HALF_UP});
const zero = new Decimal(0);
const money=(v:Decimal)=>v.toDecimalPlaces(2,Decimal.ROUND_HALF_UP);
const str=(v:Decimal)=>money(v).toFixed(2);
const d=(v:string|number)=>new Decimal(v);
const active=(a:Assumption,m:number)=>m>=a.startMonth && (a.endMonth===null || m<a.endMonth);
const category=(kind:string)=>kind.startsWith('seat')||kind==='tier_monthly'||kind==='usage_monthly'?'license':kind.startsWith('support')?'support':kind==='implementation'||kind==='migration'?kind:kind==='one_time'?'other':kind==='fixed_monthly'||kind==='fixed_annual'?'other':kind;

export function evaluate(project:Project,vendors:Vendor[],all:Assumption[],scenario:Scenario={overrides:{}}):ModelResult {
  const approved=all.filter(a=>a.status==='approved');
  const warnings:string[]=[];
  const required=['license','implementation','support'];
  const results:VendorResult[]=[];
  for(const vendor of vendors){
    const terms=approved.filter(a=>a.vendorId===vendor.id);
    for(const c of required) if(!terms.some(a=>category(a.kind)===c)) warnings.push(`${vendor.name}: ${c} cost is unknown`);
    if(terms.some(a=>a.currency!==project.currency)) warnings.push(`${vendor.name}: currency conversion requires an approved rate`);
    if(all.some(a=>a.vendorId===vendor.id && a.status==='ambiguous')) warnings.push(`${vendor.name}: unresolved material term`);
    for(let i=0;i<terms.length;i++)for(let j=i+1;j<terms.length;j++){
      const x=terms[i],y=terms[j];
      if(x.kind===y.kind&&x.startMonth===y.startMonth&&x.endMonth===y.endMonth&&x.value===y.value&&x.value!=='0')warnings.push(`${vendor.name}: possible duplicate ${x.kind} fee requires review`);
      if(x.kind===y.kind&&['seat_monthly','seat_annual','escalation_percent'].includes(x.kind)&&x.value!==y.value&&x.startMonth<(y.endMonth??Infinity)&&y.startMonth<(x.endMonth??Infinity))warnings.push(`${vendor.name}: conflicting overlapping ${x.kind} terms require review`);
    }
    const lines:ResultLine[]=[];
    const years=Array.from({length:project.years},()=>zero);
    const totals:Record<string,Decimal>={};
    for(let m=0;m<project.years*12;m++){
      const y=Math.floor(m/12);
      const seats=d(scenario.seats??project.seats).mul(d(1).plus(d(scenario.growthPercent??project.growthPercent).div(100)).pow(y)).toDecimalPlaces(0,Decimal.ROUND_HALF_UP);
      const usage=d(scenario.usage??project.usage);
      const current=terms.filter(a=>active(a,m) && a.currency===project.currency);
      const escalations=current.filter(a=>a.kind==='escalation_percent');
      if(escalations.length>1)warnings.push(`${vendor.name}: overlapping escalation terms require review`);
      const discount=current.filter(a=>a.kind==='discount_percent').reduce((v,a)=>v.plus(d(scenario.overrides[a.id]??a.value)),zero).div(100);
      const tax=current.filter(a=>a.kind==='tax_percent').reduce((v,a)=>v.plus(d(scenario.overrides[a.id]??a.value)),zero).div(100);
      if(discount.greaterThan(1)) warnings.push(`${vendor.name}: combined discount exceeds 100%`);
      const factor=escalations.length?escalations.map(a=>d(1).plus(Decimal.min(d(scenario.overrides[a.id]??a.value),a.capPercent?d(a.capPercent):d(scenario.overrides[a.id]??a.value)).div(100)).pow(Math.max(0,y-Math.floor(a.startMonth/12)))).reduce((v,n)=>Decimal.max(v,n),d(1)):d(1);
      let license=zero;
      const monthLines:{a:Assumption; amount:Decimal}[]=[];
      for(const a of current){
        const value=d(scenario.overrides[a.id]??a.value);
        let amount=zero;
        switch(a.kind){
          case 'seat_monthly': amount=value.mul(seats).mul(factor);break;
          case 'seat_annual': if(m%12===0) amount=value.mul(seats).mul(factor);break;
          case 'usage_monthly': amount=value.mul(usage).mul(factor);break;
          case 'tier_monthly': {
            const tiers=a.tiers??[]; let previous=zero; let remaining=seats;
            for(const tier of tiers){
              const upper=tier.upTo===null?seats:d(tier.upTo);
              if(a.tierMode==='volume') {if(seats.lessThanOrEqualTo(upper)||tier.upTo===null){amount=seats.mul(d(tier.price)).mul(factor);break;}}
              else {const count=Decimal.max(zero,Decimal.min(remaining,upper.minus(previous)));amount=amount.plus(count.mul(d(tier.price)).mul(factor));remaining=remaining.minus(count);previous=upper;}
            }
            if(a.tierMode==='graduated' && remaining.greaterThan(0)) warnings.push(`${vendor.name}: tier table does not cover ${seats} seats`);
            break;
          }
          case 'fixed_monthly': case 'support_monthly': amount=value.mul(factor);break;
          case 'fixed_annual': case 'support_annual': if(m%12===0) amount=value.mul(factor);break;
          case 'one_time': case 'implementation': case 'migration': if(m===a.startMonth) amount=value;break;
        }
        if(['seat_monthly','seat_annual','usage_monthly','tier_monthly'].includes(a.kind)) license=license.plus(amount);
        else if(!amount.isZero()) monthLines.push({a,amount});
      }
      license=money(license.mul(Decimal.max(zero,d(1).minus(discount))));
      if(!license.isZero()) monthLines.push({a:current.find(a=>['seat_monthly','seat_annual','usage_monthly','tier_monthly'].includes(a.kind))!,amount:license});
      if(m%12===11){const minimum=current.find(a=>a.kind==='minimum_annual');if(minimum){const yearLicense=lines.filter(l=>l.year===y && l.category==='license').reduce((v,l)=>v.plus(d(l.amount)),license);const gap=money(Decimal.max(zero,d(scenario.overrides[minimum.id]??minimum.value).minus(yearLicense)));if(gap.greaterThan(0))monthLines.push({a:minimum,amount:gap});}}
      const taxable=monthLines.reduce((v,l)=>v.plus(l.amount),zero);
      if(tax.greaterThan(0))monthLines.push({a:current.find(a=>a.kind==='tax_percent')!,amount:money(taxable.mul(tax))});
      for(const {a,amount} of monthLines){
        const rounded=money(amount);const cat=category(a.kind);
        const related=cat==='license'?current.filter(t=>['seat_monthly','seat_annual','usage_monthly','tier_monthly','discount_percent','escalation_percent'].includes(t.kind))
          :cat==='minimum_annual'?current.filter(t=>['minimum_annual','seat_monthly','seat_annual','usage_monthly','tier_monthly','discount_percent','escalation_percent'].includes(t.kind))
          :cat==='tax_percent'?current.filter(t=>t.kind!=='benefit_annual'&&t.kind!=='discount_rate')
          :current.filter(t=>t.id===a.id||t.kind==='escalation_percent');
        const line={vendorId:vendor.id,month:m,year:y,category:cat,amount:str(rounded),formulaKey:a.kind,assumptionIds:[...new Set(related.map(t=>t.id))]};
        lines.push(line);years[y]=years[y].plus(rounded);totals[cat]=(totals[cat]??zero).plus(rounded);
      }
    }
    const totalCost=years.reduce((a,b)=>a.plus(b),zero);
    const rateTerms=terms.filter(a=>a.kind==='discount_rate');
    const benefits=years.map((_,y)=>terms.filter(a=>a.kind==='benefit_annual'&&active(a,y*12)&&a.currency===project.currency));
    let decisionMetrics:VendorResult['decisionMetrics'];
    if(rateTerms.length===1&&benefits.every(b=>b.length===1)&&totalCost.greaterThan(0)){
      const rate=d(scenario.overrides[rateTerms[0].id]??rateTerms[0].value).div(100);
      const annualBenefits=benefits.map(b=>d(scenario.overrides[b[0].id]??b[0].value));
      const sumBenefits=annualBenefits.reduce((n,v)=>n.plus(v),zero);
      const npv=annualBenefits.reduce((n,v,y)=>n.plus(v.minus(years[y]).div(d(1).plus(rate).pow(y+1))),zero);
      let cumulative=zero,paybackYear:number|null=null;
      annualBenefits.forEach((v,y)=>{cumulative=cumulative.plus(v).minus(years[y]);if(paybackYear===null&&cumulative.greaterThanOrEqualTo(0))paybackYear=y+1;});
      decisionMetrics={annualBenefits:annualBenefits.map(str),roiPercent:sumBenefits.minus(totalCost).div(totalCost).mul(100).toFixed(2),npv:str(npv),paybackYear};
    }
    results.push({vendorId:vendor.id,years:years.map(str),total:str(totalCost),categories:Object.fromEntries(Object.entries(totals).map(([k,v])=>[k,str(v)])),lines,decisionMetrics});
  }
  const comparable=warnings.length===0 && results.length>=2;
  const sorted=[...results].sort((a,b)=>d(a.total).comparedTo(d(b.total)));
  const difference=sorted.length>=2?str(d(sorted[1].total).minus(d(sorted[0].total))):null;
  return {vendors:results,currency:project.currency,warnings:[...new Set(warnings)],comparable,cheaperVendorId:comparable?sorted[0].vendorId:null,difference:comparable?difference:null,switchingValue:comparable?difference:null};
}

export function bridge(before:ModelResult,after:ModelResult){
  return after.vendors.map(next=>{const prev=before.vendors.find(v=>v.vendorId===next.vendorId);return {vendorId:next.vendorId,before:prev?.total??'0.00',after:next.total,delta:str(d(next.total).minus(d(prev?.total??0))),annual:next.years.map((v,i)=>str(d(v).minus(d(prev?.years[i]??0))))};});
}

export function switchingDiscount(project:Project,vendors:Vendor[],inputs:Assumption[],vendorId:string){
  const baseline=evaluate(project,vendors,inputs);if(!baseline.comparable||!vendors.some(v=>v.id===vendorId))return null;
  const existing=inputs.find(a=>a.vendorId===vendorId&&a.kind==='discount_percent'&&a.status==='approved');
  const current=existing?d(existing.value):zero;
  const terms:Assumption[]=existing?inputs:[...inputs,{id:'switching-discount',vendorId,kind:'discount_percent',value:'0',currency:project.currency,unit:'percent',startMonth:0,endMonth:null,note:'scenario only',sourcePassageId:null,status:'approved',revision:1,provenance:'user',documentVersionId:null}];
  const target=existing?.id??'switching-discount';
  const wins=(basisPoints:number)=>{const outcome=evaluate(project,vendors,terms,{overrides:{[target]:d(basisPoints).div(100).toString()}});const cost=d(outcome.vendors.find(v=>v.vendorId===vendorId)!.total);return outcome.vendors.every(v=>v.vendorId===vendorId||cost.lessThanOrEqualTo(d(v.total)));};
  if(wins(Number(current.mul(100).toFixed(0))))return {totalDiscountPercent:current.toFixed(2),additionalDiscountPercent:'0.00'};
  if(!wins(10000))return null;
  let low=Math.min(10000,Math.max(0,Number(current.mul(100).toFixed(0)))),high=10000;
  while(low<high){const mid=Math.floor((low+high)/2);if(wins(mid))high=mid;else low=mid+1;}
  const total=d(low).div(100);return {totalDiscountPercent:total.toFixed(2),additionalDiscountPercent:total.minus(current).toFixed(2)};
}
