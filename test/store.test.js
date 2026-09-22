const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../store.js');

const DAY = '2026-09-21';
const NEXT = '2026-09-22';

// A fixture with a usual list, so tests do not depend on the shipped defaults.
function seeded() {
  let s = S.createDefaultState();
  s = S.addArea(s, 'God');
  s = S.addArea(s, 'Family');
  const god = s.areas[0].id;
  const family = s.areas[1].id;
  s = S.addTemplateItem(s, 'Prayer', 'Before the phone.', god);
  s = S.addTemplateItem(s, 'Time with family', '', family);
  s = S.addTemplateItem(s, 'Train', '', null);
  s = S.addTemplateItem(s, 'Coursework', '', null);
  return s;
}

function planned(date) {
  return S.seedPlanFromTemplate(seeded(), date || DAY);
}

function itemTitled(state, date, title) {
  return S.planFor(state, date).find((it) => it.title === title);
}

test('a fresh state has no areas, no usual list and no days', () => {
  const s = S.createDefaultState();
  assert.deepEqual(s.areas, []);
  assert.deepEqual(s.template, []);
  assert.deepEqual(s.plans, {});
  assert.equal(s.logs.length, 0);
});

test('dateKey and shiftDateKey use local calendar days', () => {
  assert.equal(S.dateKey(new Date(2026, 8, 21, 23, 59)), '2026-09-21');
  assert.equal(S.shiftDateKey('2026-03-01', -1), '2026-02-28');
  assert.equal(S.shiftDateKey('2026-12-31', 1), '2027-01-01');
});

test('a day holds an ordered list, seeded from the usual list with fresh ids', () => {
  const s = planned(NEXT);
  const plan = S.planFor(s, NEXT);
  assert.deepEqual(plan.map((it) => it.title), ['Prayer', 'Time with family', 'Train', 'Coursework']);
  assert.equal(plan.some((it) => s.template.some((u) => u.id === it.id)), false, 'ids are not shared');
  assert.equal(S.hasPlan(s, DAY), false, 'other days are untouched');
});

test('two days hold independent lists', () => {
  let s = planned(DAY);
  s = S.seedPlanFromTemplate(s, NEXT);
  s = S.removePlanItem(s, NEXT, itemTitled(s, NEXT, 'Coursework').id);
  assert.equal(S.planFor(s, NEXT).length, 3);
  assert.equal(S.planFor(s, DAY).length, 4);
});

test('editing a day never rewrites the usual list, and the reverse holds', () => {
  let s = planned(NEXT);
  const it = itemTitled(s, NEXT, 'Train');
  s = S.updatePlanItem(s, NEXT, it.id, { title: 'Swim' });
  assert.ok(s.template.some((u) => u.title === 'Train'), 'usual list unchanged');
  const usual = s.template.find((u) => u.title === 'Train');
  s = S.updateTemplateItem(s, usual.id, { title: 'Lift' });
  assert.equal(itemTitled(s, NEXT, 'Swim').id, it.id, 'the day keeps what it was set to');
});

test('addPlanItem appends and insertPlanItem slides one in at a position', () => {
  let s = planned(DAY);
  s = S.addPlanItem(s, DAY, 'Last thing', '', null);
  assert.equal(S.planFor(s, DAY)[4].title, 'Last thing');
  s = S.insertPlanItem(s, DAY, 2, 'Slid in at two', '', null);
  assert.deepEqual(S.planFor(s, DAY).map((it) => it.title),
    ['Prayer', 'Slid in at two', 'Time with family', 'Train', 'Coursework', 'Last thing']);
  s = S.insertPlanItem(s, DAY, 99, 'Past the end', '', null);
  assert.equal(S.planFor(s, DAY)[6].title, 'Past the end', 'a position past the end lands last');
  assert.equal(S.addPlanItem(s, DAY, '   ', '', null), s, 'a blank title is a no-op');
});

test('movePlanItem reorders within the day and stops at the ends', () => {
  let s = planned(DAY);
  const train = itemTitled(s, DAY, 'Train');
  s = S.movePlanItem(s, DAY, train.id, -1);
  assert.deepEqual(S.planFor(s, DAY).map((it) => it.title), ['Prayer', 'Train', 'Time with family', 'Coursework']);
  const first = S.planFor(s, DAY)[0];
  assert.equal(S.movePlanItem(s, DAY, first.id, -1), s, 'cannot move above the top');
});

test('entries book against a priority on that day’s list', () => {
  const s = planned(DAY);
  const it = itemTitled(s, DAY, 'Prayer');
  const next = S.addLog(s, DAY, it.id, 'Read Psalm 23', 1000);
  assert.equal(s.logs.length, 0, 'input is never mutated');
  assert.deepEqual(
    { date: next.logs[0].date, itemId: next.logs[0].itemId, text: next.logs[0].text },
    { date: DAY, itemId: it.id, text: 'Read Psalm 23' }
  );
  assert.equal(S.daySummary(next, DAY).done, 1);
});

test('an entry with no priority sits off the list', () => {
  const s = S.addLog(planned(DAY), DAY, null, 'Unplanned errand', 1);
  assert.equal(s.logs[0].itemId, null);
  assert.deepEqual(S.offListLogs(s, DAY).map((l) => l.text), ['Unplanned errand']);
  assert.equal(S.daySummary(s, DAY).done, 0, 'it completes nothing on the list');
  assert.equal(S.daySummary(s, DAY).logCount, 1);
});

test('a priority from another day cannot be booked against this one', () => {
  let s = planned(DAY);
  s = S.seedPlanFromTemplate(s, NEXT);
  const other = itemTitled(s, NEXT, 'Train');
  assert.equal(S.addLog(s, DAY, other.id, 'ran', 1), s);
});

test('moveLog re-books an entry, and null moves it off the list', () => {
  let s = planned(DAY);
  const prayer = itemTitled(s, DAY, 'Prayer');
  const course = itemTitled(s, DAY, 'Coursework');
  s = S.addLog(s, DAY, course.id, 'read a chapter', 1);
  const id = s.logs[0].id;
  s = S.moveLog(s, id, prayer.id);
  assert.equal(s.logs[0].itemId, prayer.id);
  s = S.moveLog(s, id, null);
  assert.equal(s.logs[0].itemId, null);
  assert.equal(S.moveLog(s, id, 'ghost'), s);
});

test('entries are scoped to their day and ordered by time', () => {
  let s = planned(DAY);
  s = S.seedPlanFromTemplate(s, NEXT);
  const a = itemTitled(s, DAY, 'Train');
  const b = itemTitled(s, NEXT, 'Train');
  s = S.addLog(s, DAY, a.id, 'later', 200);
  s = S.addLog(s, DAY, a.id, 'earlier', 100);
  s = S.addLog(s, NEXT, b.id, 'other day', 50);
  assert.deepEqual(S.logsForItem(s, DAY, a.id).map((l) => l.text), ['earlier', 'later']);
  assert.deepEqual(S.logsForDate(s, NEXT).map((l) => l.text), ['other day']);
});

test('daySummary numbers the list and reports what is done', () => {
  let s = planned(DAY);
  const prayer = itemTitled(s, DAY, 'Prayer');
  s = S.addLog(s, DAY, prayer.id, 'psalms', 1);
  s = S.addLog(s, DAY, prayer.id, 'more', 2);
  s = S.addLog(s, DAY, null, 'off list', 3);
  const sum = S.daySummary(s, DAY);
  assert.equal(sum.planned, 4);
  assert.equal(sum.done, 1);
  assert.equal(sum.logCount, 3);
  assert.equal(sum.offList.length, 1);
  assert.deepEqual(sum.items.map((e) => e.position), [1, 2, 3, 4]);
  assert.equal(sum.items[0].logs.length, 2);
  assert.equal(sum.items[1].done, false);
});

test('untouchedItems names what was planned but never booked', () => {
  let s = planned(DAY);
  s = S.addLog(s, DAY, itemTitled(s, DAY, 'Prayer').id, '', 1);
  assert.deepEqual(S.untouchedItems(s, DAY).map((it) => it.title), ['Time with family', 'Train', 'Coursework']);
});

test('inversions flag something lower down getting time before something above', () => {
  let s = planned(DAY);
  s = S.addLog(s, DAY, itemTitled(s, DAY, 'Coursework').id, 'homework', 1);
  const inv = S.inversions(s, DAY);
  assert.equal(inv.length, 3, 'the three above it were all skipped');
  assert.equal(inv[0].neglected.position, 1);
  assert.equal(inv[0].favored.position, 4);
});

test('a day worked top to bottom has no inversions', () => {
  let s = planned(DAY);
  for (const it of S.planFor(s, DAY)) s = S.addLog(s, DAY, it.id, '', 1);
  assert.deepEqual(S.inversions(s, DAY), []);
  assert.deepEqual(S.untouchedItems(s, DAY), []);
});

test('dropping a priority keeps its entries, moved off the list', () => {
  let s = planned(DAY);
  const it = itemTitled(s, DAY, 'Prayer');
  s = S.addLog(s, DAY, it.id, 'prayed', 1);
  s = S.saveReflection(s, DAY, { scores: { [it.id]: 4 } });
  s = S.removePlanItem(s, DAY, it.id);
  assert.equal(s.logs.length, 1);
  assert.equal(s.logs[0].itemId, null);
  assert.deepEqual(s.reflections[DAY].scores, {}, 'its score goes with it');
});

test('areas are optional tags; removing one clears the tag but keeps the work', () => {
  let s = planned(DAY);
  const god = s.areas.find((a) => a.name === 'God').id;
  assert.equal(itemTitled(s, DAY, 'Prayer').areaId, god);
  assert.equal(S.areaName(s, god), 'God');
  s = S.addLog(s, DAY, itemTitled(s, DAY, 'Prayer').id, 'prayed', 1);
  s = S.removeArea(s, god);
  assert.equal(itemTitled(s, DAY, 'Prayer').areaId, null);
  assert.equal(S.planFor(s, DAY).length, 4, 'the priority survives');
  assert.equal(s.logs.length, 1, 'the entry survives');
  assert.equal(s.template.find((u) => u.title === 'Prayer').areaId, null);
});

test('renameArea and addArea manage the tag vocabulary', () => {
  let s = S.addArea(seeded(), 'Work');
  const id = s.areas[2].id;
  s = S.renameArea(s, id, 'Work development');
  assert.equal(S.areaName(s, id), 'Work development');
  assert.equal(S.addArea(s, '  '), s, 'a blank name is a no-op');
});

test('a one-off can be promoted onto the usual list, without duplicating', () => {
  let s = planned(DAY);
  s = S.addPlanItem(s, DAY, 'Call my brother', '', null);
  const it = itemTitled(s, DAY, 'Call my brother');
  s = S.promoteToTemplate(s, DAY, it.id);
  s = S.promoteToTemplate(s, DAY, it.id);
  assert.equal(s.template.filter((u) => u.title === 'Call my brother').length, 1);
});

test('saveReflection keeps scores in range, tied to that day’s priorities', () => {
  let s = planned(DAY);
  const prayer = itemTitled(s, DAY, 'Prayer');
  const train = itemTitled(s, DAY, 'Train');
  s = S.saveReflection(s, DAY, {
    scores: { [prayer.id]: 4, [train.id]: 9, ghost: 3 },
    crowdedOut: '  Coursework pushed out the workout ',
    note: 'tired',
  }, 500);
  assert.deepEqual(s.reflections[DAY].scores, { [prayer.id]: 4 });
  assert.equal(s.reflections[DAY].crowdedOut, 'Coursework pushed out the workout');
  s = S.saveReflection(s, DAY, { note: 'second pass' });
  assert.deepEqual(s.reflections[DAY].scores, { [prayer.id]: 4 }, 'fields left out are kept');
  assert.equal(s.reflections[DAY].note, 'second pass');
});

test('history covers days that were planned, booked, or checked in', () => {
  let s = S.seedPlanFromTemplate(seeded(), '2026-09-19');
  s = S.addLog(s, '2026-09-19', itemTitled(s, '2026-09-19', 'Train').id, 'ran', 1);
  s = S.saveReflection(s, '2026-09-17', { note: 'quiet day' });
  s = S.seedPlanFromTemplate(s, '2026-09-16');
  assert.deepEqual(S.history(s, DAY, 7).map((d) => d.date), ['2026-09-19', '2026-09-17', '2026-09-16']);
});

test('streak counts consecutive days with entries, ending today or yesterday', () => {
  let s = seeded();
  for (const d of ['2026-09-19', '2026-09-20', DAY]) s = S.seedPlanFromTemplate(s, d);
  const at = (d) => itemTitled(s, d, 'Prayer').id;
  s = S.addLog(s, '2026-09-20', at('2026-09-20'), '', 1);
  s = S.addLog(s, '2026-09-19', at('2026-09-19'), '', 1);
  assert.equal(S.streak(s, DAY), 2);
  s = S.addLog(s, DAY, at(DAY), '', 1);
  assert.equal(S.streak(s, DAY), 3);
  assert.equal(S.streak(seeded(), DAY), 0);
});

test('clearPlan removes a day’s list and frees its entries', () => {
  let s = planned(DAY);
  const it = itemTitled(s, DAY, 'Train');
  s = S.addLog(s, DAY, it.id, 'ran', 1);
  s = S.clearPlan(s, DAY);
  assert.equal(S.hasPlan(s, DAY), false);
  assert.equal(s.logs[0].itemId, null, 'the entry survives, off the list');
});

test('normalize repairs a loaded blob and rejects garbage', () => {
  assert.equal(S.normalize(null), null);
  assert.equal(S.normalize({ areas: 'x' }), null);
  const raw = {
    version: 3,
    areas: [{ id: 'a', name: 'A' }, { bad: true }],
    template: [{ id: 'u1', title: 'U', areaId: 'a' }, { id: 'u2', title: 'Untagged', areaId: 'ghost' }],
    plans: { [DAY]: [{ id: 'i1', title: 'P', areaId: 'a' }, { nope: 1 }] },
    logs: [
      { id: 'l1', date: DAY, itemId: 'i1', text: 'x', at: 5 },
      { id: 'l2', date: DAY, itemId: 'ghost', text: 'falls off the list' },
      { id: 'l3', date: DAY, text: 'already off the list' },
    ],
    reflections: { [DAY]: { scores: { i1: 3, ghost: 5 }, note: 'n' }, junk: 5 },
  };
  const s = S.normalize(raw);
  assert.equal(s.areas.length, 1);
  assert.equal(s.template.length, 2);
  assert.equal(s.template[1].areaId, null, 'an unknown tag is dropped, the priority is kept');
  assert.equal(S.planFor(s, DAY).length, 1);
  assert.deepEqual(s.logs.map((l) => l.id), ['l1', 'l2', 'l3'], 'no entry is ever discarded');
  assert.equal(s.logs[1].itemId, null);
  assert.deepEqual(s.reflections[DAY].scores, { i1: 3 });
  assert.deepEqual(Object.keys(s.reflections), [DAY]);
});

test('version 2 data migrates: each day’s categories become that day’s list', () => {
  const v2 = {
    version: 2,
    tiers: [{ id: 't_god', name: 'God' }, { id: 't_fam', name: 'Family' }, { id: 't_school', name: 'School' }],
    template: [],
    plans: {},
    logs: [
      { id: 'l1', date: DAY, tierId: 't_god', itemId: null, text: 'prayed', at: 1 },
      { id: 'l2', date: DAY, tierId: 't_fam', itemId: null, text: 'texted Mom', at: 2 },
      { id: 'l3', date: DAY, tierId: 't_fam', itemId: null, text: 'called home', at: 3 },
    ],
    reflections: { [DAY]: { tierScores: { t_god: 5 }, note: 'good day' } },
  };
  const s = S.normalize(v2);
  assert.equal(s.version, 3);
  assert.deepEqual(S.planFor(s, DAY).map((it) => it.title), ['God', 'Family'],
    'only the categories that carried entries become priorities, in order');
  const sum = S.daySummary(s, DAY);
  assert.equal(sum.done, 2);
  assert.equal(sum.logCount, 3);
  assert.equal(sum.offList.length, 0, 'every entry found its priority');
  assert.deepEqual(sum.items[1].logs.map((l) => l.text), ['texted Mom', 'called home']);
  assert.equal(s.reflections[DAY].note, 'good day');
  assert.deepEqual(s.areas.map((a) => a.name), ['God', 'Family', 'School'], 'categories survive as tags');
});

test('version 2 days that already had priorities keep them', () => {
  const v2 = {
    version: 2,
    tiers: [{ id: 't_god', name: 'God' }],
    template: [],
    plans: { [DAY]: [{ id: 'i1', tierId: 't_god', title: 'Morning prayer' }] },
    logs: [
      { id: 'l1', date: DAY, tierId: 't_god', itemId: 'i1', text: 'psalms', at: 1 },
      { id: 'l2', date: DAY, tierId: 't_god', itemId: null, text: 'prayed in the car', at: 2 },
    ],
    reflections: {},
  };
  const s = S.normalize(v2);
  const titles = S.planFor(s, DAY).map((it) => it.title);
  assert.deepEqual(titles, ['Morning prayer', 'God'], 'the category entry gains a priority of its own');
  const sum = S.daySummary(s, DAY);
  assert.equal(sum.logCount, 2);
  assert.equal(sum.offList.length, 0);
});

test('version 1 data migrates through to the flat model', () => {
  const v1 = {
    version: 1,
    tiers: [{ id: 't_faith', name: 'Faith' }],
    priorities: [{ id: 'p_prayer', tierId: 't_faith', title: 'Morning prayer', note: '' }],
    logs: [{ id: 'l1', priorityId: 'p_prayer', date: DAY, text: 'psalms', at: 5 }],
    reflections: {},
  };
  const s = S.normalize(v1);
  assert.equal(s.version, 3);
  assert.deepEqual(S.planFor(s, DAY).map((it) => it.title), ['Morning prayer']);
  assert.equal(S.daySummary(s, DAY).done, 1);
});

test('a round trip through JSON preserves state', () => {
  let s = planned(DAY);
  const it = itemTitled(s, DAY, 'Prayer');
  s = S.addLog(s, DAY, it.id, 'x', 1);
  s = S.addLog(s, DAY, null, 'y', 2);
  s = S.saveReflection(s, DAY, { scores: { [it.id]: 5 } }, 2);
  assert.deepEqual(S.normalize(JSON.parse(JSON.stringify(s))), s);
});

test('the day rolls over at the day-start hour, not midnight', () => {
  const before = new Date(2026, 8, 22, 1, 0);   // 1am Tuesday
  const after = new Date(2026, 8, 22, 9, 0);    // 9am Tuesday
  const evening = new Date(2026, 8, 21, 23, 30); // late Monday
  assert.equal(S.dayKeyNow(4, before), '2026-09-21', 'a 1am entry still belongs to Monday');
  assert.equal(S.dayKeyNow(4, after), '2026-09-22');
  assert.equal(S.dayKeyNow(4, evening), '2026-09-21');
  assert.equal(S.dayKeyNow(0, before), '2026-09-22', 'a zero hour means plain midnight');
  assert.equal(S.dayKeyNow(undefined, before), '2026-09-21', 'the default is used when unset');
});

test('the day-start hour is stored, validated and defaulted', () => {
  const s = S.createDefaultState();
  assert.equal(S.dayStartHour(s), S.DEFAULT_DAY_START);
  assert.equal(S.dayStartHour(S.setDayStartHour(s, 6)), 6);
  assert.equal(S.dayStartHour(S.setDayStartHour(s, 0)), 0);
  assert.equal(S.setDayStartHour(s, 13), s, 'out of range is a no-op');
  assert.equal(S.setDayStartHour(s, -1), s);
  assert.equal(S.setDayStartHour(s, 'nope'), s);
  assert.equal(S.dayStartHour(S.normalize(JSON.parse(JSON.stringify(S.setDayStartHour(s, 5))))), 5, 'it survives a round trip');
  assert.equal(S.dayStartHour(S.normalize({ areas: [], template: [], settings: { dayStartHour: 99 } })), S.DEFAULT_DAY_START);
});

test('standing commitments are managed apart from the numbered list', () => {
  let s = S.addStanding(S.createDefaultState(), 'Purity', 'Almost all my time with others.');
  assert.equal(s.standing.length, 1);
  assert.equal(s.standing[0].body, 'Almost all my time with others.');
  s = S.addStanding(s, 'Rest', '');
  s = S.moveStanding(s, s.standing[1].id, -1);
  assert.deepEqual(s.standing.map((n) => n.title), ['Rest', 'Purity']);
  s = S.updateStanding(s, s.standing[1].id, { title: 'Purity and fellowship' });
  assert.equal(s.standing[1].title, 'Purity and fellowship');
  assert.equal(S.addStanding(s, '   ', ''), s, 'a blank title is a no-op');
  assert.deepEqual(S.planFor(s, DAY), [], 'it never touches a day’s list');
  s = S.removeStanding(s, s.standing[0].id);
  assert.deepEqual(s.standing.map((n) => n.title), ['Purity and fellowship']);
});

test('describeSkippedAbove names what was passed over, or nothing', () => {
  let s = planned(DAY);
  const items = S.planFor(s, DAY);
  assert.equal(S.describeSkippedAbove(s, DAY, items[0].id), null, 'the top can never skip anything');

  s = S.addLog(s, DAY, items[2].id, 'ran', 1);
  const text = S.describeSkippedAbove(s, DAY, items[2].id);
  assert.match(text, /^Worked #3 Train while #1 Prayer, #2 Time with family had nothing yet\.$/);

  // Once the ones above are covered, the same entry skips nothing.
  let t = planned(DAY);
  t = S.addLog(t, DAY, items[0].id, '', 1);
  t = S.addLog(t, DAY, items[1].id, '', 2);
  t = S.addLog(t, DAY, items[2].id, '', 3);
  assert.equal(S.describeSkippedAbove(t, DAY, items[2].id), null);
  assert.equal(S.describeSkippedAbove(t, DAY, 'ghost'), null);
});

test('describeSkippedAbove summarises a long tail rather than listing it all', () => {
  let s = planned(DAY);
  s = S.addPlanItem(s, DAY, 'Fifth', '', null);
  const items = S.planFor(s, DAY);
  s = S.addLog(s, DAY, items[4].id, 'late', 1);
  assert.match(S.describeSkippedAbove(s, DAY, items[4].id), /and 1 more had nothing yet\.$/);
});

test('order notes are recorded, editable and removable, and survive a round trip', () => {
  let s = planned(DAY);
  assert.deepEqual(S.orderNotesFor(s, DAY), []);

  s = S.addOrderNote(s, DAY, 'Worked #4 before #1.', { auto: true }, 100);
  s = S.addOrderNote(s, DAY, 'Felt rushed all morning.', { auto: false }, 200);
  const notes = S.orderNotesFor(s, DAY);
  assert.equal(notes.length, 2);
  assert.equal(notes[0].auto, true);
  assert.equal(notes[1].auto, false);

  s = S.updateOrderNote(s, DAY, notes[0].id, '  Worked the essay before prayer.  ');
  assert.equal(S.orderNotesFor(s, DAY)[0].text, 'Worked the essay before prayer.');
  assert.equal(S.updateOrderNote(s, DAY, notes[0].id, '   '), s, 'a blank edit is a no-op');
  assert.equal(S.addOrderNote(s, DAY, '  ', {}, 1), s);

  assert.deepEqual(S.normalize(JSON.parse(JSON.stringify(s))), s);

  s = S.removeOrderNote(s, DAY, notes[0].id);
  assert.deepEqual(S.orderNotesFor(s, DAY).map((n) => n.text), ['Felt rushed all morning.']);
});

test('order notes stay put even after the skipped priority is caught up', () => {
  let s = planned(DAY);
  const items = S.planFor(s, DAY);
  s = S.addLog(s, DAY, items[3].id, 'coursework', 1);
  s = S.addOrderNote(s, DAY, S.describeSkippedAbove(s, DAY, items[3].id), { auto: true }, 2);
  assert.equal(S.inversions(s, DAY).length, 3);

  // Catching up clears the live warning, but the record of the day remains.
  for (const it of items.slice(0, 3)) s = S.addLog(s, DAY, it.id, 'later', 3);
  assert.deepEqual(S.inversions(s, DAY), [], 'nothing is out of order any more');
  assert.equal(S.orderNotesFor(s, DAY).length, 1, 'but what happened is still written down');
});

test('an order note can be kept on a day with no check-in saved', () => {
  let s = S.addOrderNote(planned(DAY), DAY, 'noticed something', { auto: false }, 1);
  assert.equal(s.reflections[DAY].note, '', 'the rest of the check-in stays empty');
  s = S.saveReflection(s, DAY, { note: 'tired' });
  assert.equal(S.orderNotesFor(s, DAY).length, 1, 'saving a check-in keeps the notes');
  assert.equal(s.reflections[DAY].note, 'tired');
});
