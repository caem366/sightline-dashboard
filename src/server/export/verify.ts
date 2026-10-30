import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import type { ModelResult, Vendor } from '../../shared/contracts.js';

export function verifyWorkbookWithExcel(path:string,vendors:Vendor[],result:ModelResult):boolean{
  if(process.platform!=='win32')return false;
  try{
    const output=execFileSync('powershell.exe',['-NoProfile','-File',resolve('scripts/reconcile.ps1'),resolve(path)],{encoding:'utf8',timeout:30000,windowsHide:true,stdio:['ignore','pipe','ignore']});
    const rows=JSON.parse(output) as {vendor:string;total:number}[];
    return Array.isArray(rows)&&rows.length===result.vendors.length&&result.vendors.every(v=>{
      const name=vendors.find(x=>x.id===v.vendorId)?.name,actual=rows.find(x=>x.vendor===name)?.total;
      return typeof actual==='number'&&Number.isFinite(actual)&&Math.abs(actual-Number(v.total))<0.005;
    });
  }catch{return false;}
}
