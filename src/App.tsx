import { batch, createEffect, createMemo, createSignal, For, Match, on, onCleanup, onMount, Show, Switch, type JSX } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { ArrowDownLeft, ArrowUpRight, ArrowLeftRight, BarChart3, Check, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, CircleHelp, Clock, CreditCard, Download, Eye, EyeOff, Landmark, LayoutDashboard, Loader2, LockKeyhole, LogOut, Menu, RefreshCw, Search, Settings2, ShieldCheck, Sprout, Wallet, X } from 'lucide-solid';
import type { AccountType, FinanceState, Page, Transaction } from './types';
import { currentMonth, money, monthName, relativeDate, shortDate } from './format';
import { Insights, RecurringView } from './Insights';
import ChartCanvas from './ChartCanvas';
import type { ChartOptions } from 'chart.js';

type Icon = typeof Wallet;
const navigation: { id: Page; label: string; icon: Icon }[] = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'transactions', label: 'Transactions', icon: ArrowLeftRight },
  { id: 'accounts', label: 'Accounts', icon: Landmark },
  { id: 'budgets', label: 'Budget', icon: Wallet },
  { id: 'insights', label: 'Insights', icon: BarChart3 },
  { id: 'recurring', label: 'Recurring', icon: RefreshCw },
];
const typeLabels: Record<AccountType, string> = { cash: 'Cash & savings', investment: 'Investments', asset: 'Other assets', credit: 'Credit cards', loan: 'Loans' };
const typeOptions = Object.entries(typeLabels).map(([value, label]) => ({ value, label }));
const accountTypes = Object.keys(typeLabels) as AccountType[];
const subtitles: Record<Page, string> = {
  overview: 'A clear picture of where you are, and where you’re going.',
  transactions: 'The everyday details behind the bigger picture.',
  accounts: 'All the pieces of your financial life, together.',
  budgets: 'Make a little room for what matters.',
  insights: 'Follow the patterns. Find your balance.',
  recurring: 'Keep an eye on the expenses that come around again.',
  settings: 'Your connection, your data, your workspace.',
};

async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const response = await fetch(`/api${path}`, { ...options, headers, credentials: 'same-origin' });
  const result = await response.json().catch(() => ({ error: 'The server returned an unexpected response.' }));
  if (!response.ok) {
    if (response.status === 401 && path !== '/auth/login') window.dispatchEvent(new Event('session-expired'));
    const message = result && typeof result === 'object' && 'error' in result && typeof result.error === 'string' ? result.error : 'Something went wrong. Please try again.';
    throw new Error(message);
  }
  return result as T;
}

function syncLabel(sync: FinanceState['sync'] | undefined): string {
  if (!sync) return 'Loading connection…';
  if (sync.status === 'partial') return sync.lastAttemptAt ? `Synced with a SimpleFIN message ${relativeDate(sync.lastAttemptAt)}` : 'Synced with a SimpleFIN message';
  if (sync.status === 'syncing') return 'Sync in progress';
  if (sync.status === 'error' || sync.status === 'interrupted') return 'Last sync needs attention';
  if (sync.lastSuccessAt) return `Synced ${relativeDate(sync.lastSuccessAt)}`;
  return sync.configured ? 'Ready to sync' : 'Connection setup needed';
}

function Brand(props: { small?: boolean }) {
  return <div class={`brand ${props.small ? 'brand-small' : ''}`}><Sprout class="brand-mark" size={33} strokeWidth={1.3} aria-hidden="true" /><span class="wordmark">Meezaniyah</span></div>;
}
function Empty(props: { icon?: Icon; title: string; children: JSX.Element; action?: JSX.Element }) {
  return <div class="empty"><div class="empty-icon"><Dynamic component={props.icon ?? Wallet} size={25} strokeWidth={1.5} /></div><h3>{props.title}</h3><p>{props.children}</p>{props.action}</div>;
}
function Panel(props: { title?: string; eyebrow?: string; action?: JSX.Element; children: JSX.Element; className?: string }) {
  return <section class={`panel ${props.className ?? ''}`}><Show when={props.title || props.eyebrow || props.action}><div class="panel-heading"><div><Show when={props.eyebrow}><p class="eyebrow">{props.eyebrow}</p></Show><Show when={props.title}><h2>{props.title}</h2></Show></div>{props.action}</div></Show>{props.children}</section>;
}

function Select(props: { value: string; onChange: (value: string) => void; options: { value: string; label: string }[]; label: string; disabled?: boolean }) {
  const [open, setOpen] = createSignal(false);
  let ref!: HTMLDivElement;
  let trigger!: HTMLButtonElement;
  createEffect(() => {
    if (!open()) return;
    const close = (event: MouseEvent) => { if (!ref.contains(event.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    onCleanup(() => document.removeEventListener('mousedown', close));
  });
  const focusOption = (last = false) => {
    const items = Array.from(ref.querySelectorAll<HTMLButtonElement>('[role="option"]'));
    (last ? items.at(-1) : items[0])?.focus();
  };
  return <div ref={ref} class="select" onKeyDown={event => {
    if (event.key === 'Escape' && open()) { event.preventDefault(); event.stopPropagation(); setOpen(false); trigger.focus(); }
    if (event.key === 'Tab') setOpen(false);
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open()) { setOpen(true); queueMicrotask(() => focusOption(event.key === 'ArrowUp')); return; }
      const items = Array.from(ref.querySelectorAll<HTMLButtonElement>('[role="option"]'));
      const current = items.indexOf(document.activeElement as HTMLButtonElement);
      items[(current + (event.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]?.focus();
    }
  }}>
    <button ref={trigger} type="button" class="select-trigger" aria-label={props.label} aria-haspopup="listbox" aria-expanded={open()} onClick={() => setOpen(value => !value)} disabled={props.disabled}>
      {props.options.find(option => option.value === props.value)?.label || props.label}<ChevronDown size={14} />
    </button>
    <Show when={open()}><div class="select-options" role="listbox" aria-label={props.label}><For each={props.options}>{option => <button type="button" role="option" aria-selected={option.value === props.value} onClick={() => { props.onChange(option.value); setOpen(false); trigger.focus(); }}>{option.label}<Show when={option.value === props.value}><Check size={14} /></Show></button>}</For></div></Show>
  </div>;
}

function Login(props: { onLogin: () => void }) {
  const [password, setPassword] = createSignal('');
  const [visible, setVisible] = createSignal(false);
  const [error, setError] = createSignal('');
  const [busy, setBusy] = createSignal(false);
  let input!: HTMLInputElement;
  onMount(() => input.focus());
  async function submit(event: SubmitEvent) {
    event.preventDefault();
    if (busy()) return;
    batch(() => { setBusy(true); setError(''); });
    try { await api('/auth/login', { method: 'POST', body: JSON.stringify({ password: password() }) }); setPassword(''); props.onLogin(); }
    catch (error) { setError((error as Error).message); }
    finally { setBusy(false); }
  }
  return <div class="login-page">
    <aside class="sidebar login-sidebar"><Brand /><div class="login-navigation" aria-label="Workspace areas available after sign-in"><div class="nav-item active"><LockKeyhole size={18} /><span>Sign In</span></div><For each={navigation}>{item => <div class="nav-item informational"><Dynamic component={item.icon} size={18} strokeWidth={1.6} /><span>{item.label}</span></div>}</For></div><Sprout class="sidebar-botanical" size={220} strokeWidth={0.65} aria-hidden="true" /><div class="sidebar-bottom"><div class="nav-item informational"><Settings2 size={18} /><span>Settings</span></div><p class="sidebar-mantra">A calmer relationship<br />with money.<br />Brighter tomorrows.</p><span class="sidebar-gold-rule" /></div></aside>
    <main class="login-main"><div class="login-intro"><p class="eyebrow">Discipline today. A richer tomorrow.</p><h1>Welcome to<br /><em>Meezaniyah</em></h1><p class="login-description">Your private space to manage money, make intentional decisions, and build a more peaceful future.</p><div class="login-botanical" aria-hidden="true"><Sprout size={260} strokeWidth={0.7} /></div><div class="login-quote"><span /><p>Make room for<br /><em>what matters.</em></p></div></div>
      <form class="login-form" onSubmit={submit}><div class="login-form-brand"><Sprout size={56} strokeWidth={1.1} aria-hidden="true" /><h2>Meezaniyah</h2><p class="eyebrow">A quieter, brighter financial life</p><span class="login-gold-rule" /></div><label for="password">Workspace passphrase</label><div class="passphrase-field"><LockKeyhole size={19} aria-hidden="true" /><input ref={input} id="password" type={visible() ? 'text' : 'password'} autocomplete="current-password" value={password()} onInput={event => setPassword(event.currentTarget.value)} required placeholder="Enter your workspace passphrase" disabled={busy()} /><button class="icon-button" type="button" aria-label={visible() ? 'Hide passphrase' : 'Show passphrase'} aria-pressed={visible()} onClick={() => setVisible(value => !value)}>{visible() ? <EyeOff size={19} /> : <Eye size={19} />}</button></div><Show when={error()}><div role="alert" class="form-error">{error()}</div></Show><button class="button primary login-submit" type="submit" disabled={busy() || !password()}>{busy() ? <><Loader2 class="spin" size={17} />Signing in…</> : <>Open my workspace<ArrowUpRight size={19} /></>}</button><div class="login-trust"><div class="trust-divider"><span /><ShieldCheck size={22} /><span /></div><h3>Your financial life stays private</h3><p>Sign in to see your balances and transactions. Your bank connection is read-only, and your SimpleFIN credential stays on the server.</p><div class="login-note"><Sprout size={21} /><span>Private workspace · Read-only bank access</span></div></div></form>
    </main>
  </div>;
}

function MonthPicker(props: { value: string; onChange: (value: string) => void }) {
  function move(delta: number) { const date = new Date(`${props.value}-15T12:00:00`); date.setMonth(date.getMonth() + delta); props.onChange(`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`); }
  const options = createMemo(() => {
    const months = Array.from({ length: 25 }, (_, index) => { const date = new Date(); date.setDate(15); date.setMonth(date.getMonth() - index); const month = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`; return { value: month, label: monthName(month) }; });
    if (!months.some(option => option.value === props.value)) months.push({ value: props.value, label: monthName(props.value) });
    return months;
  });
  return <div class="month-picker"><button class="icon-button" aria-label="Previous month" onClick={() => move(-1)}><ChevronLeft size={17} /></button><Select label="Choose month" value={props.value} onChange={props.onChange} options={options()} /><button class="icon-button" aria-label="Next month" onClick={() => move(1)} disabled={props.value >= currentMonth()}><ChevronRight size={17} /></button></div>;
}

function NetWorth(props: { data: FinanceState }) {
  const summary = () => props.data.summary;
  const points = createMemo(() => props.data.snapshots.slice(-90));
  const chart = createMemo(() => ({
    labels: points().map(point => shortDate(point.date)),
    datasets: [{ data: points().map(point => point.netWorthCents), borderColor: '#2f6753', borderWidth: 2.5, pointRadius: 0, fill: false, tension: 0.18 }],
  }));
  const amounts = createMemo(() => (['cash', 'investment', 'asset'] as AccountType[]).map(type => ({ type, label: typeLabels[type], value: props.data.accounts.filter(account => account.currency === props.data.reportingCurrency && account.type === type).reduce((sum, account) => sum + Math.max(account.balanceCents, 0), 0) })));
  return <Panel className="networth-panel" eyebrow="The bigger picture" title="Net worth" action={<span class="quiet-label">{props.data.reportingCurrency}</span>}>
    <div class="networth-number">{money(summary().netWorthCents, props.data.reportingCurrency, true)}</div>
    <div class="networth-sub"><Show when={points().length > 1} fallback="Your assets, less what you owe"><span class={summary().netWorthCents - points()[0].netWorthCents >= 0 ? 'positive' : 'negative'}>{money(summary().netWorthCents - points()[0].netWorthCents, props.data.reportingCurrency, true)}</span> since {shortDate(points()[0].date)}</Show></div>
    <Show when={points().length > 1} fallback={<div class="worth-baseline"><div class="baseline-track"><span /></div><p>{props.data.accounts.length ? 'Today is your starting point. Your net worth history builds with each daily sync.' : 'Connect your accounts to start your net worth history.'}</p></div>}>
      <div class="networth-chart"><div class="networth-canvas" style={{ position: 'relative', height: '125px' }}><ChartCanvas type="line" data={chart()} label="Net worth history" options={{ scales: { x: { display: false }, y: { display: false } }, plugins: { tooltip: { callbacks: { label: context => money(Number(context.raw), props.data.reportingCurrency) } } } }} /></div><div class="chart-axis"><span>{shortDate(points()[0].date)}</span><span>{shortDate(points().at(-1)!.date)}</span></div></div>
    </Show>
    <div class="wealth-composition" aria-label="Asset composition"><For each={amounts().filter(amount => amount.value > 0)}>{amount => <div class={`composition-${amount.type}`} style={{ flex: String(amount.value) }} title={`${amount.label}: ${money(amount.value)}`} />}</For><Show when={!amounts().some(amount => amount.value > 0)}><div class="composition-empty" /></Show></div>
    <div class="worth-details"><For each={amounts()}>{amount => <div><span><i class={`dot composition-${amount.type}`} />{amount.label}</span><strong>{money(amount.value, props.data.reportingCurrency, true)}</strong></div>}</For><div><span><i class="dot composition-debt" />Liabilities</span><strong>{money(summary().liabilitiesCents, props.data.reportingCurrency, true)}</strong></div></div>
  </Panel>;
}

function CashFlow(props: { data: FinanceState; onInsights: () => void }) {
  const summary = () => props.data.summary;
  const total = () => Math.max(summary().incomeCents, summary().expensesCents, 1);
  return <Panel className="cashflow-panel" eyebrow="This month's movement" title="Money in, money out"><div class="flow-stat"><div class="flow-icon income"><ArrowDownLeft size={19} /></div><div><span>Income</span><strong>{money(summary().incomeCents)}</strong></div></div><div class="flow-track"><span class="flow-income" style={{ width: `${Math.max(0, summary().incomeCents) / total() * 100}%` }} /></div><div class="flow-stat"><div class="flow-icon expenses"><ArrowUpRight size={19} /></div><div><span>Spending</span><strong>{money(summary().expensesCents)}</strong></div></div><div class="flow-track"><span class="flow-expense" style={{ width: `${Math.max(0, summary().expensesCents) / total() * 100}%` }} /></div><div class="cashflow-bottom"><div><span>Left after spending</span><strong class={summary().cashFlowCents < 0 ? 'negative' : 'positive'}>{money(summary().cashFlowCents)}</strong></div><button class="text-button" onClick={() => props.onInsights()}>Explore cash flow<ChevronRight size={15} /></button></div></Panel>;
}

function TransactionRows(props: { transactions: Transaction[]; data: FinanceState; onSelect: (transaction: Transaction) => void; selectedId?: string }) {
  const categories = createMemo(() => new Map(props.data.categories.map(category => [category.id, category])));
  const accounts = createMemo(() => new Map(props.data.accounts.map(account => [account.id, account])));
  return <div class="transaction-list"><For each={props.transactions}>{transaction => {
    const category = () => categories().get(transaction.categoryId);
    const account = () => accounts().get(transaction.accountId);
    return <button class={`transaction-row ${props.selectedId === transaction.id ? 'is-selected' : ''}`} aria-pressed={props.selectedId === transaction.id} onClick={() => props.onSelect(transaction)}><span class="transaction-date">{shortDate(transaction.date)}</span><span class="transaction-identity"><span class={`merchant-avatar ${category()?.kind === 'transfer' ? 'transfer' : ''}`}>{category()?.kind === 'transfer' ? <ArrowLeftRight size={17} /> : transaction.description.slice(0, 1).toUpperCase()}</span><span class="transaction-merchant"><strong>{transaction.description}</strong><span>{category()?.name || 'Uncategorized'}{transaction.pending ? ' · Pending' : ''}</span></span></span><span class="transaction-account">{account()?.name || 'Account'}</span><span class="transaction-category"><span class="category-dot" style={{ 'background-color': category()?.color || 'var(--muted)' }} />{category()?.name || 'Uncategorized'}</span><span class={`transaction-amount ${transaction.amountCents > 0 ? 'positive' : category()?.kind === 'transfer' ? '' : 'negative'}`}>{transaction.amountCents > 0 ? '+' : ''}{money(transaction.amountCents, transaction.currency)}</span><span class={`review-indicator ${transaction.reviewed ? 'is-reviewed' : ''}`} title={transaction.reviewed ? 'Reviewed' : transaction.pending ? 'Pending' : 'Needs review'} aria-label={transaction.reviewed ? 'Reviewed' : transaction.pending ? 'Pending' : 'Needs review'}>{transaction.reviewed ? <CheckCircle2 size={18} /> : transaction.pending ? <Clock size={17} aria-hidden="true" /> : <i />}</span></button>;
  }}</For></div>;
}

function Spending(props: { data: FinanceState; onBudget: () => void }) {
  const spending = createMemo(() => props.data.summary.spendingByCategory.filter(item => item.spentCents > 0).sort((left, right) => right.spentCents - left.spentCents));
  const total = createMemo(() => spending().reduce((sum, category) => sum + category.spentCents, 0));
  const segments = createMemo(() => spending().map(item => ({ ...item, category: props.data.categories.find(category => category.id === item.categoryId) })));
  const chart = createMemo(() => ({
    labels: segments().map(segment => segment.category?.name || 'Uncategorized'),
    datasets: [{ data: segments().map(segment => segment.spentCents), backgroundColor: segments().map(segment => segment.category?.color || '#2f6753'), borderWidth: 0, spacing: 3 }],
  }));
  return <Panel title="Where it went" action={<button class="text-button" onClick={() => props.onBudget()}>View budget<ChevronRight size={14} /></button>}>
    <Show when={total() > 0} fallback={<Empty icon={BarChart3} title="A fresh start">Your spending breakdown will appear here as transactions arrive.</Empty>}>
      <div class="spending-donut"><div class="spending-canvas" style={{ position: 'relative', width: '180px', height: '180px' }}><ChartCanvas type="doughnut" data={chart()} label="Spending by category" options={{ cutout: '82%', plugins: { tooltip: { callbacks: { label: context => `${context.label}: ${money(Number(context.raw), props.data.reportingCurrency)}` } } } } as ChartOptions<'doughnut'>} /></div><div class="spending-donut-label"><span>Total spending</span><strong>{money(props.data.summary.expensesCents, props.data.reportingCurrency, true)}</strong></div></div>
      <div class="spending-legend"><For each={segments().slice(0, 4)}>{segment => <div><span><i style={{ 'background-color': segment.category?.color }} />{segment.category?.name || 'Uncategorized'}</span><strong>{money(segment.spentCents)}</strong></div>}</For><Show when={spending().length > 4}><div><span>Other categories</span><strong>{money(spending().slice(4).reduce((sum, item) => sum + item.spentCents, 0))}</strong></div></Show></div>
    </Show>
  </Panel>;
}

function Overview(props: { data: FinanceState; navigate: (page: Page, needsReview?: boolean) => void; onSelect: (transaction: Transaction) => void; onSync: () => void; syncing: boolean }) {
  const recent = createMemo(() => props.data.transactions.filter(transaction => transaction.date.startsWith(props.data.month)).slice(0, 6));
  return <><div class="overview-top"><NetWorth data={props.data} /><CashFlow data={props.data} onInsights={() => props.navigate('insights')} /></div>
    <Show when={props.data.summary.reviewCount > 0}><button class="review-banner" onClick={() => props.navigate('transactions', true)}><span class="review-banner-icon"><Eye size={19} /></span><span><strong>A little attention, a clearer picture.</strong><span>{props.data.summary.reviewCount} transactions are ready for you to review.</span></span><span class="review-banner-action">Review transactions<ChevronRight size={16} /></span></button></Show>
    <div class="overview-bottom"><Panel className="recent-panel" title="Recent transactions" action={<button class="text-button" onClick={() => props.navigate('transactions')}>View all<ChevronRight size={14} /></button>}>
      <Show when={recent().length} fallback={<Empty icon={ArrowLeftRight} title={props.data.accounts.length ? 'No transactions this month' : 'Let’s bring everything together'} action={!props.data.accounts.length ? <button class="button primary" onClick={() => props.onSync()} disabled={props.syncing}>{props.syncing ? <Loader2 class="spin" size={16} /> : <RefreshCw size={16} />}Sync with SimpleFIN</button> : undefined}>{props.data.accounts.length ? 'Try another month to explore your imported history.' : 'Your SimpleFIN connection is ready. Import your accounts and up to 45 days of available transactions.'}</Empty>}><TransactionRows transactions={recent()} data={props.data} onSelect={props.onSelect} /></Show><div class="panel-footnote">Posted transactions make up your spending. Transfers are excluded.</div>
    </Panel><Spending data={props.data} onBudget={() => props.navigate('budgets')} /></div></>;
}

function Transactions(props: { data: FinanceState; onSelect: (transaction: Transaction) => void; needsReview: boolean; selectedId?: string }) {
  const [query, setQuery] = createSignal('');
  const [account, setAccount] = createSignal('all');
  const [category, setCategory] = createSignal('all');
  const [review, setReview] = createSignal(props.needsReview ? 'review' : 'all');
  const [limit, setLimit] = createSignal(50);
  createEffect(on(() => props.needsReview, value => setReview(value ? 'review' : 'all'), { defer: true }));
  const filtered = createMemo(() => props.data.transactions.filter(transaction => transaction.date.startsWith(props.data.month) && (account() === 'all' || transaction.accountId === account()) && (category() === 'all' || transaction.categoryId === category()) && (review() === 'all' || (review() === 'review' ? !transaction.reviewed : transaction.pending)) && `${transaction.description} ${transaction.notes}`.toLowerCase().includes(query().trim().toLowerCase())));
  createEffect(on([query, account, category, review, () => props.data.month], () => setLimit(50)));
  function download() {
    const rows = [['Date', 'Description', 'Account', 'Category', 'Amount', 'Currency', 'Pending', 'Reviewed', 'Notes'], ...filtered().map(transaction => [transaction.date, transaction.description, props.data.accounts.find(account => account.id === transaction.accountId)?.name || '', props.data.categories.find(category => category.id === transaction.categoryId)?.name || '', (transaction.amountCents / 100).toFixed(2), transaction.currency, String(transaction.pending), String(transaction.reviewed), transaction.notes])];
    const escaped = rows.map(row => row.map(value => `"${(/^[=+@\-\t\r]/.test(value) ? "'" : '') + value.replaceAll('"', '""')}"`).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([escaped], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = `meezaniyah-${props.data.month}.csv`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <Panel className="ledger-panel"><div class="ledger-tools"><div class="search-input"><Search size={17} /><input aria-label="Search transactions" placeholder="Search transactions or notes…" value={query()} onInput={event => setQuery(event.currentTarget.value)} /><Show when={query()}><button class="icon-button" aria-label="Clear search" onClick={() => setQuery('')}><X size={14} /></button></Show></div><button class="button secondary" onClick={download} disabled={!filtered().length}><Download size={15} />Export</button></div>
    <div class="ledger-filters"><Select label="Filter account" value={account()} onChange={setAccount} options={[{ value: 'all', label: 'All accounts' }, ...props.data.accounts.map(account => ({ value: account.id, label: account.name }))]} /><Select label="Filter category" value={category()} onChange={setCategory} options={[{ value: 'all', label: 'All categories' }, ...props.data.categories.map(category => ({ value: category.id, label: category.name }))]} /><Select label="Review status" value={review()} onChange={setReview} options={[{ value: 'all', label: 'Any status' }, { value: 'review', label: 'Needs review' }, { value: 'pending', label: 'Pending' }]} /><span>{filtered().length} transactions</span></div>
    <div class="ledger-header"><span>Date</span><span>Merchant</span><span>Account</span><span>Category</span><span>Amount</span><span>Review</span></div><Show when={filtered().length} fallback={<Empty icon={Search} title="No matching transactions">Try a different month or adjust your filters.</Empty>}><TransactionRows transactions={filtered().slice(0, limit())} data={props.data} onSelect={props.onSelect} selectedId={props.selectedId} /></Show><Show when={filtered().length > limit()}><div class="load-more"><button class="button secondary" onClick={() => setLimit(value => value + 50)}>Show more transactions</button><span>Showing {limit()} of {filtered().length}</span></div></Show>
  </Panel>;
}

function Accounts(props: { data: FinanceState; onUpdate: (id: string, type: AccountType) => Promise<void> }) {
  const [busy, setBusy] = createSignal<string | null>(null);
  const [error, setError] = createSignal('');
  async function update(id: string, type: string) { setBusy(id); setError(''); try { await props.onUpdate(id, type as AccountType); } catch (error) { setError((error as Error).message); } finally { setBusy(null); } }
  return <><div class="account-summary"><div><span>Total assets</span><strong>{money(props.data.summary.assetsCents, props.data.reportingCurrency, true)}</strong></div><div><span>Total liabilities</span><strong>{money(props.data.summary.liabilitiesCents, props.data.reportingCurrency, true)}</strong></div><div><span>Net worth</span><strong class="positive">{money(props.data.summary.netWorthCents, props.data.reportingCurrency, true)}</strong></div></div><Show when={error()}><div class="alert" role="alert">{error()}</div></Show>
    <Show when={props.data.accounts.length} fallback={<Panel><Empty icon={Landmark} title="Your accounts belong together">Use Sync accounts to connect your SimpleFIN balances and transaction history.</Empty></Panel>}><For each={accountTypes}>{type => {
      const accounts = createMemo(() => props.data.accounts.filter(account => account.type === type));
      return <Show when={accounts().length}><Panel className="account-group" title={typeLabels[type]} action={<span class="quiet-label">{accounts().length} account{accounts().length === 1 ? '' : 's'}</span>}><For each={accounts()}>{account => <div class="account-row"><div class={`institution-mark institution-${type}`}>{type === 'credit' ? <CreditCard size={20} /> : <Landmark size={20} />}</div><div class="account-name"><strong>{account.name}</strong><span>{account.institution} · Updated {account.balanceDate ? shortDate(account.balanceDate) : 'recently'}</span></div><Select label={`Account type for ${account.name}`} value={account.type} onChange={next => void update(account.id, next)} options={typeOptions} disabled={busy() !== null} /><div class="account-balance"><strong>{money(account.balanceCents, account.currency)}</strong><span>{account.currency}{account.availableBalanceCents !== null ? ` · ${money(account.availableBalanceCents, account.currency)} available` : ''}</span></div></div>}</For></Panel></Show>;
    }}</For></Show><p class="page-note"><CircleHelp size={15} />Account types are inferred from names. Adjust them here if needed. Combined totals use USD; other currencies stay separate.</p><For each={props.data.summary.byCurrency.filter(currency => currency.currency !== 'USD')}>{currency => <div class="currency-total"><span>{currency.currency} net worth</span><strong>{money(currency.netWorthCents, currency.currency)}</strong></div>}</For></>;
}

function BudgetRow(props: { budget: FinanceState['budgets'][number]; category: FinanceState['categories'][number]; onSave: (id: string, cents: number) => Promise<void> }) {
  const [value, setValue] = createSignal((props.budget.amountCents / 100).toFixed(2));
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal('');
  createEffect(on([() => props.budget.amountCents, () => props.budget.month], ([amount]) => { setValue((amount / 100).toFixed(2)); setError(''); }));
  const dirty = () => Math.round(Number(value()) * 100) !== props.budget.amountCents;
  const percent = () => props.budget.amountCents > 0 ? Math.min(100, Math.max(0, props.budget.spentCents) / props.budget.amountCents * 100) : 0;
  const over = () => props.budget.spentCents > props.budget.amountCents && props.budget.spentCents > 0;
  async function submit(event: SubmitEvent) {
    event.preventDefault(); if (busy()) return;
    const cents = Math.round(Number(value()) * 100);
    if (!/^\d+(\.\d{0,2})?$/.test(value()) || !Number.isSafeInteger(cents)) { setError('Use a positive amount with up to two decimals.'); return; }
    batch(() => { setBusy(true); setError(''); });
    try { await props.onSave(props.category.id, cents); } catch (error) { setError((error as Error).message); } finally { setBusy(false); }
  }
  return <div class="budget-row"><div class="budget-category"><span class="category-symbol" style={{ color: props.category.color }}><Wallet size={18} /></span><div><strong>{props.category.name}</strong><div class="budget-track"><span style={{ width: `${percent()}%`, background: over() ? 'var(--red)' : props.category.color }} /></div></div></div><form onSubmit={submit} class="budget-input"><span>$</span><input aria-label={`${props.category.name} monthly budget`} inputmode="decimal" value={value()} onInput={event => setValue(event.currentTarget.value)} disabled={busy()} /><Show when={dirty()}><button class="icon-button" type="submit" aria-label={`Save ${props.category.name} budget`} disabled={busy()}>{busy() ? <Loader2 size={15} class="spin" /> : <Check size={15} />}</button></Show><Show when={error()}><span class="budget-error" role="alert">{error()}</span></Show></form><span class="budget-spent">{money(props.budget.spentCents)}</span><span class={`budget-remaining ${over() ? 'negative' : ''}`}>{props.budget.amountCents === 0 && props.budget.spentCents === 0 ? '—' : money(props.budget.remainingCents)}</span></div>;
}

function Budgets(props: { data: FinanceState; onSave: (id: string, cents: number) => Promise<void> }) {
  const summary = () => props.data.summary;
  const groups = createMemo(() => [...new Set(props.data.categories.filter(category => category.kind === 'expense').map(category => category.group))]);
  return <><div class="budget-overview"><div><p class="eyebrow">Give your money a plan</p><h2>{summary().budgetedCents > 0 ? money(summary().budgetRemainingCents, props.data.reportingCurrency, true) : 'A month with intention.'}</h2><p>{summary().budgetedCents > 0 ? 'left in your category budgets' : 'Set an amount beside each category to build your monthly budget.'}</p></div><div class="budget-overview-stats"><div><span>Planned</span><strong>{money(summary().budgetedCents)}</strong></div><div><span>Spent in budgeted categories</span><strong>{money(summary().budgetSpentCents)}</strong></div></div></div><Panel className="budget-panel"><div class="budget-table-head"><span>Category</span><span>Monthly plan</span><span>Spent</span><span>Remaining</span></div><For each={groups()}>{group => <div class="budget-group"><h3>{group}</h3><For each={props.data.categories.filter(category => category.kind === 'expense' && category.group === group).map(category => category.id)}>{id => <BudgetRow category={props.data.categories.find(category => category.id === id)!} budget={props.data.budgets.find(budget => budget.categoryId === id) || { categoryId: id, month: props.data.month, amountCents: 0, spentCents: 0, remainingCents: 0 }} onSave={props.onSave} />}</For></div>}</For><div class="panel-footnote">Budgets are saved per month. Posted spending and refunds count; transfers and pending charges do not.</div></Panel></>;
}

function Settings(props: { data: FinanceState; onSync: () => void; syncing: boolean; onLogout: () => void }) {
  return <div class="settings-grid"><Panel title="Your bank connection"><div class="connection-card"><div class="connection-icon"><ArrowLeftRight size={24} /></div><div><h3>SimpleFIN Bridge</h3><p>{props.data.sync.configured ? 'Connected securely' : 'Connection needs setup'}</p></div><span class={`badge ${props.data.sync.configured ? 'badge-green' : ''}`}>{props.data.sync.configured ? 'Read-only' : 'Not configured'}</span></div><dl class="settings-details"><div><dt>Last successful sync</dt><dd>{props.data.sync.lastSuccessAt ? new Date(props.data.sync.lastSuccessAt).toLocaleString() : 'No fully successful sync yet'}</dd></div><div><dt>Latest sync attempt</dt><dd>{props.data.sync.lastAttemptAt ? new Date(props.data.sync.lastAttemptAt).toLocaleString() : 'Not attempted yet'}</dd></div><div><dt>Latest result</dt><dd>{props.data.sync.status === 'partial' ? 'Accounts imported with a SimpleFIN message' : props.data.sync.status === 'success' ? 'Completed' : props.data.sync.status === 'error' || props.data.sync.status === 'interrupted' ? 'Needs attention' : props.data.sync.status === 'syncing' ? 'In progress' : 'Ready to sync'}</dd></div><div><dt>Connected accounts</dt><dd>{props.data.accounts.length}</dd></div><div><dt>Imported transactions</dt><dd>{props.data.transactions.length.toLocaleString()}</dd></div><div><dt>Sync frequency</dt><dd>On demand · once per hour</dd></div></dl><p class="settings-help">Each sync refreshes balances and recent transactions. Your first sync imports up to 45 days, depending on what your bank makes available.</p><button class="button primary" onClick={() => props.onSync()} disabled={props.syncing || !props.data.sync.configured}>{props.syncing ? <Loader2 size={16} class="spin" /> : <RefreshCw size={16} />}Sync now</button><Show when={props.data.sync.errors.length}><div class="sync-errors" role="status"><For each={props.data.sync.errors}>{error => <p>{error}</p>}</For></div></Show></Panel><Panel title="Your workspace"><dl class="settings-details"><div><dt>Storage</dt><dd>Cloudflare D1</dd></div><div><dt>Reporting currency</dt><dd>USD</dd></div><div><dt>Bank access</dt><dd>Balances & transactions only</dd></div></dl><div class="privacy-note"><ShieldCheck size={22} /><p>Your SimpleFIN credential is held by the server. It is never sent to the browser.</p></div><button class="button secondary" onClick={() => props.onLogout()}><LogOut size={16} />Sign out</button></Panel></div>;
}

function TransactionDetail(props: { transaction: Transaction; data: FinanceState; onClose: () => void; onSave: (id: string, patch: Partial<Transaction>) => Promise<void> }) {
  const [category, setCategory] = createSignal(props.transaction.categoryId);
  const [notes, setNotes] = createSignal(props.transaction.notes);
  const [reviewed, setReviewed] = createSignal(props.transaction.reviewed);
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal('');
  const [docked, setDocked] = createSignal(window.matchMedia('(min-width: 1200px)').matches);
  let ref!: HTMLDivElement;
  const close = () => { if (!busy()) props.onClose(); };
  createEffect(() => {
    if (docked()) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    onCleanup(() => { document.body.style.overflow = previousOverflow; });
  });
  onMount(() => {
    const previous = document.activeElement as HTMLElement | null;
    const media = window.matchMedia('(min-width: 1200px)');
    const resize = () => setDocked(media.matches);
    media.addEventListener('change', resize);
    ref.querySelector<HTMLButtonElement>('button')?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) close();
      if (event.key !== 'Tab' || docked()) return;
      const elements = Array.from(ref.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled]),textarea:not([disabled]),[tabindex="0"]')).filter(element => element.getClientRects().length > 0);
      if (!elements.length) { event.preventDefault(); ref.focus(); return; }
      if (event.shiftKey && (document.activeElement === elements[0] || !ref.contains(document.activeElement))) { event.preventDefault(); elements.at(-1)?.focus(); }
      else if (!event.shiftKey && (document.activeElement === elements.at(-1) || !ref.contains(document.activeElement))) { event.preventDefault(); elements[0]?.focus(); }
    };
    document.addEventListener('keydown', key);
    onCleanup(() => { document.removeEventListener('keydown', key); media.removeEventListener('change', resize); if (previous?.isConnected) previous.focus(); });
  });
  async function submit(event: SubmitEvent) {
    event.preventDefault(); if (busy()) return;
    batch(() => { setBusy(true); setError(''); });
    try { await props.onSave(props.transaction.id, { categoryId: category(), notes: notes(), reviewed: reviewed() }); props.onClose(); }
    catch (error) { setError((error as Error).message); }
    finally { setBusy(false); }
  }
  return <div class={`drawer-overlay ${docked() ? 'is-docked' : ''}`} onMouseDown={event => { if (event.target === event.currentTarget) close(); }}><div ref={ref} class="drawer" role="dialog" aria-modal={!docked()} aria-labelledby="transaction-title" tabindex="-1"><div class="drawer-top"><span class="eyebrow">Transaction details</span><button class="icon-button" aria-label="Close transaction details" onClick={close} disabled={busy()}><X size={21} /></button></div><div class="detail-avatar">{props.transaction.description.slice(0, 1)}</div><h2 id="transaction-title">{props.transaction.description}</h2><p class={`detail-amount ${props.transaction.amountCents > 0 ? 'positive' : ''}`}>{money(props.transaction.amountCents, props.transaction.currency)}</p><dl class="settings-details"><div><dt>Date</dt><dd>{shortDate(props.transaction.date)}</dd></div><div><dt>Account</dt><dd>{props.data.accounts.find(account => account.id === props.transaction.accountId)?.name}</dd></div><div><dt>Status</dt><dd>{props.transaction.pending ? 'Pending' : 'Posted'}</dd></div></dl><form onSubmit={submit}><label>Category</label><Select label="Transaction category" value={category()} onChange={setCategory} options={props.data.categories.map(category => ({ value: category.id, label: category.name }))} disabled={busy()} /><label for="transaction-note">Notes</label><textarea id="transaction-note" placeholder="Add a note for later…" maxlength={2000} rows={4} value={notes()} onInput={event => setNotes(event.currentTarget.value)} disabled={busy()} /><label class="checkbox-label"><input type="checkbox" checked={reviewed()} onChange={event => setReviewed(event.currentTarget.checked)} disabled={busy()} />Mark as reviewed</label><Show when={error()}><div class="form-error" role="alert">{error()}</div></Show><button class="button primary drawer-save" type="submit" disabled={busy()}>{busy() ? <Loader2 size={16} class="spin" /> : <Check size={16} />}Save changes</button></form><p class="drawer-note">Your categories and notes stay in place when your accounts sync.</p></div></div>;
}

export default function App() {
  const initialPage = () => { const hash = location.hash.slice(1) as Page; return [...navigation.map(item => item.id), 'settings'].includes(hash) ? hash : 'overview'; };
  const [auth, setAuth] = createSignal<boolean | null>(null);
  const [authError, setAuthError] = createSignal('');
  const [page, setPage] = createSignal<Page>(initialPage());
  const [month, setMonth] = createSignal(currentMonth());
  const [data, setData] = createSignal<FinanceState | null>(null);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal('');
  const [syncing, setSyncing] = createSignal(false);
  const [toast, setToast] = createSignal('');
  const [selected, setSelected] = createSignal<Transaction | null>(null);
  const [mobileOpen, setMobileOpen] = createSignal(false);
  const [needsReview, setNeedsReview] = createSignal(false);
  let requestId = 0;
  let authRequestId = 0;
  let disposed = false;
  let stateAbort: AbortController | undefined;
  const active = createMemo(() => navigation.find(item => item.id === page()));
  const title = () => page() === 'overview' ? 'Your money, at a glance.' : page() === 'settings' ? 'Settings' : active()?.label || 'Overview';

  function clearSession() {
    ++requestId; ++authRequestId; stateAbort?.abort();
    batch(() => { setAuth(false); setData(null); setSelected(null); setToast(''); setError(''); setLoading(false); setMobileOpen(false); });
  }
  async function refresh(propagateError = false) {
    const id = ++requestId;
    const requestedMonth = month();
    stateAbort?.abort(); stateAbort = new AbortController();
    setLoading(true);
    try {
      const state = await api<FinanceState>(`/state?month=${requestedMonth}`, { signal: stateAbort.signal });
      if (!disposed && id === requestId && auth()) batch(() => { setData({ ...state, recurring: state.recurring || [] }); setError(''); });
    } catch (caught) {
      const failure = caught as Error;
      if (failure.name === 'AbortError') return;
      if (!disposed && id === requestId && auth()) setError(failure.message);
      if (propagateError) throw failure;
    } finally { if (!disposed && id === requestId) setLoading(false); }
  }
  async function checkAuth() {
    const id = ++authRequestId;
    setAuthError('');
    try { const result = await api<{ authenticated: boolean }>('/auth/session'); if (!disposed && id === authRequestId) setAuth(result.authenticated); }
    catch (error) { if (!disposed && id === authRequestId) setAuthError((error as Error).message); }
  }
  onMount(() => {
    void checkAuth();
    const change = () => { const hash = location.hash.slice(1) as Page; if ([...navigation.map(item => item.id), 'settings'].includes(hash)) { setPage(hash); setMobileOpen(false); } };
    window.addEventListener('session-expired', clearSession);
    window.addEventListener('hashchange', change);
    onCleanup(() => { disposed = true; ++requestId; ++authRequestId; stateAbort?.abort(); window.removeEventListener('session-expired', clearSession); window.removeEventListener('hashchange', change); });
  });
  createEffect(on([auth, month], ([authenticated]) => { if (authenticated) void refresh(); }));
  createEffect(() => { if (!toast()) return; const timer = setTimeout(() => setToast(''), 4500); onCleanup(() => clearTimeout(timer)); });
  function navigate(next: Page, review = false) { batch(() => { setNeedsReview(review); setPage(next); setMobileOpen(false); setSelected(null); }); location.hash = next; window.scrollTo({ top: 0, behavior: 'instant' }); }
  async function sync() {
    if (syncing()) return;
    batch(() => { setSyncing(true); setError(''); });
    try { const response = await api<{ sync: FinanceState['sync'] }>('/sync', { method: 'POST', body: '{}' }); await refresh(true); if (auth()) setToast(response.sync.status === 'partial' ? 'Accounts imported. SimpleFIN returned a message.' : 'Your accounts are up to date.'); }
    catch (error) { if (auth()) { await refresh(); setError((error as Error).message); } }
    finally { setSyncing(false); }
  }
  async function updateTransaction(id: string, patch: Partial<Transaction>) { await api(`/transactions/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(patch) }); await refresh(true); if (auth()) setToast('Transaction updated.'); }
  async function updateAccount(id: string, type: AccountType) { await api(`/accounts/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ type }) }); await refresh(true); if (auth()) setToast('Account type updated.'); }
  async function saveBudget(id: string, amountCents: number) { const targetMonth = month(); await api(`/budgets/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify({ month: targetMonth, amountCents }) }); await refresh(true); if (auth()) setToast('Monthly budget saved.'); }
  async function logout() { try { await api('/auth/logout', { method: 'POST', body: '{}' }); clearSession(); } catch (error) { setError((error as Error).message); } }

  return <Switch>
    <Match when={auth() === null}><div class="initial-loading"><Brand /><Show when={authError()} fallback={<Loader2 class="spin" size={20} />}><p role="alert">{authError()}</p><button class="button primary" onClick={() => void checkAuth()}>Try again</button></Show></div></Match>
    <Match when={auth() === false}><Login onLogin={() => { ++authRequestId; setAuth(true); }} /></Match>
    <Match when={auth() === true}><div class="app-shell"><Show when={mobileOpen()}><div class="sidebar-scrim" onClick={() => setMobileOpen(false)} /></Show><aside class={`sidebar ${mobileOpen() ? 'is-open' : ''}`}><Brand /><div class="workspace-label"><span class="workspace-avatar">M</span><div><strong>My workspace</strong><span>Personal finances</span></div><LockKeyhole size={13} /></div><p class="nav-label">Your finances</p><nav aria-label="Main navigation"><For each={navigation}>{item => <button onClick={() => navigate(item.id)} class={`nav-item ${page() === item.id ? 'active' : ''}`} aria-current={page() === item.id ? 'page' : undefined}><Dynamic component={item.icon} size={18} strokeWidth={1.7} /><span>{item.label}</span><Show when={item.id === 'transactions' && (data()?.summary.reviewCount ?? 0) > 0}><span class="nav-count">{(data()?.summary.reviewCount ?? 0) > 99 ? '99+' : data()?.summary.reviewCount}</span></Show></button>}</For></nav><Sprout class="sidebar-botanical" size={220} strokeWidth={0.65} aria-hidden="true" /><div class="sidebar-bottom"><div class="bridge-status"><div><ShieldCheck size={16} /><strong>SimpleFIN Bridge</strong></div><span>{syncLabel(data()?.sync)}</span></div><button class={`nav-item ${page() === 'settings' ? 'active' : ''}`} onClick={() => navigate('settings')}><Settings2 size={18} /><span>Settings</span></button><button class="nav-item signout" onClick={() => void logout()}><LogOut size={17} /><span>Sign out</span></button></div></aside>
      <div class={`main-shell ${selected() ? 'has-detail' : ''}`}><header class="topbar"><div class="breadcrumb"><button class="icon-button mobile-menu" aria-label="Open navigation" onClick={() => setMobileOpen(true)}><Menu size={20} /></button><span>My workspace</span><ChevronRight size={13} /><strong>{active()?.label || 'Settings'}</strong></div><span class="private-label"><LockKeyhole size={12} />Private & secure</span></header><main class="main-content"><div class="page-header"><div><p class="eyebrow">Discipline today. A richer tomorrow.</p><h1>{title()}</h1><p class="page-subtitle">{subtitles[page()]}</p></div><div class="page-actions"><Show when={!['settings', 'accounts', 'recurring'].includes(page())}><MonthPicker value={month()} onChange={setMonth} /></Show><button class="button primary sync-button" onClick={() => void sync()} disabled={syncing() || !data()?.sync.configured}>{syncing() ? <Loader2 class="spin" size={15} /> : <RefreshCw size={15} />}<span>{syncing() ? 'Syncing…' : 'Sync accounts'}</span></button></div></div>
        <Show when={error()}><div class="alert" role="alert"><CircleHelp size={17} /><span>{error()}</span><button class="icon-button" aria-label="Dismiss error" onClick={() => setError('')}><X size={15} /></button></div></Show><Show when={(data()?.sync.errors.length ?? 0) > 0 && page() !== 'settings'}><div class="connection-alert"><CircleHelp size={16} /><span>SimpleFIN returned a message.</span><button class="text-button" onClick={() => navigate('settings')}>View details</button></div></Show>
        <Show when={data()} fallback={<div class="loading-panel"><Show when={loading()} fallback={<><p>Your workspace couldn’t load.</p><button class="button secondary" onClick={() => void refresh()}>Try again</button></>}><Loader2 size={22} class="spin" /><p>Gathering your financial picture…</p></Show></div>}>{state => <div class={`page-content ${loading() && !syncing() ? 'refreshing' : ''}`} aria-busy={loading()}><Switch>
          <Match when={page() === 'overview'}><Overview data={state()} navigate={navigate} onSelect={setSelected} onSync={() => void sync()} syncing={syncing()} /></Match>
          <Match when={page() === 'transactions'}><Transactions data={state()} onSelect={setSelected} needsReview={needsReview()} selectedId={selected()?.id} /></Match>
          <Match when={page() === 'accounts'}><Accounts data={state()} onUpdate={updateAccount} /></Match>
          <Match when={page() === 'budgets'}><Budgets data={state()} onSave={saveBudget} /></Match>
          <Match when={page() === 'insights'}><Insights data={state()} /></Match>
          <Match when={page() === 'recurring'}><RecurringView data={state()} /></Match>
          <Match when={page() === 'settings'}><Settings data={state()} onSync={() => void sync()} syncing={syncing()} onLogout={() => void logout()} /></Match>
        </Switch></div>}</Show>
        <footer class="app-footer"><span><ShieldCheck size={13} />A private place for your financial life.</span><span>{data()?.accounts.length || 0} accounts · {syncLabel(data()?.sync)}</span></footer>
      </main></div><Show when={selected()} keyed>{transaction => <Show when={data()}>{state => <TransactionDetail transaction={transaction} data={state()} onClose={() => setSelected(null)} onSave={updateTransaction} />}</Show>}</Show><Show when={toast()}><div class="toast" role="status"><CheckCircle2 size={18} />{toast()}</div></Show>
    </div></Match>
  </Switch>;
}
