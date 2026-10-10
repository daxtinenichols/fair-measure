/* Quotes & Invoices.
   Routes (in the address hash): list "", "#new", "#new-quote", "#new?c=<customerId>",
   "#doc/<id>", "#customers", "#items". Work is saved automatically as you type. */
(function () {
  "use strict";
  var FM = window.FM, S = FM.store, C = window.FMCalc, M = FM.money, L = FM.license, esc = FM.esc;
  var app;
  var ui = { filter: "all", q: "", tab: "edit" };
  var draft = null;          // the document being edited
  var saveTimer = null;
  var pendingCustomer = false; // customer fields changed since last commit

  var STATUS = {
    draft: ["Draft", ""], sent: ["Sent", "blue"], paid: ["Paid", "green"], overdue: ["Overdue", "rose"],
    accepted: ["Accepted", "green"], declined: ["Declined", ""], expired: ["Expired", "gold"], void: ["Void", ""]
  };
  var ICON = {
    plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
    back: '<svg viewBox="0 0 24 24"><path d="M15 6l-6 6 6 6"/></svg>',
    print: '<svg viewBox="0 0 24 24"><path d="M7 9V4h10v5M7 17H5a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-2"/><path d="M7 14h10v6H7z"/></svg>',
    mail: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/></svg>',
    trash: '<svg viewBox="0 0 24 24"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>',
    x: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    star: '<svg viewBox="0 0 24 24"><path d="M12 4l2.4 5 5.4.6-4 3.7 1.1 5.3L12 16l-4.9 2.6 1.1-5.3-4-3.7 5.4-.6z"/></svg>',
    copy: '<svg viewBox="0 0 24 24"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/></svg>',
    check: '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7"/></svg>',
    swap: '<svg viewBox="0 0 24 24"><path d="M4 8h13l-3-3M20 16H7l3 3"/></svg>',
    search: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5"/></svg>'
  };

  // ---------- helpers
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function profile() { return S.profile(); }
  function fmt(c) { var p = profile(); return M.format(c, p.currency, p.locale || undefined); }
  function fmtDate(iso) {
    if (!iso) return "";
    try { return new Date(iso + "T12:00:00").toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }); }
    catch (e) { return iso; }
  }
  function pill(status) { var s = STATUS[status] || [status, ""]; return '<span class="pill ' + s[1] + '">' + s[0] + "</span>"; }
  function typeName(doc) { return doc.type === "quote" ? "Quote" : "Invoice"; }
  function hasContent(doc) {
    return !!((doc.customer && doc.customer.name) || (doc.lines || []).some(function (l) { return l.description || l.price; }));
  }
  function go(hash) { if (location.hash === hash) route(); else location.hash = hash; }
  function nl2br(s) { return esc(s).replace(/\n/g, "<br>"); }

  function limitDialog(col) {
    var names = { documents: "quotes and invoices", customers: "customers", items: "items" };
    var lim = L.limits[col];
    return FM.confirm({
      title: "You've reached the free limit",
      body: "The free version keeps up to " + lim + " saved " + names[col] + ". Pro removes every limit for a one-time " + L.config.price + ". You can also delete old ones to make room.",
      ok: "See Pro", cancel: "Not now"
    }).then(function (yes) { if (yes) location.href = FM.link("settings/#pro"); return false; });
  }
  function canAdd(col) {
    var r = L.canAdd(col, S.count(col));
    if (r.allowed) return Promise.resolve(true);
    return limitDialog(col);
  }

  // ---------- routing
  function route() {
    flushSave();
    commitCustomer();
    var h = location.hash.replace(/^#/, "");
    var params = {};
    var q = h.indexOf("?");
    if (q >= 0) { h.slice(q + 1).split("&").forEach(function (kv) { var p = kv.split("="); params[p[0]] = decodeURIComponent(p[1] || ""); }); h = h.slice(0, q); }
    window.scrollTo(0, 0);
    if (h === "new" || h === "new-quote") return startNew(h === "new" ? "invoice" : "quote", params.c);
    if (h.indexOf("doc/") === 0) return openDoc(h.slice(4));
    draft = null;
    if (h === "customers") return renderCustomers();
    if (h === "items") return renderItems();
    renderList();
  }

  function shell(active, inner) {
    var tabs = [["", "Quotes & invoices", "docs"], ["#customers", "Customers", "customers"], ["#items", "Items", "items"]];
    return '<div class="wrap app-head no-print">' +
      '<div class="app-title"><h1>Quotes &amp; Invoices</h1>' + (L.isPro() ? '<span class="fm-pro-chip">Pro</span>' : "") + "</div>" +
      '<nav class="seg" aria-label="Sections">' + tabs.map(function (t) {
        return '<a href="' + (t[0] || "#") + '"' + (t[2] === active ? ' aria-current="page"' : "") + ">" + t[1] + "</a>";
      }).join("") + "</nav></div>" + inner;
  }

  // ---------- list
  function renderList() {
    var docs = S.all("documents");
    var now = C.today();
    var outstanding = 0, overdue = 0, overdueN = 0, paid30 = 0;
    var since = C.addDays(now, -30);
    docs.forEach(function (d) {
      var st = C.displayStatus(d, now), t = C.totals(d);
      if (d.type === "invoice" && (st === "sent" || st === "overdue")) outstanding += t.balance;
      if (st === "overdue") { overdue += t.balance; overdueN++; }
      (d.payments || []).forEach(function (p) { if (p.date >= since) paid30 += p.amount; });
    });

    var chips = [["all", "All"], ["quote", "Quotes"], ["unpaid", "Unpaid"], ["overdue", "Overdue"], ["paid", "Paid"], ["draft", "Drafts"]];
    var q = ui.q.trim().toLowerCase();
    var shown = docs.filter(function (d) {
      var st = C.displayStatus(d, now);
      var f = ui.filter;
      if (f === "quote" && d.type !== "quote") return false;
      if (f === "unpaid" && !(d.type === "invoice" && (st === "sent" || st === "overdue"))) return false;
      if (f === "overdue" && st !== "overdue") return false;
      if (f === "paid" && st !== "paid") return false;
      if (f === "draft" && st !== "draft") return false;
      if (q) {
        var hay = [d.number, d.customer && d.customer.name, d.customer && d.customer.company, d.reference].join(" ").toLowerCase();
        if (hay.indexOf(q) < 0) return false;
      }
      return true;
    }).sort(function (a, b) { return (b.issueDate || "").localeCompare(a.issueDate || "") || (b.updatedAt || "").localeCompare(a.updatedAt || ""); });

    var rows = shown.map(function (d) {
      var t = C.totals(d), st = C.displayStatus(d, now);
      var who = (d.customer && (d.customer.name || d.customer.company)) || "No customer yet";
      var sub = typeName(d) + " · " + fmtDate(d.issueDate) + (d.type === "invoice" && d.dueDate && st !== "paid" ? " · due " + fmtDate(d.dueDate) : "");
      return '<a class="doc-row" href="#doc/' + esc(d.id) + '">' +
        '<span class="doc-num">' + esc(d.number || "Draft") + "</span>" +
        '<span class="doc-who"><b>' + esc(who) + "</b><small>" + esc(sub) + "</small></span>" +
        '<span class="doc-amt">' + fmt(st === "paid" ? t.total : (d.type === "invoice" ? t.balance : t.total)) + "</span>" +
        '<span class="doc-st">' + pill(st) + "</span></a>";
    }).join("");

    var empty = docs.length === 0
      ? '<div class="empty"><svg viewBox="0 0 64 64" aria-hidden="true"><path d="M18 8h20l10 10v38H18z"/><path d="M38 8v10h10M25 30h16M25 38h16M25 46h9"/></svg>' +
        "<h2>Your first invoice is a minute away</h2><p class=\"muted\">Add a customer, a line or two, and print it or save it as a PDF. Everything is saved on this device as you type.</p>" +
        '<div class="empty-actions"><a class="btn" href="#new">' + ICON.plus + 'New invoice</a><a class="btn ghost" href="#new-quote">New quote</a></div></div>'
      : (rows || '<p class="muted none">Nothing matches. Try another filter or search.</p>');

    var backupNote = FM.backup.due()
      ? '<div class="notice blue backup-note"><span>Your business book lives on this device. Download a backup now and then so nothing is lost.</span><button class="btn small ghost" data-act="backup">Download backup</button></div>'
      : "";

    app.innerHTML = shell("docs",
      '<div class="wrap">' + backupNote +
      (docs.length ? '<div class="tiles">' +
        '<div class="tile"><span>Waiting to be paid</span><b>' + fmt(outstanding) + "</b></div>" +
        '<div class="tile' + (overdueN ? " warn" : "") + '"><span>Overdue</span><b>' + fmt(overdue) + "</b><small>" + overdueN + (overdueN === 1 ? " invoice" : " invoices") + "</small></div>" +
        '<div class="tile"><span>Paid in the last 30 days</span><b>' + fmt(paid30) + "</b></div></div>" +
        '<div class="list-bar"><div class="chips" role="group" aria-label="Filter">' + chips.map(function (c) {
          return '<button type="button" class="chip" data-filter="' + c[0] + '" aria-pressed="' + (ui.filter === c[0]) + '">' + c[1] + "</button>";
        }).join("") + "</div>" +
        '<label class="search"><span class="sr">Search</span>' + ICON.search + '<input type="search" id="q" placeholder="Search by name or number" value="' + esc(ui.q) + '"></label>' +
        '<div class="new-btns"><a class="btn" href="#new">' + ICON.plus + 'New invoice</a><a class="btn ghost" href="#new-quote">New quote</a></div></div>' : "") +
      '<div class="doc-list">' + empty + "</div>" + limitNote("documents") + "</div>");

    $$(".chip", app).forEach(function (b) { b.addEventListener("click", function () { ui.filter = b.getAttribute("data-filter"); renderList(); }); });
    var qi = $("#q", app);
    if (qi) qi.addEventListener("input", function () {
      ui.q = qi.value; var pos = qi.selectionStart; renderList();
      var n = $("#q", app); n.focus(); n.setSelectionRange(pos, pos);
    });
    var bk = $('[data-act="backup"]', app);
    if (bk) bk.addEventListener("click", function () { FM.backup.download(); FM.toast("Backup downloaded"); renderList(); });
  }

  function limitNote(col) {
    if (L.isPro()) return "";
    var used = S.count(col), lim = L.limits[col];
    if (used < lim - 2) return "";
    var names = { documents: "quotes and invoices", customers: "customers", items: "items" };
    return '<p class="limit-note muted">' + used + " of " + lim + " free " + names[col] + " used. " +
      '<a href="' + FM.link("settings/#pro") + '">Pro</a> removes the limit.</p>';
  }

  // ---------- new / open
  function blankDoc(type) {
    var p = profile(), now = C.today();
    var prefix = type === "quote" ? p.quotePrefix : p.invoicePrefix;
    var n = type === "quote" ? p.nextQuote : p.nextInvoice;
    return {
      type: type, status: "draft",
      number: prefix + String(Math.max(1, parseInt(n, 10) || 1)).padStart(4, "0"),
      _peekNumber: true,
      issueDate: now,
      dueDate: C.addDays(now, p.termsDays),
      validUntil: C.addDays(now, p.quoteValidDays),
      reference: "",
      customerId: null,
      customer: { name: "", company: "", email: "", phone: "", address: "" },
      lines: [newLine()],
      discountType: "percent", discountValue: "",
      taxLabel: p.taxLabel, taxRate: p.taxRate,
      depositPercent: "",
      notes: "",
      paymentInstructions: p.paymentInstructions,
      payments: [], paidAmount: 0
    };
  }
  function newLine(item) {
    return item
      ? { id: S.uid(), description: item.name, unit: item.unit || "", qty: 1, price: item.price || 0, taxable: item.taxable !== false }
      : { id: S.uid(), description: "", unit: "", qty: 1, price: 0, taxable: true };
  }

  function startNew(type, customerId) {
    canAdd("documents").then(function (ok) {
      if (!ok) { history.replaceState(null, "", "#"); renderList(); return; }
      draft = blankDoc(type);
      if (customerId) { var c = S.get("customers", customerId); if (c) setCustomer(c); }
      renderEditor();
      var first = $('[data-f="customer.name"]', app);
      if (first && !customerId) first.focus();
    });
  }
  function openDoc(id) {
    var d = S.get("documents", id);
    if (!d) { FM.toast("That document isn't on this device"); go(""); return; }
    draft = JSON.parse(JSON.stringify(d));
    renderEditor();
  }

  function setCustomer(c) {
    draft.customerId = c.id;
    draft.customer = { name: c.name || "", company: c.company || "", email: c.email || "", phone: c.phone || "", address: c.address || "" };
  }

  // ---------- saving
  function scheduleSave() {
    clearTimeout(saveTimer);
    setSaved("Saving…");
    saveTimer = setTimeout(saveNow, 500);
  }
  function flushSave() { if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; saveNow(); } }
  function saveNow() {
    saveTimer = null;
    if (!draft) return;
    if (!draft.id && !hasContent(draft)) { setSaved(""); return; }
    if (!draft.id && !L.canAdd("documents", S.count("documents")).allowed) { setSaved("Not saved: free limit reached"); return; }
    if (draft._peekNumber) {
      var peek = blankDoc(draft.type).number;
      var assigned = draft.number === peek ? S.nextNumber(draft.type) : draft.number;
      draft.number = assigned;
      delete draft._peekNumber;
      var numInput = $('[data-f="number"]', app);
      if (numInput && document.activeElement !== numInput) numInput.value = assigned;
    }
    try {
      var saved = S.put("documents", draft);
      draft.id = saved.id; draft.createdAt = saved.createdAt; draft.updatedAt = saved.updatedAt;
      if (location.hash !== "#doc/" + saved.id) {
        history.replaceState(null, "", "#doc/" + saved.id);
        var h1 = $(".ed-title h1", app);
        if (h1) h1.textContent = typeName(draft) + " " + draft.number;
      }
      setSaved("Saved");
    } catch (e) { setSaved(""); FM.toast(e.message); }
  }
  function setSaved(t) { var el = $("#saved", app); if (el) el.textContent = t; }

  // Adds or updates the customer in the shared customer list. Runs when you leave the
  // document, print it, or send it, so half-typed names never land in the list.
  function commitCustomer() {
    if (!draft || !pendingCustomer) return;
    pendingCustomer = false;
    var c = draft.customer || {};
    if (!c.name && !c.company) return;
    if (draft.saveCustomer === false) return;
    var rec;
    if (draft.customerId) {
      var existing = S.get("customers", draft.customerId);
      if (!existing) draft.customerId = null; else rec = Object.assign(existing, c);
    }
    if (!rec) {
      var match = S.all("customers").find(function (x) { return (x.name || "").toLowerCase() === (c.name || "").toLowerCase() && c.name; });
      if (match) rec = Object.assign(match, c);
      else if (L.canAdd("customers", S.count("customers")).allowed) rec = Object.assign({}, c);
      else { FM.toast("Free limit reached, so this customer wasn't added to your list"); return; }
    }
    rec = S.put("customers", rec);
    draft.customerId = rec.id;
    if (draft.id) S.put("documents", draft);
  }
  window.addEventListener("pagehide", function () { flushSave(); commitCustomer(); });

  // ---------- editor
  function renderEditor() {
    var d = draft, p = profile();
    var isQuote = d.type === "quote";
    var st = C.displayStatus(d);
    var customers = S.all("customers"), items = S.all("items");

    var fromBlock = p.name
      ? '<div class="from-card"><div><b>' + esc(p.name) + "</b><span>" + esc([p.email, p.phone].filter(Boolean).join(" · ")) + '</span></div><a class="btn small ghost" href="' + FM.link("settings/") + '">Edit</a></div>'
      : '<div class="notice from-setup"><span>Add your business name and contact details once, and they\'ll appear on every document.</span><button type="button" class="btn small" data-act="quick-profile">Add my details</button></div>';

    app.innerHTML =
      '<div class="wrap ed-head no-print">' +
      '<a class="back" href="#">' + ICON.back + "All documents</a>" +
      '<div class="ed-title"><h1>' + (d.id ? esc(typeName(d)) + " " + esc(d.number) : "New " + typeName(d).toLowerCase()) + "</h1>" + pill(st) +
      '<span class="saved muted" id="saved" aria-live="polite">' + (d.id ? "Saved" : "") + "</span></div>" +
      '<div class="ed-actions">' + actionButtons(d, st) + "</div></div>" +
      '<div class="wrap ed-switch no-print" role="tablist"><button role="tab" type="button" data-tab="edit" aria-selected="' + (ui.tab === "edit") + '">Edit</button><button role="tab" type="button" data-tab="preview" aria-selected="' + (ui.tab === "preview") + '">Preview</button></div>' +
      '<div class="wrap ed-grid" data-tab="' + ui.tab + '">' +
      '<form class="ed-form no-print" autocomplete="off" novalidate>' +

      '<section class="card"><h2 class="sec">From</h2>' + fromBlock + "</section>" +

      '<section class="card"><h2 class="sec">' + (isQuote ? "Quote for" : "Bill to") + "</h2>" +
      '<div class="grid-2">' +
      field("Name", '<input data-f="customer.name" list="dl-customers" value="' + esc(d.customer.name) + '" placeholder="' + (customers.length ? "Type or pick a saved customer" : "Customer's name") + '">') +
      field("Company <i>(optional)</i>", '<input data-f="customer.company" value="' + esc(d.customer.company) + '">') +
      field("Email", '<input type="email" inputmode="email" data-f="customer.email" value="' + esc(d.customer.email) + '">') +
      field("Phone", '<input type="tel" inputmode="tel" data-f="customer.phone" value="' + esc(d.customer.phone) + '">') +
      "</div>" +
      field("Address", '<textarea rows="2" data-f="customer.address">' + esc(d.customer.address) + "</textarea>") +
      '<datalist id="dl-customers">' + customers.map(function (c) { return '<option value="' + esc(c.name) + '">' + esc(c.company || "") + "</option>"; }).join("") + "</datalist>" +
      "</section>" +

      '<section class="card"><h2 class="sec">Details</h2><div class="grid-3">' +
      field(typeName(d) + " number", '<input data-f="number" value="' + esc(d.number) + '">') +
      field("Date", '<input type="date" data-f="issueDate" value="' + esc(d.issueDate) + '">') +
      (isQuote ? field("Good until", '<input type="date" data-f="validUntil" value="' + esc(d.validUntil) + '">')
               : field("Due", '<input type="date" data-f="dueDate" value="' + esc(d.dueDate) + '">')) +
      "</div>" +
      field("Job or PO reference <i>(optional)</i>", '<input data-f="reference" value="' + esc(d.reference) + '" placeholder="e.g. Kitchen remodel, PO 1183">') +
      "</section>" +

      '<section class="card"><h2 class="sec">Items</h2>' +
      '<div class="lines" id="lines">' + linesHTML(d) + "</div>" +
      '<datalist id="dl-items">' + items.map(function (it) { return '<option value="' + esc(it.name) + '">' + esc(fmt(it.price) + (it.unit ? " / " + it.unit : "")) + "</option>"; }).join("") + "</datalist>" +
      '<button type="button" class="btn ghost small add-line" data-act="add-line">' + ICON.plus + "Add a line</button>" +
      "</section>" +

      '<section class="card"><h2 class="sec">Tax, discount and deposit</h2><div class="grid-3">' +
      field("Discount", '<div class="combo"><input inputmode="decimal" data-f="discountValue" value="' + esc(d.discountValue) + '" placeholder="0"><select data-f="discountType" aria-label="Discount type"><option value="percent"' + (d.discountType !== "amount" ? " selected" : "") + '>%</option><option value="amount"' + (d.discountType === "amount" ? " selected" : "") + ">" + esc(currencySymbol()) + "</option></select></div>") +
      field("Tax rate (%)", '<input inputmode="decimal" data-f="taxRate" value="' + esc(d.taxRate) + '">') +
      field("Tax name", '<input data-f="taxLabel" value="' + esc(d.taxLabel) + '">') +
      "</div>" +
      field("Deposit to ask for now (%) <i>(optional)</i>", '<input inputmode="decimal" data-f="depositPercent" value="' + esc(d.depositPercent) + '" placeholder="e.g. 50">') +
      '<p class="hint muted">Tax applies to lines marked "Taxed". Ask your local tax office if you\'re unsure which rate applies.</p>' +
      "</section>" +

      '<section class="card"><h2 class="sec">Notes</h2>' +
      field("How to pay you", '<textarea rows="3" data-f="paymentInstructions" placeholder="e.g. Check payable to Hollow Oak Carpentry, or Zelle to (512) 555-0140">' + esc(d.paymentInstructions) + "</textarea>") +
      field("Note to the customer <i>(optional)</i>", '<textarea rows="3" data-f="notes" placeholder="' + (isQuote ? "e.g. Price includes materials and cleanup. Work can start within two weeks of approval." : "e.g. Thank you for your business!") + '">' + esc(d.notes) + "</textarea>") +
      "</section>" +

      '<section class="card totals-card" id="totals-card">' + totalsHTML(d) + "</section>" +
      paymentsHTML(d) +
      (d.id ? '<div class="danger-zone"><button type="button" class="btn danger small" data-act="delete">' + ICON.trash + "Delete this " + typeName(d).toLowerCase() + "</button></div>" : "") +
      "</form>" +
      '<div class="ed-preview"><div class="preview-sticky"><div class="doc-shell" id="preview">' + docHTML(d, p) + "</div></div></div>" +
      "</div>";

    bindEditor();
  }

  function currencySymbol() {
    try {
      var parts = new Intl.NumberFormat(undefined, { style: "currency", currency: profile().currency }).formatToParts(0);
      var s = parts.find(function (x) { return x.type === "currency"; });
      return s ? s.value : "$";
    } catch (e) { return "$"; }
  }

  function field(label, control) { return '<label class="field"><span>' + label + "</span>" + control + "</label>"; }

  function actionButtons(d, st) {
    var b = [];
    b.push('<button type="button" class="btn" data-act="print">' + ICON.print + "Print or save PDF</button>");
    b.push('<button type="button" class="btn ghost" data-act="email">' + ICON.mail + "Email</button>");
    if (d.type === "invoice") {
      if (st === "draft") b.push('<button type="button" class="btn ghost" data-act="mark-sent">' + ICON.check + "Mark as sent</button>");
      if (st === "sent" || st === "overdue") b.push('<button type="button" class="btn ghost" data-act="record-payment">' + ICON.check + "Record a payment</button>");
    } else {
      if (st === "draft") b.push('<button type="button" class="btn ghost" data-act="mark-sent">' + ICON.check + "Mark as sent</button>");
      var made = d.id && S.all("documents").find(function (x) { return x.fromQuoteId === d.id; });
      if (made) b.push('<a class="btn ghost" href="#doc/' + esc(made.id) + '">' + ICON.swap + "Open invoice " + esc(made.number) + "</a>");
      else if (st !== "declined") b.push('<button type="button" class="btn ghost" data-act="to-invoice">' + ICON.swap + "Turn into invoice</button>");
      if (st === "sent" || st === "expired") b.push('<button type="button" class="btn ghost" data-act="declined">Declined</button>');
    }
    if (d.id) b.push('<button type="button" class="btn ghost" data-act="duplicate">' + ICON.copy + "Duplicate</button>");
    return b.join("");
  }

  function linesHTML(d) {
    return '<div class="line-head" aria-hidden="true"><span>Description</span><span>Qty</span><span>Price</span><span>Taxed</span><span>Amount</span><span></span></div>' +
      d.lines.map(function (l, i) {
        return '<div class="line" data-i="' + i + '">' +
          '<label class="l-desc"><span class="sr">Description</span><input data-lf="description" list="dl-items" value="' + esc(l.description) + '" placeholder="What you did or sold"></label>' +
          '<label class="l-qty"><span class="m-label">Qty</span><input inputmode="decimal" data-lf="qty" value="' + esc(l.qty) + '" aria-label="Quantity"></label>' +
          '<label class="l-price"><span class="m-label">Price</span><input inputmode="decimal" data-lf="price" value="' + (l.price ? M.plain(l.price) : "") + '" placeholder="0.00" aria-label="Unit price"></label>' +
          '<label class="l-tax"><input type="checkbox" data-lf="taxable"' + (l.taxable ? " checked" : "") + '><span class="m-label">Taxed</span></label>' +
          '<span class="l-amt" data-amt>' + fmt(C.lineTotal(l)) + "</span>" +
          '<span class="l-btns"><button type="button" class="icon-btn" data-act="save-item" title="Save to my items" aria-label="Save this line to my items">' + ICON.star + "</button>" +
          '<button type="button" class="icon-btn" data-act="remove-line" title="Remove line" aria-label="Remove this line">' + ICON.x + "</button></span>" +
          "</div>";
      }).join("");
  }

  function totalsHTML(d) {
    var t = C.totals(d);
    var rows = [["Subtotal", fmt(t.subtotal)]];
    if (t.discount) rows.push(["Discount", "−" + fmt(t.discount)]);
    if (t.tax || parseFloat(d.taxRate)) rows.push([(d.taxLabel || "Tax") + " " + (parseFloat(d.taxRate) || 0) + "%", fmt(t.tax)]);
    var html = '<dl class="totals">' + rows.map(function (r) { return "<div><dt>" + esc(r[0]) + "</dt><dd>" + r[1] + "</dd></div>"; }).join("") +
      '<div class="grand"><dt>Total</dt><dd>' + fmt(t.total) + "</dd></div>";
    if (t.deposit) html += "<div><dt>Deposit due now (" + (parseFloat(d.depositPercent) || 0) + "%)</dt><dd>" + fmt(t.deposit) + "</dd></div>";
    if (t.paid) html += "<div><dt>Paid</dt><dd>−" + fmt(t.paid) + '</dd></div><div class="grand"><dt>Balance due</dt><dd>' + fmt(t.balance) + "</dd></div>";
    return html + "</dl>";
  }

  function paymentsHTML(d) {
    if (!d.payments || !d.payments.length) return "";
    return '<section class="card"><h2 class="sec">Payments</h2><ul class="payments">' + d.payments.map(function (p, i) {
      return "<li><span>" + esc(fmtDate(p.date)) + (p.method ? " · " + esc(p.method) : "") + "</span><b>" + fmt(p.amount) + '</b><button type="button" class="icon-btn" data-act="remove-payment" data-i="' + i + '" aria-label="Remove this payment">' + ICON.x + "</button></li>";
    }).join("") + "</ul></section>";
  }

  // The printable document. Same markup on screen and on paper.
  function docHTML(d, p) {
    var pro = L.isPro();
    var t = C.totals(d), st = C.displayStatus(d);
    var accent = pro && /^#[0-9a-f]{6}$/i.test(p.accent || "") ? p.accent : "#3d5876";
    var isQuote = d.type === "quote";
    var c = d.customer || {};
    var head = (pro && p.logo ? '<img class="d-logo" src="' + esc(p.logo) + '" alt="">' : "") +
      '<div class="d-biz"><b>' + esc(p.name || "Your business name") + "</b>" +
      (p.address ? "<span>" + nl2br(p.address) + "</span>" : "") +
      "<span>" + esc([p.email, p.phone].filter(Boolean).join(" · ")) + "</span>" +
      (p.website ? "<span>" + esc(p.website) + "</span>" : "") +
      (p.taxId ? "<span>Tax ID " + esc(p.taxId) + "</span>" : "") + "</div>";
    var meta = '<div class="d-meta"><h2>' + typeName(d) + "</h2><dl>" +
      "<div><dt>Number</dt><dd>" + esc(d.number) + "</dd></div>" +
      "<div><dt>Date</dt><dd>" + esc(fmtDate(d.issueDate)) + "</dd></div>" +
      (isQuote ? (d.validUntil ? "<div><dt>Good until</dt><dd>" + esc(fmtDate(d.validUntil)) + "</dd></div>" : "")
               : (d.dueDate ? "<div><dt>Due</dt><dd>" + esc(fmtDate(d.dueDate)) + "</dd></div>" : "")) +
      (d.reference ? "<div><dt>Reference</dt><dd>" + esc(d.reference) + "</dd></div>" : "") + "</dl></div>";
    var to = '<div class="d-to"><span class="d-label">' + (isQuote ? "Prepared for" : "Billed to") + "</span>" +
      (c.name || c.company ? "<b>" + esc(c.name || c.company) + "</b>" + (c.name && c.company ? "<span>" + esc(c.company) + "</span>" : "") +
        (c.address ? "<span>" + nl2br(c.address) + "</span>" : "") +
        "<span>" + esc([c.email, c.phone].filter(Boolean).join(" · ")) + "</span>"
        : '<span class="d-placeholder">Customer name</span>') + "</div>";
    var lines = d.lines.filter(function (l) { return l.description || l.price; });
    var anyTaxFlag = parseFloat(d.taxRate) > 0 && lines.some(function (l) { return !l.taxable; });
    var table = '<table class="d-lines"><thead><tr><th>Description</th><th>Qty</th><th>Price</th><th>Amount</th></tr></thead><tbody>' +
      (lines.length ? lines.map(function (l) {
        return "<tr><td>" + esc(l.description) + (anyTaxFlag && !l.taxable ? ' <small class="d-nt">(not taxed)</small>' : "") + "</td><td>" + esc(l.qty) + (l.unit ? " " + esc(l.unit) : "") + "</td><td>" + fmt(l.price) + "</td><td>" + fmt(C.lineTotal(l)) + "</td></tr>";
      }).join("") : '<tr><td colspan="4" class="d-placeholder">Your lines will appear here</td></tr>') +
      "</tbody></table>";
    var tot = '<dl class="d-totals"><div><dt>Subtotal</dt><dd>' + fmt(t.subtotal) + "</dd></div>" +
      (t.discount ? "<div><dt>Discount</dt><dd>−" + fmt(t.discount) + "</dd></div>" : "") +
      (parseFloat(d.taxRate) ? "<div><dt>" + esc(d.taxLabel || "Tax") + " (" + (parseFloat(d.taxRate) || 0) + "%)</dt><dd>" + fmt(t.tax) + "</dd></div>" : "") +
      '<div class="d-grand"><dt>' + (isQuote ? "Total" : (t.paid ? "Total" : "Total due")) + "</dt><dd>" + fmt(t.total) + "</dd></div>" +
      (t.deposit ? '<div class="d-dep"><dt>Deposit due ' + (isQuote ? "on approval" : "now") + "</dt><dd>" + fmt(t.deposit) + "</dd></div>" : "") +
      (t.paid ? "<div><dt>Paid</dt><dd>−" + fmt(t.paid) + '</dd></div><div class="d-grand"><dt>Balance due</dt><dd>' + fmt(t.balance) + "</dd></div>" : "") +
      "</dl>";
    var notes = (d.paymentInstructions && !isQuote ? '<div class="d-note"><span class="d-label">How to pay</span><p>' + nl2br(d.paymentInstructions) + "</p></div>" : "") +
      (d.paymentInstructions && isQuote ? '<div class="d-note"><span class="d-label">Payment</span><p>' + nl2br(d.paymentInstructions) + "</p></div>" : "") +
      (d.notes ? '<div class="d-note"><span class="d-label">Note</span><p>' + nl2br(d.notes) + "</p></div>" : "") +
      (isQuote ? '<div class="d-note d-accept"><span class="d-label">Accepted by</span><div class="d-sign"><span>Signature</span><span>Date</span></div></div>' : "");
    var stamp = st === "paid" ? '<div class="d-stamp" aria-hidden="true">Paid</div>' : "";
    return '<article class="doc" style="--accent:' + accent + '">' +
      '<header class="d-head">' + '<div class="d-from">' + head + "</div>" + meta + "</header>" +
      to + table + '<div class="d-bottom"><div class="d-notes">' + notes + "</div>" + tot + "</div>" + stamp +
      (pro ? "" : '<p class="d-made">Made with Fair Measure</p>') + "</article>";
  }

  function refreshComputed() {
    var p = profile();
    $("#preview", app).innerHTML = docHTML(draft, p);
    $("#totals-card", app).innerHTML = totalsHTML(draft);
    $$(".line", app).forEach(function (row) {
      var l = draft.lines[+row.getAttribute("data-i")];
      if (l) row.querySelector("[data-amt]").textContent = fmt(C.lineTotal(l));
    });
  }

  function setPath(obj, path, val) {
    var parts = path.split("."), o = obj;
    for (var i = 0; i < parts.length - 1; i++) o = o[parts[i]];
    o[parts[parts.length - 1]] = val;
  }

  function bindEditor() {
    var form = $(".ed-form", app);
    form.addEventListener("submit", function (e) { e.preventDefault(); });

    form.addEventListener("input", function (e) {
      var el = e.target;
      var f = el.getAttribute("data-f"), lf = el.getAttribute("data-lf");
      if (f) {
        setPath(draft, f, el.type === "checkbox" ? el.checked : el.value);
        if (f.indexOf("customer.") === 0) {
          pendingCustomer = true;
          if (f === "customer.name") {
            var match = S.all("customers").find(function (c) { return c.name === el.value; });
            if (match && match.id !== draft.customerId) { setCustomer(match); fillCustomerFields(); }
          }
        }
        if ((f === "issueDate") && el.value) {
          // Keep the gap between date and due date when the date moves.
          var p = profile();
          if (draft.type === "invoice") { draft.dueDate = C.addDays(el.value, p.termsDays); $('[data-f="dueDate"]', app).value = draft.dueDate; }
          else { draft.validUntil = C.addDays(el.value, p.quoteValidDays); $('[data-f="validUntil"]', app).value = draft.validUntil; }
        }
        if (f === "number") delete draft._peekNumber;
      } else if (lf) {
        var row = el.closest(".line"), l = draft.lines[+row.getAttribute("data-i")];
        if (lf === "price") l.price = M.toCents(el.value);
        else if (lf === "taxable") l.taxable = el.checked;
        else if (lf === "qty") l.qty = el.value;
        else l[lf] = el.value;
        if (lf === "description") {
          var item = S.all("items").find(function (it) { return it.name === el.value; });
          if (item) {
            l.price = item.price; l.unit = item.unit || ""; l.taxable = item.taxable !== false;
            row.querySelector('[data-lf="price"]').value = M.plain(item.price);
            row.querySelector('[data-lf="taxable"]').checked = l.taxable;
          }
        }
      }
      refreshComputed();
      scheduleSave();
    });

    $$(".ed-switch [data-tab]", app).forEach(function (b) {
      b.addEventListener("click", function () {
        ui.tab = b.getAttribute("data-tab");
        $(".ed-grid", app).setAttribute("data-tab", ui.tab);
        $$(".ed-switch [data-tab]", app).forEach(function (x) { x.setAttribute("aria-selected", String(x === b)); });
      });
    });
  }

  function fillCustomerFields() {
    ["name", "company", "email", "phone", "address"].forEach(function (k) {
      var el = $('[data-f="customer.' + k + '"]', app);
      if (el && document.activeElement !== el) el.value = draft.customer[k] || "";
    });
  }

  function rebuildLines(focusIndex) {
    $("#lines", app).innerHTML = linesHTML(draft);
    refreshComputed();
    if (focusIndex != null) { var r = $$(".line", app)[focusIndex]; if (r) r.querySelector('[data-lf="description"]').focus(); }
  }

  function editorClick(e) {
    if (!draft) return;
    var btn = e.target.closest("[data-act]");
    if (!btn || !app.contains(btn)) return;
    var act = btn.getAttribute("data-act");
    var row = btn.closest(".line"), i = row ? +row.getAttribute("data-i") : -1;
    switch (act) {
      case "add-line":
        draft.lines.push(newLine()); rebuildLines(draft.lines.length - 1); scheduleSave(); break;
      case "remove-line":
        draft.lines.splice(i, 1);
        if (!draft.lines.length) draft.lines.push(newLine());
        rebuildLines(); scheduleSave(); break;
      case "save-item": saveLineAsItem(draft.lines[i]); break;
      case "quick-profile": quickProfile(); break;
      case "print": doPrint(); break;
      case "email": doEmail(); break;
      case "mark-sent": setStatus("sent", "Marked as sent"); break;
      case "declined": setStatus("declined", "Marked as declined"); break;
      case "record-payment": recordPayment(); break;
      case "remove-payment":
        draft.payments.splice(+btn.getAttribute("data-i"), 1);
        draft.paidAmount = draft.payments.reduce(function (s, p) { return s + p.amount; }, 0);
        if (draft.status === "paid" && C.totals(draft).balance > 0) draft.status = "sent";
        saveNow(); renderEditor(); break;
      case "to-invoice": toInvoice(); break;
      case "duplicate": duplicate(); break;
      case "delete": remove(); break;
    }
  }

  function setStatus(s, msg) {
    flushSave();
    if (!draft.id) { saveNow(); if (!draft.id) { FM.toast("Add a customer or a line first"); return; } }
    draft.status = s;
    commitCustomer();
    saveNow();
    renderEditor();
    FM.toast(msg);
  }

  function saveLineAsItem(l) {
    if (!l.description) { FM.toast("Give the line a description first"); return; }
    var existing = S.all("items").find(function (it) { return it.name.toLowerCase() === l.description.toLowerCase(); });
    if (existing) { S.put("items", Object.assign(existing, { price: l.price, unit: l.unit, taxable: l.taxable })); FM.toast("Updated in your items"); return; }
    canAdd("items").then(function (ok) {
      if (!ok) return;
      S.put("items", { name: l.description, price: l.price, unit: l.unit || "", taxable: l.taxable });
      FM.toast("Saved to your items");
      var dl = $("#dl-items", app);
      if (dl) dl.innerHTML = S.all("items").map(function (it) { return '<option value="' + esc(it.name) + '"></option>'; }).join("");
    });
  }

  function doPrint() {
    flushSave(); commitCustomer();
    if (!draft.customer.name && !draft.customer.company) { FM.toast("Add the customer's name first"); var n = $('[data-f="customer.name"]', app); if (n) n.focus(); return; }
    var before = document.title;
    document.title = typeName(draft) + " " + draft.number + (draft.customer.name ? " - " + draft.customer.name : "");
    window.print();
    setTimeout(function () { document.title = before; }, 500);
  }

  function doEmail() {
    flushSave(); commitCustomer();
    var p = profile(), t = C.totals(draft), isQuote = draft.type === "quote";
    var to = draft.customer.email || "";
    var subject = typeName(draft) + " " + draft.number + (p.name ? " from " + p.name : "");
    var greet = draft.customer.name ? "Hello " + draft.customer.name.split(" ")[0] + "," : "Hello,";
    var body = [greet, ""];
    if (isQuote) {
      body.push("Here is quote " + draft.number + " for " + fmt(t.total) + (draft.validUntil ? ", good until " + fmtDate(draft.validUntil) : "") + ".");
      if (t.deposit) body.push("A deposit of " + fmt(t.deposit) + " is due on approval.");
      body.push("", "Just reply to this email if you'd like to go ahead or have any questions.");
    } else {
      body.push("Here is invoice " + draft.number + " for " + fmt(t.balance) + (draft.dueDate ? ", due " + fmtDate(draft.dueDate) : "") + ".");
      if (draft.paymentInstructions) body.push("", "How to pay:", draft.paymentInstructions);
    }
    body.push("", "I've attached the " + typeName(draft).toLowerCase() + " as a PDF.", "", "Thank you,", p.owner || p.name || "");
    var href = "mailto:" + encodeURIComponent(to) + "?subject=" + encodeURIComponent(subject) + "&body=" + encodeURIComponent(body.join("\n"));
    FM.confirm({
      title: "Email this " + typeName(draft).toLowerCase(),
      body: "We'll open your email app with a message ready to go. First save the " + typeName(draft).toLowerCase() + " as a PDF (Print, then Save as PDF) so you can attach it.",
      ok: "Open my email", cancel: "Save PDF first"
    }).then(function (yes) {
      if (!yes) { doPrint(); return; }
      location.href = href;
      if (draft.status === "draft") setStatus("sent", "Marked as sent");
    });
  }

  function recordPayment() {
    var t = C.totals(draft);
    var dlg = document.createElement("dialog");
    dlg.className = "fm-dialog";
    dlg.innerHTML = '<form method="dialog" class="dlg-body"><h3>Record a payment</h3>' +
      field("Amount", '<input name="amount" inputmode="decimal" value="' + M.plain(t.balance) + '" required>') +
      '<div class="grid-2">' + field("Date", '<input type="date" name="date" value="' + C.today() + '">') +
      field("Method <i>(optional)</i>", '<input name="method" list="dl-methods" placeholder="Check, cash, card…">') + "</div>" +
      '<datalist id="dl-methods"><option value="Cash"><option value="Check"><option value="Card"><option value="Bank transfer"><option value="Zelle"><option value="Venmo"></datalist>' +
      '<div class="dlg-actions"><button class="btn ghost" value="cancel">Cancel</button><button class="btn" value="ok">Save payment</button></div></form>';
    document.body.appendChild(dlg);
    dlg.addEventListener("close", function () {
      if (dlg.returnValue === "ok") {
        var f = dlg.querySelector("form");
        var amt = M.toCents(f.amount.value);
        if (amt > 0) {
          draft.payments = draft.payments || [];
          draft.payments.push({ amount: amt, date: f.date.value || C.today(), method: f.method.value.trim() });
          draft.paidAmount = draft.payments.reduce(function (s, p) { return s + p.amount; }, 0);
          if (C.totals(draft).balance <= 0) draft.status = "paid";
          saveNow(); renderEditor();
          FM.toast(draft.status === "paid" ? "Paid in full. Well done!" : "Payment recorded");
        }
      }
      dlg.remove();
    });
    dlg.showModal();
  }

  function cloneAs(type) {
    var src = draft, fresh = blankDoc(type);
    fresh.customerId = src.customerId;
    fresh.customer = Object.assign({}, src.customer);
    fresh.lines = src.lines.map(function (l) { return Object.assign({}, l, { id: S.uid() }); });
    ["discountType", "discountValue", "taxLabel", "taxRate", "depositPercent", "notes", "reference"].forEach(function (k) { fresh[k] = src[k]; });
    if (type === "invoice") fresh.paymentInstructions = src.paymentInstructions || fresh.paymentInstructions;
    return fresh;
  }

  function toInvoice() {
    flushSave(); commitCustomer();
    canAdd("documents").then(function (ok) {
      if (!ok) return;
      if (draft.id && draft.status !== "accepted") { draft.status = "accepted"; S.put("documents", draft); }
      var inv = cloneAs("invoice");
      inv.fromQuoteId = draft.id || null;
      if (inv.depositPercent && draft.id) inv.notes = (inv.notes ? inv.notes + "\n" : "") + "Based on quote " + draft.number + ".";
      draft = inv;
      saveNow();
      renderEditor();
      FM.toast("Invoice made from the quote");
    });
  }

  function duplicate() {
    flushSave(); commitCustomer();
    canAdd("documents").then(function (ok) {
      if (!ok) return;
      draft = cloneAs(draft.type);
      saveNow(); renderEditor(); FM.toast("Copy made");
    });
  }

  function remove() {
    FM.confirm({ title: "Delete " + typeName(draft).toLowerCase() + " " + draft.number + "?", body: "This can't be undone. Your customer and items stay in your lists.", ok: "Delete", danger: true }).then(function (yes) {
      if (!yes) return;
      clearTimeout(saveTimer); saveTimer = null;
      S.remove("documents", draft.id);
      draft = null; pendingCustomer = false;
      go("");
      FM.toast("Deleted");
    });
  }

  function quickProfile() {
    var p = profile();
    var dlg = document.createElement("dialog");
    dlg.className = "fm-dialog";
    dlg.innerHTML = '<form method="dialog" class="dlg-body"><h3>Your business details</h3><p class="muted">These go at the top of every quote and invoice. You can add a logo and more in My business.</p>' +
      field("Business name", '<input name="name" value="' + esc(p.name) + '" required>') +
      '<div class="grid-2">' + field("Email", '<input type="email" name="email" value="' + esc(p.email) + '">') + field("Phone", '<input type="tel" name="phone" value="' + esc(p.phone) + '">') + "</div>" +
      field("Address", '<textarea name="address" rows="2">' + esc(p.address) + "</textarea>") +
      '<div class="grid-2">' + field("Usual tax rate (%)", '<input name="taxRate" inputmode="decimal" value="' + esc(p.taxRate) + '">') + field("Days to pay invoices", '<input name="termsDays" inputmode="numeric" value="' + esc(p.termsDays) + '">') + "</div>" +
      field("How customers pay you", '<textarea name="paymentInstructions" rows="2" placeholder="e.g. Check payable to…, or Zelle to…">' + esc(p.paymentInstructions) + "</textarea>") +
      '<div class="dlg-actions"><button class="btn ghost" value="cancel">Later</button><button class="btn" value="ok">Save</button></div></form>';
    document.body.appendChild(dlg);
    dlg.addEventListener("close", function () {
      if (dlg.returnValue === "ok") {
        var f = dlg.querySelector("form");
        var patch = { name: f.name.value.trim(), email: f.email.value.trim(), phone: f.phone.value.trim(), address: f.address.value.trim(),
          taxRate: parseFloat(f.taxRate.value) || 0, termsDays: parseInt(f.termsDays.value, 10) || 14, paymentInstructions: f.paymentInstructions.value.trim() };
        S.saveProfile(patch);
        // Carry the new defaults into this document where it still has the old ones.
        if (!draft.paymentInstructions) draft.paymentInstructions = patch.paymentInstructions;
        if (!parseFloat(draft.taxRate)) draft.taxRate = patch.taxRate;
        if (draft.type === "invoice" && !draft.id) draft.dueDate = C.addDays(draft.issueDate, patch.termsDays);
        renderEditor();
        FM.toast("Your details are saved");
      }
      dlg.remove();
    });
    dlg.showModal();
  }

  // ---------- customers
  function renderCustomers() {
    var docs = S.all("documents"), now = C.today();
    var list = S.all("customers").sort(function (a, b) { return (a.name || "").localeCompare(b.name || ""); });
    var cards = list.map(function (c) {
      var mine = docs.filter(function (d) { return d.customerId === c.id; });
      var owed = mine.reduce(function (s, d) { var st = C.displayStatus(d, now); return s + (d.type === "invoice" && (st === "sent" || st === "overdue") ? C.totals(d).balance : 0); }, 0);
      return '<div class="card person" data-id="' + esc(c.id) + '"><div class="person-main"><h3>' + esc(c.name || c.company) + "</h3>" +
        (c.company && c.name ? '<p class="muted">' + esc(c.company) + "</p>" : "") +
        '<p class="muted">' + esc([c.email, c.phone].filter(Boolean).join(" · ")) + "</p>" +
        '<p class="person-stats">' + mine.length + (mine.length === 1 ? " document" : " documents") + (owed ? ' · <span class="owed">' + fmt(owed) + " owed</span>" : "") + "</p></div>" +
        '<div class="person-actions"><a class="btn small" href="#new?c=' + esc(c.id) + '">New invoice</a><a class="btn small ghost" href="#new-quote?c=' + esc(c.id) + '">New quote</a>' +
        '<a class="btn small ghost" href="' + FM.link("customers/") + "#c/" + esc(c.id) + '">Notes</a>' +
        '<button class="btn small ghost" data-act="edit-c">Edit</button><button class="icon-btn" data-act="del-c" aria-label="Delete ' + esc(c.name) + '">' + ICON.trash + "</button></div></div>";
    }).join("");
    app.innerHTML = shell("customers", '<div class="wrap"><div class="list-bar"><p class="muted">Customers are added automatically from your quotes and invoices. They\'re shared with every Fair Measure tool.</p>' +
      '<button class="btn" data-act="add-c">' + ICON.plus + "Add a customer</button></div>" +
      '<div class="people">' + (cards || '<p class="muted none">No customers yet.</p>') + "</div>" + limitNote("customers") + "</div>");
    app.onclick = function (e) {
      var b = e.target.closest("[data-act]"); if (!b) return;
      var card = b.closest(".person"), id = card && card.getAttribute("data-id");
      var act = b.getAttribute("data-act");
      if (act === "add-c") canAdd("customers").then(function (ok) { if (ok) editRecord("customers", {}); });
      if (act === "edit-c") editRecord("customers", S.get("customers", id));
      if (act === "del-c") FM.confirm({ title: "Delete this customer?", body: "Their quotes and invoices stay; only the saved contact is removed.", ok: "Delete", danger: true })
        .then(function (y) { if (y) { S.remove("customers", id); renderCustomers(); } });
    };
  }

  // ---------- items
  function renderItems() {
    var list = S.all("items").sort(function (a, b) { return (a.name || "").localeCompare(b.name || ""); });
    var rows = list.map(function (it) {
      return '<div class="item-row" data-id="' + esc(it.id) + '"><span class="item-name">' + esc(it.name) + "</span>" +
        '<span class="item-price">' + fmt(it.price) + (it.unit ? ' <small class="muted">/ ' + esc(it.unit) + "</small>" : "") + "</span>" +
        "<span>" + (it.taxable === false ? '<span class="pill">Not taxed</span>' : '<span class="pill blue">Taxed</span>') + "</span>" +
        '<span class="item-btns"><button class="btn small ghost" data-act="edit-i">Edit</button><button class="icon-btn" data-act="del-i" aria-label="Delete ' + esc(it.name) + '">' + ICON.trash + "</button></span></div>";
    }).join("");
    app.innerHTML = shell("items", '<div class="wrap"><div class="list-bar"><p class="muted">Things you sell or do often. Start typing on a line and pick one to fill in the price. Tap the star on any line to save it here.</p>' +
      '<button class="btn" data-act="add-i">' + ICON.plus + "Add an item</button></div>" +
      '<div class="card items">' + (rows || '<p class="muted none">No saved items yet.</p>') + "</div>" + limitNote("items") + "</div>");
    app.onclick = function (e) {
      var b = e.target.closest("[data-act]"); if (!b) return;
      var row = b.closest(".item-row"), id = row && row.getAttribute("data-id");
      var act = b.getAttribute("data-act");
      if (act === "add-i") canAdd("items").then(function (ok) { if (ok) editRecord("items", { taxable: true }); });
      if (act === "edit-i") editRecord("items", S.get("items", id));
      if (act === "del-i") FM.confirm({ title: "Delete this item?", body: "Existing quotes and invoices keep their lines.", ok: "Delete", danger: true })
        .then(function (y) { if (y) { S.remove("items", id); renderItems(); } });
    };
  }

  function editRecord(col, rec) {
    var isC = col === "customers";
    var dlg = document.createElement("dialog");
    dlg.className = "fm-dialog";
    var body = isC
      ? field("Name", '<input name="name" value="' + esc(rec.name) + '" required>') + field("Company <i>(optional)</i>", '<input name="company" value="' + esc(rec.company) + '">') +
        '<div class="grid-2">' + field("Email", '<input type="email" name="email" value="' + esc(rec.email) + '">') + field("Phone", '<input type="tel" name="phone" value="' + esc(rec.phone) + '">') + "</div>" +
        field("Address", '<textarea name="address" rows="2">' + esc(rec.address) + "</textarea>") + field("Private notes", '<textarea name="notes" rows="2" placeholder="Only you see these">' + esc(rec.notes) + "</textarea>")
      : field("Name", '<input name="name" value="' + esc(rec.name) + '" required placeholder="e.g. Labor, per hour">') +
        '<div class="grid-2">' + field("Price", '<input name="price" inputmode="decimal" value="' + (rec.price ? M.plain(rec.price) : "") + '" placeholder="0.00">') + field("Unit <i>(optional)</i>", '<input name="unit" value="' + esc(rec.unit) + '" placeholder="hr, sq ft, dozen…">') + "</div>" +
        '<label class="check"><input type="checkbox" name="taxable"' + (rec.taxable !== false ? " checked" : "") + "> Charge tax on this item</label>";
    dlg.innerHTML = '<form method="dialog" class="dlg-body"><h3>' + (rec.id ? "Edit " : "Add ") + (isC ? "customer" : "item") + "</h3>" + body +
      '<div class="dlg-actions"><button class="btn ghost" value="cancel" formnovalidate>Cancel</button><button class="btn" value="ok">Save</button></div></form>';
    document.body.appendChild(dlg);
    dlg.addEventListener("close", function () {
      if (dlg.returnValue === "ok") {
        var f = dlg.querySelector("form");
        var out = Object.assign({}, rec);
        if (isC) ["name", "company", "email", "phone", "address", "notes"].forEach(function (k) { out[k] = f[k].value.trim(); });
        else { out.name = f.name.value.trim(); out.price = M.toCents(f.price.value); out.unit = f.unit.value.trim(); out.taxable = f.taxable.checked; }
        if (out.name) { S.put(col, out); FM.toast("Saved"); }
        if (isC) renderCustomers(); else renderItems();
      }
      dlg.remove();
    });
    dlg.showModal();
  }

  // ---------- start
  document.addEventListener("DOMContentLoaded", function () {
    app = document.getElementById("app");
    app.addEventListener("click", editorClick);
    window.addEventListener("hashchange", function () { app.onclick = null; route(); });
    // Another tab changed the data: refresh lists, but never yank an open editor.
    S.onChange(function (key, external) { if (external && !draft) route(); });
    route();
  });
})();
