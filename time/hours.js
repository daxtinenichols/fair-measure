/* Time Book arithmetic. Pure functions: durations in whole minutes, money in whole cents.
   Loaded by the page (window.FMTime) and by the tests (module.exports). */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.FMTime = factory();
})(this, function () {
  "use strict";

  function pad(n) { return String(n).padStart(2, "0"); }
  function validDate(s) { return /^\d{4}-\d{2}-\d{2}$/.test(String(s || "")) && !isNaN(Date.parse(s + "T12:00:00")); }
  function validClock(s) { return /^([01]\d|2[0-3]):[0-5]\d$/.test(String(s || "")); }
  function localDate(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function localClock(d) { return pad(d.getHours()) + ":" + pad(d.getMinutes()); }
  function addDays(iso, days) {
    var d = new Date(iso + "T12:00:00");
    d.setDate(d.getDate() + (parseInt(days, 10) || 0));
    return localDate(d);
  }
  function weekStartOf(iso, startDay) {
    var d = new Date(iso + "T12:00:00");
    var back = (d.getDay() - (startDay || 0) + 7) % 7;
    return addDays(iso, -back);
  }
  function weekDates(start) { var a = []; for (var i = 0; i < 7; i++) a.push(addDays(start, i)); return a; }

  // Reads what people actually type: "1:30", "1.5", "90", "90m", "1h 30m", "2 hrs".
  // A bare number up to 12 is hours, anything bigger is minutes. Returns null if unreadable.
  function parseDuration(text) {
    var s = String(text == null ? "" : text).trim().toLowerCase().replace(",", ".");
    if (!s) return null;
    var m = s.match(/^(\d+):([0-5]?\d)$/);
    if (m) return +m[1] * 60 + +m[2];
    m = s.match(/^(?:(\d+(?:\.\d+)?)\s*h(?:ours?|rs?|r)?)?\s*(?:(\d+)\s*m(?:in(?:ute)?s?)?)?$/);
    if (m && (m[1] || m[2])) return Math.round((m[1] ? parseFloat(m[1]) * 60 : 0) + (m[2] ? +m[2] : 0));
    m = s.match(/^\d+(?:\.\d+)?$/);
    if (m) { var n = parseFloat(s); return Math.round(n <= 12 ? n * 60 : n); }
    return null;
  }

  // Minutes from start to end clock time; an end before the start runs past midnight.
  function minutesBetween(start, end) {
    if (!validClock(start) || !validClock(end)) return 0;
    var a = +start.slice(0, 2) * 60 + +start.slice(3), b = +end.slice(0, 2) * 60 + +end.slice(3);
    return b >= a ? b - a : b + 1440 - a;
  }

  function fmtDuration(min) {
    min = Math.max(0, Math.round(min || 0));
    var h = Math.floor(min / 60), m = min % 60;
    if (!h) return m + "m";
    return m ? h + "h " + m + "m" : h + "h";
  }
  function fmtClock(ms) {
    var s = Math.max(0, Math.floor(ms / 1000));
    return Math.floor(s / 3600) + ":" + pad(Math.floor(s / 60) % 60) + ":" + pad(s % 60);
  }

  // Rounds to the NEAREST step (never always-up), so rounding is fair both ways.
  function roundMinutes(min, step) {
    step = parseInt(step, 10) || 0;
    if (step <= 1) return Math.round(min || 0);
    return Math.round((min || 0) / step) * step;
  }

  // Hours as they appear on an invoice line (two decimals), and the value of that line.
  // Every screen uses these two, so the Time Book and the invoice always agree to the cent.
  function hoursQty(min) { return Math.round((min || 0) / 60 * 100) / 100; }
  function amount(min, rate) { return Math.round(hoursQty(min) * (parseInt(rate, 10) || 0)); }

  // Totals for a list of entries. billedIds is the set of invoice ids that still exist;
  // an entry whose invoice was deleted counts as unbilled again.
  function isBilled(e, docIds) { return !!(e.invoiceId && (!docIds || docIds[e.invoiceId])); }
  function summarize(entries, docIds) {
    var t = { minutes: 0, billable: 0, unbilled: 0, unbilledValue: 0, billed: 0 };
    (entries || []).forEach(function (e) {
      var m = e.minutes || 0;
      t.minutes += m;
      if (!e.billable) return;
      t.billable += m;
      if (isBilled(e, docIds)) t.billed += m;
      else { t.unbilled += m; t.unbilledValue += amount(m, e.rate); }
    });
    return t;
  }

  function dateRange(dates) {
    var s = dates.slice().sort();
    return { from: s[0] || "", to: s[s.length - 1] || "" };
  }

  // Turns unbilled entries into invoice lines. "job" groups entries by job and rate, with
  // rounding applied to each line's total; "entry" makes one line per entry (each rounded).
  // fmtDate turns an ISO date into words for the description.
  function invoiceLines(entries, opts) {
    opts = opts || {};
    var step = opts.rounding || 0, fd = opts.fmtDate || function (d) { return d; };
    var sorted = (entries || []).slice().sort(function (a, b) { return (a.date + (a.start || "")).localeCompare(b.date + (b.start || "")); });
    var lines = [];
    if (opts.group === "entry") {
      sorted.forEach(function (e) {
        var min = roundMinutes(e.minutes, step);
        if (min <= 0) return;
        var what = [e.job, e.note].filter(Boolean).join(": ") || "Work";
        lines.push({ description: fd(e.date) + ", " + what + " (" + fmtDuration(min) + ")", unit: "hr", qty: hoursQty(min), price: e.rate || 0, taxable: false, minutes: min, ids: [e.id] });
      });
      return lines;
    }
    var groups = [], byKey = {};
    sorted.forEach(function (e) {
      var key = (e.job || "").trim().toLowerCase() + "|" + (e.rate || 0);
      if (!byKey[key]) { byKey[key] = { job: (e.job || "").trim(), rate: e.rate || 0, minutes: 0, dates: [], ids: [] }; groups.push(byKey[key]); }
      var g = byKey[key];
      g.minutes += e.minutes || 0; g.dates.push(e.date); g.ids.push(e.id);
    });
    groups.forEach(function (g) {
      var min = roundMinutes(g.minutes, step);
      if (min <= 0) return;
      var r = dateRange(g.dates);
      var when = r.from === r.to ? fd(r.from) : fd(r.from) + " to " + fd(r.to);
      lines.push({ description: (g.job || "Work") + " (" + fmtDuration(min) + ", " + when + ")", unit: "hr", qty: hoursQty(min), price: g.rate, taxable: false, minutes: min, ids: g.ids });
    });
    return lines;
  }

  function csvCell(v) {
    var s = String(v == null ? "" : v);
    // A leading = + - @ would run as a formula in a spreadsheet; a quote mark stops that.
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  // Rows: [{date, start, end, minutes, customer, job, note, who, billable, rate, billedAs}]
  function csv(rows) {
    var head = ["Date", "Start", "End", "Hours", "Customer", "Job", "Note", "Who", "Billable", "Rate", "Amount", "Invoice"];
    var out = [head.join(",")];
    rows.forEach(function (r) {
      out.push([r.date, r.start || "", r.end || "", hoursQty(r.minutes).toFixed(2), r.customer || "", r.job || "", r.note || "", r.who || "",
        r.billable ? "yes" : "no", ((r.rate || 0) / 100).toFixed(2), r.billable ? (amount(r.minutes, r.rate) / 100).toFixed(2) : "0.00", r.billedAs || ""].map(csvCell).join(","));
    });
    return out.join("\r\n") + "\r\n";
  }

  return {
    validDate: validDate, validClock: validClock, localDate: localDate, localClock: localClock,
    addDays: addDays, weekStartOf: weekStartOf, weekDates: weekDates,
    parseDuration: parseDuration, minutesBetween: minutesBetween, fmtDuration: fmtDuration, fmtClock: fmtClock,
    roundMinutes: roundMinutes, hoursQty: hoursQty, amount: amount, isBilled: isBilled, summarize: summarize,
    invoiceLines: invoiceLines, csv: csv
  };
});
