import {copyFileSync,mkdirSync,unlinkSync} from 'node:fs';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {chromium} from 'playwright';

if(!process.env.FDW_DB||!process.env.FDW_FILES)throw new Error('Set FDW_DB and FDW_FILES to the fictional fixture paths');
mkdirSync('data/screenshots/final',{recursive:true});
const captureDb=`data/screenshots/final/capture-${randomUUID()}.sqlite`;
copyFileSync(process.env.FDW_DB,captureDb);process.env.FDW_DB=captureDb;
process.env.NODE_ENV='test';
const {app,store}=await import('../src/server/index.js');
const server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));
const address=server.address();assert.ok(address&&typeof address==='object');
const browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1440,height:900}});
async function capture(name:string){
  await page.setViewportSize({width:1440,height:900});await page.screenshot({path:`data/screenshots/final/${name}-desktop.png`,fullPage:true});
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:`data/screenshots/final/${name}-mobile.png`,fullPage:true});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),true,`${name} has mobile page overflow`);
}
try{
  await page.goto(`http://127.0.0.1:${address.port}`);
  await capture('workspace');
  await page.locator('.rail-action').click();
  await capture('create');
  await page.getByRole('button',{name:'Cancel'}).click();
  await page.locator('.analysis-card:not(.add-card)').first().click();
  await page.getByRole('heading',{name:'Fictional CRM procurement'}).waitFor();
  for(const [tab,name] of [['Overview','overview'],['Documents','documents'],['Assumptions','assumptions'],['Model','model'],['Compare','comparison'],['Model Intelligence','intelligence'],['Revisions','revisions'],['Report','report']] as const){
    await page.getByRole('button',{name:tab,exact:true}).click();
    if(tab==='Model')await page.getByRole('region',{name:'Cost categories by year'}).getByRole('row',{name:/support/i}).waitFor();
    if(tab==='Model Intelligence')await page.getByText('Question the model. Follow the evidence.').waitFor();
    await capture(name);
  }
  await page.getByRole('button',{name:'Compare',exact:true}).click();
  await page.getByLabel('Seats',{exact:true}).last().fill('24');
  await page.getByRole('button',{name:'Run scenario'}).click();
  await page.getByRole('button',{name:'Clear scenario'}).waitFor({timeout:10000}).catch(async error=>{console.error((await page.locator('body').innerText()).slice(-1600));throw error;});
  await capture('scenario');
  console.log('Captured workspace, creation, and 9 analysis states at desktop and mobile widths');
}finally{await browser.close();await new Promise<void>(resolve=>server.close(()=>resolve()));store.close();unlinkSync(captureDb);}
