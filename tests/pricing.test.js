// Arithmetic checks for Price Builder. Run: node tests/pricing.test.js
const assert = require("assert");
const P = require("../pricing/calc.js");
let n = 0;
function t(name, fn) { fn(); n++; }
function near(a, b, msg) { assert.ok(Math.abs(a - b) < 0.01, msg + ": " + a + " vs " + b); }

const base = {
  materials: [{ qty: 2, cost: 500 }],
  labor: [{ hours: 2, rate: 2500 }],
  overheadRate: 500, yield: 4, margin: 20
};

t("batch costs split per unit", () => {
  const r = P.compute(base);
  assert.strictEqual(r.batch.cost, 7000);
  assert.strictEqual(r.unit.cost, 1750);
  assert.strictEqual(r.unit.hours, 0.5);
  assert.strictEqual(r.suggested, 2188); // 1750 / 0.8 = 2187.5, rounded up
});

t("rounding only goes up", () => {
  assert.strictEqual(P.compute(Object.assign({}, base, { roundTo: 100 })).suggested, 2200);
  assert.strictEqual(P.compute(Object.assign({}, base, { roundTo: 25 })).suggested, 2200);
  assert.strictEqual(P.roundUp(2000, 100), 2000);
  assert.strictEqual(P.roundUp(2000.4, 1), 2001);
});

t("selling fees are taken from the price, not the cost", () => {
  const r = P.compute({ materials: [{ qty: 1, cost: 1000 }], feePercent: 3, feeFixed: 30, margin: 20 });
  assert.strictEqual(r.suggested, 1338); // (1000 + 30) / 0.77
  near(r.unit.fees, 1338 * 0.03 + 30, "fees");
  assert.ok(r.margin >= 20, "margin after fees is at least the target");
  assert.strictEqual(r.breakEven, 1062); // (1000 + 30) / 0.97
});

t("your own price shows the real margin and hourly pay", () => {
  const r = P.compute(Object.assign({}, base, { price: 1750 }));
  assert.strictEqual(r.usingSuggested, false);
  near(r.profit, 0, "profit at cost");
  near(r.perHour, 2500, "earns exactly the wage at cost");
  const low = P.compute(Object.assign({}, base, { price: 1500 }));
  near(low.perHour, 2000, "undercharging eats into the wage"); // (1250 - 250) / 0.5
  assert.ok(low.margin < 0);
});

t("waste and extra costs", () => {
  const r = P.compute({ materials: [{ qty: 10, cost: 100 }], wastePercent: 10, extraCost: 200, yield: 2 });
  assert.strictEqual(r.batch.materials, 1100);
  assert.strictEqual(r.unit.cost, 650);
  assert.strictEqual(r.perHour, null);
});

t("margin plus fees that leave no room is flagged, not divided by zero", () => {
  const r = P.compute({ materials: [{ qty: 1, cost: 1000 }], feePercent: 30, margin: 70 });
  assert.strictEqual(r.impossible, true);
  assert.strictEqual(r.suggested, 0);
});

t("wholesale and shelf price", () => {
  const r = P.compute(Object.assign({}, base, { roundTo: 100, wholesale: { on: true, margin: 10, storeMarkup: 2 } }));
  assert.strictEqual(r.wholesale.price, 2000); // 1750 / 0.9 = 1944.4 -> 2000
  assert.strictEqual(r.wholesale.shelf, 4000);
  assert.strictEqual(r.wholesale.undercuts, true); // selling direct at 22 under a 40 shelf price
});

t("empty and nonsense input is harmless", () => {
  const r = P.compute({});
  assert.deepStrictEqual([r.unit.cost, r.suggested, r.price, r.profit], [0, 0, 0, 0]);
  const x = P.compute({ materials: [{ qty: "abc", cost: "x" }], labor: [{ hours: -3, rate: 900 }], yield: 0, margin: "-5" });
  assert.deepStrictEqual([x.unit.cost, x.suggested], [0, 0]);
});

t("overhead per hour", () => {
  assert.strictEqual(P.overheadRate(120000, 120), 1000);
  assert.strictEqual(P.overheadRate(50000, 0), 0);
});

console.log(n + " pricing checks passed");
