// Arithmetic checks for Cash Book. Run: node tests/cash.test.js
const assert = require("assert");
const C = require("../cash/calc.js");
let n = 0;
function t(name, fn) { try { fn(); n++; } catch (e) { console.error("x " + name); throw e; } }

t("IRS mileage rates by date, including the 2026 midyear change", () => {
  assert.strictEqual(C.mileageRate("2024-05-01"), 67);
  assert.strictEqual(C.mileageRate("2025-12-31"), 70);
  assert.strictEqual(C.mileageRate("2026-06-30"), 72.5);
  assert.strictEqual(C.mileageRate("2026-07-01"), 76);
  assert.strictEqual(C.mileageRate("2026-03-01", "80"), 80);
  assert.ok(C.rateKnown(2026));
  assert.ok(!C.rateKnown(2027));
});

t("trip miles and deduction", () => {
  assert.strictEqual(C.tripMiles({ miles: "12.4", roundTrip: true }), 24.8);
  assert.strictEqual(C.tripMiles({ miles: "-3" }), 0);
  assert.strictEqual(C.tripDeduction({ date: "2026-03-02", miles: 10, roundTrip: true }), 1450); // 20 x 72.5
  assert.strictEqual(C.tripDeduction({ date: "2026-08-02", miles: 0.5 }), 38); // 0.5 x 76
});

t("estimated tax periods and weekend due dates", () => {
  const q = C.quarters(2026);
  assert.deepStrictEqual(q.map((x) => [x.from, x.to]), [["2026-01-01", "2026-03-31"], ["2026-04-01", "2026-05-31"], ["2026-06-01", "2026-08-31"], ["2026-09-01", "2026-12-31"]]);
  assert.deepStrictEqual(q.map((x) => x.due), ["2026-04-15", "2026-06-15", "2026-09-15", "2027-01-15"]);
  // 2028: Apr 15 is a Saturday, Jan 15 2028 is a Saturday too.
  assert.strictEqual(C.quarters(2028)[0].due, "2028-04-17");
  assert.strictEqual(C.quarters(2027)[3].due, "2028-01-17");
});

t("tax payments count toward the right period", () => {
  assert.strictEqual(C.paymentQuarter({ date: "2027-01-10" }), "2026-Q4");
  assert.strictEqual(C.paymentQuarter({ date: "2026-04-14" }), "2026-Q1");
  assert.strictEqual(C.paymentQuarter({ date: "2026-04-16" }), "2026-Q2");
  assert.strictEqual(C.paymentQuarter({ date: "2026-12-20" }), "2026-Q4");
  assert.strictEqual(C.paymentQuarter({ date: "2026-05-01", quarter: "2026-Q1" }), "2026-Q1");
});

const entries = [
  { kind: "in", category: "sales", date: "2026-02-10", amount: 150000 },
  { kind: "in", category: "other-in", date: "2026-02-11", amount: 5000 },
  { kind: "in", category: "owner-in", date: "2026-02-12", amount: 200000 },
  { kind: "out", category: "supplies", date: "2026-02-15", amount: 20000 },
  { kind: "out", category: "cogs", date: "2026-03-01", amount: 30000 },
  { kind: "out", category: "meals", date: "2026-03-02", amount: 5001 },
  { kind: "out", category: "software", date: "2026-03-03", amount: 1200 },
  { kind: "out", category: "other-out", date: "2026-03-03", amount: 800 },
  { kind: "out", category: "owner-out", date: "2026-03-04", amount: 50000 },
  { kind: "out", category: "est-tax", date: "2026-04-10", amount: 20000 },
  { kind: "in", category: "sales", date: "2025-12-30", amount: 99999 }
];
const trips = [{ date: "2026-03-05", miles: 10, roundTrip: true }];

t("year totals leave out owner money, draws and tax payments", () => {
  const r = C.totals(entries, trips, "2026-01-01", "2026-12-31");
  assert.strictEqual(r.income, 155000);
  assert.strictEqual(r.ownerIn, 200000);
  assert.strictEqual(r.draws, 50000);
  assert.strictEqual(r.taxPaid, 20000);
  assert.strictEqual(r.cogs, 30000);
  assert.strictEqual(r.mileage, 1450);
  assert.strictEqual(r.miles, 20);
  // supplies 20000 + half of meals 2501 + software 1200 + other 800 + mileage 1450
  assert.strictEqual(r.expenses, 25951);
  assert.strictEqual(r.profit, 155000 - 30000 - 25951);
  assert.strictEqual(r.spent, 20000 + 30000 + 5001 + 1200 + 800);
});

t("Schedule C lines add up to the same profit", () => {
  const s = C.scheduleC(entries, trips, 2026);
  const row = (l) => s.rows.find((r) => r.line === l);
  assert.strictEqual(row("1").amount, 150000);
  assert.strictEqual(row("4").amount, 30000);
  assert.strictEqual(row("6").amount, 5000);
  assert.strictEqual(row("7").amount, 125000);
  assert.strictEqual(row("9").amount, 1450);
  assert.strictEqual(row("24b").amount, 2501);
  assert.strictEqual(row("27a").amount, 2000);
  assert.strictEqual(row("28").amount, 25951);
  assert.strictEqual(row("31").amount, s.totals.profit);
  const sum = s.rows.filter((r) => !r.total && !["1", "4", "6"].includes(r.line)).reduce((a, r) => a + r.amount, 0);
  assert.strictEqual(sum, row("28").amount);
});

t("tax plan sets aside a share of each period's profit", () => {
  const plan = C.taxPlan(entries, trips, 2026, 25, "2026-05-01");
  assert.strictEqual(plan[0].profit, 99049);
  assert.strictEqual(plan[0].setAside, 24762);
  assert.strictEqual(plan[0].paid, 20000);
  assert.deepStrictEqual(plan.map((q) => q.state), ["past", "now", "ahead", "ahead"]);
  assert.strictEqual(plan[1].setAside, 0);
  const loss = C.taxPlan([{ kind: "out", category: "supplies", date: "2026-01-05", amount: 100 }], [], 2026, 30, "2026-02-01");
  assert.strictEqual(loss[0].setAside, 0);
  assert.strictEqual(C.taxPlan([], [], 2026, 25, "2026-04-10")[0].state, "due");
});

t("monthly cash in and out", () => {
  const m = C.monthly(entries, 2026);
  assert.strictEqual(m[1].in, 155000);
  assert.strictEqual(m[1].out, 20000);
  assert.strictEqual(m[2].out, 30000 + 5001 + 1200 + 800);
  assert.strictEqual(m[3].out, 0);
});

t("unknown categories fall back by kind, nonsense is harmless", () => {
  const r = C.totals([{ kind: "out", category: "nope", date: "2026-01-01", amount: 500 }, { kind: "in", date: "2026-01-02", amount: "abc" }], [{ date: "2026-01-03", miles: "x" }], "2026-01-01", "2026-12-31");
  assert.strictEqual(r.lines["27a"], 500);
  assert.strictEqual(r.income, 0);
  assert.strictEqual(r.mileage, 0);
});

t("CSV escapes quotes, commas and formula starts", () => {
  assert.strictEqual(C.csv([["a", 'say "hi"', "x,y"]]), 'a,"say ""hi""","x,y"\r\n');
  assert.strictEqual(C.csvCell("=SUM(A1)"), "'=SUM(A1)");
  assert.strictEqual(C.csvCell(-12.5), "-12.5");
});

console.log(n + " cash checks passed");
