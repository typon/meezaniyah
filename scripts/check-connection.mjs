import { readFile } from 'node:fs/promises';
const base = process.env.APP_URL || 'http://127.0.0.1:8787';
const password = (await readFile(new URL('../.local/workspace-access.txt', import.meta.url), 'utf8')).split('\n')[2];
const login = await fetch(`${base}/api/auth/login`, {method:'POST',headers:{'content-type':'application/json',origin:base},body:JSON.stringify({password})});
if (!login.ok) throw new Error(`Sign-in failed (${login.status}).`);
const cookie=login.headers.get('set-cookie').split(';')[0];
const headers={cookie,origin:base,'content-type':'application/json'};
if(process.argv.includes('--sync')){
  const result=await fetch(`${base}/api/sync`,{method:'POST',headers,body:'{}'});
  const info=await result.json();
  console.log(JSON.stringify({operation:'sync',status:result.status,imported:info.imported,syncStatus:info.sync?.status,error:info.error}));
}
const response=await fetch(`${base}/api/state`,{headers});
if(!response.ok)throw new Error(`Financial state unavailable (${response.status}).`);
const state=await response.json();
console.log(JSON.stringify({accounts:state.accounts.length,transactions:state.transactions.length,categories:state.categories.length,snapshots:state.snapshots.length,recurringPatterns:state.recurring.length,syncStatus:state.sync.status,providerIssues:state.sync.errors.length}));
const anonymous=await fetch(`${base}/api/state`);
if(anonymous.status!==401)throw new Error('Private-data access guard failed.');
for(const path of ['/secret.json','/.dev.vars','/.local/worker-secrets.json','/worker/auth.ts']){
  const r=await fetch(base+path);
  if(r.status!==404)throw new Error('Sensitive path guard failed.');
}
await fetch(`${base}/api/auth/logout`,{method:'POST',headers,body:'{}'});
console.log('Authenticated state and privacy boundary checks passed. No financial values or credentials printed.');
