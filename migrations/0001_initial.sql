PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, group_name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('expense','income','transfer')), color TEXT NOT NULL, icon TEXT NOT NULL
);
INSERT OR IGNORE INTO categories VALUES
('income','Paychecks','Income','income','#24876c','briefcase'),
('other-income','Other income','Income','income','#529f86','plus'),
('housing','Housing','Essentials','expense','#a278c4','home'),
('groceries','Groceries','Essentials','expense','#5d9b83','shopping-basket'),
('utilities','Utilities','Essentials','expense','#d4aa57','zap'),
('transport','Transportation','Essentials','expense','#6e9bb0','car'),
('health','Health & wellness','Essentials','expense','#ca9297','heart'),
('insurance','Insurance','Essentials','expense','#8994bf','shield'),
('dining','Dining & drinks','Lifestyle','expense','#de9870','utensils'),
('shopping','Shopping','Lifestyle','expense','#b586ad','shopping-bag'),
('entertainment','Entertainment','Lifestyle','expense','#d0a656','ticket'),
('subscriptions','Subscriptions','Lifestyle','expense','#8996c5','repeat'),
('travel','Travel','Lifestyle','expense','#74a8ad','plane'),
('education','Education','Lifestyle','expense','#9d986c','book'),
('gifts','Gifts & giving','Lifestyle','expense','#c989aa','gift'),
('fees','Fees & interest','Other','expense','#a8a096','landmark'),
('uncategorized','Uncategorized','Other','expense','#96928a','circle-help'),
('transfer','Transfers','Transfers','transfer','#a1aaa4','arrow-left-right');
CREATE TABLE IF NOT EXISTS accounts (
 id TEXT PRIMARY KEY, external_id TEXT NOT NULL, connection_id TEXT NOT NULL,
 name TEXT NOT NULL, institution TEXT NOT NULL,
 type TEXT NOT NULL CHECK(type IN ('cash','investment','asset','credit','loan')),
 type_override INTEGER NOT NULL DEFAULT 0, currency TEXT NOT NULL,
 balance_cents INTEGER NOT NULL, available_balance_cents INTEGER,
 balance_date TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(connection_id,external_id)
);
CREATE TABLE IF NOT EXISTS transactions (
 id TEXT PRIMARY KEY, external_id TEXT NOT NULL, account_id TEXT NOT NULL REFERENCES accounts(id),
 description TEXT NOT NULL, amount_cents INTEGER NOT NULL, currency TEXT NOT NULL,
 date TEXT NOT NULL, posted_at TEXT, pending INTEGER NOT NULL DEFAULT 0,
 category_id TEXT NOT NULL REFERENCES categories(id), category_override INTEGER NOT NULL DEFAULT 0,
 reviewed INTEGER NOT NULL DEFAULT 0, notes TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL,
 UNIQUE(account_id,external_id)
);
CREATE INDEX IF NOT EXISTS transactions_date ON transactions(date DESC);
CREATE INDEX IF NOT EXISTS transactions_category_date ON transactions(category_id,date);
CREATE TABLE IF NOT EXISTS budgets (
 month TEXT NOT NULL, category_id TEXT NOT NULL REFERENCES categories(id),
 amount_cents INTEGER NOT NULL CHECK(amount_cents >= 0), PRIMARY KEY(month,category_id)
);
CREATE TABLE IF NOT EXISTS balance_snapshots (
 date TEXT NOT NULL, currency TEXT NOT NULL, assets_cents INTEGER NOT NULL,
 liabilities_cents INTEGER NOT NULL, net_worth_cents INTEGER NOT NULL, PRIMARY KEY(date,currency)
);
CREATE TABLE IF NOT EXISTS sync_metadata (
 id INTEGER PRIMARY KEY CHECK(id=1), last_attempt_at TEXT, last_success_at TEXT,
 status TEXT NOT NULL DEFAULT 'idle', errors_json TEXT NOT NULL DEFAULT '[]',
 account_count INTEGER NOT NULL DEFAULT 0, transaction_count INTEGER NOT NULL DEFAULT 0
);
INSERT OR IGNORE INTO sync_metadata(id) VALUES(1);
