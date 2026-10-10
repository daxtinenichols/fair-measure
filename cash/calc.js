/* Cash Book arithmetic. Pure functions, all money in whole cents.
   Loaded by the page (window.FMCash) and by the tests (module.exports).
   Categories follow the lines of IRS Schedule C (Form 1040), so the year-end summary
   lines up with the form a sole proprietor or single-member LLC files. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.FMCash = factory();
})(this, function () {
  "use strict";

  // kind: "in" or "out". line: the Schedule C line, or null when it isn't business
  // income or a deduction (owner money, draws, tax payments). share: deductible part.
  var CATEGORIES = [
    { id: "sales", kind: "in", label: "Sales and services", line: "1" },
    { id: "other-in", kind: "in", label: "Other business income", line: "6" },
    { id: "owner-in", kind: "in", label: "Owner money or loan (not income)", line: null },

    { id: "supplies", kind: "out", label: "Supplies", line: "22" },
    { id: "cogs", kind: "out", label: "Materials and stock you sell", line: "4" },
    { id: "advertising", kind: "out", label: "Advertising", line: "8" },
    { id: "vehicle", kind: "out", label: "Car and truck, actual costs", line: "9" },
    { id: "fees", kind: "out", label: "Card, bank and platform fees", line: "10" },
    { id: "contract", kind: "out", label: "Contract labor", line: "11" },
    { id: "equipment", kind: "out", label: "Equipment and tools", line: "13" },
    { id: "insurance", kind: "out", label: "Insurance (not health)", line: "15" },
    { id: "interest", kind: "out", label: "Interest on business debt", line: "16b" },
    { id: "professional", kind: "out", label: "Legal and professional", line: "17" },
    { id: "office", kind: "out", label: "Office expense", line: "18" },
    { id: "rent-equipment", kind: "out", label: "Rent: vehicles and equipment", line: "20a" },
    { id: "rent", kind: "out", label: "Rent: shop or office", line: "20b" },
    { id: "repairs", kind: "out", label: "Repairs and maintenance", line: "21" },
    { id: "taxes", kind: "out", label: "Taxes and licenses", line: "23" },
    { id: "travel", kind: "out", label: "Travel", line: "24a" },
    { id: "meals", kind: "out", label: "Business meals (half counts)", line: "24b", share: 0.5 },
    { id: "utilities", kind: "out", label: "Utilities and phone", line: "25" },
    { id: "wages", kind: "out", label: "Wages", line: "26" },
    { id: "software", kind: "out", label: "Software and subscriptions", line: "27a" },
    { id: "other-out", kind: "out", label: "Other expenses", line: "27a" },
    { id: "est-tax", kind: "out", label: "Estimated tax payment", line: null },
    { id: "owner-out", kind: "out", label: "Owner draw or personal (not an expense)", line: null }
  ];
  var BY_ID = {};
  CATEGORIES.forEach(function (c) { BY_ID[c.id] = c; });

  var LINES = {
    "1": "Gross receipts or sales", "4": "Cost of goods sold", "6": "Other income", "7": "Gross income",
    "8": "Advertising", "9": "Car and truck expenses", "10": "Commissions and fees", "11": "Contract labor",
    "13": "Depreciation and section 179", "15": "Insurance (other than health)", "16b": "Interest (other)",
    "17": "Legal and professional services", "18": "Office expense", "20a": "Rent or lease: vehicles, machinery, equipment",
    "20b": "Rent or lease: other business property", "21": "Repairs and maintenance", "22": "Supplies",
    "23": "Taxes and licenses", "24a": "Travel", "24b": "Deductible meals", "25": "Utilities", "26": "Wages",
    "27a": "Other expenses", "28": "Total expenses", "31": "Net profit or (loss)"
  };
  var EXPENSE_LINES = ["8", "9", "10", "11", "13", "15", "16b", "17", "18", "20a", "20b", "21", "22", "23", "24a", "24b", "25", "26", "27a"];

  // IRS business standard mileage rates, in cents per mile, by the date they took effect.
  // 2026 had a midyear change (72.5 cents to July 1, then 76). Source: irs.gov "Standard mileage rates".
  var MILEAGE_RATES = [["2024-01-01", 67], ["2025-01-01", 70], ["2026-01-01", 72.5], ["2026-07-01", 76]];

  function num(v) { var n = parseFloat(v); return isFinite(n) ? n : 0; }
  function cents(v) { return Math.max(0, parseInt(v, 10) || 0); }
  function category(id) { return BY_ID[id] || BY_ID[id === "in" ? "other-in" : "other-out"]; }
  function inRange(date, from, to) { return !!date && date >= from && date <= to; }

  // A positive override (cents per mile) wins; otherwise the IRS rate in force that day.
  function mileageRate(date, override) {
    if (num(override) > 0) return num(override);
    var rate = MILEAGE_RATES[0][1];
    MILEAGE_RATES.forEach(function (r) { if (date >= r[0]) rate = r[1]; });
    return rate;
  }
  // True when we know the IRS rate for that year (so the page can say "check irs.gov" otherwise).
  function rateKnown(year) { return String(year) <= MILEAGE_RATES[MILEAGE_RATES.length - 1][0].slice(0, 4); }

  function tripMiles(t) { return Math.round(Math.max(0, num(t.miles)) * (t.roundTrip ? 2 : 1) * 10) / 10; }
  function tripDeduction(t, override) { return Math.round(tripMiles(t) * mileageRate(t.date, override)); }

  function iso(d) { return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
  // A due date on a weekend moves to the Monday (holidays can push it a day further; the page says so).
  function businessDay(y, m, d) {
    var dt = new Date(y, m - 1, d, 12);
    while (dt.getDay() === 0 || dt.getDay() === 6) dt.setDate(dt.getDate() + 1);
    return iso(dt);
  }

  // The four estimated-tax periods for a year. They are not calendar quarters: the IRS
  // splits the year Jan-Mar, Apr-May, Jun-Aug and Sep-Dec.
  function quarters(year) {
    var y = parseInt(year, 10);
    return [
      { n: 1, key: y + "-Q1", label: "Jan to Mar", from: y + "-01-01", to: y + "-03-31", due: businessDay(y, 4, 15) },
      { n: 2, key: y + "-Q2", label: "Apr to May", from: y + "-04-01", to: y + "-05-31", due: businessDay(y, 6, 15) },
      { n: 3, key: y + "-Q3", label: "Jun to Aug", from: y + "-06-01", to: y + "-08-31", due: businessDay(y, 9, 15) },
      { n: 4, key: y + "-Q4", label: "Sep to Dec", from: y + "-09-01", to: y + "-12-31", due: businessDay(y + 1, 1, 15) }
    ];
  }

  // Which period an estimated-tax payment counts toward: the one it names, or else the
  // earliest period whose due date it was paid by (a January payment covers last Sep-Dec).
  function paymentQuarter(entry) {
    if (entry.quarter && /^\d{4}-Q[1-4]$/.test(entry.quarter)) return entry.quarter;
    var y = parseInt(String(entry.date).slice(0, 4), 10);
    var qs = quarters(y - 1).concat(quarters(y));
    for (var i = 0; i < qs.length; i++) if (entry.date <= qs[i].due) return qs[i].key;
    return y + "-Q4";
  }

  // Totals for a date range (inclusive ISO dates). opts: { rate: cents per mile override }.
  function totals(entries, trips, from, to, opts) {
    opts = opts || {};
    var r = { income: 0, sales: 0, otherIncome: 0, ownerIn: 0, cogs: 0, expenses: 0, spent: 0, draws: 0, taxPaid: 0,
      miles: 0, mileage: 0, vehicle: 0, byCategory: {}, lines: {} };
    (entries || []).forEach(function (e) {
      if (!inRange(e.date, from, to)) return;
      var amt = cents(e.amount), c = category(e.category || e.kind);
      if (c.kind !== (e.kind || c.kind)) c = category(e.kind);
      r.byCategory[c.id] = (r.byCategory[c.id] || 0) + amt;
      if (c.id === "owner-in") { r.ownerIn += amt; return; }
      if (c.id === "owner-out") { r.draws += amt; return; }
      if (c.id === "est-tax") { r.taxPaid += amt; return; }
      if (c.kind === "in") {
        r.income += amt;
        if (c.line === "1") r.sales += amt; else r.otherIncome += amt;
        return;
      }
      r.spent += amt;
      var ded = Math.round(amt * (c.share == null ? 1 : c.share));
      r.lines[c.line] = (r.lines[c.line] || 0) + ded;
      if (c.line === "4") r.cogs += ded; else r.expenses += ded;
      if (c.id === "vehicle") r.vehicle += amt;
    });
    (trips || []).forEach(function (t) {
      if (!inRange(t.date, from, to)) return;
      r.miles += tripMiles(t);
      r.mileage += tripDeduction(t, opts.rate);
    });
    r.miles = Math.round(r.miles * 10) / 10;
    r.lines["9"] = (r.lines["9"] || 0) + r.mileage;
    r.expenses += r.mileage;
    r.profit = r.income - r.cogs - r.expenses;
    return r;
  }

  // Schedule C summary rows for a year, in form order.
  function scheduleC(entries, trips, year, opts) {
    var t = totals(entries, trips, year + "-01-01", year + "-12-31", opts);
    var rows = [
      { line: "1", label: LINES["1"], amount: t.sales },
      { line: "4", label: LINES["4"], amount: t.cogs },
      { line: "6", label: LINES["6"], amount: t.otherIncome },
      { line: "7", label: LINES["7"], amount: t.income - t.cogs, total: true }
    ];
    EXPENSE_LINES.forEach(function (l) { if (t.lines[l]) rows.push({ line: l, label: LINES[l], amount: t.lines[l] }); });
    rows.push({ line: "28", label: LINES["28"], amount: t.expenses, total: true });
    rows.push({ line: "31", label: LINES["31"], amount: t.profit, total: true, grand: true });
    return { rows: rows, totals: t };
  }

  // Each estimated-tax period with its profit, a suggested set-aside and what's been paid.
  // rate is the owner's set-aside percent (e.g. 25).
  function taxPlan(entries, trips, year, rate, today, opts) {
    var pct = Math.min(Math.max(num(rate), 0), 100);
    var paid = {};
    (entries || []).forEach(function (e) {
      if (e.category !== "est-tax") return;
      var k = paymentQuarter(e);
      paid[k] = (paid[k] || 0) + cents(e.amount);
    });
    return quarters(year).map(function (q) {
      var t = totals(entries, trips, q.from, q.to, opts);
      var setAside = Math.round(Math.max(0, t.profit) * pct / 100);
      var state = today < q.from ? "ahead" : today <= q.to ? "now" : today <= q.due ? "due" : "past";
      return Object.assign({}, q, { profit: t.profit, setAside: setAside, paid: paid[q.key] || 0, state: state });
    });
  }

  // Twelve months of cash in and cash out (real money only: no mileage, no owner money).
  function monthly(entries, year) {
    var months = [];
    for (var m = 0; m < 12; m++) months.push({ month: m, in: 0, out: 0 });
    (entries || []).forEach(function (e) {
      if (!e.date || e.date.slice(0, 4) !== String(year)) return;
      var c = category(e.category || e.kind);
      if (c.line === null) return;
      var i = parseInt(e.date.slice(5, 7), 10) - 1;
      if (i < 0 || i > 11) return;
      months[i][c.kind] += cents(e.amount);
    });
    return months;
  }

  function csvCell(v) {
    var s = String(v == null ? "" : v);
    if (typeof v !== "number" && /^[=+\-@\t\r]/.test(s)) s = "'" + s; // keep spreadsheets from treating text as a formula
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function csv(rows) { return rows.map(function (r) { return r.map(csvCell).join(","); }).join("\r\n") + "\r\n"; }

  return {
    CATEGORIES: CATEGORIES, LINES: LINES, MILEAGE_RATES: MILEAGE_RATES,
    category: category, mileageRate: mileageRate, rateKnown: rateKnown, tripMiles: tripMiles, tripDeduction: tripDeduction,
    quarters: quarters, paymentQuarter: paymentQuarter, totals: totals, scheduleC: scheduleC, taxPlan: taxPlan,
    monthly: monthly, csv: csv, csvCell: csvCell
  };
});
