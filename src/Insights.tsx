import { createMemo, createSignal, For, type JSX } from 'solid-js';
import type { ChartData, ChartOptions } from 'chart.js';
import ChartCanvas from './ChartCanvas';
import { ArrowDownLeft, ArrowUpRight, CalendarDays, ChartNoAxesCombined, CircleHelp, Repeat2 } from 'lucide-solid';
import type { FinanceState, Recurring, Transaction } from './types';
import { money, monthName, shortDate } from './format';
import './insights.css';

type ChartPoint = { label: string; amount: number };

function monthKeys(month: string, count: number) {
  const [year, monthNumber] = month.split('-').map(Number);
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(year, monthNumber - count + index, 15);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  });
}

function LedgerChart(props: { points: ChartPoint[]; currency: string; title: string }) {
  const chartData = createMemo<ChartData>(() => ({
    labels: props.points.map(point => point.label),
    datasets: [{
      label: props.title,
      data: props.points.map(point => point.amount),
      borderColor: '#244f43',
      backgroundColor: 'rgba(36, 79, 67, 0.05)',
      borderWidth: 2,
      fill: true,
      tension: 0,
      pointRadius: props.points.map((_, index) => index === props.points.length - 1 ? 3 : 0),
      pointHoverRadius: 4,
      pointBackgroundColor: '#244f43',
      pointBorderColor: '#fff',
    }],
  }));
  const chartOptions = createMemo<ChartOptions>(() => ({
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    interaction: { mode: 'index', intersect: false },
    layout: { padding: { top: 12, right: 8 } },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: '#263a32',
        padding: 12,
        displayColors: false,
        callbacks: { label: context => money(context.parsed.y ?? 0, props.currency) },
      },
    },
    scales: {
      x: { grid: { display: false }, border: { display: false }, ticks: { color: '#788178', maxTicksLimit: 6, maxRotation: 0, font: { size: 11 } } },
      y: { beginAtZero: true, border: { display: false }, grid: { color: 'rgba(38, 58, 50, 0.07)' }, ticks: { color: '#788178', maxTicksLimit: 4, font: { size: 11 }, callback: value => money(Number(value), props.currency, true) } },
    },
  }));
  return <div class="insight-chart"><ChartCanvas type="line" data={chartData()} options={chartOptions()} label={`${props.title}. ${props.points.map(point => `${point.label}: ${money(point.amount, props.currency)}`).join('; ')}`} /></div>;
}

function ChartEmpty(props: { title: string; children: JSX.Element }) {
  return <div class="insight-empty">
    <span class="insight-empty-icon"><ChartNoAxesCombined size={23} stroke-width={1.5} /></span>
    <h3>{props.title}</h3>
    <p>{props.children}</p>
  </div>;
}

function prepareInsights(data: FinanceState) {
  const currency = data.reportingCurrency || 'USD';
  const categories = new Map(data.categories.map(category => [category.id, category]));
  const kind = (transaction: Transaction) => categories.get(transaction.categoryId)?.kind || 'expense';
  const settled = data.transactions.filter(transaction => !transaction.pending && transaction.currency === currency && kind(transaction) !== 'transfer');
  const monthTransactions = settled.filter(transaction => transaction.date.startsWith(data.month));
  const income = monthTransactions.filter(transaction => kind(transaction) === 'income').reduce((sum, transaction) => sum + transaction.amountCents, 0);
  const expenses = monthTransactions.filter(transaction => kind(transaction) === 'expense');
  const spent = -expenses.reduce((sum, transaction) => sum + transaction.amountCents, 0);
  const cashFlow = income - spent;
  const retainedPercent = income > 0 ? (cashFlow / income) * 100 : null;
  const monthTotalDays = new Date(Number(data.month.slice(0, 4)), Number(data.month.slice(5)), 0).getDate();
  const now = new Date();
  const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const observedDays = data.month === thisMonth ? now.getDate() : monthTotalDays;
  const dailyTotals = new Map<string, number>();
  for (const transaction of expenses) {
    const day = transaction.date.slice(0, 10);
    dailyTotals.set(day, (dailyTotals.get(day) || 0) - transaction.amountCents);
  }
  let runningSpent = 0;
  const dailySpend = Array.from({ length: observedDays }, (_, index) => {
    const date = `${data.month}-${String(index + 1).padStart(2, '0')}`;
    runningSpent += dailyTotals.get(date) || 0;
    return { label: shortDate(date), amount: runningSpent };
  });
  const totals = new Map<string, number>();
  for (const transaction of expenses) totals.set(transaction.categoryId, (totals.get(transaction.categoryId) || 0) - transaction.amountCents);
  const spending = [...totals].filter(([, total]) => total !== 0).map(([categoryId, amount]) => ({ id: categoryId, name: categories.get(categoryId)?.name || 'Uncategorized', amount })).sort((a, b) => b.amount - a.amount);
  const maxCategory = Math.max(1, ...spending.map(category => Math.abs(category.amount)));
  const monthTotals = new Map<string, { income: number; spent: number; count: number }>();
  for (const transaction of settled) {
    const month = transaction.date.slice(0, 7);
    const total = monthTotals.get(month) || { income: 0, spent: 0, count: 0 };
    if (kind(transaction) === 'income') total.income += transaction.amountCents;
    else total.spent -= transaction.amountCents;
    total.count += 1;
    monthTotals.set(month, total);
  }
  const recentMonths = monthKeys(data.month, 6).map(month => {
    const total = monthTotals.get(month) || { income: 0, spent: 0, count: 0 };
    return { month, ...total, cashFlow: total.income - total.spent };
  });
  const snapshots = [...data.snapshots].sort((a, b) => a.date.localeCompare(b.date));
  const lastSnapshot = snapshots.at(-1);
  const netWorthChange = snapshots.length > 1 ? lastSnapshot!.netWorthCents - snapshots[0].netWorthCents : 0;
  return { currency, monthTransactions, income, expenses, spent, cashFlow, retainedPercent, dailySpend, spending, maxCategory, recentMonths, snapshots, lastSnapshot, netWorthChange };
}

export function Insights(props: { data: FinanceState }) {
  const report = createMemo(() => prepareInsights(props.data));
  const snapshotPoints = createMemo(() => report().snapshots.map(snapshot => ({ label: shortDate(snapshot.date), amount: snapshot.netWorthCents })));
  return <div class="insight-page">
    <div class="insight-page-heading">
      <div><p class="insight-eyebrow">THE BIGGER PICTURE</p><h1>Your money, in perspective.</h1><p>See what comes in, what goes out, and what stays with you.</p></div>
      <span class="insight-period"><CalendarDays size={15} />{monthName(props.data.month)}</span>
    </div>
    <section class="insight-cashflow" aria-label="Monthly cash flow">
      <div class="insight-cashflow-main"><p class="insight-eyebrow">NET CASH FLOW</p><strong class={report().cashFlow < 0 ? 'insight-negative' : ''}>{money(report().cashFlow, report().currency)}</strong><p>{report().monthTransactions.length ? report().cashFlow >= 0 ? 'More came in than went out.' : 'Spending exceeded income this month.' : 'Your synced transactions will tell the story.'}</p></div>
      <div class="insight-cashflow-detail"><span><ArrowDownLeft size={17} /> Income</span><strong>{money(report().income, report().currency)}</strong><p>After income reversals</p></div>
      <div class="insight-cashflow-detail"><span><ArrowUpRight size={17} /> Spending</span><strong>{money(report().spent, report().currency)}</strong><p>After refunds</p></div>
      <div class="insight-cashflow-detail"><span>Income retained</span><strong>{report().retainedPercent === null ? '—' : `${Math.round(report().retainedPercent!)}%`}</strong><p>{report().retainedPercent === null ? 'Needs recorded income' : 'Net cash flow ÷ income'}</p></div>
    </section>
    <div class="insight-grid">
      <section class="insight-panel insight-spend-chart">
        <div class="insight-panel-heading"><div><h2>The spending curve</h2><p>Cumulative net spending throughout the month</p></div><span class="insight-small-label">{report().currency}</span></div>
        {report().expenses.length ? <><div class="insight-chart-total">{money(report().spent, report().currency)}<span> this month</span></div><LedgerChart points={report().dailySpend} currency={report().currency} title="Cumulative monthly spending" /><p class="insight-footnote">Refunds bring the line down. Pending transactions and transfers are excluded.</p></> : <ChartEmpty title="A clearer picture with every sync">Spending will appear here when settled transactions arrive for {monthName(props.data.month)}.</ChartEmpty>}
      </section>
      <section class="insight-panel">
        <div class="insight-panel-heading"><div><h2>Where it went</h2><p>Net spending by category</p></div></div>
        {report().spending.length ? <div class="insight-category-list"><For each={report().spending}>{category => <div class="insight-category">
          <div><span>{category.name}</span><strong>{money(category.amount, report().currency)}</strong></div>
          <div class="insight-category-track"><span class={category.amount < 0 ? 'insight-refund-bar' : ''} style={{ width: `${Math.max(1, Math.abs(category.amount) / report().maxCategory * 100)}%` }} /></div>
          {category.amount < 0 && <small>Net refund</small>}
        </div>}</For></div> : <ChartEmpty title="Every category has a story">Once transactions are synced, your categories will show where your money goes.</ChartEmpty>}
      </section>
      <section class="insight-panel">
        <div class="insight-panel-heading"><div><h2>Net worth over time</h2><p>Your recorded assets, less your liabilities</p></div><span class="insight-small-label">{report().currency}</span></div>
        {report().snapshots.length > 1 ? <><div class="insight-chart-total">{money(report().lastSnapshot!.netWorthCents, report().currency)}<span> latest</span></div><LedgerChart points={snapshotPoints()} currency={report().currency} title="Recorded net worth" /><p class="insight-footnote">{money(Math.abs(report().netWorthChange), report().currency)} {report().netWorthChange < 0 ? 'decrease' : 'increase'} since {shortDate(report().snapshots[0].date)}. Snapshots are recorded when you sync.</p></> : <ChartEmpty title="Give your progress a little time">{report().lastSnapshot ? `Your first snapshot is ${money(report().lastSnapshot!.netWorthCents, report().currency)} on ${shortDate(report().lastSnapshot!.date)}. A sync on another day will start your trend.` : 'Your first successful sync will record a snapshot. A sync on another day will start your trend.'}</ChartEmpty>}
      </section>
      <section class="insight-panel">
        <div class="insight-panel-heading"><div><h2>A longer view</h2><p>Six months of recorded cash flow</p></div></div>
        <div class="insight-month-table" role="table" aria-label="Cash flow over the last six months">
          <div class="insight-month-row insight-month-head" role="row"><span role="columnheader">Month</span><span role="columnheader">Income</span><span role="columnheader">Spending</span><span role="columnheader">Net</span></div>
          <For each={report().recentMonths}>{month => <div class={`insight-month-row ${month.month === props.data.month ? 'insight-month-selected' : ''}`} role="row">
            <span role="cell">{new Date(`${month.month}-15T12:00:00`).toLocaleDateString('en-US', { month: 'short', year: '2-digit' })}</span><span role="cell">{month.count ? money(month.income, report().currency, true) : '—'}</span><span role="cell">{month.count ? money(month.spent, report().currency, true) : '—'}</span><strong role="cell" class={month.cashFlow < 0 ? 'insight-negative' : ''}>{month.count ? money(month.cashFlow, report().currency, true) : '—'}</strong>
          </div>}</For>
        </div>
        <p class="insight-footnote">Based on imported history. A dash means no settled transactions were recorded for that month.</p>
      </section>
    </div>
    <p class="insight-data-note"><CircleHelp size={14} />Reports use {report().currency} transactions and balances. Other currencies are kept in their original currency and are not converted.</p>
  </div>;
}

function monthlyMultiplier(cadence: string): number | null {
  const normalized = cadence.toLowerCase().replace(/[\s_-]/g, '');
  const multipliers: Record<string, number> = { weekly: 52 / 12, biweekly: 26 / 12, fortnightly: 26 / 12, semimonthly: 2, monthly: 1, quarterly: 1 / 3, annual: 1 / 12, annually: 1 / 12, yearly: 1 / 12 };
  return multipliers[normalized] ?? null;
}

function cadenceLabel(cadence: string) {
  const labels: Record<string, string> = { weekly: 'Weekly', biweekly: 'Every 2 weeks', fortnightly: 'Every 2 weeks', semimonthly: 'Twice a month', monthly: 'Monthly', quarterly: 'Quarterly', annual: 'Yearly', annually: 'Yearly', yearly: 'Yearly' };
  return labels[cadence.toLowerCase().replace(/[\s_-]/g, '')] || cadence;
}

export function RecurringView(props: { data: FinanceState }) {
  const [filter, setFilter] = createSignal<'all' | 'outgoing' | 'incoming'>('all');
  const currency = () => props.data.reportingCurrency || 'USD';
  const categories = createMemo(() => new Map(props.data.categories.map(category => [category.id, category])));
  const accounts = createMemo(() => new Map(props.data.accounts.map(account => [account.id, account])));
  const isIncome = (pattern: Recurring) => categories().get(pattern.categoryId)?.kind === 'income';
  const patterns = createMemo(() => props.data.recurring.filter(pattern => categories().get(pattern.categoryId)?.kind !== 'transfer'));
  const visible = createMemo(() => patterns().filter(pattern => filter() === 'all' || (filter() === 'outgoing' ? !isIncome(pattern) : isIncome(pattern))).sort((a, b) => a.nextDate.localeCompare(b.nextDate)));
  const monthlyAmount = (items: Recurring[]) => Math.round(items.reduce((sum, pattern) => sum + Math.abs(pattern.amountCents) * (monthlyMultiplier(pattern.cadence) || 0), 0));
  const totals = createMemo(() => {
    const localPatterns = patterns().filter(pattern => pattern.currency === currency());
    const outgoing = localPatterns.filter(pattern => !isIncome(pattern));
    const incoming = localPatterns.filter(isIncome);
    return { outgoing: monthlyAmount(outgoing), incoming: monthlyAmount(incoming), outgoingCount: outgoing.length, incomingCount: incoming.length, additionalCurrencies: [...new Set(patterns().filter(pattern => pattern.currency !== currency()).map(pattern => pattern.currency))] };
  });
  return <div class="recurring-page">
    <div class="insight-page-heading"><div><p class="insight-eyebrow">THE FAMILIAR TRANSACTIONS</p><h1>A little less to keep track of.</h1><p>Recognize the payments and deposits that tend to repeat.</p></div><span class="insight-period"><Repeat2 size={16} />Estimated from your history</span></div>
    <section class="recurring-summary" aria-label="Recurring transaction estimates">
      <div><p class="insight-eyebrow">REPEATING PAYMENTS</p><strong>{money(totals().outgoing, currency())}</strong><span>estimated per month · {totals().outgoingCount} {totals().outgoingCount === 1 ? 'pattern' : 'patterns'}</span></div>
      <div><p class="insight-eyebrow">REPEATING INCOME</p><strong>{money(totals().incoming, currency())}</strong><span>estimated per month · {totals().incomingCount} {totals().incomingCount === 1 ? 'pattern' : 'patterns'}</span></div>
      <p><CircleHelp size={18} /><span>These are patterns in settled transactions, not confirmed bills. Dates and amounts are estimates; nothing is scheduled or paid here.</span></p>
    </section>
    <section class="insight-panel recurring-patterns-panel">
      <div class="insight-panel-heading recurring-list-heading"><div><h2>On your radar</h2><p>{patterns().length ? `${patterns().length} repeating ${patterns().length === 1 ? 'pattern' : 'patterns'} found in your history` : 'Patterns will appear as your transaction history grows'}</p></div><div class="recurring-filters" role="group" aria-label="Filter repeating transactions">
        <For each={['all', 'outgoing', 'incoming'] as const}>{value => <button type="button" onClick={() => setFilter(value)} aria-pressed={filter() === value}>{value === 'all' ? 'All' : value === 'outgoing' ? 'Payments' : 'Income'}</button>}</For>
      </div></div>
      {visible().length ? <div class="recurring-list"><For each={visible()}>{pattern => <article class="recurring-row">
        <div class={`recurring-merchant-icon ${isIncome(pattern) ? 'recurring-income-icon' : ''}`}>{isIncome(pattern) ? <ArrowDownLeft size={20} /> : <Repeat2 size={19} />}</div>
        <div class="recurring-merchant"><h3>{pattern.merchant}</h3><p>{categories().get(pattern.categoryId)?.name || 'Uncategorized'}<span>·</span>{accounts().get(pattern.accountId)?.name || 'Linked account'}</p></div>
        <div class="recurring-cadence"><strong>{cadenceLabel(pattern.cadence)}</strong><span>{pattern.occurrences} occurrences · last {shortDate(pattern.lastDate)}</span></div>
        <div class="recurring-next"><span>Estimated next</span><strong>{shortDate(pattern.nextDate)}</strong></div>
        <div class={`recurring-amount ${isIncome(pattern) ? 'recurring-incoming-amount' : ''}`}><strong>{isIncome(pattern) ? '+' : '−'}{money(Math.abs(pattern.amountCents), pattern.currency)}</strong><span>{pattern.currency} · estimated</span></div>
      </article>}</For></div> : <div class="recurring-empty"><span class="insight-empty-icon"><Repeat2 size={25} stroke-width={1.5} /></span><h3>{patterns().length ? `No repeating ${filter() === 'incoming' ? 'income' : 'payments'} found` : 'Let your history do the remembering.'}</h3><p>{patterns().length ? 'Switch to All to see the other patterns found in your accounts.' : 'As settled transactions accumulate, regular payments and deposits with similar amounts and timing will appear here. Sync your accounts to build that history.'}</p></div>}
    </section>
    <p class="insight-data-note"><CircleHelp size={14} />Monthly estimates normalize known cadences into {currency()} per month.{totals().additionalCurrencies.length ? ` Patterns in ${totals().additionalCurrencies.join(', ')} are shown in their own currency and excluded from these totals.` : ' Transfers are excluded.'}</p>
  </div>;
}
