/*
 * Pure state logic for the priorities tracker.
 * No DOM, no storage. Every mutator returns a new state object.
 * Loaded as a classic script in the browser (exposes window.PriorityStore)
 * and via require() in Node for tests.
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.PriorityStore = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const SCHEMA_VERSION = 1;

  function uid(prefix) {
    return prefix + '_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  }

  function pad(n) {
    return n < 10 ? '0' + n : String(n);
  }

  // Local-time calendar key, e.g. "2026-09-21".
  function dateKey(d) {
    const dt = d instanceof Date ? d : new Date(d);
    return dt.getFullYear() + '-' + pad(dt.getMonth() + 1) + '-' + pad(dt.getDate());
  }

  function shiftDateKey(key, days) {
    const [y, m, d] = key.split('-').map(Number);
    const dt = new Date(y, m - 1, d + days);
    return dateKey(dt);
  }

  function clone(state) {
    return JSON.parse(JSON.stringify(state));
  }

  function createDefaultState() {
    const tiers = [
      { id: 't_faith', name: 'Faith' },
      { id: 't_family', name: 'Family' },
      { id: 't_finance', name: 'Finance' },
      { id: 't_fitness', name: 'Fitness' },
      { id: 't_school', name: 'School' },
    ];
    const priorities = [
      { id: 'p_prayer', tierId: 't_faith', title: 'Morning prayer and scripture', note: 'Before anything else, before the phone.' },
      { id: 'p_family_time', tierId: 't_family', title: 'Undistracted time with family', note: 'A call, a meal, or a real conversation.' },
      { id: 'p_budget', tierId: 't_finance', title: 'Move the money forward', note: 'Budget check, a bill, income work.' },
      { id: 'p_workout', tierId: 't_fitness', title: 'Train or walk', note: 'Something that raises the heart rate.' },
      { id: 'p_coursework', tierId: 't_school', title: 'Coursework block', note: 'Focused study. It comes after the rest, not instead of them.' },
    ];
    return {
      version: SCHEMA_VERSION,
      tiers,
      priorities,
      logs: [],
      reflections: {},
    };
  }

  // Coerce anything loaded from storage into a valid state, or null.
  function normalize(raw) {
    if (!raw || typeof raw !== 'object') return null;
    if (!Array.isArray(raw.tiers) || !Array.isArray(raw.priorities)) return null;
    const tiers = raw.tiers
      .filter((t) => t && typeof t.id === 'string' && typeof t.name === 'string')
      .map((t) => ({ id: t.id, name: t.name }));
    const tierIds = new Set(tiers.map((t) => t.id));
    const priorities = raw.priorities
      .filter((p) => p && typeof p.id === 'string' && tierIds.has(p.tierId) && typeof p.title === 'string')
      .map((p) => ({ id: p.id, tierId: p.tierId, title: p.title, note: typeof p.note === 'string' ? p.note : '' }));
    const prioIds = new Set(priorities.map((p) => p.id));
    const logs = (Array.isArray(raw.logs) ? raw.logs : [])
      .filter((l) => l && typeof l.id === 'string' && prioIds.has(l.priorityId) && typeof l.date === 'string')
      .map((l) => ({
        id: l.id,
        priorityId: l.priorityId,
        date: l.date,
        text: typeof l.text === 'string' ? l.text : '',
        at: typeof l.at === 'number' ? l.at : 0,
      }));
    const reflections = {};
    if (raw.reflections && typeof raw.reflections === 'object') {
      for (const key of Object.keys(raw.reflections)) {
        const r = raw.reflections[key];
        if (!r || typeof r !== 'object') continue;
        reflections[key] = {
          tierScores: r.tierScores && typeof r.tierScores === 'object' ? { ...r.tierScores } : {},
          crowdedOut: typeof r.crowdedOut === 'string' ? r.crowdedOut : '',
          note: typeof r.note === 'string' ? r.note : '',
          savedAt: typeof r.savedAt === 'number' ? r.savedAt : 0,
        };
      }
    }
    return { version: SCHEMA_VERSION, tiers, priorities, logs, reflections };
  }

  // ---- Tiers -------------------------------------------------------------

  function addTier(state, name) {
    const s = clone(state);
    const trimmed = String(name || '').trim();
    if (!trimmed) return state;
    s.tiers.push({ id: uid('t'), name: trimmed });
    return s;
  }

  function renameTier(state, tierId, name) {
    const trimmed = String(name || '').trim();
    if (!trimmed) return state;
    const s = clone(state);
    const t = s.tiers.find((x) => x.id === tierId);
    if (!t) return state;
    t.name = trimmed;
    return s;
  }

  function moveTier(state, tierId, direction) {
    const s = clone(state);
    const i = s.tiers.findIndex((x) => x.id === tierId);
    const j = i + direction;
    if (i < 0 || j < 0 || j >= s.tiers.length) return state;
    [s.tiers[i], s.tiers[j]] = [s.tiers[j], s.tiers[i]];
    return s;
  }

  function removeTier(state, tierId) {
    const s = clone(state);
    if (!s.tiers.some((t) => t.id === tierId)) return state;
    const doomed = new Set(s.priorities.filter((p) => p.tierId === tierId).map((p) => p.id));
    s.tiers = s.tiers.filter((t) => t.id !== tierId);
    s.priorities = s.priorities.filter((p) => p.tierId !== tierId);
    s.logs = s.logs.filter((l) => !doomed.has(l.priorityId));
    for (const key of Object.keys(s.reflections)) {
      delete s.reflections[key].tierScores[tierId];
    }
    return s;
  }

  // ---- Priorities --------------------------------------------------------

  function prioritiesForTier(state, tierId) {
    return state.priorities.filter((p) => p.tierId === tierId);
  }

  function addPriority(state, tierId, title, note) {
    const trimmed = String(title || '').trim();
    if (!trimmed || !state.tiers.some((t) => t.id === tierId)) return state;
    const s = clone(state);
    s.priorities.push({ id: uid('p'), tierId, title: trimmed, note: String(note || '').trim() });
    return s;
  }

  function updatePriority(state, priorityId, fields) {
    const s = clone(state);
    const p = s.priorities.find((x) => x.id === priorityId);
    if (!p) return state;
    if (typeof fields.title === 'string' && fields.title.trim()) p.title = fields.title.trim();
    if (typeof fields.note === 'string') p.note = fields.note.trim();
    if (typeof fields.tierId === 'string' && s.tiers.some((t) => t.id === fields.tierId)) p.tierId = fields.tierId;
    return s;
  }

  // Moves a priority up or down within its own tier.
  function movePriority(state, priorityId, direction) {
    const s = clone(state);
    const p = s.priorities.find((x) => x.id === priorityId);
    if (!p) return state;
    const siblings = s.priorities.filter((x) => x.tierId === p.tierId);
    const i = siblings.findIndex((x) => x.id === priorityId);
    const j = i + direction;
    if (j < 0 || j >= siblings.length) return state;
    const a = s.priorities.indexOf(siblings[i]);
    const b = s.priorities.indexOf(siblings[j]);
    [s.priorities[a], s.priorities[b]] = [s.priorities[b], s.priorities[a]];
    return s;
  }

  function removePriority(state, priorityId) {
    if (!state.priorities.some((p) => p.id === priorityId)) return state;
    const s = clone(state);
    s.priorities = s.priorities.filter((p) => p.id !== priorityId);
    s.logs = s.logs.filter((l) => l.priorityId !== priorityId);
    return s;
  }

  // ---- Logs ("I did this for that priority") -----------------------------

  function addLog(state, priorityId, text, date, now) {
    if (!state.priorities.some((p) => p.id === priorityId)) return state;
    const s = clone(state);
    s.logs.push({
      id: uid('l'),
      priorityId,
      date: date || dateKey(new Date()),
      text: String(text || '').trim(),
      at: typeof now === 'number' ? now : Date.now(),
    });
    return s;
  }

  function removeLog(state, logId) {
    if (!state.logs.some((l) => l.id === logId)) return state;
    const s = clone(state);
    s.logs = s.logs.filter((l) => l.id !== logId);
    return s;
  }

  function logsForDate(state, date) {
    return state.logs.filter((l) => l.date === date).sort((a, b) => a.at - b.at);
  }

  function logsForPriority(state, priorityId, date) {
    return logsForDate(state, date).filter((l) => l.priorityId === priorityId);
  }

  // ---- Reflections (end of day) ------------------------------------------

  function saveReflection(state, date, fields, now) {
    const s = clone(state);
    const prev = s.reflections[date] || { tierScores: {}, crowdedOut: '', note: '', savedAt: 0 };
    const tierScores = { ...prev.tierScores };
    if (fields.tierScores && typeof fields.tierScores === 'object') {
      for (const tierId of Object.keys(fields.tierScores)) {
        const v = Number(fields.tierScores[tierId]);
        if (v >= 1 && v <= 5) tierScores[tierId] = v;
        else delete tierScores[tierId];
      }
    }
    s.reflections[date] = {
      tierScores,
      crowdedOut: typeof fields.crowdedOut === 'string' ? fields.crowdedOut.trim() : prev.crowdedOut,
      note: typeof fields.note === 'string' ? fields.note.trim() : prev.note,
      savedAt: typeof now === 'number' ? now : Date.now(),
    };
    return s;
  }

  // ---- Summaries ---------------------------------------------------------

  // Per-tier picture of one day: how many priorities got touched, how many logs.
  function daySummary(state, date) {
    const logs = logsForDate(state, date);
    const reflection = state.reflections[date] || null;
    const tiers = state.tiers.map((tier) => {
      const prios = prioritiesForTier(state, tier.id);
      const touched = prios.filter((p) => logs.some((l) => l.priorityId === p.id)).length;
      const logCount = logs.filter((l) => prios.some((p) => p.id === l.priorityId)).length;
      return {
        tierId: tier.id,
        name: tier.name,
        total: prios.length,
        touched,
        logCount,
        score: reflection && reflection.tierScores[tier.id] ? reflection.tierScores[tier.id] : null,
      };
    });
    const scored = tiers.filter((t) => t.score !== null);
    const avgScore = scored.length ? scored.reduce((a, t) => a + t.score, 0) / scored.length : null;
    return {
      date,
      tiers,
      logCount: logs.length,
      touched: tiers.reduce((a, t) => a + t.touched, 0),
      total: tiers.reduce((a, t) => a + t.total, 0),
      reflection,
      avgScore,
    };
  }

  // The first tier (top of the ladder) that has priorities and none touched today.
  function firstNeglectedTier(state, date) {
    const summary = daySummary(state, date);
    return summary.tiers.find((t) => t.total > 0 && t.touched === 0) || null;
  }

  // Detects the failure mode the app exists for: a lower tier got attention
  // while a higher tier with priorities got none.
  function inversions(state, date) {
    const summary = daySummary(state, date);
    const out = [];
    for (let i = 0; i < summary.tiers.length; i++) {
      const higher = summary.tiers[i];
      if (higher.total === 0 || higher.touched > 0) continue;
      const lower = summary.tiers.slice(i + 1).find((t) => t.touched > 0);
      if (lower) out.push({ neglected: higher, favored: lower });
    }
    return out;
  }

  // Last `days` calendar days ending at `today`, newest first, only days
  // with any activity or a reflection.
  function history(state, today, days) {
    const out = [];
    for (let i = 0; i < days; i++) {
      const date = shiftDateKey(today, -i);
      const s = daySummary(state, date);
      if (s.logCount > 0 || s.reflection) out.push(s);
    }
    return out;
  }

  // Consecutive days (ending today or yesterday) with at least one log.
  function streak(state, today) {
    let count = 0;
    let date = today;
    if (logsForDate(state, date).length === 0) date = shiftDateKey(date, -1);
    while (logsForDate(state, date).length > 0) {
      count++;
      date = shiftDateKey(date, -1);
    }
    return count;
  }

  return {
    SCHEMA_VERSION,
    dateKey,
    shiftDateKey,
    createDefaultState,
    normalize,
    addTier,
    renameTier,
    moveTier,
    removeTier,
    prioritiesForTier,
    addPriority,
    updatePriority,
    movePriority,
    removePriority,
    addLog,
    removeLog,
    logsForDate,
    logsForPriority,
    saveReflection,
    daySummary,
    firstNeglectedTier,
    inversions,
    history,
    streak,
  };
});
