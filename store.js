/*
 * Pure state logic for the priorities tracker.
 *
 * The model, in the user's words: each night you set a numbered list of
 * priorities for the next day. The next day you say "I did this for that
 * priority" and it books in. Everything saves by day.
 *
 * So a day owns an ordered list of priorities, and that list changes from
 * day to day. Entries book against a priority on that day's list, or sit
 * off the list when you did something that was never on it.
 *
 * An optional area tag on a priority (God, Family, Work...) carries across
 * days, so growth in an area can be read over time. It is never required.
 *
 * No DOM, no storage. Every mutator returns a new state object. Loaded as a
 * classic script in the browser (window.PriorityStore) and via require() in
 * Node for tests.
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.PriorityStore = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const SCHEMA_VERSION = 3;

  function uid(prefix) {
    return prefix + '_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  }

  function pad(n) {
    return n < 10 ? '0' + n : String(n);
  }

  function dateKey(d) {
    const dt = d instanceof Date ? d : new Date(d);
    return dt.getFullYear() + '-' + pad(dt.getMonth() + 1) + '-' + pad(dt.getDate());
  }

  function shiftDateKey(key, days) {
    const [y, m, d] = key.split('-').map(Number);
    return dateKey(new Date(y, m - 1, d + days));
  }

  const DEFAULT_DAY_START = 4;

  // Which day it is for a person, not for a clock. Anything recorded before
  // the day-start hour still belongs to the day that has not been slept on,
  // so a list set at 1am lands on the evening it was actually set.
  function dayKeyNow(startHour, now) {
    const d = now === undefined || now === null ? new Date() : new Date(now);
    const start = typeof startHour === 'number' ? startHour : DEFAULT_DAY_START;
    const key = dateKey(d);
    return d.getHours() < start ? shiftDateKey(key, -1) : key;
  }

  function dayStartHour(state) {
    const v = state && state.settings ? Number(state.settings.dayStartHour) : NaN;
    return Number.isInteger(v) && v >= 0 && v <= 12 ? v : DEFAULT_DAY_START;
  }

  function setDayStartHour(state, hour) {
    const v = Number(hour);
    if (!Number.isInteger(v) || v < 0 || v > 12) return state;
    const s = clone(state);
    s.settings = Object.assign({}, s.settings, { dayStartHour: v });
    return s;
  }

  function clone(state) {
    return JSON.parse(JSON.stringify(state));
  }

  function createDefaultState() {
    return {
      version: SCHEMA_VERSION,
      settings: { dayStartHour: DEFAULT_DAY_START },
      areas: [],
      template: [],
      plans: {},
      logs: [],
      reflections: {},
    };
  }

  function cleanItems(rawItems, areaIds) {
    const out = [];
    for (const it of Array.isArray(rawItems) ? rawItems : []) {
      if (!it || typeof it.id !== 'string' || typeof it.title !== 'string') continue;
      const areaId = typeof it.areaId === 'string' ? it.areaId : (typeof it.tierId === 'string' ? it.tierId : null);
      out.push({
        id: it.id,
        title: it.title,
        note: typeof it.note === 'string' ? it.note : '',
        areaId: areaId && areaIds.has(areaId) ? areaId : null,
      });
    }
    return out;
  }

  // Accepts version 1 (one standing list), version 2 (per-day plans grouped
  // under categories) and version 3. Older shapes are converted, never lost.
  function normalize(raw) {
    if (!raw || typeof raw !== 'object') return null;

    const rawAreas = Array.isArray(raw.areas) ? raw.areas : (Array.isArray(raw.tiers) ? raw.tiers : null);
    if (!rawAreas) return null;
    const areas = rawAreas
      .filter((a) => a && typeof a.id === 'string' && typeof a.name === 'string')
      .map((a) => ({ id: a.id, name: a.name }));
    const areaIds = new Set(areas.map((a) => a.id));
    const areaName = new Map(areas.map((a) => [a.id, a.name]));

    const legacyV1 = !Array.isArray(raw.template) && Array.isArray(raw.priorities);
    const template = cleanItems(legacyV1 ? raw.priorities : raw.template, areaIds);
    if (!legacyV1 && !Array.isArray(raw.template) && !Array.isArray(raw.priorities)) return null;

    const plans = {};
    if (raw.plans && typeof raw.plans === 'object') {
      for (const date of Object.keys(raw.plans)) plans[date] = cleanItems(raw.plans[date], areaIds);
    }

    const rawLogs = Array.isArray(raw.logs) ? raw.logs : [];

    // Version 1 had no per-day plans: the standing list applied every day.
    if (legacyV1) {
      const dates = new Set();
      for (const l of rawLogs) if (l && typeof l.date === 'string') dates.add(l.date);
      if (raw.reflections && typeof raw.reflections === 'object') {
        for (const d of Object.keys(raw.reflections)) dates.add(d);
      }
      for (const d of dates) if (!plans[d]) plans[d] = template.map((it) => ({ ...it }));
    }

    // Version 2 let an entry sit on a category with no priority of its own.
    // A day's categories were effectively that day's list, so turn each one
    // that carries such entries into a real priority, keeping category order.
    const byDateArea = new Map();
    for (const l of rawLogs) {
      if (!l || typeof l.date !== 'string') continue;
      const itemId = typeof l.itemId === 'string' ? l.itemId : (typeof l.priorityId === 'string' ? l.priorityId : null);
      const plan = plans[l.date] || [];
      if (itemId && plan.some((it) => it.id === itemId)) continue;
      const areaId = typeof l.tierId === 'string' ? l.tierId : (typeof l.areaId === 'string' ? l.areaId : null);
      if (!areaId || !areaIds.has(areaId)) continue;
      if (!byDateArea.has(l.date)) byDateArea.set(l.date, new Set());
      byDateArea.get(l.date).add(areaId);
    }
    const promoted = new Map(); // date -> (areaId -> new item id)
    for (const [date, ids] of byDateArea) {
      if (!plans[date]) plans[date] = [];
      const map = new Map();
      // Follow the order the areas are declared in, which is the order the
      // list was kept in.
      for (const area of areas) {
        if (!ids.has(area.id)) continue;
        const existing = plans[date].find((it) => it.areaId === area.id && it.title === areaName.get(area.id));
        const item = existing || { id: uid('i'), title: areaName.get(area.id), note: '', areaId: area.id };
        if (!existing) plans[date].push(item);
        map.set(area.id, item.id);
      }
      promoted.set(date, map);
    }

    const logs = [];
    for (const l of rawLogs) {
      if (!l || typeof l.id !== 'string' || typeof l.date !== 'string') continue;
      const plan = plans[l.date] || [];
      const wanted = typeof l.itemId === 'string' ? l.itemId : (typeof l.priorityId === 'string' ? l.priorityId : null);
      let item = wanted ? plan.find((it) => it.id === wanted) : null;
      if (!item) {
        const areaId = typeof l.tierId === 'string' ? l.tierId : (typeof l.areaId === 'string' ? l.areaId : null);
        const mapped = areaId && promoted.get(l.date) ? promoted.get(l.date).get(areaId) : null;
        if (mapped) item = plan.find((it) => it.id === mapped) || null;
      }
      logs.push({
        id: l.id,
        date: l.date,
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
        const scores = {};
        const rawScores = r.scores && typeof r.scores === 'object' ? r.scores : null;
        if (rawScores) {
          const plan = plans[key] || [];
          for (const id of Object.keys(rawScores)) {
            const v = Number(rawScores[id]);
            if (plan.some((it) => it.id === id) && v >= 1 && v <= 5) scores[id] = v;
          }
        }
        reflections[key] = {
          scores,
          crowdedOut: typeof r.crowdedOut === 'string' ? r.crowdedOut : '',
          note: typeof r.note === 'string' ? r.note : '',
          savedAt: typeof r.savedAt === 'number' ? r.savedAt : 0,
        };
      }
    }

    const rawStart = raw.settings ? Number(raw.settings.dayStartHour) : NaN;
    const settings = {
      dayStartHour: Number.isInteger(rawStart) && rawStart >= 0 && rawStart <= 12 ? rawStart : DEFAULT_DAY_START,
    };

    return { version: SCHEMA_VERSION, settings, areas, template, plans, logs, reflections };
  }

  // ---- Areas (optional tags that carry across days) ----------------------

  function addArea(state, name) {
    const trimmed = String(name || '').trim();
    if (!trimmed) return state;
    const s = clone(state);
    s.areas.push({ id: uid('a'), name: trimmed });
    return s;
  }

  function renameArea(state, areaId, name) {
    const trimmed = String(name || '').trim();
    if (!trimmed) return state;
    const s = clone(state);
    const a = s.areas.find((x) => x.id === areaId);
    if (!a) return state;
    a.name = trimmed;
    return s;
  }

  // Removing an area clears the tag; it never deletes a priority or entry.
  function removeArea(state, areaId) {
    if (!state.areas.some((a) => a.id === areaId)) return state;
    const s = clone(state);
    s.areas = s.areas.filter((a) => a.id !== areaId);
    for (const it of s.template) if (it.areaId === areaId) it.areaId = null;
    for (const date of Object.keys(s.plans)) {
      for (const it of s.plans[date]) if (it.areaId === areaId) it.areaId = null;
    }
    return s;
  }

  function areaName(state, areaId) {
    const a = state.areas.find((x) => x.id === areaId);
    return a ? a.name : '';
  }

  // ---- The usual list (seeds a new day) ----------------------------------

  function addTemplateItem(state, title, note, areaId) {
    const trimmed = String(title || '').trim();
    if (!trimmed) return state;
    const s = clone(state);
    s.template.push({
      id: uid('u'),
      title: trimmed,
      note: String(note || '').trim(),
      areaId: areaId && s.areas.some((a) => a.id === areaId) ? areaId : null,
    });
    return s;
  }

  function updateTemplateItem(state, itemId, fields) {
    const s = clone(state);
    const it = s.template.find((x) => x.id === itemId);
    if (!it) return state;
    applyFields(s, it, fields);
    return s;
  }

  function moveTemplateItem(state, itemId, direction) {
    const s = clone(state);
    return swap(s, s.template, itemId, direction) ? s : state;
  }

  function removeTemplateItem(state, itemId) {
    if (!state.template.some((it) => it.id === itemId)) return state;
    const s = clone(state);
    s.template = s.template.filter((it) => it.id !== itemId);
    return s;
  }

  function applyFields(s, item, fields) {
    if (typeof fields.title === 'string' && fields.title.trim()) item.title = fields.title.trim();
    if (typeof fields.note === 'string') item.note = fields.note.trim();
    if ('areaId' in fields) {
      const v = fields.areaId;
      item.areaId = v && s.areas.some((a) => a.id === v) ? v : null;
    }
  }

  function swap(s, list, itemId, direction) {
    const i = list.findIndex((x) => x.id === itemId);
    const j = i + direction;
    if (i < 0 || j < 0 || j >= list.length) return false;
    [list[i], list[j]] = [list[j], list[i]];
    return true;
  }

  // ---- A day's ordered list ----------------------------------------------

  function planFor(state, date) {
    return state.plans[date] || [];
  }

  function hasPlan(state, date) {
    return Array.isArray(state.plans[date]);
  }

  function lastPlannedDate(state, before, lookback) {
    for (let i = 1; i <= (lookback || 30); i++) {
      const d = shiftDateKey(before, -i);
      if (planFor(state, d).length) return d;
    }
    return null;
  }

  function setPlan(state, date, items) {
    const s = clone(state);
    s.plans[date] = cleanItems(items, new Set(s.areas.map((a) => a.id)));
    return s;
  }

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
    if (s.reflections[date]) s.reflections[date].scores = {};
    return s;
  }

  function addPlanItem(state, date, title, note, areaId) {
    const trimmed = String(title || '').trim();
    if (!trimmed) return state;
    const s = clone(state);
    if (!s.plans[date]) s.plans[date] = [];
    s.plans[date].push({
      id: uid('i'),
      title: trimmed,
      note: String(note || '').trim(),
      areaId: areaId && s.areas.some((a) => a.id === areaId) ? areaId : null,
    });
    return s;
  }

  // Insert at a 1-based position, pushing everything at or below it down.
  function insertPlanItem(state, date, position, title, note, areaId) {
    const next = addPlanItem(state, date, title, note, areaId);
    if (next === state) return state;
    const list = next.plans[date];
    const item = list.pop();
    const at = Math.max(0, Math.min(list.length, Number(position) - 1));
    list.splice(at, 0, item);
    return next;
  }

  function updatePlanItem(state, date, itemId, fields) {
    const s = clone(state);
    const it = (s.plans[date] || []).find((x) => x.id === itemId);
    if (!it) return state;
    applyFields(s, it, fields);
    return s;
  }

  function movePlanItem(state, date, itemId, direction) {
    const s = clone(state);
    return swap(s, s.plans[date] || [], itemId, direction) ? s : state;
  }

  // Dropping a priority keeps what was booked against it: those entries move
  // off the list rather than disappearing.
  function removePlanItem(state, date, itemId) {
    if (!planFor(state, date).some((it) => it.id === itemId)) return state;
    const s = clone(state);
    s.plans[date] = s.plans[date].filter((it) => it.id !== itemId);
    for (const l of s.logs) if (l.date === date && l.itemId === itemId) l.itemId = null;
    if (s.reflections[date]) delete s.reflections[date].scores[itemId];
    return s;
  }

  function promoteToTemplate(state, date, itemId) {
    const it = planFor(state, date).find((x) => x.id === itemId);
    if (!it) return state;
    if (state.template.some((t) => t.title === it.title)) return state;
    const s = clone(state);
    s.template.push({ id: uid('u'), title: it.title, note: it.note, areaId: it.areaId });
    return s;
  }

  // ---- Entries ------------------------------------------------------------

  // `itemId` names a priority on that day's list; null books it off the list.
  function addLog(state, date, itemId, text, now) {
    if (itemId && !planFor(state, date).some((it) => it.id === itemId)) return state;
    const s = clone(state);
    s.logs.push({
      id: uid('l'),
      date,
      itemId: itemId || null,
      text: String(text || '').trim(),
      at: typeof now === 'number' ? now : Date.now(),
    });
    return s;
  }

  function moveLog(state, logId, itemId) {
    const l = state.logs.find((x) => x.id === logId);
    if (!l) return state;
    if (itemId && !planFor(state, l.date).some((it) => it.id === itemId)) return state;
    const s = clone(state);
    s.logs.find((x) => x.id === logId).itemId = itemId || null;
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

  function offListLogs(state, date) {
    return logsForDate(state, date).filter((l) => !l.itemId);
  }

  // ---- Evening check-in ---------------------------------------------------

  function saveReflection(state, date, fields, now) {
    const s = clone(state);
    const prev = s.reflections[date] || { scores: {}, crowdedOut: '', note: '', savedAt: 0 };
    const scores = { ...prev.scores };
    if (fields.scores && typeof fields.scores === 'object') {
      const plan = planFor(s, date);
      for (const id of Object.keys(fields.scores)) {
        const v = Number(fields.scores[id]);
        if (plan.some((it) => it.id === id) && v >= 1 && v <= 5) scores[id] = v;
        else delete scores[id];
      }
    }
    s.reflections[date] = {
      scores,
      crowdedOut: typeof fields.crowdedOut === 'string' ? fields.crowdedOut.trim() : prev.crowdedOut,
      note: typeof fields.note === 'string' ? fields.note.trim() : prev.note,
      savedAt: typeof now === 'number' ? now : Date.now(),
    };
    return s;
  }

  // ---- Summaries ----------------------------------------------------------

  function daySummary(state, date) {
    const logs = logsForDate(state, date);
    const reflection = state.reflections[date] || null;
    const items = planFor(state, date).map((it, i) => {
      const own = logs.filter((l) => l.itemId === it.id);
      return {
        item: it,
        position: i + 1,
        logs: own,
        done: own.length > 0,
        score: reflection && reflection.scores[it.id] ? reflection.scores[it.id] : null,
      };
    });
    const offList = logs.filter((l) => !l.itemId);
    return {
      date,
      items,
      offList,
      hasPlan: hasPlan(state, date),
      planned: items.length,
      done: items.filter((x) => x.done).length,
      logCount: logs.length,
      reflection,
    };
  }

  function untouchedItems(state, date) {
    return daySummary(state, date).items.filter((x) => !x.done).map((x) => x.item);
  }

  // The failure mode this exists for: something further down the list got
  // attention while something above it got none.
  function inversions(state, date) {
    const items = daySummary(state, date).items;
    const out = [];
    for (let i = 0; i < items.length; i++) {
      if (items[i].done) continue;
      const lower = items.slice(i + 1).find((x) => x.done);
      if (lower) out.push({ neglected: items[i], favored: lower });
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
    dayKeyNow,
    dayStartHour,
    setDayStartHour,
    DEFAULT_DAY_START,
    createDefaultState,
    normalize,
    addArea,
    renameArea,
    removeArea,
    areaName,
    addTemplateItem,
    updateTemplateItem,
    moveTemplateItem,
    removeTemplateItem,
    planFor,
    hasPlan,
    lastPlannedDate,
    setPlan,
    seedPlanFromTemplate,
    seedPlanFromDate,
    clearPlan,
    addPlanItem,
    insertPlanItem,
    updatePlanItem,
    movePlanItem,
    removePlanItem,
    promoteToTemplate,
    addLog,
    moveLog,
    removeLog,
    logsForDate,
    logsForItem,
    offListLogs,
    saveReflection,
    daySummary,
    untouchedItems,
    inversions,
    history,
    streak,
  };
});
