export interface Env {
  DB: D1Database;
  SIMPLEFIN_ACCESS_URL?: string;
  FINANCE_TIMEZONE?: string;
}

export interface Account {
  id: string; name: string; institution: string; type: string; currency: string;
  balanceCents: number; availableBalanceCents: number | null; balanceDate: string; updatedAt: string;
}
export interface Transaction {
  id: string; accountId: string; description: string; amountCents: number; currency: string;
  date: string; postedAt: string | null; pending: boolean; categoryId: string; reviewed: boolean; notes: string;
}
export interface Category { id: string; name: string; group: string; kind: string; color: string; icon: string }
type Row = Record<string, unknown>;
const DAY = 86_400_000;
const COOLDOWN = 3_600_000;
const MAX_LOOKBACK_DAYS = 45;
const REPORTING_CURRENCY = 'USD';
const encoder = new TextEncoder();
// Reuse ICU formatters: creating one for every imported transaction exceeds the
// free Worker's small CPU allowance long before the D1 query limit is reached.
const dateFormatters = new Map<string, Intl.DateTimeFormat>([
  ['America/Los_Angeles', new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' })],
]);

export class FinanceError extends Error {
  status: number;
  code: string;
  nextAllowedAt?: string;
  constructor(message: string, status = 400, code = 'invalid_request', nextAllowedAt?: string) {
    super(message); this.status = status; this.code = code; this.nextAllowedAt = nextAllowedAt;
  }
}

/** Parse decimal strings without floating point multiplication. Values are rounded to hundredths. */
export function parseMoney(value: unknown): number {
  const match = /^([+-]?)(\d{1,14})(?:\.(\d{1,12}))?$/.exec(String(value ?? '').trim());
  if (!match) throw new FinanceError('The provider returned an invalid monetary amount.', 502, 'invalid_provider_data');
  const fraction = (match[3] ?? '').padEnd(3, '0');
  let amount = BigInt(match[2]) * 100n + BigInt(fraction.slice(0, 2));
  if (Number(fraction[2]) >= 5) amount += 1n;
  if (match[1] === '-') amount = -amount;
  const result = Number(amount);
  if (!Number.isSafeInteger(result)) throw new FinanceError('A monetary amount exceeds supported precision.', 502, 'invalid_provider_data');
  return result;
}

function object(value: unknown): Row { return value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {}; }
function clean(value: unknown, fallback = '', limit = 300): string {
  return typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, limit) : fallback;
}
function requiredId(value: unknown): string {
  const id = clean(value, '', 256);
  if (!id) throw new FinanceError('The provider returned a record without an identifier.', 502, 'invalid_provider_data');
  return id;
}
export function compositeId(...parts: string[]): string {
  const value = JSON.stringify(parts);
  const binary = /^[\x00-\x7f]*$/.test(value) ? value : Array.from(encoder.encode(value), n => String.fromCharCode(n)).join('');
  return btoa(binary)
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function localDate(value: Date, timeZone = 'America/Los_Angeles'): string {
  let formatter = dateFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
    dateFormatters.set(timeZone, formatter);
  }
  return formatter.format(value);
}
function epoch(value: unknown, fallback: Date): Date {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 && number < 253402300800 ? new Date(number * 1000) : fallback;
}
export function inferCategory(description: string, amount: number): string {
  const text = description.toLowerCase();
  if (/\b(?:internal transfer|transfer (?:to|from)|credit card payment|payment thank you|payment received thank|autopay credit card)\b/.test(text)) return 'transfer';
  const refund = amount > 0 && /\b(?:refund|reversal|return)\b/.test(text);
  if (!refund && /\b(?:payroll|salary|paycheck|direct\s*dep(?:osit)?)\b/.test(text)) return 'income';
  // Incoming bank deposits identify the payment direction more reliably than an
  // employer name that also happens to match a retail/subscription merchant.
  if (amount > 0 && !refund && /\b(?:electronic\s+deposit|ach\s+credit)\b/.test(text)) return 'income';
  const patterns: [string, RegExp][] = [
    ['groceries', /\b(?:trader joe|whole foods|safeway|kroger|aldi|grocery|groceries|publix|wegmans|sprouts)\b/],
    ['dining', /\b(?:restaurant|coffee|cafe|starbucks|doordash|ubereats|uber eats|grubhub|chipotle|mcdonald|pizza|bakery)\b/],
    ['subscriptions', /\b(?:netflix|spotify|hulu|disney\+|youtube premium|apple\.com\/bill|openai|chatgpt|adobe)\b/],
    ['utilities', /\b(?:electric|electricity|water bill|utility|utilities|comcast|xfinity|verizon|at&t|t-mobile|pge|pg&e)\b/],
    ['transport', /\b(?:uber|lyft|chevron|shell oil|exxon|parking|transit|gas station)\b/],
    ['housing', /\b(?:rent payment|apartment rent|mortgage payment)\b/],
    ['insurance', /\b(?:insurance|geico|allstate|progressive ins)\b/],
    ['health', /\b(?:pharmacy|walgreens|cvs|medical|dental|hospital|gym|fitness)\b/],
    ['shopping', /\b(?:amazon|amzn|target|walmart|costco|nordstrom|ikea|etsy)\b/],
    ['travel', /\b(?:airlines|airways|airbnb|hotel|marriott|hilton)\b/],
    ['fees', /\b(?:interest charge|late fee|overdraft fee|service fee|annual fee)\b/],
  ];
  for (const [category, pattern] of patterns) if (pattern.test(text)) return category;
  return amount > 0 ? 'other-income' : 'uncategorized';
}
function inferAccountType(name: string, extra: Row, balance: number): string {
  const text = `${name} ${clean(extra.type)} ${clean(extra['account-type'])}`.toLowerCase();
  if (/\b(?:401k|401\(k\)|ira|brokerage|investment|retirement|roth|403b|529)\b/.test(text)) return 'investment';
  if (/\b(?:credit|visa|mastercard|amex|american express)\b/.test(text)) return 'credit';
  if (/\b(?:loan|mortgage|lending)\b/.test(text)) return 'loan';
  if (/\b(?:checking|savings|cash|money market|deposit)\b/.test(text)) return 'cash';
  return balance < 0 ? 'credit' : 'asset';
}

export function sanitizeProviderErrors(payload: unknown, secret = ''): string[] {
  const data = object(payload);
  const values = [
    ...(Array.isArray(data.errors) ? data.errors : []),
    ...(Array.isArray(data.errlist) ? data.errlist.map(item => object(item).msg) : []),
  ];
  const sensitive: string[] = [secret];
  try {
    const url = new URL(secret);
    sensitive.push(decodeURIComponent(url.password), decodeURIComponent(url.username));
  } catch { /* No credential was provided. */ }
  return [...new Set(values.map(value => {
    let message = clean(value, 'SimpleFIN reported a connection issue.', 1200);
    for (const text of sensitive) if (text.length >= 3) message = message.split(text).join('[redacted]');
    return message.replace(/https?:\/\/\S+/gi, '[link omitted]').replace(/[A-Za-z0-9_+/=-]{40,}/g, '[redacted]').slice(0, 400);
  }))].slice(0, 25);
}

export function normalizeAccountSet(payload: unknown, now = new Date(), timeZone?: string) {
  const data = object(payload);
  if (!Array.isArray(data.accounts) || data.accounts.length > 1000) throw new FinanceError('SimpleFIN returned an invalid account response.', 502, 'invalid_provider_data');
  const connections = new Map((Array.isArray(data.connections) ? data.connections : []).map(value => {
    const row = object(value); return [String(row.conn_id), row];
  }));
  const accounts: Row[] = [];
  const transactions: Row[] = [];
  const accountIds = new Set<string>();
  const transactionIds = new Set<string>();
  const updatedAt = now.toISOString();
  for (const value of data.accounts) {
    const account = object(value); const org = object(account.org);
    const externalId = requiredId(account.id);
    const connectionId = clean(account.conn_id) || clean(org.id) || clean(org.domain) || clean(org.name) || 'simplefin';
    const connection = connections.get(connectionId) ?? {};
    const id = compositeId(connectionId, externalId);
    if (accountIds.has(id)) throw new FinanceError('SimpleFIN returned duplicate account identifiers.', 502, 'invalid_provider_data');
    accountIds.add(id);
    const name = clean(account.name, 'Account');
    const currency = clean(account.currency, 'USD', 256);
    const balanceCents = parseMoney(account.balance);
    accounts.push({ id, externalId, connectionId, name, currency, balanceCents,
      institution: clean(connection.name) || clean(account.conn_name) || clean(org.name) || 'Connected institution',
      type: inferAccountType(name, object(account.extra), balanceCents),
      availableBalanceCents: account['available-balance'] == null ? null : parseMoney(account['available-balance']),
      balanceDate: epoch(account['balance-date'], now).toISOString(), updatedAt,
      hasTransactions: Array.isArray(account.transactions) });
    if (account.transactions != null && !Array.isArray(account.transactions)) throw new FinanceError('SimpleFIN returned invalid transactions.', 502, 'invalid_provider_data');
    for (const txValue of (account.transactions ?? []) as unknown[]) {
      const tx = object(txValue); const txExternalId = requiredId(tx.id);
      const txId = compositeId(connectionId, externalId, txExternalId);
      if (transactionIds.has(txId)) continue;
      transactionIds.add(txId);
      const amountCents = parseMoney(tx.amount);
      const description = clean(tx.description, 'Transaction', 500);
      const pending = tx.pending === true || Number(tx.posted) === 0;
      const postedAt = pending && !Number(tx.posted) ? null : epoch(tx.posted, now).toISOString();
      transactions.push({ id: txId, externalId: txExternalId, accountId: id, description, amountCents, currency,
        date: localDate(epoch(tx.posted || tx.transacted_at, now), timeZone), postedAt, pending: pending ? 1 : 0,
        categoryId: inferCategory(description, amountCents), updatedAt });
      if (transactions.length > 20000) throw new FinanceError('The import contains too many transactions. Try a smaller account selection in SimpleFIN.', 502, 'import_too_large');
    }
  }
  return { accounts, transactions };
}

const ACCOUNT_SELECT = `SELECT id, name, institution, type, currency, balance_cents AS balanceCents,
 available_balance_cents AS availableBalanceCents, balance_date AS balanceDate, updated_at AS updatedAt FROM accounts`;
const TRANSACTION_SELECT = `SELECT id, account_id AS accountId, description, amount_cents AS amountCents, currency,
 date, posted_at AS postedAt, pending, category_id AS categoryId, reviewed, notes FROM transactions`;
function transaction(row: Row): Transaction { return { ...row, pending: Boolean(row.pending), reviewed: Boolean(row.reviewed) } as unknown as Transaction; }
function validMonth(month: string): boolean { return /^20\d{2}-(?:0[1-9]|1[0-2])$/.test(month); }

export async function getSync(env: Env, now = new Date()) {
  const row = await env.DB.prepare('SELECT * FROM sync_metadata WHERE id=1').first<Row>();
  const attempt = row?.last_attempt_at ? String(row.last_attempt_at) : null;
  const nextAllowedAt = attempt ? new Date(Date.parse(attempt) + COOLDOWN).toISOString() : null;
  let errors: string[] = [];
  try { errors = JSON.parse(String(row?.errors_json ?? '[]')); } catch { /* Old invalid metadata is treated as empty. */ }
  const status = row?.status === 'syncing' && nextAllowedAt && Date.parse(nextAllowedAt) <= now.getTime() ? 'interrupted' : String(row?.status ?? 'idle');
  return { configured: Boolean(env.SIMPLEFIN_ACCESS_URL), lastAttemptAt: attempt,
    lastSuccessAt: row?.last_success_at ? String(row.last_success_at) : null, nextAllowedAt,
    status, errors, accountCount: Number(row?.account_count ?? 0), transactionCount: Number(row?.transaction_count ?? 0) };
}

export function calculateSummary(accounts: Account[], transactions: Transaction[], categories: Category[], budgets: { categoryId: string; amountCents: number }[], month: string) {
  const kind = new Map(categories.map(category => [category.id, category.kind]));
  const groups = new Map<string, {currency: string; assetsCents: number; liabilitiesCents: number; netWorthCents: number; incomeCents: number; expensesCents: number; cashFlowCents: number}>();
  const group = (currency: string) => {
    if (!groups.has(currency)) groups.set(currency, { currency, assetsCents: 0, liabilitiesCents: 0, netWorthCents: 0, incomeCents: 0, expensesCents: 0, cashFlowCents: 0 });
    return groups.get(currency)!;
  };
  group(REPORTING_CURRENCY);
  for (const account of accounts) {
    const totals = group(account.currency);
    totals.assetsCents += Math.max(0, account.balanceCents);
    totals.liabilitiesCents += Math.max(0, -account.balanceCents);
    totals.netWorthCents += account.balanceCents;
  }
  const spent = new Map<string, number>();
  const monthly = transactions.filter(tx => tx.date.startsWith(month));
  for (const tx of monthly) {
    if (tx.pending || kind.get(tx.categoryId) === 'transfer') continue;
    const totals = group(tx.currency);
    if (kind.get(tx.categoryId) === 'income') totals.incomeCents += tx.amountCents;
    else {
      totals.expensesCents -= tx.amountCents;
      if (tx.currency === REPORTING_CURRENCY) spent.set(tx.categoryId, (spent.get(tx.categoryId) ?? 0) - tx.amountCents);
    }
  }
  for (const totals of groups.values()) totals.cashFlowCents = totals.incomeCents - totals.expensesCents;
  const reporting = group(REPORTING_CURRENCY);
  const budgetedCents = budgets.reduce((sum, budget) => sum + budget.amountCents, 0);
  const budgetSpentCents = budgets.filter(budget => budget.amountCents > 0).reduce((sum, budget) => sum + (spent.get(budget.categoryId) ?? 0), 0);
  return { ...reporting, budgetedCents, budgetSpentCents, budgetRemainingCents: budgetedCents - budgetSpentCents,
    reviewCount: monthly.filter(tx => !tx.reviewed && !tx.pending).length, transactionCount: monthly.length,
    savingsRate: reporting.incomeCents > 0 ? reporting.cashFlowCents / reporting.incomeCents * 100 : null,
    byCurrency: [...groups.values()], spendingByCategory: [...spent].map(([categoryId, spentCents]) => ({ categoryId, spentCents })).sort((a, b) => b.spentCents - a.spentCents) };
}

export function detectRecurring(transactions: Transaction[], categories: Category[], today: string) {
  const categoryKinds = new Map(categories.map(category => [category.id, category.kind]));
  const groups = new Map<string, Transaction[]>();
  for (const tx of transactions) {
    const kind = categoryKinds.get(tx.categoryId);
    if (tx.pending || !((kind === 'expense' && tx.amountCents < 0) || (kind === 'income' && tx.amountCents > 0))) continue;
    const merchant = tx.description.toLowerCase().replace(/\b\d+\b/g, '').replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();
    if (merchant.length < 3) continue;
    const key = `${tx.accountId}:${tx.currency}:${kind}:${merchant}`;
    const rows = groups.get(key) ?? []; rows.push(tx); groups.set(key, rows);
  }
  const result = [];
  for (const [id, rows] of groups) {
    rows.sort((a, b) => a.date.localeCompare(b.date));
    if (rows.length < 2) continue;
    const recent = rows.slice(-6);
    const gaps = recent.slice(1).map((row, i) => (Date.parse(row.date) - Date.parse(recent[i].date)) / DAY);
    const averageGap = gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length;
    let cadence: string; let days: number;
    if (gaps.every(gap => gap >= 6 && gap <= 8)) { cadence = 'weekly'; days = 7; }
    else if (gaps.every(gap => gap >= 13 && gap <= 15)) { cadence = 'biweekly'; days = 14; }
    else if (gaps.every(gap => gap >= 26 && gap <= 35)) { cadence = 'monthly'; days = 30; }
    else if (gaps.every(gap => gap >= 350 && gap <= 380)) { cadence = 'yearly'; days = 365; }
    else continue;
    const amounts = recent.map(row => Math.abs(row.amountCents));
    const averageAmount = amounts.reduce((sum, amount) => sum + amount, 0) / amounts.length;
    if (amounts.some(amount => Math.abs(amount - averageAmount) > Math.max(100, averageAmount * .1))) continue;
    const last = recent.at(-1)!;
    const next = new Date(`${last.date}T12:00:00Z`);
    if (cadence === 'monthly') {
      const day = next.getUTCDate(); next.setUTCDate(1); next.setUTCMonth(next.getUTCMonth() + 1);
      const lastDay = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)).getUTCDate(); next.setUTCDate(Math.min(day, lastDay));
    } else next.setUTCDate(next.getUTCDate() + days);
    if (Date.parse(today) - next.getTime() > averageGap * DAY) continue;
    result.push({ id: compositeId(id), merchant: last.description, amountCents: Math.round(averageAmount), currency: last.currency,
      cadence, nextDate: next.toISOString().slice(0, 10), lastDate: last.date, categoryId: last.categoryId,
      occurrences: rows.length, confidence: 'estimated', accountId: last.accountId });
  }
  return result.sort((a, b) => a.nextDate.localeCompare(b.nextDate));
}

export async function getState(env: Env, month: string, now = new Date()) {
  if (!validMonth(month)) throw new FinanceError('Month must use YYYY-MM format.');
  const results = await env.DB.batch([
    env.DB.prepare(`${ACCOUNT_SELECT} ORDER BY institution,name`),
    env.DB.prepare('SELECT id,name,group_name AS "group",kind,color,icon FROM categories ORDER BY rowid'),
    env.DB.prepare(`${TRANSACTION_SELECT} ORDER BY date DESC,id`),
    env.DB.prepare('SELECT category_id AS categoryId,amount_cents AS amountCents FROM budgets WHERE month=?').bind(month),
    env.DB.prepare('SELECT date,assets_cents AS assetsCents,liabilities_cents AS liabilitiesCents,net_worth_cents AS netWorthCents FROM balance_snapshots WHERE currency=? ORDER BY date').bind(REPORTING_CURRENCY),
  ]);
  const accounts = results[0].results as unknown as Account[];
  const categories = results[1].results as unknown as Category[];
  const transactions = (results[2].results as Row[]).map(transaction);
  const configuredBudgets = results[3].results as {categoryId: string; amountCents: number}[];
  const summary = calculateSummary(accounts, transactions, categories, configuredBudgets, month);
  const amounts = new Map(configuredBudgets.map(budget => [budget.categoryId, budget.amountCents]));
  const spent = new Map(summary.spendingByCategory.map(item => [item.categoryId, item.spentCents]));
  const budgets = categories.filter(category => category.kind === 'expense').map(category => ({ categoryId: category.id, month,
    amountCents: amounts.get(category.id) ?? 0, spentCents: spent.get(category.id) ?? 0,
    remainingCents: (amounts.get(category.id) ?? 0) - (spent.get(category.id) ?? 0) }));
  return { month, reportingCurrency: REPORTING_CURRENCY, accounts, categories, transactions, budgets,
    snapshots: results[4].results, sync: await getSync(env, now), summary,
    recurring: detectRecurring(transactions, categories, localDate(now, env.FINANCE_TIMEZONE)) };
}

function chunks<T>(values: T[], size: number): T[][] {
  const result = []; for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size)); return result;
}

/** Atomic batch: a failed import never leaves a partial financial dataset. User edits are never overwritten. */
export async function importAccountSet(env: Env, payload: unknown, now = new Date()) {
  const { accounts, transactions } = normalizeAccountSet(payload, now, env.FINANCE_TIMEZONE);
  const errors = sanitizeProviderErrors(payload, env.SIMPLEFIN_ACCESS_URL);
  const statements: D1PreparedStatement[] = [];
  const accountSql = `INSERT INTO accounts(id,external_id,connection_id,name,institution,type,currency,balance_cents,available_balance_cents,balance_date,updated_at)
    SELECT json_extract(value,'$.id'),json_extract(value,'$.externalId'),json_extract(value,'$.connectionId'),json_extract(value,'$.name'),
    json_extract(value,'$.institution'),json_extract(value,'$.type'),json_extract(value,'$.currency'),json_extract(value,'$.balanceCents'),
    json_extract(value,'$.availableBalanceCents'),json_extract(value,'$.balanceDate'),json_extract(value,'$.updatedAt') FROM json_each(?) WHERE true
    ON CONFLICT(id) DO UPDATE SET name=excluded.name,institution=excluded.institution,
    type=CASE WHEN accounts.type_override=1 THEN accounts.type ELSE excluded.type END,
    currency=excluded.currency,balance_cents=excluded.balance_cents,available_balance_cents=excluded.available_balance_cents,
    balance_date=excluded.balance_date,updated_at=excluded.updated_at`;
  for (const rows of chunks(accounts, 500)) statements.push(env.DB.prepare(accountSql).bind(JSON.stringify(rows)));
  const transactionSql = `INSERT INTO transactions(id,external_id,account_id,description,amount_cents,currency,date,posted_at,pending,category_id,updated_at)
    SELECT json_extract(value,'$.id'),json_extract(value,'$.externalId'),json_extract(value,'$.accountId'),json_extract(value,'$.description'),
    json_extract(value,'$.amountCents'),json_extract(value,'$.currency'),json_extract(value,'$.date'),json_extract(value,'$.postedAt'),
    json_extract(value,'$.pending'),json_extract(value,'$.categoryId'),json_extract(value,'$.updatedAt') FROM json_each(?) WHERE true
    ON CONFLICT(id) DO UPDATE SET description=excluded.description,amount_cents=excluded.amount_cents,currency=excluded.currency,
    date=excluded.date,posted_at=excluded.posted_at,pending=excluded.pending,
    category_id=CASE WHEN transactions.category_override=1 THEN transactions.category_id ELSE excluded.category_id END,updated_at=excluded.updated_at`;
  for (const rows of chunks(transactions, 750)) statements.push(env.DB.prepare(transactionSql).bind(JSON.stringify(rows)));
  // An incomplete provider response is not evidence that a pending transaction vanished.
  const completeAccountIds = errors.length ? [] : accounts.filter(account => account.hasTransactions).map(account => ({id: account.id}));
  if (completeAccountIds.length) statements.push(env.DB.prepare(`DELETE FROM transactions WHERE pending=1 AND updated_at<>?
    AND account_id IN (SELECT json_extract(value,'$.id') FROM json_each(?))`).bind(now.toISOString(), JSON.stringify(completeAccountIds)));
  statements.push(env.DB.prepare(`INSERT INTO balance_snapshots(date,currency,assets_cents,liabilities_cents,net_worth_cents)
    SELECT ?,currency,SUM(MAX(balance_cents,0)),SUM(MAX(-balance_cents,0)),SUM(balance_cents) FROM accounts GROUP BY currency
    ON CONFLICT(date,currency) DO UPDATE SET assets_cents=excluded.assets_cents,liabilities_cents=excluded.liabilities_cents,net_worth_cents=excluded.net_worth_cents`).bind(localDate(now, env.FINANCE_TIMEZONE)));
  // Keep the last fully successful cursor when an institution fails, so later imports retry its missing history.
  statements.push(env.DB.prepare(`UPDATE sync_metadata SET last_success_at=CASE WHEN ?='success' THEN ? ELSE last_success_at END,status=?,errors_json=?,
    account_count=(SELECT COUNT(*) FROM accounts),transaction_count=(SELECT COUNT(*) FROM transactions) WHERE id=1`)
    .bind(errors.length ? 'partial' : 'success', now.toISOString(), errors.length ? 'partial' : 'success', JSON.stringify(errors)));
  await env.DB.batch(statements);
  return { accounts: accounts.length, transactions: transactions.length };
}

export function simplefinRequestUrl(access: string, start: Date, end: Date) {
  let url: URL;
  try { url = new URL(access); } catch { throw new FinanceError('SimpleFIN is not configured correctly.', 503, 'configuration_error'); }
  if (url.protocol !== 'https:' || !(url.hostname === 'simplefin.org' || url.hostname.endsWith('.simplefin.org')) || (url.port && url.port !== '443') || !url.username || !url.password) {
    throw new FinanceError('SimpleFIN requires a valid HTTPS Bridge access URL.', 503, 'configuration_error');
  }
  const credentials = `${decodeURIComponent(url.username)}:${decodeURIComponent(url.password)}`;
  url.username = ''; url.password = ''; url.hash = ''; url.search = '';
  url.pathname = `${url.pathname.replace(/\/$/, '')}/accounts`;
  url.searchParams.set('start-date', String(Math.floor(start.getTime() / 1000)));
  url.searchParams.set('end-date', String(Math.floor(end.getTime() / 1000)));
  url.searchParams.set('pending', '1');
  return { url, authorization: `Basic ${btoa(credentials)}` };
}

export async function syncFinance(env: Env, now = new Date(), fetcher: typeof fetch = fetch) {
  if (!env.SIMPLEFIN_ACCESS_URL) throw new FinanceError('Add the SimpleFIN access URL to the Worker secrets before syncing.', 503, 'not_configured');
  const prior = await getSync(env, now);
  const lastSuccess = prior.lastSuccessAt ? Date.parse(prior.lastSuccessAt) : 0;
  const start = new Date(Math.max(now.getTime() - MAX_LOOKBACK_DAYS * DAY, lastSuccess ? lastSuccess - 5 * DAY : 0));
  const remote = simplefinRequestUrl(env.SIMPLEFIN_ACCESS_URL, start, now);
  const lock = await env.DB.prepare(`UPDATE sync_metadata SET last_attempt_at=?,status='syncing',errors_json='[]'
    WHERE id=1 AND (last_attempt_at IS NULL OR last_attempt_at<=?)`)
    .bind(now.toISOString(), new Date(now.getTime() - COOLDOWN).toISOString()).run();
  if (!lock.meta.changes) {
    const current = await getSync(env, now);
    throw new FinanceError('SimpleFIN can be refreshed once per hour. Your saved data is still available.', 429, 'sync_cooldown', current.nextAllowedAt ?? undefined);
  }
  try {
    const response = await fetcher(remote.url, { headers: { Authorization: remote.authorization, Accept: 'application/json' }, redirect: 'manual', signal: AbortSignal.timeout(45_000) });
    if (!response.ok) {
      const messages: Record<number, string> = { 402: 'SimpleFIN requires an active subscription.', 403: 'SimpleFIN access was rejected. Check or reconnect your Bridge access.', 429: 'SimpleFIN has reached its request limit. Try again later.' };
      throw new FinanceError(messages[response.status] ?? 'SimpleFIN could not complete this request. Try again later.', 502, 'provider_error');
    }
    const reader = response.body?.getReader();
    if (!reader) throw new FinanceError('SimpleFIN returned an empty response.', 502, 'provider_error');
    const decoder = new TextDecoder(); let body = ''; let bytes = 0;
    while (true) {
      const {done, value} = await reader.read(); if (done) break;
      bytes += value.byteLength;
      if (bytes > 12 * 1024 * 1024) { await reader.cancel(); throw new FinanceError('The SimpleFIN response is too large.', 502, 'import_too_large'); }
      body += decoder.decode(value, {stream: true});
    }
    body += decoder.decode();
    let payload: unknown;
    try { payload = JSON.parse(body); } catch { throw new FinanceError('SimpleFIN returned an unreadable response.', 502, 'provider_error'); }
    const imported = await importAccountSet(env, payload, now);
    return { sync: await getSync(env, now), imported };
  } catch (error) {
    const safe = error instanceof FinanceError ? error : new FinanceError('The sync could not finish. Your saved data has been preserved. Try again later.', 502, 'sync_failed');
    await env.DB.prepare("UPDATE sync_metadata SET status='error',errors_json=? WHERE id=1").bind(JSON.stringify([safe.message])).run();
    throw safe;
  }
}

async function body(request: Request): Promise<Row> {
  if (!(request.headers.get('content-type') ?? '').startsWith('application/json')) throw new FinanceError('Request must use application/json.', 415);
  const text = await request.text();
  if (text.length > 10_000) throw new FinanceError('Request is too large.', 413);
  try { const value = JSON.parse(text); if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(); return value; }
  catch { throw new FinanceError('Request body must be a JSON object.'); }
}
function json(value: unknown, status = 200) { return Response.json(value, {status, headers: {'Cache-Control': 'no-store'}}); }

export async function handleFinanceRequest(request: Request, env: Env): Promise<Response> {
  try {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/api/state') return json(await getState(env, url.searchParams.get('month') || localDate(new Date(), env.FINANCE_TIMEZONE).slice(0, 7)));
    if (request.method === 'GET' && url.pathname === '/api/status') return json({sync: await getSync(env)});
    if (request.method === 'POST' && url.pathname === '/api/sync') return json(await syncFinance(env));
    const txRoute = /^\/api\/transactions\/([A-Za-z0-9_-]+)$/.exec(url.pathname);
    if (request.method === 'PATCH' && txRoute) {
      const changes = await body(request); const fields = Object.keys(changes);
      if (!fields.length || fields.some(field => !['categoryId', 'reviewed', 'notes'].includes(field))) throw new FinanceError('Use categoryId, reviewed, or notes to edit a transaction.');
      const row = await env.DB.prepare('SELECT id FROM transactions WHERE id=?').bind(txRoute[1]).first();
      if (!row) throw new FinanceError('Transaction not found.', 404, 'not_found');
      const sets: string[] = []; const values: (string | number)[] = [];
      if ('categoryId' in changes) {
        if (typeof changes.categoryId !== 'string' || !await env.DB.prepare('SELECT id FROM categories WHERE id=?').bind(changes.categoryId).first()) throw new FinanceError('Choose an existing category.');
        sets.push('category_id=?', 'category_override=1'); values.push(changes.categoryId);
      }
      if ('reviewed' in changes) { if (typeof changes.reviewed !== 'boolean') throw new FinanceError('Reviewed must be true or false.'); sets.push('reviewed=?'); values.push(changes.reviewed ? 1 : 0); }
      if ('notes' in changes) { if (typeof changes.notes !== 'string' || changes.notes.length > 2000) throw new FinanceError('Notes must be no longer than 2,000 characters.'); sets.push('notes=?'); values.push(changes.notes); }
      await env.DB.prepare(`UPDATE transactions SET ${sets.join(',')} WHERE id=?`).bind(...values, txRoute[1]).run();
      return json({transaction: transaction((await env.DB.prepare(`${TRANSACTION_SELECT} WHERE id=?`).bind(txRoute[1]).first<Row>())!)});
    }
    const budgetRoute = /^\/api\/budgets\/([a-z-]+)$/.exec(url.pathname);
    if (request.method === 'PUT' && budgetRoute) {
      const changes = await body(request);
      if (typeof changes.month !== 'string' || !validMonth(changes.month)) throw new FinanceError('Month must use YYYY-MM format.');
      if (!Number.isSafeInteger(changes.amountCents) || Number(changes.amountCents) < 0 || Number(changes.amountCents) > 100_000_000_000) throw new FinanceError('Budget must be a nonnegative amount in cents.');
      if (!await env.DB.prepare("SELECT id FROM categories WHERE id=? AND kind='expense'").bind(budgetRoute[1]).first()) throw new FinanceError('Budgets are available for expense categories.');
      await env.DB.prepare('INSERT INTO budgets(month,category_id,amount_cents) VALUES(?,?,?) ON CONFLICT(month,category_id) DO UPDATE SET amount_cents=excluded.amount_cents').bind(changes.month, budgetRoute[1], changes.amountCents).run();
      return json({budget: {categoryId: budgetRoute[1], month: changes.month, amountCents: changes.amountCents}});
    }
    const accountRoute = /^\/api\/accounts\/([A-Za-z0-9_-]+)$/.exec(url.pathname);
    if (request.method === 'PATCH' && accountRoute) {
      const changes = await body(request);
      if (Object.keys(changes).some(field => field !== 'type') || !['cash','investment','asset','credit','loan'].includes(String(changes.type))) throw new FinanceError('Choose a valid account type.');
      const result = await env.DB.prepare('UPDATE accounts SET type=?,type_override=1 WHERE id=?').bind(changes.type, accountRoute[1]).run();
      if (!result.meta.changes) throw new FinanceError('Account not found.', 404, 'not_found');
      return json({account: await env.DB.prepare(`${ACCOUNT_SELECT} WHERE id=?`).bind(accountRoute[1]).first()});
    }
    return json({error: 'Endpoint not found.', code: 'not_found'}, 404);
  } catch (error) {
    if (error instanceof FinanceError) return json({error: error.message, code: error.code, ...(error.nextAllowedAt ? {nextAllowedAt: error.nextAllowedAt} : {})}, error.status);
    return json({error: 'The request could not be completed. Please try again.', code: 'internal_error'}, 500);
  }
}
