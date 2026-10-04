import { chromium } from '@playwright/test';
import { readFile, mkdir } from 'node:fs/promises';
const base=process.env.APP_URL||'http://127.0.0.1:8787';
const password=(await readFile(new URL('../.local/workspace-access.txt',import.meta.url),'utf8')).split('\n')[2];
await mkdir(new URL('../.local/qa/',import.meta.url),{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
const context=await browser.newContext({viewport:{width:1440,height:1050}});
const page=await context.newPage();
const errors=[];
page.on('pageerror',error=>errors.push(error.message));
await page.goto(base);
await page.getByLabel('Workspace passphrase',{exact:true}).waitFor();
await page.screenshot({animations:'disabled',path:'.local/qa/login-desktop.png',fullPage:true});
await page.getByLabel('Workspace passphrase',{exact:true}).fill(password);
await page.getByRole('button',{name:'Open my workspace',exact:true}).click();
await page.getByRole('heading',{name:'Your money, at a glance.'}).waitFor();
await page.locator('.page-content[aria-busy="false"]').waitFor();
await page.screenshot({animations:'disabled',path:'.local/qa/overview-desktop.png',fullPage:true});
for(const name of ['Transactions','Accounts','Budget','Insights','Recurring']){
  await page.getByRole('navigation',{name:'Main navigation'}).getByRole('button',{name:new RegExp(`^${name}`)}).click();
  await page.locator('.page-header h1').filter({hasText:name}).waitFor();
  if(name==='Transactions'){
    const search=page.getByRole('textbox',{name:'Search transactions'});
    await search.fill('no-such-merchant-fixture-123456');
    await page.getByRole('heading',{name:'No matching transactions'}).waitFor();
    await search.fill('');
    const rows=page.locator('.transaction-row');
    if(await rows.count()){
      await rows.first().click();
      await page.getByRole('button',{name:'Close transaction details'}).waitFor();
      await page.screenshot({animations:'disabled',path:'.local/qa/transactions-desktop.png',fullPage:true});
      await page.getByRole('button',{name:'Close transaction details'}).click();
    }
  }
  if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)) throw new Error(`Desktop overflow on ${name}`);
  if(name==='Insights')await page.screenshot({animations:'disabled',path:'.local/qa/insights-desktop.png',fullPage:true});
}
await page.getByRole('button',{name:'Settings',exact:true}).click();
await page.getByRole('heading',{name:'Your bank connection'}).waitFor();
await page.setViewportSize({width:390,height:844});
await page.getByRole('button',{name:'Open navigation'}).click();
await page.getByRole('navigation',{name:'Main navigation'}).getByRole('button',{name:'Overview',exact:true}).click();
await page.getByRole('heading',{name:'Your money, at a glance.'}).waitFor();
if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)) throw new Error('Mobile overflow on overview');
await page.screenshot({animations:'disabled',path:'.local/qa/overview-mobile.png',fullPage:true});
await page.getByRole('button',{name:'Open navigation'}).click();
await page.getByRole('button',{name:'Sign out',exact:true}).click();
await page.getByLabel('Workspace passphrase',{exact:true}).waitFor();
await page.screenshot({animations:'disabled',path:'.local/qa/login-mobile.png',fullPage:true});
if(errors.length)throw new Error(`Browser runtime errors: ${errors.join('; ')}`);
await browser.close();
console.log('Browser smoke passed: sign-in, six finance views, reactive filtering, details, mobile navigation, sign-out; no console errors.');
