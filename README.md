# Fair Measure

Honest, private, pay-once tools for small businesses. Live at https://daxtinenichols.github.io/fair-measure/ (GitHub Pages, served from `main`).

## What's here

| Path | What it is |
|------|------------|
| `index.html` | Home page: tools, pricing, questions |
| `invoices/` | Quotes & Invoices, the first tool |
| `customers/` | Customer Book: notes, follow-ups, contact import and statements on the shared customer list |
| `settings/` | My business: shared business details, Pro license, backup and restore |
| `about/`, `privacy/`, `terms/`, `refunds/` | About and legal pages |
| `shared/` | Code and styles every tool uses |

### Shared pieces (every tool loads these)

- `shared/chrome.js`: header, footer, the one list of tools (`FM.tools`), toast and confirm dialog. Builds links from the site root, so the site works under `/fair-measure/` and on a custom domain.
- `shared/store.js`: the business book. One store in the browser's localStorage (keys `fm.v1.*`) holding the business profile, `customers`, `items` and `documents`. Tools share records through it, and one backup file holds everything. Money is whole cents.
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
node tests/calc.test.js        # arithmetic
node tests/customers.test.js   # Customer Book logic
node tests/e2e.cjs             # browser test with Playwright (npm install first), screenshots in tests/shots/
```

## License

Copyright (c) 2026 Fair Measure. All rights reserved. The source is public so customers can see exactly what runs on their device; it isn't licensed for reuse.
