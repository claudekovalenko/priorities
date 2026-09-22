const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../store.js');

const DAY = '2026-09-21';
const NEXT = '2026-09-22';

function seeded() {
  // A fixture with its own categories and usual list, so these tests do not
  // depend on whatever the shipped defaults happen to be.
  let s = S.createDefaultState();
  s = { ...s, tiers: [
    { id: 't_faith', name: 'Faith' },
    { id: 't_family', name: 'Family' },
    { id: 't_finance', name: 'Finance' },
    { id: 't_fitness', name: 'Fitness' },
    { id: 't_school', name: 'School' },
  ] };
  s = S.addTemplateItem(s, 't_faith', 'Morning prayer and scripture', 'Before anything else, before the phone.');
  s = S.addTemplateItem(s, 't_family', 'Undistracted time with family', 'A call, a meal, or a real conversation.');
  s = S.addTemplateItem(s, 't_finance', 'Move the money forward', 'Budget check, a bill, income work.');
  s = S.addTemplateItem(s, 't_fitness', 'Train or walk', 'Something that raises the heart rate.');
  s = S.addTemplateItem(s, 't_school', 'Coursework block', 'Focused study.');
  return s;
}

// A day set up from the usual list, ready to book against.
function planned(date) {
  return S.seedPlanFromTemplate(seeded(), date || DAY);
}

function itemTitled(state, date, title) {
  return S.planFor(state, date).find((it) => it.title === title);
}

test('default state has categories and a usual list, but no days planned', () => {
  const s = seeded();
  assert.deepEqual(s.tiers.map((t) => t.name), ['Faith', 'Family', 'Finance', 'Fitness', 'School']);
  assert.equal(s.template.length, 5);
  assert.deepEqual(s.plans, {});
  assert.equal(s.logs.length, 0);
  assert.equal(S.hasPlan(s, DAY), false);
});

test('dateKey and shiftDateKey use local calendar days', () => {
  assert.equal(S.dateKey(new Date(2026, 8, 21, 23, 59)), '2026-09-21');
  assert.equal(S.shiftDateKey('2026-03-01', -1), '2026-02-28');
  assert.equal(S.shiftDateKey('2026-12-31', 1), '2027-01-01');
});

test('seeding a day copies the usual list with fresh ids', () => {
  const s = planned(NEXT);
  const plan = S.planFor(s, NEXT);
  assert.equal(plan.length, 5);
  assert.deepEqual(plan.map((it) => it.title), s.template.map((it) => it.title));
  assert.equal(plan.some((it) => s.template.some((u) => u.id === it.id)), false, 'ids are not shared with the template');
  assert.equal(S.hasPlan(s, NEXT), true);
  assert.equal(S.hasPlan(s, DAY), false, 'other days are untouched');
});

test('editing a day never rewrites the usual list', () => {
  let s = planned(NEXT);
  const it = itemTitled(s, NEXT, 'Train or walk');
  s = S.updatePlanItem(s, NEXT, it.id, { title: 'Swim a mile' });
  assert.equal(itemTitled(s, NEXT, 'Swim a mile').id, it.id);
  assert.ok(s.template.some((u) => u.title === 'Train or walk'), 'usual list unchanged');
});

test('editing the usual list never rewrites a day already set', () => {
  let s = planned(NEXT);
  const usual = s.template.find((u) => u.title === 'Train or walk');
  s = S.updateTemplateItem(s, usual.id, { title: 'Lift heavy' });
  assert.ok(s.template.some((u) => u.title === 'Lift heavy'));
  assert.ok(itemTitled(s, NEXT, 'Train or walk'), 'the planned day keeps what it was set to');
});

test('two days hold independent lists', () => {
  let s = planned(DAY);
  s = S.seedPlanFromTemplate(s, NEXT);
  const it = itemTitled(s, NEXT, 'Coursework block');
  s = S.removePlanItem(s, NEXT, it.id);
  assert.equal(S.planFor(s, NEXT).length, 4);
  assert.equal(S.planFor(s, DAY).length, 5);
});

test('a day can be copied from another day', () => {
  let s = planned(DAY);
  s = S.addPlanItem(s, DAY, 't_family', 'Call my brother', '');
  s = S.seedPlanFromDate(s, NEXT, DAY);
  assert.deepEqual(S.planFor(s, NEXT).map((it) => it.title), S.planFor(s, DAY).map((it) => it.title));
  assert.equal(S.planFor(s, NEXT)[0].id === S.planFor(s, DAY)[0].id, false, 'fresh ids');
});

test('lastPlannedDate finds the most recent day with a list', () => {
  let s = planned('2026-09-18');
  s = S.setPlan(s, '2026-09-19', []);
  assert.equal(S.lastPlannedDate(s, DAY, 10), '2026-09-18', 'an empty list does not count');
  assert.equal(S.lastPlannedDate(seeded(), DAY, 10), null);
});

test('addLog books an entry against an item on that day’s list', () => {
  const s = planned(DAY);
  const it = itemTitled(s, DAY, 'Morning prayer and scripture');
  const next = S.addLog(s, DAY, it.id, 'Read Psalm 23', 1000);
  assert.equal(s.logs.length, 0, 'input is never mutated');
  assert.equal(next.logs.length, 1);
  assert.deepEqual(
    { date: next.logs[0].date, tierId: next.logs[0].tierId, itemId: next.logs[0].itemId, text: next.logs[0].text },
    { date: DAY, tierId: 't_faith', itemId: it.id, text: 'Read Psalm 23' }
  );
});

test('an item from another day cannot be booked against this one', () => {
  let s = planned(DAY);
  s = S.seedPlanFromTemplate(s, NEXT);
  const other = itemTitled(s, NEXT, 'Train or walk');
  assert.equal(S.addLog(s, DAY, other.id, 'ran', 1), s, 'no-op: that item belongs to another day');
});

test('something you did that was not on the list books under a category', () => {
  const s = S.addLog(planned(DAY), DAY, 't_family', 'Unplanned call with grandma', 1);
  assert.equal(s.logs[0].tierId, 't_family');
  assert.equal(s.logs[0].itemId, null);
  assert.deepEqual(S.offListLogs(s, DAY, 't_family').map((l) => l.text), ['Unplanned call with grandma']);
  assert.equal(S.daySummary(s, DAY).offList, 1);
  assert.equal(S.daySummary(s, DAY).done, 0, 'it does not complete a listed priority');
});

test('moveLog re-books an entry against another item on the same day', () => {
  let s = planned(DAY);
  const prayer = itemTitled(s, DAY, 'Morning prayer and scripture');
  const course = itemTitled(s, DAY, 'Coursework block');
  s = S.addLog(s, DAY, course.id, 'read a chapter', 1);
  const id = s.logs[0].id;
  s = S.moveLog(s, id, prayer.id);
  assert.equal(s.logs[0].itemId, prayer.id);
  assert.equal(s.logs[0].tierId, 't_faith');
  s = S.moveLog(s, id, 't_fitness');
  assert.equal(s.logs[0].itemId, null);
  assert.equal(s.logs[0].tierId, 't_fitness');
  assert.equal(S.moveLog(s, id, 'ghost'), s);
});

test('removeLog drops only the named entry', () => {
  let s = planned(DAY);
  const it = itemTitled(s, DAY, 'Morning prayer and scripture');
  s = S.addLog(s, DAY, it.id, 'a', 1);
  s = S.addLog(s, DAY, it.id, 'b', 2);
  const next = S.removeLog(s, s.logs[0].id);
  assert.deepEqual(next.logs.map((l) => l.text), ['b']);
});

test('entries are scoped to their day and ordered by time', () => {
  let s = planned(DAY);
  s = S.seedPlanFromTemplate(s, NEXT);
  const a = itemTitled(s, DAY, 'Train or walk');
  const b = itemTitled(s, NEXT, 'Train or walk');
  s = S.addLog(s, DAY, a.id, 'later', 200);
  s = S.addLog(s, DAY, a.id, 'earlier', 100);
  s = S.addLog(s, NEXT, b.id, 'other day', 50);
  assert.deepEqual(S.logsForItem(s, DAY, a.id).map((l) => l.text), ['earlier', 'later']);
  assert.deepEqual(S.logsForDate(s, NEXT).map((l) => l.text), ['other day']);
});

test('daySummary reports done against planned, per category', () => {
  let s = planned(DAY);
  const prayer = itemTitled(s, DAY, 'Morning prayer and scripture');
  const course = itemTitled(s, DAY, 'Coursework block');
  s = S.addLog(s, DAY, prayer.id, '', 1);
  s = S.addLog(s, DAY, prayer.id, 'again', 2);
  s = S.addLog(s, DAY, 't_family', 'unplanned', 3);
  s = S.addLog(s, DAY, course.id, 'lecture', 4);
  const sum = S.daySummary(s, DAY);
  assert.equal(sum.planned, 5);
  assert.equal(sum.done, 2);
  assert.equal(sum.logCount, 4);
  assert.equal(sum.offList, 1);
  assert.equal(sum.activeTiers, 3);
  assert.equal(sum.tiers[0].done, 1);
  assert.equal(sum.tiers[0].logCount, 2);
  assert.equal(sum.tiers[1].done, 0);
  assert.equal(sum.tiers[1].active, true, 'an off-list entry still makes the category active');
});

test('untouchedItems names what was planned but never booked', () => {
  let s = planned(DAY);
  const prayer = itemTitled(s, DAY, 'Morning prayer and scripture');
  s = S.addLog(s, DAY, prayer.id, '', 1);
  const missed = S.untouchedItems(s, DAY);
  assert.equal(missed.length, 4);
  assert.equal(missed.some((it) => it.id === prayer.id), false);
});

test('inversions flag a lower category getting attention over a neglected higher one', () => {
  let s = planned(DAY);
  const course = itemTitled(s, DAY, 'Coursework block');
  s = S.addLog(s, DAY, course.id, 'homework', 1);
  const inv = S.inversions(s, DAY);
  assert.equal(inv.length, 4);
  assert.equal(inv[0].neglected.name, 'Faith');
  assert.equal(inv[0].favored.name, 'School');
  assert.equal(S.firstNeglectedTier(s, DAY).name, 'Faith');
});

test('a day honored top to bottom has no inversions', () => {
  let s = planned(DAY);
  for (const it of S.planFor(s, DAY)) s = S.addLog(s, DAY, it.id, '', 1);
  assert.deepEqual(S.inversions(s, DAY), []);
  assert.equal(S.firstNeglectedTier(s, DAY), null);
  assert.deepEqual(S.untouchedItems(s, DAY), []);
});

test('dropping an item from a day keeps its entries, filed under the category', () => {
  let s = planned(DAY);
  const it = itemTitled(s, DAY, 'Morning prayer and scripture');
  s = S.addLog(s, DAY, it.id, 'prayed', 1);
  s = S.removePlanItem(s, DAY, it.id);
  assert.equal(s.logs.length, 1);
  assert.equal(s.logs[0].itemId, null);
  assert.equal(s.logs[0].tierId, 't_faith');
  assert.equal(S.daySummary(s, DAY).tiers[0].active, true);
});

test('moving an item to another category carries its entries along', () => {
  let s = planned(DAY);
  const it = itemTitled(s, DAY, 'Train or walk');
  s = S.addLog(s, DAY, it.id, 'ran', 1);
  s = S.updatePlanItem(s, DAY, it.id, { tierId: 't_faith' });
  assert.equal(s.logs[0].tierId, 't_faith');
  assert.equal(S.daySummary(s, DAY).tiers[3].active, false);
});

test('a one-off can be promoted onto the usual list, without duplicating', () => {
  let s = planned(DAY);
  s = S.addPlanItem(s, DAY, 't_family', 'Call my brother', '');
  const it = itemTitled(s, DAY, 'Call my brother');
  s = S.promoteToTemplate(s, DAY, it.id);
  assert.equal(s.template.filter((u) => u.title === 'Call my brother').length, 1);
  s = S.promoteToTemplate(s, DAY, it.id);
  assert.equal(s.template.filter((u) => u.title === 'Call my brother').length, 1, 'promoting twice adds one');
});

test('reordering moves an item within its own category only', () => {
  let s = planned(DAY);
  s = S.addPlanItem(s, DAY, 't_faith', 'Evening examen', '');
  const examen = itemTitled(s, DAY, 'Evening examen');
  s = S.movePlanItem(s, DAY, examen.id, -1);
  assert.equal(S.planForTier(s, DAY, 't_faith')[0].id, examen.id);
  assert.equal(S.planForTier(s, DAY, 't_family')[0].title, 'Undistracted time with family');
  assert.equal(S.movePlanItem(s, DAY, examen.id, -1), s, 'cannot move past the top');
});

test('categories: add, rename, reorder, and delete cascading everywhere', () => {
  let s = S.addTier(planned(DAY), 'Friends');
  const id = s.tiers[5].id;
  s = S.renameTier(s, id, 'Friendship');
  assert.equal(s.tiers[5].name, 'Friendship');
  s = S.moveTier(s, id, -1);
  assert.equal(s.tiers[4].name, 'Friendship');
  assert.equal(S.moveTier(s, s.tiers[0].id, -1), s);
  s = S.addTemplateItem(s, id, 'Text a friend', '');
  s = S.addPlanItem(s, DAY, id, 'Coffee with Sam', '');
  const it = itemTitled(s, DAY, 'Coffee with Sam');
  s = S.addLog(s, DAY, it.id, 'went', 1);
  s = S.saveReflection(s, DAY, { tierScores: { [id]: 4, t_faith: 2 } });
  s = S.removeTier(s, id);
  assert.equal(s.tiers.length, 5);
  assert.equal(s.template.some((u) => u.tierId === id), false);
  assert.equal(S.planFor(s, DAY).some((x) => x.tierId === id), false);
  assert.equal(s.logs.length, 0);
  assert.deepEqual(s.reflections[DAY].tierScores, { t_faith: 2 });
});

test('saveReflection keeps scores in range and merges with what is there', () => {
  let s = S.saveReflection(planned(DAY), DAY, {
    tierScores: { t_faith: 4, t_family: 9, t_school: '2' },
    crowdedOut: '  School pushed out the workout ',
    note: 'tired',
  }, 500);
  assert.deepEqual(s.reflections[DAY].tierScores, { t_faith: 4, t_school: 2 });
  assert.equal(s.reflections[DAY].crowdedOut, 'School pushed out the workout');
  assert.equal(S.daySummary(s, DAY).avgScore, 3);
  s = S.saveReflection(s, DAY, { tierScores: { t_family: 5 } });
  assert.deepEqual(s.reflections[DAY].tierScores, { t_faith: 4, t_school: 2, t_family: 5 });
  assert.equal(s.reflections[DAY].note, 'tired', 'fields left out are kept');
});

test('history covers days that were planned, booked, or checked in', () => {
  let s = S.seedPlanFromTemplate(seeded(), '2026-09-19');
  const it = itemTitled(s, '2026-09-19', 'Train or walk');
  s = S.addLog(s, '2026-09-19', it.id, 'ran', 1);
  s = S.saveReflection(s, '2026-09-17', { note: 'quiet day' });
  s = S.seedPlanFromTemplate(s, '2026-09-16');
  assert.deepEqual(S.history(s, DAY, 7).map((d) => d.date), ['2026-09-19', '2026-09-17', '2026-09-16']);
});

test('streak counts consecutive days with entries, ending today or yesterday', () => {
  let s = seeded();
  for (const d of ['2026-09-19', '2026-09-20', DAY]) s = S.seedPlanFromTemplate(s, d);
  const at = (d) => itemTitled(s, d, 'Morning prayer and scripture').id;
  s = S.addLog(s, '2026-09-20', at('2026-09-20'), '', 1);
  s = S.addLog(s, '2026-09-19', at('2026-09-19'), '', 1);
  assert.equal(S.streak(s, DAY), 2, 'today not booked yet, so it counts back from yesterday');
  s = S.addLog(s, DAY, at(DAY), '', 1);
  assert.equal(S.streak(s, DAY), 3);
  assert.equal(S.streak(seeded(), DAY), 0);
});

test('clearPlan removes a day’s list and frees its entries to the category', () => {
  let s = planned(DAY);
  const it = itemTitled(s, DAY, 'Train or walk');
  s = S.addLog(s, DAY, it.id, 'ran', 1);
  s = S.clearPlan(s, DAY);
  assert.equal(S.hasPlan(s, DAY), false);
  assert.equal(s.logs[0].itemId, null);
  assert.equal(s.logs[0].tierId, 't_fitness');
});

test('normalize repairs a loaded blob and rejects garbage', () => {
  assert.equal(S.normalize(null), null);
  assert.equal(S.normalize({ tiers: 'x' }), null);
  const raw = {
    tiers: [{ id: 'a', name: 'A' }, { bad: true }],
    template: [{ id: 'u1', tierId: 'a', title: 'U' }, { id: 'u2', tierId: 'ghost', title: 'orphan' }],
    plans: { [DAY]: [{ id: 'i1', tierId: 'a', title: 'P' }, { id: 'i2', tierId: 'ghost', title: 'orphan' }] },
    logs: [
      { id: 'l1', date: DAY, itemId: 'i1', text: 'x', at: 5 },
      { id: 'l2', date: DAY, itemId: 'i2' },
      { id: 'l3', date: DAY, tierId: 'a', text: 'off list' },
      { id: 'l4', date: DAY, tierId: 'ghost' },
      { id: 'l5', date: NEXT, itemId: 'i1', tierId: 'a', text: 'item belongs to another day' },
      { id: 'l6', date: NEXT, itemId: 'i1', text: 'nothing valid to file it under' },
    ],
    reflections: { [DAY]: { tierScores: { a: 3 }, note: 'n' }, junk: 5 },
  };
  const s = S.normalize(raw);
  assert.equal(s.tiers.length, 1);
  assert.equal(s.template.length, 1);
  assert.equal(S.planFor(s, DAY).length, 1);
  assert.deepEqual(s.logs.map((l) => l.id), ['l1', 'l3', 'l5'], 'l2, l4 and l6 have nothing valid to file them under');
  assert.equal(s.logs[1].itemId, null);
  assert.equal(s.logs[2].itemId, null, 'an item id from another day does not carry over');
  assert.equal(s.logs[2].tierId, 'a', 'but the category is kept when it is valid');
  assert.deepEqual(Object.keys(s.reflections), [DAY]);
});

test('version 1 data migrates: the standing list becomes each recorded day’s list', () => {
  const v1 = {
    version: 1,
    tiers: [{ id: 't_faith', name: 'Faith' }, { id: 't_school', name: 'School' }],
    priorities: [
      { id: 'p_prayer', tierId: 't_faith', title: 'Morning prayer', note: '' },
      { id: 'p_course', tierId: 't_school', title: 'Coursework', note: '' },
    ],
    logs: [
      { id: 'l1', priorityId: 'p_prayer', date: DAY, text: 'psalms', at: 5 },
      { id: 'l2', tierId: 't_school', date: DAY, text: 'off list', at: 6 },
    ],
    reflections: { '2026-09-18': { tierScores: { t_faith: 4 }, note: 'ok' } },
  };
  const s = S.normalize(v1);
  assert.equal(s.version, 2);
  assert.deepEqual(s.template.map((u) => u.title), ['Morning prayer', 'Coursework']);
  assert.deepEqual(S.planFor(s, DAY).map((it) => it.title), ['Morning prayer', 'Coursework'], 'the day it had history is rebuilt');
  assert.deepEqual(S.planFor(s, '2026-09-18').map((it) => it.title), ['Morning prayer', 'Coursework'], 'so is the day it was only reflected on');
  assert.equal(S.hasPlan(s, NEXT), false, 'days with no history are left unset');
  assert.equal(s.logs[0].itemId, 'p_prayer', 'the old entry still points at its priority');
  assert.equal(S.daySummary(s, DAY).done, 1);
  assert.equal(S.daySummary(s, DAY).offList, 1);
});

test('a round trip through JSON preserves state', () => {
  let s = planned(DAY);
  const it = itemTitled(s, DAY, 'Morning prayer and scripture');
  s = S.addLog(s, DAY, it.id, 'x', 1);
  s = S.addLog(s, DAY, 't_family', 'y', 2);
  s = S.saveReflection(s, DAY, { tierScores: { t_faith: 5 } }, 2);
  assert.deepEqual(S.normalize(JSON.parse(JSON.stringify(s))), s);
});
