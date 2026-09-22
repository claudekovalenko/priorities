/*
 * Pure state logic for the priorities tracker.
 *
 * The model, in the user's words: every night you set a list of priorities
 * for the next day. The next day you say "I did this for that priority" and
 * it books in. Everything saves by day.
 *
 * So each calendar day owns its own plan (a list of items, each filed under
 * a category). Entries book against an item in that day's plan, or against a
 * category when the thing you did was not on the list. A reusable "usual
 * list" seeds a new day so you are not retyping every night.
 *
 * No DOM, no storage. Every mutator returns a new state object.
 * Loaded as a classic script in the browser (window.PriorityStore) and via
 * require() in Node for tests.
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.PriorityStore = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const SCHEMA_VERSION = 2;

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
    return dateKey(new Date(y, m - 1, d + days));
  }

  function clone(state) {
    return JSON.parse(JSON.stringify(state));
  }

  function createDefaultState() {
    const tiers = [
      { id: 'c_god', name: 'God' },
      { id: 'c_marriage', name: 'Marriage' },
      { id: 'c_brothers', name: 'Connection with brothers' },
      { id: 'c_family', name: 'Family' },
      { id: 'c_work', name: 'Work development' },
      { id: 'c_house', name: 'Help and house' },
      { id: 'c_school', name: 'School' },
    ];
    // No usual list by default: the categories alone are enough to start
    // booking against. Specific priorities are added per day, or built up
    // into a usual list over time.
    return { version: SCHEMA_VERSION, tiers, template: [], plans: {}, logs: [], reflections: {} };
  }

  function cleanItems(rawItems, tierIds) {
    const out = [];
    for (const it of Array.isArray(rawItems) ? rawItems : []) {
      if (!it || typeof it.id !== 'string' || typeof it.title !== 'string') continue;
      if (!tierIds.has(it.tierId)) continue;
      out.push({ id: it.id, tierId: it.tierId, title: it.title, note: typeof it.note === 'string' ? it.note : '' });
    }
    return out;
  }

  // Coerce anything loaded from storage into a valid state, or null.
  // Understands version 1, where priorities were one standing list.
  function normalize(raw) {
    if (!raw || typeof raw !== 'object') return null;
    if (!Array.isArray(raw.tiers)) return null;
    const tiers = raw.tiers
      .filter((t) => t && typeof t.id === 'string' && typeof t.name === 'string')
      .map((t) => ({ id: t.id, name: t.name }));
    const tierIds = new Set(tiers.map((t) => t.id));

    const legacy = !Array.isArray(raw.template) && Array.isArray(raw.priorities);
    const template = cleanItems(legacy ? raw.priorities : raw.template, tierIds);
    if (!legacy && !Array.isArray(raw.template) && !Array.isArray(raw.priorities)) return null;

    const plans = {};
    if (raw.plans && typeof raw.plans === 'object') {
      for (const date of Object.keys(raw.plans)) {
        plans[date] = cleanItems(raw.plans[date], tierIds);
      }
    }

    const rawLogs = Array.isArray(raw.logs) ? raw.logs : [];

    // Version 1 had no per-day plans: the standing list applied to every day.
    // Rebuild each day that has history as a copy of that list.
    if (legacy) {
      const dates = new Set();
      for (const l of rawLogs) if (l && typeof l.date === 'string') dates.add(l.date);
      if (raw.reflections && typeof raw.reflections === 'object') {
        for (const d of Object.keys(raw.reflections)) dates.add(d);
      }
      for (const d of dates) if (!plans[d]) plans[d] = template.map((it) => ({ ...it }));
    }

    const logs = [];
    for (const l of rawLogs) {
      if (!l || typeof l.id !== 'string' || typeof l.date !== 'string') continue;
      const plan = plans[l.date] || [];
      // v1 called it priorityId; either way it names an item in that day's plan.
      const wanted = typeof l.itemId === 'string' ? l.itemId : (typeof l.priorityId === 'string' ? l.priorityId : null);
      const item = wanted ? plan.find((it) => it.id === wanted) : null;
      const tierId = item ? item.tierId : l.tierId;
      if (!tierIds.has(tierId)) continue;
      logs.push({
        id: l.id,
        date: l.date,
        tierId,
        itemId: item ? item.id : null,
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

    return { version: SCHEMA_VERSION, tiers, template, plans, logs, reflections };
  }

  // ---- Categories --------------------------------------------------------

  function addTier(state, name) {
    const trimmed = String(name || '').trim();
    if (!trimmed) return state;
    const s = clone(state);
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
    if (!state.tiers.some((t) => t.id === tierId)) return state;
    const s = clone(state);
    s.tiers = s.tiers.filter((t) => t.id !== tierId);
    s.template = s.template.filter((it) => it.tierId !== tierId);
    for (const date of Object.keys(s.plans)) {
      s.plans[date] = s.plans[date].filter((it) => it.tierId !== tierId);
    }
    s.logs = s.logs.filter((l) => l.tierId !== tierId);
    for (const date of Object.keys(s.reflections)) delete s.reflections[date].tierScores[tierId];
    return s;
  }

  // ---- The usual list (seeds a new day) ----------------------------------

  function addTemplateItem(state, tierId, title, note) {
    const trimmed = String(title || '').trim();
    if (!trimmed || !state.tiers.some((t) => t.id === tierId)) return state;
    const s = clone(state);
    s.template.push({ id: uid('u'), tierId, title: trimmed, note: String(note || '').trim() });
    return s;
  }

  function updateTemplateItem(state, itemId, fields) {
    const s = clone(state);
    const it = s.template.find((x) => x.id === itemId);
    if (!it) return state;
    if (typeof fields.title === 'string' && fields.title.trim()) it.title = fields.title.trim();
    if (typeof fields.note === 'string') it.note = fields.note.trim();
    if (typeof fields.tierId === 'string' && s.tiers.some((t) => t.id === fields.tierId)) it.tierId = fields.tierId;
    return s;
  }

  function moveTemplateItem(state, itemId, direction) {
    return moveWithinTier(state, state.template, itemId, direction, (s) => s.template);
  }

  function removeTemplateItem(state, itemId) {
    if (!state.template.some((it) => it.id === itemId)) return state;
    const s = clone(state);
    s.template = s.template.filter((it) => it.id !== itemId);
    return s;
  }

  // Shared reorder helper: swaps an item with its neighbour inside its own
  // category, leaving every other category untouched.
  function moveWithinTier(state, list, itemId, direction, pick) {
    const item = list.find((x) => x.id === itemId);
    if (!item) return state;
    const s = clone(state);
    const target = pick(s);
    const siblings = target.filter((x) => x.tierId === item.tierId);
    const i = siblings.findIndex((x) => x.id === itemId);
    const j = i + direction;
    if (j < 0 || j >= siblings.length) return state;
    const a = target.indexOf(siblings[i]);
    const b = target.indexOf(siblings[j]);
    [target[a], target[b]] = [target[b], target[a]];
    return s;
  }

  // ---- A day's plan ------------------------------------------------------

  function planFor(state, date) {
    return state.plans[date] || [];
  }

  function hasPlan(state, date) {
    return Array.isArray(state.plans[date]);
  }

  function planForTier(state, date, tierId) {
    return planFor(state, date).filter((it) => it.tierId === tierId);
  }

  // Most recent date on or before `before` that has a plan.
  function lastPlannedDate(state, before, lookback) {
    for (let i = 1; i <= (lookback || 30); i++) {
      const d = shiftDateKey(before, -i);
      if (hasPlan(state, d) && planFor(state, d).length) return d;
    }
    return null;
  }

  function setPlan(state, date, items) {
    const s = clone(state);
    const tierIds = new Set(s.tiers.map((t) => t.id));
    s.plans[date] = cleanItems(items, tierIds);
    return s;
  }

  // Copy the usual list into a day, giving each item a fresh id so editing
  // tomorrow never rewrites the template.
  function seedPlanFromTemplate(state, date) {
    return setPlan(state, date, state.template.map((it) => ({ ...it, id: uid('i') })));
  }

  function seedPlanFromDate(state, date, sourceDate) {
    return setPlan(state, date, planFor(state, sourceDate).map((it) => ({ ...it, id: uid('i') })));
  }

  function clearPlan(state, date) {
    if (!hasPlan(state, date)) return state;
    const s = clone(state);
    delete s.plans[date];
    for (const l of s.logs) if (l.date === date) l.itemId = null;
    return s;
  }

  function addPlanItem(state, date, tierId, title, note) {
    const trimmed = String(title || '').trim();
    if (!trimmed || !state.tiers.some((t) => t.id === tierId)) return state;
    const s = clone(state);
    if (!s.plans[date]) s.plans[date] = [];
    s.plans[date].push({ id: uid('i'), tierId, title: trimmed, note: String(note || '').trim() });
    return s;
  }

  function updatePlanItem(state, date, itemId, fields) {
    const s = clone(state);
    const it = (s.plans[date] || []).find((x) => x.id === itemId);
    if (!it) return state;
    if (typeof fields.title === 'string' && fields.title.trim()) it.title = fields.title.trim();
    if (typeof fields.note === 'string') it.note = fields.note.trim();
    if (typeof fields.tierId === 'string' && s.tiers.some((t) => t.id === fields.tierId) && fields.tierId !== it.tierId) {
      it.tierId = fields.tierId;
      for (const l of s.logs) if (l.date === date && l.itemId === itemId) l.tierId = it.tierId;
    }
    return s;
  }

  function movePlanItem(state, date, itemId, direction) {
    return moveWithinTier(state, planFor(state, date), itemId, direction, (s) => s.plans[date]);
  }

  // Dropping an item from a day's list keeps anything already booked under
  // it: those entries fall back to the category.
  function removePlanItem(state, date, itemId) {
    if (!planFor(state, date).some((it) => it.id === itemId)) return state;
    const s = clone(state);
    s.plans[date] = s.plans[date].filter((it) => it.id !== itemId);
    for (const l of s.logs) if (l.date === date && l.itemId === itemId) l.itemId = null;
    return s;
  }

  // Add a one-off item to a day's list and keep it for future days too.
  function promoteToTemplate(state, date, itemId) {
    const it = planFor(state, date).find((x) => x.id === itemId);
    if (!it) return state;
    if (state.template.some((t) => t.tierId === it.tierId && t.title === it.title)) return state;
    const s = clone(state);
    s.template.push({ id: uid('u'), tierId: it.tierId, title: it.title, note: it.note });
    return s;
  }

  // ---- Entries ("I did this for that priority") --------------------------

  // `target` is an item id within that day's plan, or a category id.
  function resolveTarget(state, date, target) {
    if (!target) return null;
    const it = planFor(state, date).find((x) => x.id === target);
    if (it) return { tierId: it.tierId, itemId: it.id };
    if (state.tiers.some((t) => t.id === target)) return { tierId: target, itemId: null };
    return null;
  }

  function addLog(state, date, target, text, now) {
    const where = resolveTarget(state, date, target);
    if (!where) return state;
    const s = clone(state);
    s.logs.push({
      id: uid('l'),
      date,
      tierId: where.tierId,
      itemId: where.itemId,
      text: String(text || '').trim(),
      at: typeof now === 'number' ? now : Date.now(),
    });
    return s;
  }

  function moveLog(state, logId, target) {
    const l = state.logs.find((x) => x.id === logId);
    if (!l) return state;
    const where = resolveTarget(state, l.date, target);
    if (!where) return state;
    const s = clone(state);
    const moved = s.logs.find((x) => x.id === logId);
    moved.tierId = where.tierId;
    moved.itemId = where.itemId;
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

  function logsForItem(state, date, itemId) {
    return logsForDate(state, date).filter((l) => l.itemId === itemId);
  }

  function logsForTier(state, date, tierId) {
    return logsForDate(state, date).filter((l) => l.tierId === tierId);
  }

  // Entries booked under a category rather than against a listed priority.
  function offListLogs(state, date, tierId) {
    return logsForTier(state, date, tierId).filter((l) => !l.itemId);
  }

  // ---- Evening check-in --------------------------------------------------

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

  function daySummary(state, date) {
    const logs = logsForDate(state, date);
    const plan = planFor(state, date);
    const reflection = state.reflections[date] || null;
    const tiers = state.tiers.map((tier) => {
      const items = plan.filter((it) => it.tierId === tier.id);
      const tierLogs = logs.filter((l) => l.tierId === tier.id);
      const done = items.filter((it) => tierLogs.some((l) => l.itemId === it.id)).length;
      return {
        tierId: tier.id,
        name: tier.name,
        planned: items.length,
        done,
        logCount: tierLogs.length,
        offList: tierLogs.filter((l) => !l.itemId).length,
        active: tierLogs.length > 0,
        score: reflection && reflection.tierScores[tier.id] ? reflection.tierScores[tier.id] : null,
      };
    });
    const scored = tiers.filter((t) => t.score !== null);
    return {
      date,
      tiers,
      hasPlan: hasPlan(state, date),
      planned: plan.length,
      done: tiers.reduce((a, t) => a + t.done, 0),
      logCount: logs.length,
      offList: tiers.reduce((a, t) => a + t.offList, 0),
      activeTiers: tiers.filter((t) => t.active).length,
      reflection,
      avgScore: scored.length ? scored.reduce((a, t) => a + t.score, 0) / scored.length : null,
    };
  }

  // Listed priorities with nothing booked against them.
  function untouchedItems(state, date) {
    const logs = logsForDate(state, date);
    return planFor(state, date).filter((it) => !logs.some((l) => l.itemId === it.id));
  }

  // The highest category on the ladder with nothing booked today.
  function firstNeglectedTier(state, date) {
    return daySummary(state, date).tiers.find((t) => !t.active) || null;
  }

  // The failure mode this app exists for: a lower category got attention
  // while a higher one got none.
  function inversions(state, date) {
    const tiers = daySummary(state, date).tiers;
    const out = [];
    for (let i = 0; i < tiers.length; i++) {
      if (tiers[i].active) continue;
      const lower = tiers.slice(i + 1).find((t) => t.active);
      if (lower) out.push({ neglected: tiers[i], favored: lower });
    }
    return out;
  }

  function history(state, today, days) {
    const out = [];
    for (let i = 0; i < days; i++) {
      const date = shiftDateKey(today, -i);
      const s = daySummary(state, date);
      if (s.logCount > 0 || s.reflection || s.planned > 0) out.push(s);
    }
    return out;
  }

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
    addTemplateItem,
    updateTemplateItem,
    moveTemplateItem,
    removeTemplateItem,
    planFor,
    hasPlan,
    planForTier,
    lastPlannedDate,
    setPlan,
    seedPlanFromTemplate,
    seedPlanFromDate,
    clearPlan,
    addPlanItem,
    updatePlanItem,
    movePlanItem,
    removePlanItem,
    promoteToTemplate,
    addLog,
    moveLog,
    removeLog,
    logsForDate,
    logsForItem,
    logsForTier,
    offListLogs,
    saveReflection,
    daySummary,
    untouchedItems,
    firstNeglectedTier,
    inversions,
    history,
    streak,
  };
});
