const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../store.js');
const A = require('../alignment.js');

const DAY = '2026-09-21';

// God and Marriage pick up defaults by name; Errands has none.
function fixture() {
  let s = S.createDefaultState();
  s = S.addArea(s, 'God');
  s = S.addArea(s, 'Marriage');
  s = S.addArea(s, 'Errands');
  const [god, marriage, errands] = s.areas.map((a) => a.id);
  s = S.addPlanItem(s, DAY, 'Prayer', '', god);
  s = S.addPlanItem(s, DAY, 'Date night', '', marriage);
  s = S.addPlanItem(s, DAY, 'Groceries', '', errands);
  return { s, god, marriage, errands };
}

function item(state, title) {
  return S.planFor(state, DAY).find((it) => it.title === title);
}

test('an untouched area uses the default for its name', () => {
  const { s } = fixture();
  const link = A.linkFor(s, s.areas[0]);
  assert.equal(link.calling, 'abide');
  assert.ok(link.carries.includes('s01'));
  assert.equal(link.custom, false);
  assert.equal(A.linkFor(s, s.areas[2]).calling, null);
});

test('setting an area by hand overrides its default and survives a reload', () => {
  const { s, god } = fixture();
  const next = S.setAreaAlignment(s, god, { calling: 'disciples', carries: ['s03', 's03', 7] });
  const reloaded = S.normalize(JSON.parse(JSON.stringify(next)));
  const link = A.linkFor(reloaded, reloaded.areas[0]);
  assert.equal(link.calling, 'disciples');
  assert.deepEqual(link.carries, ['s03']);
  assert.equal(link.custom, true);
});

test('removing an area drops its links', () => {
  const { s, god } = fixture();
  const next = S.removeArea(S.setAreaAlignment(s, god, { calling: 'fun', carries: [] }), god);
  assert.equal(next.alignment[god], undefined);
});

test('the report splits booked entries and planned items by calling', () => {
  let { s } = fixture();
  s = S.addLog(s, DAY, item(s, 'Prayer').id, 'Morning prayer', 1);
  s = S.addLog(s, DAY, item(s, 'Prayer').id, 'Evening prayer', 2);
  s = S.addLog(s, DAY, null, 'Scrolled', 3);
  const r = A.report(s, DAY, 7);
  const row = (id) => r.callings.find((c) => c.id === id);
  assert.equal(r.totalLogs, 3);
  assert.equal(r.totalPlanned, 3);
  assert.equal(row('abide').logs, 2);
  assert.equal(row('abide').shareOfLogs, 67);
  assert.equal(row('abide').plannedDone, 1);
  assert.equal(row('husband').planned, 1);
  assert.equal(row('husband').plannedDone, 0);
  assert.equal(row('untied').planned, 1);
  assert.equal(row('offlist').logs, 1);
  assert.deepEqual(r.untiedAreas, ['Errands']);
});

test('a Deep item is fed on the days an area carrying it gets an entry', () => {
  let { s } = fixture();
  s = S.addLog(s, DAY, item(s, 'Prayer').id, 'Prayed', 1);
  const r = A.report(s, DAY, 7);
  const walk = r.deep.find((d) => d.id === 's01');
  assert.deepEqual(walk.fedDates, [DAY]);
  assert.deepEqual(walk.carriedBy, ['God']);
  const wife = r.deep.find((d) => d.id === 's05');
  assert.deepEqual(wife.fedDates, []);
  assert.deepEqual(wife.carriedBy, ['Marriage']);
});

test('suggestions name what nothing carries, untied areas, and planned-but-untouched callings', () => {
  let { s } = fixture();
  s = S.addLog(s, DAY, item(s, 'Prayer').id, 'Prayed', 1);
  const notes = A.suggestions(A.report(s, DAY, 7)).join('\n');
  assert.match(notes, /Purity is Deep in stewardship, but no area here carries it/);
  assert.match(notes, /Errands is not tied to any calling/);
  assert.match(notes, /“Husband like Christ” was on your list 1 time, and nothing was booked/);
  assert.match(notes, /Nothing on your lists fed “Fun”/);
  assert.match(notes, /My wife is carried by Marriage, but nothing booked this week fed it/);
});

test('the live stewardship list replaces the bundled one, with scores skipping unscored days', () => {
  const live = A.deepFromStewardship({
    v: 5,
    items: [
      { id: 's01', tier: 'deep', label: 'Walk with God', daily: true, log: { [DAY]: 4, '2026-09-20': 2, bad: 5 } },
      { id: 'x', tier: 'current', label: 'Not deep' },
    ],
  });
  assert.equal(live.length, 1);
  const { s } = fixture();
  const r = A.report(s, DAY, 7, live);
  assert.equal(r.deep.length, 1);
  assert.equal(r.deep[0].score, 60);
  assert.equal(A.deepFromStewardship({ items: [] }), null);
  assert.equal(A.deepFromStewardship(null), null);
});
