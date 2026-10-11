/* Time Book.
   Routes (in the address hash): this week "" or "#w/<date>", "#bill" (unbilled hours by
   customer, turned into invoices), "#all" (every entry, with filters) and "#sheet" (a
   printable timesheet of the current filter). Entries are the shared `time` collection:
   {id, date, start, end, minutes, customerId, customerName, job, note, staffId, billable,
   rate (cents an hour; 0 means "use the customer's or the default rate"), invoiceId,
   invoiceNumber, billedAt}. The running clock lives in the store key "timer", and rates
   and rounding in `profile.timeBook`. Billed hours become a draft invoice in `documents`. */
(function () {
  "use strict";
  var FM = window.FM, S = FM.store, T = window.FMTime, M = FM.money, L = FM.license, esc = FM.esc;
  var app, tick = null;
  var ui = { week: null, filter: "all", cust: "", q: "", from: "", to: "" };

  var ICON = {
    plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
    back: '<svg viewBox="0 0 24 24"><path d="M15 6l-6 6 6 6"/></svg>',
    next: '<svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg>',
    play: '<svg viewBox="0 0 24 24"><path d="M8 5.5v13l10.5-6.5z"/></svg>',
    stop: '<svg viewBox="0 0 24 24"><rect x="6.5" y="6.5" width="11" height="11" rx="2"/></svg>',
    clock: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>',
    print: '<svg viewBox="0 0 24 24"><path d="M7 9V4h10v5M7 17H5a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-2"/><path d="M7 14h10v6H7z"/></svg>',
    down: '<svg viewBox="0 0 24 24"><path d="M12 4v11M7.5 10.5L12 15l4.5-4.5M5 19h14"/></svg>',
    doc: '<svg viewBox="0 0 24 24"><path d="M7 3.5h7l4 4V20a.5.5 0 0 1-.5.5h-10.5A.5.5 0 0 1 6.5 20V4a.5.5 0 0 1 .5-.5z"/><path d="M14 3.5V8h4M9.5 12.5h5M9.5 16h5"/></svg>',
    gear: '<svg viewBox="0 0 24 24"><path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/></svg>',
    warn: '<svg viewBox="0 0 24 24"><path d="M12 4l9 16H3z"/><path d="M12 10v4M12 17.2v.1"/></svg>',
    search: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5"/></svg>',
    trash: '<svg viewBox="0 0 24 24"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>'
  };

  // ---------- helpers
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function today() { return T.localDate(new Date()); }
  function fmtDate(d, opts) {
    try { return new Date(d + "T12:00:00").toLocaleDateString(undefined, opts || { month: "short", day: "numeric" }); }
    catch (e) { return d; }
  }
  function dayLong(d) { return fmtDate(d, { weekday: "long", month: "short", day: "numeric" }); }
  function fmtTime(hhmm) {
    if (!T.validClock(hhmm)) return "";
    var d = new Date(2000, 0, 1, +hhmm.slice(0, 2), +hhmm.slice(3));
    try { return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }); } catch (e) { return hhmm; }
  }
  function weekLabel(start) {
    var end = T.addDays(start, 6), y = end.slice(0, 4);
    var a = fmtDate(start), b = start.slice(5, 7) === end.slice(5, 7) ? String(+end.slice(8)) : fmtDate(end);
    return a + " – " + b + ", " + y;
  }
  function fmt(c) { var p = S.profile(); return M.format(c, p.currency, p.locale || undefined); }
  function field(label, control, cls) { return '<label class="field' + (cls ? " " + cls : "") + '"><span>' + label + "</span>" + control + "</label>"; }
  function go(hash) { if (location.hash === hash || (hash === "#" && !location.hash)) route(); else location.hash = hash; }
  function settings() {
    var p = S.profile();
    return Object.assign({ rate: 0, rounding: 0, weekStart: (p.shiftPlan && p.shiftPlan.weekStart) || 0 }, p.timeBook || {});
  }
  function saveSettings(patch) { try { S.saveProfile({ timeBook: Object.assign(settings(), patch) }); } catch (e) { FM.toast(e.message); } }
  function put(col, rec) { try { return S.put(col, rec); } catch (e) { FM.toast(e.message); return null; } }
  function entries() { return S.all("time"); }
  function customers() { return S.all("customers").slice().sort(function (a, b) { return String(a.name || a.company).localeCompare(String(b.name || b.company)); }); }
  function custName(c) { return (c && (c.name || c.company)) || ""; }
  function staff() { return S.all("staff").slice().sort(function (a, b) { return (a.order || 0) - (b.order || 0) || String(a.name).localeCompare(String(b.name)); }); }
  function who(id) { if (!id) return ""; var p = S.get("staff", id); return p ? p.name : ""; }
  function docIds() { var o = {}; S.all("documents").forEach(function (d) { o[d.id] = d; }); return o; }
  function hue(id) { var h = 0, s = String(id || ""); for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 4; return h; }
  function initials(n) { return String(n || "?").trim().split(/\s+/).slice(0, 2).map(function (w) { return w.charAt(0).toUpperCase(); }).join("") || "?"; }
  function download(name, type, text) {
    var a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: type }));
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  function money2(cents) { return cents ? (cents / 100).toFixed(2) : ""; }

  // The rate an entry is billed at: its own, else the customer's, else the default.
  function rateOf(e) {
    if (e.rate) return e.rate;
    var c = e.customerId && S.get("customers", e.customerId);
    return (c && c.hourlyRate) || settings().rate || 0;
  }
  function priced(list) { return list.map(function (e) { return Object.assign({}, e, { rate: rateOf(e) }); }); }
  function entryCustomer(e) { var c = e.customerId && S.get("customers", e.customerId); return custName(c) || e.customerName || ""; }

  function limitDialog(what) {
    return FM.confirm({
      title: what === "csv" ? "Spreadsheet export is part of Pro" : "You've reached the free limit",
      body: what === "csv"
        ? "Pro adds spreadsheet export to every tool, removes every limit, and costs a one-time " + L.config.price + "."
        : "The free version keeps up to " + L.limits.time + " time entries. Delete billed ones you no longer need (on All time, pick Billed), or Pro removes every limit for a one-time " + L.config.price + ".",
      ok: "See Pro", cancel: "Not now"
    }).then(function (yes) { if (yes) location.href = FM.link("settings/#pro"); return false; });
  }
  function canAdd() {
    if (L.canAdd("time", S.count("time")).allowed) return Promise.resolve(true);
    return limitDialog();
  }

  // Finds the customer by name, or adds them to the shared customer list.
  function resolveCustomer(name) {
    name = String(name || "").trim();
    if (!name) return { id: null, name: "" };
    var low = name.toLowerCase();
    var c = S.all("customers").find(function (x) { return custName(x).toLowerCase() === low || String(x.company || "").toLowerCase() === low; });
    if (c) return { id: c.id, name: custName(c) };
    if (!L.canAdd("customers", S.count("customers")).allowed) {
      FM.toast("Saved. The free customer list is full, so " + name + " wasn't added to it.");
      return { id: null, name: name };
    }
    var made = put("customers", { name: name, company: "", email: "", phone: "", address: "" });
    return made ? { id: made.id, name: name } : { id: null, name: name };
  }

  function lists() {
    var jobs = {};
    entries().forEach(function (e) { if (e.job) jobs[e.job.trim()] = 1; });
    return '<datalist id="dl-cust">' + customers().map(function (c) { return '<option value="' + esc(custName(c)) + '">'; }).join("") + "</datalist>" +
      '<datalist id="dl-job">' + Object.keys(jobs).sort().map(function (j) { return '<option value="' + esc(j) + '">'; }).join("") + "</datalist>";
  }
  function whoSelect(name, val) {
    var team = staff();
    if (!team.length) return "";
    return field("Who", '<select name="' + name + '"><option value="">Me</option>' + team.map(function (p) {
      return '<option value="' + esc(p.id) + '"' + (p.id === val ? " selected" : "") + ">" + esc(p.name) + "</option>";
    }).join("") + "</select>");
  }

  function openDialog(html) {
    var dlg = document.createElement("dialog");
    dlg.className = "fm-dialog tb-dialog";
    dlg.innerHTML = html;
    document.body.appendChild(dlg);
    dlg.addEventListener("close", function () { setTimeout(function () { dlg.remove(); }, 0); });
    dlg.showModal();
    return dlg;
  }

  // ---------- the running clock
  function timer() { return S.raw.read("timer", null); }
  function setTimer(t) { try { S.raw.write("timer", t); } catch (e) { FM.toast(e.message); } }
  function elapsed(t) { return Date.now() - Date.parse(t.startedAt); }

  function startTimer(from) {
    if (timer()) { FM.toast("The clock is already running"); return; }
    canAdd().then(function (ok) {
      if (!ok) return;
      var c = resolveCustomer(from.customer);
      setTimer({ startedAt: new Date().toISOString(), customerId: c.id, customerName: c.name, job: (from.job || "").trim(), note: (from.note || "").trim(), billable: from.billable !== false, staffId: from.staffId || "" });
      FM.toast("Clock started");
      route();
    });
  }

  // Turns the running clock into an entry. Over ten hours, it asks first, in case
  // someone forgot to stop it.
  function stopTimer() {
    var t = timer();
    if (!t) return;
    var start = new Date(t.startedAt), end = new Date();
    var rec = {
      date: T.localDate(start), start: T.localClock(start), end: T.localClock(end),
      minutes: Math.max(1, Math.round(elapsed(t) / 60000)),
      customerId: t.customerId, customerName: t.customerName, job: t.job, note: t.note, billable: t.billable, staffId: t.staffId, rate: 0
    };
    if (rec.minutes > 600) {
      entryDialog(rec, { title: "Check the time before saving", lead: "The clock ran for " + T.fmtDuration(rec.minutes) + ". If you forgot to stop it, set the real end time.", onSave: function () { setTimer(null); } });
      return;
    }
    var saved = put("time", rec);
    if (!saved) return;
    setTimer(null);
    FM.toast("Saved " + T.fmtDuration(rec.minutes) + (rec.customerName ? " for " + rec.customerName : ""));
    route();
  }

  function timerCard() {
    var t = timer();
    if (t) {
      var what = [t.customerName, t.job].filter(Boolean).join(" · ") || "No customer yet";
      var r = rateOf(t);
      return '<section class="card timer running" aria-labelledby="timer-h">' +
        '<div class="t-top"><span class="pulse" aria-hidden="true"></span><span id="timer-h" class="eyebrow">On the clock since ' + esc(fmtTime(T.localClock(new Date(t.startedAt)))) +
        (T.localDate(new Date(t.startedAt)) !== today() ? ", " + esc(fmtDate(T.localDate(new Date(t.startedAt)))) : "") + "</span></div>" +
        '<p class="clock" id="clock" role="timer" aria-live="off">' + T.fmtClock(elapsed(t)) + "</p>" +
        '<p class="t-what"><b>' + esc(what) + "</b>" + (t.note ? '<span class="muted"> · ' + esc(t.note) + "</span>" : "") + "</p>" +
        (t.billable && r ? '<p class="muted t-worth" id="worth">' + worthText(t, r) + "</p>" : (!t.billable ? '<p class="muted t-worth">Not billable</p>' : "")) +
        (elapsed(t) > 36e6 ? '<p class="notice t-long">' + ICON.warn + "Still working? If you forgot to stop the clock, you can set the real end time when you save.</p>" : "") +
        '<div class="t-actions"><button class="btn big" data-act="stop">' + ICON.stop + "Stop and save</button>" +
        '<button class="link-btn" data-act="edit-timer">Change details</button><button class="link-btn danger" data-act="discard">Discard</button></div></section>';
    }
    return '<section class="card timer" aria-labelledby="timer-h"><h2 id="timer-h" class="t-title">What are you working on?</h2>' +
      '<form id="start-form" class="t-form" autocomplete="off">' +
      field("Customer <i>(optional)</i>", '<input name="customer" list="dl-cust" placeholder="Who is it for?">') +
      field("Job", '<input name="job" list="dl-job" placeholder="Kitchen shelves, bookkeeping, lessons">') +
      field("Note <i>(optional)</i>", '<input name="note" placeholder="What you are doing today">', "t-note") +
      whoSelect("staffId", "") +
      '<label class="check"><input type="checkbox" name="billable" checked> Billable</label>' +
      '<div class="t-go"><button class="btn big" type="submit">' + ICON.play + "Start the clock</button>" +
      '<button class="link-btn" type="button" data-act="add">Or add time by hand</button></div></form></section>';
  }

  function worthText(t, r) {
    var v = T.amount(Math.round(elapsed(t) / 60000), r);
    return v ? fmt(v) + " so far at " + fmt(r) + " an hour" : "Billing at " + fmt(r) + " an hour";
  }

  function startTicking() {
    clearInterval(tick);
    var t = timer();
    if (!t) return;
    tick = setInterval(function () {
      var cur = timer(), el = document.getElementById("clock");
      if (!cur || !el) { clearInterval(tick); return; }
      el.textContent = T.fmtClock(elapsed(cur));
      var w = document.getElementById("worth"), r = rateOf(cur);
      if (w && r) w.textContent = worthText(cur, r);
    }, 1000);
  }

  // ---------- add or edit an entry
  function entryDialog(rec, opts) {
    opts = opts || {};
    var isNew = !rec.id, billedDoc = rec.invoiceId && docIds()[rec.invoiceId];
    var dlg = openDialog('<form method="dialog" class="dlg-body" autocomplete="off">' +
      "<h3>" + esc(opts.title || (isNew ? "Add time" : "Edit time")) + "</h3>" +
      (opts.lead ? '<p class="muted">' + esc(opts.lead) + "</p>" : "") +
      (billedDoc ? '<p class="notice">This is on invoice ' + esc(billedDoc.number) + ". Changing it here won't change the invoice.</p>" : "") +
      '<div class="grid-3">' + field("Date", '<input type="date" name="date" required value="' + esc(rec.date || today()) + '">') +
      field("Start <i>(optional)</i>", '<input type="time" name="start" value="' + esc(rec.start || "") + '">') +
      field("End <i>(optional)</i>", '<input type="time" name="end" value="' + esc(rec.end || "") + '">') + "</div>" +
      field("How long", '<input name="dur" inputmode="decimal" placeholder="1:30, 1.5 or 90m" value="' + esc(rec.minutes ? T.fmtDuration(rec.minutes) : "") + '">', "dur") +
      '<div class="grid-2">' + field("Customer <i>(optional)</i>", '<input name="customer" list="dl-cust" value="' + esc(rec.customerId || rec.customerName ? entryCustomer(rec) : "") + '">') +
      field("Job", '<input name="job" list="dl-job" value="' + esc(rec.job || "") + '">') + "</div>" +
      field("Note <i>(optional)</i>", '<input name="note" value="' + esc(rec.note || "") + '">') +
      '<div class="grid-2">' + whoSelect("staffId", rec.staffId) +
      field("Rate an hour <i>(blank uses " + (settings().rate ? fmt(settings().rate) : "your default") + ")</i>", '<input name="rate" inputmode="decimal" placeholder="' + esc(money2(settings().rate) || "0.00") + '" value="' + esc(money2(rec.rate)) + '">') + "</div>" +
      '<label class="check"><input type="checkbox" name="billable"' + (rec.billable !== false ? " checked" : "") + "> Billable</label>" +
      '<p class="err" hidden></p>' +
      '<div class="dlg-actions">' + (isNew ? "" : '<button class="btn danger" value="delete" formnovalidate>Delete</button><span class="grow"></span>') +
      '<button class="btn ghost" value="cancel" formnovalidate>Cancel</button><button class="btn" value="ok">Save</button></div></form>' + lists());
    var form = $("form", dlg), err = $(".err", dlg);
    function syncDur() {
      if (T.validClock(form.start.value) && T.validClock(form.end.value)) form.dur.value = T.fmtDuration(T.minutesBetween(form.start.value, form.end.value));
    }
    form.start.addEventListener("change", syncDur);
    form.end.addEventListener("change", syncDur);
    form.dur.addEventListener("change", function () {
      var m = T.parseDuration(form.dur.value);
      if (m != null && T.validClock(form.start.value)) {
        var a = +form.start.value.slice(0, 2) * 60 + +form.start.value.slice(3) + m;
        form.end.value = String(Math.floor(a / 60) % 24).padStart(2, "0") + ":" + String(a % 60).padStart(2, "0");
      }
    });
    form.addEventListener("submit", function (e) {
      var v = e.submitter && e.submitter.value;
      if (v !== "ok") return;
      var m = T.validClock(form.start.value) && T.validClock(form.end.value) ? T.minutesBetween(form.start.value, form.end.value) : T.parseDuration(form.dur.value);
      var msg = !T.validDate(form.date.value) ? "Pick a date." : !m || m <= 0 ? "Add how long you worked, like 1:30 or 90m." : m > 1440 ? "One entry can be at most 24 hours. Split longer work across days." : "";
      if (msg) { e.preventDefault(); err.textContent = msg; err.hidden = false; return; }
    });
    dlg.addEventListener("close", function () {
      var v = dlg.returnValue;
      if (v === "delete") {
        FM.confirm({ title: "Delete this time?", body: billedDoc ? "Invoice " + billedDoc.number + " keeps its lines." : "", ok: "Delete", danger: true }).then(function (yes) {
          if (yes) { S.remove("time", rec.id); FM.toast("Deleted"); route(); }
        });
        return;
      }
      if (v !== "ok") return;
      var hasClock = T.validClock(form.start.value) && T.validClock(form.end.value);
      var out = Object.assign({}, rec, {
        date: form.date.value,
        start: T.validClock(form.start.value) ? form.start.value : "",
        end: T.validClock(form.end.value) ? form.end.value : "",
        minutes: hasClock ? T.minutesBetween(form.start.value, form.end.value) : T.parseDuration(form.dur.value),
        job: form.job.value.trim(), note: form.note.value.trim(),
        staffId: form.staffId ? form.staffId.value : (rec.staffId || ""),
        billable: form.billable.checked,
        rate: form.rate.value.trim() ? Math.max(0, M.toCents(form.rate.value)) : 0
      });
      var typed = form.customer.value.trim();
      if (typed.toLowerCase() !== entryCustomer(rec).toLowerCase() || (!rec.customerId && typed)) {
        var c = resolveCustomer(typed);
        out.customerId = c.id; out.customerName = c.name;
      }
      if (!out.id && !L.canAdd("time", S.count("time")).allowed) { limitDialog(); return; }
      if (put("time", out)) {
        if (opts.onSave) opts.onSave();
        FM.toast(isNew ? "Added " + T.fmtDuration(out.minutes) : "Saved");
        route();
      }
    });
    (isNew ? form.dur : form.job).focus();
  }

  function addEntry(preset) {
    canAdd().then(function (ok) { if (ok) entryDialog(Object.assign({ date: today(), billable: true }, preset || {})); });
  }

  function timerDialog() {
    var t = timer();
    if (!t) return;
    var st = new Date(t.startedAt);
    var dlg = openDialog('<form method="dialog" class="dlg-body" autocomplete="off"><h3>Change details</h3>' +
      '<div class="grid-2">' + field("Customer", '<input name="customer" list="dl-cust" value="' + esc(t.customerName || "") + '">') +
      field("Job", '<input name="job" list="dl-job" value="' + esc(t.job || "") + '">') + "</div>" +
      field("Note", '<input name="note" value="' + esc(t.note || "") + '">') +
      '<div class="grid-2">' + field("Started at", '<input type="time" name="start" required value="' + T.localClock(st) + '">') + whoSelect("staffId", t.staffId) + "</div>" +
      '<label class="check"><input type="checkbox" name="billable"' + (t.billable ? " checked" : "") + "> Billable</label>" +
      '<div class="dlg-actions"><button class="btn ghost" value="cancel" formnovalidate>Cancel</button><button class="btn" value="ok">Save</button></div></form>' + lists());
    var form = $("form", dlg);
    dlg.addEventListener("close", function () {
      if (dlg.returnValue !== "ok") return;
      var cur = timer();
      if (!cur) return;
      if (form.customer.value.trim() !== (cur.customerName || "")) { var c = resolveCustomer(form.customer.value); cur.customerId = c.id; cur.customerName = c.name; }
      cur.job = form.job.value.trim(); cur.note = form.note.value.trim(); cur.billable = form.billable.checked;
      if (form.staffId) cur.staffId = form.staffId.value;
      if (T.validClock(form.start.value)) {
        var s = new Date(cur.startedAt);
        s.setHours(+form.start.value.slice(0, 2), +form.start.value.slice(3), 0, 0);
        if (s.getTime() > Date.now()) s.setDate(s.getDate() - 1); // a start "later" than now was yesterday
        cur.startedAt = s.toISOString();
      }
      setTimer(cur);
      route();
    });
  }

  // ---------- routing
  function route() {
    clearInterval(tick);
    var h = location.hash.replace(/^#/, "");
    app.onclick = null;
    window.scrollTo(0, 0);
    if (h === "bill") return renderBill();
    if (h === "all") return renderAll();
    if (h === "sheet") return renderSheet();
    if (h.indexOf("w/") === 0 && T.validDate(h.slice(2))) ui.week = T.weekStartOf(h.slice(2), settings().weekStart);
    renderWeek();
  }

  function head(active) {
    var tabs = [["#", "This week", "week"], ["#bill", "To bill", "bill"], ["#all", "All time", "all"]];
    return '<div class="wrap app-head no-print"><div><div class="app-title"><h1>Time Book</h1>' +
      (L.isPro() ? '<span class="fm-pro-chip">Pro</span>' : "") + "</div>" +
      '<p class="muted sub">Count your hours honestly and get paid for every one.</p></div>' +
      '<div class="head-right"><nav class="seg" aria-label="Sections">' + tabs.map(function (t) {
        return '<a href="' + t[0] + '"' + (t[2] === active ? ' aria-current="page"' : "") + ">" + t[1] + "</a>";
      }).join("") + '</nav><button class="icon-btn round" data-act="rates" aria-label="Rates and rounding" title="Rates and rounding">' + ICON.gear + "</button></div></div>";
  }

  function commonClicks(e) {
    var b = e.target.closest("[data-act]");
    if (!b) return false;
    var act = b.getAttribute("data-act");
    if (act === "rates") { ratesDialog(); return true; }
    if (act === "add") { addEntry(); return true; }
    if (act === "stop") { stopTimer(); return true; }
    if (act === "edit-timer") { timerDialog(); return true; }
    if (act === "discard") {
      FM.confirm({ title: "Discard the running clock?", body: "This time won't be saved.", ok: "Discard", danger: true }).then(function (yes) { if (yes) { setTimer(null); route(); } });
      return true;
    }
    if (act === "again") {
      var e0 = S.get("time", b.getAttribute("data-id"));
      if (e0) startTimer({ customer: entryCustomer(e0), job: e0.job, note: "", billable: e0.billable, staffId: e0.staffId });
      return true;
    }
    if (act === "edit") { var r = S.get("time", b.getAttribute("data-id")); if (r) entryDialog(r); return true; }
    return false;
  }

  function entryRow(e, opts) {
    var docs = opts.docs, billed = T.isBilled(e, docs), r = rateOf(e);
    var title = [entryCustomer(e), e.job].filter(Boolean).join(" · ") || "Untitled work";
    var when = e.start && e.end ? fmtTime(e.start) + " – " + fmtTime(e.end) : "";
    var meta = [opts.showDate ? fmtDate(e.date, { weekday: "short", month: "short", day: "numeric" }) : "", when, who(e.staffId)].filter(Boolean).join(" · ");
    return '<li class="entry">' +
      '<button class="e-main" data-act="edit" data-id="' + esc(e.id) + '"><span class="e-dur">' + T.fmtDuration(e.minutes) + "</span>" +
      '<span class="e-what"><b>' + esc(title) + "</b>" + (e.note ? '<span class="e-note">' + esc(e.note) + "</span>" : "") +
      (meta ? '<span class="e-meta">' + esc(meta) + "</span>" : "") + "</span>" +
      '<span class="e-right">' + (e.billable ? (r ? '<span class="e-val">' + fmt(T.amount(e.minutes, r)) + "</span>" : "") : "") +
      (billed ? '<span class="pill green">On ' + esc((docs[e.invoiceId] && docs[e.invoiceId].number) || "invoice") + "</span>" : !e.billable ? '<span class="pill">Not billable</span>' : "") + "</span></button>" +
      '<button class="icon-btn" data-act="again" data-id="' + esc(e.id) + '" aria-label="Start the clock on this again" title="Start again">' + ICON.play + "</button></li>";
  }

  // ---------- this week
  function renderWeek() {
    var st = settings();
    if (!ui.week) ui.week = T.weekStartOf(today(), st.weekStart);
    var days = T.weekDates(ui.week), all = entries(), docs = docIds();
    var week = all.filter(function (e) { return e.date >= days[0] && e.date <= days[6]; });
    var sum = T.summarize(priced(week), docs), allSum = T.summarize(priced(all), docs);
    var perDay = days.map(function (d) { return week.filter(function (e) { return e.date === d; }).reduce(function (a, e) { return a + (e.minutes || 0); }, 0); });
    var max = Math.max(480, Math.max.apply(null, perDay));
    var isNow = ui.week === T.weekStartOf(today(), st.weekStart);

    var bars = '<div class="bars" role="img" aria-label="Hours each day: ' + days.map(function (d, i) { return fmtDate(d, { weekday: "long" }) + " " + T.fmtDuration(perDay[i]); }).join(", ") + '">' +
      days.map(function (d, i) {
        return '<div class="bar' + (d === today() ? " today" : "") + '"><span class="bar-h">' + (perDay[i] ? T.fmtDuration(perDay[i]) : "") + "</span>" +
          '<span class="bar-track"><span class="bar-fill" style="height:' + Math.round(perDay[i] / max * 100) + '%"></span></span>' +
          '<span class="bar-d">' + esc(fmtDate(d, { weekday: "short" })) + "</span></div>";
      }).join("") + "</div>";

    var byDay = days.slice().reverse().map(function (d) {
      var list = week.filter(function (e) { return e.date === d; }).sort(function (a, b) { return String(b.start || "").localeCompare(String(a.start || "")); });
      if (!list.length) return "";
      var tot = list.reduce(function (a, e) { return a + (e.minutes || 0); }, 0);
      return '<section class="day"><h3 class="day-h"><span>' + esc(d === today() ? "Today" : dayLong(d)) + '</span><span class="muted">' + T.fmtDuration(tot) + "</span></h3>" +
        '<ul class="entries">' + list.map(function (e) { return entryRow(e, { docs: docs }); }).join("") + "</ul></section>";
    }).join("");

    app.innerHTML = head("week") + '<div class="wrap">' +
      (FM.backup.due() ? '<p class="notice backup-note no-print"><span>It has been a while since your last backup. One file keeps your whole business book safe.</span><button class="btn small ghost" data-act="backup">Download a backup</button></p>' : "") +
      '<div class="top-grid">' + timerCard() +
      '<section class="card week-card" aria-labelledby="wk-h"><div class="week-bar">' +
      '<a class="icon-btn round" href="#w/' + T.addDays(ui.week, -7) + '" aria-label="Previous week">' + ICON.back + "</a>" +
      '<h2 class="week-title" id="wk-h">' + esc(weekLabel(ui.week)) + "</h2>" +
      '<a class="icon-btn round" href="#w/' + T.addDays(ui.week, 7) + '" aria-label="Next week">' + ICON.next + "</a></div>" +
      bars +
      '<dl class="wk-sum"><div><dt>Worked</dt><dd>' + T.fmtDuration(sum.minutes) + "</dd></div>" +
      "<div><dt>Billable</dt><dd>" + T.fmtDuration(sum.billable) + "</dd></div>" +
      '<div><dt>Ready to bill</dt><dd><a href="#bill">' + fmt(allSum.unbilledValue) + "</a></dd></div></dl>" +
      (isNow ? "" : '<a class="link-btn" href="#w/' + today() + '">Back to this week</a>') + "</section></div>" +
      '<div class="list-head"><h2 class="sec">' + ICON.clock + (isNow ? "This week's time" : "Time that week") + '</h2><button class="btn ghost small" data-act="add">' + ICON.plus + "Add time</button></div>" +
      (byDay || '<div class="none"><p class="muted">' + (isNow ? "Nothing logged yet this week. Start the clock when you begin, or add time by hand afterwards." : "Nothing logged that week.") + "</p></div>") +
      limitNote() + "</div>";

    var form = $("#start-form", app);
    if (form) {
      form.insertAdjacentHTML("beforeend", lists());
      form.addEventListener("submit", function (e) {
        e.preventDefault();
        startTimer({ customer: form.customer.value, job: form.job.value, note: form.note.value, billable: form.billable.checked, staffId: form.staffId ? form.staffId.value : "" });
      });
    }
    app.onclick = function (e) {
      if (commonClicks(e)) return;
      var b = e.target.closest('[data-act="backup"]');
      if (b) { FM.backup.download(); FM.toast("Backup downloaded"); renderWeek(); }
    };
    startTicking();
  }

  function limitNote() {
    if (L.isPro()) return "";
    var used = S.count("time"), lim = L.limits.time;
    if (used < lim - 5) return "";
    return '<p class="limit-note muted">' + used + " of " + lim + " free time entries used. Delete billed ones on " +
      '<a href="#all">All time</a>, or <a href="' + FM.link("settings/#pro") + '">Pro</a> removes the limit.</p>';
  }

  // ---------- to bill
  function unbilledGroups() {
    var docs = docIds(), groups = {}, order = [];
    entries().forEach(function (e) {
      if (!e.billable || T.isBilled(e, docs)) return;
      var key = e.customerId || ("name:" + (e.customerName || "").toLowerCase());
      if (!groups[key]) { groups[key] = { key: key, customerId: e.customerId || null, name: entryCustomer(e), entries: [] }; order.push(key); }
      groups[key].entries.push(e);
    });
    return order.map(function (k) {
      var g = groups[k];
      g.sum = T.summarize(priced(g.entries), null);
      g.first = g.entries.reduce(function (a, e) { return !a || e.date < a ? e.date : a; }, "");
      return g;
    }).sort(function (a, b) { return a.first.localeCompare(b.first); });
  }

  function renderBill() {
    var st = settings(), groups = unbilledGroups();
    var billed = S.all("documents").filter(function (d) { return d.fromTime; }).sort(function (a, b) { return String(b.createdAt).localeCompare(String(a.createdAt)); }).slice(0, 5);
    var cards = groups.map(function (g) {
      var c = g.customerId && S.get("customers", g.customerId);
      var missing = g.entries.some(function (e) { return !rateOf(e); });
      return '<article class="card bill">' +
        '<div class="bill-top"><span class="av av-' + hue(g.customerId || g.name) + '" aria-hidden="true">' + esc(initials(g.name || "?")) + "</span>" +
        '<div class="bill-who"><h3>' + esc(g.name || "No customer") + "</h3>" +
        '<p class="muted">' + g.entries.length + (g.entries.length === 1 ? " entry" : " entries") + " since " + esc(fmtDate(g.first)) + "</p></div>" +
        '<div class="bill-amt"><b>' + fmt(g.sum.unbilledValue) + '</b><span class="muted">' + T.fmtDuration(g.sum.unbilled) + "</span></div></div>" +
        (missing ? '<p class="notice">Some of these hours have no rate yet, so they count as nothing. Set a rate for ' + esc(c ? custName(c) : "them") + " or a default rate.</p>" : "") +
        '<div class="bill-actions">' +
        (c ? '<button class="link-btn" data-act="cust-rate" data-id="' + esc(c.id) + '">' + (c.hourlyRate ? "Their rate: " + fmt(c.hourlyRate) + " an hour · change" : "Use a different rate for " + esc(custName(c))) + "</button>" : '<span class="muted small">Add a customer to these entries to send an invoice</span>') +
        '<button class="btn" data-act="invoice" data-key="' + esc(g.key) + '"' + (g.sum.unbilledValue > 0 ? "" : " disabled") + ">" + ICON.doc + "Make invoice</button></div></article>";
    }).join("");

    app.innerHTML = head("bill") + '<div class="wrap">' +
      (!st.rate ? '<p class="notice blue rate-note"><span>Set your hourly rate so your hours turn into an invoice. You can give some customers their own rate.</span><button class="btn small" data-act="rates">Set my rate</button></p>' : "") +
      (cards ? '<p class="bill-sum">' + fmt(groups.reduce(function (a, g) { return a + g.sum.unbilledValue; }, 0)) + " ready to bill" + (groups.length > 1 ? " across " + groups.length + " customers" : "") + '. Each invoice starts as a draft you can check before sending.</p><div class="bills">' + cards + "</div>"
        : '<div class="empty">' + emptyArt() + "<h2>Every hour is billed</h2><p class=\"muted\">Billable time you log shows up here, grouped by customer, ready to become an invoice.</p>" +
          '<a class="btn ghost" href="#">Back to this week</a></div>') +
      (billed.length ? '<h2 class="sec recent-h">' + ICON.doc + 'Invoices made from time</h2><ul class="recent">' + billed.map(function (d) {
        return '<li><a href="' + FM.link("invoices/#doc/" + d.id) + '"><b>' + esc(d.number) + "</b><span>" + esc((d.customer && d.customer.name) || "No customer") + '</span><span class="muted">' + esc(fmtDate(d.issueDate)) + "</span></a></li>";
      }).join("") + "</ul>" : "") + "</div>";

    app.onclick = function (e) {
      if (commonClicks(e)) return;
      var b = e.target.closest("[data-act]");
      if (!b) return;
      if (b.getAttribute("data-act") === "invoice") {
        var g = unbilledGroups().find(function (x) { return x.key === b.getAttribute("data-key"); });
        if (g) invoiceDialog(g);
      }
      if (b.getAttribute("data-act") === "cust-rate") custRateDialog(b.getAttribute("data-id"));
    };
  }

  function custRateDialog(id) {
    var c = S.get("customers", id);
    if (!c) return;
    var dlg = openDialog('<form method="dialog" class="dlg-body"><h3>Rate for ' + esc(custName(c)) + "</h3>" +
      '<p class="muted">Used for their hours instead of your default rate. Leave it blank to use the default' + (settings().rate ? " (" + fmt(settings().rate) + ")" : "") + ".</p>" +
      field("Rate an hour", '<input name="rate" inputmode="decimal" placeholder="' + esc(money2(settings().rate) || "0.00") + '" value="' + esc(money2(c.hourlyRate)) + '">') +
      '<div class="dlg-actions"><button class="btn ghost" value="cancel" formnovalidate>Cancel</button><button class="btn" value="ok">Save</button></div></form>');
    dlg.addEventListener("close", function () {
      if (dlg.returnValue !== "ok") return;
      var v = $("form", dlg).rate.value.trim();
      var cur = S.get("customers", id);
      if (!cur) return;
      cur.hourlyRate = v ? Math.max(0, M.toCents(v)) : 0;
      put("customers", cur);
      route();
    });
  }

  // Makes a draft invoice from a customer's unbilled hours and marks them billed.
  function invoiceDialog(g) {
    var st = settings(), choice = { rounding: st.rounding || 0, group: "job" };
    var dlg = openDialog('<form method="dialog" class="dlg-body inv-dlg"><h3>Invoice ' + esc(g.name || "these hours") + "</h3>" +
      '<fieldset class="opts"><legend class="label">Round each line</legend>' +
      [[0, "Exact minutes"], [6, "Nearest 6 minutes"], [15, "Nearest 15 minutes"]].map(function (o) {
        return '<label class="radio"><input type="radio" name="rounding" value="' + o[0] + '"' + (o[0] === choice.rounding ? " checked" : "") + "> " + o[1] + "</label>";
      }).join("") + "</fieldset>" +
      '<fieldset class="opts"><legend class="label">Lines</legend>' +
      '<label class="radio"><input type="radio" name="group" value="job" checked> One per job</label>' +
      '<label class="radio"><input type="radio" name="group" value="entry"> One per entry</label></fieldset>' +
      '<div id="inv-pv"></div>' +
      '<p class="muted small">Rounding goes to the nearest step, up or down, so it stays fair to both of you. Labor lines start untaxed; tick "Taxed" on the invoice if your state taxes this work.</p>' +
      '<div class="dlg-actions"><button class="btn ghost" value="cancel" formnovalidate>Cancel</button><button class="btn" value="ok">' + ICON.doc + "Create invoice</button></div></form>");
    var form = $("form", dlg);
    function lines() { return T.invoiceLines(priced(g.entries), { rounding: choice.rounding, group: choice.group, fmtDate: function (d) { return fmtDate(d); } }); }
    function preview() {
      var ls = lines(), total = ls.reduce(function (a, l) { return a + Math.round(l.qty * l.price); }, 0);
      $("#inv-pv", dlg).innerHTML = '<table class="pv"><thead><tr><th>Line</th><th>Hours</th><th>Amount</th></tr></thead><tbody>' +
        ls.map(function (l) { return "<tr><td>" + esc(l.description) + "</td><td>" + l.qty.toFixed(2) + "</td><td>" + fmt(Math.round(l.qty * l.price)) + "</td></tr>"; }).join("") +
        '</tbody><tfoot><tr><td colspan="2">Before tax</td><td id="inv-total">' + fmt(total) + "</td></tr></tfoot></table>";
    }
    form.addEventListener("change", function () {
      choice.rounding = +form.querySelector('[name="rounding"]:checked').value;
      choice.group = form.querySelector('[name="group"]:checked').value;
      preview();
    });
    preview();
    dlg.addEventListener("close", function () {
      if (dlg.returnValue !== "ok") return;
      if (!L.canAdd("documents", S.count("documents")).allowed) {
        FM.confirm({ title: "You've reached the free limit", body: "The free version keeps up to " + L.limits.documents + " quotes and invoices. Delete old ones in Quotes & Invoices, or Pro removes every limit for a one-time " + L.config.price + ".", ok: "See Pro", cancel: "Not now" })
          .then(function (yes) { if (yes) location.href = FM.link("settings/#pro"); });
        return;
      }
      if (choice.rounding !== st.rounding) saveSettings({ rounding: choice.rounding });
      var made = makeInvoice(g, lines());
      if (made) location.href = FM.link("invoices/#doc/" + made.id);
    });
  }

  function makeInvoice(g, ls) {
    var p = S.profile(), now = today(), c = g.customerId && S.get("customers", g.customerId);
    var dates = g.entries.map(function (e) { return e.date; }).sort();
    var doc = {
      type: "invoice", status: "draft",
      number: S.nextNumber("invoice"),
      issueDate: now, dueDate: T.addDays(now, p.termsDays), validUntil: T.addDays(now, p.quoteValidDays),
      reference: "",
      customerId: c ? c.id : null,
      customer: { name: c ? c.name || "" : g.name || "", company: c ? c.company || "" : "", email: c ? c.email || "" : "", phone: c ? c.phone || "" : "", address: c ? c.address || "" : "" },
      lines: ls.map(function (l) { return { id: S.uid(), description: l.description, unit: "hr", qty: l.qty, price: l.price, taxable: false }; }),
      discountType: "percent", discountValue: "",
      taxLabel: p.taxLabel, taxRate: p.taxRate,
      depositPercent: "",
      notes: "Hours worked " + (dates[0] === dates[dates.length - 1] ? "on " + fmtDate(dates[0], { month: "long", day: "numeric", year: "numeric" }) : "from " + fmtDate(dates[0], { month: "long", day: "numeric" }) + " to " + fmtDate(dates[dates.length - 1], { month: "long", day: "numeric", year: "numeric" })) + ". Thank you!",
      paymentInstructions: p.paymentInstructions,
      payments: [], paidAmount: 0,
      fromTime: true
    };
    var saved = put("documents", doc);
    if (!saved) return null;
    var stamp = new Date().toISOString();
    var all = entries(), ids = {};
    g.entries.forEach(function (e) { ids[e.id] = 1; });
    // Freeze each entry's rate at what it was billed for, then mark it billed in one write.
    all.forEach(function (e) {
      if (!ids[e.id]) return;
      e.rate = rateOf(e); e.invoiceId = saved.id; e.invoiceNumber = saved.number; e.billedAt = stamp; e.updatedAt = stamp;
    });
    try { S.raw.write("time", all); } catch (err) { FM.toast(err.message); }
    return saved;
  }

  // ---------- all time
  function filtered() {
    var docs = docIds(), q = ui.q.trim().toLowerCase();
    return entries().filter(function (e) {
      var billed = T.isBilled(e, docs);
      if (ui.filter === "unbilled" && (!e.billable || billed)) return false;
      if (ui.filter === "billed" && !billed) return false;
      if (ui.filter === "nonbill" && e.billable) return false;
      if (ui.cust && (ui.cust === "none" ? (e.customerId || e.customerName) : (e.customerId || "name:" + (e.customerName || "").toLowerCase()) !== ui.cust)) return false;
      if (ui.from && e.date < ui.from) return false;
      if (ui.to && e.date > ui.to) return false;
      if (q && [entryCustomer(e), e.job, e.note, who(e.staffId)].join(" ").toLowerCase().indexOf(q) < 0) return false;
      return true;
    }).sort(function (a, b) { return (b.date + (b.start || "")).localeCompare(a.date + (a.start || "")); });
  }
  function customerOptions() {
    var seen = {}, out = [];
    entries().forEach(function (e) {
      var key = e.customerId || (e.customerName ? "name:" + e.customerName.toLowerCase() : "none");
      if (seen[key]) return;
      seen[key] = 1;
      out.push([key, key === "none" ? "No customer" : entryCustomer(e)]);
    });
    return out.sort(function (a, b) { return a[1].localeCompare(b[1]); });
  }

  function renderAll() {
    var list = filtered(), docs = docIds(), sum = T.summarize(priced(list), docs);
    var chips = [["all", "All"], ["unbilled", "Not billed yet"], ["billed", "Billed"], ["nonbill", "Not billable"]];
    var value = priced(list).reduce(function (a, e) { return a + (e.billable ? T.amount(e.minutes, e.rate) : 0); }, 0);
    app.innerHTML = head("all") + '<div class="wrap">' +
      '<div class="list-bar no-print"><div class="chips" role="group" aria-label="Show">' + chips.map(function (c) {
        return '<button class="chip" data-filter="' + c[0] + '" aria-pressed="' + (ui.filter === c[0]) + '">' + c[1] + "</button>";
      }).join("") + "</div>" +
      '<label class="search"><span class="sr">Search</span>' + ICON.search + '<input type="search" id="q" placeholder="Search jobs and notes" value="' + esc(ui.q) + '"></label></div>' +
      '<div class="list-bar filters no-print">' +
      '<label class="mini-field"><span>Customer</span><select id="f-cust"><option value="">Everyone</option>' + customerOptions().map(function (o) {
        return '<option value="' + esc(o[0]) + '"' + (o[0] === ui.cust ? " selected" : "") + ">" + esc(o[1]) + "</option>";
      }).join("") + "</select></label>" +
      '<label class="mini-field"><span>From</span><input type="date" id="f-from" value="' + esc(ui.from) + '"></label>' +
      '<label class="mini-field"><span>To</span><input type="date" id="f-to" value="' + esc(ui.to) + '"></label>' +
      '<span class="grow"></span><div class="head-actions">' +
      '<a class="btn ghost small" href="#sheet"' + (list.length ? "" : ' aria-disabled="true"') + ">" + ICON.print + "Timesheet</a>" +
      '<button class="btn ghost small" data-act="csv"' + (list.length ? "" : " disabled") + ">" + ICON.down + "Spreadsheet</button></div></div>" +
      '<p class="all-sum" id="all-sum">' + list.length + (list.length === 1 ? " entry" : " entries") + " · <b>" + T.fmtDuration(sum.minutes) + "</b>" +
      (value ? " · " + fmt(value) + " billable" : "") + "</p>" +
      (list.length ? '<ul class="entries">' + list.map(function (e) { return entryRow(e, { docs: docs, showDate: true }); }).join("") + "</ul>"
        : '<div class="none"><p class="muted">' + (entries().length ? "Nothing matches. Try another filter." : "No time logged yet.") + "</p></div>") +
      (ui.filter === "billed" && list.length ? '<p class="tidy"><button class="link-btn danger" data-act="tidy">' + ICON.trash + "Delete these " + list.length + " billed entries</button>" +
        '<span class="muted small">Their invoices keep every line.</span></p>' : "") +
      limitNote() + "</div>";

    $$(".chip", app).forEach(function (b) { b.addEventListener("click", function () { ui.filter = b.getAttribute("data-filter"); renderAll(); }); });
    var qi = $("#q", app);
    qi.addEventListener("input", function () { ui.q = qi.value; var pos = qi.selectionStart; renderAll(); var n = $("#q", app); n.focus(); try { n.setSelectionRange(pos, pos); } catch (e) { /* ok */ } });
    $("#f-cust", app).addEventListener("change", function () { ui.cust = this.value; renderAll(); });
    $("#f-from", app).addEventListener("change", function () { ui.from = this.value; renderAll(); });
    $("#f-to", app).addEventListener("change", function () { ui.to = this.value; renderAll(); });
    app.onclick = function (e) {
      if (commonClicks(e)) return;
      var b = e.target.closest("[data-act]");
      if (!b) return;
      var act = b.getAttribute("data-act");
      if (act === "csv") exportCsv(filtered());
      if (act === "tidy") {
        var ids = filtered().map(function (x) { return x.id; });
        FM.confirm({ title: "Delete " + ids.length + " billed entries?", body: "They are already on invoices, and those invoices keep every line. A backup first is a good idea.", ok: "Delete", danger: true }).then(function (yes) {
          if (!yes) return;
          var keep = {}; ids.forEach(function (id) { keep[id] = 1; });
          try { S.raw.write("time", entries().filter(function (x) { return !keep[x.id]; })); } catch (err) { FM.toast(err.message); }
          FM.toast("Deleted " + ids.length);
          renderAll();
        });
      }
    };
  }

  function exportCsv(list) {
    if (!L.isPro()) { limitDialog("csv"); return; }
    var docs = docIds();
    var rows = priced(list).map(function (e) {
      return { date: e.date, start: e.start, end: e.end, minutes: e.minutes, customer: entryCustomer(e), job: e.job, note: e.note, who: who(e.staffId), billable: e.billable, rate: e.rate, billedAs: T.isBilled(e, docs) ? docs[e.invoiceId].number : "" };
    });
    download("time-" + today() + ".csv", "text/csv", T.csv(rows));
    FM.toast("Spreadsheet downloaded");
  }

  // ---------- printable timesheet
  function renderSheet() {
    var list = filtered().slice().reverse(), p = S.profile(), pro = L.isPro(), docs = docIds();
    var accent = pro && /^#[0-9a-f]{6}$/i.test(p.accent || "") ? p.accent : "#3d5876";
    var sum = T.summarize(priced(list), docs);
    var value = priced(list).reduce(function (a, e) { return a + (e.billable ? T.amount(e.minutes, e.rate) : 0); }, 0);
    var custOpt = customerOptions().find(function (o) { return o[0] === ui.cust; });
    var dates = list.map(function (e) { return e.date; });
    var period = ui.from || ui.to ? (ui.from ? fmtDate(ui.from, { month: "long", day: "numeric", year: "numeric" }) : "the start") + " to " + (ui.to ? fmtDate(ui.to, { month: "long", day: "numeric", year: "numeric" }) : "today")
      : dates.length ? fmtDate(dates[0], { month: "long", day: "numeric", year: "numeric" }) + (dates[0] !== dates[dates.length - 1] ? " to " + fmtDate(dates[dates.length - 1], { month: "long", day: "numeric", year: "numeric" }) : "") : "";
    var showWho = list.some(function (e) { return e.staffId; });
    var bizLines = [p.address, [p.phone, p.email].filter(Boolean).join(" · ")].filter(Boolean);
    var rows = list.map(function (e) {
      return "<tr><td>" + esc(fmtDate(e.date, { weekday: "short", month: "short", day: "numeric" })) + "</td>" +
        "<td>" + (e.start && e.end ? esc(fmtTime(e.start) + " – " + fmtTime(e.end)) : "") + "</td>" +
        "<td>" + esc([custOpt ? "" : entryCustomer(e), e.job].filter(Boolean).join(" · ") || "Work") + (e.note ? '<span class="ts-note">' + esc(e.note) + "</span>" : "") + "</td>" +
        (showWho ? "<td>" + esc(who(e.staffId) || p.owner || "") + "</td>" : "") +
        "<td>" + T.hoursQty(e.minutes).toFixed(2) + "</td></tr>";
    }).join("");

    app.innerHTML = '<div class="wrap app-head no-print"><div><a class="back" href="#all">' + ICON.back + "All time</a>" +
      '<div class="app-title"><h1>Timesheet</h1></div><p class="muted sub">The entries you filtered on All time, ready to print or save as a PDF for a customer or your records.</p></div>' +
      '<div class="head-actions"><button class="btn" data-act="print">' + ICON.print + "Print or save PDF</button></div></div>" +
      '<div class="wrap"><div class="ts-shell"><article class="ts" style="--accent:' + accent + '">' +
      '<div class="ts-head"><div class="ts-from">' + (pro && p.logo ? '<img class="ts-logo" src="' + esc(p.logo) + '" alt="">' : "") +
      "<div><b>" + esc(p.name || "Your business name") + "</b>" + bizLines.map(function (l) { return "<span>" + esc(l) + "</span>"; }).join("") + "</div></div>" +
      '<div class="ts-meta"><h2>Timesheet</h2><span>' + esc(period) + "</span></div></div>" +
      (custOpt ? '<div class="ts-to"><span class="ts-label">For</span><b>' + esc(custOpt[1]) + "</b></div>" : "") +
      (list.length ? '<table class="ts-table"><thead><tr><th>Date</th><th>Time</th><th>Work</th>' + (showWho ? "<th>Who</th>" : "") + "<th>Hours</th></tr></thead><tbody>" + rows + "</tbody></table>" : '<p class="muted">No entries match the filter.</p>') +
      '<div class="ts-bottom"><div class="ts-sign"><span>Approved by</span><span>Date</span></div>' +
      '<dl class="ts-totals"><div><dt>Total hours</dt><dd>' + T.hoursQty(sum.minutes).toFixed(2) + "</dd></div>" +
      (value ? "<div><dt>Billable value</dt><dd>" + fmt(value) + "</dd></div>" : "") + "</dl></div>" +
      (pro ? "" : '<p class="ts-made">Made with Fair Measure</p>') + "</article></div></div>";
    app.onclick = function (e) { if (e.target.closest('[data-act="print"]')) window.print(); };
  }

  // ---------- rates
  function ratesDialog() {
    var st = settings();
    var dlg = openDialog('<form method="dialog" class="dlg-body"><h3>Rates and rounding</h3>' +
      field("My hourly rate", '<input name="rate" inputmode="decimal" placeholder="0.00" value="' + esc(money2(st.rate)) + '">') +
      '<p class="muted small">Not sure what to charge? <a href="' + FM.link("pricing/") + '">Price Builder</a> works out an hourly price that pays you a fair wage and covers your running costs.</p>' +
      '<fieldset class="opts"><legend class="label">When billing, round each line to</legend>' +
      [[0, "Exact minutes"], [6, "Nearest 6 minutes"], [15, "Nearest 15 minutes"]].map(function (o) {
        return '<label class="radio"><input type="radio" name="rounding" value="' + o[0] + '"' + (o[0] === (st.rounding || 0) ? " checked" : "") + "> " + o[1] + "</label>";
      }).join("") + "</fieldset>" +
      '<fieldset class="opts"><legend class="label">My week starts on</legend>' +
      '<label class="radio"><input type="radio" name="ws" value="0"' + (st.weekStart ? "" : " checked") + "> Sunday</label>" +
      '<label class="radio"><input type="radio" name="ws" value="1"' + (st.weekStart ? " checked" : "") + "> Monday</label></fieldset>" +
      '<div class="dlg-actions"><button class="btn ghost" value="cancel" formnovalidate>Cancel</button><button class="btn" value="ok">Save</button></div></form>');
    var form = $("form", dlg);
    dlg.addEventListener("close", function () {
      if (dlg.returnValue !== "ok") return;
      var ws = +form.querySelector('[name="ws"]:checked').value;
      saveSettings({ rate: Math.max(0, M.toCents(form.rate.value)), rounding: +form.querySelector('[name="rounding"]:checked').value, weekStart: ws });
      ui.week = T.weekStartOf(ui.week || today(), ws);
      FM.toast("Saved");
      route();
    });
    form.rate.focus();
  }

  function emptyArt() {
    return '<svg class="art" viewBox="0 0 200 140" aria-hidden="true">' +
      '<ellipse cx="100" cy="124" rx="70" ry="9" fill="#f3eee5"/>' +
      '<circle cx="100" cy="68" r="50" fill="#fffdf9" stroke="#e7ddcd" stroke-width="2"/>' +
      '<circle cx="100" cy="68" r="40" fill="#e5ebf2" opacity=".55"/>' +
      '<path d="M100 40v28l18 11" fill="none" stroke="#3d5876" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>' +
      '<circle cx="100" cy="68" r="4" fill="#9c7630"/>' +
      '<path d="M100 18v-6M80 14h40" stroke="#9c7630" stroke-width="3" stroke-linecap="round"/>' +
      '<path d="M146 92c8 4 14 2 18-4M150 104c6 1 10-2 12-6" fill="none" stroke="#4d6d51" stroke-width="2.5" stroke-linecap="round" opacity=".7"/></svg>';
  }

  document.addEventListener("DOMContentLoaded", function () {
    app = document.getElementById("app");
    window.addEventListener("hashchange", route);
    // Another tab started or stopped the clock, or changed entries: refresh, unless a dialog is open.
    S.onChange(function (key, external) {
      if (!external || document.querySelector("dialog[open]")) return;
      if (key === "timer" || key === "time" || key === "documents" || key === "*") route();
    });
    route();
  });
})();
