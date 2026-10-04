# Meezaniyah

A private household finance workspace built with **SolidJS, Chart.js, Cloudflare Workers, and Cloudflare D1**. SimpleFIN Bridge provides read-only account balances and transactions. The app supports transaction review and categorization, monthly budgets, cash-flow reports, account balances, and estimated recurring activity.

Hosted workspace: [meezaniyah.hassan-typon.workers.dev](https://meezaniyah.hassan-typon.workers.dev). Financial data requires the workspace passphrase.

## Local development

Use Node.js 24 or newer and npm. Install dependencies, prepare local secrets, and initialize the local D1 database:

```sh
npm ci
node scripts/setup.mjs
npm exec -- wrangler d1 migrations apply meezaniyah --local
npm run build
npm run dev:worker
```

Open `http://127.0.0.1:8787`. Sign in using the generated workspace passphrase saved in `.local/workspace-access.txt`; keep that passphrase in your password manager.

The setup script reads the existing `simplefin_access_url` from `secret.json`. It expects an already-claimed SimpleFIN access URL; it does not claim a Bridge setup token. It creates `.dev.vars` for local development and `.local/worker-secrets.json` for deployment, preserving an existing generated workspace passphrase. These files, the source secret, local databases, and Wrangler state are excluded from version control. Credentials are not printed by setup or sent to the browser.

For frontend hot reload, leave the Worker running and run `npm run dev` in another terminal. Open the Vite URL it prints; requests under `/api` are proxied to the local Worker. Local D1 data is separate from production D1 data. A manual sync from either environment uses the configured SimpleFIN access URL, so avoid refreshing both environments repeatedly.

```sh
npm test
npm run build
```

Tests use synthetic financial records and an in-memory SQLite adapter for the D1 API. They do not contact SimpleFIN.

## Deploy to Cloudflare

The configured D1 database is already provisioned for the hosted workspace. For updates to this deployment, authenticate and use the migration/deploy commands below. When deploying to a different Cloudflare account, create a separate database:

```sh
npm exec -- wrangler login
npm exec -- wrangler d1 create meezaniyah
```

For a separate deployment, replace `database_id` in `wrangler.jsonc` with the ID returned by the create command. Keep the binding name `DB`. If the destination database already exists, use its existing ID instead of creating another one.

Apply the migrations, deploy the app, and upload the generated secrets:

```sh
npm exec -- wrangler d1 migrations apply meezaniyah --remote
npm run deploy
npm exec -- wrangler secret bulk .local/worker-secrets.json
```

The deployed API refuses finance requests until authentication secrets are configured. The secret file supplies `AUTH_PASSWORD_HASH`, `SESSION_SECRET`, and `SIMPLEFIN_ACCESS_URL`. Open the HTTPS URL printed by Wrangler, sign in with your workspace passphrase, and choose **Sync accounts**. Future code deployments use `npm run deploy`; apply new remote migrations before deploying code that requires them.

`FINANCE_TIMEZONE` is an optional Worker variable; the default is `America/Los_Angeles`. It determines transaction calendar dates and balance-snapshot dates. `APP_ORIGIN` can optionally pin mutations to the exact deployed origin. If you set it, update it when changing domains and use the appropriate local origin during development.

## Data behavior and limits

- Sync is manual and limited to once per hour, including failed attempts. The first request asks for up to 45 days of history, following Bridge's recommended request range; later requests overlap the last successful sync by five days, capped at 45 days per request. Actual history depends on the institution. Previously imported posted transactions are retained. Repeated partial errors retain the previous successful cursor so unavailable institutions can catch up.
- Account and transaction identifiers include their connection/account scope. Sync updates preserve saved categories, review status, notes, and account-type overrides. Provider-reported errors appear in Settings. Pending transactions and transfers are excluded from cash flow and budgets; refunds in expense categories reduce spending.
- Amounts are stored as integer hundredths. Headline reports and budgets use USD; foreign-currency balances remain separate and are not converted or added to USD totals. Net worth follows signed provider balances: positive balances are assets and negative balances are liabilities. Check unusual account classifications and institution-specific signs after the first sync.
- Budget totals include only categories with a positive monthly plan. Spending in categories without a plan remains visible in their rows and overall spending. The savings rate is net cash flow divided by income, shown as a percentage; it is unavailable when income is zero or negative.
- Investment support covers account-level balances and transactions, not individual holdings, cost basis, or investment-performance calculations. Net-worth history accumulates from daily snapshots after syncing; earlier balance history is not invented.
- Categories and recurring payments/income are inferred from imported activity. Review them; recurring amounts and dates are estimates, not scheduled payments. SimpleFIN access is read-only. This is a single-household workspace, not a complete reproduction of Monarch's feature set or a multi-user service.

The app targets Cloudflare's free tier, but usage limits still apply. Workers Free currently allows 100,000 requests per day and 10 ms of CPU per request; D1 Free permits 50 queries per Worker invocation and 500 MB per database. Network waiting is separate from CPU time. Imports batch records into a small number of SQL statements, and date formatters are reused to reduce CPU overhead. Large histories can still require further optimization; verify deployed CPU and usage metrics rather than assuming every dataset will fit. See [Workers limits](https://developers.cloudflare.com/workers/platform/limits/) and [D1 limits](https://developers.cloudflare.com/d1/platform/limits/). SimpleFIN Bridge is a separate service with its own subscription and [request limits](https://beta-bridge.simplefin.org/info/developers).
