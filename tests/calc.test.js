// Arithmetic checks for Quotes & Invoices. Run: node tests/calc.test.js
const assert = require("assert");
const C = require("../invoices/calc.js");
let n = 0;
function t(name, fn) { fn(); n++; }

t("line total rounds to the cent", () => {
  assert.strictEqual(C.lineTotal({ qty: "3", price: 333 }), 999);
  assert.strictEqual(C.lineTotal({ qty: "1.5", price: 1999 }), 2999); // 2998.5 -> 2999
  assert.strictEqual(C.lineTotal({ qty: "", price: 500 }), 0);
});

t("hero sample on the home page adds up", () => {
  const r = C.totals({ lines: [{ qty: 1, price: 145000, taxable: true }, { qty: 6, price: 6500, taxable: true }, { qty: 1, price: 6420, taxable: true }], taxRate: 8.25 });
  assert.strictEqual(r.subtotal, 190420);
  assert.strictEqual(r.tax, 15710);
  assert.strictEqual(r.total, 206130);
});

t("tax only on taxable lines", () => {
  const r = C.totals({ lines: [{ qty: 1, price: 10000, taxable: true }, { qty: 1, price: 5000, taxable: false }], taxRate: 10 });
  assert.strictEqual(r.tax, 1000);
  assert.strictEqual(r.total, 16000);
});

t("percent discount is spread before tax", () => {
  const r = C.totals({ lines: [{ qty: 1, price: 10000, taxable: true }, { qty: 1, price: 10000, taxable: false }], taxRate: 10, discountType: "percent", discountValue: "10" });
  assert.strictEqual(r.discount, 2000);
  assert.strictEqual(r.taxBase, 9000);
  assert.strictEqual(r.tax, 900);
  assert.strictEqual(r.total, 18900);
});

t("amount discount never exceeds subtotal", () => {
  const r = C.totals({ lines: [{ qty: 1, price: 1000, taxable: true }], taxRate: 5, discountType: "amount", discountValue: "50" });
  assert.strictEqual(r.discount, 1000);
  assert.strictEqual(r.tax, 0);
  assert.strictEqual(r.total, 0);
});

t("deposit and balance", () => {
  const r = C.totals({ lines: [{ qty: 1, price: 30001, taxable: false }], depositPercent: "50", paidAmount: 10000 });
  assert.strictEqual(r.deposit, 15001);
  assert.strictEqual(r.balance, 20001);
});

t("nonsense input is harmless", () => {
  const r = C.totals({ lines: [{ qty: "abc", price: "x", taxable: true }], taxRate: "-5", discountValue: "200" });
  assert.deepStrictEqual([r.subtotal, r.tax, r.total], [0, 0, 0]);
});

t("dates", () => {
  assert.strictEqual(C.addDays("2026-12-25", 14), "2027-01-08");
  assert.strictEqual(C.displayStatus({ type: "invoice", status: "sent", dueDate: "2026-01-01" }, "2026-02-01"), "overdue");
  assert.strictEqual(C.displayStatus({ type: "invoice", status: "paid", dueDate: "2026-01-01" }, "2026-02-01"), "paid");
  assert.strictEqual(C.displayStatus({ type: "quote", status: "sent", validUntil: "2026-01-01" }, "2026-02-01"), "expired");
});

console.log(n + " calc checks passed");
