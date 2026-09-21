const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../store.js');

const DAY = '2026-09-21';

function seeded() {
  return S.createDefaultState();
}

test('default state has the four Fs first and school last', () => {
  const s = seeded();
  assert.deepEqual(s.tiers.map((t) => t.name), ['Faith', 'Family', 'Finance', 'Fitness', 'School']);
  assert.ok(s.priorities.length >= 5);
  assert.equal(s.logs.length, 0);
});

test('dateKey and shiftDateKey use local calendar days', () => {
  assert.equal(S.dateKey(new Date(2026, 8, 21, 23, 59)), '2026-09-21');
  assert.equal(S.shiftDateKey('2026-03-01', -1), '2026-02-28');
  assert.equal(S.shiftDateKey('2026-12-31', 1), '2027-01-01');
});

test('addLog stores an entry against a priority for a date, never mutating input', () => {
  const s = seeded();
  const next = S.addLog(s, 'p_prayer', 'Read Psalm 23', DAY, 1000);
  assert.equal(s.logs.length, 0);
  assert.equal(next.logs.length, 1);
  assert.equal(next.logs[0].text, 'Read Psalm 23');
  assert.equal(next.logs[0].date, DAY);
  assert.equal(S.addLog(s, 'nope', 'x', DAY), s, 'unknown priority is a no-op');
});

test('removeLog drops only the named entry', () => {
  let s = S.addLog(seeded(), 'p_prayer', 'a', DAY, 1);
  s = S.addLog(s, 'p_prayer', 'b', DAY, 2);
  const id = s.logs[0].id;
  const next = S.removeLog(s, id);
  assert.equal(next.logs.length, 1);
  assert.equal(next.logs[0].text, 'b');
});

test('logsForPriority is scoped to the day and ordered by time', () => {
  let s = S.addLog(seeded(), 'p_workout', 'later', DAY, 200);
  s = S.addLog(s, 'p_workout', 'earlier', DAY, 100);
  s = S.addLog(s, 'p_workout', 'other day', '2026-09-20', 50);
  assert.deepEqual(S.logsForPriority(s, 'p_workout', DAY).map((l) => l.text), ['earlier', 'later']);
});

test('daySummary counts touched priorities per tier', () => {
  let s = S.addLog(seeded(), 'p_prayer', '', DAY, 1);
  s = S.addLog(s, 'p_prayer', '', DAY, 2);
  s = S.addLog(s, 'p_coursework', 'lecture', DAY, 3);
  const sum = S.daySummary(s, DAY);
  assert.equal(sum.logCount, 3);
  assert.equal(sum.touched, 2);
  assert.equal(sum.tiers[0].touched, 1);
  assert.equal(sum.tiers[0].logCount, 2);
  assert.equal(sum.tiers[4].touched, 1);
  assert.equal(sum.avgScore, null);
});

test('inversions flags a lower tier getting attention over an empty higher one', () => {
  const s = S.addLog(seeded(), 'p_coursework', 'homework', DAY, 1);
  const inv = S.inversions(s, DAY);
  assert.equal(inv.length, 4, 'all four tiers above school are neglected');
  assert.equal(inv[0].neglected.name, 'Faith');
  assert.equal(inv[0].favored.name, 'School');
  assert.equal(S.firstNeglectedTier(s, DAY).name, 'Faith');
});

test('inversions is empty when the ladder is honored top-down', () => {
  let s = seeded();
  for (const p of s.priorities) s = S.addLog(s, p.id, '', DAY, 1);
  assert.deepEqual(S.inversions(s, DAY), []);
  assert.equal(S.firstNeglectedTier(s, DAY), null);
});

test('inversions ignores tiers with no priorities', () => {
  let s = S.removePriority(seeded(), 'p_prayer');
  s = S.addLog(s, 'p_family_time', 'dinner', DAY, 1);
  assert.deepEqual(S.inversions(s, DAY), [], 'Faith has no priorities, so it cannot be neglected');
  assert.equal(S.firstNeglectedTier(s, DAY).name, 'Finance');
});

test('saveReflection stores scores in range and drops out-of-range ones', () => {
  const s = S.saveReflection(seeded(), DAY, {
    tierScores: { t_faith: 4, t_family: 9, t_school: '2' },
    crowdedOut: '  School pushed out the workout ',
    note: 'tired',
  }, 500);
  const r = s.reflections[DAY];
  assert.deepEqual(r.tierScores, { t_faith: 4, t_school: 2 });
  assert.equal(r.crowdedOut, 'School pushed out the workout');
  assert.equal(r.savedAt, 500);
  const sum = S.daySummary(s, DAY);
  assert.equal(sum.avgScore, 3);
  assert.equal(sum.tiers[0].score, 4);
});

test('saveReflection merges with an existing reflection', () => {
  let s = S.saveReflection(seeded(), DAY, { tierScores: { t_faith: 3 }, note: 'first' });
  s = S.saveReflection(s, DAY, { tierScores: { t_family: 5 } });
  assert.deepEqual(s.reflections[DAY].tierScores, { t_faith: 3, t_family: 5 });
  assert.equal(s.reflections[DAY].note, 'first');
});

test('tier management: add, rename, move, remove cascades', () => {
  let s = S.addTier(seeded(), 'Friends');
  assert.equal(s.tiers.length, 6);
  const id = s.tiers[5].id;
  s = S.renameTier(s, id, 'Friendship');
  assert.equal(s.tiers[5].name, 'Friendship');
  s = S.moveTier(s, id, -1);
  assert.equal(s.tiers[4].name, 'Friendship');
  assert.equal(S.moveTier(s, s.tiers[0].id, -1), s, 'cannot move above the top');
  s = S.addPriority(s, id, 'Text a friend', '');
  s = S.addLog(s, s.priorities[s.priorities.length - 1].id, 'hi', DAY, 1);
  s = S.saveReflection(s, DAY, { tierScores: { [id]: 4, t_faith: 2 } });
  s = S.removeTier(s, id);
  assert.equal(s.tiers.length, 5);
  assert.equal(s.priorities.some((p) => p.tierId === id), false);
  assert.equal(s.logs.length, 0);
  assert.deepEqual(s.reflections[DAY].tierScores, { t_faith: 2 });
});

test('priority management: add, update, move within tier, remove cascades logs', () => {
  let s = S.addPriority(seeded(), 't_faith', 'Evening examen', 'Five minutes');
  const faith = S.prioritiesForTier(s, 't_faith');
  assert.equal(faith.length, 2);
  const id = faith[1].id;
  s = S.updatePriority(s, id, { title: 'Examen', note: '' });
  assert.equal(s.priorities.find((p) => p.id === id).title, 'Examen');
  s = S.movePriority(s, id, -1);
  assert.equal(S.prioritiesForTier(s, 't_faith')[0].id, id);
  assert.equal(S.prioritiesForTier(s, 't_family')[0].id, 'p_family_time', 'other tiers untouched');
  s = S.addLog(s, id, 'done', DAY, 1);
  s = S.removePriority(s, id);
  assert.equal(s.logs.length, 0);
  assert.equal(S.addPriority(s, 't_faith', '   ', ''), s, 'blank title is a no-op');
});

test('history lists only days with activity, newest first', () => {
  let s = S.addLog(seeded(), 'p_prayer', '', '2026-09-19', 1);
  s = S.saveReflection(s, '2026-09-17', { note: 'quiet day' });
  const days = S.history(s, DAY, 7);
  assert.deepEqual(days.map((d) => d.date), ['2026-09-19', '2026-09-17']);
});

test('streak counts consecutive logged days ending today or yesterday', () => {
  let s = S.addLog(seeded(), 'p_prayer', '', '2026-09-20', 1);
  s = S.addLog(s, 'p_prayer', '', '2026-09-19', 1);
  assert.equal(S.streak(s, DAY), 2, 'yesterday and the day before, today not yet logged');
  s = S.addLog(s, 'p_workout', '', DAY, 1);
  assert.equal(S.streak(s, DAY), 3);
  assert.equal(S.streak(seeded(), DAY), 0);
});

test('normalize repairs a loaded blob and rejects garbage', () => {
  assert.equal(S.normalize(null), null);
  assert.equal(S.normalize({ tiers: 'x' }), null);
  const raw = {
    tiers: [{ id: 'a', name: 'A' }, { bad: true }],
    priorities: [{ id: 'p1', tierId: 'a', title: 'P' }, { id: 'p2', tierId: 'ghost', title: 'orphan' }],
    logs: [{ id: 'l1', priorityId: 'p1', date: DAY, text: 'x', at: 5 }, { id: 'l2', priorityId: 'p2', date: DAY }],
    reflections: { [DAY]: { tierScores: { a: 3 }, note: 'n' }, junk: 5 },
  };
  const s = S.normalize(raw);
  assert.equal(s.tiers.length, 1);
  assert.equal(s.priorities.length, 1);
  assert.equal(s.logs.length, 1);
  assert.deepEqual(Object.keys(s.reflections), [DAY]);
  assert.equal(s.reflections[DAY].crowdedOut, '');
  assert.equal(s.priorities[0].note, '');
});

test('a round trip through JSON preserves state', () => {
  let s = S.addLog(seeded(), 'p_prayer', 'x', DAY, 1);
  s = S.saveReflection(s, DAY, { tierScores: { t_faith: 5 } }, 2);
  assert.deepEqual(S.normalize(JSON.parse(JSON.stringify(s))), s);
});
