/* Price Builder.
   Routes (in the address hash): list "", "#new", "#new?kind=service", "#p/<id>".
   A saved price lives in the shared "costings" collection; "Save to my items" puts the
   price on the shared items list that Quotes & Invoices reads. Saved as you type. */
(function () {
  "use strict";
  var FM = window.FM, S = FM.store, P = window.FMPrice, M = FM.money, L = FM.license, esc = FM.esc;
  var app;
  var draft = null;
  var saveTimer = null;

  var ICON = {
    plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
    back: '<svg viewBox="0 0 24 24"><path d="M15 6l-6 6 6 6"/></svg>',
    x: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    copy: '<svg viewBox="0 0 24 24"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/></svg>',
    trash: '<svg viewBox="0 0 24 24"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>',
    star: '<svg viewBox="0 0 24 24"><path d="M12 4l2.4 5 5.4.6-4 3.7 1.1 5.3L12 16l-4.9 2.6 1.1-5.3-4-3.7 5.4-.6z"/></svg>',
    quote: '<svg viewBox="0 0 24 24"><path d="M7 3h8l4 4v14H7z"/><path d="M15 3v4h4M10 12h6M10 16h6"/></svg>',
    jar: '<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M22 10h20v7l5 6v29a4 4 0 0 1-4 4H21a4 4 0 0 1-4-4V23l5-6z"/><path d="M22 17h20M17 32h30M25 42h14"/></svg>',
    hand: '<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M14 36l10-10c3-3 7-3 10 0l2 2h10c3 0 5 2 5 5"/><path d="M8 40l10 14h18l14-12c2-2 2-5 0-6-2-2-4-1-6 0l-8 6H30"/></svg>'
  };

  // Fees people commonly pay. Rates change, so the hint asks them to check their own.
  var FEES = [
    ["none", "None", 0, 0],
    ["reader", "Card reader, about 2.6% + 15¢", 2.6, 15],
    ["online", "Online checkout, about 2.9% + 30¢", 2.9, 30]
  ];
  var ROUNDS = [[1, "Exact cent"], [5, "5¢"], [25, "25¢"], [100, "$1"], [500, "$5"]];

  // ---------- helpers
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function fmt(c) { var p = S.profile(); return M.format(Math.round(c || 0), p.currency, p.locale || undefined); }
  function money(c) { return c ? M.plain(c) : ""; }
  function pct(v) { return (Math.round(v * 10) / 10).toLocaleString(undefined, { maximumFractionDigits: 1 }) + "%"; }
  function field(label, control, cls) { return '<label class="field' + (cls ? " " + cls : "") + '"><span>' + label + "</span>" + control + "</label>"; }
  function go(hash) { if (location.hash === hash) route(); else location.hash = hash; }
  function per(d) {
    var u = (d.unit || "").trim();
    if (!u || u === "each") return "each";
    return "per " + u;
  }
  function trim(n) { return n === "" || n == null ? "" : String(Math.round(n * 100) / 100); }
  // Accepts "1.5", "1:30" or "90m".
  function parseHours(s) {
    s = String(s || "").trim().toLowerCase();
    var hm = s.match(/^(\d+):(\d{1,2})$/);
    if (hm) return +hm[1] + +hm[2] / 60;
    var m = s.match(/^(\d+(?:\.\d+)?)\s*m(in)?s?$/);
    if (m) return +m[1] / 60;
    var n = parseFloat(s);
    return isFinite(n) && n > 0 ? n : 0;
  }

  // Last-used rates live on the shared profile, so they ride along in the backup file.
  function defaults() {
    var d = S.profile().pricing || {};
    return {
      wage: d.wage == null ? 2500 : d.wage,
      overheadRate: d.overheadRate || 0,
      feePercent: d.feePercent || 0, feeFixed: d.feeFixed || 0,
      margin: d.margin == null ? 20 : d.margin,
      roundTo: d.roundTo || 25
    };
  }
  function rememberDefaults() {
    var me = (draft.labor || [])[0];
    S.saveProfile({ pricing: {
      wage: me && me.rate ? me.rate : defaults().wage,
      overheadRate: draft.overheadRate, feePercent: draft.feePercent, feeFixed: draft.feeFixed,
      margin: draft.margin, roundTo: draft.roundTo
    } });
  }

  function limitDialog(col) {
    var names = { costings: "prices", items: "items" };
    return FM.confirm({
      title: "You've reached the free limit",
      body: "The free version keeps up to " + L.limits[col] + " saved " + names[col] + ". Pro removes every limit for a one-time " + L.config.price + ". You can also delete old ones to make room.",
      ok: "See Pro", cancel: "Not now"
    }).then(function (yes) { if (yes) location.href = FM.link("settings/#pro"); return false; });
  }
  function canAdd(col) {
    return L.canAdd(col, S.count(col)).allowed ? Promise.resolve(true) : limitDialog(col);
  }

  // ---------- routing
  function route() {
    flushSave();
    var h = location.hash.replace(/^#/, "");
    var params = {};
    var q = h.indexOf("?");
    if (q >= 0) { h.slice(q + 1).split("&").forEach(function (kv) { var p = kv.split("="); params[p[0]] = decodeURIComponent(p[1] || ""); }); h = h.slice(0, q); }
    window.scrollTo(0, 0);
    if (h === "new") return startNew(params.kind === "service" ? "service" : "product");
    if (h.indexOf("p/") === 0) return open(h.slice(2));
    draft = null;
    renderList();
  }

  // ---------- list
  function renderList() {
    var list = S.all("costings").sort(function (a, b) { return (b.updatedAt || "").localeCompare(a.updatedAt || ""); });
    var rows = list.map(function (c) {
      var r = P.compute(c);
      var tone = r.price <= 0 ? "" : r.profit < 0 ? "rose" : r.margin + 0.05 >= (parseFloat(c.margin) || 0) ? "green" : "gold";
      var linked = c.itemId && S.get("items", c.itemId);
      return '<a class="price-row" href="#p/' + esc(c.id) + '">' +
        '<span class="pr-name"><b>' + esc(c.name || "Untitled") + "</b><small>" +
        (c.kind === "service" ? "Service" : "Product") + " · costs " + fmt(r.unit.cost) + " " + esc(per(c)) + "</small></span>" +
        '<span class="pr-price">' + (r.price ? fmt(r.price) + ' <small class="muted">' + esc(per(c)) + "</small>" : '<span class="muted">No price yet</span>') + "</span>" +
        '<span class="pr-tags">' + (r.price ? '<span class="pill ' + tone + '">' + pct(r.margin) + " margin</span>" : "") +
        (linked ? '<span class="pill blue">In my items</span>' : "") + "</span></a>";
    }).join("");

    var body = list.length
      ? '<div class="list-bar"><p class="muted">Each price shows what it costs you and what you keep. Open one to change it.</p>' +
        '<div class="new-btns"><a class="btn" href="#new">' + ICON.plus + 'Price a product</a><a class="btn ghost" href="#new?kind=service">Price a service</a></div></div>' +
        '<div class="price-list">' + rows + "</div>" + limitNote()
      : '<div class="welcome">' +
        '<div class="welcome-copy"><p class="eyebrow">What should I charge?</p><h2>Find a price that is fair to your customers and to you</h2>' +
        '<p class="muted">Add what goes into it, the time it takes and a fair wage for that time. Price Builder adds your running costs and any card fees, then shows the price that covers it all with something left over to keep the business healthy.</p></div>' +
        '<div class="starts">' +
        '<a class="start" href="#new">' + ICON.jar + "<b>A product</b><span>Something you make or sell: loaves, candles, furniture, prints.</span></a>" +
        '<a class="start" href="#new?kind=service">' + ICON.hand + "<b>A service or job</b><span>Work you do for someone: a repair, a cleaning, a lesson, an hour of your time.</span></a>" +
        "</div></div>" +
        '<ol class="how"><li><b>Count what goes in</b><span>Materials, time, and the running costs of being open. Your usual rates are remembered for next time.</span></li>' +
        '<li><b>Pay a fair wage</b><span>Your time is costed like any worker\'s, so profit is truly extra, not your pay in disguise.</span></li>' +
        '<li><b>Use it on quotes</b><span>Save the price to your items and pick it on any quote or invoice in one tap.</span></li></ol>';

    app.innerHTML = head() + '<div class="wrap">' + body + "</div>";
  }
  function head() {
    return '<div class="wrap app-head no-print"><div class="app-title"><h1>Price Builder</h1>' + (L.isPro() ? '<span class="fm-pro-chip">Pro</span>' : "") + "</div>" +
      '<a class="btn small ghost" href="' + FM.link("invoices/#items") + '">My items</a></div>';
  }
  function limitNote() {
    if (L.isPro()) return "";
    var used = S.count("costings"), lim = L.limits.costings;
    if (used < lim - 2) return "";
    return '<p class="limit-note muted">' + used + " of " + lim + ' free saved prices used. <a href="' + FM.link("settings/#pro") + '">Pro</a> removes the limit.</p>';
  }

  // ---------- new / open
  function line(kind, extra) {
    return Object.assign(kind === "labor" ? { id: S.uid(), name: "", hours: "", rate: defaults().wage } : { id: S.uid(), name: "", qty: 1, cost: 0 }, extra || {});
  }
  function blank(kind) {
    var d = defaults();
    var svc = kind === "service";
    return {
      name: "", kind: kind, unit: svc ? "job" : "each", yield: 1,
      materials: [line("materials")], wastePercent: "",
      labor: [line("labor", { name: "Your time" })],
      overheadRate: d.overheadRate, extraCost: 0,
      feePercent: d.feePercent, feeFixed: d.feeFixed,
      margin: d.margin, roundTo: svc && d.roundTo < 100 ? 100 : d.roundTo,
      price: 0, taxable: !svc,
      wholesale: { on: false, margin: 15, storeMarkup: 2 },
      itemId: null, notes: ""
    };
  }
  function startNew(kind) {
    canAdd("costings").then(function (ok) {
      if (!ok) { history.replaceState(null, "", "#"); renderList(); return; }
      draft = blank(kind);
      renderEditor();
      var n = $('[data-f="name"]', app);
      if (n) n.focus();
    });
  }
  function open(id) {
    var c = S.get("costings", id);
    if (!c) { FM.toast("That price isn't on this device"); go(""); return; }
    draft = JSON.parse(JSON.stringify(c));
    if (!draft.wholesale) draft.wholesale = { on: false, margin: 15, storeMarkup: 2 };
    renderEditor();
  }

  // ---------- saving
  function hasContent(d) {
    return !!(d.name || (d.materials || []).some(function (m) { return m.name || m.cost; }) || (d.labor || []).some(function (l) { return parseFloat(l.hours); }));
  }
  function scheduleSave() { clearTimeout(saveTimer); setSaved("Saving…"); saveTimer = setTimeout(saveNow, 500); }
  function flushSave() { if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; saveNow(); } }
  function saveNow() {
    saveTimer = null;
    if (!draft) return;
    if (!draft.id && !hasContent(draft)) { setSaved(""); return; }
    if (!draft.id && !L.canAdd("costings", S.count("costings")).allowed) { setSaved("Not saved: free limit reached"); return; }
    try {
      var saved = S.put("costings", draft);
      draft.id = saved.id; draft.createdAt = saved.createdAt; draft.updatedAt = saved.updatedAt;
      if (location.hash !== "#p/" + saved.id) history.replaceState(null, "", "#p/" + saved.id);
      rememberDefaults();
      setSaved("Saved");
    } catch (e) { setSaved(""); FM.toast(e.message); }
  }
  function setSaved(t) { var el = $("#saved", app); if (el) el.textContent = t; }
  window.addEventListener("pagehide", flushSave);

  // ---------- editor
  function renderEditor() {
    var d = draft, svc = d.kind === "service";
    app.innerHTML =
      '<div class="wrap ed-head no-print">' +
      '<a class="back" href="#">' + ICON.back + "All prices</a>" +
      '<div class="ed-title"><h1>' + (d.name ? esc(d.name) : svc ? "Price a service" : "Price a product") + "</h1>" +
      '<span class="saved muted" id="saved" aria-live="polite">' + (d.id ? "Saved" : "") + "</span></div></div>" +

      '<div class="wrap pb-grid">' +
      '<form class="pb-form" autocomplete="off" novalidate>' +

      '<section class="card"><h2 class="sec"><span class="step">1</span>What are you pricing?</h2>' +
      '<div class="kind seg" role="group" aria-label="Kind">' +
      '<button type="button" data-kind="product" aria-pressed="' + !svc + '">A product</button>' +
      '<button type="button" data-kind="service" aria-pressed="' + svc + '">A service or job</button></div>' +
      field("Name", '<input data-f="name" value="' + esc(d.name) + '" placeholder="' + (svc ? "e.g. Gutter cleaning, two-story house" : "e.g. Sourdough loaf") + '">') +
      (svc
        ? field("You charge per", '<input data-f="unit" value="' + esc(d.unit) + '" placeholder="job, hour, visit…">', "short")
        : '<div class="batch"><span>One batch makes</span><input data-f="yield" data-t="num" inputmode="decimal" aria-label="How many one batch makes" value="' + esc(trim(d.yield)) + '">' +
          '<input data-f="unit" aria-label="Unit" value="' + esc(d.unit) + '" placeholder="each, dozen, jar…"></div>' +
          '<p class="hint muted">Making one at a time? Leave it at 1. Baking 24 cookies at once? Enter 24 and cost the whole batch below.</p>') +
      "</section>" +

      '<section class="card"><h2 class="sec"><span class="step">2</span>Materials and supplies</h2>' +
      '<p class="hint muted">Everything used up' + (svc ? " on the job" : " in the batch") + ", including packaging. Enter how much you use and what one unit of it costs you.</p>" +
      '<div class="lines" id="materials">' + d.materials.map(materialRow).join("") + "</div>" +
      '<button type="button" class="btn small ghost add" data-act="add-material">' + ICON.plus + "Add a material</button>" +
      field("Waste and spoilage <i>(optional)</i>", '<span class="suffix"><input data-f="wastePercent" data-t="num" inputmode="decimal" value="' + esc(trim(d.wastePercent)) + '" placeholder="0"><em>%</em></span>', "short") +
      "</section>" +

      '<section class="card"><h2 class="sec"><span class="step">3</span>Time and a fair wage</h2>' +
      '<p class="hint muted">Count every hour' + (svc ? ", travel and setup too" : ", prep and cleanup too") + '. Type 1.5, 1:30 or 90m. Pay yourself what you would have to pay a skilled person to do this work; a just wage is a cost of the business, not something you hope is left over. <a href="https://livingwage.mit.edu/" target="_blank" rel="noopener">Living wages in your area</a>.</p>' +
      '<div class="lines" id="labor">' + d.labor.map(laborRow).join("") + "</div>" +
      '<button type="button" class="btn small ghost add" data-act="add-labor">' + ICON.plus + "Add a helper</button>" +
      "</section>" +

      '<section class="card"><h2 class="sec"><span class="step">4</span>Running costs</h2>' +
      '<p class="hint muted">Rent, insurance, tools, phone, vehicle: the costs of being open. Spread over your working hours, they become a small charge on every hour of work.</p>' +
      '<div class="grid-2">' +
      field("Running costs per hour of work", '<span class="prefix"><em>$</em><input data-f="overheadRate" data-t="money" inputmode="decimal" value="' + money(d.overheadRate) + '" placeholder="0.00"></span>' +
        '<button type="button" class="linkish" data-act="overhead-help">Work it out for me</button>') +
      field("Other costs" + (svc ? " for this job" : " for this batch") + " <i>(optional)</i>", '<span class="prefix"><em>$</em><input data-f="extraCost" data-t="money" inputmode="decimal" value="' + money(d.extraCost) + '" placeholder="0.00"></span>' +
        '<small>' + (svc ? "Parking, a permit, equipment rental." : "Market booth share, delivery, a one-off tool.") + "</small>") +
      "</div></section>" +

      '<section class="card"><h2 class="sec"><span class="step">5</span>Profit and selling fees</h2>' +
      '<div class="grid-2">' +
      field("Profit you want to keep", '<span class="suffix"><input data-f="margin" data-t="num" inputmode="decimal" value="' + esc(trim(d.margin)) + '"><em>% of price</em></span>' +
        "<small>Separate from your wage. It pays for slow months, new tools, growth and giving. 15 to 30% is common.</small>") +
      field("Round prices up to", '<select data-f="roundTo" data-t="int">' + ROUNDS.map(function (r) { return '<option value="' + r[0] + '"' + (+d.roundTo === r[0] ? " selected" : "") + ">" + r[1] + "</option>"; }).join("") + "</select>" +
        "<small>Always rounds up, so you never drop below your target.</small>") +
      "</div>" +
      '<div class="fees"><span class="label">Card or checkout fees</span><div class="chips" role="group" aria-label="Fee presets">' +
      FEES.map(function (f) { var on = +d.feePercent === f[2] && +d.feeFixed === f[3]; return '<button type="button" class="chip" data-fee="' + f[0] + '" aria-pressed="' + on + '">' + f[1] + "</button>"; }).join("") + "</div>" +
      '<div class="grid-2">' +
      field("Percent of each sale", '<span class="suffix"><input data-f="feePercent" data-t="num" inputmode="decimal" value="' + esc(trim(d.feePercent)) + '" placeholder="0"><em>%</em></span>') +
      field("Plus per sale", '<span class="prefix"><em>$</em><input data-f="feeFixed" data-t="money" inputmode="decimal" value="' + money(d.feeFixed) + '" placeholder="0.00"></span>') +
      "</div><small class=\"muted\">Rates differ by provider; check your own statement.</small></div>" +
      (svc ? "" :
        '<label class="check"><input type="checkbox" data-f="wholesale.on"' + (d.wholesale.on ? " checked" : "") + "> I also sell to shops (wholesale)</label>" +
        (d.wholesale.on ? '<div class="grid-2">' +
          field("Profit on wholesale", '<span class="suffix"><input data-f="wholesale.margin" data-t="num" inputmode="decimal" value="' + esc(trim(d.wholesale.margin)) + '"><em>% of price</em></span><small>Usually lower than retail; shops buy in bulk and do the selling.</small>') +
          field("Shops mark up by", '<span class="suffix"><input data-f="wholesale.storeMarkup" data-t="num" inputmode="decimal" value="' + esc(trim(d.wholesale.storeMarkup)) + '"><em>times</em></span><small>2 times is the usual shop markup.</small>') +
          "</div>" : "")) +
      "</section>" +

      field("Notes <i>(only you see these)</i>", '<textarea data-f="notes" rows="2" placeholder="Supplier, where prices came from, when to check them again">' + esc(d.notes) + "</textarea>") +
      (d.id ? '<div class="danger-zone"><button type="button" class="btn small ghost" data-act="duplicate">' + ICON.copy + 'Duplicate</button> <button type="button" class="btn small danger" data-act="delete">' + ICON.trash + "Delete</button></div>" : "") +
      "</form>" +

      '<aside class="pb-side"><div class="result card float" aria-label="Your price">' +
      '<div id="figures" aria-live="polite"></div>' +
      '<div class="your-price">' +
      field("Your price " + '<i class="per">' + esc(per(d)) + "</i>", '<span class="prefix"><em>$</em><input data-f="price" data-t="money" inputmode="decimal" value="' + money(d.price) + '" placeholder="Use the suggestion"></span>' +
        "<small>Charging something else? Type it to see what it really earns.</small>") +
      '<label class="check"><input type="checkbox" data-f="taxable"' + (d.taxable !== false ? " checked" : "") + "> Charge sales tax on it</label>" +
      '<div class="save-row"><button type="button" class="btn" data-act="save-item">' + ICON.star + '<span id="save-label">Save to my items</span></button>' +
      '<a class="btn ghost" href="' + FM.link("invoices/#new-quote") + '">' + ICON.quote + "New quote</a></div>" +
      '<p class="item-state muted" id="item-state"></p>' +
      "</div></div></aside></div>" +
      '<div class="mini no-print" aria-hidden="true"><p><span>Price</span><b id="mini-price">$0.00</b></p><a class="btn small" href="#" data-act="to-result" tabindex="-1">See breakdown</a></div>';

    renderFigures();
  }

  function materialRow(m, i) {
    return '<div class="line mat" data-col="materials" data-i="' + i + '">' +
      '<label class="l-name"><span class="m-label">Material</span><input data-lf="name" value="' + esc(m.name) + '" placeholder="' + (i === 0 ? (draft.kind === "service" ? "e.g. Trash bags" : "e.g. Bread flour, per lb") : "What it is") + '"></label>' +
      '<label class="l-qty"><span class="m-label">Amount used</span><input data-lf="qty" data-t="num" inputmode="decimal" value="' + esc(trim(m.qty)) + '"></label>' +
      '<label class="l-cost"><span class="m-label">Cost each</span><span class="prefix"><em>$</em><input data-lf="cost" data-t="money" inputmode="decimal" value="' + money(m.cost) + '" placeholder="0.00"></span></label>' +
      '<span class="l-amt" data-amt>' + fmt((parseFloat(m.qty) || 0) * (m.cost || 0)) + "</span>" +
      '<button type="button" class="icon-btn l-del" data-act="del-line" aria-label="Remove this material">' + ICON.x + "</button></div>";
  }
  function laborRow(l, i) {
    return '<div class="line lab" data-col="labor" data-i="' + i + '">' +
      '<label class="l-name"><span class="m-label">Who</span><input data-lf="name" value="' + esc(l.name) + '" placeholder="' + (i === 0 ? "Your time" : "A helper") + '"></label>' +
      '<label class="l-qty"><span class="m-label">Hours</span><input data-lf="hours" data-t="hours" inputmode="decimal" value="' + esc(trim(l.hours)) + '" placeholder="0"></label>' +
      '<label class="l-cost"><span class="m-label">Wage per hour</span><span class="prefix"><em>$</em><input data-lf="rate" data-t="money" inputmode="decimal" value="' + money(l.rate) + '" placeholder="0.00"></span></label>' +
      '<span class="l-amt" data-amt>' + fmt((parseFloat(l.hours) || 0) * (l.rate || 0)) + "</span>" +
      (i === 0 ? '<span class="l-del"></span>' : '<button type="button" class="icon-btn l-del" data-act="del-line" aria-label="Remove this helper">' + ICON.x + "</button>") + "</div>";
  }

  // The live result panel: the price, where every dollar of it goes, and plain warnings.
  function renderFigures() {
    var d = draft, r = P.compute(d), u = r.unit;
    var box = $("#figures", app);
    if (!box) return;
    var mini = $("#mini-price", app);
    if (mini) mini.textContent = fmt(r.price);
    var unitWord = per(d);
    var targetMargin = parseFloat(d.margin) || 0;
    var wage = (d.labor[0] && d.labor[0].rate) || 0;

    if (r.unit.cost <= 0 && !(parseFloat(d.feeFixed) > 0)) {
      box.innerHTML = '<p class="eyebrow">Suggested price</p><p class="big muted">$0.00</p>' +
        '<p class="muted">Add materials or time on the left and your price appears here as you type.</p>';
      updateItemState(r);
      return;
    }

    var parts = [
      ["materials", "Materials", u.materials],
      ["labor", "Wages", u.labor],
      ["overhead", "Running costs", u.overhead],
      ["fees", "Fees", u.fees],
      ["profit", r.profit >= 0 ? "Profit" : "Loss", r.profit]
    ];
    var whole = Math.max(r.price, u.cost + u.fees, 1);
    var bar = parts.filter(function (p) { return p[2] > 0.5; }).map(function (p) {
      return '<span class="seg-' + p[0] + '" style="width:' + (p[2] / whole * 100).toFixed(2) + '%"></span>';
    }).join("");
    var legend = parts.filter(function (p) { return Math.abs(p[2]) > 0.5 || p[0] !== "fees"; }).map(function (p) {
      return '<li><i class="dot seg-' + (p[0] === "profit" && p[2] < 0 ? "loss" : p[0]) + '"></i><span>' + p[1] + "</span><b>" + fmt(p[2]) + "</b></li>";
    }).join("");

    var verdict;
    if (r.impossible && r.usingSuggested) {
      verdict = '<p class="notice rose-n">Your profit and fees add up to nearly the whole price, so no price can reach them. Lower the profit you want to keep.</p>';
    } else if (r.profit < -0.5) {
      verdict = '<p class="notice rose-n">At this price you lose ' + fmt(-r.profit) + " on every sale. You need at least " + fmt(r.breakEven) + " to cover your costs and wages.</p>";
    } else if (r.perHour != null && wage && r.perHour + 0.5 < wage) {
      verdict = '<p class="notice">This price pays ' + fmt(r.perHour) + " for each hour of work, less than the " + fmt(wage) + " wage you set.</p>";
    } else if (r.margin + 0.05 < targetMargin) {
      verdict = '<p class="notice">This covers your costs and a fair wage, but leaves ' + pct(r.margin) + " profit, under your " + pct(targetMargin) + " goal.</p>";
    } else {
      verdict = '<p class="notice green-n">This covers every cost, pays a fair wage, and keeps ' + pct(r.margin) + " to keep your business healthy.</p>";
    }

    var w = r.wholesale, wholesale = "";
    if (w) {
      wholesale = '<div class="wh"><h3>Selling to shops</h3><dl class="figs">' +
        "<div><dt>Wholesale price</dt><dd>" + fmt(w.price) + "</dd></div>" +
        "<div><dt>You keep per piece</dt><dd>" + fmt(w.profit) + "</dd></div>" +
        "<div><dt>Shop shelf price</dt><dd>" + fmt(w.shelf) + "</dd></div></dl>" +
        (w.undercuts ? '<p class="hint muted">Your own price is below what shops would charge. Shops may not want to carry it if you sell it for less yourself.</p>' : "") + "</div>";
    }

    box.innerHTML =
      '<p class="eyebrow">' + (r.usingSuggested ? "Suggested price" : "Your price") + "</p>" +
      '<p class="big"><span id="the-price">' + fmt(r.price) + '</span> <small>' + esc(unitWord) + "</small></p>" +
      (!r.usingSuggested && r.suggested ? '<p class="muted sugg">Suggested: ' + fmt(r.suggested) + " " + esc(unitWord) + "</p>" : "") +
      '<div class="bar" role="img" aria-label="Where the price goes">' + bar + "</div>" +
      '<ul class="legend">' + legend + "</ul>" + verdict +
      '<dl class="figs">' +
      "<div><dt>Cost to make " + (d.kind === "service" ? "it" : "one") + "</dt><dd>" + fmt(u.cost) + "</dd></div>" +
      "<div><dt>Lowest price that breaks even</dt><dd>" + fmt(r.breakEven) + "</dd></div>" +
      "<div><dt>Profit margin</dt><dd>" + pct(r.margin) + "</dd></div>" +
      "<div><dt>Markup on cost</dt><dd>" + pct(r.markup) + "</dd></div>" +
      (r.perHour != null ? "<div><dt>Each hour of work earns</dt><dd>" + fmt(r.perHour) + "</dd></div>" : "") +
      (r.yield > 1 ? "<div><dt>Whole batch of " + esc(trim(r.yield)) + "</dt><dd>" + fmt(r.batch.cost) + " to make, " + fmt(r.price * r.yield) + " sold</dd></div>" : "") +
      "</dl>" + wholesale;
    updateItemState(r);
  }

  function linkedItem() { return draft.itemId ? S.get("items", draft.itemId) : null; }
  function updateItemState(r) {
    var el = $("#item-state", app), label = $("#save-label", app);
    if (!el) return;
    var it = linkedItem();
    if (!it) { el.textContent = "Saving puts it on your items list, ready to pick on any quote or invoice."; label.textContent = "Save to my items"; return; }
    var same = it.price === r.price;
    el.textContent = same ? "On your items list at " + fmt(it.price) + "." : "Your items list still has " + fmt(it.price) + ". Update it to use the new price.";
    label.textContent = same ? "Saved to my items" : "Update my items";
  }

  // ---------- events
  function setPath(obj, path, v) {
    var k = path.split(".");
    if (k.length === 2) obj[k[0]][k[1]] = v; else obj[path] = v;
  }
  function readValue(el) {
    var t = el.getAttribute("data-t");
    if (el.type === "checkbox") return el.checked;
    if (t === "money") return M.toCents(el.value) > 0 ? M.toCents(el.value) : 0;
    if (t === "hours") return el.value.trim() === "" ? "" : parseHours(el.value);
    if (t === "num") return el.value.trim() === "" ? "" : parseFloat(el.value) || 0;
    if (t === "int") return parseInt(el.value, 10) || 1;
    return el.value;
  }

  function onInput(e) {
    if (!draft) return;
    var el = e.target;
    // Checkboxes and menus are handled on "change" only, so they don't run twice.
    if (e.type === "input" && (el.type === "checkbox" || el.tagName === "SELECT")) return;
    var f = el.getAttribute("data-f"), lf = el.getAttribute("data-lf");
    if (lf) {
      var row = el.closest(".line");
      var col = row.getAttribute("data-col"), i = +row.getAttribute("data-i");
      draft[col][i][lf] = readValue(el);
      var ln = draft[col][i];
      $("[data-amt]", row).textContent = fmt(col === "labor" ? (parseFloat(ln.hours) || 0) * (ln.rate || 0) : (parseFloat(ln.qty) || 0) * (ln.cost || 0));
    } else if (f) {
      setPath(draft, f, readValue(el));
      if (f === "wholesale.on") { renderEditor(); scheduleSave(); return; }
      if (f === "name") { var h1 = $(".ed-title h1", app); if (h1) h1.textContent = draft.name || (draft.kind === "service" ? "Price a service" : "Price a product"); }
      if (f === "unit") { var pe = $(".your-price .per", app); if (pe) pe.textContent = per(draft); }
      if (f === "feePercent" || f === "feeFixed") syncFeeChips();
    } else return;
    renderFigures();
    scheduleSave();
  }
  function syncFeeChips() {
    $$("[data-fee]", app).forEach(function (b) {
      var f = FEES.find(function (x) { return x[0] === b.getAttribute("data-fee"); });
      b.setAttribute("aria-pressed", String(+draft.feePercent === f[2] && +draft.feeFixed === f[3]));
    });
  }

  function onClick(e) {
    if (!draft) return;
    var kind = e.target.closest("[data-kind]");
    if (kind) {
      var k = kind.getAttribute("data-kind");
      if (k === draft.kind) return;
      draft.kind = k;
      if (k === "service") { draft.yield = 1; if (!draft.unit || draft.unit === "each") draft.unit = "job"; draft.wholesale.on = false; }
      else if (draft.unit === "job") draft.unit = "each";
      renderEditor(); scheduleSave();
      return;
    }
    var fee = e.target.closest("[data-fee]");
    if (fee) {
      var f = FEES.find(function (x) { return x[0] === fee.getAttribute("data-fee"); });
      draft.feePercent = f[2]; draft.feeFixed = f[3];
      $('[data-f="feePercent"]', app).value = f[2] ? f[2] : "";
      $('[data-f="feeFixed"]', app).value = money(f[3]);
      syncFeeChips(); renderFigures(); scheduleSave();
      return;
    }
    var b = e.target.closest("[data-act]");
    if (!b) return;
    var act = b.getAttribute("data-act");
    if (act === "add-material" || act === "add-labor") {
      var col = act === "add-material" ? "materials" : "labor";
      draft[col].push(line(col));
      var box = $("#" + col, app);
      box.insertAdjacentHTML("beforeend", (col === "labor" ? laborRow : materialRow)(draft[col][draft[col].length - 1], draft[col].length - 1));
      $(".line:last-child input", box).focus();
      return;
    }
    if (act === "del-line") {
      var row = b.closest(".line"), c = row.getAttribute("data-col");
      draft[c].splice(+row.getAttribute("data-i"), 1);
      if (c === "materials" && !draft.materials.length) draft.materials.push(line("materials"));
      $("#" + c, app).innerHTML = draft[c].map(c === "labor" ? laborRow : materialRow).join("");
      renderFigures(); scheduleSave();
      return;
    }
    if (act === "to-result") { e.preventDefault(); $(".pb-side", app).scrollIntoView({ behavior: "smooth", block: "start" }); return; }
    if (act === "overhead-help") return overheadHelp();
    if (act === "save-item") return saveToItems();
    if (act === "duplicate") return duplicate();
    if (act === "delete") return remove();
  }

  function overheadHelp() {
    var dlg = document.createElement("dialog");
    dlg.className = "fm-dialog";
    dlg.innerHTML = '<form method="dialog" class="dlg-body"><h3>Running costs per hour</h3>' +
      '<p class="muted">Add up what it costs to be open for a month, not counting materials or wages: rent, utilities, insurance, phone and internet, software, vehicle, tool wear, fees for your licenses.</p>' +
      '<div class="grid-2">' + field("Monthly running costs", '<span class="prefix"><em>$</em><input name="monthly" inputmode="decimal" placeholder="0.00" required></span>') +
      field("Hours you work in a month", '<input name="hours" inputmode="decimal" value="120">' +
        "<small>Hours spent on paid work. Full time is often 100 to 140 once admin is taken out.</small>") + "</div>" +
      '<p class="oh-out" aria-live="polite"></p>' +
      '<div class="dlg-actions"><button class="btn ghost" value="cancel" formnovalidate>Cancel</button><button class="btn" value="ok">Use this rate</button></div></form>';
    document.body.appendChild(dlg);
    var form = dlg.querySelector("form"), out = dlg.querySelector(".oh-out");
    function rate() { return P.overheadRate(M.toCents(form.monthly.value), parseFloat(form.hours.value)); }
    form.addEventListener("input", function () { var r = rate(); out.textContent = r ? "That's " + fmt(r) + " for every hour of work." : ""; });
    dlg.addEventListener("close", function () {
      if (dlg.returnValue === "ok" && rate()) {
        draft.overheadRate = rate();
        $('[data-f="overheadRate"]', app).value = money(draft.overheadRate);
        renderFigures(); scheduleSave();
        FM.toast("Running costs added");
      }
      dlg.remove();
    });
    dlg.showModal();
  }

  function saveToItems() {
    var r = P.compute(draft);
    if (!draft.name.trim()) { FM.toast("Give it a name first"); $('[data-f="name"]', app).focus(); return; }
    if (!r.price) { FM.toast("Add some costs first so there's a price to save"); return; }
    var it = linkedItem() || S.all("items").find(function (x) { return (x.name || "").toLowerCase() === draft.name.trim().toLowerCase(); });
    var ready = it ? Promise.resolve(true) : canAdd("items");
    ready.then(function (ok) {
      if (!ok) return;
      flushSave();
      if (!draft.id) saveNow();
      var unit = (draft.unit || "").trim();
      var rec = Object.assign(it || {}, {
        name: draft.name.trim(), price: r.price, unit: unit === "each" ? "" : unit,
        taxable: draft.taxable !== false, cost: Math.round(r.unit.cost), costingId: draft.id || null
      });
      var saved = S.put("items", rec);
      draft.itemId = saved.id;
      saveNow();
      renderFigures();
      FM.toast(it ? "Updated in your items" : "Saved to your items. Pick it on your next quote or invoice.");
    });
  }

  function duplicate() {
    canAdd("costings").then(function (ok) {
      if (!ok) return;
      flushSave();
      var copy = JSON.parse(JSON.stringify(draft));
      delete copy.id; delete copy.createdAt; delete copy.updatedAt;
      copy.itemId = null;
      copy.name = (copy.name || "Untitled") + " (copy)";
      var saved = S.put("costings", copy);
      go("#p/" + saved.id);
      FM.toast("Duplicated");
    });
  }

  function remove() {
    FM.confirm({ title: "Delete " + (draft.name || "this price") + "?", body: "This can't be undone. If you saved it to your items, the item stays on your list.", ok: "Delete", danger: true }).then(function (yes) {
      if (!yes) return;
      clearTimeout(saveTimer); saveTimer = null;
      S.remove("costings", draft.id);
      draft = null;
      go("");
      FM.toast("Deleted");
    });
  }

  // ---------- start
  document.addEventListener("DOMContentLoaded", function () {
    app = document.getElementById("app");
    app.addEventListener("input", onInput);
    app.addEventListener("change", function (e) { if (e.target.type === "checkbox" || e.target.tagName === "SELECT") onInput(e); });
    app.addEventListener("click", onClick);
    app.addEventListener("submit", function (e) { e.preventDefault(); });
    window.addEventListener("hashchange", route);
    S.onChange(function (key, external) { if (external && !draft) route(); });
    route();
  });
})();
