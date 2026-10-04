# Meezaniyah — Quiet Ledger

The user selected direction A from the image mockups. References: `mockups/images/a-transactions.png` and `mockups/images/a-sign-in.png`. Further mockup generation was stopped at the user's request.

## Intent

A private personal finance workspace for reviewing accounts, transactions, budgets, net worth, and recurring expenses. Calm, legible, warm, and precise. Financial data and actions lead the workspace; avoid filler and ungrounded financial claims.

## Visual system

- Forest-green navigation, warm ivory work surface, restrained gold identity accents.
- Large editorial serif headings (Georgia/system serif); readable sans-serif body and controls; tabular numerals for amounts.
- Fine low-opacity borders define panels and tables. Subtle surface shifts, no dramatic shadows.
- Base spacing unit: 4px. Desktop sidebar approximately 210px; responsive collapsing navigation on mobile.
- Sparse botanical identity using a consistent sprout icon. Do not place entire mockup screenshots in the product.
- Transaction rows are compact and scannable; editable detail inspector. Categories, review status, and amount are easy to distinguish.
- Sign-in uses the same identity with a clear private workspace form. No unsupported security claims or dead controls.

## Implementation constraints

SolidJS frontend. Chart.js canvas charts, no SVG financial charts. Tree-shake chart components, disable unnecessary chart animations, keep data updates reactive. Standard SVG icons are fine. Cloudflare Workers and D1; SimpleFIN credentials stay on the server. No fictional financial data in the real application.
