import { zipSync, strToU8, unzipSync } from 'fflate';
import type { Assumption, ModelResult, Project, Vendor } from '../../shared/contracts.js';

const esc=(s:unknown)=>String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const col=(n:number)=>{let s='';for(n++;n;n=Math.floor((n-1)/26))s=String.fromCharCode(65+(n-1)%26)+s;return s;};
type Cell={value:string|number;formula?:string;cached?:string|number};
type Rows=Cell[][];
export type SourceReference={passageId:string;versionId:string;documentName:string;location:string;text:string};
export type ScenarioExport={name:string;result:ModelResult};
const cell=(v:string|number):Cell=>({value:v});
const fcell=(formula:string,cached:string|number):Cell=>({value:cached,formula,cached});
function sheet(rows:Rows){
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows.map((row,ri)=>`<row r="${ri+1}">${row.map((c,ci)=>{const r=col(ci)+(ri+1);if(c.formula)return `<c r="${r}"><f>${esc(c.formula)}</f><v>${esc(c.cached)}</v></c>`;return typeof c.value==='number'?`<c r="${r}"><v>${c.value}</v></c>`:`<c r="${r}" t="inlineStr"><is><t>${esc(c.value)}</t></is></c>`;}).join('')}</row>`).join('')}</sheetData></worksheet>`;
}
const workbookXml=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Inputs" sheetId="1" r:id="rId1"/><sheet name="Monthly" sheetId="2" r:id="rId2"/><sheet name="Annual Costs" sheetId="3" r:id="rId3"/><sheet name="Comparison" sheetId="4" r:id="rId4"/><sheet name="Scenarios" sheetId="5" r:id="rId5"/><sheet name="Sources" sheetId="6" r:id="rId6"/></sheets><calcPr calcId="0" fullCalcOnLoad="1"/></workbook>`;
const relationships=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${Array.from({length:6},(_,i)=>`<Relationship Id="rId${i+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i+1}.xml"/>`).join('')}</Relationships>`;
const contentTypes=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${Array.from({length:6},(_,i)=>`<Override PartName="/xl/worksheets/sheet${i+1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`;
const rootRels=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;

export function makeWorkbook(project:Project,vendors:Vendor[],inputs:Assumption[],result:ModelResult,sources:SourceReference[]=[],scenarios:ScenarioExport[]=[]):Buffer{
  const sourceMap=new Map(sources.map(s=>[s.passageId,s]));
  const inputRows:Rows=[['Driver','Value','Unit','Vendor','Source passage','Assumption ID'].map(cell),['Seats',project.seats,'seats','','',''].map(cell),['Monthly usage',project.usage,'units','','',''].map(cell),['Annual growth %',project.growthPercent,'percent','','',''].map(cell)];
  const refs=new Map<string,string>();const tierRefs=new Map<string,{upper:string;price:string}[]>();const capRefs=new Map<string,string>();
  for(const a of inputs.filter(a=>a.status==='approved')){
    const row=inputRows.length+1;refs.set(a.id,`Inputs!$B$${row}`);
    const source=a.sourcePassageId?sourceMap.get(a.sourcePassageId):null;
    inputRows.push([a.kind,Number(a.value),a.unit,vendors.find(v=>v.id===a.vendorId)?.name??'',source?`${source.documentName} · ${source.location}`:a.sourcePassageId??'user input',a.id].map(cell));
    if(a.tiers?.length){const tr:{upper:string;price:string}[]=[];for(const t of a.tiers){const n=inputRows.length+1;tr.push({upper:`Inputs!$B$${n}`,price:`Inputs!$C$${n}`});inputRows.push([`${a.kind} tier`,t.upTo??1_000_000,Number(t.price),a.vendorId,a.sourcePassageId??'',a.id].map(cell));}tierRefs.set(a.id,tr);}
    if(a.capPercent){const n=inputRows.length+1;capRefs.set(a.id,`Inputs!$B$${n}`);inputRows.push([`${a.kind} cap`,Number(a.capPercent),'percent',a.vendorId,a.sourcePassageId??'',a.id].map(cell));}
  }
  const sourceRows:Rows=[['Assumption ID','Vendor','Kind','Source file','Location','Exact passage','Document version','Status'].map(cell),...inputs.map(a=>{const s=a.sourcePassageId?sourceMap.get(a.sourcePassageId):null;return [a.id,vendors.find(v=>v.id===a.vendorId)?.name??'',a.kind,s?.documentName??'user input',s?.location??'',s?.text??'',s?.versionId??'',a.status].map(cell);})];
  const monthly:Rows=[['Vendor','Year','Month','Seats','Usage','License','Other','Minimum','Tax','Total'].map(cell)];
  const annual:Rows=[['Vendor','Year','Total','License','Other','Minimum','Tax'].map(cell)];
  const compare:Rows=[['Vendor','Five-year TCO','Currency','Model status'].map(cell)];
  const scenarioRows:Rows=[['Scenario','Vendor','Baseline TCO','Scenario TCO','Delta'].map(cell)];
  const assumed=inputs.filter(a=>a.status==='approved');
  for(const vendor of vendors){
    const vr=result.vendors.find(v=>v.vendorId===vendor.id);if(!vr)continue;
    const terms=assumed.filter(a=>a.vendorId===vendor.id);
    for(let m=0;m<project.years*12;m++){
      const y=Math.floor(m/12),row=monthly.length+1;
      const active=terms.filter(a=>a.startMonth<=m&&(a.endMonth===null||m<a.endMonth));
      const matching=(k:string)=>active.filter(a=>a.kind===k);
      const value=(a:Assumption)=>refs.get(a.id)!;
      const seats=`D${row}`,usage=`E${row}`;
      const escalation=matching('escalation_percent').map(a=>`POWER(1+MIN(${value(a)},${capRefs.get(a.id)??value(a)})/100,MAX(0,B${row}-1-${Math.floor(a.startMonth/12)}))`).join(',');const factor=escalation?`MAX(${escalation})`:'1';
      const licenseExpressions:string[]=[];
      for(const a of active){const v=value(a);switch(a.kind){
        case 'seat_monthly':licenseExpressions.push(`${v}*${seats}*${factor}`);break;
        case 'seat_annual':if(m%12===0)licenseExpressions.push(`${v}*${seats}*${factor}`);break;
        case 'usage_monthly':licenseExpressions.push(`${v}*${usage}*${factor}`);break;
        case 'tier_monthly':{
          const tiers=tierRefs.get(a.id)??[];
          if(a.tierMode==='volume')licenseExpressions.push(`(${tiers.map((t,i)=>`IF(${seats}<=${t.upper},${seats}*${t.price},${i===tiers.length-1?`${seats}*${t.price}`:''}`).join('')}${')'.repeat(tiers.length)})*${factor}`);
          else licenseExpressions.push(`(${tiers.map((t,i)=>`MAX(0,MIN(${seats},${t.upper})-${i?tiers[i-1].upper:'0'})*${t.price}`).join('+')})*${factor}`);
          break;
        }
      }}
      const discount=matching('discount_percent').map(value).join('+');const licenseFormula=`ROUND((${licenseExpressions.join('+')||'0'})*MAX(0,1-(${discount||'0'})/100),2)`;
      const others=active.flatMap(a=>{const v=value(a);switch(a.kind){case 'fixed_monthly':case 'support_monthly':return [`ROUND(${v}*${factor},2)`];case 'fixed_annual':case 'support_annual':return m%12===0?[`ROUND(${v}*${factor},2)`]:[];case 'one_time':case 'implementation':case 'migration':return m===a.startMonth?[`ROUND(${v},2)`]:[];default:return [];}});
      const otherFormula=others.join('+')||'0';const minimum=matching('minimum_annual')[0];
      const minimumFormula=m%12===11&&minimum?`MAX(0,${value(minimum)}-SUM(F${row-11}:F${row}))`:'0';
      const tax=matching('tax_percent').map(value).join('+');const taxFormula=tax?`ROUND((F${row}+G${row}+H${row})*(${tax})/100,2)`:'0';
      const lines=vr.lines.filter(l=>l.month===m);const sum=(cats:string[])=>lines.filter(l=>cats.includes(l.category)).reduce((n,l)=>n+Number(l.amount),0);
      const lc=sum(['license']),min=sum(['minimum_annual']),tx=sum(['tax_percent']);const oth=sum(['support','implementation','migration','other']);const total=Number((lc+min+tx+oth).toFixed(2));
      monthly.push([cell(vendor.name),cell(y+1),cell(m+1),fcell(`ROUND(Inputs!$B$2*(1+Inputs!$B$4/100)^(B${row}-1),0)`,Number(project.seats*Math.pow(1+project.growthPercent/100,y)).toFixed(0)),fcell('Inputs!$B$3',project.usage),fcell(licenseFormula,lc.toFixed(2)),fcell(otherFormula,oth.toFixed(2)),fcell(minimumFormula,min.toFixed(2)),fcell(taxFormula,tx.toFixed(2)),fcell(`SUM(F${row}:I${row})`,total.toFixed(2))]);
    }
    for(let y=0;y<project.years;y++){
      const start=2+vendors.indexOf(vendor)*project.years*12+y*12,end=start+11;
      const yearLines=vr.lines.filter(l=>l.year===y);const sum=(cats:string[])=>yearLines.filter(l=>cats.includes(l.category)).reduce((n,l)=>n+Number(l.amount),0);
      annual.push([cell(vendor.name),cell(y+1),fcell(`SUM(Monthly!J${start}:J${end})`,vr.years[y]),fcell(`SUM(Monthly!F${start}:F${end})`,sum(['license']).toFixed(2)),fcell(`SUM(Monthly!G${start}:G${end})`,sum(['support','implementation','migration','other']).toFixed(2)),fcell(`SUM(Monthly!H${start}:H${end})`,sum(['minimum_annual']).toFixed(2)),fcell(`SUM(Monthly!I${start}:I${end})`,sum(['tax_percent']).toFixed(2))]);
    }
    const first=annual.length-project.years+1,last=annual.length;
    compare.push([cell(vendor.name),fcell(`SUM('Annual Costs'!C${first}:C${last})`,vr.total),cell(project.currency),cell(result.comparable?'comparable':'provisional')]);
  }
  for(const s of scenarios)for(const vendor of vendors){const baseline=result.vendors.find(v=>v.vendorId===vendor.id),changed=s.result.vendors.find(v=>v.vendorId===vendor.id);if(!baseline||!changed)continue;const row=scenarioRows.length+1;scenarioRows.push([cell(s.name),cell(vendor.name),fcell(`Comparison!B${vendors.indexOf(vendor)+2}`,baseline.total),cell(Number(changed.total)),fcell(`D${row}-C${row}`,(Number(changed.total)-Number(baseline.total)).toFixed(2))]);}
  const files:Record<string,Uint8Array>={'[Content_Types].xml':strToU8(contentTypes),'_rels/.rels':strToU8(rootRels),'xl/workbook.xml':strToU8(workbookXml),'xl/_rels/workbook.xml.rels':strToU8(relationships)};
  [inputRows,monthly,annual,compare,scenarioRows,sourceRows].forEach((rows,i)=>files[`xl/worksheets/sheet${i+1}.xml`]=strToU8(sheet(rows)));
  return Buffer.from(zipSync(files,{level:6}));
}

export function inspectWorkbook(bytes:Buffer){const zip=unzipSync(new Uint8Array(bytes));return {sheets:Object.keys(zip).filter(k=>k.startsWith('xl/worksheets/sheet')),formulaCount:Object.entries(zip).filter(([k])=>k.startsWith('xl/worksheets/sheet')).reduce((n,[,v])=>n+(new TextDecoder().decode(v).match(/<f>/g)?.length??0),0),comparison:new TextDecoder().decode(zip['xl/worksheets/sheet4.xml']),scenarios:new TextDecoder().decode(zip['xl/worksheets/sheet5.xml']),sources:new TextDecoder().decode(zip['xl/worksheets/sheet6.xml'])};}
