/* Cash Book.
   Routes (in the address hash): overview "", "#money", "#miles", "#year".
   Manual entries live in the shared "cash" collection and trips in "trips". Payments
   recorded on invoices are read straight from "documents", so they show up here without
   being typed twice (and are edited on the invoice). */
(function () {
  "use strict";
  var FM = window.FM, S = FM.store, K = window.FMCash, M = FM.money, L = FM.license, esc = FM.esc;
  var app;
  var ui = { year: null, filter: "all", q: "", month: "" };

  var ICON = {
    plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
    minus: '<svg viewBox="0 0 24 24"><path d="M5 12h14"/></svg>',
    car: '<svg viewBox="0 0 24 24"><path d="M5 16V12l2-5h10l2 5v4M5 16h14M5 16v2M19 16v2"/><circle cx="8" cy="13.5" r=".6"/><circle cx="16" cy="13.5" r=".6"/></svg>',
    print: '<svg viewBox="0 0 24 24"><path d="M7 9V4h10v5M7 17H5a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-2"/><path d="M7 14h10v6H7z"/></svg>',
    download: '<svg viewBox="0 0 24 24"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg>',
    gear: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M5.6 18.4l1.8-1.8M16.6 7.4l1.8-1.8"/></svg>',
    search: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5"/></svg>',
    repeat: '<svg viewBox="0 0 24 24"><path d="M4 12a8 8 0 0 1 14-5.3L20 9M20 4v5h-5M20 12a8 8 0 0 1-14 5.3L4 15M4 20v-5h5"/></svg>',
    doc: '<svg viewBox="0 0 24 24"><path d="M7 3h7l4 4v14H7z"/><path d="M14 3v4h4M10 12h5M10 16h5"/></svg>',
    check: '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7"/></svg>'
  };
  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  // ---------- helpers
  function $(sel, root) { return (root || document).querySelector(sel); }
  function fmt(c) { var p = S.profile(); return M.format(c, p.currency, p.locale || undefined); }
  function today() { var d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); }
  function fmtDate(iso, opts) {
    if (!iso) return "";
    try { return new Date(iso + "T12:00:00").toLocaleDateString(undefined, opts || { year: "numeric", month: "short", day: "numeric" }); }
    catch (e) { return iso; }
  }
  function shortDate(iso) { return fmtDate(iso, { month: "short", day: "numeric" }); }
  function miles(n) { return (Math.round(n * 10) / 10).toLocaleString(undefined, { maximumFractionDigits: 1 }); }
  function settings() { return Object.assign({ setAside: 25, rate: "" }, S.profile().cash || {}); }
  function rateOpts() { var s = settings(); return { rate: parseFloat(s.rate) > 0 ? parseFloat(s.rate) : 0 }; }
  function field(label, control, cls) { return '<label class="field' + (cls ? " " + cls : "") + '"><span>' + label + "</span>" + control + "</label>"; }
  function go(hash) { if (location.hash === hash || (hash === "#" && !location.hash)) route(); else location.hash = hash; }

  // Invoice payments, shaped like cash entries and marked read-only.
  function invoiceEntries() {
    var out = [];
    S.all("documents").forEach(function (d) {
      if (d.type !== "invoice" || d.status === "void") return;
      (d.payments || []).forEach(function (p, i) {
        out.push({
          id: "inv-" + d.id + "-" + i, kind: "in", category: "sales", date: p.date, amount: p.amount,
          party: (d.customer && (d.customer.name || d.customer.company)) || "", method: p.method || "",
          note: "Invoice " + (d.number || ""), docId: d.id, fromInvoice: true
        });
      });
    });
    return out;
  }
  function allEntries() { return S.all("cash").concat(invoiceEntries()); }
  function byNewest(a, b) { return (b.date || "").localeCompare(a.date || "") || (b.createdAt || "").localeCompare(a.createdAt || ""); }

  function years() {
    var set = {}; set[today().slice(0, 4)] = 1;
    allEntries().concat(S.all("trips")).forEach(function (r) { if (r.date) set[r.date.slice(0, 4)] = 1; });
    return Object.keys(set).sort().reverse();
  }

  function limitDialog(col) {
    var names = { cash: "cash book entries", trips: "trips" };
    return FM.confirm({
      title: "You've reached the free limit",
      body: "The free version keeps up to " + L.limits[col] + " " + names[col] + ". Pro removes every limit for a one-time " + L.config.price +
        ". Payments from your invoices always come through and never count toward the limit.",
      ok: "See Pro", cancel: "Not now"
    }).then(function (yes) { if (yes) location.href = FM.link("settings/#pro"); return false; });
  }
  function canAdd(col) {
    return L.canAdd(col, S.count(col)).allowed ? Promise.resolve(true) : limitDialog(col);
  }
  function limitNote(col) {
    if (L.isPro() || L.limits[col] == null) return "";
    var used = S.count(col), lim = L.limits[col];
    if (used < lim - 5) return "";
    return '<p class="muted limit-note">' + used + " of " + lim + " free " + (col === "cash" ? "entries" : "trips") + ' used. <a href="' + FM.link("settings/#pro") + '">Pro</a> removes the limit.</p>';
  }

  // ---------- routing
  function route() {
    var h = location.hash.replace(/^#/, "");
    if (!ui.year) ui.year = today().slice(0, 4);
    window.scrollTo(0, 0);
    app.onclick = null; app.oninput = null; app.onchange = null;
    if (h === "money") return renderMoney();
    if (h === "miles") return renderMiles();
    if (h === "year") return renderYear();
    renderOverview();
  }

  function shell(active, inner) {
    var tabs = [["#", "Overview", "home"], ["#money", "Money", "money"], ["#miles", "Miles", "miles"], ["#year", "Year end", "year"]];
    var ys = years();
    return '<div class="wrap app-head no-print">' +
      '<div class="app-title"><h1>Cash Book</h1>' + (L.isPro() ? '<span class="fm-pro-chip">Pro</span>' : "") +
      '<label class="year-pick"><span class="sr">Year</span><select id="year">' + ys.map(function (y) {
        return "<option" + (y === ui.year ? " selected" : "") + ">" + y + "</option>";
      }).join("") + "</select></label></div>" +
      '<nav class="seg" aria-label="Sections">' + tabs.map(function (t) {
        return '<a href="' + t[0] + '"' + (t[2] === active ? ' aria-current="page"' : "") + ">" + t[1] + "</a>";
      }).join("") + "</nav></div>" + inner;
  }
  function bindShell() {
    var y = $("#year", app);
    if (y) y.addEventListener("change", function () { ui.year = y.value; ui.month = ""; route(); });
  }
  function actions(primary) {
    var b = [["add-in", ICON.plus, "Money in"], ["add-out", ICON.minus, "Money out"], ["add-trip", ICON.car, "Log a trip"]];
    if (primary === "add-trip") b.unshift(b.pop());
    return '<div class="quick no-print">' + b.map(function (x, i) {
      return '<button class="btn' + (i ? " ghost" : "") + '" data-act="' + x[0] + '">' + x[1] + x[2] + "</button>";
    }).join("") + "</div>";
  }
  function commonClick(e) {
    var b = e.target.closest("[data-act]"); if (!b) return false;
    var act = b.getAttribute("data-act");
    if (act === "add-in") newEntry("in");
    else if (act === "add-out") newEntry("out");
    else if (act === "add-trip") newTrip();
    else if (act === "settings") editSettings();
    else if (act === "edit") { var id = b.getAttribute("data-id"); var rec = S.get("cash", id); if (rec) editEntry(rec); }
    else if (act === "edit-trip") { var t = S.get("trips", b.getAttribute("data-id")); if (t) editTrip(t); }
    else if (act === "backup") { FM.backup.download(); FM.toast("Backup downloaded"); route(); }
    else return false;
    return true;
  }

  function entryRow(e) {
    var c = K.category(e.category || e.kind);
    var sign = e.kind === "in" ? "+" : "−";
    var title = e.party || c.label;
    var sub = (e.party ? c.label : (e.note || "")) + (e.fromInvoice ? " · " + esc(e.note) : "");
    var cls = "row" + (e.kind === "in" ? " is-in" : "") + (c.line === null ? " is-aside" : "");
    var amt = '<span class="row-amt">' + sign + fmt(e.amount) + "</span>";
    var body = '<span class="row-date">' + esc(shortDate(e.date)) + '</span><span class="row-who"><b>' + esc(title) + "</b><small>" +
      (e.fromInvoice ? ICON.doc : "") + (e.fromInvoice ? esc(c.label) + " · " + esc(e.note) : esc(sub)) + "</small></span>" + amt;
    return e.fromInvoice
      ? '<a class="' + cls + '" href="' + FM.link("invoices/#doc/" + encodeURIComponent(e.docId)) + '" title="Open the invoice to change this payment">' + body + "</a>"
      : '<button type="button" class="' + cls + '" data-act="edit" data-id="' + esc(e.id) + '">' + body + "</button>";
  }

  // ---------- overview
  function renderOverview() {
    var y = ui.year, now = today();
    var entries = allEntries(), trips = S.all("trips");
    var t = K.totals(entries, trips, y + "-01-01", y + "-12-31", rateOpts());
    var hasAny = entries.length || trips.length;

    if (!hasAny) {
      app.innerHTML = shell("home", '<div class="wrap"><div class="empty">' +
        '<svg viewBox="0 0 64 64" aria-hidden="true"><rect x="9" y="17" width="46" height="31" rx="5"/><circle cx="32" cy="32.5" r="7"/><path d="M17 25v15M47 25v15"/></svg>' +
        "<h2>A calm place for every dollar</h2>" +
        '<p class="muted">Write down money as it comes in and goes out, log the miles you drive for work, and Cash Book keeps a running profit and tells you what to set aside for quarterly taxes. Payments you record on invoices show up here on their own.</p>' +
        actions() + "</div></div>");
      bindShell();
      app.onclick = commonClick;
      return;
    }

    var s = settings();
    var plan = K.taxPlan(entries, trips, y, s.setAside, now, rateOpts());
    var next = plan.filter(function (q) { return q.state === "now" || q.state === "due"; })[0] || plan.filter(function (q) { return q.state === "ahead"; })[0];
    var ytdSet = plan.reduce(function (a, q) { return a + q.setAside; }, 0);
    var ytdPaid = plan.reduce(function (a, q) { return a + q.paid; }, 0);

    var lead = next
      ? "<p class=\"tax-lead\">Next estimated payment is due <b>" + esc(fmtDate(next.due)) + "</b> for " + esc(next.label) + ". " +
        (next.setAside ? "Set aside about <b>" + fmt(next.setAside) + "</b> so far." : "No profit in that stretch yet, so nothing to set aside.") + "</p>"
      : '<p class="tax-lead">All four payments for ' + esc(y) + " are behind you. Suggested set-aside for the year: <b>" + fmt(ytdSet) + "</b>, paid <b>" + fmt(ytdPaid) + "</b>.</p>";

    var quarters = plan.map(function (q) {
      var paidUp = q.setAside > 0 && q.paid >= q.setAside;
      var quiet = !q.profit && !q.paid && (q.state === "past" || q.state === "ahead");
      var pill = paidUp ? '<span class="pill green">' + ICON.check + "Paid</span>"
        : q.state === "now" ? '<span class="pill blue">This period</span>'
        : q.state === "due" ? '<span class="pill gold">Due ' + esc(shortDate(q.due)) + "</span>"
        : q.state === "past" ? (q.setAside ? '<span class="pill rose">Past due</span>' : '<span class="pill">Done</span>')
        : '<span class="pill">Ahead</span>';
      return '<li class="q q-' + q.state + (next && next.key === q.key ? " is-next" : "") + '">' +
        '<div class="q-top"><b>' + esc(q.label) + "</b>" + pill + "</div>" +
        '<span class="q-due">Due ' + esc(fmtDate(q.due)) + "</span>" +
        (quiet ? '<p class="q-quiet">' + (q.state === "ahead" ? "Not started yet." : "No profit, nothing to set aside.") + "</p>"
          : '<dl><div><dt>Profit</dt><dd>' + fmt(q.profit) + "</dd></div><div><dt>Set aside</dt><dd>" + fmt(q.setAside) + "</dd></div>" +
            "<div><dt>Paid</dt><dd>" + fmt(q.paid) + "</dd></div></dl>") +
        (q.state !== "ahead" && !paidUp && (q.setAside > q.paid || q.state !== "past") ? '<button class="btn small ghost" data-act="pay-q" data-q="' + q.key + '">Record a payment</button>' : "") + "</li>";
    }).join("");

    var recent = entries.filter(function (e) { return e.date && e.date.slice(0, 4) === y; }).sort(byNewest).slice(0, 6).map(entryRow).join("");

    var backupNote = FM.backup.due()
      ? '<div class="notice blue backup-note no-print"><span>Your business book lives on this device. Download a backup now and then so nothing is lost.</span><button class="btn small ghost" data-act="backup">Download backup</button></div>'
      : "";

    app.innerHTML = shell("home", '<div class="wrap">' + backupNote + actions() +
      '<div class="tiles">' +
      '<div class="tile"><span>Money in</span><b>' + fmt(t.income) + "</b><small>" + esc(y) + " business income</small></div>" +
      '<div class="tile"><span>Money out</span><b>' + fmt(t.spent) + "</b><small>" + esc(y) + " business costs</small></div>" +
      '<div class="tile' + (t.profit < 0 ? " warn" : " good") + '"><span>Profit so far</span><b>' + fmt(t.profit) + "</b><small>" +
      (t.mileage ? "After " + miles(t.miles) + " miles (" + fmt(t.mileage) + ")" : "Money in less costs") + "</small></div></div>" +
      '<section class="card tax" aria-labelledby="tax-h"><div class="tax-head"><div><h2 id="tax-h">Set aside for taxes</h2>' + lead + "</div>" +
      '<button class="btn small ghost" data-act="settings">' + ICON.gear + s.setAside + "% of profit</button></div>" +
      '<ol class="quarters">' + quarters + "</ol>" +
      '<p class="muted fine">Self-employed people usually pay income and self-employment tax four times a year. Setting aside ' + s.setAside +
      "% of profit is a rule of thumb, not a tax calculation; due dates move to the next business day for weekends and holidays.</p></section>" +
      chart(entries, y) +
      '<section class="recent"><div class="sec-head"><h2>Recent</h2><a href="#money">See everything</a></div>' +
      (recent ? '<div class="rows">' + recent + "</div>" : '<p class="muted none">Nothing recorded in ' + esc(y) + " yet.</p>") + "</section></div>");
    bindShell();
    bindChart();
    app.onclick = function (e) {
      if (commonClick(e)) return;
      var b = e.target.closest('[data-act="pay-q"]');
      if (b) payQuarter(b.getAttribute("data-q"), plan);
    };
  }

  // Twelve months of money in and out as paired bars, with a hover/focus readout and a table.
  function chart(entries, y) {
    var m = K.monthly(entries, y);
    var max = 0;
    m.forEach(function (x) { max = Math.max(max, x.in, x.out); });
    if (!max) return "";
    var step = niceStep(max / 2);
    var top = step * Math.ceil(max / step);
    var cols = m.map(function (x, i) {
      var hIn = Math.round(x.in / top * 1000) / 10, hOut = Math.round(x.out / top * 1000) / 10;
      var label = MONTHS[i] + ": in " + fmt(x.in) + ", out " + fmt(x.out);
      return '<div class="col" tabindex="0" role="img" aria-label="' + esc(label) + '" data-m="' + i + '">' +
        '<div class="bars"><i class="b-in" style="height:' + hIn + '%"></i><i class="b-out" style="height:' + hOut + '%"></i></div>' +
        '<span class="mlabel"><span class="long">' + MONTHS[i] + '</span><span class="short">' + MONTHS[i].charAt(0) + "</span></span></div>";
    }).join("");
    var rows = m.map(function (x, i) { return "<tr><th scope=\"row\">" + MONTHS[i] + "</th><td>" + fmt(x.in) + "</td><td>" + fmt(x.out) + "</td><td>" + fmt(x.in - x.out) + "</td></tr>"; }).join("");
    return '<section class="card chart-card" aria-labelledby="chart-h"><div class="sec-head"><h2 id="chart-h">Month by month</h2>' +
      '<ul class="legend"><li><i class="b-in"></i>Money in</li><li><i class="b-out"></i>Money out</li></ul></div>' +
      '<div class="chart" data-months=\'' + esc(JSON.stringify(m)) + '\'>' +
      '<div class="grid"><span style="bottom:100%">' + fmtShort(top) + '</span><span style="bottom:50%">' + fmtShort(top / 2) + '</span><span style="bottom:0">0</span></div>' +
      '<div class="cols">' + cols + '</div><div class="tip" hidden></div></div>' +
      '<details class="as-table"><summary>Show as a table</summary><table><thead><tr><th scope="col">Month</th><th scope="col">In</th><th scope="col">Out</th><th scope="col">Difference</th></tr></thead><tbody>' + rows + "</tbody></table></details></section>";
  }
  function niceStep(v) {
    var p = Math.pow(10, Math.floor(Math.log10(Math.max(v, 1))));
    var f = v / p;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
  }
  function fmtShort(c) {
    var d = c / 100, p = S.profile();
    try { return new Intl.NumberFormat(p.locale || undefined, { style: "currency", currency: p.currency || "USD", notation: "compact", maximumFractionDigits: 1 }).format(d); }
    catch (e) { return String(Math.round(d)); }
  }
  function bindChart() {
    var box = $(".chart", app); if (!box) return;
    var months = JSON.parse(box.getAttribute("data-months"));
    var tip = $(".tip", box);
    function show(col) {
      var i = +col.getAttribute("data-m"), x = months[i];
      tip.innerHTML = "<b>" + MONTHS[i] + " " + esc(ui.year) + '</b><span><i class="b-in"></i>In ' + fmt(x.in) + '</span><span><i class="b-out"></i>Out ' + fmt(x.out) + "</span>";
      tip.hidden = false;
      var bw = box.getBoundingClientRect(), cw = col.getBoundingClientRect();
      var left = cw.left - bw.left + cw.width / 2;
      left = Math.max(tip.offsetWidth / 2, Math.min(bw.width - tip.offsetWidth / 2, left));
      tip.style.left = left + "px";
    }
    function hide() { tip.hidden = true; }
    box.addEventListener("mouseover", function (e) { var c = e.target.closest(".col"); if (c) show(c); });
    box.addEventListener("mouseleave", hide);
    box.addEventListener("focusin", function (e) { var c = e.target.closest(".col"); if (c) show(c); });
    box.addEventListener("focusout", hide);
  }

  // ---------- money list
  function renderMoney() {
    var y = ui.year;
    var list = allEntries().filter(function (e) { return e.date && e.date.slice(0, 4) === y; });
    var q = ui.q.trim().toLowerCase();
    var shown = list.filter(function (e) {
      if (ui.filter === "in" && e.kind !== "in") return false;
      if (ui.filter === "out" && e.kind !== "out") return false;
      if (ui.filter === "invoices" && !e.fromInvoice) return false;
      if (ui.month && e.date.slice(5, 7) !== ui.month) return false;
      if (q) {
        var hay = [e.party, e.note, e.method, K.category(e.category || e.kind).label].join(" ").toLowerCase();
        if (hay.indexOf(q) < 0) return false;
      }
      return true;
    }).sort(byNewest);
    var sumIn = 0, sumOut = 0;
    shown.forEach(function (e) { if (e.kind === "in") sumIn += +e.amount || 0; else sumOut += +e.amount || 0; });

    var chips = [["all", "All"], ["in", "Money in"], ["out", "Money out"], ["invoices", "From invoices"]];
    var monthOpts = '<option value="">Whole year</option>' + MONTHS.map(function (n, i) {
      var v = String(i + 1).padStart(2, "0");
      return '<option value="' + v + '"' + (ui.month === v ? " selected" : "") + ">" + n + "</option>";
    }).join("");

    app.innerHTML = shell("money", '<div class="wrap">' + actions() +
      '<div class="list-bar no-print"><div class="chips" role="group" aria-label="Show">' + chips.map(function (c) {
        return '<button class="chip" data-filter="' + c[0] + '" aria-pressed="' + (ui.filter === c[0]) + '">' + c[1] + "</button>";
      }).join("") + "</div>" +
      '<label class="month-pick"><span class="sr">Month</span><select id="month" class="input">' + monthOpts + "</select></label>" +
      '<label class="search">' + ICON.search + '<span class="sr">Search</span><input id="q" type="search" placeholder="Search who, notes, category" value="' + esc(ui.q) + '"></label></div>' +
      '<div class="sums" aria-live="polite"><span>' + shown.length + (shown.length === 1 ? " entry" : " entries") + "</span><span>In <b>" + fmt(sumIn) + "</b></span><span>Out <b>" + fmt(sumOut) + "</b></span>" +
      '<button class="btn small ghost csv-btn" data-act="csv">' + ICON.download + "Download CSV</button></div>" +
      '<div class="rows">' + (shown.map(entryRow).join("") || '<p class="muted none">' + (list.length ? "Nothing matches. Try another filter or search." : "Nothing recorded in " + esc(y) + " yet.") + "</p>") + "</div>" +
      limitNote("cash") + "</div>");
    bindShell();
    app.onclick = function (e) {
      if (commonClick(e)) return;
      var c = e.target.closest("[data-filter]");
      if (c) { ui.filter = c.getAttribute("data-filter"); renderMoney(); return; }
      if (e.target.closest('[data-act="csv"]')) exportCSV();
    };
    $("#month", app).addEventListener("change", function () { ui.month = this.value; renderMoney(); });
    var qi = $("#q", app);
    qi.addEventListener("input", function () {
      ui.q = qi.value;
      var pos = qi.selectionStart;
      renderMoney();
      var n = $("#q", app); n.focus(); n.setSelectionRange(pos, pos);
    });
  }

  // ---------- miles
  function renderMiles() {
    var y = ui.year, s = settings();
    var trips = S.all("trips");
    var mine = trips.filter(function (t) { return t.date && t.date.slice(0, 4) === y; }).sort(byNewest);
    var tot = K.totals([], trips, y + "-01-01", y + "-12-31", rateOpts());
    var rateNow = K.mileageRate(today(), rateOpts().rate);

    // The last few distinct trips, so a regular run is one tap.
    var seen = {}, usual = [];
    trips.slice().sort(byNewest).forEach(function (t) {
      var k = [t.purpose, t.from, t.to, t.miles, t.roundTrip].join("|").toLowerCase();
      if (!seen[k] && usual.length < 4) { seen[k] = 1; usual.push(t); }
    });

    var rows = mine.map(function (t) {
      var route = [t.from, t.to].filter(Boolean).join(" to ");
      return '<button type="button" class="row trip" data-act="edit-trip" data-id="' + esc(t.id) + '">' +
        '<span class="row-date">' + esc(shortDate(t.date)) + '</span><span class="row-who"><b>' + esc(t.purpose || "Business trip") + "</b><small>" +
        esc(route) + (t.roundTrip ? (route ? " · " : "") + "round trip" : "") + "</small></span>" +
        '<span class="row-miles">' + miles(K.tripMiles(t)) + ' mi</span><span class="row-amt">' + fmt(K.tripDeduction(t, rateOpts().rate)) + "</span></button>";
    }).join("");

    var known = rateOpts().rate || K.rateKnown(y);
    app.innerHTML = shell("miles", '<div class="wrap">' + actions("add-trip") +
      '<div class="tiles">' +
      '<div class="tile"><span>Miles in ' + esc(y) + "</span><b>" + miles(tot.miles) + "</b><small>" + mine.length + (mine.length === 1 ? " trip" : " trips") + "</small></div>" +
      '<div class="tile good"><span>Mileage deduction</span><b>' + fmt(tot.mileage) + "</b><small>At the IRS standard rate</small></div>" +
      '<div class="tile"><span>Rate today</span><b>' + rateNow.toLocaleString(undefined, { maximumFractionDigits: 2 }) + "¢" + "</b><small>" +
      (rateOpts().rate ? "Your own rate" : "Per mile, IRS business rate") + ' · <button class="linkish" data-act="settings">change</button></small></div></div>' +
      (known ? "" : '<p class="notice">We don\'t know the IRS rate for ' + esc(y) + ' yet, so we\'re using the latest one. Check <a href="https://www.irs.gov/tax-professionals/standard-mileage-rates" rel="noopener" target="_blank">irs.gov</a> and set it in Cash Book settings if it changed.</p>') +
      (usual.length ? '<div class="usual no-print"><span class="label">Again today</span>' + usual.map(function (t) {
        return '<button class="chip" data-repeat="' + esc(t.id) + '">' + ICON.repeat + esc(t.purpose || [t.from, t.to].filter(Boolean).join(" to ") || "Trip") + " · " + miles(K.tripMiles(t)) + " mi</button>";
      }).join("") + "</div>" : "") +
      '<div class="rows">' + (rows || '<p class="muted none">No trips in ' + esc(y) + ' yet. Log each drive for work: where, why and how far. The IRS asks for exactly that.</p>') + "</div>" +
      limitNote("trips") +
      '<p class="muted fine">Use the standard mileage rate or your actual car costs (gas, repairs, insurance) for a vehicle, not both. If you choose actual costs, record them as Money out under "Car and truck, actual costs".</p></div>');
    bindShell();
    app.onclick = function (e) {
      if (commonClick(e)) return;
      var r = e.target.closest("[data-repeat]");
      if (r) repeatTrip(S.get("trips", r.getAttribute("data-repeat")));
    };
  }

  // ---------- year end
  function renderYear() {
    var y = ui.year, p = S.profile();
    var entries = allEntries(), trips = S.all("trips");
    var sc = K.scheduleC(entries, trips, y, rateOpts()), t = sc.totals;
    var rows = sc.rows.map(function (r) {
      return '<tr class="' + (r.total ? "total" : "") + (r.grand ? " grand" : "") + '"><th scope="row"><span class="ln">' + esc(r.line) + "</span>" + esc(r.label) +
        (r.line === "9" && t.mileage ? ' <small class="muted">(' + miles(t.miles) + " miles" + (t.vehicle ? " + actual costs" : "") + ")</small>" : "") +
        "</th><td>" + (r.amount < 0 ? "(" + fmt(-r.amount) + ")" : fmt(r.amount)) + "</td></tr>";
    }).join("");
    var cats = K.CATEGORIES.filter(function (c) { return t.byCategory[c.id]; }).map(function (c) {
      return "<tr><th scope=\"row\">" + esc(c.label) + "</th><td>" + (c.line ? "Line " + c.line : "Not on Schedule C") + "</td><td>" + fmt(t.byCategory[c.id]) + "</td></tr>";
    }).join("");
    var notes = [];
    if (t.mileage && t.vehicle) notes.push("You logged both miles and actual car costs. For any one vehicle you use one method or the other, so ask your tax preparer which to keep.");
    if (t.byCategory.equipment) notes.push("Equipment and tools are shown on line 13. Larger purchases may need to be depreciated over several years instead of deducted at once; your preparer will know.");
    if (t.byCategory.meals) notes.push("Business meals show at half their cost, which is the usual deductible share.");
    notes.push("Money from your invoices is counted when you were paid. If your invoices included sales tax, the tax you collected is in gross receipts; record what you pay the state under Taxes and licenses.");

    app.innerHTML = shell("year", '<div class="wrap">' +
      '<div class="year-actions no-print"><button class="btn" data-act="print">' + ICON.print + "Print or save as PDF</button>" +
      '<button class="btn ghost" data-act="csv">' + ICON.download + "Download CSV</button></div>" +
      '<article class="card summary">' +
      '<header class="sum-head"><div><span class="eyebrow">Year-end summary</span><h2>' + esc(p.name || "My business") + ", " + esc(y) + "</h2>" +
      '<p class="muted">Arranged like IRS Schedule C, Profit or Loss From Business. Prepared ' + esc(fmtDate(today())) + ".</p></div></header>" +
      '<table class="sched"><tbody>' + rows + "</tbody></table>" +
      '<div class="aside-grid"><div><h3>Not counted as income or expense</h3><dl class="kv">' +
      "<div><dt>Owner money or loans in</dt><dd>" + fmt(t.ownerIn) + "</dd></div>" +
      "<div><dt>Owner draws</dt><dd>" + fmt(t.draws) + "</dd></div>" +
      "<div><dt>Estimated tax paid</dt><dd>" + fmt(t.taxPaid) + "</dd></div></dl></div>" +
      "<div><h3>Good to know</h3><ul class=\"notes\">" + notes.map(function (n) { return "<li>" + esc(n) + "</li>"; }).join("") + "</ul></div></div>" +
      (cats ? '<details class="as-table" open><summary>By category</summary><table><thead><tr><th scope="col">Category</th><th scope="col">Where it goes</th><th scope="col">Amount</th></tr></thead><tbody>' + cats + "</tbody></table></details>" : "") +
      '<p class="muted fine">This summary is arithmetic on what you entered. It isn\'t tax advice; take it to your tax preparer or use it to fill in your own return.</p>' +
      (L.isPro() ? "" : '<p class="made">Made with Fair Measure</p>') + "</article></div>");
    bindShell();
    app.onclick = function (e) {
      if (commonClick(e)) return;
      var b = e.target.closest("[data-act]"); if (!b) return;
      if (b.getAttribute("data-act") === "print") {
        var before = document.title;
        document.title = "Year-end summary " + y + (p.name ? " - " + p.name : "");
        window.print();
        setTimeout(function () { document.title = before; }, 500);
      }
      if (b.getAttribute("data-act") === "csv") exportCSV();
    };
  }

  // ---------- CSV (Pro)
  function exportCSV() {
    if (!L.isPro()) {
      FM.confirm({ title: "CSV export is part of Pro", body: "Pro adds spreadsheet export, unlimited records and your logo on documents, for a one-time " + L.config.price + ". Printing the year-end summary is free.", ok: "See Pro", cancel: "Not now" })
        .then(function (yes) { if (yes) location.href = FM.link("settings/#pro"); });
      return;
    }
    var y = ui.year, rows = [["Date", "Type", "Who", "Category", "Schedule C line", "Amount", "Method", "Note", "Miles"]];
    allEntries().filter(function (e) { return e.date && e.date.slice(0, 4) === y; }).sort(byNewest).reverse().forEach(function (e) {
      var c = K.category(e.category || e.kind);
      rows.push([e.date, e.kind === "in" ? "Money in" : "Money out", e.party || "", c.label, c.line || "", M.plain(e.amount) * 1, e.method || "", e.note || "", ""]);
    });
    S.all("trips").filter(function (t) { return t.date && t.date.slice(0, 4) === y; }).sort(byNewest).reverse().forEach(function (t) {
      rows.push([t.date, "Trip", [t.from, t.to].filter(Boolean).join(" to "), "Mileage", "9", M.plain(K.tripDeduction(t, rateOpts().rate)) * 1, "", t.purpose || "", K.tripMiles(t)]);
    });
    var blob = new Blob(["﻿" + K.csv(rows)], { type: "text/csv;charset=utf-8" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "fair-measure-cash-book-" + y + ".csv";
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    FM.toast("CSV downloaded");
  }

  // ---------- entry dialog
  function newEntry(kind) {
    canAdd("cash").then(function (ok) {
      if (!ok) return;
      var d = today();
      // Inside a past year, start on that year's last day so it lands where you're looking.
      if (ui.year !== d.slice(0, 4)) d = ui.year + "-12-31";
      editEntry({ kind: kind, date: d, category: kind === "in" ? "sales" : "" });
    });
  }

  function partyMemory() {
    var map = {};
    S.all("cash").slice().sort(byNewest).reverse().forEach(function (e) { if (e.party) map[e.party.toLowerCase()] = { name: e.party, category: e.category, kind: e.kind, method: e.method }; });
    return map;
  }

  function categoryOptions(kind, selected) {
    return K.CATEGORIES.filter(function (c) { return c.kind === kind; }).map(function (c) {
      return '<option value="' + c.id + '"' + (c.id === selected ? " selected" : "") + ">" + esc(c.label) + "</option>";
    }).join("");
  }

  function editEntry(rec, opts) {
    opts = opts || {};
    var mem = partyMemory();
    var isNew = !rec.id;
    var kind = rec.kind || "out";
    var dlg = document.createElement("dialog");
    dlg.className = "fm-dialog entry-dlg";
    var qs = K.quarters(ui.year).concat(K.quarters(String(+ui.year + 1))).slice(0, 5);
    dlg.innerHTML = '<form method="dialog" class="dlg-body"><h3>' + (isNew ? "Record money" : "Edit entry") + "</h3>" +
      '<div class="kind" role="radiogroup" aria-label="Money in or out">' +
      '<label><input type="radio" name="kind" value="in"' + (kind === "in" ? " checked" : "") + "><span>Money in</span></label>" +
      '<label><input type="radio" name="kind" value="out"' + (kind === "out" ? " checked" : "") + "><span>Money out</span></label></div>" +
      '<div class="grid-2">' + field("Amount", '<input name="amount" inputmode="decimal" autocomplete="off" required placeholder="0.00" value="' + (rec.amount ? M.plain(rec.amount) : "") + '">', "amt") +
      field("Date", '<input type="date" name="date" required value="' + esc(rec.date || today()) + '">') + "</div>" +
      field('<span class="who-l">' + (kind === "in" ? "From" : "Paid to") + "</span> <i>(optional)</i>", '<input name="party" list="dl-party" autocomplete="off" value="' + esc(rec.party) + '" placeholder="' + (kind === "in" ? "Customer or source" : "Store, supplier, person") + '">') +
      '<datalist id="dl-party">' + Object.keys(mem).map(function (k) { return '<option value="' + esc(mem[k].name) + '">'; }).join("") + "</datalist>" +
      field("Category", '<select name="category" required>' + (kind === "out" && !rec.category ? '<option value="" disabled selected>Choose one</option>' : "") + categoryOptions(kind, rec.category) + "</select>") +
      '<div class="q-pick"' + (rec.category === "est-tax" ? "" : " hidden") + ">" + field("Counts toward", '<select name="quarter">' + qs.map(function (q) {
        var sel = rec.quarter ? rec.quarter === q.key : (rec.date && K.paymentQuarter({ date: rec.date }) === q.key);
        return '<option value="' + q.key + '"' + (sel ? " selected" : "") + ">" + esc(q.label + " " + q.from.slice(0, 4) + " (due " + fmtDate(q.due) + ")") + "</option>";
      }).join("") + "</select>") + "</div>" +
      '<div class="grid-2">' + field("Paid by <i>(optional)</i>", '<input name="method" list="dl-methods" value="' + esc(rec.method) + '" placeholder="Cash, card, check…">') +
      field("Note <i>(optional)</i>", '<input name="note" value="' + esc(rec.note) + '">') + "</div>" +
      '<datalist id="dl-methods"><option value="Cash"><option value="Check"><option value="Card"><option value="Bank transfer"><option value="Zelle"><option value="Venmo"></datalist>' +
      '<p class="hint muted" id="cat-hint"></p>' +
      '<div class="dlg-actions">' + (isNew ? "" : '<button class="btn danger" value="delete" formnovalidate>Delete</button><span class="spacer"></span>') +
      '<button class="btn ghost" value="cancel" formnovalidate>Cancel</button><button class="btn" value="ok">' + (isNew ? "Save" : "Save changes") + "</button></div></form>";
    document.body.appendChild(dlg);
    var f = dlg.querySelector("form");
    var touchedCat = !!rec.category && !isNew;

    function hint() {
      var c = K.CATEGORIES.filter(function (x) { return x.id === f.category.value; })[0];
      var h = $("#cat-hint", dlg);
      var txt = !c ? "" : c.line === null ? "Kept in your book but left out of profit and the Schedule C summary."
        : c.id === "cogs" ? "Things that become part of what you sell. Schedule C Part III."
        : c.id === "equipment" ? "Tools and machines that last more than a year. Schedule C line 13."
        : "Schedule C line " + c.line + ".";
      h.textContent = txt;
      $(".q-pick", dlg).hidden = f.category.value !== "est-tax";
    }
    function setKind(k) {
      var cur = f.category.value;
      f.category.innerHTML = (k === "out" ? '<option value="" disabled>Choose one</option>' : "") + categoryOptions(k, cur);
      if (!K.CATEGORIES.some(function (c) { return c.id === cur && c.kind === k; })) f.category.value = k === "in" ? "sales" : "";
      $(".who-l", dlg).textContent = k === "in" ? "From" : "Paid to";
      f.party.placeholder = k === "in" ? "Customer or source" : "Store, supplier, person";
      hint();
    }
    Array.prototype.forEach.call(f.kind, function (r) { r.addEventListener("change", function () { setKind(r.value); }); });
    f.category.addEventListener("change", function () { touchedCat = true; hint(); });
    // Typing a name you've used before fills in the category and method you used last time.
    f.party.addEventListener("change", function () {
      var m = mem[f.party.value.trim().toLowerCase()];
      if (!m || touchedCat) return;
      var k = f.kind.value;
      if (m.kind !== k) return;
      f.category.value = m.category; if (!f.method.value) f.method.value = m.method || "";
      hint();
    });
    f.date.addEventListener("change", function () {
      if (f.category.value === "est-tax" && !rec.quarter) f.quarter.value = K.paymentQuarter({ date: f.date.value }) || f.quarter.value;
    });
    hint();

    dlg.addEventListener("close", function () {
      var v = dlg.returnValue;
      if (v === "ok") {
        var out = Object.assign({}, rec, {
          kind: f.kind.value, amount: M.toCents(f.amount.value), date: f.date.value || today(),
          party: f.party.value.trim(), category: f.category.value || (f.kind.value === "in" ? "sales" : "other-out"),
          method: f.method.value.trim(), note: f.note.value.trim()
        });
        if (out.category === "est-tax") out.quarter = f.quarter.value; else delete out.quarter;
        if (out.amount > 0) {
          S.put("cash", out);
          ui.year = out.date.slice(0, 4);
          FM.toast(isNew ? (out.kind === "in" ? "Money in recorded" : "Money out recorded") : "Saved");
        } else FM.toast("Nothing saved: the amount was empty");
        route();
      } else if (v === "delete") {
        FM.confirm({ title: "Delete this entry?", body: "It comes out of your totals. This can't be undone, unless you have a backup.", ok: "Delete", danger: true })
          .then(function (y) { if (y) { S.remove("cash", rec.id); FM.toast("Deleted"); route(); } });
      }
      dlg.remove();
    });
    dlg.showModal();
    if (opts.focus !== false) setTimeout(function () { f.amount.focus(); }, 30);
  }

  function payQuarter(key, plan) {
    var q = plan.filter(function (x) { return x.key === key; })[0];
    canAdd("cash").then(function (ok) {
      if (!ok) return;
      var owe = Math.max(0, q.setAside - q.paid);
      editEntry({ kind: "out", category: "est-tax", quarter: key, date: today(), amount: owe, party: "IRS", note: "Estimated tax, " + q.label + " " + key.slice(0, 4) });
    });
  }

  // ---------- trip dialog
  function newTrip(prefill) {
    canAdd("trips").then(function (ok) {
      if (!ok) return;
      var last = S.all("trips").slice().sort(byNewest)[0];
      editTrip(Object.assign({ date: today(), roundTrip: last ? !!last.roundTrip : true }, prefill || {}));
    });
  }
  function repeatTrip(t) {
    if (!t) return;
    canAdd("trips").then(function (ok) {
      if (!ok) return;
      var copy = { date: today(), purpose: t.purpose, from: t.from, to: t.to, miles: t.miles, roundTrip: t.roundTrip };
      S.put("trips", copy);
      FM.toast("Trip logged: " + miles(K.tripMiles(copy)) + " miles");
      route();
    });
  }

  function editTrip(rec) {
    var isNew = !rec.id;
    var dlg = document.createElement("dialog");
    dlg.className = "fm-dialog";
    dlg.innerHTML = '<form method="dialog" class="dlg-body"><h3>' + (isNew ? "Log a trip" : "Edit trip") + "</h3>" +
      field("What was it for?", '<input name="purpose" required value="' + esc(rec.purpose) + '" placeholder="e.g. Measure kitchen for the Kellys">') +
      '<div class="grid-2">' + field("From <i>(optional)</i>", '<input name="from" value="' + esc(rec.from) + '" placeholder="Shop">') +
      field("To <i>(optional)</i>", '<input name="to" value="' + esc(rec.to) + '" placeholder="Customer, store…">') + "</div>" +
      '<div class="grid-2">' + field("Miles, one way", '<input name="miles" inputmode="decimal" required autocomplete="off" value="' + esc(rec.miles == null ? "" : rec.miles) + '" placeholder="0">') +
      field("Date", '<input type="date" name="date" required value="' + esc(rec.date || today()) + '">') + "</div>" +
      '<label class="check"><input type="checkbox" name="roundTrip"' + (rec.roundTrip ? " checked" : "") + "> Round trip (counts the miles twice)</label>" +
      '<p class="trip-calc" aria-live="polite"></p>' +
      '<div class="dlg-actions">' + (isNew ? "" : '<button class="btn danger" value="delete" formnovalidate>Delete</button><span class="spacer"></span>') +
      '<button class="btn ghost" value="cancel" formnovalidate>Cancel</button><button class="btn" value="ok">' + (isNew ? "Save trip" : "Save changes") + "</button></div></form>";
    document.body.appendChild(dlg);
    var f = dlg.querySelector("form");
    function calc() {
      var t = { miles: f.miles.value, roundTrip: f.roundTrip.checked, date: f.date.value || today() };
      var mi = K.tripMiles(t);
      $(".trip-calc", dlg).innerHTML = mi ? miles(mi) + " miles · <b>" + fmt(K.tripDeduction(t, rateOpts().rate)) + "</b> at " + K.mileageRate(t.date, rateOpts().rate) + "¢ a mile" : "";
    }
    ["input", "change"].forEach(function (ev) { f.addEventListener(ev, calc); });
    calc();
    dlg.addEventListener("close", function () {
      var v = dlg.returnValue;
      if (v === "ok") {
        var out = Object.assign({}, rec, {
          purpose: f.purpose.value.trim(), from: f.from.value.trim(), to: f.to.value.trim(),
          miles: Math.round(Math.max(0, parseFloat(f.miles.value) || 0) * 10) / 10, roundTrip: f.roundTrip.checked, date: f.date.value || today()
        });
        if (out.miles > 0) { S.put("trips", out); ui.year = out.date.slice(0, 4); FM.toast(isNew ? "Trip logged" : "Saved"); }
        else FM.toast("Nothing saved: add the miles");
        route();
      } else if (v === "delete") {
        FM.confirm({ title: "Delete this trip?", ok: "Delete", danger: true })
          .then(function (y) { if (y) { S.remove("trips", rec.id); FM.toast("Deleted"); route(); } });
      }
      dlg.remove();
    });
    dlg.showModal();
    setTimeout(function () { f.purpose.focus(); }, 30);
  }

  // ---------- settings
  function editSettings() {
    var s = settings();
    var dlg = document.createElement("dialog");
    dlg.className = "fm-dialog";
    dlg.innerHTML = '<form method="dialog" class="dlg-body"><h3>Cash Book settings</h3>' +
      field("Set aside for taxes, % of profit", '<input name="setAside" inputmode="decimal" value="' + esc(s.setAside) + '">') +
      '<p class="hint muted">Most sole proprietors set aside 25 to 30%: about 15% goes to self-employment tax and the rest to income tax. Your tax preparer can give you a closer figure.</p>' +
      field("Mileage rate, cents per mile <i>(leave empty for the IRS rate)</i>", '<input name="rate" inputmode="decimal" value="' + esc(s.rate) + '" placeholder="IRS rate by date">') +
      '<div class="dlg-actions"><button class="btn ghost" value="cancel" formnovalidate>Cancel</button><button class="btn" value="ok">Save</button></div></form>';
    document.body.appendChild(dlg);
    dlg.addEventListener("close", function () {
      if (dlg.returnValue === "ok") {
        var f = dlg.querySelector("form");
        var pct = Math.min(Math.max(parseFloat(f.setAside.value) || 0, 0), 100);
        var rate = parseFloat(f.rate.value);
        S.saveProfile({ cash: { setAside: pct, rate: rate > 0 ? rate : "" } });
        FM.toast("Saved");
        route();
      }
      dlg.remove();
    });
    dlg.showModal();
  }

  // ---------- start
  document.addEventListener("DOMContentLoaded", function () {
    app = document.getElementById("app");
    window.addEventListener("hashchange", route);
    // Another tab changed the data (an invoice was paid, say): refresh, unless a dialog is open.
    S.onChange(function (key, external) { if (external && !document.querySelector("dialog[open]")) route(); });
    route();
  });
})();
