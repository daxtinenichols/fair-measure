// Shift Planner logic tests. Run: node tests/shifts.test.js
const assert = require("assert");
const P = require("../shifts/plan.js");

let n = 0;
function test(name, fn) { fn(); n++; console.log("  ok " + name); }

const staff = [
  { id: "a", name: "Ana Ruiz", role: "Barista", wage: 1800, maxHours: 30, off: [0] },
  { id: "b", name: "Ben Okafor", role: "Barista", wage: 2000, timeOff: [{ id: "t1", from: "2026-10-14", to: "2026-10-15" }] },
  { id: "c", name: "Clare Doyle", role: "Baker", wage: 0 }
];
const W = "2026-10-11"; // a Sunday
const shifts = [
  { id: "s1", date: "2026-10-12", start: "07:00", end: "15:00", staffId: "a", breakMin: 30 },
  { id: "s2", date: "2026-10-12", start: "14:00", end: "22:00", staffId: "a" },
  { id: "s3", date: "2026-10-13", start: "06:00", end: "14:00", staffId: "a" },
  { id: "s4", date: "2026-10-14", start: "07:00", end: "15:00", staffId: "b" },
  { id: "s5", date: "2026-10-16", start: "22:00", end: "06:00", staffId: "c" },
  { id: "s6", date: "2026-10-17", start: "09:00", end: "13:00", staffId: "" },
  { id: "s7", date: "2026-10-11", start: "09:00", end: "17:00", staffId: "a" },
  { id: "s8", date: "2026-10-18", start: "09:00", end: "17:00", staffId: "b" }
];

test("weeks start on the chosen day", () => {
  assert.strictEqual(P.weekStartOf("2026-10-15", 0), "2026-10-11");
  assert.strictEqual(P.weekStartOf("2026-10-15", 1), "2026-10-12");
  assert.strictEqual(P.weekStartOf("2026-10-11", 1), "2026-10-05");
  assert.deepStrictEqual(P.weekDates("2026-12-28").slice(-2), ["2027-01-02", "2027-01-03"]);
  assert.strictEqual(P.addDays("2026-03-07", 1), "2026-03-08");
  assert.strictEqual(P.addDays("2026-03-08", 1), "2026-03-09");
});

test("reads times the way people type them", () => {
  assert.strictEqual(P.readTime("7"), "07:00");
  assert.strictEqual(P.readTime("7a"), "07:00");
  assert.strictEqual(P.readTime("3:30pm"), "15:30");
  assert.strictEqual(P.readTime("12p"), "12:00");
  assert.strictEqual(P.readTime("12am"), "00:00");
  assert.strictEqual(P.readTime("1530"), "15:30");
  assert.strictEqual(P.readTime("noon"), "12:00");
  assert.strictEqual(P.readTime("25"), "");
  assert.strictEqual(P.readTime("13pm"), "");
  assert.strictEqual(P.shortTime("15:30"), "3:30p");
  assert.strictEqual(P.shortTime("00:00"), "12a");
});

test("hours subtract breaks and roll past midnight", () => {
  assert.strictEqual(P.shiftMinutes(shifts[0]), 450);
  assert.strictEqual(P.shiftMinutes(shifts[4]), 480);
  assert.strictEqual(P.shiftMinutes({ start: "09:00", end: "09:00" }), 1440);
  assert.strictEqual(P.shiftMinutes({ start: "x", end: "09:00" }), 0);
  assert.strictEqual(P.fmtHours(450), "7.5 hrs");
  assert.strictEqual(P.fmtHours(60), "1 hr");
});

test("week totals count wages and open shifts", () => {
  const t = P.weekTotals(staff, shifts, W);
  assert.strictEqual(t.by.a.minutes, 450 + 480 + 480 + 480);
  assert.strictEqual(t.by.a.cost, Math.round(1890 * 1800 / 60));
  assert.strictEqual(t.by.b.minutes, 480);
  assert.strictEqual(t.open, 1);
  assert.strictEqual(t.openMinutes, 240);
  assert.strictEqual(t.priced, false, "Clare has hours but no wage");
  assert.ok(!("s8" in t.by), "next week's shift is outside");
});

test("overtime is paid at time and a half past 40 hours", () => {
  const long = [0, 1, 2, 3, 4].map((d) => ({ id: "o" + d, date: P.addDays(W, d), start: "08:00", end: "17:00", staffId: "c" }));
  const t = P.weekTotals([{ id: "c", name: "Clare", wage: 2000 }], long, W);
  assert.strictEqual(t.by.c.minutes, 45 * 60);
  assert.strictEqual(t.by.c.overtime, 300);
  assert.strictEqual(t.by.c.cost, 40 * 2000 + 5 * 3000);
});

test("warnings catch double booking, time off, days off, short rest and limits", () => {
  const w = P.warnings(staff, shifts, W);
  assert.ok(w.s1.some((m) => m.includes("already working")), "s1 overlaps s2");
  assert.ok(w.s2.some((m) => m.includes("already working")));
  assert.ok(w.s3.some((m) => m.includes("rest since")), "8 hours after s2 ends");
  assert.ok(w.s4.some((m) => m.includes("time off")));
  assert.ok(w.s7.some((m) => m.includes("Sundays")));
  assert.ok(w.s3.some((m) => m.includes("30 hour week")), "over Ana's own limit, on her last shift");
  assert.strictEqual(w.s5, undefined);
  assert.strictEqual(w.s6, undefined);
});

test("cover options put free people first", () => {
  const opts = P.coverOptions(staff, shifts, shifts[3], W);
  assert.deepStrictEqual(opts.map((o) => o.person.id), ["c", "a"]);
  const forOpen = P.coverOptions(staff, shifts, { id: "x", date: "2026-10-14", start: "07:00", end: "15:00", staffId: "" }, W);
  const ben = forOpen.find((o) => o.person.id === "b");
  assert.strictEqual(ben.free, false);
  assert.strictEqual(ben.note, "time off, already working");
  const clash = P.coverOptions(staff, shifts, { id: "y", date: "2026-10-12", start: "08:00", end: "12:00", staffId: "" }, W);
  assert.strictEqual(clash.find((o) => o.person.id === "a").note, "already working");
});

test("copying a week moves dates and skips duplicates", () => {
  const next = P.addDays(W, 7);
  const copied = P.copyWeek(shifts, W, next);
  assert.strictEqual(copied.length, 7);
  assert.ok(copied.every((s) => s.date >= next && !s.id));
  const again = P.copyWeek(shifts.concat(copied.map((s, i) => Object.assign({ id: "n" + i }, s))), W, next);
  assert.strictEqual(again.length, 0);
  assert.strictEqual(copied.find((s) => s.start === "09:00" && s.end === "17:00" && s.staffId === "b"), undefined, "s8 is already next week");
});

test("a shared week round-trips without private details", () => {
  const people = staff.concat([{ id: "z", name: "Zoë Ńowak", role: "Owner's helper", phone: "555-0101", wage: 2500 }]);
  const code = P.packWeek({ business: "Mill St. Café", contact: "(518) 555-0140", at: "2026-10-10" }, people, shifts, W);
  assert.ok(/^[A-Za-z0-9_-]+$/.test(code), "safe in a link");
  const back = P.unpackWeek(code);
  assert.strictEqual(back.business, "Mill St. Café");
  assert.strictEqual(back.start, W);
  assert.strictEqual(back.shifts.length, 7);
  assert.strictEqual(back.staff.find((p) => p.id === "z").name, "Zoë Ńowak");
  const s1 = back.shifts.find((s) => s.id === "s1");
  assert.deepStrictEqual([s1.date, s1.start, s1.end, s1.staffId, s1.breakMin], ["2026-10-12", "07:00", "15:00", "a", 30]);
  assert.strictEqual(back.shifts.find((s) => s.id === "s6").staffId, "");
  const raw = Buffer.from(code.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
  assert.ok(!raw.includes("555-0101") && !raw.includes("2500") && !raw.includes("maxHours"), "no phone or wage in the link");
  assert.strictEqual(P.unpackWeek("not-a-schedule"), null);
});

test("swap, cover and drop requests check the current schedule", () => {
  const swap = P.unpackRequest(P.packRequest({ kind: "swap", by: "b", a: "s4", b: "s5", message: "Dentist" }));
  const plan = P.planRequest(swap, staff, shifts);
  assert.ok(plan.ok);
  assert.deepStrictEqual(plan.changes, [{ id: "s4", staffId: "c" }, { id: "s5", staffId: "b" }]);
  assert.strictEqual(swap.message, "Dentist");
  const cover = P.planRequest({ kind: "cover", by: "b", a: "s4", to: "c" }, staff, shifts);
  assert.deepStrictEqual(cover.changes, [{ id: "s4", staffId: "c" }]);
  const drop = P.planRequest({ kind: "drop", by: "b", a: "s4" }, staff, shifts);
  assert.deepStrictEqual(drop.changes, [{ id: "s4", staffId: "" }]);
  assert.ok(!P.planRequest({ kind: "drop", by: "a", a: "s4" }, staff, shifts).ok, "not Ana's shift");
  const take = P.planRequest({ kind: "cover", by: "c", a: "s6", to: "c" }, staff, shifts);
  assert.deepStrictEqual(take.changes, [{ id: "s6", staffId: "c" }], "taking an open shift");
  assert.ok(!P.planRequest({ kind: "cover", by: "c", a: "s6", to: "a" }, staff, shifts).ok, "can't hand someone else an open shift");
  assert.ok(!P.planRequest({ kind: "swap", by: "b", a: "s4", b: "s6" }, staff, shifts).ok, "other shift is open");
  assert.ok(!P.planRequest({ kind: "drop", by: "b", a: "gone" }, staff, shifts).ok);
  assert.strictEqual(P.unpackRequest(P.packRequest({ kind: "swap", by: "b", a: "s4" })), null, "a swap needs two shifts");
});

test("calendar files use local times and roll overnight shifts", () => {
  const out = P.ics([shifts[4], shifts[0]], { now: "2026-10-10T12:00:00.000Z", name: "Clare, Mill St.", title: () => "Shift; Mill St." });
  assert.ok(out.includes("DTSTART:20261016T220000\r\nDTEND:20261017T060000"));
  assert.ok(out.indexOf("20261012T070000") < out.indexOf("20261016T220000"), "sorted by date");
  assert.ok(out.includes("SUMMARY:Shift\\; Mill St."));
  assert.ok(out.includes("X-WR-CALNAME:Clare\\, Mill St."));
  assert.ok(out.includes("DTSTAMP:20261010T120000Z"));
  assert.ok(out.split("\r\n").every((l) => l.length <= 75));
});

test("text schedule reads well in a message", () => {
  assert.strictEqual(P.textSchedule([shifts[2], shifts[0]]), "Mon 10/12  7a–3p\nTue 10/13  6a–2p");
});

console.log("\n" + n + " Shift Planner tests passed");
