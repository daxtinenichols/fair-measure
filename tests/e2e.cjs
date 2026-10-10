// Browser walk-through of the site with Playwright. Serves the repo itself, drives the
// main flows, fails on any console error or CSP violation, and saves screenshots.
// Run: node tests/e2e.cjs
const { chromium } = require("playwright");
const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const SHOTS = path.join(__dirname, "shots");
fs.mkdirSync(SHOTS, { recursive: true });
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".json": "application/json", ".xml": "application/xml", ".txt": "text/plain" };

// Mirrors GitHub Pages: the site lives under /fair-measure/.
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split("?")[0]);
  if (!p.startsWith("/fair-measure/")) { res.writeHead(404); return res.end(); }
  p = path.join(ROOT, p.slice("/fair-measure/".length));
  if (!p.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
  if (fs.existsSync(p) && fs.statSync(p).isDirectory()) p = path.join(p, "index.html");
  if (!fs.existsSync(p)) { res.writeHead(404); return res.end(fs.readFileSync(path.join(ROOT, "404.html"))); }
  res.writeHead(200, { "Content-Type": TYPES[path.extname(p)] || "application/octet-stream" });
  res.end(fs.readFileSync(p));
});

const problems = [];
function watch(page, label) {
  page.on("console", (m) => { if (m.type() === "error") problems.push(label + ": " + m.text()); });
  page.on("pageerror", (e) => problems.push(label + ": " + e.message));
}
function check(cond, msg) { if (!cond) { problems.push("FAILED: " + msg); console.log("  x " + msg); } else console.log("  ok " + msg); }

(async () => {
  await new Promise((r) => server.listen(0, r));
  const base = "http://127.0.0.1:" + server.address().port + "/fair-measure/";
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  const page = await ctx.newPage();
  watch(page, "desktop");

  console.log("home");
  await page.goto(base, { waitUntil: "networkidle" });
  check(await page.locator(".tool").count() === 6, "six tool cards");
  check(await page.locator("#fm-top .fm-brand").isVisible(), "header renders");
  check((await page.getAttribute("#buy-pro", "href")).startsWith("https://buy.polar.sh/"), "Get Pro links to the Polar checkout");
  const fontOk = await page.evaluate(() => document.fonts.check("600 20px Fraunces"));
  check(fontOk, "self-hosted Fraunces loads");
  await page.screenshot({ path: path.join(SHOTS, "home-1440.png"), fullPage: true });

  console.log("new invoice");
  await page.goto(base + "invoices/#new", { waitUntil: "networkidle" });
  check(await page.locator(".from-setup").isVisible(), "asks for business details once");
  await page.click('[data-act="quick-profile"]');
  await page.fill('dialog input[name="name"]', "Hollow Oak Carpentry");
  await page.fill('dialog input[name="email"]', "hello@hollowoak.example");
  await page.fill('dialog input[name="phone"]', "(518) 555-0140");
  await page.fill('dialog textarea[name="address"]', "12 Mill Street\nSaratoga Springs, NY 12866");
  await page.fill('dialog input[name="taxRate"]', "8");
  await page.fill('dialog textarea[name="paymentInstructions"]', "Check payable to Hollow Oak Carpentry, or Zelle to (518) 555-0140.");
  await page.click('dialog button[value="ok"]');
  await page.locator(".from-card").waitFor({ timeout: 5000 }).catch(() => {});
  check(await page.locator(".from-card").isVisible(), "business details saved");

  await page.fill('[data-f="customer.name"]', "Margaret Kelly");
  await page.fill('[data-f="customer.email"]', "margaret@example.com");
  await page.fill('[data-f="customer.address"]', "48 Elm Avenue\nBallston Spa, NY 12020");
  await page.fill('.line[data-i="0"] [data-lf="description"]', "Built-in bookshelf, white oak");
  await page.fill('.line[data-i="0"] [data-lf="price"]', "1450");
  await page.click('[data-act="add-line"]');
  await page.fill('.line[data-i="1"] [data-lf="description"]', "Finish and install");
  await page.fill('.line[data-i="1"] [data-lf="qty"]', "6");
  await page.fill('.line[data-i="1"] [data-lf="price"]', "65");
  await page.click('.line[data-i="1"] [data-act="save-item"]');
  await page.click('[data-act="add-line"]');
  await page.fill('.line[data-i="2"] [data-lf="description"]', "Hardware");
  await page.fill('.line[data-i="2"] [data-lf="price"]', "64.20");
  await page.fill('[data-f="depositPercent"]', "50");
  await page.waitForFunction(() => document.getElementById("saved").textContent === "Saved", null, { timeout: 5000 }).catch(() => {});
  const total = await page.textContent(".d-grand dd");
  check(total.includes("2,056.54"), "preview total is $2,056.54 (got " + total + ")");
  check((await page.textContent("#saved")) === "Saved", "autosaved");
  check(/#doc\//.test(page.url()), "address changes to the saved document");
  await page.screenshot({ path: path.join(SHOTS, "invoice-edit-1440.png"), fullPage: true });

  console.log("payment");
  await page.click('[data-act="mark-sent"]');
  await page.click('[data-act="record-payment"]');
  await page.click('dialog button[value="ok"]');
  await page.waitForFunction(() => document.querySelector(".ed-title .pill").textContent === "Paid", null, { timeout: 5000 }).catch(() => {});
  check((await page.locator(".ed-title .pill").textContent()) === "Paid", "paid in full after recording the balance");
  check(await page.locator(".d-stamp").isVisible(), "paid stamp on the document");

  console.log("print view");
  await page.emulateMedia({ media: "print" });
  await page.screenshot({ path: path.join(SHOTS, "invoice-print.png"), fullPage: true });
  check(!(await page.locator(".ed-form").isVisible()), "print hides the form");
  await page.emulateMedia({ media: "screen" });

  console.log("quote to invoice");
  await page.goto(base + "invoices/#new-quote", { waitUntil: "networkidle" });
  await page.fill('[data-f="customer.name"]', "Margaret Kelly");
  await page.fill('.line[data-i="0"] [data-lf="description"]', "Finish and install");
  check((await page.inputValue('.line[data-i="0"] [data-lf="price"]')) === "65.00", "saved item fills its price");
  await page.waitForFunction(() => document.getElementById("saved").textContent === "Saved", null, { timeout: 5000 }).catch(() => {});
  await page.click('[data-act="to-invoice"]');
  await page.waitForFunction(() => document.querySelector(".ed-title h1").textContent.startsWith("Invoice"), null, { timeout: 5000 }).catch(() => {});
  check((await page.textContent(".ed-title h1")).startsWith("Invoice INV-0002"), "quote became invoice INV-0002");

  console.log("lists");
  await page.goto(base + "invoices/#", { waitUntil: "networkidle" });
  await page.waitForTimeout(200);
  check(await page.locator(".doc-row").count() === 3, "three documents listed");
  await page.screenshot({ path: path.join(SHOTS, "list-1440.png"), fullPage: true });
  await page.goto(base + "invoices/#customers");
  await page.waitForTimeout(200);
  check(await page.locator(".person").count() === 1, "one customer, not duplicated");
  await page.goto(base + "invoices/#items");
  await page.waitForTimeout(200);
  check(await page.locator(".item-row").count() === 1, "one saved item");

  console.log("cash book");
  await page.goto(base + "cash/", { waitUntil: "networkidle" });
  const fromInvoice = await page.textContent(".tile >> nth=0");
  check(fromInvoice.includes("2,056.54"), "invoice payment shows as money in (got " + fromInvoice.trim() + ")");
  await page.click('[data-act="add-out"]');
  await page.fill('dialog input[name="amount"]', "120.50");
  await page.fill('dialog input[name="party"]', "Saratoga Lumber");
  await page.selectOption('dialog select[name="category"]', "supplies");
  await page.click('dialog button[value="ok"]');
  await page.locator("dialog").waitFor({ state: "detached", timeout: 5000 }).catch(() => {});
  await page.click('[data-act="add-out"]');
  await page.fill('dialog input[name="amount"]', "30");
  await page.fill('dialog input[name="party"]', "Saratoga Lumber");
  await page.dispatchEvent('dialog input[name="party"]', "change");
  check((await page.inputValue('dialog select[name="category"]')) === "supplies", "a known payee fills in its category");
  await page.screenshot({ path: path.join(SHOTS, "cash-entry-1440.png") });
  await page.click('dialog button[value="ok"]');
  await page.locator("dialog").waitFor({ state: "detached", timeout: 5000 }).catch(() => {});
  check(await page.evaluate(() => FM.store.count("cash")) === 2, "two expenses saved");

  await page.click('[data-act="add-trip"]');
  await page.fill('dialog input[name="purpose"]', "Measure the Kelly kitchen");
  await page.fill('dialog input[name="to"]', "Ballston Spa");
  await page.fill('dialog input[name="miles"]', "12.5");
  check((await page.textContent("dialog .trip-calc")).includes("25 miles"), "round trip counts the miles twice");
  await page.click('dialog button[value="ok"]');
  await page.locator("dialog").waitFor({ state: "detached", timeout: 5000 }).catch(() => {});
  await page.goto(base + "cash/#miles");
  await page.waitForTimeout(200);
  await page.click(".usual .chip >> nth=0");
  await page.waitForTimeout(200);
  check(await page.locator(".row.trip").count() === 2, "a usual trip logs again in one tap");
  await page.screenshot({ path: path.join(SHOTS, "cash-miles-1440.png"), fullPage: true });

  await page.goto(base + "cash/");
  await page.waitForTimeout(200);
  const expected = await page.evaluate(() => FM.money.format(205654 - 15050 - FMCash.totals([], FM.store.all("trips"), "0000", "9999").mileage));
  check((await page.textContent(".tile >> nth=2")).includes(expected), "profit is money in less costs and mileage (" + expected + ")");
  await page.screenshot({ path: path.join(SHOTS, "cash-overview-1440.png"), fullPage: true });
  await page.hover(".col >> nth=" + (new Date().getMonth()));
  check(await page.locator(".chart .tip").isVisible(), "chart shows a readout on hover");
  await page.click('.q.is-next [data-act="pay-q"]');
  check(parseFloat(await page.inputValue('dialog input[name="amount"]')) > 0, "tax payment starts at the suggested set-aside");
  await page.click('dialog button[value="ok"]');
  await page.locator("dialog").waitFor({ state: "detached", timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(200);
  check(await page.locator(".q.is-next .pill.green").count() === 1, "period shows as paid after recording the payment");

  await page.goto(base + "cash/#money");
  await page.waitForTimeout(200);
  check(await page.locator(".rows .row").count() === 4, "money list has the invoice payment, two expenses and the tax payment");
  await page.click('[data-filter="invoices"]');
  check((await page.getAttribute(".rows .row >> nth=0", "href")).includes("invoices/#doc/"), "invoice payment links back to its invoice");
  await page.click('[data-act="csv"]');
  check(await page.locator("dialog.fm-dialog").isVisible(), "CSV export explains it's part of Pro");
  await page.click('dialog button[value="no"]');
  await page.locator("dialog").waitFor({ state: "detached", timeout: 5000 }).catch(() => {});

  await page.goto(base + "cash/#year");
  await page.waitForTimeout(200);
  const net = await page.textContent(".sched tr.grand td");
  check(net.includes(expected), "year-end net profit matches the overview (got " + net + ")");
  await page.screenshot({ path: path.join(SHOTS, "cash-year-1440.png"), fullPage: true });
  await page.emulateMedia({ media: "print" });
  await page.screenshot({ path: path.join(SHOTS, "cash-year-print.png"), fullPage: true });
  check(!(await page.locator(".app-head").isVisible()), "print shows only the summary");
  await page.emulateMedia({ media: "screen" });

  await page.evaluate(() => { for (let i = 0; i < 27; i++) FM.store.put("cash", { kind: "out", category: "supplies", date: "2026-01-02", amount: 100 }); });
  await page.goto(base + "cash/");
  await page.waitForTimeout(200);
  await page.click('[data-act="add-out"]');
  check((await page.textContent("dialog.fm-dialog h3")) === "You've reached the free limit", "free limit at 30 entries");
  await page.click('dialog button[value="no"]');
  await page.locator("dialog").waitFor({ state: "detached", timeout: 5000 }).catch(() => {});
  await page.evaluate(() => FM.store.raw.write("cash", FM.store.all("cash").filter((e) => e.date !== "2026-01-02")));

  console.log("free limit");
  await page.evaluate(() => { for (let i = 0; i < 7; i++) FM.store.put("documents", { type: "invoice", status: "draft", number: "X" + i, lines: [], customer: { name: "T" } }); });
  await page.goto(base + "invoices/#new");
  await page.waitForTimeout(300);
  check(await page.locator("dialog.fm-dialog").isVisible(), "limit dialog at 10 documents");
  await page.click('dialog button[value="no"]');
  await page.locator("dialog.fm-dialog").waitFor({ state: "detached", timeout: 5000 }).catch(() => {});

  console.log("settings and backup");
  await page.goto(base + "settings/", { waitUntil: "networkidle" });
  check((await page.inputValue('input[name="name"]')) === "Hollow Oak Carpentry", "settings show shared profile");
  const [dl] = await Promise.all([page.waitForEvent("download"), page.click("#do-backup")]);
  const file = await dl.path();
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  check(data.app === "Fair Measure" && data.documents.length === 10 && data.customers.length === 1 && data.cash.length === 3 && data.trips.length === 2, "backup holds everything");
  await page.screenshot({ path: path.join(SHOTS, "settings-1440.png"), fullPage: true });
  await page.click("#erase");
  await page.click('dialog button[value="yes"]');
  await page.waitForFunction(() => FM.store.count("documents") === 0, null, { timeout: 5000 }).catch(() => {});
  check(await page.evaluate(() => FM.store.count("documents")) === 0, "erase clears the device");
  await page.setInputFiles("#restore-file", file);
  await page.click('dialog button[value="yes"]');
  await page.waitForFunction(() => FM.store.count("documents") === 10, null, { timeout: 5000 }).catch(() => {});
  check(await page.evaluate(() => FM.store.count("documents")) === 10, "restore brings it back");

  console.log("phone");
  const phone = await browser.newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await phone.addInitScript((d) => { if (!localStorage.getItem("fm.v1.profile")) { localStorage.setItem("fm.v1.profile", JSON.stringify(d.profile)); localStorage.setItem("fm.v1.documents", JSON.stringify(d.documents)); localStorage.setItem("fm.v1.customers", JSON.stringify(d.customers)); localStorage.setItem("fm.v1.items", JSON.stringify(d.items)); localStorage.setItem("fm.v1.cash", JSON.stringify(d.cash)); localStorage.setItem("fm.v1.trips", JSON.stringify(d.trips)); } }, data);
  const m = await phone.newPage();
  watch(m, "phone");
  await m.goto(base, { waitUntil: "networkidle" });
  await m.screenshot({ path: path.join(SHOTS, "home-375.png"), fullPage: true });
  const overflow = await m.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  check(!overflow, "no sideways scroll on the phone home page");
  await m.click(".fm-menu-btn");
  await m.screenshot({ path: path.join(SHOTS, "menu-375.png") });
  await m.goto(base + "invoices/", { waitUntil: "networkidle" });
  await m.screenshot({ path: path.join(SHOTS, "list-375.png"), fullPage: true });
  await m.click(".doc-row >> nth=0");
  await m.waitForTimeout(200);
  check(!(await m.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)), "no sideways scroll in the phone editor");
  await m.screenshot({ path: path.join(SHOTS, "edit-375.png"), fullPage: true });
  await m.click('.ed-switch [data-tab="preview"]');
  await m.screenshot({ path: path.join(SHOTS, "preview-375.png"), fullPage: true });

  await m.goto(base + "cash/", { waitUntil: "networkidle" });
  check(!(await m.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)), "no sideways scroll in the phone cash book");
  await m.screenshot({ path: path.join(SHOTS, "cash-375.png"), fullPage: true });
  await m.goto(base + "cash/#year");
  await m.waitForTimeout(200);
  check(!(await m.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)), "no sideways scroll in the phone year-end summary");
  await m.screenshot({ path: path.join(SHOTS, "cash-year-375.png"), fullPage: true });

  for (const slug of ["about/", "privacy/", "terms/", "refunds/", "thanks/"]) {
    await m.goto(base + slug, { waitUntil: "networkidle" });
    check(await m.locator("h1").count() === 1, slug + " renders");
  }
  await m.goto(base + "about/");
  await m.screenshot({ path: path.join(SHOTS, "about-375.png"), fullPage: true });

  await browser.close();
  server.close();
  const errors = problems.filter((p) => !p.startsWith("FAILED"));
  if (errors.length) console.log("\nConsole errors:\n" + errors.join("\n"));
  console.log(problems.length ? "\n" + problems.length + " problem(s)" : "\nAll browser checks passed");
  process.exit(problems.length ? 1 : 0);
})().catch((e) => { console.error(e); server.close(); process.exit(1); });
