/* Stock Book logic. Pure functions: quantities are plain numbers (kept to three decimals,
   so "2.5 lb" works), money is whole cents. Loaded by the page (window.FMStock) and by the
   tests (module.exports).

   How the level is worked out: every change is an event with a date. Received, made,
   sold, used and wasted events add or take away; a count sets the level to what was on
   the shelf. Events are replayed in date order (and, within a day, in the order they were
   recorded), so the level on any date can be rebuilt, and a count always wins over
   whatever came before it. Sales on invoices are read from the invoices themselves, never
   copied, so voiding or deleting an invoice puts the stock back by itself. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.FMStock = factory();
})(this, function () {
  "use strict";

  var KINDS = {
    "in": { label: "Received", sign: 1 },
    made: { label: "Made", sign: 1 },
    sold: { label: "Sold", sign: -1 },
    used: { label: "Used", sign: -1 },
    waste: { label: "Spoiled or damaged", sign: -1 },
    count: { label: "Counted", sign: 0 }
  };
  // Invoice states that mean the goods have gone to the customer. Drafts, quotes and void
  // invoices never touch stock.
  var SOLD_STATUS = { sent: 1, paid: 1, overdue: 1 };

  function r3(n) { return Math.round((+n || 0) * 1000) / 1000; }
  function norm(s) { return String(s == null ? "" : s).trim().replace(/\s+/g, " ").toLowerCase(); }

  // Reads what people type: "12", "2.5", "2,5", "1 1/2", "-3". Returns null if unreadable.
  function parseQty(text) {
    var s = String(text == null ? "" : text).trim().replace(",", ".");
    if (!s) return null;
    var m = s.match(/^(-?)(\d+)\s+(\d+)\/(\d+)$/);
    if (m && +m[4]) return r3((m[1] ? -1 : 1) * (+m[2] + m[3] / m[4]));
    m = s.match(/^(-?)(\d+)\/(\d+)$/);
    if (m && +m[3]) return r3((m[1] ? -1 : 1) * (m[2] / m[3]));
    if (!/^-?(\d+\.?\d*|\.\d+)$/.test(s)) return null;
    return r3(parseFloat(s));
  }
  function fmtQty(n) {
    n = r3(n);
    return String(n).replace(/^-/, "−");
  }

  // Turns sent and paid invoices into "sold" events for the stock they name. A line counts
  // when its description matches a stocked thing's name, or the name of the saved item it
  // is linked to (that is how invoice lines are filled in from saved items).
  function salesFromDocs(docs, stock, items) {
    var byName = {}, itemName = {};
    (items || []).forEach(function (it) { if (it && it.id) itemName[it.id] = it.name; });
    (stock || []).forEach(function (s) {
      if (s.archived) return;
      if (s.name) byName[norm(s.name)] = byName[norm(s.name)] || s.id;
      if (s.itemId && itemName[s.itemId]) byName[norm(itemName[s.itemId])] = byName[norm(itemName[s.itemId])] || s.id;
    });
    var out = [];
    (docs || []).forEach(function (d) {
      if (!d || d.type !== "invoice" || !SOLD_STATUS[d.status]) return;
      var per = {};
      (d.lines || []).forEach(function (l) {
        var id = byName[norm(l.description)], q = parseFloat(l.qty);
        if (!id || !isFinite(q) || !q) return;
        per[id] = r3((per[id] || 0) + q);
      });
      Object.keys(per).forEach(function (id) {
        out.push({ id: "inv:" + d.id + ":" + id, stockId: id, kind: "sold", qty: -per[id], date: d.issueDate || String(d.createdAt || "").slice(0, 10),
          createdAt: d.createdAt || "", docId: d.id, docNumber: d.number || "", customer: (d.customer && (d.customer.name || d.customer.company)) || "", fromInvoice: true });
      });
    });
    return out;
  }

  function order(a, b) {
    return String(a.date).localeCompare(String(b.date)) || String(a.createdAt || "").localeCompare(String(b.createdAt || "")) || String(a.id).localeCompare(String(b.id));
  }

  // Replays one thing's events up to and including asOf (an ISO date; empty means all).
  // Returns {onHand, cost (the last received unit cost, or 0), history (oldest first, each
  // with before/after/change), counted (date of the last count)}.
  function replay(events, asOf) {
    var list = (events || []).filter(function (e) { return e && (!asOf || String(e.date) <= asOf); }).slice().sort(order);
    var level = 0, cost = 0, counted = "", history = [];
    list.forEach(function (e) {
      var before = level;
      if (e.kind === "count") { level = r3(e.counted); counted = e.date; }
      else level = r3(level + (+e.qty || 0));
      if (e.kind === "in" && e.unitCost > 0) cost = e.unitCost;
      history.push(Object.assign({}, e, { before: before, after: level, change: r3(level - before) }));
    });
    return { onHand: level, cost: cost, history: history, counted: counted };
  }

  // Splits every event by the stocked thing it belongs to.
  function group(moves, sales) {
    var by = {};
    (moves || []).concat(sales || []).forEach(function (e) { if (e && e.stockId) (by[e.stockId] = by[e.stockId] || []).push(e); });
    return by;
  }

  // The level and value of every stocked thing on a date (empty = now).
  // Unit cost on a past date is the last delivery's cost by then, else the record's cost.
  function levels(stock, moves, sales, asOf) {
    var by = group(moves, sales), out = {};
    (stock || []).forEach(function (s) {
      var r = replay(by[s.id] || [], asOf);
      var unit = asOf ? (r.cost || s.unitCost || 0) : (s.unitCost || r.cost || 0);
      r.unitCost = unit;
      r.value = Math.max(0, Math.round(Math.max(0, r.onHand) * unit));
      r.low = isLow(s, r.onHand);
      out[s.id] = r;
    });
    return out;
  }

  function hasLevel(v) { return v !== null && v !== undefined && v !== "" && isFinite(+v); }
  // Low means at or under the reorder level the owner set; with no level set, never "low"
  // (running out still shows, through isOut).
  function isLow(s, onHand) { return hasLevel(s.reorderAt) && onHand <= +s.reorderAt; }
  function isOut(onHand) { return r3(onHand) <= 0; }

  // How fast it goes: everything sold, used or spoiled in the last `days` days, per day.
  function dailyUse(history, today, days) {
    days = days || 60;
    var from = addDays(today, -days + 1), gone = 0, first = "";
    (history || []).forEach(function (e) {
      if (!first || e.date < first) first = e.date;
      if (e.kind === "count" || !(e.qty < 0)) return;
      if (e.date >= from && e.date <= today) gone += -e.qty;
    });
    if (!gone) return 0;
    // Don't spread a week's sales over sixty days just because the book is new.
    var span = first && first > from ? Math.max(7, daysBetween(first, today) + 1) : days;
    return gone / span;
  }
  // Rough weeks left at the current pace, or null when there's no pace yet.
  function weeksLeft(onHand, perDay) {
    if (!(perDay > 0)) return null;
    return Math.max(0, onHand) / perDay / 7;
  }

  // What to order: things at or under their reorder level, grouped by supplier. The amount
  // is the usual order size if one is set, else enough to get back to twice the reorder level.
  function reorderList(stock, lv) {
    var bySup = {}, groups = [];
    (stock || []).forEach(function (s) {
      if (s.archived || !hasLevel(s.reorderAt)) return;
      var r = lv[s.id] || { onHand: 0, unitCost: s.unitCost || 0 };
      if (r.onHand > +s.reorderAt) return;
      var qty = +s.reorderQty > 0 ? r3(+s.reorderQty) : Math.max(1, Math.ceil(+s.reorderAt * 2 - r.onHand));
      var key = norm(s.supplier) || "";
      if (!bySup[key]) { bySup[key] = { supplier: (s.supplier || "").trim(), lines: [], cost: 0 }; groups.push(bySup[key]); }
      var unit = r.unitCost || s.unitCost || 0;
      bySup[key].lines.push({ id: s.id, name: s.name, sku: s.sku || "", unit: s.unit || "", onHand: r.onHand, reorderAt: +s.reorderAt, qty: qty, unitCost: unit, cost: Math.round(qty * unit) });
      bySup[key].cost += Math.round(qty * unit);
    });
    groups.forEach(function (g) { g.lines.sort(function (a, b) { return a.name.localeCompare(b.name); }); });
    // Named suppliers first, alphabetically; "no supplier yet" last.
    groups.sort(function (a, b) { return (!a.supplier) - (!b.supplier) || a.supplier.localeCompare(b.supplier); });
    return groups;
  }

  // A plain-text order to paste into an email or text message.
  function orderText(g, business) {
    var lines = g.lines.map(function (l) {
      return "- " + fmtQty(l.qty) + (l.unit ? " " + l.unit : "") + " " + l.name + (l.sku ? " (" + l.sku + ")" : "");
    });
    return (g.supplier ? "Hello " + g.supplier + ",\n\n" : "") +
      "Please send:\n" + lines.join("\n") + "\n\nThank you" + (business ? ",\n" + business : "!") + "\n";
  }

  function totalValue(stock, lv) {
    return (stock || []).reduce(function (a, s) { return a + (lv[s.id] ? lv[s.id].value : 0); }, 0);
  }

  function pad(n) { return String(n).padStart(2, "0"); }
  function localDate(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function addDays(iso, n) { var d = new Date(iso + "T12:00:00"); d.setDate(d.getDate() + (parseInt(n, 10) || 0)); return localDate(d); }
  function daysBetween(a, b) { return Math.round((Date.parse(b + "T12:00:00") - Date.parse(a + "T12:00:00")) / 86400000); }
  function validDate(s) { return /^\d{4}-\d{2}-\d{2}$/.test(String(s || "")) && !isNaN(Date.parse(s + "T12:00:00")); }

  function csvCell(v) {
    var s = String(v == null ? "" : v);
    // A leading = + - @ would run as a formula in a spreadsheet; a quote mark stops that.
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  // Rows: [{name, kind, sku, unit, onHand, unitCost, value, supplier, location}]
  function csv(rows, asOf) {
    var out = [["Name", "Kind", "SKU", "Unit", "On hand" + (asOf ? " " + asOf : ""), "Unit cost", "Value", "Supplier", "Location"].map(csvCell).join(",")];
    rows.forEach(function (r) {
      out.push([r.name, r.kind === "supply" ? "Supply" : "For sale", r.sku || "", r.unit || "", String(r3(r.onHand)), ((r.unitCost || 0) / 100).toFixed(2),
        ((r.value || 0) / 100).toFixed(2), r.supplier || "", r.location || ""].map(csvCell).join(","));
    });
    return out.join("\r\n") + "\r\n";
  }

  return {
    KINDS: KINDS, SOLD_STATUS: SOLD_STATUS,
    r3: r3, norm: norm, parseQty: parseQty, fmtQty: fmtQty,
    salesFromDocs: salesFromDocs, replay: replay, group: group, levels: levels,
    hasLevel: hasLevel, isLow: isLow, isOut: isOut, dailyUse: dailyUse, weeksLeft: weeksLeft,
    reorderList: reorderList, orderText: orderText, totalValue: totalValue,
    localDate: localDate, addDays: addDays, daysBetween: daysBetween, validDate: validDate, csv: csv
  };
});
