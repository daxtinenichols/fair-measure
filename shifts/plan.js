/* Shift Planner logic. Pure functions over plain records, no page access.
   Dates are "YYYY-MM-DD" strings and times "HH:MM" (24-hour); an end time at or before the
   start means the shift runs past midnight. Loaded by the page (window.FMShifts) and by the
   tests (module.exports). */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.FMShifts = factory();
})(this, function () {
  "use strict";

  var DAY = 86400000;

  // ---------- dates (UTC arithmetic so daylight saving never shifts a day)
  function parse(d) { var p = String(d).split("-"); return Date.UTC(+p[0], +p[1] - 1, +p[2]); }
  function iso(ms) { return new Date(ms).toISOString().slice(0, 10); }
  function addDays(d, n) { return iso(parse(d) + n * DAY); }
  function weekday(d) { return new Date(parse(d)).getUTCDay(); }
  function daysBetween(a, b) { return Math.round((parse(b) - parse(a)) / DAY); }
  function weekStartOf(d, startDay) { var back = (weekday(d) - (startDay || 0) + 7) % 7; return addDays(d, -back); }
  function weekDates(start) { var out = []; for (var i = 0; i < 7; i++) out.push(addDays(start, i)); return out; }
  function validDate(d) { return /^\d{4}-\d{2}-\d{2}$/.test(d || "") && iso(parse(d)) === d; }

  // ---------- times
  function minutes(t) {
    var m = /^(\d{1,2}):(\d{2})$/.exec(String(t || "").trim());
    if (!m) return null;
    var h = +m[1], mi = +m[2];
    if (h > 24 || mi > 59 || (h === 24 && mi)) return null;
    return h * 60 + mi;
  }
  function hhmm(min) { min = ((min % 1440) + 1440) % 1440; return String(Math.floor(min / 60)).padStart(2, "0") + ":" + String(min % 60).padStart(2, "0"); }
  // Reads what people type ("7", "7a", "3:30pm", "15", "1530") into "HH:MM", or "" if unclear.
  function readTime(s) {
    s = String(s || "").trim().toLowerCase().replace(/\s+/g, "").replace(/\./g, "");
    if (s === "noon") return "12:00";
    if (s === "midnight") return "00:00";
    var m = /^(\d{1,2})(?::?(\d{2}))?(a|am|p|pm)?$/.exec(s);
    if (!m) return "";
    var h = +m[1], mi = m[2] ? +m[2] : 0, ap = m[3] ? m[3].charAt(0) : "";
    if (mi > 59) return "";
    if (ap) { if (h < 1 || h > 12) return ""; if (h === 12) h = 0; if (ap === "p") h += 12; }
    else if (h > 24 || (h === 24 && mi)) return "";
    return hhmm(h * 60 + mi);
  }
  // "7a", "3:30p", "12p": short labels that fit in a schedule cell.
  function shortTime(t) {
    var m = minutes(t); if (m == null) return "";
    var h = Math.floor(m / 60) % 24, mi = m % 60, ap = h < 12 ? "a" : "p";
    h = h % 12 || 12;
    return h + (mi ? ":" + String(mi).padStart(2, "0") : "") + ap;
  }
  function span(s) { return shortTime(s.start) + "–" + shortTime(s.end); }

  // Paid minutes of a shift: end minus start (rolling past midnight) minus any unpaid break.
  function shiftMinutes(s) {
    var a = minutes(s.start), b = minutes(s.end);
    if (a == null || b == null) return 0;
    var len = b > a ? b - a : b + 1440 - a;
    return Math.max(0, len - Math.max(0, parseInt(s.breakMin, 10) || 0));
  }
  // Absolute start and end in minutes since the epoch day, for overlap and rest checks.
  function bounds(s) {
    var a = minutes(s.start), b = minutes(s.end);
    if (a == null || b == null || !validDate(s.date)) return null;
    var base = parse(s.date) / 60000;
    return { from: base + a, to: base + (b > a ? b : b + 1440) };
  }
  function hours(min) { return Math.round(min / 6) / 10; }
  function fmtHours(min) { var h = hours(min); return (h % 1 ? h.toFixed(1) : String(h)) + (h === 1 ? " hr" : " hrs"); }

  function inWeek(shifts, start) {
    var end = addDays(start, 7);
    return shifts.filter(function (s) { return s.date >= start && s.date < end; });
  }
  function sortShifts(list) {
    return list.slice().sort(function (a, b) { return a.date.localeCompare(b.date) || (minutes(a.start) || 0) - (minutes(b.start) || 0); });
  }

  function onTimeOff(person, date) {
    return (person.timeOff || []).some(function (t) { return t.from && date >= t.from && date <= (t.to || t.from); });
  }
  // `off` is a list of weekdays (0 = Sunday) the person never works.
  function dayOff(person, date) { return (person.off || []).indexOf(weekday(date)) >= 0; }

  var OVERTIME_MIN = 40 * 60;
  var REST_MIN = 10 * 60;

  // Per-person totals for one week: minutes, overtime minutes and wages in cents.
  // Overtime is time over 40 hours in the week, paid at time and a half (US federal rule).
  function weekTotals(staff, shifts, start) {
    var week = inWeek(shifts, start), by = {}, total = { minutes: 0, cost: 0, overtime: 0, open: 0, openMinutes: 0, priced: true };
    staff.forEach(function (p) { by[p.id] = { minutes: 0, overtime: 0, cost: 0, shifts: 0 }; });
    week.forEach(function (s) {
      var m = shiftMinutes(s);
      if (!s.staffId || !by[s.staffId]) { total.open++; total.openMinutes += m; return; }
      by[s.staffId].minutes += m; by[s.staffId].shifts++;
    });
    staff.forEach(function (p) {
      var t = by[p.id], wage = Math.max(0, parseInt(p.wage, 10) || 0);
      t.overtime = Math.max(0, t.minutes - OVERTIME_MIN);
      t.cost = Math.round((t.minutes - t.overtime) * wage / 60 + t.overtime * wage * 1.5 / 60);
      total.minutes += t.minutes; total.overtime += t.overtime; total.cost += t.cost;
      if (t.minutes && !wage) total.priced = false;
    });
    total.by = by;
    return total;
  }

  // Every honest warning for one week, keyed by shift id: double-booked, time off, day off,
  // short rest between shifts, over the person's own weekly limit, and overtime.
  function warnings(staff, shifts, start) {
    var out = {}, people = {};
    staff.forEach(function (p) { people[p.id] = p; });
    function add(id, msg) { (out[id] = out[id] || []).indexOf(msg) < 0 && out[id].push(msg); }
    var week = inWeek(shifts, start);
    var around = shifts.filter(function (s) { return s.date >= addDays(start, -1) && s.date <= addDays(start, 7); });
    week.forEach(function (s) {
      var p = people[s.staffId];
      if (!p) return;
      var name = firstName(p.name);
      if (onTimeOff(p, s.date)) add(s.id, name + " has time off that day");
      else if (dayOff(p, s.date)) add(s.id, name + " doesn't usually work " + DAYS[weekday(s.date)] + "s");
      var b = bounds(s); if (!b) return;
      around.forEach(function (o) {
        if (o.id === s.id || o.staffId !== s.staffId) return;
        var c = bounds(o); if (!c) return;
        if (b.from < c.to && c.from < b.to) add(s.id, name + " is already working " + span(o) + " then");
        else if (c.to <= b.from && b.from - c.to < REST_MIN) add(s.id, "Only " + fmtHours(b.from - c.to) + " rest since the shift before");
        else if (b.to <= c.from && c.from - b.to < REST_MIN) add(s.id, "Only " + fmtHours(c.from - b.to) + " rest before the next shift");
      });
    });
    var totals = weekTotals(staff, shifts, start);
    staff.forEach(function (p) {
      var t = totals.by[p.id], max = parseFloat(p.maxHours) || 0;
      if (!t.minutes) return;
      var mine = sortShifts(week.filter(function (s) { return s.staffId === p.id; }));
      var last = mine[mine.length - 1];
      if (max && t.minutes > max * 60) add(last.id, firstName(p.name) + " is over their " + max + " hour week");
      if (t.overtime) add(last.id, firstName(p.name) + " has " + fmtHours(t.overtime) + " of overtime");
    });
    return out;
  }

  // Who could cover a shift: not booked at the same time, not on time off, sorted with
  // the people who don't usually work that day last and then by fewest hours this week.
  function coverOptions(staff, shifts, shift, start) {
    var b = bounds(shift), totals = weekTotals(staff, shifts, start || shift.date);
    return staff.filter(function (p) { return p.id !== shift.staffId && !p.archived; }).map(function (p) {
      var why = [];
      if (onTimeOff(p, shift.date)) why.push("time off");
      var clash = b && shifts.some(function (o) {
        if (o.id === shift.id || o.staffId !== p.id) return false;
        var c = bounds(o); return c && b.from < c.to && c.from < b.to;
      });
      if (clash) why.push("already working");
      var max = parseFloat(p.maxHours) || 0, after = totals.by[p.id].minutes + shiftMinutes(shift);
      var over = (max && after > max * 60) || after > OVERTIME_MIN;
      return { person: p, minutes: totals.by[p.id].minutes, free: !why.length, note: why.join(", "), usualDayOff: dayOff(p, shift.date), over: !!over };
    }).sort(function (a, b) {
      return (b.free - a.free) || (a.usualDayOff - b.usualDayOff) || (a.over - b.over) || (a.minutes - b.minutes) || a.person.name.localeCompare(b.person.name);
    });
  }

  // Copies a week's shifts onto another week, skipping any that would land on top of an
  // identical shift already there. Returns new records without ids.
  function copyWeek(shifts, fromStart, toStart) {
    var offset = daysBetween(fromStart, toStart), have = {};
    inWeek(shifts, toStart).forEach(function (s) { have[[s.date, s.start, s.end, s.staffId || ""].join("|")] = 1; });
    return inWeek(shifts, fromStart).map(function (s) {
      return { date: addDays(s.date, offset), start: s.start, end: s.end, breakMin: s.breakMin || 0, staffId: s.staffId || "", label: s.label || "", note: s.note || "" };
    }).filter(function (s) { return !have[[s.date, s.start, s.end, s.staffId].join("|")]; });
  }

  function firstName(n) { return String(n || "").trim().split(/\s+/)[0] || "Someone"; }
  function initials(n) {
    var w = String(n || "").trim().split(/\s+/).filter(Boolean);
    return ((w[0] || "?").charAt(0) + (w.length > 1 ? w[w.length - 1].charAt(0) : "")).toUpperCase();
  }
  var DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

  // ---------- sharing: a week packed into the link itself, so it never touches a server.
  // Only what a schedule needs travels: names, roles, shift times, labels and notes. No phone
  // numbers, wages or time-off reasons.
  function b64encode(str) {
    var bytes = typeof TextEncoder !== "undefined" ? new TextEncoder().encode(str) : Buffer.from(str, "utf8");
    var bin = ""; for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    var b = typeof btoa !== "undefined" ? btoa(bin) : Buffer.from(bin, "binary").toString("base64");
    return b.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  function b64decode(s) {
    s = String(s).replace(/-/g, "+").replace(/_/g, "/");
    while (s.length % 4) s += "=";
    var bin = typeof atob !== "undefined" ? atob(s) : Buffer.from(s, "base64").toString("binary");
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return typeof TextDecoder !== "undefined" ? new TextDecoder().decode(bytes) : Buffer.from(bytes).toString("utf8");
  }

  function packWeek(info, staff, shifts, start) {
    var week = sortShifts(inWeek(shifts, start));
    var used = {}; week.forEach(function (s) { if (s.staffId) used[s.staffId] = 1; });
    var people = staff.filter(function (p) { return used[p.id] || !p.archived; });
    var idx = {}; people.forEach(function (p, i) { idx[p.id] = i; });
    var data = {
      v: 1, b: String(info.business || "").slice(0, 80), c: String(info.contact || "").slice(0, 40), w: start, at: info.at || "",
      p: people.map(function (p) { return [p.id, String(p.name || "").slice(0, 60), String(p.role || "").slice(0, 40)]; }),
      s: week.map(function (s) {
        var row = [s.id, daysBetween(start, s.date), s.start, s.end, s.staffId in idx ? idx[s.staffId] : -1];
        if (s.breakMin || s.label || s.note) row.push(parseInt(s.breakMin, 10) || 0, String(s.label || "").slice(0, 40), String(s.note || "").slice(0, 120));
        return row;
      })
    };
    return b64encode(JSON.stringify(data));
  }
  function unpackWeek(code) {
    var d;
    try { d = JSON.parse(b64decode(code)); } catch (e) { return null; }
    if (!d || d.v !== 1 || !validDate(d.w) || !Array.isArray(d.p) || !Array.isArray(d.s)) return null;
    var staff = d.p.filter(Array.isArray).map(function (r) { return { id: String(r[0]), name: String(r[1] || ""), role: String(r[2] || "") }; });
    var shifts = d.s.filter(function (r) { return Array.isArray(r) && minutes(r[2]) != null && minutes(r[3]) != null && r[1] >= 0 && r[1] < 7; }).map(function (r) {
      var p = staff[r[4]];
      return { id: String(r[0]), date: addDays(d.w, r[1] | 0), start: r[2], end: r[3], staffId: p ? p.id : "", breakMin: r[5] | 0, label: String(r[6] || ""), note: String(r[7] || "") };
    });
    return { business: String(d.b || ""), contact: String(d.c || ""), start: d.w, at: String(d.at || ""), staff: staff, shifts: shifts };
  }

  // A swap or cover request travels back to the owner the same way.
  // kind: "swap" (trade shift a for shift b), "cover" (give shift a to person `to`), "drop" (needs cover).
  function packRequest(r) {
    return b64encode(JSON.stringify({ v: 1, k: r.kind, by: r.by, a: r.a, b: r.b || "", to: r.to || "", m: String(r.message || "").slice(0, 300), at: r.at || "" }));
  }
  function unpackRequest(code) {
    var d;
    try { d = JSON.parse(b64decode(code)); } catch (e) { return null; }
    if (!d || d.v !== 1 || ["swap", "cover", "drop"].indexOf(d.k) < 0 || !d.a || !d.by) return null;
    if (d.k === "swap" && !d.b) return null;
    if (d.k === "cover" && !d.to) return null;
    return { kind: d.k, by: String(d.by), a: String(d.a), b: String(d.b || ""), to: String(d.to || ""), message: String(d.m || ""), at: String(d.at || "") };
  }

  // Checks a request against the schedule as it is now and returns the changes to make.
  function planRequest(req, staff, shifts) {
    var find = function (id) { return shifts.find(function (s) { return s.id === id; }) || null; };
    var person = function (id) { return staff.find(function (p) { return p.id === id; }) || null; };
    var a = find(req.a), by = person(req.by);
    if (!by) return { ok: false, reason: "The person who sent this isn't on your team any more." };
    if (!a) return { ok: false, reason: "That shift isn't on the schedule any more." };
    var taking = req.kind === "cover" && req.to === req.by && !a.staffId;
    if (a.staffId !== req.by && !taking) return { ok: false, reason: !a.staffId ? "That shift is open now." : "That shift has already been moved to someone else." };
    if (req.kind === "drop") return { ok: true, changes: [{ id: a.id, staffId: "" }], by: by, a: a };
    if (req.kind === "cover") {
      var to = person(req.to);
      if (!to) return { ok: false, reason: "The person taking the shift isn't on your team any more." };
      return { ok: true, changes: [{ id: a.id, staffId: to.id }], by: by, a: a, to: to };
    }
    var b = find(req.b);
    if (!b) return { ok: false, reason: "The other shift isn't on the schedule any more." };
    var other = person(b.staffId);
    if (!other) return { ok: false, reason: "The other shift isn't assigned to anyone right now." };
    if (other.id === by.id) return { ok: false, reason: "Both shifts already belong to the same person." };
    return { ok: true, changes: [{ id: a.id, staffId: other.id }, { id: b.id, staffId: by.id }], by: by, a: a, b: b, to: other };
  }

  // ---------- calendar file (iCalendar, floating local times so it shows as written)
  function icsEscape(s) { return String(s || "").replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/([,;])/g, "\\$1"); }
  function icsStamp(date, time) { return date.replace(/-/g, "") + "T" + time.replace(":", "") + "00"; }
  function fold(line) {
    var out = [], s = line;
    while (s.length > 74) { out.push(s.slice(0, 74)); s = " " + s.slice(74); }
    out.push(s);
    return out.join("\r\n");
  }
  function ics(shifts, opts) {
    opts = opts || {};
    var now = (opts.now || new Date().toISOString()).replace(/[-:]/g, "").replace(/\.\d+/, "").slice(0, 15) + "Z";
    var lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Fair Measure//Shift Planner//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH"];
    if (opts.name) lines.push("X-WR-CALNAME:" + icsEscape(opts.name));
    sortShifts(shifts).forEach(function (s) {
      var b = bounds(s); if (!b) return;
      var endDate = (minutes(s.end) > minutes(s.start)) ? s.date : addDays(s.date, 1);
      lines.push("BEGIN:VEVENT", "UID:" + s.id + "@shifts.fairmeasure", "DTSTAMP:" + now,
        "DTSTART:" + icsStamp(s.date, s.start), "DTEND:" + icsStamp(endDate, s.end === "24:00" ? "00:00" : s.end),
        "SUMMARY:" + icsEscape((opts.title ? opts.title(s) : "Shift") || "Shift"));
      if (s.note) lines.push("DESCRIPTION:" + icsEscape(s.note));
      lines.push("END:VEVENT");
    });
    lines.push("END:VCALENDAR");
    return lines.map(fold).join("\r\n") + "\r\n";
  }

  // Plain text a person can read in a message: one line per shift.
  function textSchedule(shifts, opts) {
    opts = opts || {};
    return sortShifts(shifts).map(function (s) {
      var d = new Date(parse(s.date));
      var day = DAYS[d.getUTCDay()].slice(0, 3) + " " + (d.getUTCMonth() + 1) + "/" + d.getUTCDate();
      return day + "  " + span(s) + (s.label ? "  " + s.label : "") + (opts.who ? "  " + opts.who(s) : "");
    }).join("\n");
  }

  return {
    addDays: addDays, weekday: weekday, daysBetween: daysBetween, weekStartOf: weekStartOf, weekDates: weekDates, validDate: validDate,
    minutes: minutes, hhmm: hhmm, readTime: readTime, shortTime: shortTime, span: span,
    shiftMinutes: shiftMinutes, bounds: bounds, hours: hours, fmtHours: fmtHours,
    inWeek: inWeek, sortShifts: sortShifts, onTimeOff: onTimeOff, dayOff: dayOff,
    weekTotals: weekTotals, warnings: warnings, coverOptions: coverOptions, copyWeek: copyWeek,
    firstName: firstName, initials: initials, DAYS: DAYS,
    packWeek: packWeek, unpackWeek: unpackWeek, packRequest: packRequest, unpackRequest: unpackRequest, planRequest: planRequest,
    ics: ics, textSchedule: textSchedule
  };
});
