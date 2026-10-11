/* Customer Book.
   Routes (in the address hash): list "", "#c/<id>", "#statement/<id>", "#import", "#new".
   Customers are the shared `customers` collection that Quotes & Invoices also fills.
   Notes live on the customer as `notes` (free text), `tags`, `log` (dated notes) and
   `followUps` ({id, due, what, done, doneAt}). History comes from the shared documents. */
(function () {
  "use strict";
  var FM = window.FM, S = FM.store, C = window.FMCalc, R = window.FMCrm, M = FM.money, L = FM.license, esc = FM.esc;
  var app;
  var ui = { filter: "all", q: "", sort: "name", imported: null };

  var ICON = {
    plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
    back: '<svg viewBox="0 0 24 24"><path d="M15 6l-6 6 6 6"/></svg>',
    search: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5"/></svg>',
    phone: '<svg viewBox="0 0 24 24"><path d="M6.5 4h3l1.5 4-2 1.5a11 11 0 0 0 5.5 5.5l1.5-2 4 1.5v3a2 2 0 0 1-2 2A15 15 0 0 1 4.5 6a2 2 0 0 1 2-2z"/></svg>',
    text: '<svg viewBox="0 0 24 24"><path d="M5 5h14a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H10l-4 3v-3H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z"/></svg>',
    mail: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/></svg>',
    pin: '<svg viewBox="0 0 24 24"><path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.3"/></svg>',
    note: '<svg viewBox="0 0 24 24"><path d="M5 19l1-4L16 5l3 3L9 18z"/><path d="M14 7l3 3"/></svg>',
    visit: '<svg viewBox="0 0 24 24"><path d="M4 11l8-6 8 6"/><path d="M6 10v9h12v-9M10 19v-5h4v5"/></svg>',
    doc: '<svg viewBox="0 0 24 24"><path d="M7 3h7l4 4v14H7z"/><path d="M14 3v4h4M10 12h5M10 16h5"/></svg>',
    coin: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><path d="M14.5 9.2c-.5-.8-1.4-1.2-2.5-1.2-1.5 0-2.5.8-2.5 2s1 1.6 2.5 2 2.5.9 2.5 2-1 2-2.5 2c-1.1 0-2-.4-2.5-1.2M12 6.5V8M12 16v1.5"/></svg>',
    check: '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7"/></svg>',
    bell: '<svg viewBox="0 0 24 24"><path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/></svg>',
    cal: '<svg viewBox="0 0 24 24"><rect x="4" y="5.5" width="16" height="15" rx="2"/><path d="M4 10h16M8.5 3.5v4M15.5 3.5v4"/></svg>',
    later: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><path d="M12 8v4.5l3 1.8"/></svg>',
    trash: '<svg viewBox="0 0 24 24"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>',
    print: '<svg viewBox="0 0 24 24"><path d="M7 9V4h10v5M7 17H5a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-2"/><path d="M7 14h10v6H7z"/></svg>',
    upload: '<svg viewBox="0 0 24 24"><path d="M12 15V4M7.5 8.5L12 4l4.5 4.5M5 15v4h14v-4"/></svg>',
    download: '<svg viewBox="0 0 24 24"><path d="M12 4v11M7.5 10.5L12 15l4.5-4.5M5 15v4h14v-4"/></svg>',
    merge: '<svg viewBox="0 0 24 24"><path d="M6 4v4a6 6 0 0 0 6 6h0a6 6 0 0 1 6 6M18 4v4a6 6 0 0 1-3 5.2"/></svg>'
  };
  var KINDS = { note: ["Note", ICON.note], call: ["Call", ICON.phone], visit: ["Visit", ICON.visit], email: ["Email", ICON.mail] };
  var DOC_STATUS = { draft: "Draft", sent: "Sent", paid: "Paid", overdue: "Overdue", accepted: "Accepted", declined: "Declined", expired: "Expired", void: "Void" };

  // ---------- helpers
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function fmt(c) { var p = S.profile(); return M.format(c, p.currency, p.locale || undefined); }
  function today() { return C.today(); }
  function fmtDate(iso, opts) {
    if (!iso) return "";
    try { return new Date(iso.slice(0, 10) + "T12:00:00").toLocaleDateString(undefined, opts || { year: "numeric", month: "short", day: "numeric" }); }
    catch (e) { return iso; }
  }
  function daysBetween(a, b) { return Math.round((Date.parse(b + "T12:00:00") - Date.parse(a + "T12:00:00")) / 86400000); }
  function dueLabel(due) {
    var d = daysBetween(today(), due);
    if (d < 0) return -d === 1 ? "1 day late" : -d + " days late";
    if (d === 0) return "Today";
    if (d === 1) return "Tomorrow";
    if (d < 7) return fmtDate(due, { weekday: "long" });
    return fmtDate(due, { month: "short", day: "numeric", year: due.slice(0, 4) === today().slice(0, 4) ? undefined : "numeric" });
  }
  function nl2br(s) { return esc(s).replace(/\n/g, "<br>"); }
  function field(label, control) { return '<label class="field"><span>' + label + "</span>" + control + "</label>"; }
  function go(hash) { if (location.hash === hash || (hash === "#" && !location.hash)) route(); else location.hash = hash; }
  function avatar(c, size) {
    var hue = 0, s = String(c.id || c.name || "");
    for (var i = 0; i < s.length; i++) hue = (hue * 31 + s.charCodeAt(i)) % 4;
    return '<span class="av av-' + hue + (size ? " " + size : "") + '" aria-hidden="true">' + esc(R.initials(c)) + "</span>";
  }
  function telHref(p) { return "tel:" + String(p).replace(/[^\d+]/g, ""); }
  function smsHref(p) { return "sms:" + String(p).replace(/[^\d+]/g, ""); }
  function invoicesLink(hash) { return FM.link("invoices/") + hash; }
  function customers() { return S.all("customers"); }
  function displayName(c) { return c.name || c.company || "Unnamed customer"; }

  function save(c) {
    try { return S.put("customers", c); }
    catch (e) { FM.toast(e.message); return c; }
  }
  function download(name, type, text) {
    var a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: type }));
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  function slug(s) { return String(s || "customer").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "customer"; }

  function limitDialog() {
    return FM.confirm({
      title: "You've reached the free limit",
      body: "The free version keeps up to " + L.limits.customers + " customers. Pro removes every limit for a one-time " + L.config.price + ". You can also delete old ones to make room.",
      ok: "See Pro", cancel: "Not now"
    }).then(function (yes) { if (yes) location.href = FM.link("settings/#pro"); return false; });
  }
  function canAdd() {
    return L.canAdd("customers", S.count("customers")).allowed ? Promise.resolve(true) : limitDialog();
  }
  function limitNote() {
    if (L.isPro()) return "";
    var used = S.count("customers"), lim = L.limits.customers;
    if (used < lim - 2) return "";
    return '<p class="limit-note muted">' + used + " of " + lim + ' free customers used. <a href="' + FM.link("settings/#pro") + '">Pro</a> removes the limit.</p>';
  }

  // ---------- routing
  function route() {
    var h = location.hash.replace(/^#/, "");
    window.scrollTo(0, 0);
    app.onclick = null;
    if (h.indexOf("c/") === 0) return renderCustomer(h.slice(2));
    if (h.indexOf("statement/") === 0) return renderStatement(h.slice(10));
    if (h === "import") return renderImport();
    renderList();
    if (h === "new") {
      history.replaceState(null, "", location.pathname + location.search);
      addCustomer();
    }
  }

  function head(inner) {
    return '<div class="wrap app-head no-print"><div class="app-title"><h1>Customer Book</h1>' +
      (L.isPro() ? '<span class="fm-pro-chip">Pro</span>' : "") + "</div>" + (inner || "") + "</div>";
  }

  // ---------- list
  function renderList() {
    var list = customers(), docs = S.all("documents"), now = today();
    var rows = list.map(function (c) { return { c: c, s: R.stats(c, docs, C, now), f: R.nextFollowUp(c) }; });
    var due = R.agenda(list, now);
    var soon = R.agenda(list, C.addDays(now, 7));
    var owing = rows.filter(function (r) { return r.s.owed > 0; });
    var owedTotal = owing.reduce(function (a, r) { return a + r.s.owed; }, 0);
    var tags = {};
    list.forEach(function (c) { (c.tags || []).forEach(function (t) { var k = t.toLowerCase(); tags[k] = tags[k] || t; }); });
    var tagList = Object.keys(tags).sort().slice(0, 8).map(function (k) { return tags[k]; });

    var q = ui.q.trim().toLowerCase();
    var shown = rows.filter(function (r) {
      var f = ui.filter;
      if (f === "follow" && !(r.f && r.f.due <= C.addDays(now, 7))) return false;
      if (f === "owes" && !(r.s.owed > 0)) return false;
      if (f.indexOf("tag:") === 0 && !(r.c.tags || []).some(function (t) { return t.toLowerCase() === f.slice(4); })) return false;
      if (q) {
        var hay = [r.c.name, r.c.company, r.c.email, r.c.phone, r.c.address, (r.c.tags || []).join(" "), r.c.notes].join(" ").toLowerCase();
        if (hay.indexOf(q) < 0) return false;
      }
      return true;
    }).sort(function (a, b) {
      if (ui.sort === "recent") return (b.s.last || b.c.updatedAt || "").localeCompare(a.s.last || a.c.updatedAt || "");
      if (ui.sort === "owed") return b.s.owed - a.s.owed || displayName(a.c).localeCompare(displayName(b.c));
      if (ui.sort === "billed") return b.s.billed - a.s.billed || displayName(a.c).localeCompare(displayName(b.c));
      return displayName(a.c).localeCompare(displayName(b.c), undefined, { sensitivity: "base" });
    });

    if (!list.length) {
      app.innerHTML = head() + '<div class="wrap"><div class="empty">' + emptyArt() +
        "<h2>Every customer in one quiet place</h2>" +
        '<p class="muted">Keep phone numbers, notes and follow-ups together, and see each customer\'s quotes, invoices and payments without digging. Customers you bill in Quotes &amp; Invoices show up here on their own.</p>' +
        '<div class="empty-actions"><button class="btn" data-act="add">' + ICON.plus + 'Add a customer</button><a class="btn ghost" href="#import">' + ICON.upload + "Bring in your contacts</a></div>" +
        '<p class="muted small">Everything stays on this device. Nothing is uploaded.</p></div></div>';
      app.onclick = function (e) { if (e.target.closest('[data-act="add"]')) addCustomer(); };
      return;
    }

    var agendaHTML = soon.length ? '<section class="card agenda" aria-labelledby="agenda-h"><div class="agenda-head"><h2 class="sec" id="agenda-h">' + ICON.bell +
      (due.length ? "Follow up now" : "Coming up this week") + "</h2>" +
      '<span class="muted">' + (due.length ? due.length + (due.length === 1 ? " is" : " are") + " due" : "Nothing due today") + "</span></div>" +
      '<ul class="agenda-list">' + soon.slice(0, 6).map(function (a) { return agendaRow(a.customer, a.followUp); }).join("") + "</ul>" +
      (soon.length > 6 ? '<button class="btn small ghost" data-filter="follow">See all ' + soon.length + "</button>" : "") + "</section>" : "";

    var chips = [["all", "All"], ["follow", "Follow up"], ["owes", "Owes you"]].concat(tagList.map(function (t) { return ["tag:" + t.toLowerCase(), t]; }));
    app.innerHTML = head('<div class="head-actions"><button class="btn" data-act="add">' + ICON.plus + 'Add a customer</button><a class="btn ghost" href="#import">' + ICON.upload + "Import</a>" +
      '<button class="btn ghost" data-act="export">' + ICON.download + "Export</button></div>") +
      '<div class="wrap">' + backupNote() +
      '<div class="tiles">' +
      '<div class="tile"><span>Customers</span><b>' + list.length + "</b><small>" + (rows.filter(function (r) { return r.s.last >= C.addDays(now, -90); }).length) + " active in the last 90 days</small></div>" +
      '<div class="tile' + (due.length ? " warm" : "") + '"><span>Follow-ups due</span><b>' + due.length + "</b><small>" + (soon.length - due.length) + " more this week</small></div>" +
      '<div class="tile"><span>Owed to you</span><b>' + fmt(owedTotal) + "</b><small>" + owing.length + (owing.length === 1 ? " customer" : " customers") + "</small></div></div>" +
      agendaHTML +
      '<div class="list-bar"><div class="chips" role="group" aria-label="Show">' + chips.map(function (c) {
        return '<button type="button" class="chip" data-filter="' + esc(c[0]) + '" aria-pressed="' + (ui.filter === c[0]) + '">' + esc(c[1]) + "</button>";
      }).join("") + "</div>" +
      '<label class="search"><span class="sr">Search customers</span>' + ICON.search + '<input type="search" id="q" placeholder="Search names, notes, tags" value="' + esc(ui.q) + '"></label>' +
      '<label class="sort"><span class="sr">Sort by</span><select id="sort">' +
      [["name", "A to Z"], ["recent", "Most recent"], ["owed", "Most owed"], ["billed", "Best customers"]].map(function (o) {
        return '<option value="' + o[0] + '"' + (ui.sort === o[0] ? " selected" : "") + ">" + o[1] + "</option>";
      }).join("") + "</select></label></div>" +
      '<div class="people">' + (shown.map(personCard).join("") || '<p class="muted none">Nothing matches. Try another filter or search.</p>') + "</div>" +
      limitNote() + "</div>";

    $$(".chip", app).forEach(function (b) { b.addEventListener("click", function () { ui.filter = b.getAttribute("data-filter"); renderList(); }); });
    var qi = $("#q", app);
    qi.addEventListener("input", function () {
      ui.q = qi.value; var pos = qi.selectionStart; renderList();
      var n = $("#q", app); n.focus(); n.setSelectionRange(pos, pos);
    });
    $("#sort", app).addEventListener("change", function (e) { ui.sort = e.target.value; renderList(); });
    app.onclick = function (e) {
      var b = e.target.closest("[data-act],[data-filter]"); if (!b) return;
      if (b.hasAttribute("data-filter") && !b.classList.contains("chip")) { ui.filter = b.getAttribute("data-filter"); renderList(); return; }
      var act = b.getAttribute("data-act");
      if (act === "add") addCustomer();
      if (act === "export") exportCSV();
      if (act === "backup") { FM.backup.download(); FM.toast("Backup downloaded"); renderList(); }
      if (act === "fu-done" || act === "fu-later") {
        var row = b.closest("[data-cid]");
        followAction(row.getAttribute("data-cid"), row.getAttribute("data-fid"), act === "fu-done" ? "done" : "later");
        renderList();
      }
    };
  }

  function backupNote() {
    return FM.backup.due()
      ? '<div class="notice blue backup-note"><span>Your business book lives on this device. Download a backup now and then so nothing is lost.</span><button class="btn small ghost" data-act="backup">Download backup</button></div>'
      : "";
  }

  function agendaRow(c, f) {
    var st = R.followState(f, today());
    return '<li class="agenda-row" data-cid="' + esc(c.id) + '" data-fid="' + esc(f.id) + '">' + avatar(c) +
      '<a class="agenda-who" href="#c/' + esc(c.id) + '"><b>' + esc(displayName(c)) + "</b><span>" + esc(f.what || "Follow up") + "</span></a>" +
      '<span class="due due-' + st + '">' + esc(dueLabel(f.due)) + "</span>" +
      '<span class="agenda-btns"><button class="btn small ghost" data-act="fu-later" title="Move it a week later">' + ICON.later + '<span class="hide-sm">A week later</span><span class="sr"> for ' + esc(displayName(c)) + "</span></button>" +
      '<button class="btn small" data-act="fu-done">' + ICON.check + 'Done<span class="sr"> with ' + esc(displayName(c)) + "</span></button></span></li>";
  }

  function personCard(r) {
    var c = r.c, bits = [];
    if (r.f) bits.push('<span class="due due-' + R.followState(r.f, today()) + '">' + ICON.bell + esc(dueLabel(r.f.due)) + "</span>");
    if (r.s.owed) bits.push('<span class="owed">' + fmt(r.s.owed) + " owed</span>");
    if (r.s.last) bits.push('<span class="muted">Last seen ' + esc(fmtDate(r.s.last, { month: "short", day: "numeric", year: "numeric" })) + "</span>");
    return '<a class="person" href="#c/' + esc(c.id) + '">' + avatar(c) +
      '<span class="person-main"><b>' + esc(displayName(c)) + "</b>" +
      (c.company && c.name ? '<span class="muted">' + esc(c.company) + "</span>" : "") +
      '<span class="muted contact-line">' + esc([c.phone, c.email].filter(Boolean).join(" · ") || "No contact details yet") + "</span>" +
      ((c.tags || []).length ? '<span class="tags">' + c.tags.map(function (t) { return '<span class="tag">' + esc(t) + "</span>"; }).join("") + "</span>" : "") +
      "</span>" + (bits.length ? '<span class="person-meta">' + bits.join("") + "</span>" : "") + "</a>";
  }

  function emptyArt() {
    return '<svg class="art" viewBox="0 0 160 120" aria-hidden="true">' +
      '<path d="M22 98c10-6 26-8 58-8s48 2 58 8" fill="none" stroke="#e7ddcd" stroke-width="3" stroke-linecap="round"/>' +
      '<rect x="38" y="20" width="84" height="70" rx="8" fill="#fffdf9" stroke="#3d5876" stroke-width="2.2"/>' +
      '<path d="M80 22v66" stroke="#e7ddcd" stroke-width="2"/>' +
      '<circle cx="59" cy="45" r="9" fill="#e5ebf2" stroke="#3d5876" stroke-width="2"/>' +
      '<path d="M46 70c2-8 7-12 13-12s11 4 13 12" fill="#e5ebf2" stroke="#3d5876" stroke-width="2" stroke-linecap="round"/>' +
      '<path d="M90 40h22M90 50h16M90 62h22M90 72h12" stroke="#b6aa9c" stroke-width="2.4" stroke-linecap="round"/>' +
      '<path d="M114 12c6 4 9 10 8 17" fill="none" stroke="#9c7630" stroke-width="2" stroke-linecap="round"/>' +
      '<path d="M110 14c5-1 9 1 12 6" fill="#f5ead0" stroke="#9c7630" stroke-width="1.8"/></svg>';
  }

  // ---------- follow-up actions
  function followAction(cid, fid, what) {
    var c = S.get("customers", cid); if (!c) return;
    var f = (c.followUps || []).find(function (x) { return x.id === fid; }); if (!f) return;
    if (what === "done") {
      f.done = true; f.doneAt = today();
      save(c);
      FM.toast("Marked done");
    } else if (what === "later") {
      f.due = C.addDays(f.due < today() ? today() : f.due, 7);
      save(c);
      FM.toast("Moved to " + fmtDate(f.due, { weekday: "short", month: "short", day: "numeric" }));
    } else if (what === "delete") {
      c.followUps = c.followUps.filter(function (x) { return x.id !== fid; });
      save(c);
    } else if (what === "undo") {
      f.done = false; delete f.doneAt;
      save(c);
    }
  }

  // ---------- add and edit
  function addCustomer() {
    canAdd().then(function (ok) { if (ok) editDialog({}); });
  }

  function editDialog(rec) {
    var dlg = document.createElement("dialog");
    dlg.className = "fm-dialog";
    dlg.innerHTML = '<form method="dialog" class="dlg-body"><h3>' + (rec.id ? "Edit customer" : "Add a customer") + "</h3>" +
      field("Name", '<input name="name" value="' + esc(rec.name) + '" required autocomplete="off">') +
      field("Company <i>(optional)</i>", '<input name="company" value="' + esc(rec.company) + '" autocomplete="off">') +
      '<div class="grid-2">' + field("Phone", '<input type="tel" name="phone" value="' + esc(rec.phone) + '" autocomplete="off">') +
      field("Email", '<input type="email" name="email" value="' + esc(rec.email) + '" autocomplete="off">') + "</div>" +
      field("Address", '<textarea name="address" rows="2">' + esc(rec.address) + "</textarea>") +
      field("Tags <i>(optional, separated by commas)</i>", '<input name="tags" value="' + esc((rec.tags || []).join(", ")) + '" placeholder="e.g. Regular, Wholesale, Church">') +
      '<p class="err" hidden></p>' +
      '<div class="dlg-actions"><button class="btn ghost" value="cancel" formnovalidate>Cancel</button><button class="btn" value="ok">Save</button></div></form>';
    document.body.appendChild(dlg);
    var form = dlg.querySelector("form");
    form.addEventListener("submit", function (e) {
      if (e.submitter && e.submitter.value === "cancel") return;
      if (!form.name.value.trim()) { e.preventDefault(); var er = form.querySelector(".err"); er.textContent = "Add a name so you can find them later."; er.hidden = false; form.name.focus(); }
    });
    dlg.addEventListener("close", function () {
      if (dlg.returnValue === "ok") {
        var out = Object.assign({}, rec);
        ["name", "company", "email", "phone", "address"].forEach(function (k) { out[k] = form[k].value.trim(); });
        out.tags = form.tags.value.split(",").map(function (t) { return t.trim(); }).filter(Boolean)
          .filter(function (t, i, a) { return a.map(function (x) { return x.toLowerCase(); }).indexOf(t.toLowerCase()) === i; });
        if (!out.id && !L.canAdd("customers", S.count("customers")).allowed) { limitDialog(); dlg.remove(); return; }
        var saved = save(out);
        FM.toast(rec.id ? "Saved" : "Customer added");
        dlg.remove();
        go("#c/" + saved.id);
        return;
      }
      dlg.remove();
    });
    dlg.showModal();
  }

  // ---------- one customer
  function renderCustomer(id) {
    var c = S.get("customers", id);
    if (!c) { FM.toast("That customer isn't on this device"); go("#"); return; }
    var docs = S.all("documents"), now = today();
    var s = R.stats(c, docs, C, now);
    var open = R.openFollowUps(c);
    var events = R.timeline(c, docs, C, now);
    var dup = R.findDuplicate(c, customers());

    var contact = [];
    if (c.phone) contact.push('<li>' + ICON.phone + '<span><a href="' + esc(telHref(c.phone)) + '">' + esc(c.phone) + '</a></span><a class="mini" href="' + esc(smsHref(c.phone)) + '">Text</a></li>');
    if (c.email) contact.push('<li>' + ICON.mail + '<span><a href="mailto:' + esc(c.email) + '">' + esc(c.email) + "</a></span></li>");
    if (c.address) contact.push('<li>' + ICON.pin + "<span>" + nl2br(c.address) + "</span></li>");

    app.innerHTML =
      '<div class="wrap c-head no-print"><a class="back" href="#">' + ICON.back + "All customers</a>" +
      '<div class="c-title">' + avatar(c, "lg") + '<div><h1>' + esc(displayName(c)) + "</h1>" +
      (c.company && c.name ? '<p class="muted">' + esc(c.company) + "</p>" : "") +
      ((c.tags || []).length ? '<p class="tags">' + c.tags.map(function (t) { return '<span class="tag">' + esc(t) + "</span>"; }).join("") + "</p>" : "") + "</div></div>" +
      '<div class="c-actions"><a class="btn" href="' + esc(invoicesLink("#new?c=" + encodeURIComponent(c.id))) + '">' + ICON.doc + "New invoice</a>" +
      '<a class="btn ghost" href="' + esc(invoicesLink("#new-quote?c=" + encodeURIComponent(c.id))) + '">New quote</a>' +
      '<a class="btn ghost" href="#statement/' + esc(c.id) + '">' + ICON.print + "Statement</a>" +
      '<button class="btn ghost" data-act="edit">Edit</button></div></div>' +

      (dup ? '<div class="wrap"><div class="notice dup-note"><span>' + ICON.merge + "This looks like the same customer as <b>" + esc(displayName(dup)) + "</b>" +
        (dup.company ? " (" + esc(dup.company) + ")" : "") + '. Merge them to keep one history.</span><button class="btn small" data-act="merge-dup" data-id="' + esc(dup.id) + '">Merge them</button></div></div>' : "") +

      '<div class="wrap c-grid">' +
      '<div class="c-side">' +
      '<section class="card k-contact"><h2 class="sec">Contact</h2>' + (contact.length ? '<ul class="contact">' + contact.join("") + "</ul>" :
        '<p class="muted">No phone, email or address yet.</p><button class="btn small ghost" data-act="edit">Add contact details</button>') + "</section>" +
      '<section class="card k-money"><h2 class="sec">Money</h2><dl class="money">' +
      "<div><dt>Billed</dt><dd>" + fmt(s.billed) + "</dd></div>" +
      "<div><dt>Paid</dt><dd>" + fmt(s.paid) + "</dd></div>" +
      '<div class="' + (s.overdue ? "late" : "") + '"><dt>' + (s.overdue ? "Owed, some overdue" : "Owed") + "</dt><dd>" + fmt(s.owed) + "</dd></div>" +
      "</dl><p class=\"muted small\">" + s.invoices + (s.invoices === 1 ? " invoice" : " invoices") + ", " + s.quotes + (s.quotes === 1 ? " quote" : " quotes") +
      (s.openQuotes ? " (" + s.openQuotes + " waiting for an answer)" : "") + (s.first ? ". Customer since " + esc(fmtDate(s.first, { month: "long", year: "numeric" })) : "") + ".</p></section>" +
      '<section class="card k-about"><h2 class="sec"><label for="about">About them</label></h2>' +
      '<textarea id="about" class="input about" rows="4" placeholder="Anything worth remembering: how they found you, what they like, gate code, best time to call. Only you see this.">' + esc(c.notes) + "</textarea>" +
      '<span class="muted small" id="about-saved" aria-live="polite"></span></section>' +
      '<div class="side-links"><button class="link-btn" data-act="merge">' + ICON.merge + "Merge with another customer</button>" +
      '<button class="link-btn danger" data-act="delete">' + ICON.trash + "Delete customer</button></div>" +
      "</div>" +

      '<div class="c-main">' +
      '<section class="card k-follow"><h2 class="sec">Follow-ups</h2>' +
      (open.length ? '<ul class="fu-list">' + open.map(function (f) {
        var st = R.followState(f, now);
        return '<li class="fu" data-fid="' + esc(f.id) + '"><button class="tick" data-act="fu-done" aria-label="Mark done: ' + esc(f.what || "follow up") + '">' + ICON.check + "</button>" +
          '<span class="fu-what"><b>' + esc(f.what || "Follow up") + '</b><span class="due due-' + st + '">' + esc(dueLabel(f.due)) + (st === "upcoming" ? "" : " · " + esc(fmtDate(f.due))) + "</span></span>" +
          '<span class="fu-btns"><button class="icon-btn" data-act="fu-later" aria-label="A week later" title="A week later">' + ICON.later + "</button>" +
          '<button class="icon-btn" data-act="fu-ics" aria-label="Add to my calendar" title="Add to my calendar">' + ICON.cal + "</button>" +
          '<button class="icon-btn" data-act="fu-del" aria-label="Remove" title="Remove">' + ICON.trash + "</button></span></li>";
      }).join("") + "</ul>" : '<p class="muted">Nothing planned. Add a reminder so no one slips through the cracks.</p>') +
      '<form class="fu-add" id="fu-add" autocomplete="off"><div class="fu-row">' +
      field("Reminder", '<input name="what" placeholder="e.g. Check how the shelves are holding up" maxlength="200">') +
      field("When", '<input type="date" name="due" value="' + C.addDays(now, 7) + '" required>') + "</div>" +
      '<div class="fu-row2"><div class="quick" role="group" aria-label="Quick dates">' +
      [[1, "Tomorrow"], [7, "Next week"], [30, "In a month"], [90, "In 3 months"], [365, "In a year"]].map(function (q) {
        return '<button type="button" class="chip small" data-days="' + q[0] + '">' + q[1] + "</button>";
      }).join("") + '</div><button class="btn small" type="submit">' + ICON.plus + "Add reminder</button></div></form></section>" +

      '<section class="card k-history"><h2 class="sec">History</h2>' +
      '<form class="log-add" id="log-add" autocomplete="off"><label class="sr" for="log-text">Add a note</label>' +
      '<textarea id="log-text" name="text" rows="2" class="input" placeholder="Add a note about a call, a visit, or anything that happened"></textarea>' +
      '<div class="log-row"><div class="kinds" role="radiogroup" aria-label="Kind">' + Object.keys(KINDS).map(function (k, i) {
        return '<label class="kind"><input type="radio" name="kind" value="' + k + '"' + (i === 0 ? " checked" : "") + ">" + KINDS[k][1] + "<span>" + KINDS[k][0] + "</span></label>";
      }).join("") + '</div><button class="btn small" type="submit">Save note</button></div></form>' +
      (events.length ? '<ol class="timeline">' + events.map(eventHTML).join("") + "</ol>" :
        '<p class="muted none-small">Quotes, invoices, payments and notes will gather here.</p>') +
      "</section></div></div>";

    // About notes save quietly as you type.
    var about = $("#about", app), aboutTimer;
    about.addEventListener("input", function () {
      clearTimeout(aboutTimer);
      $("#about-saved", app).textContent = "Saving…";
      aboutTimer = setTimeout(function () {
        var cur = S.get("customers", id); if (!cur) return;
        cur.notes = about.value; save(cur);
        $("#about-saved", app).textContent = "Saved";
      }, 500);
    });

    var fuForm = $("#fu-add", app);
    $$("[data-days]", fuForm).forEach(function (b) {
      b.addEventListener("click", function () { fuForm.due.value = C.addDays(today(), parseInt(b.getAttribute("data-days"), 10)); });
    });
    fuForm.addEventListener("submit", function (e) {
      e.preventDefault();
      if (!fuForm.due.value) { fuForm.due.focus(); return; }
      var cur = S.get("customers", id);
      cur.followUps = (cur.followUps || []).concat({ id: S.uid(), due: fuForm.due.value, what: fuForm.what.value.trim(), done: false });
      save(cur);
      FM.toast("Reminder added for " + fmtDate(fuForm.due.value, { weekday: "short", month: "short", day: "numeric" }));
      renderCustomer(id);
    });

    var logForm = $("#log-add", app);
    logForm.addEventListener("submit", function (e) {
      e.preventDefault();
      var text = logForm.text.value.trim();
      if (!text) { logForm.text.focus(); return; }
      var cur = S.get("customers", id);
      cur.log = (cur.log || []).concat({ id: S.uid(), date: today(), kind: logForm.kind.value, text: text, at: new Date().toISOString() });
      save(cur);
      renderCustomer(id);
      FM.toast("Note saved");
    });

    app.onclick = function (e) {
      var b = e.target.closest("[data-act]"); if (!b) return;
      var act = b.getAttribute("data-act");
      var fu = b.closest("[data-fid]"), fid = fu && fu.getAttribute("data-fid");
      if (act === "edit") return editDialog(S.get("customers", id));
      if (act === "fu-done") { followAction(id, fid, "done"); return renderCustomer(id); }
      if (act === "fu-later") { followAction(id, fid, "later"); return renderCustomer(id); }
      if (act === "fu-del") { followAction(id, fid, "delete"); return renderCustomer(id); }
      if (act === "fu-undo") { followAction(id, fid, "undo"); return renderCustomer(id); }
      if (act === "fu-ics") {
        var cur = S.get("customers", id), f = cur.followUps.find(function (x) { return x.id === fid; });
        download("follow-up-" + slug(cur.name) + "-" + f.due + ".ics", "text/calendar", R.ics(cur, f));
        FM.toast("Open the file to add it to your calendar");
        return;
      }
      if (act === "log-del") {
        var lid = b.getAttribute("data-id");
        FM.confirm({ title: "Delete this note?", ok: "Delete", danger: true }).then(function (y) {
          if (!y) return;
          var cur = S.get("customers", id);
          cur.log = (cur.log || []).filter(function (n) { return n.id !== lid; });
          save(cur); renderCustomer(id);
        });
        return;
      }
      if (act === "merge-dup") return confirmMerge(id, b.getAttribute("data-id"));
      if (act === "merge") return mergeDialog(id);
      if (act === "delete") {
        FM.confirm({ title: "Delete " + displayName(S.get("customers", id)) + "?", body: "Their notes and reminders are removed. Their quotes and invoices stay in Quotes & Invoices.", ok: "Delete", danger: true })
          .then(function (y) { if (y) { S.remove("customers", id); FM.toast("Customer deleted"); go("#"); } });
      }
    };
  }

  function eventHTML(ev) {
    var date = '<time datetime="' + esc(ev.date) + '">' + esc(fmtDate(ev.date)) + "</time>";
    if (ev.kind === "quote" || ev.kind === "invoice") {
      return '<li class="ev ev-doc">' + '<span class="ev-ic">' + ICON.doc + "</span>" +
        '<span class="ev-body"><a href="' + esc(invoicesLink("#doc/" + encodeURIComponent(ev.docId))) + '"><b>' + (ev.kind === "quote" ? "Quote " : "Invoice ") + esc(ev.number || "") + "</b></a>" +
        '<span class="muted"> · ' + fmt(ev.amount) + " · " + esc(DOC_STATUS[ev.status] || ev.status) + "</span>" + date + "</span></li>";
    }
    if (ev.kind === "payment") {
      return '<li class="ev ev-pay"><span class="ev-ic">' + ICON.coin + '</span><span class="ev-body"><b>Paid ' + fmt(ev.amount) + "</b>" +
        '<span class="muted"> on ' + esc(ev.number || "an invoice") + "</span>" + date + "</span></li>";
    }
    if (ev.kind === "done") {
      return '<li class="ev ev-done" data-fid="' + esc(ev.id) + '"><span class="ev-ic">' + ICON.check + '</span><span class="ev-body"><b>Followed up</b>' +
        (ev.text ? '<span class="muted">: ' + esc(ev.text) + "</span>" : "") + date + '<button class="link-btn small" data-act="fu-undo">Undo</button></span></li>';
    }
    var k = KINDS[ev.kind] || KINDS.note;
    return '<li class="ev ev-note"><span class="ev-ic">' + k[1] + '</span><span class="ev-body"><span class="ev-kind">' + k[0] + "</span>" +
      '<p class="ev-text">' + nl2br(ev.text) + "</p>" + date +
      '<button class="link-btn small" data-act="log-del" data-id="' + esc(ev.id) + '">Delete</button></span></li>';
  }

  // ---------- merging
  function mergeDialog(id) {
    var me = S.get("customers", id);
    var others = customers().filter(function (c) { return c.id !== id; })
      .sort(function (a, b) { return displayName(a).localeCompare(displayName(b)); });
    if (!others.length) { FM.toast("There's no other customer to merge with"); return; }
    var dlg = document.createElement("dialog");
    dlg.className = "fm-dialog";
    dlg.innerHTML = '<form method="dialog" class="dlg-body"><h3>Merge into ' + esc(displayName(me)) + "</h3>" +
      '<p class="muted">Pick the duplicate. Its notes, reminders and quotes and invoices move here, then the duplicate is removed.</p>' +
      field("Duplicate", '<select name="other">' + others.map(function (c) {
        return '<option value="' + esc(c.id) + '">' + esc(displayName(c) + (c.company && c.name ? " (" + c.company + ")" : "") + (c.email ? " · " + c.email : "")) + "</option>";
      }).join("") + "</select>") +
      '<div class="dlg-actions"><button class="btn ghost" value="cancel">Cancel</button><button class="btn" value="ok">Merge</button></div></form>';
    document.body.appendChild(dlg);
    dlg.addEventListener("close", function () {
      var other = dlg.querySelector("select").value;
      dlg.remove();
      if (dlg.returnValue === "ok") doMerge(id, other);
    });
    dlg.showModal();
  }
  // From the duplicate notice: the older record is kept, so its name and history lead.
  function confirmMerge(id, otherId) {
    var me = S.get("customers", id), o = S.get("customers", otherId);
    var older = (o.createdAt || "") < (me.createdAt || "") ? o : me, newer = older === o ? me : o;
    FM.confirm({ title: "Merge " + displayName(newer) + " into " + displayName(older) + "?", body: "Notes, reminders, and quotes and invoices come together under " + displayName(older) + ". Details only the other one has are filled in.", ok: "Merge", cancel: "Not now" })
      .then(function (y) { if (y) doMerge(older.id, newer.id); });
  }
  function doMerge(id, otherId) {
    var keep = S.get("customers", id), from = S.get("customers", otherId);
    if (!keep || !from) return;
    S.all("documents").forEach(function (d) { if (d.customerId === otherId) { d.customerId = id; S.put("documents", d); } });
    save(R.merge(keep, from));
    S.remove("customers", otherId);
    FM.toast("Merged");
    if (location.hash === "#c/" + id) renderCustomer(id); else go("#c/" + id);
  }

  // ---------- statement of account
  function renderStatement(id) {
    var c = S.get("customers", id);
    if (!c) { go("#"); return; }
    var p = S.profile(), pro = L.isPro(), now = today();
    var accent = pro && /^#[0-9a-f]{6}$/i.test(p.accent || "") ? p.accent : "#3d5876";
    var open = R.docsFor(c, S.all("documents")).filter(function (d) {
      var st = C.displayStatus(d, now); return d.type === "invoice" && (st === "sent" || st === "overdue");
    }).sort(function (a, b) { return (a.issueDate || "").localeCompare(b.issueDate || ""); });
    var total = 0, late = 0;
    var rows = open.map(function (d) {
      var t = C.totals(d), st = C.displayStatus(d, now);
      total += t.balance; if (st === "overdue") late += t.balance;
      return "<tr><td>" + esc(d.number) + (d.reference ? '<span class="st-ref">' + esc(d.reference) + "</span>" : "") + "</td><td>" + esc(fmtDate(d.issueDate)) + "</td>" +
        '<td class="' + (st === "overdue" ? "st-late" : "") + '">' + esc(fmtDate(d.dueDate)) + (st === "overdue" ? " (overdue)" : "") + "</td>" +
        "<td>" + fmt(t.total) + "</td><td>" + fmt(t.paid) + "</td><td><b>" + fmt(t.balance) + "</b></td></tr>";
    }).join("");
    var bizLines = [p.address, [p.email, p.phone].filter(Boolean).join(" · ")].filter(Boolean);
    var toLines = [c.company && c.name ? c.company : "", c.address, c.email].filter(Boolean);

    var summary = "Statement for " + displayName(c) + " as of " + fmtDate(now) + "\n\n" +
      (open.length ? open.map(function (d) { return d.number + ", due " + fmtDate(d.dueDate) + ": " + fmt(C.totals(d).balance); }).join("\n") + "\n\nTotal due: " + fmt(total) : "Nothing is owed. Thank you!") +
      (p.paymentInstructions && open.length ? "\n\nHow to pay:\n" + p.paymentInstructions : "") + (p.name ? "\n\n" + p.name : "");

    app.innerHTML = '<div class="wrap c-head no-print"><a class="back" href="#c/' + esc(c.id) + '">' + ICON.back + esc(displayName(c)) + "</a>" +
      '<div class="c-title"><div><h1>Statement</h1><p class="muted">Every unpaid invoice for ' + esc(displayName(c)) + " on one page.</p></div></div>" +
      '<div class="c-actions"><button class="btn" data-act="print">' + ICON.print + "Print or save PDF</button>" +
      (c.email ? '<a class="btn ghost" href="mailto:' + esc(c.email) + "?subject=" + encodeURIComponent("Statement from " + (p.name || "us")) + "&body=" + encodeURIComponent(summary) + '">' + ICON.mail + "Email</a>" : "") +
      "</div></div>" +
      '<div class="wrap"><div class="st-shell"><article class="st" style="--accent:' + accent + '">' +
      '<div class="st-head"><div class="st-from">' + (pro && p.logo ? '<img class="st-logo" src="' + esc(p.logo) + '" alt="">' : "") +
      "<div><b>" + esc(p.name || "Your business name") + "</b>" + bizLines.map(function (l) { return "<span>" + nl2br(l) + "</span>"; }).join("") + "</div></div>" +
      '<div class="st-meta"><h2>Statement</h2><span>' + esc(fmtDate(now)) + "</span></div></div>" +
      '<div class="st-to"><span class="st-label">For</span><b>' + esc(displayName(c)) + "</b>" + toLines.map(function (l) { return "<span>" + nl2br(l) + "</span>"; }).join("") + "</div>" +
      (open.length ? '<table class="st-table"><thead><tr><th>Invoice</th><th>Date</th><th>Due</th><th>Amount</th><th>Paid</th><th>Balance</th></tr></thead><tbody>' + rows + "</tbody></table>" +
        '<div class="st-bottom"><div class="st-pay">' + (p.paymentInstructions ? '<span class="st-label">How to pay</span><p>' + nl2br(p.paymentInstructions) + "</p>" : "") + "</div>" +
        '<dl class="st-totals">' + (late ? "<div><dt>Overdue</dt><dd>" + fmt(late) + "</dd></div>" : "") + '<div class="st-grand"><dt>Total due</dt><dd>' + fmt(total) + "</dd></div></dl></div>"
        : '<p class="st-clear">Nothing is owed. Thank you for your business!</p>') +
      (pro ? "" : '<p class="st-made">Made with Fair Measure</p>') + "</article></div></div>";
    app.onclick = function (e) { if (e.target.closest('[data-act="print"]')) window.print(); };
  }

  // ---------- import
  function renderImport() {
    var room = L.isPro() ? Infinity : Math.max(0, L.limits.customers - S.count("customers"));
    var list = ui.imported;
    var body;
    if (!list) {
      body = '<section class="card imp-drop"><div class="imp-copy"><h2>Bring in the contacts you already have</h2>' +
        '<p class="muted">Choose a contacts file. We read it right here in your browser; nothing is uploaded.</p>' +
        '<label class="btn imp-pick">' + ICON.upload + 'Choose a file<input type="file" id="imp-file" accept=".csv,.vcf,.vcard,text/csv,text/vcard,text/x-vcard" class="sr"></label>' +
        '<p class="muted small">Works with .csv spreadsheets and .vcf contact cards.</p></div>' +
        '<div class="imp-how"><h3>Where to get the file</h3><dl>' +
        "<div><dt>Google Contacts</dt><dd>contacts.google.com, select contacts, then Export as Google CSV.</dd></div>" +
        "<div><dt>iPhone or Mac</dt><dd>In Contacts, select people and choose Share or Export vCard.</dd></div>" +
        "<div><dt>Android</dt><dd>Contacts app, then Settings, Export to a .vcf file.</dd></div>" +
        "<div><dt>Outlook</dt><dd>People, Manage, Export contacts (CSV).</dd></div>" +
        "<div><dt>A spreadsheet</dt><dd>Save it as CSV with headings like Name, Company, Email, Phone, Address.</dd></div></dl></div></section>";
    } else if (!list.length) {
      body = '<section class="card"><h2 class="sec">We couldn\'t find any contacts in that file</h2><p class="muted">Check that it\'s a .csv with a heading row (Name, Email, Phone…) or a .vcf contact file.</p>' +
        '<button class="btn ghost" data-act="again">Choose another file</button></section>';
    } else {
      var fresh = list.filter(function (x) { return !x.dup; }).length;
      body = '<section class="card imp-review"><div class="imp-top"><div><h2 class="sec">' + list.length + (list.length === 1 ? " contact" : " contacts") + " found</h2>" +
        '<p class="muted">' + (list.length - fresh ? (list.length - fresh) + " already in your book. Ticking one of those fills in any details it's missing. " : "") +
        (room === Infinity ? "" : "The free version keeps " + L.limits.customers + " customers; there's room for " + room + " more. ") + "</p></div>" +
        '<div class="imp-sel"><button class="link-btn" data-act="all">Select all</button><button class="link-btn" data-act="none">Select none</button></div></div>' +
        '<ul class="imp-list">' + list.map(function (x, i) {
          return '<li><label class="imp-row"><input type="checkbox" data-i="' + i + '"' + (x.pick ? " checked" : "") + ">" + avatar(x.c) +
            '<span class="imp-main"><b>' + esc(x.c.name) + "</b>" + '<span class="muted">' + esc([x.c.company, x.c.phone, x.c.email].filter(Boolean).join(" · ")) + "</span></span>" +
            (x.dup ? '<span class="pill gold">Already have ' + esc(displayName(x.dup)) + "</span>" : "") + "</label></li>";
        }).join("") + "</ul>" +
        '<div class="imp-actions"><button class="btn ghost" data-act="again">Choose another file</button><button class="btn" data-act="import" id="imp-go"></button></div></section>';
    }
    app.innerHTML = head() + '<div class="wrap imp"><a class="back" href="#">' + ICON.back + "All customers</a>" + body + "</div>";

    function updateCount() {
      var b = $("#imp-go", app); if (!b) return;
      var n = list.filter(function (x) { return x.pick; }).length;
      b.textContent = n ? "Add " + n + (n === 1 ? " customer" : " customers") : "Nothing selected";
      b.disabled = !n;
    }
    updateCount();

    var fi = $("#imp-file", app);
    if (fi) fi.addEventListener("change", function () {
      var file = fi.files[0]; if (!file) return;
      if (file.size > 5 * 1024 * 1024) { FM.toast("That file is too large to be a contacts file"); return; }
      file.text().then(function (text) {
        var found = R.parseContacts(text, file.name);
        var existing = customers(), left = room;
        ui.imported = found.map(function (c) {
          var dup = R.findDuplicate(c, existing);
          var pick = !dup && left > 0;
          if (pick) left--;
          return { c: c, dup: dup, pick: pick };
        });
        renderImport();
      });
    });
    $$(".imp-list input", app).forEach(function (cb) {
      cb.addEventListener("change", function () { list[cb.getAttribute("data-i")].pick = cb.checked; updateCount(); });
    });
    app.onclick = function (e) {
      var b = e.target.closest("[data-act]"); if (!b) return;
      var act = b.getAttribute("data-act");
      if (act === "again") { ui.imported = null; renderImport(); }
      if (act === "all" || act === "none") { list.forEach(function (x) { x.pick = act === "all"; }); renderImport(); }
      if (act === "import") doImport(list);
    };
  }

  function doImport(list) {
    var added = 0, updated = 0, skipped = 0;
    list.filter(function (x) { return x.pick; }).forEach(function (x) {
      if (x.dup) {
        var cur = S.get("customers", x.dup.id);
        if (cur) { var m = R.merge(cur, x.c); m.notes = cur.notes && x.c.notes && cur.notes.indexOf(x.c.notes) >= 0 ? cur.notes : m.notes; save(m); updated++; }
        return;
      }
      if (!L.canAdd("customers", S.count("customers")).allowed) { skipped++; return; }
      save(Object.assign({ tags: [], log: [], followUps: [] }, x.c));
      added++;
    });
    ui.imported = null;
    var msg = "Added " + added + (added === 1 ? " customer" : " customers") + (updated ? ", updated " + updated : "");
    FM.toast(msg);
    go("#");
    if (skipped) {
      FM.confirm({ title: skipped + (skipped === 1 ? " contact wasn't" : " contacts weren't") + " added",
        body: "The free version keeps up to " + L.limits.customers + " customers. Pro removes the limit for a one-time " + L.config.price + ", and you can import the same file again afterwards.",
        ok: "See Pro", cancel: "OK" }).then(function (y) { if (y) location.href = FM.link("settings/#pro"); });
    }
  }

  // ---------- export (Pro)
  function exportCSV() {
    if (!L.isPro()) {
      FM.confirm({ title: "Export is part of Pro", body: "Pro lets you download your customer book as a spreadsheet, with totals and next follow-ups, for a one-time " + L.config.price + ". Your full backup in My business is always free.", ok: "See Pro", cancel: "Not now" })
        .then(function (y) { if (y) location.href = FM.link("settings/#pro"); });
      return;
    }
    download("customers-" + today() + ".csv", "text/csv", "﻿" + R.toCSV(customers(), S.all("documents"), C, today()));
    FM.toast("Spreadsheet downloaded");
  }

  // ---------- start
  document.addEventListener("DOMContentLoaded", function () {
    app = document.getElementById("app");
    window.addEventListener("hashchange", route);
    // Another tab or tool changed the book: refresh, unless someone is typing here.
    S.onChange(function (key, external) {
      if (!external || (key !== "customers" && key !== "documents" && key !== "profile")) return;
      var a = document.activeElement;
      if (a && app.contains(a) && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) return;
      if (document.querySelector("dialog[open]")) return;
      route();
    });
    route();
  });
})();
