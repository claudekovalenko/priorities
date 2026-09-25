/*
 * How the day's priorities line up with the other two apps.
 *
 * Vision names the callings everything is for. Stewardship names the Deep
 * things that are mine to carry. Here, each priority area says which calling
 * it feeds and which Deep things it carries, so a week of booked entries can
 * be read against both: where the effort went, and what nothing fed.
 *
 * The callings and the Deep list are copied from those apps below. When
 * stewardship has saved its own list in this browser (same site, so the same
 * storage), that live list is used instead of the copy.
 *
 * Pure: no DOM, no storage. Loaded as window.PriorityAlignment in the browser
 * and via require() in Node for tests.
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory(require('./store.js'));
  } else {
    root.PriorityAlignment = factory(root.PriorityStore);
  }
})(typeof self !== 'undefined' ? self : this, function (S) {
  'use strict';

  // The vision app's callings, in its order: the base first.
  const CALLINGS = [
    { id: 'abide', name: 'Remain in Jesus' },
    { id: 'husband', name: 'Husband like Christ' },
    { id: 'disciples', name: 'Raise up disciples' },
    { id: 'foundation', name: 'Foundation' },
    { id: 'fun', name: 'Fun' },
  ];

  // Stewardship's Deep tier as it stands in that repo. Replaced by the live
  // list whenever stewardship has saved one in this browser.
  const DEEP = [
    { id: 's00', label: 'Love the Lord', daily: false },
    { id: 's00b', label: 'Love my neighbor', daily: false },
    { id: 's01', label: 'Walk with God', daily: true },
    { id: 's24', label: 'Prayer & Word', daily: true },
    { id: 's02', label: 'Christlikeness', daily: false },
    { id: 's03', label: 'My calling', daily: true },
    { id: 's04', label: 'Purity', daily: true },
    { id: 's05', label: 'My wife', daily: true },
    { id: 's06', label: 'My family', daily: false },
    { id: 's25', label: 'Providing', daily: true },
    { id: 's26', label: 'Future children', daily: true },
    { id: 's07', label: 'Those I disciple', daily: true },
    { id: 's08', label: 'My health', daily: false },
    { id: 's09', label: 'Where I’m planted', daily: false },
  ];

  const STEWARDSHIP_KEY = 'building-and-blessing/v5';

  // Where each existing area points until it is set by hand. Matched on the
  // area's name, case-insensitively.
  const DEFAULTS = {
    god: { calling: 'abide', carries: ['s00', 's01', 's24'] },
    marriage: { calling: 'husband', carries: ['s05'] },
    family: { calling: 'husband', carries: ['s06'] },
    ministry: { calling: 'disciples', carries: ['s03', 's07', 's09', 's00b'] },
    work: { calling: 'foundation', carries: ['s25'] },
    seminary: { calling: 'disciples', carries: ['s03'] },
    logistics: { calling: 'foundation', carries: [] },
    health: { calling: 'foundation', carries: ['s08'] },
    fun: { calling: 'fun', carries: [] },
  };

  function callingName(id) {
    const c = CALLINGS.find((x) => x.id === id);
    return c ? c.name : '';
  }

  // An area's links: what was set by hand, else the default for its name,
  // else nothing. `custom` says which.
  function linkFor(state, area) {
    const set = state.alignment && state.alignment[area.id];
    if (set) return { calling: set.calling, carries: set.carries.slice(), custom: true };
    const d = DEFAULTS[String(area.name || '').trim().toLowerCase()];
    return { calling: d ? d.calling : null, carries: d ? d.carries.slice() : [], custom: false };
  }

  // Stewardship's saved state, reduced to its Deep items. Returns null when
  // there is nothing usable, so the caller falls back to DEEP.
  function deepFromStewardship(raw) {
    if (!raw || !Array.isArray(raw.items)) return null;
    const out = [];
    for (const it of raw.items) {
      if (!it || it.tier !== 'deep' || typeof it.id !== 'string') continue;
      const log = {};
      if (it.log && typeof it.log === 'object') {
        for (const d of Object.keys(it.log)) {
          const v = Number(it.log[d]);
          if (/^\d{4}-\d{2}-\d{2}$/.test(d) && Number.isFinite(v) && v >= 0 && v <= 5) log[d] = v;
        }
      }
      out.push({ id: it.id, label: String(it.label || it.name || 'Untitled'), daily: Boolean(it.daily), log });
    }
    return out.length ? out : null;
  }

  function windowDates(end, days) {
    const out = [];
    for (let i = days - 1; i >= 0; i--) out.push(S.shiftDateKey(end, -i));
    return out;
  }

  // The week ending on `end`, read against the callings and the Deep list.
  function report(state, end, days, deepList) {
    const deep = deepList || DEEP;
    const dates = windowDates(end, days);
    const links = new Map(state.areas.map((a) => [a.id, linkFor(state, a)]));
    const rowKeys = CALLINGS.map((c) => c.id).concat(['untied', 'offlist']);
    const rows = new Map(rowKeys.map((k) => [k, { planned: 0, plannedDone: 0, logs: 0 }]));
    const fed = new Map(deep.map((d) => [d.id, new Set()]));
    const carriedBy = new Map(deep.map((d) => [d.id, []]));
    for (const a of state.areas) {
      for (const id of links.get(a.id).carries) if (carriedBy.has(id)) carriedBy.get(id).push(a.name);
    }

    function keyFor(item) {
      const link = item && item.areaId ? links.get(item.areaId) : null;
      return link && link.calling && rows.has(link.calling) ? link.calling : 'untied';
    }

    let totalLogs = 0;
    let totalPlanned = 0;
    for (const date of dates) {
      const plan = S.planFor(state, date);
      const logs = S.logsForDate(state, date);
      for (const it of plan) {
        const row = rows.get(keyFor(it));
        const done = logs.some((l) => l.itemId === it.id);
        row.planned++;
        totalPlanned++;
        if (done) row.plannedDone++;
      }
      for (const l of logs) {
        totalLogs++;
        const item = l.itemId ? plan.find((it) => it.id === l.itemId) : null;
        if (!item) { rows.get('offlist').logs++; continue; }
        rows.get(keyFor(item)).logs++;
        const link = item.areaId ? links.get(item.areaId) : null;
        if (link) for (const id of link.carries) if (fed.has(id)) fed.get(id).add(date);
      }
    }

    const pct = (n, of) => (of ? Math.round((n / of) * 100) : 0);
    const callings = rowKeys.map((k) => {
      const r = rows.get(k);
      const name = k === 'untied' ? 'Not tied to the vision' : k === 'offlist' ? 'Off the list' : callingName(k);
      return {
        id: k,
        name,
        planned: r.planned,
        plannedDone: r.plannedDone,
        logs: r.logs,
        shareOfLogs: pct(r.logs, totalLogs),
        shareOfPlan: pct(r.planned, totalPlanned),
      };
    }).filter((r) => CALLINGS.some((c) => c.id === r.id) || r.planned || r.logs);

    const deepRows = deep.map((d) => {
      const scored = d.log ? dates.filter((x) => d.log[x] !== undefined).map((x) => d.log[x]) : [];
      return {
        id: d.id,
        label: d.label,
        daily: d.daily,
        carriedBy: carriedBy.get(d.id),
        fedDates: dates.filter((x) => fed.get(d.id).has(x)),
        // Stewardship's own reading: days not scored are skipped, not zero.
        score: scored.length ? Math.round((scored.reduce((a, b) => a + b, 0) / (scored.length * 5)) * 100) : null,
      };
    });

    return {
      dates,
      totalLogs,
      totalPlanned,
      callings,
      deep: deepRows,
      untiedAreas: state.areas.filter((a) => !links.get(a.id).calling).map((a) => a.name),
    };
  }

  // Plain observations, most structural first. Nothing here is a verdict;
  // each one is something worth a look at check-in.
  function suggestions(r) {
    const out = [];
    for (const d of r.deep) {
      if (!d.carriedBy.length) {
        out.push(d.label + ' is Deep in stewardship, but no area here carries it. Tie it to an area below, or give it an area of its own.');
      }
    }
    for (const name of r.untiedAreas) {
      out.push(name + ' is not tied to any calling in your vision. Say which one it serves, or ask whether it belongs on the list.');
    }
    if (!r.totalPlanned && !r.totalLogs) return out;
    for (const c of r.callings) {
      if (!CALLINGS.some((x) => x.id === c.id)) continue;
      if (!c.planned && !c.logs) out.push('Nothing on your lists fed “' + c.name + '” this week.');
      else if (c.planned && !c.plannedDone) out.push('“' + c.name + '” was on your list ' + c.planned + (c.planned === 1 ? ' time' : ' times') + ', and nothing was booked against it.');
    }
    const top = r.callings.filter((c) => c.logs).sort((a, b) => b.shareOfLogs - a.shareOfLogs)[0];
    if (top && r.totalLogs >= 5 && top.shareOfLogs >= 50) {
      out.push(top.shareOfLogs + '% of what you did went to “' + top.name + '.” Is that the weight you meant it to carry?');
    }
    for (const d of r.deep) {
      if (d.carriedBy.length && !d.fedDates.length) {
        out.push(d.label + ' is carried by ' + d.carriedBy.join(' and ') + ', but nothing booked this week fed it.');
      }
    }
    return out;
  }

  return {
    CALLINGS,
    DEEP,
    DEFAULTS,
    STEWARDSHIP_KEY,
    callingName,
    linkFor,
    deepFromStewardship,
    report,
    suggestions,
  };
});
