// Time Book logic tests. Run: node tests/time.test.js
const assert = require("assert");
const T = require("../time/hours.js");

let n = 0;
function test(name, fn) { fn(); n++; console.log("  ok " + name); }

test("reads durations the way people type them", () => {
  assert.strictEqual(T.parseDuration("1:30"), 90);
  assert.strictEqual(T.parseDuration("1.5"), 90);
  assert.strictEqual(T.parseDuration("1,25"), 75);
  assert.strictEqual(T.parseDuration("90m"), 90);
  assert.strictEqual(T.parseDuration("90"), 90);
  assert.strictEqual(T.parseDuration("8"), 480);
  assert.strictEqual(T.parseDuration("1h 30m"), 90);
  assert.strictEqual(T.parseDuration("2 hrs"), 120);
  assert.strictEqual(T.parseDuration("45 min"), 45);
  assert.strictEqual(T.parseDuration(""), null);
  assert.strictEqual(T.parseDuration("soon"), null);
});

test("clock times, including past midnight", () => {
  assert.strictEqual(T.minutesBetween("08:00", "12:15"), 255);
  assert.strictEqual(T.minutesBetween("22:00", "01:30"), 210);
  assert.strictEqual(T.minutesBetween("8", "9"), 0);
});

test("durations and the running clock read plainly", () => {
  assert.strictEqual(T.fmtDuration(0), "0m");
  assert.strictEqual(T.fmtDuration(45), "45m");
  assert.strictEqual(T.fmtDuration(120), "2h");
  assert.strictEqual(T.fmtDuration(135), "2h 15m");
  assert.strictEqual(T.fmtClock(3723000), "1:02:03");
});

test("rounding goes to the nearest step, both ways", () => {
  assert.strictEqual(T.roundMinutes(52, 15), 45);
  assert.strictEqual(T.roundMinutes(53, 15), 60);
  assert.strictEqual(T.roundMinutes(52, 6), 54);
  assert.strictEqual(T.roundMinutes(52, 0), 52);
});

test("money matches the invoice line to the cent", () => {
  assert.strictEqual(T.hoursQty(80), 1.33);
  assert.strictEqual(T.amount(80, 6000), 7980);
  assert.strictEqual(T.amount(90, 6500), 9750);
});

test("weeks", () => {
  assert.strictEqual(T.weekStartOf("2026-10-15", 0), "2026-10-11");
  assert.strictEqual(T.weekStartOf("2026-10-15", 1), "2026-10-12");
  assert.deepStrictEqual(T.weekDates("2026-12-28").slice(-2), ["2027-01-02", "2027-01-03"]);
});

const entries = [
  { id: "a", date: "2026-10-12", start: "08:00", minutes: 200, job: "Bookshelf", rate: 6000, billable: true },
  { id: "b", date: "2026-10-14", start: "09:00", minutes: 95, job: "bookshelf ", rate: 6000, billable: true },
  { id: "c", date: "2026-10-13", minutes: 30, job: "Bookshelf", rate: 7500, billable: true },
  { id: "d", date: "2026-10-13", minutes: 60, job: "Quote visit", rate: 6000, billable: false },
  { id: "e", date: "2026-10-15", minutes: 40, job: "", note: "Sanding", rate: 6000, billable: true, invoiceId: "gone" },
  { id: "f", date: "2026-10-15", minutes: 25, job: "Trim", rate: 6000, billable: true, invoiceId: "inv1" }
];

test("totals know billed from unbilled, and a deleted invoice frees its hours", () => {
  const t = T.summarize(entries, { inv1: true });
  assert.strictEqual(t.minutes, 450);
  assert.strictEqual(t.billable, 390);
  assert.strictEqual(t.billed, 25);
  assert.strictEqual(t.unbilled, 365);
  assert.strictEqual(t.unbilledValue, T.amount(200, 6000) + T.amount(95, 6000) + T.amount(30, 7500) + T.amount(40, 6000));
});

test("invoice lines group by job and rate, rounded per line", () => {
  const fd = (d) => d.slice(5);
  const lines = T.invoiceLines(entries.slice(0, 3), { rounding: 15, fmtDate: fd });
  assert.strictEqual(lines.length, 2);
  assert.strictEqual(lines[0].minutes, 300); // 295 to the nearest 15
  assert.strictEqual(lines[0].qty, 5);
  assert.strictEqual(lines[0].price, 6000);
  assert.strictEqual(lines[0].description, "Bookshelf (5h, 10-12 to 10-14)");
  assert.deepStrictEqual(lines[0].ids, ["a", "b"]);
  assert.strictEqual(lines[1].description, "Bookshelf (30m, 10-13)");
  assert.strictEqual(lines[1].taxable, false);
});

test("one line per entry, and lines that round to nothing are left off", () => {
  const lines = T.invoiceLines([entries[4], { id: "z", date: "2026-10-16", minutes: 5, rate: 6000 }], { group: "entry", rounding: 15, fmtDate: (d) => d });
  assert.strictEqual(lines.length, 1);
  assert.strictEqual(lines[0].description, "2026-10-15, Sanding (45m)");
});

test("CSV export is spreadsheet-safe", () => {
  const out = T.csv([{ date: "2026-10-12", minutes: 90, customer: "=HYPERLINK(1)", job: "Shelf, oak", billable: true, rate: 6000 }]);
  const row = out.split("\r\n")[1];
  assert.ok(row.startsWith("2026-10-12,,,1.50,'=HYPERLINK(1),\"Shelf, oak\""));
  assert.ok(row.endsWith(",yes,60.00,90.00,"));
});

console.log(n + " Time Book tests passed");
