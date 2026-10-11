/* Stock Book.
   Routes (in the address hash): the shelf "" (everything, with filters), "#s/<id>" (one
   thing, its history and actions), "#count" (a stock take), "#reorder" (what to order, by
   supplier) and "#value" (stock value on any date, for year-end inventory).
   Stocked things are the shared `stock` collection: {id, name, kind "sell"|"supply", unit,
   sku, location, supplier, unitCost (cents), reorderAt, reorderQty, itemId (a saved item it
   is sold as), notes, archived}. Changes are `stockMoves`: {id, stockId, date, kind
   ("in", "made", "sold", "used", "waste", "count"), qty (signed; not for counts), counted
   (counts only), unitCost (deliveries), note, cashId (the Cash Book entry a delivery made)}.
   Sales on sent and paid invoices are read straight from `documents` (see stock.js), and
   settings live in `profile.stockBook`. */
(function () {
  "use strict";
  var FM = window.FM, S = FM.store, K = window.FMStock, M = FM.money, L = FM.license, esc = FM.esc;
  var app;
  var ui = { filter: "all", q: "", asOf: "" };

  var ICON = {
    plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
    minus: '<svg viewBox="0 0 24 24"><path d="M6 12h12"/></svg>',
    back: '<svg viewBox="0 0 24 24"><path d="M15 6l-6 6 6 6"/></svg>',
    box: '<svg viewBox="0 0 24 24"><path d="M4 8l8-4 8 4v8l-8 4-8-4z"/><path d="M4 8l8 4 8-4M12 12v8"/></svg>',
    truck: '<svg viewBox="0 0 24 24"><path d="M3 7h11v9H3zM14 10h4l3 3v3h-7"/><circle cx="7" cy="17.5" r="1.8"/><circle cx="17" cy="17.5" r="1.8"/></svg>',
    check: '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
    list: '<svg viewBox="0 0 24 24"><path d="M9 6h11M9 12h11M9 18h11"/><path d="M4.5 6h.01M4.5 12h.01M4.5 18h.01"/></svg>',
    print: '<svg viewBox="0 0 24 24"><path d="M7 9V4h10v5M7 17H5a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-2"/><path d="M7 14h10v6H7z"/></svg>',
    down: '<svg viewBox="0 0 24 24"><path d="M12 4v11M7.5 10.5L12 15l4.5-4.5M5 19h14"/></svg>',
    copy: '<svg viewBox="0 0 24 24"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/></svg>',
    mail: '<svg viewBox="0 0 24 24"><rect x="3.5" y="5.5" width="17" height="13" rx="2"/><path d="M4 7l8 6 8-6"/></svg>',
    gear: '<svg viewBox="0 0 24 24"><path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/></svg>',
    doc: '<svg viewBox="0 0 24 24"><path d="M7 3.5h7l4 4V20a.5.5 0 0 1-.5.5h-10.5A.5.5 0 0 1 6.5 20V4a.5.5 0 0 1 .5-.5z"/><path d="M14 3.5V8h4M9.5 12.5h5M9.5 16h5"/></svg>',
    search: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5"/></svg>',
    trash: '<svg viewBox="0 0 24 24"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>',
    warn: '<svg viewBox="0 0 24 24"><path d="M12 4l9 16H3z"/><path d="M12 10v4M12 17.2v.1"/></svg>'
  };

  // ---------- helpers
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function today() { return K.localDate(new Date()); }
  function fmtDate(d, opts) {
    try { return new Date(d + "T12:00:00").toLocaleDateString(undefined, opts || { month: "short", day: "numeric", year: "numeric" }); }
    catch (e) { return d; }
  }
  function fmt(c) { var p = S.profile(); return M.format(c, p.currency, p.locale || undefined); }
  function field(label, control, cls) { return '<label class="field' + (cls ? " " + cls : "") + '"><span>' + label + "</span>" + control + "</label>"; }
  function go(hash) { if (location.hash === hash || (hash === "#" && !location.hash)) route(); else location.hash = hash; }
  function settings() { return Object.assign({ fromInvoices: true }, S.profile().stockBook || {}); }
  function saveSettings(patch) { try { S.saveProfile({ stockBook: Object.assign(settings(), patch) }); } catch (e) { FM.toast(e.message); } }
  function put(col, rec) { try { return S.put(col, rec); } catch (e) { FM.toast(e.message); return null; } }
  function money2(cents) { return cents ? (cents / 100).toFixed(2) : ""; }
  function qtyUnit(q, unit) { return K.fmtQty(q) + (unit ? " " + esc(unit) : ""); }
  function download(name, type, text) {
    var a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: type }));
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  function byName(a, b) { return String(a.name).localeCompare(String(b.name)); }
  function active() { return S.all("stock").filter(function (s) { return !s.archived; }).sort(byName); }

  // Everything the pages need, worked out once: stocked things, their changes, sales read
  // from invoices, and the level of each on a date (empty = now).
  function book(asOf) {
    var stock = S.all("stock"), moves = S.all("stockMoves");
    var sales = settings().fromInvoices ? K.salesFromDocs(S.all("documents"), stock, S.all("items")) : [];
    return { stock: stock, moves: moves, sales: sales, lv: K.levels(stock, moves, sales, asOf) };
  }

  function limitDialog(what) {
    return FM.confirm({
      title: what === "csv" ? "Spreadsheet export is part of Pro" : "You've reached the free limit",
      body: what === "csv"
        ? "Pro adds spreadsheet export to every tool, removes every limit, and costs a one-time " + L.config.price + "."
        : "The free version tracks up to " + L.limits.stock + " things at once. Stop tracking ones you no longer stock (their history stays), or Pro removes every limit for a one-time " + L.config.price + ".",
      ok: "See Pro", cancel: "Not now"
    }).then(function (yes) { if (yes) location.href = FM.link("settings/#pro"); return false; });
  }
  function room() { return L.canAdd("stock", active().length); }
  function canAdd() { return room().allowed ? Promise.resolve(true) : limitDialog(); }

  function openDialog(html) {
    var dlg = document.createElement("dialog");
    dlg.className = "fm-dialog sb-dialog";
    dlg.innerHTML = html;
    document.body.appendChild(dlg);
    dlg.addEventListener("close", function () { setTimeout(function () { dlg.remove(); }, 0); });
    // Only the main button submits, so pressing Enter in a field always means "save";
    // the others close the dialog with their own answer.
    dlg.addEventListener("click", function (e) {
      var b = e.target.closest("button[data-close]");
      if (b) dlg.close(b.getAttribute("data-close"));
    });
    dlg.showModal();
    return dlg;
  }

  function kindWord(s, kind) {
    if (kind === "sold" && s && s.kind === "supply") return "Used";
    return (K.KINDS[kind] || { label: kind }).label;
  }
  function outKind(s) { return s.kind === "supply" ? "used" : "sold"; }

  // ---------- the page frame
  function head(activeTab, lowCount) {
    var tabs = [["#", "Stock", "stock"], ["#reorder", "Reorder" + (lowCount ? ' <span class="badge">' + lowCount + "</span>" : ""), "reorder"], ["#count", "Stock take", "count"], ["#value", "Value", "value"]];
    return '<div class="wrap app-head no-print"><div><div class="app-title"><h1>Stock Book</h1>' +
      (L.isPro() ? '<span class="fm-pro-chip">Pro</span>' : "") + "</div>" +
      '<p class="muted sub">What’s on the shelf, what’s running low, and what it’s worth.</p></div>' +
      '<div class="head-right"><nav class="seg" aria-label="Sections">' + tabs.map(function (t) {
        return '<a href="' + t[0] + '"' + (t[2] === activeTab ? ' aria-current="page"' : "") + ">" + t[1] + "</a>";
      }).join("") + '</nav><button class="icon-btn round" data-act="settings" aria-label="Stock Book settings" title="Settings">' + ICON.gear + "</button></div></div>";
  }
  function lowCount(b) { return active().filter(function (s) { return b.lv[s.id] && b.lv[s.id].low; }).length; }

  function route() {
    var h = location.hash.replace(/^#/, "");
    app.onclick = null; app.oninput = null; app.onchange = null;
    window.scrollTo(0, 0);
    if (h.indexOf("s/") === 0) return renderThing(decodeURIComponent(h.slice(2)));
    if (h === "count") return renderCount();
    if (h === "reorder") return renderReorder();
    if (h === "value") return renderValue();
    renderShelf();
  }

  function commonClicks(e) {
    var b = e.target.closest("[data-act]");
    if (!b) return false;
    var act = b.getAttribute("data-act"), id = b.getAttribute("data-id");
    if (act === "settings") { settingsDialog(); return true; }
    if (act === "add") { canAdd().then(function (ok) { if (ok) thingDialog({ kind: b.getAttribute("data-kind") || "sell" }); }); return true; }
    if (act === "print") { window.print(); return true; }
    if (act === "move") { var s = S.get("stock", id); if (s) moveDialog(s, b.getAttribute("data-kind")); return true; }
    if (act === "one-out") { oneOut(id); return true; }
    return false;
  }

  // ---------- the shelf
  function renderShelf() {
    var b = book(), list = active(), today0 = today();
    if (!list.length) return renderStart(b);
    var low = 0, out = 0;
    list.forEach(function (s) { var r = b.lv[s.id]; if (r.low) low++; if (K.isOut(r.onHand)) out++; });
    var value = K.totalValue(list, b.lv);
    var q = K.norm(ui.q);
    var shown = list.filter(function (s) {
      var r = b.lv[s.id];
      if (ui.filter === "low" && !(r.low || K.isOut(r.onHand))) return false;
      if (ui.filter === "sell" && s.kind === "supply") return false;
      if (ui.filter === "supply" && s.kind !== "supply") return false;
      if (q && [s.name, s.sku, s.location, s.supplier].map(K.norm).join(" ").indexOf(q) < 0) return false;
      return true;
    });
    var chips = [["all", "Everything"], ["low", "Low or out"], ["sell", "For sale"], ["supply", "Supplies"]];
    var hasSupplies = list.some(function (s) { return s.kind === "supply"; }), hasSell = list.some(function (s) { return s.kind !== "supply"; });
    if (!(hasSupplies && hasSell)) chips = chips.slice(0, 2);
    var r0 = room();

    app.innerHTML = head("stock", low) + '<div class="wrap">' +
      '<div class="stats">' +
      '<div class="stat"><span>Things tracked</span><b>' + list.length + "</b></div>" +
      '<a class="stat' + (low ? " warn" : "") + '" href="#reorder"><span>Running low</span><b>' + low + "</b>" + (out ? '<small>' + out + " out of stock</small>" : "<small>" + (low ? "See the reorder list" : "All good") + "</small>") + "</a>" +
      '<a class="stat" href="#value"><span>Stock value, at cost</span><b>' + fmt(value) + "</b><small>Value on any date</small></a></div>" +
      '<div class="list-bar">' +
      '<div class="chips" role="group" aria-label="Show">' + chips.map(function (c) {
        return '<button class="chip" data-act="filter" data-f="' + c[0] + '" aria-pressed="' + (ui.filter === c[0]) + '">' + c[1] + "</button>";
      }).join("") + "</div>" +
      '<label class="search">' + ICON.search + '<span class="sr">Search stock</span><input type="search" id="q" placeholder="Search name, SKU, shelf, supplier" value="' + esc(ui.q) + '"></label>' +
      '<button class="btn" data-act="add">' + ICON.plus + "Add</button></div>" +
      '<ul class="shelf" id="shelf">' + (shown.length ? shown.map(function (s) { return shelfRow(s, b.lv[s.id], today0); }).join("") : '<li class="none muted">Nothing matches.</li>') + "</ul>" +
      (settings().fromInvoices ? '<p class="muted small foot-note">' + ICON.doc + "Things on sent and paid invoices come out of stock by themselves, matched by name.</p>" : "") +
      (!L.isPro() && r0.used >= r0.limit - 3 ? '<p class="limit-note muted">' + r0.used + " of " + r0.limit + ' free stocked things used. <a href="' + FM.link("settings/#pro") + '">Pro</a> removes the limit.</p>' : "") +
      "</div>";

    var qi = $("#q");
    qi.addEventListener("input", function () {
      ui.q = qi.value;
      var pos = qi.selectionStart;
      renderShelf();
      var n = $("#q"); n.focus(); try { n.setSelectionRange(pos, pos); } catch (e) { /* fine */ }
    });
    app.onclick = function (e) {
      if (commonClicks(e)) return;
      var b0 = e.target.closest("[data-act]");
      if (b0 && b0.getAttribute("data-act") === "filter") { ui.filter = b0.getAttribute("data-f"); renderShelf(); }
    };
  }

  function statusPill(s, r) {
    if (r.onHand < 0) return '<span class="pill rose">Below zero</span>';
    if (K.isOut(r.onHand)) return '<span class="pill rose">Out</span>';
    if (r.low) return '<span class="pill gold">Low</span>';
    return "";
  }
  function paceText(r, today0) {
    var w = K.weeksLeft(r.onHand, K.dailyUse(r.history, today0));
    if (w === null || w >= 12 || r.onHand <= 0) return "";
    return w < 1 ? "Less than a week left at this pace" : "About " + Math.round(w) + " week" + (Math.round(w) === 1 ? "" : "s") + " left";
  }

  function shelfRow(s, r, today0) {
    var meta = [s.sku, s.location, s.supplier].filter(Boolean).map(esc).join(" · ");
    var pace = paceText(r, today0);
    var level = s.reorderAt !== "" && K.hasLevel(s.reorderAt) ? Math.min(100, Math.max(0, r.onHand / Math.max(1, +s.reorderAt * 2) * 100)) : null;
    return '<li class="thing' + (r.low || K.isOut(r.onHand) ? " is-low" : "") + '">' +
      '<a class="t-main" href="#s/' + encodeURIComponent(s.id) + '">' +
      '<span class="t-name"><b>' + esc(s.name) + "</b>" + (s.kind === "supply" ? '<span class="tag">Supply</span>' : "") +
      '<small>' + (meta || (s.unitCost ? fmt(s.unitCost) + (s.unit ? " a " + esc(s.unit) : " each") : "&nbsp;")) + "</small>" +
      (pace ? '<small class="pace">' + pace + "</small>" : "") + "</span>" +
      '<span class="t-qty"><b>' + K.fmtQty(r.onHand) + "</b><small>" + esc(s.unit || "on hand") + "</small>" + statusPill(s, r) + "</span>" +
      (level !== null ? '<span class="gauge" aria-hidden="true"><i style="width:' + level.toFixed(0) + '%"></i></span>' : "") + "</a>" +
      '<span class="t-acts">' +
      '<button class="icon-btn" data-act="one-out" data-id="' + esc(s.id) + '" aria-label="' + (s.kind === "supply" ? "Used one " : "Sold one ") + esc(s.name) + '" title="' + (s.kind === "supply" ? "Used one" : "Sold one") + '">' + ICON.minus + "</button>" +
      '<button class="icon-btn" data-act="move" data-kind="in" data-id="' + esc(s.id) + '" aria-label="Received more ' + esc(s.name) + '" title="Received more">' + ICON.plus + "</button></span></li>";
  }

  function oneOut(id) {
    var s = S.get("stock", id);
    if (!s) return;
    var saved = put("stockMoves", { stockId: s.id, date: today(), kind: outKind(s), qty: -1, note: "" });
    if (!saved) return;
    var r = book().lv[s.id];
    FM.toast((s.kind === "supply" ? "Used one. " : "Sold one. ") + K.fmtQty(r.onHand) + " left");
    route();
  }

  // ---------- first visit: start from the saved items
  function renderStart(b) {
    var tracked = {};
    S.all("stock").forEach(function (s) { if (s.itemId) tracked[s.itemId] = 1; tracked["n:" + K.norm(s.name)] = 1; });
    var items = S.all("items").filter(function (it) { return it.name && !tracked[it.id] && !tracked["n:" + K.norm(it.name)] && it.unit !== "hr"; }).sort(byName);
    var archived = S.all("stock").filter(function (s) { return s.archived; }).length;
    app.innerHTML = head("stock", 0) + '<div class="wrap">' +
      '<section class="card start"><div class="start-lead">' + startArt() +
      "<div><h2>Start your Stock Book</h2><p class=\"muted\">Keep count of what you sell and the supplies you use. When something runs low it goes on your reorder list, and sent invoices take sold things out of stock without any typing.</p></div></div>" +
      (items.length
        ? '<form id="from-items" class="from-items" autocomplete="off"><h3 class="sec">' + ICON.box + "Track what you already sell</h3>" +
          '<p class="muted small">From your saved items. Tick the ones you keep on the shelf (things you costed in Price Builder start ticked), and type how many you have now. You can count later too.</p>' +
          '<ul class="pick">' + items.map(function (it) {
            return '<li><label class="check"><input type="checkbox" name="pick" value="' + esc(it.id) + '"' + (it.cost ? " checked" : "") + '> <span>' + esc(it.name) +
              (it.cost ? ' <small class="muted">costs ' + fmt(it.cost) + "</small>" : "") + "</span></label>" +
              '<label class="mini-field"><span class="sr">How many ' + esc(it.name) + ' now</span><input name="n-' + esc(it.id) + '" inputmode="decimal" placeholder="How many now?"></label></li>';
          }).join("") + "</ul>" +
          '<div class="start-go"><button class="btn" type="submit">' + ICON.check + "Start tracking these</button>" +
          '<button class="link-btn" type="button" data-act="add" data-kind="supply">Or add a supply you use</button></div></form>'
        : '<div class="start-go"><button class="btn" data-act="add">' + ICON.plus + "Add something you sell</button>" +
          '<button class="btn ghost" data-act="add" data-kind="supply">' + ICON.plus + "Add a supply you use</button></div>") +
      "</section>" +
      (archived ? '<p class="muted small center">You stopped tracking ' + archived + " thing" + (archived === 1 ? "" : "s") + '. Their history is kept for <a href="#value">past stock values</a>.</p>' : "") +
      "</div>";

    var form = $("#from-items");
    // Typing a count ticks the item, so one step does both.
    if (form) form.addEventListener("input", function (e) {
      var li = e.target.closest("li"), box = li && li.querySelector('input[name="pick"]');
      if (box && e.target !== box && e.target.value.trim()) box.checked = true;
    });
    if (form) form.addEventListener("submit", function (e) {
      e.preventDefault();
      var picks = $$('input[name="pick"]:checked', form).map(function (x) { return x.value; });
      if (!picks.length) { FM.toast("Tick at least one item"); return; }
      var r0 = room(), space = r0.limit - r0.used, made = 0, bad = 0;
      picks.forEach(function (id) {
        if (made >= space) return;
        var it = S.get("items", id);
        if (!it) return;
        var n = K.parseQty(form["n-" + id].value);
        if (form["n-" + id].value.trim() && n === null) bad++;
        var rec = put("stock", { name: it.name, kind: "sell", unit: it.unit || "", sku: "", location: "", supplier: "", unitCost: it.cost || 0, reorderAt: "", reorderQty: "", itemId: it.id, notes: "", archived: false });
        if (!rec) return;
        made++;
        if (n !== null) put("stockMoves", { stockId: rec.id, date: today(), kind: "count", counted: n, note: "Starting count" });
      });
      FM.toast("Tracking " + made + " thing" + (made === 1 ? "" : "s") + (bad ? ". Some counts weren’t numbers, so count those again" : ""));
      if (made < picks.length) limitDialog();
      route();
    });
    app.onclick = function (e) { commonClicks(e); };
  }

  // ---------- add or edit a stocked thing
  function thingDialog(rec) {
    var isNew = !rec.id;
    var items = S.all("items").slice().sort(byName);
    var sups = {};
    S.all("stock").forEach(function (s) { if (s.supplier) sups[s.supplier.trim()] = 1; });
    S.all("cash").forEach(function (c) { if (c.kind === "out" && c.party && (c.category === "cogs" || c.category === "supplies")) sups[c.party.trim()] = 1; });
    var linked = rec.itemId && S.get("items", rec.itemId);
    var dlg = openDialog('<form method="dialog" class="dlg-body" autocomplete="off">' +
      "<h3>" + (isNew ? (rec.kind === "supply" ? "Add a supply" : "Add something you sell") : "Edit " + esc(rec.name)) + "</h3>" +
      '<fieldset class="opts"><legend class="label">What is it?</legend>' +
      '<label class="radio"><input type="radio" name="kind" value="sell"' + (rec.kind !== "supply" ? " checked" : "") + "> Something I sell</label>" +
      '<label class="radio"><input type="radio" name="kind" value="supply"' + (rec.kind === "supply" ? " checked" : "") + "> A supply I use</label></fieldset>" +
      field("Name", '<input name="name" required maxlength="120" list="dl-items" value="' + esc(rec.name || "") + '" placeholder="Honey jar, 12 oz">') +
      '<p class="muted small link-note" id="link-note"></p>' +
      '<div class="grid-3">' + field("Counted in", '<input name="unit" maxlength="20" value="' + esc(rec.unit || "") + '" placeholder="jar, lb, box">') +
      field("Cost each <i>(what you pay)</i>", '<input name="unitCost" inputmode="decimal" value="' + esc(money2(rec.unitCost)) + '" placeholder="0.00">') +
      field("SKU <i>(optional)</i>", '<input name="sku" maxlength="40" value="' + esc(rec.sku || "") + '">') + "</div>" +
      '<div class="grid-2">' + field("Reorder when down to", '<input name="reorderAt" inputmode="decimal" value="' + esc(rec.reorderAt === undefined ? "" : rec.reorderAt) + '" placeholder="Leave blank for no alert">') +
      field("Usual order <i>(optional)</i>", '<input name="reorderQty" inputmode="decimal" value="' + esc(rec.reorderQty || "") + '" placeholder="How many you buy at once">') + "</div>" +
      '<div class="grid-2">' + field("Supplier <i>(optional)</i>", '<input name="supplier" maxlength="80" list="dl-sups" value="' + esc(rec.supplier || "") + '">') +
      field("Where it’s kept <i>(optional)</i>", '<input name="location" maxlength="60" value="' + esc(rec.location || "") + '" placeholder="Back shelf, van, freezer">') + "</div>" +
      (isNew ? field("How many do you have now? <i>(optional)</i>", '<input name="start" inputmode="decimal" placeholder="Count it now or later">') : "") +
      field("Notes <i>(optional)</i>", '<textarea name="notes" maxlength="1000" rows="2">' + esc(rec.notes || "") + "</textarea>") +
      '<datalist id="dl-items">' + items.map(function (it) { return '<option value="' + esc(it.name) + '">'; }).join("") + "</datalist>" +
      '<datalist id="dl-sups">' + Object.keys(sups).sort().map(function (s) { return '<option value="' + esc(s) + '">'; }).join("") + "</datalist>" +
      '<p class="err" id="err" role="alert" hidden></p>' +
      '<div class="dlg-actions">' + (isNew ? "" : '<button class="link-btn danger grow-l" type="button" data-close="remove">Stop tracking or delete</button>') +
      '<button class="btn ghost" type="button" data-close="cancel">Cancel</button><button class="btn" value="ok">' + (isNew ? "Add it" : "Save") + "</button></div></form>");
    var f = $("form", dlg), note = $("#link-note", dlg), err = $("#err", dlg);
    var itemId = rec.itemId || "";

    function matchItem() {
      var it = items.find(function (x) { return K.norm(x.name) === K.norm(f.name.value); });
      var sell = f.querySelector('[name="kind"]:checked').value === "sell";
      if (it && sell) {
        itemId = it.id;
        note.textContent = "Linked to your saved item " + it.name + (it.price ? " (sells for " + fmt(it.price) + ")" : "") + ". Invoices with it take it out of stock.";
        if (!f.unit.value && it.unit) f.unit.value = it.unit;
        if (!f.unitCost.value && it.cost) f.unitCost.value = money2(it.cost);
      } else {
        itemId = sell && linked && K.norm(linked.name) === K.norm(f.name.value) ? linked.id : "";
        note.textContent = sell && f.name.value.trim() ? "Invoice lines named exactly “" + f.name.value.trim() + "” take it out of stock." : "";
      }
    }
    f.name.addEventListener("change", matchItem);
    $$('[name="kind"]', f).forEach(function (r) { r.addEventListener("change", matchItem); });
    matchItem();

    f.addEventListener("submit", function (e) {
      var v = e.submitter && e.submitter.value;
      if (v !== "ok") return;
      var bad = [];
      var at = f.reorderAt.value.trim() ? K.parseQty(f.reorderAt.value) : "";
      var oq = f.reorderQty.value.trim() ? K.parseQty(f.reorderQty.value) : "";
      var st = f.start && f.start.value.trim() ? K.parseQty(f.start.value) : "";
      if (at === null) bad.push("the reorder level");
      if (oq === null || (oq !== "" && oq <= 0)) bad.push("the usual order");
      if (st === null) bad.push("how many you have");
      var name = f.name.value.trim();
      var clash = S.all("stock").find(function (s) { return s.id !== rec.id && !s.archived && K.norm(s.name) === K.norm(name); });
      if (clash) { e.preventDefault(); err.hidden = false; err.textContent = "You already track " + clash.name + ". Each name can be tracked once, so invoices know which one to take from."; return; }
      if (bad.length) { e.preventDefault(); err.hidden = false; err.textContent = "Please use a number for " + bad.join(" and ") + "."; }
    });
    dlg.addEventListener("close", function () {
      var v = dlg.returnValue;
      if (v === "remove") return removeDialog(rec);
      if (v !== "ok") return;
      var kind = f.querySelector('[name="kind"]:checked').value;
      var out = Object.assign({}, rec, {
        name: f.name.value.trim(), kind: kind, unit: f.unit.value.trim(), sku: f.sku.value.trim(),
        unitCost: Math.max(0, M.toCents(f.unitCost.value)),
        reorderAt: f.reorderAt.value.trim() ? K.parseQty(f.reorderAt.value) : "",
        reorderQty: f.reorderQty.value.trim() ? K.parseQty(f.reorderQty.value) : "",
        supplier: f.supplier.value.trim(), location: f.location.value.trim(), notes: f.notes.value.trim(),
        itemId: kind === "sell" ? itemId : "", archived: !!rec.archived
      });
      var saved = put("stock", out);
      if (!saved) return;
      if (isNew && f.start.value.trim()) put("stockMoves", { stockId: saved.id, date: today(), kind: "count", counted: K.parseQty(f.start.value), note: "Starting count" });
      FM.toast(isNew ? "Added " + saved.name : "Saved");
      if (isNew) go("#s/" + encodeURIComponent(saved.id)); else route();
    });
    setTimeout(function () { (isNew ? f.name : f.unitCost).focus(); }, 30);
  }

  function removeDialog(rec) {
    var n = S.all("stockMoves").filter(function (m) { return m.stockId === rec.id; }).length;
    var dlg = openDialog('<form method="dialog" class="dlg-body"><h3>Stop tracking ' + esc(rec.name) + "?</h3>" +
      '<p class="muted">Stopping keeps its history, so stock values for past dates stay right, and frees a place on your list. You can track it again any time. Deleting removes it and its ' + n + " recorded change" + (n === 1 ? "" : "s") + " for good.</p>" +
      '<div class="dlg-actions"><button class="link-btn danger grow-l" type="button" data-close="delete">Delete for good</button>' +
      '<button class="btn ghost" type="button" data-close="cancel">Keep it</button><button class="btn" value="archive">Stop tracking</button></div></form>');
    dlg.addEventListener("close", function () {
      var v = dlg.returnValue;
      if (v === "archive") { put("stock", Object.assign({}, rec, { archived: true })); FM.toast("Stopped tracking " + rec.name); go("#"); }
      if (v === "delete") {
        FM.confirm({ title: "Delete " + rec.name + " for good?", body: "This can't be undone, unless you have a backup. Cash Book entries for deliveries stay.", ok: "Delete", danger: true }).then(function (yes) {
          if (!yes) return;
          try {
            S.raw.write("stockMoves", S.all("stockMoves").filter(function (m) { return m.stockId !== rec.id; }));
            S.remove("stock", rec.id);
          } catch (e) { FM.toast(e.message); return; }
          FM.toast("Deleted"); go("#");
        });
      }
    });
  }

  // ---------- record a change
  function moveDialog(s, kind, preset) {
    preset = preset || {};
    kind = kind || "in";
    var r = book().lv[s.id], unit = s.unit || "";
    var kinds = s.kind === "supply" ? ["in", "used", "waste", "count"] : ["in", "made", "sold", "waste", "count"];
    var titles = { "in": "Received", made: "Made", sold: "Sold", used: "Used", waste: "Spoiled or damaged", count: "Count" };
    var cashRoom = L.canAdd("cash", S.count("cash")).allowed;
    var dlg = openDialog('<form method="dialog" class="dlg-body" autocomplete="off">' +
      "<h3>" + esc(s.name) + '</h3><p class="muted small">' + K.fmtQty(r.onHand) + (unit ? " " + esc(unit) : "") + " on hand now</p>" +
      '<div class="kinds" role="radiogroup" aria-label="What happened">' + kinds.map(function (k) {
        return '<label class="kind"><input type="radio" name="kind" value="' + k + '"' + (k === kind ? " checked" : "") + "><span>" + titles[k] + "</span></label>";
      }).join("") + "</div>" +
      '<div class="grid-2">' + field('<span id="q-label">How many</span>', '<input name="qty" inputmode="decimal" required value="' + esc(preset.qty || "") + '">') +
      field("Date", '<input type="date" name="date" required value="' + esc(today()) + '">') + "</div>" +
      '<div class="in-only grid-2">' + field("Cost each", '<input name="unitCost" inputmode="decimal" value="' + esc(money2(s.unitCost)) + '" placeholder="0.00">') +
      field("From <i>(optional)</i>", '<input name="supplier" maxlength="80" value="' + esc(s.supplier || "") + '">') + "</div>" +
      '<label class="check in-only cash-check"><input type="checkbox" name="cash"' + (cashRoom ? " checked" : " disabled") + "> <span>Also record what I paid in Cash Book <small class=\"muted\" id=\"cash-amt\"></small>" +
      (cashRoom ? "" : '<small class="muted">The free Cash Book is full.</small>') + "</span></label>" +
      field("Note <i>(optional)</i>", '<input name="note" maxlength="200" value="' + esc(preset.note || "") + '" placeholder="Market Saturday, batch 12, dropped a crate">') +
      '<p class="muted small" id="after"></p>' +
      '<p class="err" id="err" role="alert" hidden></p>' +
      '<div class="dlg-actions"><button class="btn ghost" type="button" data-close="cancel">Cancel</button><button class="btn" value="ok">Save</button></div></form>');
    var f = $("form", dlg), err = $("#err", dlg);
    function k() { return f.querySelector('[name="kind"]:checked').value; }
    function sync() {
      var kk = k(), q = K.parseQty(f.qty.value);
      $$(".in-only", dlg).forEach(function (el) { el.hidden = kk !== "in"; });
      $("#q-label", dlg).textContent = kk === "count" ? "How many are there now?" : "How many" + (unit ? " (" + unit + ")" : "");
      var after = "";
      if (q !== null) {
        var to = kk === "count" ? q : K.r3(r.onHand + (K.KINDS[kk].sign * Math.abs(q)));
        after = "Leaves " + K.fmtQty(to) + (unit ? " " + unit : "") + (kk === "count" && to !== r.onHand ? " (" + (to > r.onHand ? "+" : "") + K.fmtQty(K.r3(to - r.onHand)) + " from the book)" : "") + ".";
      }
      $("#after", dlg).textContent = after;
      var c = Math.round(Math.abs(q || 0) * M.toCents(f.unitCost.value));
      $("#cash-amt", dlg).textContent = c ? "(" + fmt(c) + ")" : "";
    }
    $$('[name="kind"]', f).forEach(function (x) { x.addEventListener("change", function () { sync(); f.qty.focus(); }); });
    f.qty.addEventListener("input", sync);
    f.unitCost.addEventListener("input", sync);
    sync();
    f.addEventListener("submit", function (e) {
      if (!e.submitter || e.submitter.value !== "ok") return;
      var q = K.parseQty(f.qty.value);
      var msg = q === null ? "Please type how many, as a number." : (k() !== "count" && q === 0 ? "How many? Zero changes nothing." : (k() === "count" && q < 0 ? "A count can't be below zero." : ""));
      if (!msg && !K.validDate(f.date.value)) msg = "Please pick a date.";
      if (msg) { e.preventDefault(); err.hidden = false; err.textContent = msg; }
    });
    dlg.addEventListener("close", function () {
      if (dlg.returnValue !== "ok") return;
      var kk = k(), q = K.parseQty(f.qty.value), rec = { stockId: s.id, date: f.date.value, kind: kk, note: f.note.value.trim() };
      if (kk === "count") rec.counted = q; else rec.qty = K.KINDS[kk].sign * Math.abs(q);
      if (kk === "in") {
        rec.unitCost = Math.max(0, M.toCents(f.unitCost.value));
        var sup = f.supplier.value.trim();
        if (rec.unitCost !== (s.unitCost || 0) || sup !== (s.supplier || "")) {
          // The latest price paid becomes the cost each, so stock value stays current.
          put("stock", Object.assign({}, s, { unitCost: rec.unitCost || s.unitCost || 0, supplier: sup || s.supplier || "" }));
        }
        var total = Math.round(Math.abs(q) * rec.unitCost);
        if (f.cash.checked && total > 0) {
          var c = put("cash", { kind: "out", amount: total, date: rec.date, party: sup, category: s.kind === "supply" ? "supplies" : "cogs", method: "",
            note: "Stock: " + K.fmtQty(Math.abs(q)) + (unit ? " " + unit : "") + " " + s.name, fromStock: true });
          if (c) rec.cashId = c.id;
        }
      }
      var saved = put("stockMoves", rec);
      if (!saved) return;
      var now = book().lv[s.id];
      FM.toast(titles[kk] === "Count" ? "Counted. The book now says " + K.fmtQty(now.onHand) : "Saved. " + K.fmtQty(now.onHand) + (unit ? " " + unit : "") + " on hand" + (rec.cashId ? ", and added to Cash Book" : ""));
      route();
    });
    setTimeout(function () { f.qty.focus(); }, 30);
  }

  // ---------- one thing
  function renderThing(id) {
    var s = S.get("stock", id);
    if (!s) { app.innerHTML = head("stock", 0) + '<div class="wrap"><p class="none muted">That isn’t in your Stock Book any more. <a href="#">Back to your stock</a></p></div>'; return; }
    var b = book(), r = b.lv[s.id], today0 = today(), item = s.itemId && S.get("items", s.itemId);
    var pace = paceText(r, today0), perDay = K.dailyUse(r.history, today0);
    var docs = {};
    S.all("documents").forEach(function (d) { docs[d.id] = d; });
    var hist = r.history.slice().reverse();
    var facts = [
      ["Cost each", s.unitCost ? fmt(s.unitCost) : "Not set"],
      item && item.price ? ["Sells for", fmt(item.price) + (s.unitCost ? ' <small class="muted">(' + Math.round((item.price - s.unitCost) / item.price * 100) + "% margin)</small>" : "")] : null,
      ["Reorder at", K.hasLevel(s.reorderAt) ? K.fmtQty(s.reorderAt) + (s.reorderQty ? ", order " + K.fmtQty(s.reorderQty) : "") : "No alert set"],
      s.supplier ? ["Supplier", esc(s.supplier)] : null,
      s.location ? ["Kept", esc(s.location)] : null,
      s.sku ? ["SKU", esc(s.sku)] : null,
      perDay > 0 ? ["Pace", (perDay * 7 >= 1 ? K.fmtQty(Math.round(perDay * 7 * 10) / 10) : "Under 1") + " a week lately"] : null,
      ["Last counted", r.counted ? fmtDate(r.counted) : "Not yet"]
    ].filter(Boolean);
    var acts = (s.kind === "supply" ? [["in", "Received", ICON.truck], ["used", "Used", ICON.minus], ["count", "Count", ICON.list]] : [["in", "Received", ICON.truck], ["sold", "Sold", ICON.minus], ["made", "Made", ICON.plus], ["count", "Count", ICON.list]]);

    app.innerHTML = head("stock", lowCount(b)) + '<div class="wrap">' +
      '<a class="back no-print" href="#">' + ICON.back + "All stock</a>" +
      '<div class="thing-grid"><section class="card hero">' +
      '<div class="hero-top"><div><p class="eyebrow">' + (s.kind === "supply" ? "Supply" : "For sale") + (s.archived ? " · not tracked" : "") + "</p><h2>" + esc(s.name) + "</h2></div>" +
      '<button class="btn small ghost" data-act="edit">Edit</button></div>' +
      '<p class="big-qty"><b>' + K.fmtQty(r.onHand) + "</b> " + esc(s.unit || "on hand") + " " + statusPill(s, r) + "</p>" +
      '<p class="muted">' + (r.value ? "Worth " + fmt(r.value) + " at cost" : "") + (pace ? (r.value ? " · " : "") + pace : "") + "</p>" +
      (r.onHand < 0 ? '<p class="notice">' + ICON.warn + "The book says below zero, so a sale or use was recorded that wasn’t in stock. A quick count puts it right.</p>" : "") +
      '<div class="acts">' + acts.map(function (a, i) {
        return '<button class="btn' + (i ? " ghost" : "") + '" data-act="move" data-kind="' + a[0] + '" data-id="' + esc(s.id) + '">' + a[2] + a[1] + "</button>";
      }).join("") + "</div></section>" +
      '<section class="card facts"><dl>' + facts.map(function (x) { return "<div><dt>" + x[0] + "</dt><dd>" + x[1] + "</dd></div>"; }).join("") + "</dl>" +
      (s.notes ? '<p class="t-notes">' + esc(s.notes) + "</p>" : "") +
      (s.kind !== "supply" && !item ? '<p class="muted small">Invoice lines named exactly “' + esc(s.name) + "” take it out of stock.</p>" : "") + "</section></div>" +
      '<h3 class="sec hist-h">' + ICON.list + "History</h3>" +
      (hist.length ? '<ul class="hist">' + hist.map(function (h) {
        var d = h.docId && docs[h.docId];
        var what = h.fromInvoice
          ? '<a href="' + FM.link("invoices/#doc/" + encodeURIComponent(h.docId)) + '">' + ICON.doc + "Invoice " + esc(h.docNumber) + "</a>" + (h.customer ? '<span class="muted"> · ' + esc(h.customer) + "</span>" : "")
          : esc(h.kind === "count" && h.note === "Starting count" ? "" : h.note || "") + (h.cashId ? '<span class="muted">' + (h.note ? " · " : "") + "in Cash Book</span>" : "");
        var label = h.kind === "count" ? (h.note === "Starting count" ? "Starting count" : "Counted " + K.fmtQty(h.counted)) : kindWord(s, h.kind) + (h.kind === "in" && h.unitCost ? " at " + fmt(h.unitCost) : "");
        var ch = h.change ? (h.change > 0 ? "+" : "") + K.fmtQty(h.change) : "±0";
        return '<li class="h-row' + (d && d.status === "void" ? " void" : "") + '"><span class="h-date">' + esc(fmtDate(h.date, { month: "short", day: "numeric" })) + "<small>" + esc(h.date.slice(0, 4)) + "</small></span>" +
          '<span class="h-what"><b>' + esc(label) + "</b><small>" + what + "</small></span>" +
          '<span class="h-ch ' + (h.change > 0 ? "up" : h.change < 0 ? "down" : "") + '">' + ch + "<small>" + K.fmtQty(h.after) + " after</small></span>" +
          (h.fromInvoice ? '<span class="h-x"></span>' : '<button class="icon-btn h-x" data-act="del-move" data-id="' + esc(h.id) + '" aria-label="Delete this change">' + ICON.trash + "</button>") + "</li>";
      }).join("") + "</ul>" : '<p class="none muted">Nothing recorded yet. Count what you have to start.</p>') +
      "</div>";

    app.onclick = function (e) {
      if (commonClicks(e)) return;
      var b0 = e.target.closest("[data-act]");
      if (!b0) return;
      var act = b0.getAttribute("data-act");
      if (act === "edit") thingDialog(s);
      if (act === "del-move") {
        var m = S.get("stockMoves", b0.getAttribute("data-id"));
        if (!m) return;
        FM.confirm({ title: "Delete this change?", body: m.cashId && S.get("cash", m.cashId) ? "The level is worked out again without it. Its Cash Book entry is deleted too." : "The level is worked out again without it.", ok: "Delete", danger: true }).then(function (yes) {
          if (!yes) return;
          if (m.cashId) S.remove("cash", m.cashId);
          S.remove("stockMoves", m.id);
          FM.toast("Deleted");
          route();
        });
      }
    };
  }

  // ---------- stock take
  function renderCount() {
    var b = book(), list = active();
    var groups = {}, order = [];
    list.forEach(function (s) {
      var k = (s.location || "").trim();
      if (!groups[k]) { groups[k] = []; order.push(k); }
      groups[k].push(s);
    });
    order.sort(function (a, c) { return (!a) - (!c) || a.localeCompare(c); });
    var p = S.profile();
    app.innerHTML = head("count", lowCount(b)) + '<div class="wrap">' +
      (list.length ? '<form id="count-form" class="count-form" autocomplete="off">' +
        '<div class="count-bar no-print"><p class="muted">Type what you find on the shelf. Leave a box empty to skip it. The book is corrected to your count.</p>' +
        '<label class="mini-field"><span>Counted on</span><input type="date" name="date" value="' + today() + '" required></label>' +
        '<button class="btn ghost" type="button" data-act="print">' + ICON.print + "Print a count sheet</button></div>" +
        '<div class="print-only count-head"><h2>Stock count</h2><p>' + esc(p.name || "") + " · Counted on ____________ by ____________</p></div>" +
        order.map(function (k) {
          return '<section class="count-group"><h3 class="sec">' + ICON.box + (k ? esc(k) : (order.length > 1 ? "Everything else" : "Everything")) + "</h3>" +
            '<table class="count-table"><thead><tr><th scope="col">Name</th><th scope="col">The book says</th><th scope="col">Counted</th><th scope="col" class="no-print">Difference</th></tr></thead><tbody>' +
            groups[k].map(function (s) {
              var r = b.lv[s.id];
              return '<tr data-id="' + esc(s.id) + '"><th scope="row">' + esc(s.name) + (s.sku ? ' <small class="muted">' + esc(s.sku) + "</small>" : "") + "</th>" +
                "<td>" + K.fmtQty(r.onHand) + (s.unit ? ' <small class="muted">' + esc(s.unit) + "</small>" : "") + "</td>" +
                '<td><label class="sr" for="c-' + esc(s.id) + '">Counted ' + esc(s.name) + '</label><input class="count-in" id="c-' + esc(s.id) + '" name="c-' + esc(s.id) + '" inputmode="decimal" data-book="' + r.onHand + '"><span class="print-box"></span></td>' +
                '<td class="diff no-print" aria-live="polite"></td></tr>';
            }).join("") + "</tbody></table></section>";
        }).join("") +
        '<div class="count-save no-print"><p id="count-sum" class="muted">Nothing counted yet.</p><button class="btn" type="submit">' + ICON.check + "Save the count</button></div></form>"
        : '<p class="none muted">Add the things you stock first, then come back to count them. <a href="#">Go to your stock</a></p>') + "</div>";

    var form = $("#count-form");
    app.onclick = function (e) { commonClicks(e); };
    if (!form) return;
    function sum() {
      var n = 0, off = 0;
      $$(".count-in", form).forEach(function (inp) {
        var cell = inp.closest("tr").querySelector(".diff"), v = inp.value.trim(), q = K.parseQty(v), bk = +inp.getAttribute("data-book");
        inp.classList.toggle("bad", !!v && (q === null || q < 0));
        if (!v || q === null || q < 0) { cell.textContent = v ? "Not a number" : ""; cell.className = "diff no-print"; return; }
        n++;
        var d = K.r3(q - bk);
        if (d) off++;
        cell.textContent = d ? (d > 0 ? "+" : "") + K.fmtQty(d) : "Matches";
        cell.className = "diff no-print " + (d > 0 ? "up" : d < 0 ? "down" : "ok");
      });
      $("#count-sum").textContent = n ? n + " counted" + (off ? ", " + off + " different from the book" : ", all match the book") : "Nothing counted yet.";
    }
    form.addEventListener("input", sum);
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      if (!K.validDate(form.date.value)) { FM.toast("Pick the date you counted"); return; }
      var stamp = new Date().toISOString(), moves = S.all("stockMoves"), n = 0, skipped = 0;
      $$(".count-in", form).forEach(function (inp) {
        var v = inp.value.trim(), q = K.parseQty(v);
        if (!v) return;
        if (q === null || q < 0) { skipped++; return; }
        moves.push({ id: S.uid(), stockId: inp.closest("tr").getAttribute("data-id"), date: form.date.value, kind: "count", counted: q, note: "Stock take", createdAt: stamp, updatedAt: stamp });
        n++;
      });
      if (!n) { FM.toast(skipped ? "Those counts weren’t numbers" : "Type at least one count"); return; }
      try { S.raw.write("stockMoves", moves); } catch (err) { FM.toast(err.message); return; }
      FM.toast("Saved " + n + " count" + (n === 1 ? "" : "s") + (skipped ? ". " + skipped + " weren’t numbers and were skipped" : ""));
      go("#");
    });
  }

  // ---------- reorder
  function renderReorder() {
    var b = book(), list = active(), groups = K.reorderList(list, b.lv), p = S.profile();
    var noLevel = list.filter(function (s) { return !K.hasLevel(s.reorderAt); });
    var outNoLevel = noLevel.filter(function (s) { return K.isOut(b.lv[s.id].onHand); });
    var total = groups.reduce(function (a, g) { return a + g.cost; }, 0);
    app.innerHTML = head("reorder", lowCount(b)) + '<div class="wrap">' +
      (groups.length
        ? '<div class="re-bar no-print"><p class="muted">' + groups.reduce(function (a, g) { return a + g.lines.length; }, 0) + " thing" + (groups.length === 1 && groups[0].lines.length === 1 ? " is" : "s are") + " at or under the level you set" +
          (total ? ". About " + fmt(total) + " to restock at your last prices." : ".") + '</p><button class="btn ghost" data-act="print">' + ICON.print + "Print</button></div>" +
          '<div class="print-only"><h2>Reorder list</h2><p>' + esc(p.name || "") + " · " + esc(fmtDate(today())) + "</p></div>" +
          '<div class="orders">' + groups.map(function (g, gi) {
            return '<section class="card order" data-g="' + gi + '"><div class="order-top"><h3>' + (g.supplier ? esc(g.supplier) : "No supplier set") + "</h3>" +
              (g.cost ? '<span class="muted">about ' + fmt(g.cost) + "</span>" : "") + "</div>" +
              '<table class="re-table"><thead><tr><th scope="col">Order</th><th scope="col">Have</th><th scope="col">Est. cost</th></tr></thead><tbody>' +
              g.lines.map(function (l) {
                return "<tr><td><b>" + qtyUnit(l.qty, l.unit) + "</b> " + '<a href="#s/' + encodeURIComponent(l.id) + '">' + esc(l.name) + "</a>" + (l.sku ? ' <small class="muted">' + esc(l.sku) + "</small>" : "") + "</td>" +
                  '<td class="' + (l.onHand <= 0 ? "down" : "") + '">' + K.fmtQty(l.onHand) + '<small class="muted"> / ' + K.fmtQty(l.reorderAt) + "</small></td>" +
                  "<td>" + (l.cost ? fmt(l.cost) : "—") + "</td></tr>";
              }).join("") + "</tbody></table>" +
              '<div class="order-acts no-print"><button class="btn small ghost" data-act="copy" data-g="' + gi + '">' + ICON.copy + "Copy order</button>" +
              '<a class="btn small ghost" href="mailto:?subject=' + encodeURIComponent("Order from " + (p.name || "us")) + "&body=" + encodeURIComponent(K.orderText(g, p.name)) + '">' + ICON.mail + "Email it</a>" +
              '<button class="btn small" data-act="received" data-g="' + gi + '">' + ICON.truck + "It arrived</button></div></section>";
          }).join("") + "</div>"
        : '<section class="card empty-card"><h2>Nothing to reorder</h2><p class="muted">' +
          (list.length ? "Everything with a reorder level is above it." : "Add the things you stock, then set a reorder level on each.") + "</p></section>") +
      (outNoLevel.length ? '<p class="notice blue re-note">' + outNoLevel.map(function (s) { return '<a href="#s/' + encodeURIComponent(s.id) + '">' + esc(s.name) + "</a>"; }).join(", ") +
        (outNoLevel.length === 1 ? " is" : " are") + " out but ha" + (outNoLevel.length === 1 ? "s" : "ve") + " no reorder level, so " + (outNoLevel.length === 1 ? "it isn’t" : "they aren’t") + " listed above.</p>" : "") +
      (noLevel.length && list.length ? '<p class="muted small center no-print">' + noLevel.length + " of " + list.length + " have no reorder level. Set one with Edit on each.</p>" : "") +
      "</div>";

    app.onclick = function (e) {
      if (commonClicks(e)) return;
      var b0 = e.target.closest("[data-act]");
      if (!b0) return;
      var g = groups[+b0.getAttribute("data-g")];
      if (!g) return;
      if (b0.getAttribute("data-act") === "copy") copyText(K.orderText(g, p.name));
      if (b0.getAttribute("data-act") === "received") receivedOrder(g);
    };
  }

  function copyText(text) {
    function fallback() {
      var t = document.createElement("textarea");
      t.value = text; t.setAttribute("readonly", ""); t.style.position = "fixed"; t.style.opacity = "0";
      document.body.appendChild(t); t.select();
      var ok = false;
      try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
      t.remove();
      FM.toast(ok ? "Order copied. Paste it into an email or text" : "Couldn’t copy. Use Email it instead");
    }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(function () { FM.toast("Order copied. Paste it into an email or text"); }, fallback);
    else fallback();
  }

  // Records a whole order as received in one go, with a chance to fix amounts first.
  function receivedOrder(g) {
    var cashRoom = L.canAdd("cash", S.count("cash")).allowed;
    var dlg = openDialog('<form method="dialog" class="dlg-body" autocomplete="off"><h3>What arrived' + (g.supplier ? " from " + esc(g.supplier) : "") + "?</h3>" +
      '<p class="muted small">Fix any amount that differs from the order. Leave it at 0 for anything that didn’t come.</p>' +
      '<table class="re-table recv"><thead><tr><th scope="col">Item</th><th scope="col">Arrived</th><th scope="col">Cost each</th></tr></thead><tbody>' +
      g.lines.map(function (l, i) {
        return "<tr><td>" + esc(l.name) + "</td>" +
          '<td><label class="sr" for="rq' + i + '">How many ' + esc(l.name) + ' arrived</label><input id="rq' + i + '" name="q' + i + '" inputmode="decimal" value="' + K.fmtQty(l.qty).replace("−", "-") + '"></td>' +
          '<td><label class="sr" for="rc' + i + '">Cost each for ' + esc(l.name) + '</label><input id="rc' + i + '" name="c' + i + '" inputmode="decimal" value="' + esc(money2(l.unitCost)) + '" placeholder="0.00"></td></tr>';
      }).join("") + "</tbody></table>" +
      '<div class="grid-2">' + field("Date", '<input type="date" name="date" value="' + today() + '" required>') + "</div>" +
      '<label class="check"><input type="checkbox" name="cash"' + (cashRoom ? " checked" : " disabled") + '> <span>Also record what I paid in Cash Book <small class="muted" id="cash-amt"></small>' + (cashRoom ? "" : '<small class="muted">The free Cash Book is full.</small>') + "</span></label>" +
      '<p class="err" id="err" role="alert" hidden></p>' +
      '<div class="dlg-actions"><button class="btn ghost" type="button" data-close="cancel">Cancel</button><button class="btn" value="ok">Add to stock</button></div></form>');
    var f = $("form", dlg);
    function rows() {
      return g.lines.map(function (l, i) { return { l: l, q: K.parseQty(f["q" + i].value), c: Math.max(0, M.toCents(f["c" + i].value)) }; });
    }
    function sync() {
      var t = rows().reduce(function (a, x) { return a + (x.q > 0 ? Math.round(x.q * x.c) : 0); }, 0);
      $("#cash-amt", dlg).textContent = t ? "(" + fmt(t) + ")" : "";
    }
    f.addEventListener("input", sync);
    sync();
    f.addEventListener("submit", function (e) {
      if (!e.submitter || e.submitter.value !== "ok") return;
      var bad = rows().some(function (x) { return x.q === null || x.q < 0; });
      if (bad || !K.validDate(f.date.value)) { e.preventDefault(); var er = $("#err", dlg); er.hidden = false; er.textContent = bad ? "Please use a number for each amount (0 if it didn’t come)." : "Please pick a date."; }
    });
    dlg.addEventListener("close", function () {
      if (dlg.returnValue !== "ok") return;
      var got = rows().filter(function (x) { return x.q > 0; });
      if (!got.length) { FM.toast("Nothing recorded"); return; }
      var date = f.date.value, total = 0, stamp = new Date().toISOString();
      var moves = S.all("stockMoves");
      got.forEach(function (x) {
        total += Math.round(x.q * x.c);
        moves.push({ id: S.uid(), stockId: x.l.id, date: date, kind: "in", qty: x.q, unitCost: x.c, note: g.supplier ? "From " + g.supplier : "", createdAt: stamp, updatedAt: stamp });
      });
      var cashId = "";
      if (f.cash.checked && total > 0) {
        var anySupply = got.some(function (x) { var s = S.get("stock", x.l.id); return s && s.kind === "supply"; });
        var allSupply = got.every(function (x) { var s = S.get("stock", x.l.id); return s && s.kind === "supply"; });
        var c = put("cash", { kind: "out", amount: total, date: date, party: g.supplier, category: allSupply ? "supplies" : "cogs", method: "",
          note: "Stock: " + got.map(function (x) { return K.fmtQty(x.q) + " " + x.l.name; }).join(", ") + (anySupply && !allSupply ? " (includes supplies)" : ""), fromStock: true });
        if (c) cashId = c.id;
      }
      // One Cash Book entry covers the order; it hangs off the first line so deleting that
      // line offers to remove it.
      if (cashId) moves[moves.length - got.length].cashId = cashId;
      try { S.raw.write("stockMoves", moves); } catch (err) { FM.toast(err.message); return; }
      // The latest price paid becomes the cost each; only records whose price changed are rewritten.
      got.forEach(function (x) {
        var s = S.get("stock", x.l.id);
        if (s && x.c && s.unitCost !== x.c) put("stock", Object.assign({}, s, { unitCost: x.c }));
      });
      FM.toast("Added " + got.length + " to stock" + (cashId ? " and " + fmt(total) + " to Cash Book" : ""));
      route();
    });
    setTimeout(function () { f.q0.focus(); f.q0.select(); }, 30);
  }

  // ---------- value on a date
  function renderValue() {
    var t = today(), y = +t.slice(0, 4);
    var asOf = K.validDate(ui.asOf) ? ui.asOf : t;
    var b = book(asOf === t ? "" : asOf);
    var rows = b.stock.filter(function (s) {
      var r = b.lv[s.id];
      return !s.archived || r.onHand > 0;
    }).sort(byName);
    var total = K.totalValue(rows, b.lv), p = S.profile();
    var missing = rows.filter(function (s) { return b.lv[s.id].onHand > 0 && !b.lv[s.id].unitCost; });
    var quick = [[t, "Today"], [(y - 1) + "-12-31", "End of " + (y - 1)], [y + "-01-01", "Start of " + y]];
    app.innerHTML = head("value", lowCount(book())) + '<div class="wrap">' +
      '<div class="val-bar no-print"><label class="mini-field"><span>Value on</span><input type="date" id="as-of" value="' + asOf + '" max="' + t + '"></label>' +
      '<div class="chips" role="group" aria-label="Quick dates">' + quick.map(function (q) {
        return '<button class="chip" data-act="as-of" data-d="' + q[0] + '" aria-pressed="' + (q[0] === asOf) + '">' + q[1] + "</button>";
      }).join("") + "</div>" +
      '<span class="grow"></span><button class="btn ghost" data-act="print">' + ICON.print + "Print</button>" +
      '<button class="btn ghost" data-act="csv">' + ICON.down + "Spreadsheet" + (L.isPro() ? "" : ' <span class="pill gold">Pro</span>') + "</button></div>" +
      '<section class="card val-sheet"><div class="val-head"><div><p class="eyebrow">Stock on hand</p><h2>' + esc(fmtDate(asOf, { month: "long", day: "numeric", year: "numeric" })) + "</h2>" +
      (p.name ? '<p class="muted">' + esc(p.name) + "</p>" : "") + '</div><div class="val-total"><span class="muted">Value at cost</span><b>' + fmt(total) + "</b></div></div>" +
      (rows.length ? '<table class="val-table"><thead><tr><th scope="col">Name</th><th scope="col">On hand</th><th scope="col">Cost each</th><th scope="col">Value</th></tr></thead><tbody>' +
        rows.map(function (s) {
          var r = b.lv[s.id];
          return '<tr><th scope="row">' + esc(s.name) + (s.kind === "supply" ? ' <small class="muted">supply</small>' : "") + "</th>" +
            "<td>" + K.fmtQty(r.onHand) + (s.unit ? ' <small class="muted">' + esc(s.unit) + "</small>" : "") + "</td>" +
            "<td>" + (r.unitCost ? fmt(r.unitCost) : '<span class="muted">not set</span>') + "</td><td>" + fmt(r.value) + "</td></tr>";
        }).join("") + '</tbody><tfoot><tr><td colspan="3">Total</td><td>' + fmt(total) + "</td></tr></tfoot></table>"
        : '<p class="none muted">Nothing was in stock on that date.</p>') +
      (missing.length ? '<p class="notice val-miss">' + missing.length + " thing" + (missing.length === 1 ? " has" : "s have") + " no cost set, so " + (missing.length === 1 ? "it counts" : "they count") + " as nothing here. Add a cost with Edit.</p>" : "") +
      '<p class="muted small val-foot">Counts are rebuilt from your history up to the end of that day, valued at the last price you paid by then. For a sole proprietor, the stock you sell at the start and end of the year goes on Schedule C, Part III (lines 35 and 41). Supplies you use up are usually an expense, not inventory. Ask your tax preparer which method fits your business; this is arithmetic, not tax advice.</p>' +
      "</section></div>";

    $("#as-of").addEventListener("change", function (e) { ui.asOf = e.target.value; renderValue(); });
    app.onclick = function (e) {
      if (commonClicks(e)) return;
      var b0 = e.target.closest("[data-act]");
      if (!b0) return;
      var act = b0.getAttribute("data-act");
      if (act === "as-of") { ui.asOf = b0.getAttribute("data-d"); renderValue(); }
      if (act === "csv") {
        if (!L.isPro()) { limitDialog("csv"); return; }
        download("stock-value-" + asOf + ".csv", "text/csv", K.csv(rows.map(function (s) {
          var r = b.lv[s.id];
          return { name: s.name, kind: s.kind, sku: s.sku, unit: s.unit, onHand: r.onHand, unitCost: r.unitCost, value: r.value, supplier: s.supplier, location: s.location };
        }), asOf));
      }
    };
  }

  // ---------- settings
  function settingsDialog() {
    var st = settings();
    var dlg = openDialog('<form method="dialog" class="dlg-body"><h3>Stock Book settings</h3>' +
      '<label class="check top"><input type="checkbox" name="fromInvoices"' + (st.fromInvoices ? " checked" : "") + "> <span>Take things on sent and paid invoices out of stock" +
      '<small class="muted">An invoice line takes stock when its description matches a stocked thing’s name, or the saved item it is linked to. Drafts, quotes and void invoices never do. Turn this off if you record sales here by hand instead.</small></span></label>' +
      '<div class="dlg-actions"><button class="btn ghost" type="button" data-close="cancel">Cancel</button><button class="btn" value="ok">Save</button></div></form>');
    dlg.addEventListener("close", function () {
      if (dlg.returnValue !== "ok") return;
      saveSettings({ fromInvoices: $('[name="fromInvoices"]', dlg).checked });
      FM.toast("Saved");
      route();
    });
  }

  function startArt() {
    return '<svg class="art" viewBox="0 0 200 140" aria-hidden="true">' +
      '<ellipse cx="100" cy="126" rx="78" ry="8" fill="#f3eee5"/>' +
      '<path d="M28 118h144M28 76h144" stroke="#9c7630" stroke-width="4" stroke-linecap="round"/>' +
      '<path d="M34 76v42M166 76v42" stroke="#9c7630" stroke-width="3" stroke-linecap="round" opacity=".6"/>' +
      '<rect x="44" y="44" width="30" height="32" rx="5" fill="#e5ebf2" stroke="#3d5876" stroke-width="2.5"/>' +
      '<path d="M44 54h30" stroke="#3d5876" stroke-width="2.5"/>' +
      '<rect x="82" y="36" width="34" height="40" rx="6" fill="#f5ead0" stroke="#9c7630" stroke-width="2.5"/>' +
      '<path d="M90 50h18M90 58h12" stroke="#9c7630" stroke-width="2.5" stroke-linecap="round"/>' +
      '<path d="M126 76V50l12-8 12 8v26z" fill="#e4ecdf" stroke="#4d6d51" stroke-width="2.5" stroke-linejoin="round"/>' +
      '<rect x="50" y="92" width="44" height="26" rx="4" fill="#fffdf9" stroke="#3d5876" stroke-width="2.5"/>' +
      '<path d="M50 100h44M72 92v8" stroke="#3d5876" stroke-width="2.5"/>' +
      '<rect x="104" y="98" width="24" height="20" rx="4" fill="#fffdf9" stroke="#9c7630" stroke-width="2.5"/>' +
      '<rect x="134" y="98" width="24" height="20" rx="4" fill="#fffdf9" stroke="#9c7630" stroke-width="2.5"/></svg>';
  }

  document.addEventListener("DOMContentLoaded", function () {
    app = document.getElementById("app");
    window.addEventListener("hashchange", route);
    // Another tab changed stock, invoices or items: refresh, unless a dialog is open.
    S.onChange(function (key, external) {
      if (!external || document.querySelector("dialog[open]")) return;
      if (key === "stock" || key === "stockMoves" || key === "documents" || key === "items" || key === "profile" || key === "*") route();
    });
    route();
  });
})();
