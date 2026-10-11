# Fair Measure

Honest, private, pay-once tools for small businesses. Live at https://daxtinenichols.github.io/fair-measure/ (GitHub Pages, served from `main`).

## What's here

| Path | What it is |
|------|------------|
| `index.html` | Home page: tools, pricing, questions |
| `invoices/` | Quotes & Invoices, the first tool |
| `customers/` | Customer Book: notes, follow-ups, contact import and statements on the shared customer list |
| `pricing/` | Price Builder: cost out a product or job and save the price to the shared items list |
| `shifts/` | Shift Planner: weekly staff schedule, shared by link (the week travels inside the link), with swap and cover requests the owner approves |
| `shopfront/` | Shopfront Studio: builds a one-page business website from the shared profile and items, downloaded as one self-contained `index.html` |
| `cash/` | Cash Book: money in and out, mileage log, quarterly tax set-aside, year-end Schedule C summary |
| `time/` | Time Book: a running clock and hand-entered hours by customer and job, turned into a draft invoice in one step, with fair rounding and printable timesheets |
| `stock/` | Stock Book: what's on the shelf (things you sell and supplies you use), low-stock alerts, a reorder list by supplier, stock takes, and stock value on any date. Sent and paid invoices take sold things out of stock |
| `settings/` | My business: shared business details, Pro license, backup and restore |
| `about/`, `privacy/`, `terms/`, `refunds/` | About and legal pages |
| `shared/` | Code and styles every tool uses |

### Shared pieces (every tool loads these)

- `shared/chrome.js`: header, footer, the one list of tools (`FM.tools`), toast and confirm dialog. Builds links from the site root, so the site works under `/fair-measure/` and on a custom domain.
- `shared/store.js`: the business book. One store in the browser's localStorage (keys `fm.v1.*`) holding the business profile, `customers`, `items`, `documents`, `costings` (Price Builder), `staff` and `shifts` (Shift Planner), `sites` (Shopfront Studio), `cash` entries and `trips` (Cash Book), `time` (Time Book entries; the running clock is the separate key `fm.v1.timer`), and `stock` and `stockMoves` (Stock Book: stocked things and every change to them; invoice sales are read from `documents`, never copied). Tools share records through it, and one backup file holds everything. Money is whole cents.
- `shared/license.js`: Pro unlock. Set `checkoutUrl` and `organizationId` once the store exists; until then Pro shows "coming soon". Free limits live here too.
- `shared/fm.css`, `shared/fonts/`: design tokens and self-hosted fonts (Fraunces and Source Sans 3, SIL Open Font License).

### Adding a tool

1. Make a folder, copy the `<head>` from `invoices/index.html` (it carries the Content-Security-Policy), and load `shared/chrome.js`, `store.js` and `license.js`.
2. Read and write shared records through `FM.store`; add a new collection to `COLLECTIONS` in `store.js` if the tool needs one.
3. When you change anything in `shared/`, bump the `?v=` number on every page that loads it, so browsers fetch the new copy instead of a cached one.
4. Flip the tool's entry in `FM.tools` (in `chrome.js`) to `status: "live"` with its `path`, and add it to `sitemap.xml`.

## Principles

No build step, no framework, no third-party scripts, no cookies, no tracking. Every page has a strict CSP. Business data never leaves the customer's device. WCAG 2.1 AA. See the About page for the values behind it.

## Tests

```
node tests/calc.test.js        # invoice arithmetic
node tests/pricing.test.js     # Price Builder arithmetic
node tests/customers.test.js   # Customer Book logic
node tests/shifts.test.js      # Shift Planner logic
node tests/shopfront.test.js   # Shopfront Studio site builder
node tests/cash.test.js        # Cash Book arithmetic
node tests/time.test.js        # Time Book arithmetic
node tests/stock.test.js       # Stock Book levels, values and reorder list
node tests/e2e.cjs             # browser test with Playwright (npm install first), screenshots in tests/shots/
```

## License

Copyright (c) 2026 Fair Measure. All rights reserved. The source is public so customers can see exactly what runs on their device; it isn't licensed for reuse.
