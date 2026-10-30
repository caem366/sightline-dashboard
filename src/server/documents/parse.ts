import { unzipSync } from 'fflate';
import { createCanvas } from '@napi-rs/canvas';

export type ParsedPassage={location:string;text:string;image?:Buffer};
const utf8=new TextDecoder();
const xmlText=(s:string)=>s.replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&amp;/g,'&');

export async function parseDocument(bytes:Buffer,filename:string):Promise<ParsedPassage[]>{
  const lower=filename.toLowerCase();
  if(lower.endsWith('.pdf')){
    if(bytes.subarray(0,5).toString()!=='%PDF-')throw new Error('Invalid PDF signature');
    const pdfjs=await import('pdfjs-dist/legacy/build/pdf.mjs');
    const pdf=await pdfjs.getDocument({data:new Uint8Array(bytes),useSystemFonts:true,disableFontFace:true}).promise;
    if(pdf.numPages>50)throw new Error('PDF exceeds 50 page limit');
    const output:ParsedPassage[]=[];
    for(let i=1;i<=pdf.numPages;i++){
      const page=await pdf.getPage(i);const content=await page.getTextContent();
      const text=content.items.map(item=>'str' in item?item.str:'').filter(Boolean).join(' ').replace(/\s+/g,' ').trim();
      let image:Buffer|undefined;
      try{const view=page.getViewport({scale:1.5});const canvas=createCanvas(Math.ceil(view.width),Math.ceil(view.height));await page.render({canvasContext:canvas.getContext('2d') as any,viewport:view,canvas:canvas as any}).promise;image=canvas.toBuffer('image/png');}catch{/* Text extraction remains available if rendering fails. */}
      output.push({location:`page ${i}`,text:text||'[No selectable text; visual review required]',image});
      page.cleanup();
    }
    await pdf.destroy();return output;
  }
  if(lower.endsWith('.xlsx')){
    if(bytes[0]!==0x50||bytes[1]!==0x4b)throw new Error('Invalid XLSX signature');
    const zip=unzipSync(new Uint8Array(bytes));
    const total=Object.values(zip).reduce((v,b)=>v+b.length,0);if(total>60_000_000)throw new Error('Workbook exceeds expanded size limit');
    const shared=zip['xl/sharedStrings.xml']?Array.from(utf8.decode(zip['xl/sharedStrings.xml']).matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g),m=>xmlText(Array.from(m[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g),x=>x[1]).join(''))):[];
    const sheets=Object.keys(zip).filter(k=>/^xl\/worksheets\/sheet\d+\.xml$/.test(k)).sort();if(sheets.length>30)throw new Error('Too many sheets');
    const passages:ParsedPassage[]=[];
    for(const sheet of sheets){
      const xml=utf8.decode(zip[sheet]);const sheetName=sheet.match(/sheet\d+/)?.[0]??sheet;
      for(const row of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)){
        const cells:string[]=[];
        for(const c of row[1].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)){
          const ref=c[1].match(/\br="([^"]+)"/)?.[1]??'?';const type=c[1].match(/\bt="([^"]+)"/)?.[1];
          const raw=c[2].match(/<v>([\s\S]*?)<\/v>/)?.[1]??c[2].match(/<t[^>]*>([\s\S]*?)<\/t>/)?.[1]??'';
          const value=type==='s'?shared[Number(raw)]??raw:xmlText(raw);
          const formula=c[2].match(/<f[^>]*>([\s\S]*?)<\/f>/)?.[1];
          if(value||formula)cells.push(`${ref}: ${value}${formula?` [formula ${xmlText(formula)}; cached result unverified]`:''}`);
        }
        if(cells.length)passages.push({location:`${sheetName}!${cells[0].split(':')[0]}`,text:cells.join(' | ')});
      }
    }
    if(passages.length>5000)throw new Error('Workbook has too many populated rows');
    return passages;
  }
  throw new Error('Only PDF and XLSX are supported');
}
