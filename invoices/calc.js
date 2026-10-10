/* Quote and invoice arithmetic. Pure functions, all money in whole cents.
   Loaded by the page (window.FMCalc) and by the tests (module.exports). */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.FMCalc = factory();
})(this, function () {
  "use strict";

  function num(v) { var n = parseFloat(v); return isFinite(n) ? n : 0; }

  function lineTotal(line) {
    return Math.round(num(line.qty) * (parseInt(line.price, 10) || 0));
  }

  // Discount is spread across lines in proportion to their value, so tax is only
  // charged on what the customer actually pays for taxable lines.
  function totals(doc) {
    var lines = doc.lines || [];
    var subtotal = 0, taxableSubtotal = 0;
    lines.forEach(function (l) {
      var t = lineTotal(l);
      subtotal += t;
      if (l.taxable) taxableSubtotal += t;
    });
    var discount = 0;
    var dv = num(doc.discountValue);
    if (dv > 0 && subtotal > 0) {
      discount = doc.discountType === "amount"
        ? Math.min(Math.round(dv * 100), subtotal)
        : Math.round(subtotal * Math.min(dv, 100) / 100);
    }
    var taxableDiscount = subtotal > 0 ? Math.round(discount * taxableSubtotal / subtotal) : 0;
    var taxBase = Math.max(0, taxableSubtotal - taxableDiscount);
    var tax = Math.round(taxBase * Math.max(0, num(doc.taxRate)) / 100);
    var total = subtotal - discount + tax;
    var deposit = Math.round(total * Math.min(Math.max(0, num(doc.depositPercent)), 100) / 100);
    var paid = Math.max(0, parseInt(doc.paidAmount, 10) || 0);
    return { subtotal: subtotal, discount: discount, taxBase: taxBase, tax: tax, total: total, deposit: deposit, paid: paid, balance: total - paid };
  }

  function addDays(isoDate, days) {
    var d = new Date(isoDate + "T12:00:00");
    d.setDate(d.getDate() + (parseInt(days, 10) || 0));
    return d.toISOString().slice(0, 10);
  }

  function today() {
    var d = new Date();
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  }

  // The status a person should see, which can differ from the stored one (an unpaid
  // invoice past its due date shows as overdue).
  function displayStatus(doc, now) {
    now = now || today();
    if (doc.type === "invoice" && doc.status === "sent" && doc.dueDate && doc.dueDate < now) return "overdue";
    if (doc.type === "quote" && doc.status === "sent" && doc.validUntil && doc.validUntil < now) return "expired";
    return doc.status || "draft";
  }

  return { lineTotal: lineTotal, totals: totals, addDays: addDays, today: today, displayStatus: displayStatus };
});
