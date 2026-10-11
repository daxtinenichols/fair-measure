// Customer Book logic tests. Run: node tests/customers.test.js
const assert = require("assert");
const R = require("../customers/crm.js");
const C = require("../invoices/calc.js");

let n = 0;
function test(name, fn) { fn(); n++; console.log("  ok " + name); }

const kelly = { id: "c1", name: "Margaret Kelly", email: "margaret@example.com", phone: "(518) 555-0140",
  log: [{ id: "n1", date: "2026-09-02", kind: "call", text: "Wants a bookshelf" }],
  followUps: [{ id: "f1", due: "2026-10-01", what: "Ask about the porch" }, { id: "f2", due: "2026-12-01", what: "Christmas card" }, { id: "f3", due: "2026-08-01", what: "Old", done: true, doneAt: "2026-08-02" }] };
const docs = [
  { id: "d1", type: "invoice", status: "paid", customerId: "c1", number: "INV-0001", issueDate: "2026-09-10", dueDate: "2026-09-24",
    lines: [{ qty: 1, price: 100000, taxable: false }], paidAmount: 100000, payments: [{ date: "2026-09-20", amount: 100000 }] },
  { id: "d2", type: "invoice", status: "sent", customerId: "c1", number: "INV-0002", issueDate: "2026-09-15", dueDate: "2026-09-29",
    lines: [{ qty: 2, price: 25000, taxable: false }], paidAmount: 10000, payments: [{ date: "2026-09-16", amount: 10000 }] },
  { id: "d3", type: "quote", status: "sent", customerId: "c1", number: "Q-0001", issueDate: "2026-10-05", validUntil: "2026-11-05", lines: [{ qty: 1, price: 5000 }] },
  { id: "d4", type: "invoice", status: "draft", customerId: null, customer: { name: "margaret kelly " }, number: "INV-0003", issueDate: "2026-10-06", lines: [{ qty: 1, price: 999 }] },
  { id: "d5", type: "invoice", status: "sent", customerId: "c9", customer: { name: "Margaret Kelly" }, number: "INV-0004", issueDate: "2026-10-06", lines: [{ qty: 1, price: 999 }] }
];
const today = "2026-10-10";

test("documents linked by id, or by name when never linked", () => {
  assert.deepStrictEqual(R.docsFor(kelly, docs).map((d) => d.id), ["d1", "d2", "d3", "d4"]);
});

test("stats: billed, paid, owed, overdue, last activity", () => {
  const s = R.stats(kelly, docs, C, today);
  assert.strictEqual(s.billed, 150000);
  assert.strictEqual(s.paid, 110000);
  assert.strictEqual(s.owed, 40000);
  assert.strictEqual(s.overdue, 40000);
  assert.strictEqual(s.openQuotes, 1);
  assert.strictEqual(s.last, "2026-10-06");
  assert.strictEqual(s.first, "2026-09-10");
});

test("timeline is newest first and includes payments, notes and done follow-ups", () => {
  const t = R.timeline(kelly, docs, C, today);
  assert.strictEqual(t[0].date, "2026-10-06");
  assert.ok(t.some((e) => e.kind === "payment" && e.amount === 100000));
  assert.ok(t.some((e) => e.kind === "call" && e.text === "Wants a bookshelf"));
  assert.ok(t.some((e) => e.kind === "done" && e.text === "Old"));
  assert.strictEqual(t[t.length - 1].kind, "done");
});

test("follow-up states and agenda", () => {
  assert.strictEqual(R.followState({ due: "2026-10-09" }, today), "overdue");
  assert.strictEqual(R.followState({ due: today }, today), "today");
  assert.strictEqual(R.followState({ due: "2026-10-11" }, today), "upcoming");
  assert.strictEqual(R.nextFollowUp(kelly).id, "f1");
  const a = R.agenda([kelly, { id: "c2", name: "Abe", followUps: [{ id: "g", due: "2026-10-12", what: "x" }] }], "2026-10-17");
  assert.deepStrictEqual(a.map((x) => x.followUp.id), ["f1", "g"]);
});

test("duplicates by email, phone or name", () => {
  const list = [kelly];
  assert.ok(R.findDuplicate({ name: "M. Kelly", email: "MARGARET@example.com" }, list));
  assert.ok(R.findDuplicate({ name: "Peg", phone: "+1 518-555-0140" }, list));
  assert.ok(R.findDuplicate({ name: "margaret kelly" }, list));
  assert.strictEqual(R.findDuplicate({ name: "Someone Else", phone: "555" }, list), null);
  assert.strictEqual(R.findDuplicate(kelly, list), null);
});

test("merge fills blanks and combines history", () => {
  const m = R.merge({ id: "a", name: "Peg", tags: ["Regular"], notes: "A", log: [1] }, { id: "b", name: "x", company: "Kelly Farm", tags: ["regular", "Wholesale"], notes: "B", log: [2], followUps: [3] });
  assert.strictEqual(m.id, "a");
  assert.strictEqual(m.name, "Peg");
  assert.strictEqual(m.company, "Kelly Farm");
  assert.deepStrictEqual(m.tags, ["Regular", "Wholesale"]);
  assert.strictEqual(m.notes, "A\n\nB");
  assert.deepStrictEqual(m.log, [1, 2]);
  assert.deepStrictEqual(m.followUps, [3]);
});

test("CSV parser handles quotes, commas, newlines and BOM", () => {
  const rows = R.parseCSV('﻿Name,Notes\r\n"Kelly, Margaret","Line one\nLine ""two"""\r\n\r\nBob,\n');
  assert.deepStrictEqual(rows, [["Name", "Notes"], ["Kelly, Margaret", 'Line one\nLine "two"'], ["Bob", ""]]);
});

test("Google Contacts CSV", () => {
  const csv = "First Name,Middle Name,Last Name,Organization Name,Organization Title,E-mail 1 - Label,E-mail 1 - Value,Phone 1 - Label,Phone 1 - Value,Address 1 - Formatted,Notes\n" +
    "Margaret,,Kelly,Kelly Farm,Owner,* Home,margaret@example.com,Mobile,(518) 555-0140,\"48 Elm Avenue\nBallston Spa, NY 12020\",Likes oak\n" +
    ",,,Saratoga Bakery,,,,Work,518-555-0199,,\n" +
    ",,,,,,,,,,\n";
  const c = R.contactsFromCSV(csv);
  assert.strictEqual(c.length, 2);
  assert.deepStrictEqual(c[0], { name: "Margaret Kelly", company: "Kelly Farm", email: "margaret@example.com", phone: "(518) 555-0140", address: "48 Elm Avenue\nBallston Spa, NY 12020", notes: "Likes oak" });
  assert.strictEqual(c[1].name, "Saratoga Bakery");
  assert.strictEqual(c[1].company, "");
});

test("Outlook CSV builds the address from parts", () => {
  const csv = "First Name,Last Name,Company,E-mail Address,E-mail Display Name,Mobile Phone,Business Street,Business City,Business State,Business Postal Code\n" +
    "Tom,Reyes,,tom@example.com,Tom Reyes (tom@example.com),518 555 0101,9 Oak Ln,Troy,NY,12180\n";
  const [c] = R.contactsFromCSV(csv);
  assert.strictEqual(c.name, "Tom Reyes");
  assert.strictEqual(c.email, "tom@example.com");
  assert.strictEqual(c.address, "9 Oak Ln\nTroy, NY 12180");
});

test("simple spreadsheet columns", () => {
  const [c] = R.contactsFromCSV("Customer,Email,Phone,Address\nJoe's Diner,joe@example.com,555-1234,1 Main St\n");
  assert.strictEqual(c.name, "Joe's Diner");
  assert.strictEqual(c.address, "1 Main St");
});

test("vCard 3.0 and 2.1 quoted-printable", () => {
  const vcf = "BEGIN:VCARD\r\nVERSION:3.0\r\nN:Kelly;Margaret;;;\r\nFN:Margaret Kelly\r\nORG:Kelly Farm;\r\n" +
    "item1.EMAIL;type=INTERNET:margaret@example.com\r\nTEL;TYPE=CELL:+1 (518) 555-0140\r\n" +
    "ADR;TYPE=HOME:;;48 Elm Avenue;Ballston Spa;NY;12020;USA\r\nNOTE:Prefers calls\\, not texts\r\nEND:VCARD\r\n" +
    "BEGIN:VCARD\nVERSION:2.1\nN;CHARSET=UTF-8;ENCODING=QUOTED-PRINTABLE:Ren=C3=A9e;Jos=\n=C3=A9;;;\nTEL;CELL:5185550111\nEND:VCARD\n" +
    "BEGIN:VCARD\nVERSION:3.0\nFN:Folded\n  Name\nEND:VCARD\n";
  const c = R.parseContacts(vcf, "contacts.vcf");
  assert.strictEqual(c.length, 3);
  assert.deepStrictEqual(c[0], { name: "Margaret Kelly", company: "Kelly Farm", email: "margaret@example.com", phone: "+1 (518) 555-0140", address: "48 Elm Avenue\nBallston Spa, NY 12020\nUSA", notes: "Prefers calls, not texts" });
  assert.strictEqual(c[1].name, "José Renée");
  assert.strictEqual(c[2].name, "Folded Name");
});

test("calendar file is valid and escaped", () => {
  const out = R.ics({ name: "Kelly, Margaret", phone: "555" }, { id: "f1", due: "2026-12-31", what: "Porch; stain" }, new Date("2026-10-10T12:00:00Z"));
  assert.ok(out.startsWith("BEGIN:VCALENDAR\r\n"));
  assert.ok(out.includes("DTSTART;VALUE=DATE:20261231\r\n"));
  assert.ok(out.includes("DTEND;VALUE=DATE:20270101\r\n"));
  assert.ok(out.includes("SUMMARY:Follow up with Kelly\\, Margaret: Porch\\; stain"));
  assert.ok(out.split("\r\n").every((l) => l.length <= 75));
});

test("CSV export guards against spreadsheet formulas", () => {
  const out = R.toCSV([{ id: "x", name: "=HYPERLINK(1)", notes: 'He said "hi", ok', tags: ["A", "B"] }], [], C, today);
  const line = out.split("\r\n")[1];
  assert.ok(line.startsWith("'=HYPERLINK(1),"));
  assert.ok(line.includes('"He said ""hi"", ok"'));
  assert.ok(line.includes("A; B"));
});

test("initials", () => {
  assert.strictEqual(R.initials({ name: "margaret kelly" }), "MK");
  assert.strictEqual(R.initials({ name: "Cher" }), "C");
  assert.strictEqual(R.initials({ company: "Élan & Co" }), "ÉC");
});

console.log("\n" + n + " customer book tests passed");
