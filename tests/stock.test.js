// Stock Book logic tests. Run: node tests/stock.test.js
const assert = require("assert");
const K = require("../stock/stock.js");

let n = 0;
function test(name, fn) { fn(); n++; console.log("  ok " + name); }

test("reads quantities the way people type them", () => {
  assert.strictEqual(K.parseQty("12"), 12);
  assert.strictEqual(K.parseQty("2.5"), 2.5);
  assert.strictEqual(K.parseQty("2,5"), 2.5);
  assert.strictEqual(K.parseQty(".5"), 0.5);
  assert.strictEqual(K.parseQty("1 1/2"), 1.5);
  assert.strictEqual(K.parseQty("3/4"), 0.75);
  assert.strictEqual(K.parseQty("-3"), -3);
  assert.strictEqual(K.parseQty(""), null);
  assert.strictEqual(K.parseQty("lots"), null);
  assert.strictEqual(K.parseQty("1/0"), null);
  assert.strictEqual(K.fmtQty(0.1 + 0.2), "0.3");
  assert.strictEqual(K.fmtQty(-2), "−2");
});

test("replays changes in date order, and a count sets the level", () => {
  const ev = [
    { id: "c", stockId: "a", kind: "sold", qty: -3, date: "2026-03-05", createdAt: "2026-03-05T10:00:00Z" },
    { id: "a", stockId: "a", kind: "count", counted: 10, date: "2026-03-01", createdAt: "2026-03-01T09:00:00Z" },
    { id: "b", stockId: "a", kind: "in", qty: 24, unitCost: 150, date: "2026-03-03", createdAt: "2026-03-03T09:00:00Z" },
    { id: "d", stockId: "a", kind: "count", counted: 29, date: "2026-03-06", createdAt: "2026-03-06T09:00:00Z" },
    { id: "e", stockId: "a", kind: "waste", qty: -1.5, date: "2026-03-07", createdAt: "2026-03-07T09:00:00Z" }
  ];
  const r = K.replay(ev);
  assert.strictEqual(r.onHand, 27.5);
  assert.strictEqual(r.cost, 150);
  assert.strictEqual(r.counted, "2026-03-06");
  assert.deepStrictEqual(r.history.map((h) => h.after), [10, 34, 31, 29, 27.5]);
  assert.strictEqual(r.history[3].change, -2, "the count shows how far off the book was");
  assert.strictEqual(K.replay(ev, "2026-03-04").onHand, 34, "level on a past date");
  assert.strictEqual(K.replay(ev, "2026-02-01").onHand, 0);
});

test("within one day, events run in the order they were recorded", () => {
  const ev = [
    { id: "2", kind: "count", counted: 5, date: "2026-04-01", createdAt: "2026-04-01T08:00:00Z" },
    { id: "3", kind: "sold", qty: -2, date: "2026-04-01", createdAt: "2026-04-01T15:00:00Z" },
    { id: "1", kind: "in", qty: 100, date: "2026-04-01", createdAt: "2026-04-01T07:00:00Z" }
  ];
  assert.strictEqual(K.replay(ev).onHand, 3, "morning count, afternoon sale");
});

test("only sent, paid or overdue invoices take stock, matched by name or linked item", () => {
  const stock = [
    { id: "s1", name: "Honey jar, 12 oz" },
    { id: "s2", name: "Beeswax candle", itemId: "it2" },
    { id: "s3", name: "Old thing", archived: true }
  ];
  const items = [{ id: "it2", name: "Hand-dipped candle" }];
  const docs = [
    { id: "d1", type: "invoice", status: "paid", issueDate: "2026-05-02", number: "INV-0001", customer: { name: "Rosa" },
      lines: [{ description: "honey jar,  12 oz", qty: 4 }, { description: "Hand-dipped candle", qty: 2 }, { description: "Delivery", qty: 1 }, { description: "Honey jar, 12 oz", qty: "1" }] },
    { id: "d2", type: "invoice", status: "draft", issueDate: "2026-05-03", lines: [{ description: "Honey jar, 12 oz", qty: 9 }] },
    { id: "d3", type: "quote", status: "sent", issueDate: "2026-05-03", lines: [{ description: "Honey jar, 12 oz", qty: 9 }] },
    { id: "d4", type: "invoice", status: "void", issueDate: "2026-05-03", lines: [{ description: "Honey jar, 12 oz", qty: 9 }] },
    { id: "d5", type: "invoice", status: "sent", issueDate: "2026-05-04", lines: [{ description: "Old thing", qty: 9 }] }
  ];
  const sales = K.salesFromDocs(docs, stock, items);
  assert.strictEqual(sales.length, 2);
  const honey = sales.find((s) => s.stockId === "s1");
  assert.strictEqual(honey.qty, -5, "two lines for the same thing add up");
  assert.strictEqual(honey.docNumber, "INV-0001");
  assert.strictEqual(honey.customer, "Rosa");
  assert.strictEqual(sales.find((s) => s.stockId === "s2").qty, -2);
});

test("levels and value: current cost now, the cost at the time for a past date", () => {
  const stock = [
    { id: "a", name: "Flour", unitCost: 90, reorderAt: 20, kind: "supply" },
    { id: "b", name: "Jam", unitCost: 300 },
    { id: "c", name: "Never counted", unitCost: 500 }
  ];
  const moves = [
    { id: "1", stockId: "a", kind: "in", qty: 50, unitCost: 80, date: "2025-12-01" },
    { id: "2", stockId: "a", kind: "used", qty: -35, date: "2026-01-10" },
    { id: "3", stockId: "b", kind: "count", counted: 12, date: "2025-11-01" },
    { id: "4", stockId: "b", kind: "sold", qty: -20, date: "2026-01-12" }
  ];
  const now = K.levels(stock, moves, []);
  assert.strictEqual(now.a.onHand, 15);
  assert.strictEqual(now.a.value, 1350, "15 x 90 cents");
  assert.strictEqual(now.a.low, true);
  assert.strictEqual(now.b.onHand, -8);
  assert.strictEqual(now.b.value, 0, "below zero is worth nothing, not a negative");
  assert.strictEqual(now.c.value, 0);
  assert.strictEqual(K.totalValue(stock, now), 1350);
  const ye = K.levels(stock, moves, [], "2025-12-31");
  assert.strictEqual(ye.a.onHand, 50);
  assert.strictEqual(ye.a.value, 4000, "50 x the 80 cents paid then");
  assert.strictEqual(ye.b.value, 3600);
});

test("low means at or under the level the owner set", () => {
  assert.strictEqual(K.isLow({ reorderAt: 5 }, 5), true);
  assert.strictEqual(K.isLow({ reorderAt: 5 }, 6), false);
  assert.strictEqual(K.isLow({ reorderAt: 0 }, 0), true);
  assert.strictEqual(K.isLow({ reorderAt: "" }, -3), false);
  assert.strictEqual(K.isLow({}, 0), false);
  assert.strictEqual(K.isOut(0.0001), true);
  assert.strictEqual(K.isOut(1), false);
});

test("pace: what went out lately, without stretching a new book over sixty days", () => {
  const h = [
    { kind: "count", counted: 100, date: "2026-06-01" },
    { kind: "sold", qty: -14, date: "2026-06-03" },
    { kind: "in", qty: 20, date: "2026-06-04" },
    { kind: "used", qty: -14, date: "2026-06-10" }
  ];
  const perDay = K.dailyUse(h, "2026-06-14");
  assert.strictEqual(perDay, 2, "28 out over the 14 days the book has existed");
  assert.strictEqual(K.weeksLeft(28, perDay), 2);
  assert.strictEqual(K.weeksLeft(5, 0), null);
  const old = [{ kind: "count", counted: 1, date: "2025-01-01" }, { kind: "sold", qty: -60, date: "2026-06-10" }];
  assert.strictEqual(K.dailyUse(old, "2026-06-14"), 1, "60 over the full sixty days");
  assert.strictEqual(K.dailyUse([{ kind: "sold", qty: -9, date: "2026-06-14" }], "2026-06-14"), 9 / 7, "at least a week");
});

test("reorder list groups by supplier and suggests a sensible amount", () => {
  const stock = [
    { id: "a", name: "Jars", supplier: "Glass Co", reorderAt: 24, reorderQty: 144, unitCost: 50, unit: "jar", sku: "J12" },
    { id: "b", name: "Lids", supplier: "glass co ", reorderAt: 24, unitCost: 10 },
    { id: "c", name: "Labels", reorderAt: 100 },
    { id: "d", name: "Wax", supplier: "Apiary", reorderAt: 5 },
    { id: "e", name: "No level set", supplier: "Apiary" },
    { id: "f", name: "Archived", supplier: "Apiary", reorderAt: 5, archived: true }
  ];
  const lv = { a: { onHand: 10, unitCost: 50 }, b: { onHand: 4, unitCost: 10 }, c: { onHand: 100.5, unitCost: 0 }, d: { onHand: 5, unitCost: 0 }, e: { onHand: 0 }, f: { onHand: 0 } };
  const g = K.reorderList(stock, lv);
  assert.deepStrictEqual(g.map((x) => x.supplier), ["Apiary", "Glass Co"]);
  assert.deepStrictEqual(g[1].lines.map((l) => [l.name, l.qty]), [["Jars", 144], ["Lids", 44]]);
  assert.strictEqual(g[1].cost, 144 * 50 + 44 * 10);
  assert.strictEqual(g[0].lines[0].qty, 5);
  const txt = K.orderText(g[1], "Hollow Oak Apiary");
  assert.ok(txt.startsWith("Hello Glass Co,\n\nPlease send:\n- 144 jar Jars (J12)\n- 44 Lids\n"));
  assert.ok(txt.endsWith("Thank you,\nHollow Oak Apiary\n"));
  assert.ok(K.orderText({ supplier: "", lines: [] }, "").startsWith("Please send:"));
});

test("spreadsheet export is safe to open", () => {
  const out = K.csv([{ name: "=SUM(A1)", kind: "supply", onHand: 2.5, unitCost: 199, value: 498, supplier: 'Smith, "Bob"' }], "2025-12-31");
  const lines = out.trim().split("\r\n");
  assert.strictEqual(lines[0], "Name,Kind,SKU,Unit,On hand 2025-12-31,Unit cost,Value,Supplier,Location");
  assert.strictEqual(lines[1], "'=SUM(A1),Supply,,,2.5,1.99,4.98,\"Smith, \"\"Bob\"\"\",");
});

test("dates", () => {
  assert.strictEqual(K.addDays("2026-02-27", 3), "2026-03-02");
  assert.strictEqual(K.daysBetween("2026-01-01", "2026-03-01"), 59);
  assert.strictEqual(K.validDate("2026-02-03"), true);
  assert.strictEqual(K.validDate("soon"), false);
});

console.log(n + " stock tests passed");
