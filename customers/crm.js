/* Customer Book logic. Pure functions: history and totals from quotes and invoices,
   follow-up dates, contact import (CSV and vCard), calendar files and CSV export.
   Loaded by the page (window.FMCrm) and by the tests (module.exports). Money is whole cents.
   Totals come from the Quotes & Invoices arithmetic (FMCalc), passed in as `calc`. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.FMCrm = factory();
})(this, function () {
  "use strict";

  function lower(s) { return String(s == null ? "" : s).trim().toLowerCase(); }
  function digits(s) { return String(s == null ? "" : s).replace(/\D/g, ""); }

  // ---------- history from documents

  // Documents that belong to a customer: linked by id, or (for older documents that were
  // never linked) carrying exactly the same name.
  function docsFor(c, docs) {
    var name = lower(c.name);
    return (docs || []).filter(function (d) {
      if (d.customerId) return d.customerId === c.id;
      return !!name && lower(d.customer && d.customer.name) === name;
    });
  }

  function stats(c, docs, calc, today) {
    var mine = docsFor(c, docs);
    var s = { documents: mine.length, invoices: 0, quotes: 0, openQuotes: 0, billed: 0, paid: 0, owed: 0, overdue: 0, last: "", first: "" };
    mine.forEach(function (d) {
      var st = calc.displayStatus(d, today), t = calc.totals(d);
      if (d.type === "quote") {
        s.quotes++;
        if (st === "sent") s.openQuotes++;
      } else {
        s.invoices++;
        if (st !== "draft" && st !== "void") { s.billed += t.total; s.paid += Math.min(t.paid, t.total); }
        if (st === "sent" || st === "overdue") s.owed += Math.max(0, t.balance);
        if (st === "overdue") s.overdue += Math.max(0, t.balance);
      }
      var dates = [d.issueDate].concat((d.payments || []).map(function (p) { return p.date; })).filter(Boolean);
      dates.forEach(function (x) { if (x > s.last) s.last = x; if (!s.first || x < s.first) s.first = x; });
    });
    (c.log || []).forEach(function (n) { if (n.date > s.last) s.last = n.date; });
    return s;
  }

  // One list of everything that happened with a customer, newest first.
  function timeline(c, docs, calc, today) {
    var out = [];
    docsFor(c, docs).forEach(function (d) {
      var t = calc.totals(d);
      out.push({ date: d.issueDate || (d.createdAt || "").slice(0, 10), kind: d.type === "quote" ? "quote" : "invoice",
        docId: d.id, number: d.number, status: calc.displayStatus(d, today), amount: t.total, ts: d.createdAt || "" });
      (d.payments || []).forEach(function (p) {
        out.push({ date: p.date, kind: "payment", docId: d.id, number: d.number, amount: p.amount });
      });
    });
    (c.log || []).forEach(function (n) { out.push({ date: n.date, kind: n.kind || "note", id: n.id, text: n.text, ts: n.at || "" }); });
    (c.followUps || []).forEach(function (f) {
      if (f.done) out.push({ date: f.doneAt || f.due, kind: "done", id: f.id, text: f.what });
    });
    // Same day: most recently made first; a payment sits just above its invoice.
    return out.sort(function (a, b) {
      return (b.date || "").localeCompare(a.date || "") || (b.ts || "").localeCompare(a.ts || "") || (a.kind === "payment" ? -1 : b.kind === "payment" ? 1 : 0);
    });
  }

  // ---------- follow-ups

  function followState(f, today) {
    if (f.done) return "done";
    if (f.due < today) return "overdue";
    if (f.due === today) return "today";
    return "upcoming";
  }
  function openFollowUps(c) {
    return (c.followUps || []).filter(function (f) { return !f.done; })
      .sort(function (a, b) { return (a.due || "").localeCompare(b.due || ""); });
  }
  function nextFollowUp(c) { return openFollowUps(c)[0] || null; }

  // Everything open across the book up to `until`, soonest first, with its customer.
  function agenda(customers, until) {
    var out = [];
    (customers || []).forEach(function (c) {
      openFollowUps(c).forEach(function (f) { if (f.due <= until) out.push({ customer: c, followUp: f }); });
    });
    return out.sort(function (a, b) { return a.followUp.due.localeCompare(b.followUp.due) || lower(a.customer.name).localeCompare(lower(b.customer.name)); });
  }

  // ---------- duplicates and merging

  function sameContact(a, b) {
    if (a.email && lower(a.email) === lower(b.email)) return true;
    var pa = digits(a.phone).slice(-10), pb = digits(b.phone).slice(-10);
    if (pa.length >= 7 && pa === pb) return true;
    return !!lower(a.name) && lower(a.name) === lower(b.name);
  }
  function findDuplicate(rec, list) {
    return (list || []).find(function (x) { return x.id !== rec.id && sameContact(rec, x); }) || null;
  }

  // Folds `from` into `into`: blanks are filled, notes, tags, history and follow-ups combined.
  function merge(into, from) {
    var out = Object.assign({}, into);
    ["name", "company", "email", "phone", "address"].forEach(function (k) { if (!out[k] && from[k]) out[k] = from[k]; });
    out.notes = [into.notes, from.notes].filter(Boolean).join("\n\n");
    var tags = (into.tags || []).slice();
    (from.tags || []).forEach(function (t) { if (tags.map(lower).indexOf(lower(t)) < 0) tags.push(t); });
    out.tags = tags;
    out.log = (into.log || []).concat(from.log || []);
    out.followUps = (into.followUps || []).concat(from.followUps || []);
    return out;
  }

  // ---------- import

  // RFC 4180 CSV: quoted fields, doubled quotes, commas and newlines inside quotes.
  function parseCSV(text) {
    text = String(text || "").replace(/^\uFEFF/, "");
    var rows = [], row = [], field = "", q = false;
    for (var i = 0; i < text.length; i++) {
      var ch = text[i];
      if (q) {
        if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; }
        else field += ch;
      } else if (ch === '"') q = true;
      else if (ch === ",") { row.push(field); field = ""; }
      else if (ch === "\n" || ch === "\r") {
        if (ch === "\r" && text[i + 1] === "\n") i++;
        row.push(field); rows.push(row); row = []; field = "";
      } else field += ch;
    }
    if (field || row.length) { row.push(field); rows.push(row); }
    return rows.filter(function (r) { return r.some(function (v) { return v.trim(); }); });
  }

  // Which contact field a column heading means. Covers Google Contacts, Outlook, iCloud
  // and most hand-made spreadsheets. Order matters: the first rule that matches wins.
  var COLUMN_RULES = [
    [/(e-?mail (display|type)|type$|label$|title|job|department|yomi|phonetic|prefix|suffix|nickname)/, null],
    [/^(full name|name|display name|contact|contact name|customer|customer name|client|client name)$/, "name"],
    [/^(first name|given name|first)$/, "first"],
    [/^(middle name|additional name)$/, "middle"],
    [/^(last name|family name|surname|last)$/, "last"],
    [/(company|organi[sz]ation|business name|employer)/, "company"],
    [/e-?mail/, "email"],
    [/(phone|mobile|cell|tel)/, "phone"],
    [/(formatted|full address|^address$|mailing address|address 1$)/, "address"],
    [/(street|address line|address 1 - street|^address 1)/, "street"],
    [/(city|town|locality)/, "city"],
    [/(state|region|province)/, "region"],
    [/(zip|postal|postcode)/, "postal"],
    [/(country)/, "country"],
    [/^(notes?|comments?)$/, "notes"]
  ];
  function columnField(h) {
    h = lower(h);
    for (var i = 0; i < COLUMN_RULES.length; i++) if (COLUMN_RULES[i][0].test(h)) return COLUMN_RULES[i][1];
    return null;
  }

  function finish(p) {
    var name = p.name || [p.first, p.middle, p.last].filter(Boolean).join(" ");
    var line2 = [[p.city, p.region].filter(Boolean).join(", "), p.postal].filter(Boolean).join(" ");
    var address = p.address || [p.street, line2, p.country].filter(Boolean).join("\n");
    var c = { name: (name || p.company || "").trim(), company: name ? (p.company || "").trim() : "",
      email: (p.email || "").trim(), phone: (p.phone || "").trim(), address: address.trim(), notes: (p.notes || "").trim() };
    return c.name ? c : null;
  }

  function contactsFromCSV(text) {
    var rows = parseCSV(text);
    if (rows.length < 2) return [];
    var map = rows[0].map(columnField);
    return rows.slice(1).map(function (r) {
      var p = {};
      map.forEach(function (f, i) { var v = (r[i] || "").trim(); if (f && v && !p[f]) p[f] = v; });
      return finish(p);
    }).filter(Boolean);
  }

  function vUnescape(s) { return s.replace(/\\n/gi, "\n").replace(/\\([,;\\])/g, "$1"); }
  // vCard 2.1 quoted-printable: =XX bytes, decoded as UTF-8.
  function qpDecode(s) {
    var bytes = [], enc = new TextEncoder();
    for (var i = 0; i < s.length; i++) {
      if (s[i] === "=" && /^[0-9A-F]{2}$/i.test(s.substr(i + 1, 2))) { bytes.push(parseInt(s.substr(i + 1, 2), 16)); i += 2; }
      else enc.encode(s[i]).forEach(function (b) { bytes.push(b); });
    }
    return new TextDecoder("utf-8").decode(new Uint8Array(bytes));
  }
  // Splits on unescaped semicolons (vCard structured values).
  function vParts(v) { return v.split(/(?<!\\);/).map(vUnescape); }

  function contactsFromVCard(text) {
    var lines = String(text || "").replace(/\r\n?/g, "\n").replace(/\n[ \t]/g, "").split("\n");
    var out = [], p = null;
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      if (/^BEGIN:VCARD/i.test(line)) { p = {}; continue; }
      if (/^END:VCARD/i.test(line)) { if (p) { var c = finish(p); if (c) out.push(c); } p = null; continue; }
      if (!p) continue;
      var at = line.indexOf(":");
      if (at < 0) continue;
      var head = line.slice(0, at), value = line.slice(at + 1);
      if (/ENCODING=QUOTED-PRINTABLE/i.test(head)) {
        while (/=$/.test(value) && i + 1 < lines.length) value = value.slice(0, -1) + lines[++i];
        value = qpDecode(value);
      }
      var prop = head.split(";")[0].replace(/^[^.]*\./, "").toUpperCase();
      if (prop === "FN" && !p.name) p.name = vUnescape(value);
      else if (prop === "N") { var n = vParts(value); p.last = p.last || n[0]; p.first = p.first || n[1]; p.middle = p.middle || n[2]; }
      else if (prop === "ORG" && !p.company) p.company = vParts(value).filter(Boolean).join(", ");
      else if (prop === "EMAIL" && !p.email) p.email = vUnescape(value);
      else if (prop === "TEL" && !p.phone) p.phone = vUnescape(value).replace(/^tel:/i, "");
      else if (prop === "ADR" && !p.street && !p.city) {
        var a = vParts(value);
        p.street = [a[0], a[1], a[2]].filter(Boolean).join("\n"); p.city = a[3]; p.region = a[4]; p.postal = a[5]; p.country = a[6];
      } else if (prop === "NOTE" && !p.notes) p.notes = vUnescape(value);
    }
    return out;
  }

  function parseContacts(text, filename) {
    if (/\.vcf$/i.test(filename || "") || /^\s*BEGIN:VCARD/i.test(text)) return contactsFromVCard(text);
    return contactsFromCSV(text);
  }

  // ---------- calendar file for a follow-up (all-day, reminder at 9 a.m.)

  function icsText(s) { return String(s || "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n"); }
  function fold(line) {
    var out = [];
    while (line.length > 74) { out.push(line.slice(0, 74)); line = " " + line.slice(74); }
    out.push(line);
    return out.join("\r\n");
  }
  function ics(c, f, now) {
    var d = f.due.replace(/-/g, "");
    var next = new Date(f.due + "T12:00:00Z"); next.setUTCDate(next.getUTCDate() + 1);
    var stamp = (now || new Date()).toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
    var who = c.name + (c.company ? " (" + c.company + ")" : "");
    var desc = [f.what, c.phone && "Phone: " + c.phone, c.email && "Email: " + c.email].filter(Boolean).join("\n");
    return [
      "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Fair Measure//Customer Book//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
      "BEGIN:VEVENT",
      "UID:" + f.id + "@fair-measure",
      "DTSTAMP:" + stamp,
      "DTSTART;VALUE=DATE:" + d,
      "DTEND;VALUE=DATE:" + next.toISOString().slice(0, 10).replace(/-/g, ""),
      "SUMMARY:" + icsText("Follow up with " + who + (f.what ? ": " + f.what : "")),
      "DESCRIPTION:" + icsText(desc),
      "TRANSP:TRANSPARENT",
      "BEGIN:VALARM", "ACTION:DISPLAY", "TRIGGER;RELATED=START:PT9H", "DESCRIPTION:" + icsText("Follow up with " + who), "END:VALARM",
      "END:VEVENT", "END:VCALENDAR"
    ].map(fold).join("\r\n") + "\r\n";
  }

  // ---------- CSV export

  function csvCell(v) {
    var s = String(v == null ? "" : v);
    // A leading = + - @ makes spreadsheets run the cell as a formula; quote it as text.
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function toCSV(customers, docs, calc, today) {
    var head = ["Name", "Company", "Email", "Phone", "Address", "Tags", "Notes", "Billed", "Paid", "Owed", "Last activity", "Next follow-up", "Follow-up note"];
    var rows = (customers || []).map(function (c) {
      var s = stats(c, docs, calc, today), f = nextFollowUp(c);
      return [c.name, c.company, c.email, c.phone, c.address, (c.tags || []).join("; "), c.notes,
        (s.billed / 100).toFixed(2), (s.paid / 100).toFixed(2), (s.owed / 100).toFixed(2), s.last, f ? f.due : "", f ? f.what : ""];
    });
    return [head].concat(rows).map(function (r) { return r.map(csvCell).join(","); }).join("\r\n") + "\r\n";
  }

  function initials(c) {
    var words = String(c.name || c.company || "?").trim().split(/\s+/).filter(function (w) { return /[\p{L}\p{N}]/u.test(w); });
    var a = words[0] ? Array.from(words[0])[0] : "?";
    var b = words.length > 1 ? Array.from(words[words.length - 1])[0] : "";
    return (a + b).toUpperCase();
  }

  return {
    docsFor: docsFor, stats: stats, timeline: timeline,
    followState: followState, openFollowUps: openFollowUps, nextFollowUp: nextFollowUp, agenda: agenda,
    sameContact: sameContact, findDuplicate: findDuplicate, merge: merge,
    parseCSV: parseCSV, columnField: columnField, contactsFromCSV: contactsFromCSV, contactsFromVCard: contactsFromVCard, parseContacts: parseContacts,
    ics: ics, toCSV: toCSV, initials: initials
  };
});
