import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import {
  parseMoney, normalizeAccountSet, importAccountSet, getState, handleFinanceRequest,
  syncFinance, simplefinRequestUrl, sanitizeProviderErrors, inferCategory, detectRecurring, localDate, compositeId,
} from '../worker/finance.ts';

function database() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../migrations/0001_initial.sql', import.meta.url), 'utf8'));
  const prepare = sql => {
    let args = [];
    const statement = {
      bind(...values) { args = values; return statement; },
      async first() { return sqlite.prepare(sql).get(...args) ?? null; },
      async all() { return {results: sqlite.prepare(sql).all(...args), success: true}; },
      async run() { const result = sqlite.prepare(sql).run(...args); return {success:true, results:[], meta:{changes:Number(result.changes)}}; },
      execute() {
        const compiled = sqlite.prepare(sql);
        if (compiled.columns().length) return {success:true, results:compiled.all(...args), meta:{changes:0}};
        const result = compiled.run(...args); return {success:true, results:[], meta:{changes:Number(result.changes)}};
      },
    };
    return statement;
  };
  return {sqlite, env: {DB: {prepare, async batch(statements) {
    sqlite.exec('BEGIN');
    try { const results = statements.map(statement => statement.execute()); sqlite.exec('COMMIT'); return results; }
    catch (error) { sqlite.exec('ROLLBACK'); throw error; }
  }}}};
}
const date = new Date('2026-10-04T18:00:00Z');
const timestamp = Math.floor(date.getTime() / 1000);
const tx = (id, amount, description, extra = {}) => ({id, amount, description, posted: timestamp, ...extra});
const fixture = () => ({
  connections: [{conn_id:'bank-1',name:'Test Bank'},{conn_id:'bank-2',name:'Second Login'}],
  accounts: [
    {id:'same',conn_id:'bank-1',name:'Checking',currency:'USD',balance:'3000.00','balance-date':timestamp,transactions:[
      tx('pay','1000','Payroll'), tx('food','-100','Whole Foods'),tx('refund','20','Whole Foods refund'),
      tx('transfer','-300','Transfer to savings'), tx('pending','-40','Whole Foods',{pending:true}),
    ]},
    {id:'same',conn_id:'bank-2',name:'Credit Card',currency:'USD',balance:'-500','balance-date':timestamp,transactions:[tx('food','-50','Restaurant')]},
    {id:'euro',conn_id:'bank-1',name:'Savings',currency:'EUR',balance:'900','balance-date':timestamp,transactions:[tx('food','-10','Grocery')]},
  ], errors:[], errlist:[],
});

test('decimal money parsing uses exact cents and rejects malformed/unsafe amounts', () => {
  assert.equal(parseMoney('1.005'),101);
  assert.equal(parseMoney('-1.005'),-101);
  assert.equal(parseMoney('0.29'),29);
  assert.equal(parseMoney('123456789.99'),12345678999);
  assert.throws(() => parseMoney('1e8'));
  assert.throws(() => parseMoney('Infinity'));
  assert.throws(() => parseMoney('99999999999999.99'));
});

test('financial dates follow the workspace timezone across month boundaries and daylight saving time', () => {
  assert.equal(localDate(new Date('2026-10-01T06:59:59Z')), '2026-09-30');
  assert.equal(localDate(new Date('2026-10-01T07:00:00Z')), '2026-10-01');
  assert.equal(localDate(new Date('2026-03-08T09:59:59Z')), '2026-03-08');
  assert.equal(localDate(new Date('2026-03-08T10:00:00Z')), '2026-03-08');
  assert.equal(localDate(new Date('2026-11-01T08:30:00Z')), '2026-11-01');
  assert.equal(localDate(new Date('2026-11-01T09:30:00Z')), '2026-11-01');
  assert.equal(localDate(new Date('2026-10-01T18:00:00Z'), 'Asia/Tokyo'), '2026-10-02');
});

test('optimized identity encoding preserves UTF-8 and ASCII account identifiers', () => {
  for (const parts of [['bank','account','tx'],['مصرف','épargne','取引']]) {
    const expected = Buffer.from(JSON.stringify(parts), 'utf8').toString('base64url');
    assert.equal(compositeId(...parts), expected);
  }
});

test('v1 organizations, v2 login identities, and account-scoped transaction ids normalize', () => {
  const normalized = normalizeAccountSet(fixture(),date);
  assert.equal(new Set(normalized.accounts.map(row=>row.id)).size,3);
  assert.equal(new Set(normalized.transactions.map(row=>row.id)).size,7);
  const legacy = normalizeAccountSet({accounts:[{id:'a',org:{id:'org',name:'Legacy Bank'},name:'Savings',currency:'USD',balance:'10',transactions:[]}]},date);
  assert.equal(legacy.accounts[0].institution,'Legacy Bank');
  assert.equal(legacy.accounts[0].balanceCents,1000);
  assert.equal(inferCategory('Car payment',-10000),'uncategorized');
  assert.equal(inferCategory('Credit card payment',-10000),'transfer');
});

test('incoming deposit descriptions take precedence over employer merchant keywords without swallowing refunds or transfers', () => {
  for (const description of ['Electronic Deposit Adobe', 'ACH Credit Netflix', 'DIRECTDEP Amazon', 'Salary Grocery Cooperative']) {
    assert.equal(inferCategory(description,100000),'income');
  }
  assert.equal(inferCategory('Adobe subscription refund',2500),'subscriptions');
  assert.equal(inferCategory('Electronic Deposit Adobe refund',2500),'subscriptions');
  assert.equal(inferCategory('Direct Deposit Amazon refund',2500),'shopping');
  assert.equal(inferCategory('Electronic Deposit Transfer from savings',100000),'transfer');
  assert.equal(inferCategory('Electronic Deposit Adobe',-2500),'subscriptions');
});

test('deposit migration repairs existing automatic categories while preserving edits, refunds, and sync state', async () => {
  const {env,sqlite}=database();
  try {
    const transactions=[
      tx('auto','1000','Electronic Deposit Adobe'),
      tx('ach','200','ACH Credit Amazon'),
      tx('edited','300','Electronic Deposit Grocery Cooperative'),
      tx('refund','20','Electronic Deposit Adobe refund'),
      tx('transfer','400','Electronic Deposit Transfer from savings'),
      tx('charge','-25','Adobe subscription'),
    ];
    await importAccountSet(env,{accounts:[{id:'cash',org:{id:'bank'},name:'Checking',currency:'USD',balance:'1000',transactions}]},date);
    sqlite.exec("UPDATE transactions SET category_id='subscriptions' WHERE external_id IN ('auto','ach')");
    sqlite.exec("UPDATE transactions SET category_id='gifts',category_override=1,reviewed=1,notes='User choice' WHERE external_id='edited'");
    const syncBefore=sqlite.prepare('SELECT * FROM sync_metadata').get();
    sqlite.exec(readFileSync(new URL('../migrations/0003_deposit_categories.sql',import.meta.url),'utf8'));
    const rows=new Map(sqlite.prepare('SELECT external_id,category_id,reviewed,notes FROM transactions').all().map(row=>[row.external_id,row]));
    assert.equal(rows.get('auto').category_id,'income');
    assert.equal(rows.get('ach').category_id,'income');
    assert.equal(rows.get('edited').category_id,'gifts');
    assert.equal(rows.get('edited').reviewed,1);
    assert.equal(rows.get('edited').notes,'User choice');
    assert.equal(rows.get('refund').category_id,'subscriptions');
    assert.equal(rows.get('transfer').category_id,'transfer');
    assert.equal(rows.get('charge').category_id,'subscriptions');
    assert.deepEqual(sqlite.prepare('SELECT * FROM sync_metadata').get(),syncBefore);
    const state=await getState(env,'2026-10',date);
    assert.equal(state.summary.incomeCents,120000);
  } finally {sqlite.close();}
});

test('financial summaries separate currencies, exclude pending/transfers, and net refunds', async () => {
  const {env,sqlite} = database();
  try {
    const payload = fixture();
    payload.accounts[0].transactions.push(tx('last-month','-25','Whole Foods', {posted: Math.floor(Date.parse('2026-09-15T18:00:00Z') / 1000)}));
    await importAccountSet(env,payload,date);
    const state = await getState(env,'2026-10',date);
    assert.equal(state.summary.assetsCents,300000);
    assert.equal(state.summary.liabilitiesCents,50000);
    assert.equal(state.summary.netWorthCents,250000);
    assert.equal(state.summary.incomeCents,100000);
    assert.equal(state.summary.expensesCents,13000);
    assert.equal(state.summary.cashFlowCents,87000);
    assert.equal(state.summary.savingsRate,87);
    assert.equal(state.summary.reviewCount,6); // Only October's unreviewed posted transactions.
    assert.equal(state.transactions.length,8); // Historical transactions remain available to insights.
    assert.equal(state.summary.byCurrency.find(row=>row.currency==='EUR').netWorthCents,90000);
    assert.equal(state.summary.byCurrency.find(row=>row.currency==='EUR').expensesCents,1000);
    assert.equal(state.snapshots.length,1);
    assert.equal(state.snapshots[0].netWorthCents,250000);
  } finally {sqlite.close();}
});

test('positive credit overpayments remain assets and negative cash overdrafts remain liabilities', async () => {
  const {env,sqlite}=database();
  try {
    await importAccountSet(env,{accounts:[
      {id:'credit',org:{id:'bank'},name:'Credit card',currency:'USD',balance:'25',transactions:[]},
      {id:'cash',org:{id:'bank'},name:'Checking',currency:'USD',balance:'-10',transactions:[]},
    ]},date);
    const state=await getState(env,'2026-10',date);
    assert.equal(state.summary.assetsCents,2500);
    assert.equal(state.summary.liabilitiesCents,1000);
    assert.equal(state.summary.netWorthCents,1500);
    assert.equal(state.summary.savingsRate,null);
  } finally {sqlite.close();}
});

function api(env,path,method,data) {
  return handleFinanceRequest(new Request(`https://finance.example${path}`,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}),env);
}

test('sync upserts preserve edits and account type while pruning vanished pending rows', async () => {
  const {env,sqlite} = database();
  try {
    const payload = fixture();
    await importAccountSet(env,payload,date);
    const state = await getState(env,'2026-10',date);
    const selected = state.transactions.find(row=>row.description==='Whole Foods');
    assert.equal((await api(env,`/api/transactions/${selected.id}`,'PATCH',{categoryId:'gifts',reviewed:true,notes:'Birthday dinner'})).status,200);
    const account = state.accounts.find(row=>row.name==='Checking');
    assert.equal((await api(env,`/api/accounts/${account.id}`,'PATCH',{type:'asset'})).status,200);
    payload.accounts[0].transactions = payload.accounts[0].transactions.filter(row=>row.id!=='pending');
    payload.accounts[0].transactions.find(row=>row.id==='food').amount='-110';
    await importAccountSet(env,payload,new Date(date.getTime()+86400000));
    const next = await getState(env,'2026-10',date);
    const edited = next.transactions.find(row=>row.id===selected.id);
    assert.equal(edited.categoryId,'gifts'); assert.equal(edited.reviewed,true);
    assert.equal(edited.notes,'Birthday dinner'); assert.equal(edited.amountCents,-11000);
    assert.equal(next.transactions.length,6);
    assert.equal(next.accounts.find(row=>row.id===account.id).type,'asset');
  } finally {sqlite.close();}
});

test('monthly budgets are isolated and validate cents/category/body input', async () => {
  const {env,sqlite} = database();
  try {
    await importAccountSet(env,fixture(),date);
    assert.equal((await api(env,'/api/budgets/groceries','PUT',{month:'2026-10',amountCents:40000})).status,200);
    assert.equal((await api(env,'/api/budgets/groceries','PUT',{month:'2026-11',amountCents:50000})).status,200);
    const october = await getState(env,'2026-10',date);
    assert.equal(october.budgets.find(row=>row.categoryId==='groceries').amountCents,40000);
    assert.equal(october.budgets.find(row=>row.categoryId==='groceries').spentCents,8000);
    assert.equal(october.summary.budgetRemainingCents,32000);
    assert.equal((await getState(env,'2026-11',date)).budgets.find(row=>row.categoryId==='groceries').amountCents,50000);
    assert.equal((await api(env,'/api/budgets/transfer','PUT',{month:'2026-10',amountCents:100})).status,400);
    assert.equal((await api(env,'/api/budgets/groceries','PUT',{month:'2026-13',amountCents:100})).status,400);
    assert.equal((await api(env,'/api/budgets/groceries','PUT',{month:'2026-10',amountCents:1.1})).status,400);
    assert.equal((await api(env,'/api/budgets/groceries','PUT',{month:'2026-10',amountCents:-100})).status,400);
  } finally {sqlite.close();}
});

test('SimpleFIN connector only permits trusted HTTPS and strips URL credentials', () => {
  const access = 'https://user:password@bridge.simplefin.org/simplefin';
  const request = simplefinRequestUrl(access,new Date(date.getTime()-45*86400000),date);
  assert.equal(request.url.username,''); assert.equal(request.url.password,'');
  assert.equal(request.url.pathname,'/simplefin/accounts'); assert.equal(request.url.searchParams.get('pending'),'1');
  assert.equal(request.authorization,`Basic ${btoa('user:password')}`);
  for (const url of ['http://user:password@bridge.simplefin.org/simplefin','https://user:password@simplefin.org.attacker.example','https://user:password@127.0.0.1','https://user:password@bridge.simplefin.org:444/simplefin']) assert.throws(()=>simplefinRequestUrl(url,date,date));
  const safe = sanitizeProviderErrors({errors:[`Failure at ${access}`],errlist:[{msg:'Rejected password'}]},access).join(' ');
  assert.ok(!safe.includes('password')); assert.ok(!safe.includes(access));
});

test('failed sync persists one-hour cooldown and does not expose secrets', async () => {
  const {env,sqlite} = database(); env.SIMPLEFIN_ACCESS_URL='https://user:password@bridge.simplefin.org/simplefin';
  try {
    let calls=0;
    const failing=async()=>{ calls++; throw new Error(env.SIMPLEFIN_ACCESS_URL); };
    await assert.rejects(syncFinance(env,date,failing), error=>error.code==='sync_failed' && !error.message.includes('password'));
    await assert.rejects(syncFinance(env,new Date(date.getTime()+1000),failing),error=>error.status===429);
    assert.equal(calls,1);
    const state=await getState(env,'2026-10',date);
    assert.equal(state.sync.status,'error'); assert.ok(!JSON.stringify(state).includes('password'));
  } finally {sqlite.close();}
});

test('sync caps initial history at 45 days and overlaps incremental history by five days', async () => {
  const {env,sqlite} = database(); env.SIMPLEFIN_ACCESS_URL='https://user:password@bridge.simplefin.org/simplefin';
  try {
    const requests=[];
    const fetcher=async(url,options)=>{ requests.push({url,options}); return Response.json(fixture()); };
    await syncFinance(env,date,fetcher);
    const first=requests[0].url;
    assert.equal(Number(first.searchParams.get('end-date'))-Number(first.searchParams.get('start-date')),45*86400);
    assert.equal(requests[0].options.redirect,'manual');
    await syncFinance(env,new Date(date.getTime()+86400000),fetcher);
    assert.equal(Number(requests[1].url.searchParams.get('start-date')),timestamp-5*86400);
  } finally {sqlite.close();}
});

test('recurring detection requires actual repeat observations and rejects variable spending', () => {
  const row=(day,amount=-1500)=>({id:day,accountId:'a',currency:'USD',date:day,amountCents:amount,description:'Netflix',categoryId:'subscriptions',pending:false});
  const categories=[{id:'subscriptions',kind:'expense'}];
  assert.equal(detectRecurring([row('2026-09-20')],categories,'2026-10-04').length,0);
  const recurring=detectRecurring([row('2026-08-20'),row('2026-09-20')],categories,'2026-10-04');
  assert.equal(recurring.length,1); assert.equal(recurring[0].nextDate,'2026-10-20'); assert.equal(recurring[0].confidence,'estimated');
  assert.equal(detectRecurring([row('2026-08-20'),row('2026-09-20',-5000)],categories,'2026-10-04').length,0);
  const pay = day => ({...row(day,250000),description:'Acme Payroll',categoryId:'income'});
  const income = detectRecurring([pay('2026-09-04'),pay('2026-09-18')],[...categories,{id:'income',kind:'income'}],'2026-10-04');
  assert.equal(income.length,1); assert.equal(income[0].cadence,'biweekly'); assert.equal(income[0].amountCents,250000);
});

test('partial provider responses preserve pending transactions and the successful cursor', async () => {
  const {env,sqlite}=database();
  try {
    await importAccountSet(env,fixture(),date);
    const partial=fixture(); partial.errlist=[{msg:'One institution is temporarily unavailable.'}];
    partial.accounts[0].transactions=partial.accounts[0].transactions.filter(row=>!row.pending);
    await importAccountSet(env,partial,new Date(date.getTime()+86400000));
    const state=await getState(env,'2026-10',date);
    assert.equal(state.sync.status,'partial'); assert.equal(state.sync.lastSuccessAt,date.toISOString());
    assert.equal(state.transactions.filter(row=>row.pending).length,1);
  } finally {sqlite.close();}
});
