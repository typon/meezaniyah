export type Page = 'overview' | 'transactions' | 'accounts' | 'budgets' | 'insights' | 'recurring' | 'settings';
export type AccountType = 'cash' | 'investment' | 'asset' | 'credit' | 'loan';
export interface Account { id: string; name: string; institution: string; type: AccountType; currency: string; balanceCents: number; availableBalanceCents: number | null; balanceDate: string; updatedAt: string }
export interface Category { id: string; name: string; group: string; kind: 'income' | 'expense' | 'transfer'; color: string; icon: string }
export interface Transaction { id: string; accountId: string; description: string; amountCents: number; currency: string; date: string; postedAt: string | null; pending: boolean; categoryId: string; reviewed: boolean; notes: string }
export interface Budget { categoryId: string; month: string; amountCents: number; spentCents: number; remainingCents: number }
export interface Snapshot { date: string; assetsCents: number; liabilitiesCents: number; netWorthCents: number }
export interface Recurring { id: string; merchant: string; amountCents: number; currency: string; cadence: string; nextDate: string; lastDate: string; categoryId: string; occurrences: number; confidence: 'estimated'; accountId: string }
export interface SyncStatus { configured: boolean; lastAttemptAt: string | null; lastSuccessAt: string | null; nextAllowedAt: string | null; status: string; errors: string[]; accountCount: number; transactionCount: number }
export interface FinanceState {
  month: string; reportingCurrency: string; accounts: Account[]; categories: Category[]; transactions: Transaction[]; budgets: Budget[]; snapshots: Snapshot[]; recurring: Recurring[]; sync: SyncStatus;
  summary: { netWorthCents: number; assetsCents: number; liabilitiesCents: number; incomeCents: number; expensesCents: number; cashFlowCents: number; budgetedCents: number; budgetSpentCents: number; budgetRemainingCents: number; reviewCount: number; transactionCount: number; savingsRate: number | null; byCurrency: {currency:string;assetsCents:number;liabilitiesCents:number;netWorthCents:number}[]; spendingByCategory: {categoryId:string;spentCents:number}[] };
}
