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

  console.log("customer book");
  await page.goto(base + "customers/", { waitUntil: "networkidle" });
  check(await page.locator(".person").count() === 1, "customer book shows the customer from the invoices");
  await page.click(".person");
  await page.waitForSelector(".c-title h1");
  check((await page.textContent(".c-title h1")) === "Margaret Kelly", "customer page opens");
  check(await page.locator(".ev-doc").count() === 3 && await page.locator(".ev-pay").count() === 1, "history shows three documents and the payment");
  check((await page.textContent(".money")).includes("2,056.54"), "money card shows what was billed");
  await page.fill('#fu-add input[name="what"]', "Ask how the shelves are holding up");
  await page.click('#fu-add [data-days="1"]');
  await page.click('#fu-add button[type="submit"]');
  await page.waitForSelector(".fu");
  check((await page.textContent(".fu .due")).startsWith("Tomorrow"), "reminder added for tomorrow");
  const [ics] = await Promise.all([page.waitForEvent("download"), page.click('.fu [data-act="fu-ics"]')]);
  check(fs.readFileSync(await ics.path(), "utf8").includes("BEGIN:VEVENT"), "reminder downloads as a calendar file");
  await page.fill("#log-text", "Called about a matching cabinet");
  await page.click('.kind:has(input[value="call"])');
  await page.click('#log-add button[type="submit"]');
  await page.waitForSelector(".ev-note");
  check((await page.textContent(".ev-note .ev-kind")) === "Call", "call note added to the history");
  await page.fill("#about", "Gate code 4412. Prefers mornings.");
  await page.waitForFunction(() => document.getElementById("about-saved").textContent === "Saved", null, { timeout: 5000 }).catch(() => {});
  check(await page.evaluate(() => FM.store.all("customers")[0].notes) === "Gate code 4412. Prefers mornings.", "about notes save as you type");
  await page.screenshot({ path: path.join(SHOTS, "customer-1440.png"), fullPage: true });

  await page.goto(base + "customers/#", { waitUntil: "networkidle" });
  await page.waitForSelector(".agenda-row");
  check(await page.locator(".agenda-row").count() === 1, "reminder shows on the follow-up list");
  await page.screenshot({ path: path.join(SHOTS, "customers-1440.png"), fullPage: true });
  await page.click('.agenda-row [data-act="fu-done"]');
  check(await page.locator(".agenda-row").count() === 0, "done clears it from the list");

  await page.click('.head-actions [data-act="export"]');
  check(await page.locator("dialog.fm-dialog").isVisible(), "spreadsheet export explains it's Pro");
  await page.click('dialog button[value="no"]');
  await page.locator("dialog.fm-dialog").waitFor({ state: "detached", timeout: 5000 }).catch(() => {});

  await page.click('.head-actions [data-act="add"]');
  await page.fill('dialog input[name="name"]', "Peg Kelly");
  await page.fill('dialog input[name="email"]', "margaret@example.com");
  await page.fill('dialog input[name="tags"]', "Regular, regular, Neighbor");
  await page.click('dialog button[value="ok"]');
  await page.waitForSelector(".dup-note");
  check(await page.evaluate(() => FM.store.all("customers").find((c) => c.name === "Peg Kelly").tags.join("|")) === "Regular|Neighbor", "tags saved without repeats");
  check(await page.locator(".dup-note").isVisible(), "spots the duplicate by email");
  await page.click('[data-act="merge-dup"]');
  await page.click('dialog button[value="yes"]');
  await page.waitForFunction(() => FM.store.count("customers") === 1, null, { timeout: 5000 }).catch(() => {});
  check(await page.evaluate(() => FM.store.count("customers")) === 1, "merge leaves one customer");
  check(await page.evaluate(() => { const c = FM.store.all("customers")[0]; return c.name === "Margaret Kelly" && c.tags.length === 2 && c.log.length === 1; }), "the older record keeps its name and gains the tags");
  check(await page.evaluate(() => FM.store.all("documents").every((d) => d.customerId === FM.store.all("customers")[0].id)), "documents follow the merged customer");

  await page.goto(base + "customers/#import", { waitUntil: "networkidle" });
  await page.screenshot({ path: path.join(SHOTS, "import-1440.png"), fullPage: true });
  await page.setInputFiles("#imp-file", { name: "contacts.vcf", mimeType: "text/vcard", buffer: Buffer.from(
    "BEGIN:VCARD\r\nVERSION:3.0\r\nFN:Margaret Kelly\r\nTEL:(518) 555-0140\r\nEND:VCARD\r\n" +
    "BEGIN:VCARD\r\nVERSION:3.0\r\nN:Reyes;Tom;;;\r\nORG:Reyes Landscaping\r\nEMAIL:tom@example.com\r\nEND:VCARD\r\n") });
  await page.waitForSelector(".imp-row");
  check(await page.locator(".imp-row").count() === 2, "import reads both contacts");
  const goText = await page.textContent("#imp-go"); check(goText === "Add 1 customer", "the one already in the book isn't ticked (got " + goText + ")");
  await page.click("#imp-go");
  await page.waitForSelector(".person");
  check(await page.evaluate(() => FM.store.count("customers")) === 2, "import adds the new contact");

  const kellyId = await page.evaluate(() => FM.store.all("customers").find((c) => c.name === "Margaret Kelly").id);
  await page.evaluate((id) => FM.store.put("documents", { type: "invoice", status: "sent", number: "INV-0099", customerId: id, customer: { name: "Margaret Kelly" }, issueDate: "2026-01-05", dueDate: "2026-01-19", lines: [{ qty: 1, price: 12500, taxable: false }], paidAmount: 0, payments: [] }), kellyId);
  await page.goto(base + "customers/#statement/" + kellyId, { waitUntil: "networkidle" });
  await page.waitForSelector(".st");
  check((await page.textContent(".st-grand dd")).includes("125.00") && (await page.textContent(".st-table")).includes("overdue"), "statement lists the overdue invoice");
  await page.emulateMedia({ media: "print" });
  await page.screenshot({ path: path.join(SHOTS, "statement-print.png"), fullPage: true });
  check(!(await page.locator(".c-actions").isVisible()), "statement prints without the buttons");
  await page.emulateMedia({ media: "screen" });
  await page.evaluate(() => FM.store.remove("documents", FM.store.all("documents").find((d) => d.number === "INV-0099").id));
  console.log("price builder");
  await page.goto(base + "pricing/", { waitUntil: "networkidle" });
  check(await page.locator(".start").count() === 2, "price builder offers product or service");
  await page.screenshot({ path: path.join(SHOTS, "pricing-start-1440.png"), fullPage: true });
  await page.click('.start >> nth=0');
  await page.fill('[data-f="name"]', "Sourdough loaf");
  await page.fill('[data-f="yield"]', "8");
  await page.fill('[data-f="unit"]', "loaf");
  await page.fill('#materials .line[data-i="0"] [data-lf="name"]', "Bread flour, per lb");
  await page.fill('#materials .line[data-i="0"] [data-lf="qty"]', "4");
  await page.fill('#materials .line[data-i="0"] [data-lf="cost"]', "0.80");
  await page.click('[data-act="add-material"]');
  await page.fill('#materials .line[data-i="1"] [data-lf="name"]', "Starter, salt and bags");
  await page.fill('#materials .line[data-i="1"] [data-lf="cost"]', "2.40");
  check((await page.inputValue('#labor .line[data-i="0"] [data-lf="rate"]')) === "25.00", "wage starts at a fair default");
  await page.fill('#labor .line[data-i="0"] [data-lf="hours"]', "1:30");
  await page.click('[data-act="overhead-help"]');
  await page.fill('dialog input[name="monthly"]', "600");
  check((await page.textContent("dialog .oh-out")).includes("$5.00"), "running costs work out to $5.00 an hour");
  await page.click('dialog button[value="ok"]');
  await page.click('[data-fee="online"]');
  // (560 + 3750 + 750) / 8 = 632.5 a loaf; (632.5 + 30) / (1 - 0.029 - 0.20) = 859.27, rounded up to 8.75
  check((await page.textContent("#the-price")).includes("8.75"), "suggested price is $8.75 a loaf (got " + (await page.textContent("#the-price")) + ")");
  check(await page.locator(".notice.green-n").isVisible(), "says the price is healthy");
  await page.waitForFunction(() => document.getElementById("saved").textContent === "Saved", null, { timeout: 5000 }).catch(() => {});
  check(/#p\//.test(page.url()), "price is saved as you type");
  await page.click('[data-act="save-item"]');
  const item = await page.evaluate(() => FM.store.all("items").find((i) => i.name === "Sourdough loaf"));
  check(item && item.price === 875 && item.unit === "loaf" && item.cost === 633, "saved to the shared items list with its cost");
  check((await page.textContent("#item-state")).includes("$8.75"), "shows it's on the items list");
  await page.screenshot({ path: path.join(SHOTS, "pricing-edit-1440.png"), fullPage: true });
  await page.fill('[data-f="price"]', "6.50");
  check(await page.locator(".notice.rose-n").isVisible(), "warns when a price loses money");
  check((await page.textContent("#save-label")) === "Update my items", "offers to update the item after a price change");
  await page.fill('[data-f="price"]', "");
  await page.click('[data-kind="service"]');
  check(await page.locator('[data-f="yield"]').count() === 0, "services have no batch size");
  await page.click('[data-kind="product"]');
  await page.fill('[data-f="yield"]', "8");
  await page.waitForFunction(() => document.getElementById("saved").textContent === "Saved", null, { timeout: 5000 }).catch(() => {});
  await page.goto(base + "pricing/#", { waitUntil: "networkidle" });
  await page.waitForTimeout(200);
  check(await page.locator(".price-row").count() === 1, "one saved price listed");
  check((await page.textContent(".price-row")).includes("In my items"), "list shows it's in my items");
  await page.screenshot({ path: path.join(SHOTS, "pricing-list-1440.png"), fullPage: true });
  await page.goto(base + "invoices/#items");
  await page.waitForTimeout(200);
  check((await page.textContent(".items")).includes("$8.75"), "Quotes & Invoices sees the new item");

  console.log("shopfront studio");
  await page.goto(base + "shopfront/", { waitUntil: "networkidle" });
  check(await page.locator(".kind").count() === 7, "shopfront asks one question: the kind of business");
  await page.screenshot({ path: path.join(SHOTS, "shopfront-start-1440.png"), fullPage: true });
  await page.click('.kind[data-kind="food"]');
  await page.waitForSelector("#pv");
  const pvText = async (sel) => page.frameLocator("#pv").locator(sel).first().textContent({ timeout: 5000 }).catch(() => "");
  check((await pvText("h1")) === "Hollow Oak Carpentry", "preview is built from the business name");
  check((await pvText("#offer")).includes("$8.75"), "preview lists prices from the shared items");
  await page.fill('[data-f="intro"]', "Fresh sourdough and honest carpentry, from our family to yours.");
  await page.waitForFunction(() => (document.getElementById("pv").srcdoc || "").includes("Fresh sourdough and honest"), null, { timeout: 5000 }).catch(() => {});
  check((await pvText(".lede")).startsWith("Fresh sourdough"), "preview follows what you type");
  await page.click("#sec-hours summary");
  await page.click('[data-preset="weekdays"]');
  await page.waitForTimeout(400);
  check((await pvText(".hours")).includes("Mon – Fri"), "weekday hours appear on the site");
  await page.click("#sec-offer summary");
  await page.fill('#item-add input[name="name"]', "Gift card");
  await page.fill('#item-add input[name="price"]', "25");
  await page.click("#item-add button");
  await page.waitForTimeout(300);
  check(await page.evaluate(() => { const it = FM.store.all("items").find((i) => i.name === "Gift card"); return !!it && it.price === 2500 && FM.store.all("sites")[0].offer.itemIds.includes(it.id); }), "a new item lands on the shared list and the site");
  const swatch = await page.screenshot({ type: "png", clip: { x: 0, y: 0, width: 320, height: 240 } });
  await page.setInputFiles("#hero-file", { name: "shop.png", mimeType: "image/png", buffer: swatch });
  await page.waitForSelector(".hero-pick img", { timeout: 5000 }).catch(() => {});
  check(await page.evaluate(() => /^data:image\/jpeg;base64,/.test(FM.store.all("sites")[0].heroPhoto.src)), "main photo is shrunk and stored as a JPEG");
  await page.fill('[data-f="heroPhoto.alt"]', "Our shop on Mill Street");
  await page.waitForFunction(() => document.getElementById("saved").textContent === "Saved", null, { timeout: 5000 }).catch(() => {});
  await page.screenshot({ path: path.join(SHOTS, "shopfront-edit-1440.png") });
  const [site] = await Promise.all([page.waitForEvent("download"), page.click('[data-act="download"]')]);
  check(site.suggestedFilename() === "index.html", "site downloads as index.html");
  const siteHtml = fs.readFileSync(await site.path(), "utf8");
  check(siteHtml.includes("data:font/woff2;base64,") && !/<script(?![^>]*ld\+json)/.test(siteHtml), "downloaded site carries its fonts and no scripts");
  const sp = await ctx.newPage();
  watch(sp, "published site");
  await sp.setContent(siteHtml, { waitUntil: "load" });
  check(await sp.evaluate(() => document.fonts.ready.then(() => document.fonts.check("600 20px Fraunces"))), "published site shows its own fonts");
  check((await sp.textContent(".hours")).includes("9 am – 5 pm") && (await sp.locator(".hero-img img").count()) === 1, "published site has hours and the photo");
  await sp.screenshot({ path: path.join(SHOTS, "shopfront-site-1440.png"), fullPage: true });
  await sp.setViewportSize({ width: 375, height: 812 });
  check(!(await sp.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)), "published site has no sideways scroll on a phone");
  await sp.screenshot({ path: path.join(SHOTS, "shopfront-site-375.png"), fullPage: true });
  await sp.close();
  check((await page.textContent("#dl-note")).includes("Downloaded"), "remembers the download");
  await page.goto(base + "shopfront/#publish", { waitUntil: "networkidle" });
  check(await page.locator(".host").count() === 3, "publish guide shows three free hosts");
  await page.fill("[data-pub-web]", "hollowoak.netlify.app");
  check(await page.evaluate(() => FM.store.profile().website) === "hollowoak.netlify.app", "web address saves to My business");
  await page.screenshot({ path: path.join(SHOTS, "shopfront-publish-1440.png"), fullPage: true });

  console.log("free limit");
  await page.evaluate(() => { for (let i = 0; i < 7; i++) FM.store.put("documents", { type: "invoice", status: "draft", number: "X" + i, lines: [], customer: { name: "T" } }); });
  await page.goto(base + "invoices/#new");
  await page.waitForTimeout(300);
  check(await page.locator("dialog.fm-dialog").isVisible(), "limit dialog at 10 documents");
  await page.click('dialog button[value="no"]');
  await page.locator("dialog.fm-dialog").waitFor({ state: "detached", timeout: 5000 }).catch(() => {});

  console.log("shift planner");
  await page.goto(base + "shifts/", { waitUntil: "networkidle" });
  check(await page.locator("#start").isVisible(), "asks who is on the team first");
  await page.screenshot({ path: path.join(SHOTS, "shifts-start-1440.png"), fullPage: true });
  await page.fill('#start textarea[name="names"]', "Ana Ruiz\nBen Okafor\nClare Doyle");
  await page.click('#start button[type="submit"]');
  await page.waitForSelector(".grid");
  check(await page.locator(".grid tbody tr").count() === 4, "three people and an open-shifts row");
  const days = await page.evaluate(() => Array.from(document.querySelectorAll(".grid thead th")).length);
  check(days === 9, "seven days plus name and hours columns");
  const ids = await page.evaluate(() => { const s = FM.store.all("staff"); const by = (n) => s.find((p) => p.name.startsWith(n)).id; return { ana: by("Ana"), ben: by("Ben"), clare: by("Clare") }; });
  const wk = await page.evaluate(() => Array.from(document.querySelectorAll(".cell-add")).slice(0, 7).map((b) => b.getAttribute("data-add").split("|")[0]));
  async function addShift(pid, day, start, end, extra) {
    await page.click(`.cell-add[data-add="${wk[day]}|${pid}"]`);
    await page.fill('dialog input[name="start"]', start);
    await page.fill('dialog input[name="end"]', end);
    if (extra) await extra();
    await page.click('dialog button[value="ok"]');
    await page.locator("dialog.sp-dialog").waitFor({ state: "detached", timeout: 5000 }).catch(() => {});
  }
  await addShift(ids.ana, 1, "07:00", "15:00", async () => {
    await page.fill('dialog input[name="breakMin"]', "30");
    await page.fill('dialog input[name="label"]', "Register");
    check((await page.textContent("dialog .len")).includes("7.5 hrs"), "dialog shows paid hours");
    await page.click(`dialog .tog:has(input[value="${wk[2]}"])`);
    await page.click(`dialog .tog:has(input[value="${wk[3]}"])`);
  });
  check(await page.evaluate((id) => FM.store.count("shifts", (s) => s.staffId === id), ids.ana) === 3, "one shift repeated across three days");
  await addShift(ids.ben, 1, "07:00", "15:00");
  check((await page.textContent(".tiles .tile:first-child b")).trim() === "30", "30 hours scheduled");
  check((await page.textContent(".tiles")).includes("Add wages"), "asks for wages before guessing a cost");
  await addShift(ids.ana, 1, "14:00", "22:00");
  check(await page.locator(".shift.has-warn").count() >= 2, "double booking is flagged");
  check((await page.textContent("#warnings")).includes("already working"), "warning says why");
  await page.screenshot({ path: path.join(SHOTS, "shifts-1440.png"), fullPage: true });
  const late = await page.evaluate((id) => FM.store.all("shifts").find((s) => s.staffId === id && s.start === "14:00").id, ids.ana);
  await page.click(`.grid .shift[data-shift="${late}"]`);
  await page.click('dialog [data-act="delete"]');
  await page.waitForTimeout(200);
  check(await page.locator(".shift.has-warn").count() === 0, "deleting the clash clears the warning");

  await page.goto(base + "shifts/#team");
  await page.click(`a.person[href="#p/${ids.ana}"]`);
  await page.fill('#pf input[name="phone"]', "(518) 555-0111");
  await page.fill('#pf input[name="wage"]', "18");
  await page.click('#pf button[type="submit"]');
  await page.goto(base + "shifts/#p/" + ids.ben);
  await page.waitForSelector("#pf");
  await page.fill('#pf input[name="wage"]', "20");
  await page.click('#pf .tog:has(input[value="6"])');
  await page.click('#pf button[type="submit"]');
  await page.waitForTimeout(150);
  check(await page.evaluate((id) => FM.store.get("staff", id).wage, ids.ana) === 1800, "hourly pay saved in cents");
  await page.screenshot({ path: path.join(SHOTS, "shifts-person-1440.png"), fullPage: true });
  await page.goto(base + "shifts/");
  await page.waitForSelector(".grid");
  check((await page.textContent(".tiles")).includes("$555.00"), "week's wages are $555.00");

  const benShift = await page.evaluate((id) => FM.store.all("shifts").find((s) => s.staffId === id).id, ids.ben);
  await page.click(`.grid .shift[data-shift="${benShift}"]`);
  await page.click('dialog [data-act="cover"]');
  check((await page.textContent("dialog .cover-list li:first-child")).includes("Clare"), "the free person is offered first");
  await page.screenshot({ path: path.join(SHOTS, "shifts-cover-1440.png") });
  await page.click(`dialog [data-give="${ids.clare}"]`);
  await page.waitForTimeout(200);
  check(await page.evaluate((id) => FM.store.get("shifts", id).staffId, benShift) === ids.clare, "cover hands the shift over");

  await page.click('[data-act="share"]');
  const shareUrl = await page.inputValue("#share-url");
  check(shareUrl.includes("/fair-measure/shifts/#view/"), "share link points at the planner");
  const packed = Buffer.from(shareUrl.split("#view/")[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
  check(packed.includes("Ana Ruiz") && !packed.includes("555-0111") && !packed.includes("1800"), "link carries names, not phone numbers or pay");
  check(await page.locator('dialog .share-list a[href^="sms:"]').count() === 1, "text button for the person with a phone number");
  await page.screenshot({ path: path.join(SHOTS, "shifts-share-1440.png") });
  await page.click('dialog button[value="done"]');
  await page.locator("dialog.sp-dialog").waitFor({ state: "detached", timeout: 5000 }).catch(() => {});
  check((await page.textContent(".week-tools")).includes("Shared"), "week shows it was shared");

  await page.goto(shareUrl);
  await page.waitForSelector("#me");
  await page.selectOption("#me", ids.ana);
  await page.waitForSelector(".v-mine");
  check((await page.textContent(".v-mine")).includes("Your shifts: 3"), "team member sees their own shifts");
  const [shiftIcs] = await Promise.all([page.waitForEvent("download"), page.click('.v-mine [data-act="ics"]')]);
  check(shiftIcs.suggestedFilename().endsWith(".ics") && fs.readFileSync(await shiftIcs.path(), "utf8").includes("BEGIN:VEVENT"), "calendar file downloads");
  await page.screenshot({ path: path.join(SHOTS, "shifts-view-1440.png"), fullPage: true });
  await page.click(".v-day li.me [data-ask] >> nth=0");
  await page.selectOption('dialog select[name="b"]', { index: 0 });
  await page.fill('dialog input[name="msg"]', "Doctor's appointment");
  await page.click('dialog button[value="ok"]');
  await page.waitForSelector("#req-text");
  const reqText = await page.inputValue("#req-text");
  check(reqText.includes("Could I trade my") && await page.locator('dialog a[href^="sms:"]').count() === 1, "request is written for the owner to receive");
  const askUrl = reqText.match(/https?:\S+#ask\/\S+/)[0];
  await page.click('dialog button[value="done"]');

  await page.goto(askUrl);
  await page.waitForSelector(".ask-card");
  check((await page.textContent(".ask-card h2")).includes("Ana Ruiz would like to trade shifts with Clare Doyle"), "owner sees the request plainly");
  await page.screenshot({ path: path.join(SHOTS, "shifts-ask-1440.png"), fullPage: true });
  await page.click('.ask-card [data-act="yes"]');
  await page.waitForSelector(".grid");
  check(await page.evaluate((a) => FM.store.count("shifts", (s) => s.staffId === a.clare) === 1 && FM.store.count("shifts", (s) => s.staffId === a.ana) === 3, ids), "approving swaps the shifts");
  check((await page.textContent(".week-tools")).includes("Changed since you shared it"), "reminds the owner to share again");

  await page.click('[data-act="next"]');
  await page.click('[data-act="copy-last"]');
  await page.click('dialog button[value="yes"]');
  await page.waitForTimeout(200);
  check(await page.locator(".grid .shift").count() === 4, "copy last week brings all four shifts");
  await page.evaluate(() => { for (let i = 0; i < 2; i++) FM.store.put("staff", { name: "Extra " + i }); });
  await page.goto(base + "shifts/#team");
  await page.fill('#add input[name="name"]', "Sixth Person");
  await page.click('#add button[type="submit"]');
  check(await page.locator("dialog.fm-dialog").isVisible(), "limit dialog at 5 people");
  await page.click('dialog button[value="no"]');
  await page.evaluate(() => FM.store.all("staff").filter((p) => p.name.startsWith("Extra")).forEach((p) => FM.store.remove("staff", p.id)));

  console.log("settings and backup");
  await page.goto(base + "settings/", { waitUntil: "networkidle" });
  check((await page.inputValue('input[name="name"]')) === "Hollow Oak Carpentry", "settings show shared profile");
  const [dl] = await Promise.all([page.waitForEvent("download"), page.click("#do-backup")]);
  const file = await dl.path();
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  check(data.app === "Fair Measure" && data.documents.length === 10 && data.customers.length === 2 && data.staff.length === 3 && data.shifts.length === 8 && data.sites.length === 1, "backup holds everything");
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
  await phone.addInitScript((d) => { if (!localStorage.getItem("fm.v1.profile")) { localStorage.setItem("fm.v1.profile", JSON.stringify(d.profile)); localStorage.setItem("fm.v1.documents", JSON.stringify(d.documents)); localStorage.setItem("fm.v1.customers", JSON.stringify(d.customers)); localStorage.setItem("fm.v1.items", JSON.stringify(d.items)); localStorage.setItem("fm.v1.costings", JSON.stringify(d.costings)); localStorage.setItem("fm.v1.staff", JSON.stringify(d.staff)); localStorage.setItem("fm.v1.shifts", JSON.stringify(d.shifts)); localStorage.setItem("fm.v1.sites", JSON.stringify(d.sites)); } }, data);
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

  await m.goto(base + "customers/", { waitUntil: "networkidle" });
  check(!(await m.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)), "no sideways scroll in the phone customer book");
  await m.screenshot({ path: path.join(SHOTS, "customers-375.png"), fullPage: true });
  await m.click(".person >> nth=0");
  await m.waitForSelector(".c-title h1");
  check(!(await m.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)), "no sideways scroll on a phone customer page");
  await m.screenshot({ path: path.join(SHOTS, "customer-375.png"), fullPage: true });
  await m.goto(base + "pricing/", { waitUntil: "networkidle" });
  await m.click(".price-row >> nth=0");
  await m.waitForTimeout(200);
  check((await m.textContent("#mini-price")).includes("8.75"), "phone shows the price in the bottom bar");
  check(!(await m.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)), "no sideways scroll in the phone price builder");
  await m.screenshot({ path: path.join(SHOTS, "pricing-375.png"), fullPage: true });
  await m.screenshot({ path: path.join(SHOTS, "pricing-375-fold.png") });

  await m.goto(base + "shifts/", { waitUntil: "networkidle" });
  check(await m.locator(".day-strip .day-btn").count() === 7, "phone plans one day at a time");
  await m.click(".day-strip .day-btn >> nth=1");
  check(await m.locator(".day-list .day-row").count() === 2, "phone day shows its shifts");
  check(!(await m.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)), "no sideways scroll in the phone shift planner");
  await m.screenshot({ path: path.join(SHOTS, "shifts-375.png"), fullPage: true });
  await m.click(".day-list .shift >> nth=0");
  check(!(await m.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)), "no sideways scroll in the phone shift dialog");
  await m.screenshot({ path: path.join(SHOTS, "shifts-dialog-375.png") });
  await m.click('dialog button[value="cancel"]');
  await m.goto(shareUrl.replace(/^http:\/\/[^/]+\/fair-measure\//, base));
  await m.waitForSelector("#me");
  check(!(await m.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)), "no sideways scroll in a shared schedule on a phone");
  await m.screenshot({ path: path.join(SHOTS, "shifts-view-375.png"), fullPage: true });

  await m.goto(base + "shopfront/", { waitUntil: "networkidle" });
  check(!(await m.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)), "no sideways scroll in the phone shopfront editor");
  await m.screenshot({ path: path.join(SHOTS, "shopfront-375.png"), fullPage: true });
  await m.click('.ed-switch [data-tab="preview"]');
  await m.waitForTimeout(300);
  check((await m.frameLocator("#pv").locator("h1").textContent()) === "Hollow Oak Carpentry", "phone preview shows the site");
  await m.screenshot({ path: path.join(SHOTS, "shopfront-preview-375.png") });

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
