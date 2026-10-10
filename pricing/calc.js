/* Price Builder arithmetic. Pure functions. Money is in cents; per-unit figures are kept
   unrounded until the final price, so a batch of 24 cookies doesn't lose a cent per cookie.
   Loaded by the page (window.FMPrice) and by the tests (module.exports). */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.FMPrice = factory();
})(this, function () {
  "use strict";

  function num(v) { var n = parseFloat(v); return isFinite(n) ? n : 0; }
  function pos(v) { return Math.max(0, num(v)); }
  function cents(v) { return Math.max(0, parseInt(v, 10) || 0); }

  // Rounds a price up to the next step (in cents). Never rounds down, so the
  // rounded price always keeps at least the margin asked for.
  function roundUp(c, step) {
    step = parseInt(step, 10) || 1;
    if (step <= 1) return Math.ceil(c - 1e-9);
    return Math.ceil(c / step - 1e-9) * step;
  }

  // The full costing. `c` is a saved costing record:
  //   materials: [{ qty, cost }]  cost in cents per unit of material
  //   labor:     [{ hours, rate }] rate in cents per hour
  //   wastePercent, overheadRate (cents per labor hour), extraCost (cents per batch),
  //   yield (units the batch makes), feePercent, feeFixed (cents per sale),
  //   margin (target profit, % of price), roundTo (cents), price (cents, what you
  //   actually charge; 0 means use the suggestion), wholesale { on, margin, storeMarkup }.
  function compute(c) {
    var materials = (c.materials || []).reduce(function (s, m) { return s + pos(m.qty) * cents(m.cost); }, 0);
    materials *= 1 + Math.min(pos(c.wastePercent), 100) / 100;
    var labor = 0, hours = 0;
    (c.labor || []).forEach(function (l) { var h = pos(l.hours); hours += h; labor += h * cents(l.rate); });
    var overhead = hours * cents(c.overheadRate);
    var extra = cents(c.extraCost);
    var yieldN = Math.max(1, num(c.yield) || 1);
    var batch = materials + labor + overhead + extra;
    var unit = {
      materials: materials / yieldN, labor: labor / yieldN, overhead: (overhead + extra) / yieldN,
      cost: batch / yieldN, hours: hours / yieldN
    };

    var fee = Math.min(pos(c.feePercent), 90) / 100;
    var fixed = cents(c.feeFixed);
    var margin = Math.min(pos(c.margin), 90) / 100;
    var out = { batch: { materials: materials, labor: labor, overhead: overhead + extra, cost: batch, hours: hours }, unit: unit, yield: yieldN };

    // Price p must cover cost, the store's cut and the profit we want:
    // p = cost + fixed + p*fee + p*margin  =>  p = (cost + fixed) / (1 - fee - margin)
    var room = 1 - fee - margin;
    out.impossible = room < 0.05;
    out.breakEven = unit.cost > 0 || fixed > 0 ? roundUp((unit.cost + fixed) / (1 - fee), 1) : 0;
    out.suggested = out.impossible || (unit.cost <= 0 && fixed <= 0) ? 0 : roundUp((unit.cost + fixed) / room, c.roundTo);

    var price = cents(c.price) || out.suggested;
    out.price = price;
    out.usingSuggested = !cents(c.price);
    var fees = price > 0 ? price * fee + fixed : 0;
    out.unit.fees = fees;
    out.profit = price - unit.cost - fees;
    out.margin = price > 0 ? out.profit / price * 100 : 0;
    out.markup = unit.cost > 0 ? (price - unit.cost) / unit.cost * 100 : 0;
    // What each hour of work really earns once the price is set: the wage you
    // costed in, plus the profit (or minus the loss).
    out.perHour = unit.hours > 0 ? (unit.labor + out.profit) / unit.hours : null;

    var w = c.wholesale || {};
    if (w.on) {
      var wm = Math.min(pos(w.margin), 90) / 100;
      var wholesale = unit.cost > 0 ? roundUp(unit.cost / (1 - wm), c.roundTo) : 0;
      var shelf = roundUp(wholesale * Math.max(1, num(w.storeMarkup) || 2), c.roundTo);
      out.wholesale = { price: wholesale, profit: wholesale - unit.cost, shelf: shelf, undercuts: price > 0 && price < shelf };
    }
    return out;
  }

  // Overhead per working hour from monthly running costs.
  function overheadRate(monthlyCosts, hoursPerMonth) {
    var h = pos(hoursPerMonth);
    return h > 0 ? Math.round(cents(monthlyCosts) / h) : 0;
  }

  return { compute: compute, roundUp: roundUp, overheadRate: overheadRate };
});
