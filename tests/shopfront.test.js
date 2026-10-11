// Checks for the Shopfront Studio site builder. Run: node tests/shopfront.test.js
const assert = require("assert");
const B = require("../shopfront/site.js");
let n = 0;
function t(name, fn) { fn(); n++; }

const profile = { name: "Hollow Oak Carpentry", owner: "Dax", phone: "(518) 555-0140", email: "hello@hollowoak.example", address: "12 Mill Street\nSaratoga Springs, NY 12866", website: "hollowoak.example" };
const items = [{ id: "a", name: "Bookshelf", price: 145000, unit: "" }, { id: "b", name: "Install", price: 6500, unit: "hour" }, { id: "c", name: "Hidden", price: 100 }];
function site(patch) { return Object.assign(B.starter("trades", profile, items.slice(0, 2)), patch || {}); }

t("a starter site is filled in from the business book", () => {
  const s = site();
  assert.strictEqual(s.headline, "Hollow Oak Carpentry");
  assert.deepStrictEqual(s.offer.itemIds, ["a", "b"]);
  assert.ok(s.hours.days.every((d) => d.closed), "never invents opening hours");
  assert.ok(s.faq.list.every((f) => f.a === ""), "never invents answers");
});

t("the page has the business, its prices and a way to call", () => {
  const html = B.build(site(), profile, items, { year: 2026 });
  assert.ok(html.startsWith("<!doctype html>"));
  assert.ok(html.includes("<title>Hollow Oak Carpentry | Careful work, honestly priced</title>"));
  assert.ok(html.includes('href="tel:5185550140"'));
  assert.ok(html.includes("$1,450.00") && html.includes("/ hour"));
  assert.ok(!html.includes("Hidden"), "only picked items appear");
  assert.ok(html.includes('rel="canonical" href="https://hollowoak.example"'));
  assert.ok(html.includes("Made with"), "free sites carry the small credit line");
  assert.ok(!B.build(site(), profile, items, { pro: true }).includes("Made with"), "Pro removes it");
});

t("the published page runs no scripts and loads nothing from elsewhere", () => {
  const html = B.build(site(), profile, items, {});
  assert.ok(/default-src 'none'/.test(html));
  assert.ok(!/<script(?![^>]*application\/ld\+json)/.test(html), "only the structured-data block");
  assert.ok(!/(src|href)="http:/.test(html));
  assert.ok(!/<link rel="stylesheet"/.test(html));
});

t("empty sections stay off the page", () => {
  const html = B.build(site(), profile, items, {});
  assert.ok(!html.includes('id="about"') && !html.includes('id="kind-words"') && !html.includes('id="questions"') && !html.includes('id="photos"'));
  const off = B.build(site({ offer: Object.assign(site().offer, { show: false }) }), profile, items, {});
  assert.ok(!off.includes('id="offer"'));
});

t("everything typed is escaped", () => {
  const evil = site({ tagline: '<script>alert(1)</script>', intro: '"><img src=x onerror=alert(1)>', reviews: { show: true, list: [{ text: "<b>hi</b>", name: "</cite>" }] } });
  const p = Object.assign({}, profile, { name: "A & B </script>" });
  const html = B.build(evil, p, items, {});
  assert.ok(!html.includes("<script>alert"));
  assert.ok(!html.includes("<img src=x"));
  assert.ok(html.includes("&lt;b&gt;hi&lt;/b&gt;"));
  const ld = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1];
  assert.ok(!ld.includes("<"), "structured data can't close its script element");
  assert.strictEqual(JSON.parse(ld).name, "A & B </script>");
});

t("only safe links and our own photos get through", () => {
  assert.strictEqual(B.webHref("javascript:alert(1)"), "");
  assert.strictEqual(B.webHref("facebook.com/hollowoak"), "https://facebook.com/hollowoak");
  assert.strictEqual(B.mailHref("not an email"), "");
  assert.strictEqual(B.telHref("call me"), "");
  assert.strictEqual(B.imgSrc("https://evil.example/x.png"), "");
  assert.strictEqual(B.imgSrc('data:image/jpeg;base64,abc"onerror'), "");
  assert.ok(B.imgSrc("data:image/jpeg;base64,/9j/4AAQ=="));
  assert.strictEqual(B.socialName("https://www.instagram.com/hollowoak"), "Instagram");
  assert.strictEqual(B.socialName("https://shop.example.com/x"), "shop.example.com");
});

t("hours group neighbouring days", () => {
  const days = [0, 1, 2, 3, 4, 5, 6].map((i) => ({ closed: i === 6, open: i === 5 ? "10:00" : "09:00", close: i === 5 ? "14:30" : "17:00" }));
  const rows = B.hourRows(days);
  assert.deepStrictEqual(rows.map((r) => r.label + " " + r.text), ["Mon – Fri 9 am – 5 pm", "Saturday 10 am – 2:30 pm", "Sunday Closed"]);
  const html = B.build(site({ hours: Object.assign(site().hours, { days }) }), profile, items, {});
  const ld = JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
  assert.strictEqual(ld.openingHoursSpecification.length, 6);
  assert.strictEqual(ld.openingHoursSpecification[5].closes, "14:30");
  assert.strictEqual(B.fmtTime("00:00"), "12 am");
  assert.strictEqual(B.fmtTime("12:15"), "12:15 pm");
});

t("a chosen color is darkened until white text is readable", () => {
  const acc = B.readableAccent("#f0d080");
  assert.ok(B.contrast(B.hexRgb(acc), [255, 255, 255]) >= 4.5);
  assert.strictEqual(B.readableAccent("#3d5876"), "#3d5876", "already readable colors are kept");
  Object.keys(B.PALETTES).forEach((k) => assert.ok(B.contrast(B.hexRgb(B.PALETTES[k].accent), [255, 255, 255]) >= 4.5, k + " palette is readable"));
  const custom = site({ look: { palette: "sage", type: "classic", custom: "#ffcc00" } });
  assert.ok(!B.build(custom, profile, items, {}).includes("#ffcc00"), "own color is Pro only");
  assert.ok(B.build(custom, profile, items, { pro: true }).includes("--accent:" + B.readableAccent("#ffcc00")));
});

t("the checklist only blocks what truly matters", () => {
  const c = B.checklist(site(), profile, items);
  assert.ok(c.every((x) => x.soft), "a filled-in business has nothing blocking");
  assert.ok(c.some((x) => x.id === "intro") && c.some((x) => x.id === "hours"));
  const none = B.checklist(site(), { name: "" }, items);
  assert.ok(none.some((x) => x.id === "name" && !x.soft) && none.some((x) => x.id === "contact" && !x.soft));
});

t("fonts are embedded only when the lettering uses them", () => {
  const fonts = { fraunces: "data:font/woff2;base64,AAA", sans: "data:font/woff2;base64,BBB" };
  assert.ok(B.build(site(), profile, items, { fonts }).includes("AAA"));
  const trad = site({ look: { palette: "parchment", type: "traditional", custom: "" } });
  const html = B.build(trad, profile, items, { fonts });
  assert.ok(!html.includes("AAA") && !html.includes("BBB"));
});

console.log(n + " Shopfront Studio checks passed");
