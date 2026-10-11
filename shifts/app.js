/* Shift Planner.
   Routes (in the address hash): week "" or "#w/<date>", "#team", "#p/<id>",
   "#view/<code>" (a week someone shared, read-only) and "#ask/<code>" (a swap or cover
   request coming back to the owner). Team members are the shared `staff` collection and
   shifts the `shifts` collection ({id, date, start, end, breakMin, staffId, label, note};
   an empty staffId is an open shift). Schedule settings live in `profile.shiftPlan`. */
(function () {
  "use strict";
  var FM = window.FM, S = FM.store, P = window.FMShifts, M = FM.money, L = FM.license, esc = FM.esc;
  var app, phone = window.matchMedia("(max-width: 760px)");
  var ui = { week: null, day: null };

  var ICON = {
    plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
    back: '<svg viewBox="0 0 24 24"><path d="M15 6l-6 6 6 6"/></svg>',
    next: '<svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg>',
    share: '<svg viewBox="0 0 24 24"><path d="M12 15V4M7.5 8.5L12 4l4.5 4.5M5 13v6h14v-6"/></svg>',
    print: '<svg viewBox="0 0 24 24"><path d="M7 9V4h10v5M7 17H5a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-2"/><path d="M7 14h10v6H7z"/></svg>',
    copy: '<svg viewBox="0 0 24 24"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/></svg>',
    team: '<svg viewBox="0 0 24 24"><circle cx="9" cy="8.5" r="3.2"/><path d="M3.5 19c.8-3.4 3-5.2 5.5-5.2s4.7 1.8 5.5 5.2"/><circle cx="17" cy="9.5" r="2.5"/><path d="M16 14c2.5-.2 4.2 1.4 4.8 4.4"/></svg>',
    cal: '<svg viewBox="0 0 24 24"><rect x="4" y="5.5" width="16" height="15" rx="2"/><path d="M4 10h16M8.5 3.5v4M15.5 3.5v4"/></svg>',
    text: '<svg viewBox="0 0 24 24"><path d="M5 5h14a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H10l-4 3v-3H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z"/></svg>',
    mail: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/></svg>',
    swap: '<svg viewBox="0 0 24 24"><path d="M7 7h12l-3.5-3.5M17 17H5l3.5 3.5"/></svg>',
    warn: '<svg viewBox="0 0 24 24"><path d="M12 4l9 16H3z"/><path d="M12 10v4M12 17.2v.1"/></svg>',
    check: '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7"/></svg>',
    trash: '<svg viewBox="0 0 24 24"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>',
    gear: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M5.6 18.4l1.8-1.8M16.6 7.4l1.8-1.8"/></svg>'
  };

  // ---------- helpers
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function today() { var d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
  function fmtDate(d, opts) {
    try { return new Date(d + "T12:00:00").toLocaleDateString(undefined, opts || { month: "short", day: "numeric" }); }
    catch (e) { return d; }
  }
  function dayName(d) { return fmtDate(d, { weekday: "short" }); }
  function dayLong(d) { return fmtDate(d, { weekday: "long", month: "short", day: "numeric" }); }
  function weekLabel(start) {
    var end = P.addDays(start, 6), y = end.slice(0, 4);
    var a = fmtDate(start, { month: "short", day: "numeric" });
    var b = start.slice(5, 7) === end.slice(5, 7) ? String(+end.slice(8)) : fmtDate(end, { month: "short", day: "numeric" });
    return a + " – " + b + ", " + y;
  }
  function fmt(c) { var p = S.profile(); return M.format(c, p.currency, p.locale || undefined); }
  function field(label, control, cls) { return '<label class="field' + (cls ? " " + cls : "") + '"><span>' + label + "</span>" + control + "</label>"; }
  function go(hash) { if (location.hash === hash || (hash === "#" && !location.hash)) route(); else location.hash = hash; }
  function settings() { return Object.assign({ weekStart: 0, shared: {} }, S.profile().shiftPlan || {}); }
  function saveSettings(patch) { try { S.saveProfile({ shiftPlan: Object.assign(settings(), patch) }); } catch (e) { FM.toast(e.message); } }
  function team() { return S.all("staff").slice().sort(function (a, b) { return (a.order || 0) - (b.order || 0) || String(a.name).localeCompare(String(b.name)); }); }
  function shifts() { return S.all("shifts"); }
  function person(id) { return S.get("staff", id); }
  function hue(id) { var h = 0, s = String(id || ""); for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 4; return h; }
  function avatar(p, cls) { return '<span class="av av-' + hue(p.id) + (cls ? " " + cls : "") + '" aria-hidden="true">' + esc(P.initials(p.name)) + "</span>"; }
  function digits(p) { return String(p || "").replace(/[^\d+]/g, ""); }
  function smsHref(num, body) { return "sms:" + digits(num) + "?&body=" + encodeURIComponent(body); }
  function mailHref(to, subject, body) { return "mailto:" + encodeURIComponent(to || "") + "?subject=" + encodeURIComponent(subject) + "&body=" + encodeURIComponent(body); }
  function business() { return S.profile().name || "our team"; }
  function download(name, type, text) {
    var a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: type }));
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  function slug(s) { return String(s || "schedule").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "schedule"; }
  function copyText(text, input) {
    var done = function () { FM.toast("Link copied"); };
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text).then(done, function () { fallback(); });
    fallback();
    function fallback() { if (input) { input.focus(); input.select(); try { document.execCommand("copy"); done(); } catch (e) { FM.toast("Select the link and copy it"); } } }
  }
  function put(col, rec) { try { return S.put(col, rec); } catch (e) { FM.toast(e.message); return rec; } }

  function limitDialog() {
    return FM.confirm({
      title: "You've reached the free limit",
      body: "The free version plans for up to " + L.limits.staff + " people. Pro removes every limit for a one-time " + L.config.price + ".",
      ok: "See Pro", cancel: "Not now"
    }).then(function (yes) { if (yes) location.href = FM.link("settings/#pro"); return false; });
  }

  // A dialog with a form; resolves with the button value that closed it.
  function openDialog(html, cls) {
    var dlg = document.createElement("dialog");
    dlg.className = "fm-dialog sp-dialog" + (cls ? " " + cls : "");
    dlg.innerHTML = html;
    document.body.appendChild(dlg);
    dlg.addEventListener("close", function () { setTimeout(function () { dlg.remove(); }, 0); });
    dlg.showModal();
    return dlg;
  }

  // ---------- routing
  function route() {
    var h = location.hash.replace(/^#/, "");
    app.onclick = null;
    document.body.classList.remove("sp-viewing");
    if (h.indexOf("view/") === 0) return renderShared(h.slice(5));
    if (h.indexOf("ask/") === 0) return renderAsk(h.slice(4));
    window.scrollTo(0, 0);
    if (h === "team") return renderTeam();
    if (h.indexOf("p/") === 0) return renderPerson(h.slice(2));
    if (h.indexOf("w/") === 0 && P.validDate(h.slice(2))) ui.week = P.weekStartOf(h.slice(2), settings().weekStart);
    renderWeek();
  }

  function head(inner, sub) {
    return '<div class="wrap app-head no-print"><div><div class="app-title"><h1>Shift Planner</h1>' +
      (L.isPro() ? '<span class="fm-pro-chip">Pro</span>' : "") + "</div>" + (sub ? '<p class="muted sub">' + sub + "</p>" : "") + "</div>" + (inner || "") + "</div>";
  }

  // ---------- first run
  function renderStart() {
    app.innerHTML = head() + '<div class="wrap"><div class="empty">' + emptyArt() +
      "<h2>Who's on your team?</h2>" +
      '<p class="muted">Type everyone you schedule, one name per line. You can add roles, phone numbers and days off later, or never.</p>' +
      '<form id="start" class="start-form"><label class="field"><span class="sr">Names, one per line</span><textarea name="names" rows="5" placeholder="Ana Ruiz\nBen Okafor\nClare Doyle"></textarea></label>' +
      '<fieldset class="weekstart"><legend class="label">My week starts on</legend>' +
      '<label class="radio"><input type="radio" name="ws" value="0" checked> Sunday</label><label class="radio"><input type="radio" name="ws" value="1"> Monday</label></fieldset>' +
      '<p class="err" hidden></p><button class="btn" type="submit">Start the schedule</button></form>' +
      '<p class="muted small">Everything stays on this device. Nothing is uploaded, and nobody needs an account.</p></div></div>';
    $("#start").addEventListener("submit", function (e) {
      e.preventDefault();
      var names = this.names.value.split(/\n|,/).map(function (s) { return s.trim(); }).filter(Boolean)
        .filter(function (n, i, a) { return a.indexOf(n) === i; });
      var err = $(".err", this);
      if (!names.length) { err.textContent = "Add at least one name, even if it's just you."; err.hidden = false; this.names.focus(); return; }
      var room = L.isPro() ? names.length : Math.max(0, L.limits.staff - S.count("staff"));
      names.slice(0, room).forEach(function (n, i) { put("staff", { name: n, role: "", order: i }); });
      saveSettings({ weekStart: +this.ws.value });
      ui.week = P.weekStartOf(today(), +this.ws.value);
      if (names.length > room) FM.toast("Added the first " + room + ". Pro plans for any size team.");
      else FM.toast(names.length === 1 ? "Added. Now add a shift." : names.length + " people added. Now add some shifts.");
      renderWeek();
    });
  }

  // ---------- the week
  function renderWeek() {
    var people = team();
    if (!people.length && !shifts().length) return renderStart();
    var st = settings();
    if (!ui.week) ui.week = P.weekStartOf(today(), st.weekStart);
    var start = ui.week, dates = P.weekDates(start), all = shifts();
    var week = P.sortShifts(P.inWeek(all, start));
    var totals = P.weekTotals(people, all, start), warn = P.warnings(people, all, start);
    var warnCount = Object.keys(warn).length;
    var sharedCode = st.shared && st.shared[start];
    var shareState = sharedCode ? (sharedCode === packFor(start) ? '<span class="pill green">' + ICON.check + "Shared</span>" : '<span class="pill gold">Changed since you shared it</span>') : "";
    var t = today();
    if (!ui.day || ui.day < start || ui.day > dates[6]) ui.day = t >= start && t <= dates[6] ? t : start;

    var lastWeek = P.inWeek(all, P.addDays(start, -7)).length;
    app.innerHTML = head('<div class="head-actions"><button class="btn" data-act="share">' + ICON.share + "Share with the team</button>" +
      '<a class="btn ghost" href="#team">' + ICON.team + "Team</a>" +
      '<button class="btn ghost" data-act="print">' + ICON.print + 'Print</button></div>') +
      '<div class="wrap">' + backupNote() +
      '<div class="week-bar no-print"><div class="week-nav">' +
      '<button class="icon-btn round" data-act="prev" aria-label="Previous week">' + ICON.back + "</button>" +
      '<h2 class="week-title" aria-live="polite">' + esc(weekLabel(start)) + "</h2>" +
      '<button class="icon-btn round" data-act="next" aria-label="Next week">' + ICON.next + "</button>" +
      (t >= start && t <= dates[6] ? "" : '<button class="btn small ghost" data-act="this">This week</button>') + "</div>" +
      '<div class="week-tools">' + shareState +
      (lastWeek ? '<button class="link-btn" data-act="copy-last">' + ICON.copy + "Copy last week</button>" : "") +
      '<button class="link-btn" data-act="settings">' + ICON.gear + "Schedule settings</button></div></div>" +
      tiles(totals, week, warnCount) +
      (phone.matches ? dayView(people, all, dates, warn, totals) : gridView(people, all, dates, warn, totals)) +
      warnList(warn, all) +
      printSheet(people, all, start) +
      limitNote() + "</div>";

    app.onclick = function (e) {
      var b = e.target.closest("[data-act],[data-shift],[data-add],[data-day]");
      if (!b) return;
      if (b.hasAttribute("data-shift")) return shiftDialog(S.get("shifts", b.getAttribute("data-shift")));
      if (b.hasAttribute("data-add")) { var p = b.getAttribute("data-add").split("|"); return shiftDialog({ date: p[0], staffId: p[1] || "" }); }
      if (b.hasAttribute("data-day")) { ui.day = b.getAttribute("data-day"); return renderWeek(); }
      var act = b.getAttribute("data-act");
      if (act === "prev" || act === "next") { ui.week = P.addDays(start, act === "prev" ? -7 : 7); history.replaceState(null, "", "#w/" + ui.week); renderWeek(); }
      if (act === "this") { ui.week = P.weekStartOf(today(), st.weekStart); history.replaceState(null, "", location.pathname); renderWeek(); }
      if (act === "share") shareDialog(start);
      if (act === "print") window.print();
      if (act === "copy-last") copyLastWeek(start);
      if (act === "settings") settingsDialog();
      if (act === "backup") { FM.backup.download(); FM.toast("Backup downloaded"); renderWeek(); }
    };
  }

  function tiles(totals, week, warnCount) {
    var cost = totals.minutes && totals.priced
      ? "<b>" + fmt(totals.cost) + "</b><small>" + (totals.overtime ? "Includes " + P.fmtHours(totals.overtime) + " of overtime" : "Wages for the hours scheduled") + "</small>"
      : totals.minutes ? '<b class="soft">Add wages</b><small><a href="#team">Set hourly pay</a> to see the week\'s cost</small>'
      : "<b>" + fmt(0) + "</b><small>Wages for the hours scheduled</small>";
    return '<div class="tiles no-print">' +
      '<div class="tile"><span>Hours scheduled</span><b>' + P.hours(totals.minutes) + "</b><small>" + (week.length - totals.open) + (week.length - totals.open === 1 ? " shift" : " shifts") + " this week</small></div>" +
      '<div class="tile"><span>Wages</span>' + cost + "</div>" +
      '<div class="tile' + (totals.open ? " warm" : "") + '"><span>Open shifts</span><b>' + totals.open + "</b><small>" + (totals.open ? P.fmtHours(totals.openMinutes) + " need someone" : "Everything is covered") + "</small></div>" +
      '<div class="tile' + (warnCount ? " rose" : "") + '"><span>Worth a look</span><b>' + warnCount + "</b><small>" + (warnCount ? '<a href="#warnings">See what and why</a>' : "No clashes or long weeks") + "</small></div></div>";
  }

  function chip(s, warn, people) {
    var w = warn[s.id], p = people && s.staffId ? people.find(function (x) { return x.id === s.staffId; }) : null;
    var cls = s.staffId ? "c-" + hue(s.staffId) : "c-open";
    var who = p ? p.name : s.staffId ? "Former team member" : "Open shift";
    return '<button type="button" class="shift ' + cls + (w ? " has-warn" : "") + '" data-shift="' + esc(s.id) + '"' + (w ? ' title="' + esc(w.join(". ")) + '"' : "") + ">" +
      '<span class="sr">' + esc(who) + ", " + esc(dayLong(s.date)) + ", </span>" +
      '<b>' + esc(P.span(s)) + "</b>" + (s.label ? "<small>" + esc(s.label) + "</small>" : "") +
      (w ? '<span class="dot" aria-hidden="true"></span><span class="sr">. ' + esc(w.join(". ")) + "</span>" : "") + "</button>";
  }

  function gridView(people, all, dates, warn, totals) {
    var t = today(), byCell = {};
    P.inWeek(all, dates[0]).forEach(function (s) {
      var k = (s.staffId && people.some(function (p) { return p.id === s.staffId; }) ? s.staffId : "") + "|" + s.date;
      (byCell[k] = byCell[k] || []).push(s);
    });
    function cell(pid, d, p) {
      var list = P.sortShifts(byCell[pid + "|" + d] || []);
      var off = p && P.onTimeOff(p, d) ? '<span class="off-tag">Time off</span>' : p && P.dayOff(p, d) && !list.length ? '<span class="off-tag soft">Off</span>' : "";
      return '<td class="' + (d === t ? "today" : "") + (off ? " is-off" : "") + '">' + off + list.map(function (s) { return chip(s, warn, people); }).join("") +
        '<button type="button" class="cell-add" data-add="' + esc(d + "|" + pid) + '"><span aria-hidden="true">+</span><span class="sr">Add a shift for ' + esc(p ? p.name : "anyone") + " on " + esc(dayLong(d)) + "</span></button></td>";
    }
    var openRow = '<tr class="open-row"><th scope="row"><span class="who"><span class="av av-open" aria-hidden="true">?</span><span><b>Open shifts</b><small>Anyone can take</small></span></span></th>' +
      dates.map(function (d) { return cell("", d, null); }).join("") + '<td class="hrs">' + (totals.openMinutes ? P.hours(totals.openMinutes) : "") + "</td></tr>";
    var rows = people.map(function (p) {
      var tt = totals.by[p.id], max = parseFloat(p.maxHours) || 0;
      var hrs = tt.minutes ? P.hours(tt.minutes) : "–";
      var flag = tt.overtime ? '<small class="ot">' + P.hours(tt.overtime) + " OT</small>" : max ? "<small>of " + max + "</small>" : "";
      return '<tr><th scope="row"><a class="who" href="#p/' + esc(p.id) + '">' + avatar(p) + "<span><b>" + esc(p.name) + "</b>" + (p.role ? "<small>" + esc(p.role) + "</small>" : "") + "</span></a></th>" +
        dates.map(function (d) { return cell(p.id, d, p); }).join("") + '<td class="hrs' + (tt.overtime || (max && tt.minutes > max * 60) ? " over" : "") + '"><b>' + hrs + "</b>" + flag + "</td></tr>";
    }).join("");
    return '<div class="grid-wrap no-print"><table class="grid"><caption class="sr">Schedule for ' + esc(weekLabel(dates[0])) + "</caption><thead><tr><th scope=\"col\" class=\"team-h\">Team</th>" +
      dates.map(function (d) { return '<th scope="col" class="' + (d === t ? "today" : "") + '"><span>' + esc(dayName(d)) + "</span><b>" + (+d.slice(8)) + "</b></th>"; }).join("") +
      '<th scope="col" class="hrs">Hours</th></tr></thead><tbody>' + openRow + rows + "</tbody></table></div>" +
      '<p class="hint muted no-print">Tap an empty square to add a shift, or a shift to change it or find cover.</p>';
  }

  function dayView(people, all, dates, warn, totals) {
    var t = today(), d = ui.day;
    var strip = '<div class="day-strip no-print" role="group" aria-label="Day">' + dates.map(function (x) {
      var n = P.inWeek(all, dates[0]).filter(function (s) { return s.date === x; }).length;
      return '<button type="button" class="day-btn' + (x === t ? " today" : "") + '" data-day="' + x + '" aria-pressed="' + (x === d) + '"><span>' + esc(dayName(x).slice(0, 3)) + "</span><b>" + (+x.slice(8)) + "</b><i>" + (n ? n : "") + "</i></button>";
    }).join("") + "</div>";
    var list = P.sortShifts(all.filter(function (s) { return s.date === d; }));
    var off = people.filter(function (p) { return P.onTimeOff(p, d); });
    var rows = list.map(function (s) {
      var p = people.find(function (x) { return x.id === s.staffId; });
      return '<li class="day-row">' + (p ? avatar(p) : '<span class="av av-open" aria-hidden="true">?</span>') +
        '<div class="day-main"><b>' + esc(p ? p.name : s.staffId ? "Former team member" : "Open shift") + "</b><span class=\"muted\">" + esc(p ? p.role : "") + "</span>" +
        (warn[s.id] ? '<span class="warn-line">' + ICON.warn + esc(warn[s.id][0]) + "</span>" : "") + "</div>" + chip(s, warn, people) + "</li>";
    }).join("");
    var hours = people.map(function (p) {
      var tt = totals.by[p.id];
      return '<li><a href="#p/' + esc(p.id) + '">' + avatar(p, "sm") + "<span>" + esc(p.name) + "</span></a><b" + (tt.overtime ? ' class="ot"' : "") + ">" + (tt.minutes ? P.fmtHours(tt.minutes) : "–") + "</b></li>";
    }).join("");
    return '<div class="no-print">' + strip + '<section class="card day-card" aria-labelledby="day-h"><div class="day-head"><h2 class="sec" id="day-h">' + esc(dayLong(d)) + "</h2>" +
      '<button class="btn small" data-add="' + d + '|">' + ICON.plus + "Add a shift</button></div>" +
      (rows ? '<ul class="day-list">' + rows + "</ul>" : '<p class="muted none">Nobody is scheduled yet.</p>') +
      (off.length ? '<p class="muted off-line">Time off: ' + esc(off.map(function (p) { return p.name; }).join(", ")) + "</p>" : "") + "</section>" +
      '<section class="card hours-card" aria-labelledby="hrs-h"><h2 class="sec" id="hrs-h">Hours this week</h2><ul class="hours-list">' + hours +
      (totals.open ? '<li><span><span class="av av-open sm" aria-hidden="true">?</span><span>Open shifts</span></span><b>' + P.fmtHours(totals.openMinutes) + "</b></li>" : "") + "</ul></section></div>";
  }

  function warnList(warn, all) {
    var ids = Object.keys(warn);
    if (!ids.length) return "";
    var list = P.sortShifts(ids.map(function (id) { return all.find(function (s) { return s.id === id; }); }).filter(Boolean));
    return '<section class="card warns no-print" id="warnings" aria-labelledby="warn-h"><h2 class="sec" id="warn-h">' + ICON.warn + "Worth a look</h2>" +
      '<p class="muted small">Nothing here stops you; it\'s only what a careful manager would want to know.</p><ul>' +
      list.map(function (s) {
        var p = person(s.staffId);
        return '<li><button type="button" class="warn-row" data-shift="' + esc(s.id) + '"><b>' + esc(dayLong(s.date)) + ", " + esc(P.span(s)) + (p ? " · " + esc(p.name) : "") + "</b><span>" + esc(warn[s.id].join(". ")) + "</span></button></li>";
      }).join("") + "</ul></section>";
  }

  // A plain grid for paper, built for every screen size.
  function printSheet(people, all, start) {
    var dates = P.weekDates(start), week = P.inWeek(all, start), prof = S.profile();
    function cellFor(pid, d) {
      var list = P.sortShifts(week.filter(function (s) { return (s.staffId || "") === pid && s.date === d; }));
      return "<td>" + list.map(function (s) { return "<div>" + esc(P.span(s)) + (s.label ? " <i>" + esc(s.label) + "</i>" : "") + "</div>"; }).join("") + "</td>";
    }
    var openAny = week.some(function (s) { return !s.staffId; });
    var totals = P.weekTotals(people, all, start);
    return '<div class="print-sheet" aria-hidden="true"><div class="ps-head"><div><h2>' + esc(prof.name || "Staff schedule") + "</h2><p>Week of " + esc(weekLabel(start)) + "</p></div>" +
      (prof.phone || prof.email ? "<p>Questions or swaps: " + esc(prof.phone || prof.email) + "</p>" : "") + "</div>" +
      "<table><thead><tr><th></th>" + dates.map(function (d) { return "<th>" + esc(dayName(d)) + " " + (+d.slice(8)) + "</th>"; }).join("") + "<th>Hrs</th></tr></thead><tbody>" +
      people.map(function (p) { return "<tr><th>" + esc(p.name) + (p.role ? "<small>" + esc(p.role) + "</small>" : "") + "</th>" + dates.map(function (d) { return cellFor(p.id, d); }).join("") + "<td>" + (P.hours(totals.by[p.id].minutes) || "") + "</td></tr>"; }).join("") +
      (openAny ? "<tr><th>Open shifts</th>" + dates.map(function (d) { return cellFor("", d); }).join("") + "<td></td></tr>" : "") +
      "</tbody></table>" + (L.isPro() ? "" : '<p class="ps-foot">Made with Fair Measure</p>') + "</div>";
  }

  function backupNote() {
    return FM.backup.due() || (S.count("shifts") >= 20 && !FM.backup.last())
      ? '<div class="notice blue backup-note no-print"><span>Your schedule lives on this device. Download a backup now and then so nothing is lost.</span><button class="btn small ghost" data-act="backup">Download backup</button></div>'
      : "";
  }
  function limitNote() {
    if (L.isPro()) return "";
    var used = S.count("staff"), lim = L.limits.staff;
    if (used < lim - 1) return "";
    return '<p class="limit-note muted no-print">' + used + " of " + lim + ' people on the free plan. <a href="' + FM.link("settings/#pro") + '">Pro</a> plans for any size team.</p>';
  }

  function copyLastWeek(start) {
    var from = P.addDays(start, -7), copies = P.copyWeek(shifts(), from, start);
    if (!copies.length) { FM.toast("Everything from last week is already here"); return; }
    FM.confirm({ title: "Copy last week's shifts?", body: copies.length + (copies.length === 1 ? " shift" : " shifts") + " from " + weekLabel(from) + " will be added to this week. Anything already here stays.", ok: "Copy them", cancel: "Not now" })
      .then(function (y) {
        if (!y) return;
        copies.forEach(function (s) { put("shifts", s); });
        FM.toast(copies.length + (copies.length === 1 ? " shift copied" : " shifts copied"));
        renderWeek();
      });
  }

  // The start and end times used most often, so most shifts take one tap.
  function usualTimes() {
    var count = {};
    shifts().forEach(function (s) { var k = s.start + "|" + s.end + "|" + (s.breakMin || 0); count[k] = (count[k] || 0) + 1; });
    return Object.keys(count).sort(function (a, b) { return count[b] - count[a]; }).slice(0, 4).map(function (k) { var p = k.split("|"); return { start: p[0], end: p[1], breakMin: +p[2] }; });
  }

  // ---------- add or change a shift
  function shiftDialog(rec) {
    if (!rec) return;
    var isNew = !rec.id, people = team();
    var s = Object.assign({ start: "", end: "", breakMin: 0, label: "", note: "" }, rec);
    if (isNew && !s.start) { var u = usualTimes()[0]; if (u) { s.start = u.start; s.end = u.end; s.breakMin = u.breakMin; } else { s.start = "09:00"; s.end = "17:00"; } }
    var usual = usualTimes();
    var known = people.some(function (p) { return p.id === s.staffId; });
    var whoOpts = '<option value="">Open shift (anyone can take it)</option>' + people.map(function (p) {
      return '<option value="' + esc(p.id) + '"' + (p.id === s.staffId ? " selected" : "") + ">" + esc(p.name) + (p.role ? " · " + esc(p.role) : "") + "</option>";
    }).join("") + (s.staffId && !known ? '<option value="' + esc(s.staffId) + '" selected>Former team member</option>' : "");
    var start = P.weekStartOf(s.date, settings().weekStart), dates = P.weekDates(start);
    var dlg = openDialog('<form method="dialog" class="dlg-body shift-form" novalidate><h3>' + (isNew ? "Add a shift" : "Change this shift") + "</h3>" +
      field("Who", '<select name="staffId">' + whoOpts + "</select>") +
      (usual.length ? '<div class="quick" role="group" aria-label="Usual times">' + usual.map(function (q) {
        return '<button type="button" class="chip small" data-quick="' + esc(q.start + "|" + q.end + "|" + q.breakMin) + '">' + esc(P.shortTime(q.start) + "–" + P.shortTime(q.end)) + "</button>";
      }).join("") + "</div>" : "") +
      '<div class="grid-3 times">' + field("Day", '<input type="date" name="date" value="' + esc(s.date) + '" required>') +
      field("Starts", '<input type="time" name="start" value="' + esc(s.start) + '" required step="300">') +
      field("Ends", '<input type="time" name="end" value="' + esc(s.end) + '" required step="300">') + "</div>" +
      '<p class="muted small len" aria-live="polite"></p>' +
      '<div class="grid-2">' + field("Unpaid break <i>(minutes)</i>", '<input type="number" name="breakMin" min="0" max="240" step="5" inputmode="numeric" value="' + esc(s.breakMin || 0) + '">') +
      field("Station or task <i>(optional)</i>", '<input name="label" maxlength="40" value="' + esc(s.label) + '" placeholder="e.g. Register, Ovens" autocomplete="off">') + "</div>" +
      field("Note <i>(optional, shown to the team)</i>", '<input name="note" maxlength="120" value="' + esc(s.note) + '" autocomplete="off">') +
      (isNew ? '<fieldset class="repeat"><legend class="label">Also add it on</legend><div class="chips">' + dates.map(function (d) {
        return '<label class="chip small tog"><input type="checkbox" name="repeat" value="' + d + '"' + (d === s.date ? " disabled" : "") + "><span>" + esc(dayName(d)) + "</span></label>";
      }).join("") + "</div></fieldset>" : "") +
      (!isNew ? '<div class="cover" hidden></div>' : "") +
      '<p class="err" role="alert" hidden></p>' +
      '<div class="dlg-actions">' + (!isNew ? '<button type="button" class="btn danger" data-act="delete">' + ICON.trash + "Delete</button>" +
        '<button type="button" class="btn ghost" data-act="cover">' + ICON.team + "Find cover</button><span class=\"grow\"></span>" : "") +
      '<button class="btn ghost" value="cancel" formnovalidate>Cancel</button><button class="btn" value="ok">' + (isNew ? "Add shift" : "Save") + "</button></div></form>", "wide");
    var form = $("form", dlg), err = $(".err", dlg);

    function current() {
      return Object.assign({}, rec, {
        staffId: form.staffId.value, date: form.date.value, start: form.start.value, end: form.end.value,
        breakMin: Math.max(0, Math.min(240, parseInt(form.breakMin.value, 10) || 0)), label: form.label.value.trim(), note: form.note.value.trim()
      });
    }
    function showLen() {
      var c = current();
      $(".len", dlg).textContent = P.minutes(c.start) != null && P.minutes(c.end) != null
        ? P.fmtHours(P.shiftMinutes(c)) + " paid" + (P.minutes(c.end) <= P.minutes(c.start) ? ", ending the next morning" : "") : "";
    }
    showLen();
    form.addEventListener("input", showLen);
    $$("[data-quick]", dlg).forEach(function (b) {
      b.addEventListener("click", function () { var q = b.getAttribute("data-quick").split("|"); form.start.value = q[0]; form.end.value = q[1]; form.breakMin.value = q[2]; showLen(); });
    });
    form.addEventListener("submit", function (e) {
      if (e.submitter && e.submitter.value === "cancel") return;
      var c = current(), msg = "";
      if (!P.validDate(c.date)) msg = "Pick a day for the shift.";
      else if (P.minutes(c.start) == null || P.minutes(c.end) == null) msg = "Add a start and end time.";
      else if (P.shiftMinutes(c) <= 0) msg = "The break is as long as the shift.";
      if (msg) { e.preventDefault(); err.textContent = msg; err.hidden = false; }
    });
    var del = $('[data-act="delete"]', dlg);
    if (del) del.addEventListener("click", function () {
      S.remove("shifts", rec.id); dlg.close("deleted"); FM.toast("Shift deleted"); renderWeek();
    });
    var cov = $('[data-act="cover"]', dlg);
    if (cov) cov.addEventListener("click", function () { cov.hidden = true; coverPanel($(".cover", dlg), current(), dlg); });
    dlg.addEventListener("close", function () {
      if (dlg.returnValue !== "ok") return;
      var c = current(), extra = isNew ? $$('input[name="repeat"]:checked', dlg).map(function (i) { return i.value; }) : [];
      put("shifts", c);
      extra.forEach(function (d) { var copy = Object.assign({}, c, { date: d }); delete copy.id; put("shifts", copy); });
      ui.day = c.date;
      FM.toast(isNew ? (extra.length ? extra.length + 1 + " shifts added" : "Shift added") : "Saved");
      if (P.weekStartOf(c.date, settings().weekStart) !== ui.week) ui.week = P.weekStartOf(c.date, settings().weekStart);
      renderWeek();
    });
  }

  function coverPanel(box, s, dlg) {
    var people = team(), opts = P.coverOptions(people, shifts(), s, P.weekStartOf(s.date, settings().weekStart));
    var when = dayLong(s.date) + ", " + P.span(s);
    var ask = "Hi {name}, could you cover a shift " + when + (S.profile().name ? " at " + S.profile().name : "") + "? Let me know. Thank you!";
    box.innerHTML = '<h4>Who could cover ' + esc(when) + "</h4>" + (opts.length ? '<ul class="cover-list">' + opts.map(function (o) {
      var p = o.person, note = !o.free ? o.note : o.usualDayOff ? "usually off that day" : o.over ? "would go past their usual hours" : "";
      return '<li class="' + (o.free ? "" : "busy") + '">' + avatar(p, "sm") + '<span class="cov-main"><b>' + esc(p.name) + "</b><small>" + esc(P.fmtHours(o.minutes)) + " this week" + (note ? " · " + esc(note) : "") + "</small></span>" +
        (p.phone ? '<a class="btn small ghost" href="' + esc(smsHref(p.phone, ask.replace("{name}", P.firstName(p.name)))) + '">' + ICON.text + '<span class="hide-sm">Ask</span><span class="sr"> ' + esc(p.name) + " by text</span></a>" : "") +
        (o.free ? '<button type="button" class="btn small" data-give="' + esc(p.id) + '">Give it to ' + esc(P.firstName(p.name)) + "</button>" : "") + "</li>";
    }).join("") + "</ul>" : '<p class="muted">Add more people to your team to see who could cover.</p>') +
      (s.staffId ? '<button type="button" class="link-btn" data-give="">Leave it open for now</button>' : "");
    box.hidden = false;
    $$("[data-give]", box).forEach(function (b) {
      b.addEventListener("click", function () {
        var id = b.getAttribute("data-give"), c = Object.assign({}, s, { staffId: id });
        if (!c.id) return;
        put("shifts", c);
        dlg.close("given");
        FM.toast(id ? "Given to " + P.firstName(person(id).name) : "Marked as an open shift");
        renderWeek();
      });
    });
    box.scrollIntoView({ block: "nearest" });
  }

  function settingsDialog() {
    var st = settings();
    var dlg = openDialog('<form method="dialog" class="dlg-body"><h3>Schedule settings</h3>' +
      '<fieldset class="weekstart"><legend class="label">Weeks start on</legend>' +
      '<label class="radio"><input type="radio" name="ws" value="0"' + (st.weekStart ? "" : " checked") + "> Sunday</label>" +
      '<label class="radio"><input type="radio" name="ws" value="1"' + (st.weekStart === 1 ? " checked" : "") + "> Monday</label></fieldset>" +
      '<p class="muted small">Overtime is counted past 40 hours in a week, at time and a half, as US federal law requires. Some states (California, Alaska, Nevada and Colorado among them) also count daily overtime; check your state\'s rules.</p>' +
      '<p class="muted small">Your business name and phone number come from <a href="' + FM.link("settings/") + '">My business</a> and show on shared and printed schedules.</p>' +
      '<div class="dlg-actions"><button class="btn ghost" value="cancel">Cancel</button><button class="btn" value="ok">Save</button></div></form>');
    dlg.addEventListener("close", function () {
      if (dlg.returnValue !== "ok") return;
      var ws = +$("form", dlg).ws.value;
      saveSettings({ weekStart: ws });
      ui.week = P.weekStartOf(ui.week || today(), ws);
      renderWeek();
    });
  }

  // ---------- sharing
  // A short fingerprint of the week as shared, to notice changes made afterwards.
  function packFor(start) {
    var p = S.profile(), s = P.packWeek({ business: p.name, contact: p.phone || p.email }, team(), shifts(), start), h = 5381;
    for (var i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
    return h.toString(36) + s.length.toString(36);
  }
  function shareLink(start) {
    var code = P.packWeek({ business: S.profile().name, contact: S.profile().phone || S.profile().email, at: today() }, team(), shifts(), start);
    return FM.link("shifts/") + "#view/" + code;
  }

  function shareDialog(start) {
    var people = team(), all = shifts(), week = P.inWeek(all, start), url = shareLink(start), biz = business();
    if (!week.length) { FM.toast("Add some shifts to this week first"); return; }
    var shared = {}; shared[start] = packFor(start);
    saveSettings({ shared: Object.assign({}, settings().shared, shared) });
    var rows = people.map(function (p) {
      var mine = week.filter(function (s) { return s.staffId === p.id; });
      var msg = "Hi " + P.firstName(p.name) + ", here " + (mine.length ? "are your shifts" : "is the schedule") + " for the week of " + weekLabel(start) + ":\n" +
        (mine.length ? P.textSchedule(mine) + "\n" : "") + "\nWhole schedule: " + url;
      return '<li data-pid="' + esc(p.id) + '">' + avatar(p, "sm") + '<span class="cov-main"><b>' + esc(p.name) + "</b><small>" + (mine.length ? mine.length + (mine.length === 1 ? " shift, " : " shifts, ") + P.fmtHours(mine.reduce(function (a, s) { return a + P.shiftMinutes(s); }, 0)) : "Not scheduled this week") + "</small></span>" +
        '<span class="share-btns">' +
        (p.phone ? '<a class="btn small ghost" href="' + esc(smsHref(p.phone, msg)) + '">' + ICON.text + "Text</a>" : "") +
        (p.email ? '<a class="btn small ghost" href="' + esc(mailHref(p.email, "Schedule for the week of " + weekLabel(start), msg)) + '">' + ICON.mail + "Email</a>" : "") +
        (mine.length ? '<button type="button" class="btn small ghost" data-ics="' + esc(p.id) + '">' + ICON.cal + '<span class="hide-sm">Calendar</span><span class="sr"> file for ' + esc(p.name) + "</span></button>" : "") +
        "</span></li>";
    }).join("");
    var dlg = openDialog('<form method="dialog" class="dlg-body"><h3>Share the week of ' + esc(weekLabel(start)) + "</h3>" +
      '<p class="muted">The schedule travels inside this link, so nothing is uploaded and nobody needs an account. Anyone with the link can see names and shift times for this week. Phone numbers and pay are never included.</p>' +
      '<div class="link-row"><label class="sr" for="share-url">Schedule link</label><input id="share-url" class="input" readonly value="' + esc(url) + '">' +
      '<button type="button" class="btn" data-act="copy">' + ICON.copy + "Copy link</button>" +
      (navigator.share ? '<button type="button" class="btn ghost" data-act="native">' + ICON.share + "Share</button>" : "") + "</div>" +
      '<p class="muted small">From the link, people can add their shifts to their calendar and ask you for a swap. Nothing changes until you approve it. If you change the schedule, share it again.</p>' +
      '<h4>Send each person their shifts</h4><ul class="cover-list share-list">' + rows + "</ul>" +
      (people.some(function (p) { return p.phone || p.email; }) ? "" : '<p class="muted small">Add phone numbers on the <a href="#team">Team</a> page to text people their shifts in one tap.</p>') +
      '<div class="dlg-actions"><button type="button" class="btn ghost" data-act="ics-all">' + ICON.cal + 'Calendar file for everyone</button><span class="grow"></span><button class="btn" value="done">Done</button></div></form>', "wide");
    var input = $("#share-url", dlg);
    dlg.addEventListener("click", function (e) {
      var b = e.target.closest("[data-act],[data-ics]"); if (!b) return;
      if (b.getAttribute("data-act") === "copy") copyText(url, input);
      if (b.getAttribute("data-act") === "native") navigator.share({ title: biz + " schedule", text: "Schedule for the week of " + weekLabel(start), url: url }).catch(function () {});
      if (b.hasAttribute("data-ics")) {
        var p = person(b.getAttribute("data-ics"));
        download(slug(p.name) + "-shifts-" + start + ".ics", "text/calendar", P.ics(week.filter(function (s) { return s.staffId === p.id; }), { name: P.firstName(p.name) + "'s shifts", title: function (s) { return "Shift" + (S.profile().name ? " at " + S.profile().name : "") + (s.label ? " (" + s.label + ")" : ""); } }));
        FM.toast("Calendar file downloaded");
      }
      if (b.getAttribute("data-act") === "ics-all") {
        download("schedule-" + start + ".ics", "text/calendar", P.ics(week, { name: biz + " schedule", title: function (s) { var p = person(s.staffId); return (p ? p.name : "Open shift") + (s.label ? " (" + s.label + ")" : ""); } }));
        FM.toast("Calendar file downloaded");
      }
    });
    dlg.addEventListener("close", function () { renderWeek(); });
  }

  // ---------- a shared week, as a team member sees it
  function renderShared(code) {
    var w = P.unpackWeek(code);
    document.body.classList.add("sp-viewing");
    if (!w) {
      app.innerHTML = '<div class="wrap narrow view"><div class="empty"><h1>This link looks incomplete</h1><p class="muted">Part of the schedule link may have been cut off. Ask for it again, or copy the whole link.</p></div></div>';
      return;
    }
    var me = S.raw.read("shiftsMe", {})[w.start.slice(0, 4) + (w.business || "")] || "";
    if (!w.staff.some(function (p) { return p.id === me; })) me = "";
    var dates = P.weekDates(w.start), name = function (id) { var p = w.staff.find(function (x) { return x.id === id; }); return p ? p.name : "Open shift"; };
    var mine = P.sortShifts(w.shifts.filter(function (s) { return me && s.staffId === me; }));
    var t = today();
    var days = dates.map(function (d) {
      var list = P.sortShifts(w.shifts.filter(function (s) { return s.date === d; }));
      return '<section class="v-day' + (d === t ? " today" : "") + '"><h3>' + esc(dayLong(d)) + (d === t ? ' <span class="pill blue">Today</span>' : "") + "</h3>" +
        (list.length ? "<ul>" + list.map(function (s) {
          var isMe = me && s.staffId === me;
          return '<li class="' + (isMe ? "me" : "") + (s.staffId ? "" : " open") + '"><b>' + esc(P.span(s)) + "</b><span>" + esc(name(s.staffId)) + (s.label ? " · " + esc(s.label) : "") + (s.note ? '<small>' + esc(s.note) + "</small>" : "") + "</span>" +
            (isMe ? '<button type="button" class="btn small ghost" data-ask="' + esc(s.id) + '">' + ICON.swap + "Can't make it?</button>" : "") +
            (!s.staffId && me ? '<button type="button" class="btn small ghost" data-take="' + esc(s.id) + '">I can take it</button>' : "") + "</li>";
        }).join("") + "</ul>" : '<p class="muted">Nobody scheduled.</p>') + "</section>";
    }).join("");
    app.innerHTML = '<div class="wrap narrow view">' +
      '<div class="v-head"><p class="eyebrow">' + esc(w.business || "Staff schedule") + "</p><h1>Week of " + esc(weekLabel(w.start)) + "</h1>" +
      '<p class="muted">' + (w.at ? "Shared " + esc(fmtDate(w.at, { month: "long", day: "numeric" })) + ". " : "") + (w.contact ? "Questions? " + esc(w.contact) + "." : "") + "</p></div>" +
      '<div class="card v-me no-print"><label class="field"><span>Who are you?</span><select id="me"><option value="">Choose your name</option>' +
      w.staff.map(function (p) { return '<option value="' + esc(p.id) + '"' + (p.id === me ? " selected" : "") + ">" + esc(p.name) + "</option>"; }).join("") + "</select></label>" +
      (me ? (mine.length ? '<div class="v-mine"><p><b>Your shifts: ' + mine.length + ", " + esc(P.fmtHours(mine.reduce(function (a, s) { return a + P.shiftMinutes(s); }, 0))) + "</b></p><pre>" + esc(P.textSchedule(mine)) + "</pre>" +
        '<button type="button" class="btn" data-act="ics">' + ICON.cal + "Add to my calendar</button></div>" : '<p class="muted">You aren\'t on the schedule this week.</p>') : "") + "</div>" +
      days +
      '<p class="muted small v-foot no-print">This is a copy of the schedule from the day it was shared, kept in the link itself. Made with <a href="' + FM.link("") + '">Fair Measure</a>.</p></div>';
    $("#me").addEventListener("change", function () {
      var all = S.raw.read("shiftsMe", {}); all[w.start.slice(0, 4) + (w.business || "")] = this.value;
      try { S.raw.write("shiftsMe", all); } catch (e) { /* private mode: just this visit */ }
      renderShared(code);
    });
    app.onclick = function (e) {
      var b = e.target.closest("[data-ask],[data-take],[data-act]"); if (!b) return;
      if (b.getAttribute("data-act") === "ics") {
        var p = w.staff.find(function (x) { return x.id === me; });
        download(slug(p.name) + "-shifts-" + w.start + ".ics", "text/calendar", P.ics(mine, { name: P.firstName(p.name) + "'s shifts", title: function (s) { return "Shift" + (w.business ? " at " + w.business : "") + (s.label ? " (" + s.label + ")" : ""); } }));
        FM.toast("Calendar file downloaded");
      }
      if (b.hasAttribute("data-ask")) askDialog(w, me, b.getAttribute("data-ask"));
      if (b.hasAttribute("data-take")) {
        var open = w.shifts.find(function (s) { return s.id === b.getAttribute("data-take"); });
        sendRequest(w, { kind: "cover", by: "", a: open.id, to: me }, "I can take the open shift " + dayLong(open.date) + ", " + P.span(open) + ".");
      }
    };
  }

  function askDialog(w, me, sid) {
    var s = w.shifts.find(function (x) { return x.id === sid; });
    var others = w.staff.filter(function (p) { return p.id !== me; });
    var theirs = P.sortShifts(w.shifts.filter(function (x) { return x.staffId && x.staffId !== me; }));
    var name = function (id) { var p = w.staff.find(function (x) { return x.id === id; }); return p ? p.name : ""; };
    var dlg = openDialog('<form method="dialog" class="dlg-body ask-form"><h3>' + esc(dayLong(s.date)) + ", " + esc(P.span(s)) + "</h3>" +
      '<fieldset class="ask-kind"><legend class="label">What would help?</legend>' +
      '<label class="radio"><input type="radio" name="kind" value="swap" checked> Trade shifts with someone</label>' +
      '<label class="radio"><input type="radio" name="kind" value="cover"> Someone has agreed to cover it</label>' +
      '<label class="radio"><input type="radio" name="kind" value="drop"> I need someone to cover it</label></fieldset>' +
      '<div data-for="swap">' + field("Their shift", '<select name="b">' + (theirs.length ? theirs.map(function (x) { return '<option value="' + esc(x.id) + '">' + esc(name(x.staffId) + ", " + dayName(x.date) + " " + P.span(x)) + "</option>"; }).join("") : '<option value="">No other shifts this week</option>') + "</select>") + "</div>" +
      '<div data-for="cover" hidden>' + field("Who is covering", '<select name="to">' + others.map(function (p) { return '<option value="' + esc(p.id) + '">' + esc(p.name) + "</option>"; }).join("") + "</select>") + "</div>" +
      field("Message <i>(optional)</i>", '<input name="msg" maxlength="200" placeholder="e.g. Family wedding that weekend" autocomplete="off">') +
      '<p class="muted small">This writes a message for you to send to ' + esc(w.business || "your manager") + ". Nothing changes until they approve it.</p>" +
      '<div class="dlg-actions"><button class="btn ghost" value="cancel">Cancel</button><button class="btn" value="ok">Write the message</button></div></form>');
    var form = $("form", dlg);
    form.addEventListener("change", function () { $$("[data-for]", dlg).forEach(function (d) { d.hidden = d.getAttribute("data-for") !== form.kind.value; }); });
    dlg.addEventListener("close", function () {
      if (dlg.returnValue !== "ok") return;
      var k = form.kind.value, req = { kind: k, by: me, a: s.id, b: k === "swap" ? form.b.value : "", to: k === "cover" ? form.to.value : "", message: form.msg.value.trim() };
      if (k === "swap" && !req.b) { FM.toast("There's no other shift to trade with"); return; }
      var what = dayLong(s.date) + ", " + P.span(s);
      var line = k === "swap" ? "Could I trade my " + what + " for " + name(w.shifts.find(function (x) { return x.id === req.b; }).staffId) + "'s " + (function (x) { return dayLong(x.date) + ", " + P.span(x); })(w.shifts.find(function (x) { return x.id === req.b; })) + "?"
        : k === "cover" ? name(req.to) + " has agreed to cover my " + what + "."
        : "I can't make my " + what + ". Could someone cover it?";
      sendRequest(w, req, line + (req.message ? " " + req.message : ""));
    });
  }

  function sendRequest(w, req, line) {
    if (!req.by) req.by = req.to;
    req.at = today();
    var url = FM.link("shifts/") + "#ask/" + P.packRequest(req);
    var who = w.staff.find(function (p) { return p.id === (req.by); });
    var text = line + (who ? " (" + who.name + ")" : "") + "\nApprove it here: " + url;
    var c = w.contact || "", isMail = c.indexOf("@") > 0;
    var dlg = openDialog('<form method="dialog" class="dlg-body"><h3>Send your request</h3>' +
      '<p class="msg-preview">' + esc(line) + "</p>" +
      '<div class="link-row">' + (c ? '<a class="btn" href="' + esc(isMail ? mailHref(c, "Shift request", text) : smsHref(c, text)) + '">' + (isMail ? ICON.mail + "Email it" : ICON.text + "Text it") + "</a>" : "") +
      (navigator.share ? '<button type="button" class="btn ghost" data-act="native">' + ICON.share + "Share</button>" : "") +
      '<button type="button" class="btn ghost" data-act="copy">' + ICON.copy + "Copy message</button></div>" +
      '<label class="sr" for="req-text">Message</label><textarea id="req-text" class="input" rows="4" readonly>' + esc(text) + "</textarea>" +
      '<div class="dlg-actions"><button class="btn ghost" value="done">Close</button></div></form>');
    dlg.addEventListener("click", function (e) {
      var b = e.target.closest("[data-act]"); if (!b) return;
      if (b.getAttribute("data-act") === "copy") copyText(text, $("#req-text", dlg));
      if (b.getAttribute("data-act") === "native") navigator.share({ title: "Shift request", text: text }).catch(function () {});
    });
  }

  // ---------- a request arriving back at the owner's device
  function renderAsk(code) {
    window.scrollTo(0, 0);
    var req = P.unpackRequest(code), people = team(), all = shifts();
    function card(inner) { app.innerHTML = head() + '<div class="wrap narrow"><a class="back no-print" href="#">' + ICON.back + "Back to the schedule</a>" + '<section class="card float ask-card">' + inner + "</section></div>"; }
    if (!req) return card("<h2>This request looks incomplete</h2><p class=\"muted\">Part of the link may have been cut off. Ask them to send it again.</p>");
    if (!people.length) return card("<h2>Open this on the device you schedule from</h2><p class=\"muted\">This is a shift request for a schedule kept on another device. Open the link there to approve it.</p>");
    var plan = P.planRequest(req, people, all);
    if (!plan.ok) return card("<h2>This request can't be applied</h2><p class=\"muted\">" + esc(plan.reason) + " The schedule may have changed since it was shared.</p>");
    var desc = function (s) { return dayLong(s.date) + ", " + P.span(s); };
    var title = req.kind === "swap" ? esc(plan.by.name) + " would like to trade shifts with " + esc(plan.to.name)
      : req.kind === "cover" ? (req.by === req.to && !plan.a.staffId ? esc(plan.to.name) + " can take an open shift" : esc(plan.to.name) + " will cover for " + esc(plan.by.name))
      : esc(plan.by.name) + " needs someone to cover";
    var lines = req.kind === "swap"
      ? "<li><b>" + esc(desc(plan.a)) + "</b> goes to " + esc(plan.to.name) + "</li><li><b>" + esc(desc(plan.b)) + "</b> goes to " + esc(plan.by.name) + "</li>"
      : req.kind === "cover" ? "<li><b>" + esc(desc(plan.a)) + "</b> goes to " + esc(plan.to.name) + "</li>"
      : "<li><b>" + esc(desc(plan.a)) + "</b> becomes an open shift, and you can find cover next</li>";
    // Preview the warnings the change would cause.
    var after = all.map(function (s) { var ch = plan.changes.find(function (c) { return c.id === s.id; }); return ch ? Object.assign({}, s, { staffId: ch.staffId }) : s; });
    var start = P.weekStartOf(plan.a.date, settings().weekStart), w = P.warnings(people, after, start), notes = [];
    plan.changes.forEach(function (c) { (w[c.id] || []).forEach(function (m) { notes.indexOf(m) < 0 && notes.push(m); }); });
    var asker = person(req.by);
    card('<p class="eyebrow">Shift request</p><h2>' + title + "</h2>" +
      (req.message ? '<p class="msg-preview">"' + esc(req.message) + '"</p>' : "") +
      '<ul class="ask-lines">' + lines + "</ul>" +
      (notes.length ? '<div class="notice"><b>Worth knowing:</b> ' + esc(notes.join(". ")) + ".</div>" : "") +
      '<div class="dlg-actions"><button class="btn ghost" data-act="no">Not this time</button><button class="btn" data-act="yes">' + ICON.check + "Approve</button></div>");
    app.onclick = function (e) {
      var b = e.target.closest("[data-act]"); if (!b) return;
      if (b.getAttribute("data-act") === "yes") {
        plan.changes.forEach(function (c) { var s = S.get("shifts", c.id); if (s) put("shifts", Object.assign({}, s, { staffId: c.staffId })); });
        FM.toast("Approved. Share the schedule again so everyone sees it.");
        ui.week = start;
        if (req.kind === "drop") { history.replaceState(null, "", location.pathname + "#w/" + start); renderWeek(); shiftDialog(S.get("shifts", plan.a.id)); var cv = $('.sp-dialog [data-act="cover"]'); if (cv) cv.click(); return; }
        go("#w/" + start);
      } else {
        var reply = "Sorry " + P.firstName(asker ? asker.name : "") + ", I can't make that change this time.";
        $(".ask-card .dlg-actions").innerHTML = (asker && asker.phone ? '<a class="btn ghost" href="' + esc(smsHref(asker.phone, reply)) + '">' + ICON.text + "Let " + esc(P.firstName(asker.name)) + " know</a>" : "") + '<a class="btn" href="#">Back to the schedule</a>';
        FM.toast("Nothing was changed");
      }
    };
  }

  // ---------- team
  function renderTeam() {
    var people = team(), all = shifts(), start = ui.week || P.weekStartOf(today(), settings().weekStart);
    var totals = P.weekTotals(people, all, start);
    app.innerHTML = head("", "Your team, their usual days off and time away.") + '<div class="wrap narrow">' +
      '<a class="back" href="#">' + ICON.back + "Back to the schedule</a>" +
      '<form class="card add-person" id="add"><h2 class="sec">Add someone</h2><div class="grid-2">' + field("Name", '<input name="name" autocomplete="off" required>') +
      field("Role <i>(optional)</i>", '<input name="role" autocomplete="off" placeholder="e.g. Barista, Driver">') + '</div><p class="err" role="alert" hidden></p><div><button class="btn" type="submit">' + ICON.plus + "Add to the team</button></div></form>" +
      (people.length ? '<ul class="team-list">' + people.map(function (p) {
        var t = totals.by[p.id], away = (p.timeOff || []).filter(function (x) { return (x.to || x.from) >= today(); });
        return '<li><a class="person" href="#p/' + esc(p.id) + '">' + avatar(p) + '<span class="person-main"><b>' + esc(p.name) + "</b><span class=\"muted\">" +
          esc([p.role, p.phone].filter(Boolean).join(" · ") || "Add a role or phone number") + "</span>" +
          '<span class="person-meta"><span>' + (t.minutes ? esc(P.fmtHours(t.minutes)) + " this week" : "Not scheduled this week") + "</span>" +
          ((p.off || []).length ? "<span>Off " + esc(p.off.slice().sort().map(function (d) { return P.DAYS[d].slice(0, 3); }).join(", ")) + "</span>" : "") +
          (away.length ? '<span class="pill gold">Time off ' + esc(fmtDate(away[0].from)) + "</span>" : "") + "</span></span></a></li>";
      }).join("") + "</ul>" : '<p class="muted none">Nobody on the team yet.</p>') + limitNote() + "</div>";
    $("#add").addEventListener("submit", function (e) {
      e.preventDefault();
      var name = this.name.value.trim(), err = $(".err", this);
      if (!name) { err.textContent = "Add a name first."; err.hidden = false; return; }
      if (!L.canAdd("staff", S.count("staff")).allowed) { limitDialog(); return; }
      put("staff", { name: name, role: this.role.value.trim(), order: S.count("staff") });
      FM.toast(P.firstName(name) + " added");
      renderTeam();
      $("#add").name.focus();
    });
  }

  function renderPerson(id) {
    var p = person(id);
    if (!p) { FM.toast("That person isn't on this device"); go("#team"); return; }
    var wage = p.wage ? M.plain(p.wage) : "";
    var timeOff = (p.timeOff || []).slice().sort(function (a, b) { return b.from.localeCompare(a.from); });
    app.innerHTML = head() + '<div class="wrap narrow">' +
      '<a class="back" href="#team">' + ICON.back + "Team</a>" +
      '<div class="p-title">' + avatar(p, "lg") + "<div><h2>" + esc(p.name) + "</h2>" + (p.role ? '<p class="muted">' + esc(p.role) + "</p>" : "") + "</div></div>" +
      '<form class="card p-form" id="pf"><div class="grid-2">' + field("Name", '<input name="name" value="' + esc(p.name) + '" required autocomplete="off">') +
      field("Role <i>(optional)</i>", '<input name="role" value="' + esc(p.role) + '" autocomplete="off">') +
      field("Mobile <i>(to text them shifts)</i>", '<input type="tel" name="phone" value="' + esc(p.phone) + '" autocomplete="off">') +
      field("Email <i>(optional)</i>", '<input type="email" name="email" value="' + esc(p.email) + '" autocomplete="off">') +
      field("Hourly pay <i>(optional, private)</i>", '<input name="wage" inputmode="decimal" value="' + esc(wage) + '" placeholder="0.00" autocomplete="off">') +
      field("Most hours a week <i>(optional)</i>", '<input type="number" name="maxHours" min="0" max="168" value="' + esc(p.maxHours || "") + '">') + "</div>" +
      '<fieldset><legend class="label">Usually off on</legend><div class="chips">' + [0, 1, 2, 3, 4, 5, 6].map(function (d) {
        var dd = (settings().weekStart + d) % 7;
        return '<label class="chip small tog"><input type="checkbox" name="off" value="' + dd + '"' + ((p.off || []).indexOf(dd) >= 0 ? " checked" : "") + "><span>" + P.DAYS[dd].slice(0, 3) + "</span></label>";
      }).join("") + "</div></fieldset>" +
      field("Notes <i>(only on this device)</i>", '<textarea name="notes" rows="2">' + esc(p.notes) + "</textarea>") +
      '<div class="form-end"><span class="muted small saved" aria-live="polite"></span><button class="btn" type="submit">Save</button></div></form>' +
      '<section class="card"><h2 class="sec">' + ICON.cal + "Time off</h2>" +
      (timeOff.length ? '<ul class="off-list">' + timeOff.map(function (t) {
        return '<li><span><b>' + esc(fmtDate(t.from, { weekday: "short", month: "short", day: "numeric" })) + (t.to && t.to !== t.from ? " – " + esc(fmtDate(t.to, { weekday: "short", month: "short", day: "numeric" })) : "") + "</b>" + (t.note ? '<span class="muted"> · ' + esc(t.note) + "</span>" : "") + "</span>" +
          '<button type="button" class="icon-btn" data-off-del="' + esc(t.id) + '" aria-label="Remove this time off">' + ICON.trash + "</button></li>";
      }).join("") + "</ul>" : '<p class="muted">None planned.</p>') +
      '<form id="to" class="to-form"><div class="grid-3">' + field("From", '<input type="date" name="from" required>') + field("To", '<input type="date" name="to">') +
      field("Reason <i>(optional)</i>", '<input name="note" maxlength="60" autocomplete="off">') + '</div><button class="btn ghost" type="submit">' + ICON.plus + "Add time off</button></form></section>" +
      '<p class="danger-zone"><button type="button" class="link-btn danger" data-act="remove">' + ICON.trash + "Remove " + esc(P.firstName(p.name)) + " from the team</button></p></div>";

    $("#pf").addEventListener("submit", function (e) {
      e.preventDefault();
      var f = this;
      if (!f.name.value.trim()) { f.name.focus(); return; }
      var out = Object.assign({}, person(id), {
        name: f.name.value.trim(), role: f.role.value.trim(), phone: f.phone.value.trim(), email: f.email.value.trim(),
        wage: f.wage.value.trim() ? Math.max(0, M.toCents(f.wage.value)) : 0, maxHours: Math.max(0, parseFloat(f.maxHours.value) || 0),
        off: $$('input[name="off"]:checked', f).map(function (i) { return +i.value; }).sort(), notes: f.notes.value.trim()
      });
      put("staff", out);
      FM.toast("Saved");
      renderPerson(id);
    });
    $("#to").addEventListener("submit", function (e) {
      e.preventDefault();
      var from = this.from.value, to = this.to.value || from;
      if (!P.validDate(from)) { this.from.focus(); return; }
      if (to < from) { var x = from; from = to; to = x; }
      var cur = person(id);
      cur.timeOff = (cur.timeOff || []).concat([{ id: S.uid(), from: from, to: to, note: this.note.value.trim() }]);
      put("staff", cur);
      var clash = shifts().filter(function (s) { return s.staffId === id && s.date >= from && s.date <= to; });
      FM.toast(clash.length ? "Added. " + clash.length + (clash.length === 1 ? " shift needs" : " shifts need") + " cover." : "Time off added");
      renderPerson(id);
    });
    app.onclick = function (e) {
      var b = e.target.closest("[data-off-del],[data-act]"); if (!b) return;
      if (b.hasAttribute("data-off-del")) {
        var cur = person(id), oid = b.getAttribute("data-off-del");
        cur.timeOff = (cur.timeOff || []).filter(function (t) { return t.id !== oid; });
        put("staff", cur); renderPerson(id);
      }
      if (b.getAttribute("data-act") === "remove") {
        var future = shifts().filter(function (s) { return s.staffId === id && s.date >= today(); });
        FM.confirm({ title: "Remove " + p.name + " from the team?", body: (future.length ? "Their " + future.length + (future.length === 1 ? " upcoming shift becomes an open shift" : " upcoming shifts become open shifts") + ". " : "") + "Past shifts stay in your records.", ok: "Remove", danger: true })
          .then(function (y) {
            if (!y) return;
            future.forEach(function (s) { put("shifts", Object.assign({}, s, { staffId: "" })); });
            S.remove("staff", id);
            FM.toast(P.firstName(p.name) + " was removed");
            go("#team");
          });
      }
    };
  }

  function emptyArt() {
    return '<svg class="art" viewBox="0 0 160 120" aria-hidden="true">' +
      '<path d="M22 100c10-6 26-8 58-8s48 2 58 8" fill="none" stroke="#e7ddcd" stroke-width="3" stroke-linecap="round"/>' +
      '<rect x="30" y="22" width="100" height="70" rx="9" fill="#fffdf9" stroke="#3d5876" stroke-width="2.2"/>' +
      '<path d="M30 38h100" stroke="#3d5876" stroke-width="2"/><path d="M50 16v12M110 16v12" stroke="#3d5876" stroke-width="2.4" stroke-linecap="round"/>' +
      '<rect x="40" y="46" width="26" height="12" rx="6" fill="#e5ebf2"/><rect x="72" y="46" width="22" height="12" rx="6" fill="#f5ead0"/>' +
      '<rect x="56" y="64" width="30" height="12" rx="6" fill="#e4ecdf"/><rect x="94" y="64" width="24" height="12" rx="6" fill="#e5ebf2"/>' +
      '<path d="M126 14c6 4 9 10 8 17" fill="none" stroke="#9c7630" stroke-width="2" stroke-linecap="round"/>' +
      '<path d="M122 16c5-1 9 1 12 6" fill="#f5ead0" stroke="#9c7630" stroke-width="1.8"/></svg>';
  }

  // ---------- start
  document.addEventListener("DOMContentLoaded", function () {
    app = document.getElementById("app");
    window.addEventListener("hashchange", route);
    var mq = function () { if (!/^#(view|ask|team|p)\b/.test(location.hash) && !document.querySelector("dialog[open]")) route(); };
    if (phone.addEventListener) phone.addEventListener("change", mq); else phone.addListener(mq);
    S.onChange(function (key, external) {
      if (!external || (key !== "staff" && key !== "shifts" && key !== "profile")) return;
      if (/^#(view|ask)\//.test(location.hash)) return;
      var a = document.activeElement;
      if (a && app.contains(a) && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) return;
      if (document.querySelector("dialog[open]")) return;
      route();
    });
    route();
  });
})();
