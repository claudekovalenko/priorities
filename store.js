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
    const prioById = new Map(priorities.map((p) => [p.id, p]));
    const logs = [];
    for (const l of Array.isArray(raw.logs) ? raw.logs : []) {
      if (!l || typeof l.id !== 'string' || typeof l.date !== 'string') continue;
      // A log is booked under a tier, and optionally under one of that tier's priorities.
      let priorityId = typeof l.priorityId === 'string' && prioById.has(l.priorityId) ? l.priorityId : null;
      let tierId = priorityId ? prioById.get(priorityId).tierId : (typeof l.tierId === 'string' ? l.tierId : null);
      if (!tierIds.has(tierId)) continue;
      logs.push({
        id: l.id,
        tierId,
        priorityId,
        date: l.date,
        text: typeof l.text === 'string' ? l.text : '',
        at: typeof l.at === 'number' ? l.at : 0,
      });
    }
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
    s.tiers = s.tiers.filter((t) => t.id !== tierId);
    s.priorities = s.priorities.filter((p) => p.tierId !== tierId);
    s.logs = s.logs.filter((l) => l.tierId !== tierId);
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
    if (typeof fields.tierId === 'string' && s.tiers.some((t) => t.id === fields.tierId) && fields.tierId !== p.tierId) {
      p.tierId = fields.tierId;
      for (const l of s.logs) if (l.priorityId === p.id) l.tierId = p.tierId;
    }
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

  // Removing a priority keeps its history: entries fall back to the tier.
  function removePriority(state, priorityId) {
    if (!state.priorities.some((p) => p.id === priorityId)) return state;
    const s = clone(state);
    s.priorities = s.priorities.filter((p) => p.id !== priorityId);
    for (const l of s.logs) if (l.priorityId === priorityId) l.priorityId = null;
    return s;
  }

  // ---- Logs ("I did this", booked under a tier or a priority) ------------

  // `target` is a priority id, a tier id, or { tierId, priorityId }.
  function resolveTarget(state, target) {
    if (target && typeof target === 'object') {
      if (target.priorityId) return resolveTarget(state, target.priorityId);
      return resolveTarget(state, target.tierId);
    }
    const p = state.priorities.find((x) => x.id === target);
    if (p) return { tierId: p.tierId, priorityId: p.id };
    if (state.tiers.some((t) => t.id === target)) return { tierId: target, priorityId: null };
    return null;
  }

  function addLog(state, target, text, date, now) {
    const where = resolveTarget(state, target);
    if (!where) return state;
    const s = clone(state);
    s.logs.push({
      id: uid('l'),
      tierId: where.tierId,
      priorityId: where.priorityId,
      date: date || dateKey(new Date()),
      text: String(text || '').trim(),
      at: typeof now === 'number' ? now : Date.now(),
    });
    return s;
  }

  // Re-book an existing entry under a different tier or priority.
  function moveLog(state, logId, target) {
    const where = resolveTarget(state, target);
    const l = state.logs.find((x) => x.id === logId);
    if (!where || !l) return state;
    const s = clone(state);
    const target_ = s.logs.find((x) => x.id === logId);
    target_.tierId = where.tierId;
    target_.priorityId = where.priorityId;
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

  // Every entry booked anywhere in the tier.
  function logsForTier(state, tierId, date) {
    return logsForDate(state, date).filter((l) => l.tierId === tierId);
  }

  // Entries booked under the tier itself, not under one of its priorities.
  function generalLogsForTier(state, tierId, date) {
    return logsForTier(state, tierId, date).filter((l) => !l.priorityId);
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
      const tierLogs = logs.filter((l) => l.tierId === tier.id);
      const touched = prios.filter((p) => tierLogs.some((l) => l.priorityId === p.id)).length;
      return {
        tierId: tier.id,
        name: tier.name,
        total: prios.length,
        touched,
        logCount: tierLogs.length,
        general: tierLogs.filter((l) => !l.priorityId).length,
        active: tierLogs.length > 0,
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
      activeTiers: tiers.filter((t) => t.active).length,
      reflection,
      avgScore,
    };
  }

  // The first tier (top of the ladder) with nothing booked under it today.
  function firstNeglectedTier(state, date) {
    const summary = daySummary(state, date);
    return summary.tiers.find((t) => !t.active) || null;
  }

  // Detects the failure mode the app exists for: a lower tier got attention
  // while a higher tier got none.
  function inversions(state, date) {
    const summary = daySummary(state, date);
    const out = [];
    for (let i = 0; i < summary.tiers.length; i++) {
      const higher = summary.tiers[i];
      if (higher.active) continue;
      const lower = summary.tiers.slice(i + 1).find((t) => t.active);
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
    moveLog,
    removeLog,
    logsForDate,
    logsForPriority,
    logsForTier,
    generalLogsForTier,
    saveReflection,
    daySummary,
    firstNeglectedTier,
    inversions,
    history,
    streak,
  };
});
