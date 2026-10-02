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
      standing: [],
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
        const orderNotes = [];
        for (const n of Array.isArray(r.orderNotes) ? r.orderNotes : []) {
          if (!n || typeof n.id !== 'string' || typeof n.text !== 'string') continue;
          orderNotes.push({
            id: n.id,
            text: n.text,
            at: typeof n.at === 'number' ? n.at : 0,
            auto: Boolean(n.auto),
          });
        }
        reflections[key] = {
          scores,
          orderNotes,
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

    const standing = [];
    for (const n of Array.isArray(raw.standing) ? raw.standing : []) {
      if (!n || typeof n.id !== 'string' || typeof n.title !== 'string') continue;
      standing.push({ id: n.id, title: n.title, body: typeof n.body === 'string' ? n.body : '' });
    }

    return { version: SCHEMA_VERSION, settings, standing, areas, template, plans, logs, reflections };
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

  // ---- Standing commitments ----------------------------------------------
  //
  // Things that hold every day and are not worked through like a list item,
  // so they never take a number or push a priority down.

  function addStanding(state, title, body) {
    const trimmed = String(title || '').trim();
    if (!trimmed) return state;
    const s = clone(state);
    s.standing.push({ id: uid('s'), title: trimmed, body: String(body || '').trim() });
    return s;
  }

  function updateStanding(state, id, fields) {
    const s = clone(state);
    const n = s.standing.find((x) => x.id === id);
    if (!n) return state;
    if (typeof fields.title === 'string' && fields.title.trim()) n.title = fields.title.trim();
    if (typeof fields.body === 'string') n.body = fields.body.trim();
    return s;
  }

  function moveStanding(state, id, direction) {
    const s = clone(state);
    return swap(s, s.standing, id, direction) ? s : state;
  }

  function removeStanding(state, id) {
    if (!state.standing.some((n) => n.id === id)) return state;
    const s = clone(state);
    s.standing = s.standing.filter((n) => n.id !== id);
    return s;
  }

  // ---- Order notes --------------------------------------------------------
  //
  // A live inversion disappears the moment the skipped priority gets an
  // entry, so what actually happened has to be written down when it happens.
  // These notes are that record, and they stay editable.

  function ensureReflection(s, date) {
    const prev = s.reflections[date];
    if (!prev) s.reflections[date] = { scores: {}, orderNotes: [], crowdedOut: '', note: '', savedAt: 0 };
    else if (!Array.isArray(prev.orderNotes)) prev.orderNotes = [];
    return s.reflections[date];
  }

  function orderNotesFor(state, date) {
    const r = state.reflections[date];
    return r && Array.isArray(r.orderNotes) ? r.orderNotes : [];
  }

  function addOrderNote(state, date, text, opts, now) {
    const trimmed = String(text || '').trim();
    if (!trimmed) return state;
    const s = clone(state);
    ensureReflection(s, date).orderNotes.push({
      id: uid('n'),
      text: trimmed,
      at: typeof now === 'number' ? now : Date.now(),
      auto: Boolean(opts && opts.auto),
    });
    return s;
  }

  function updateOrderNote(state, date, noteId, text) {
    const trimmed = String(text || '').trim();
    if (!trimmed) return state;
    const s = clone(state);
    const n = orderNotesFor(s, date).find((x) => x.id === noteId);
    if (!n) return state;
    n.text = trimmed;
    return s;
  }

  function removeOrderNote(state, date, noteId) {
    if (!orderNotesFor(state, date).some((n) => n.id === noteId)) return state;
    const s = clone(state);
    s.reflections[date].orderNotes = s.reflections[date].orderNotes.filter((n) => n.id !== noteId);
    return s;
  }

  // What to write down when a priority is worked while higher ones are still
  // empty. Returns null when nothing above it was skipped.
  function describeSkippedAbove(state, date, itemId) {
    const items = daySummary(state, date).items;
    const idx = items.findIndex((e) => e.item.id === itemId);
    if (idx < 0) return null;
    const above = items.slice(0, idx).filter((e) => !e.done);
    if (!above.length) return null;
    const me = items[idx];
    const names = above.map((e) => '#' + e.position + ' ' + e.item.title);
    const shown = names.slice(0, 3).join(', ');
    const extra = names.length > 3 ? ' and ' + (names.length - 3) + ' more' : '';
    return 'Worked #' + me.position + ' ' + me.item.title + ' while ' + shown + extra + ' had nothing yet.';
  }

  // ---- Merging in a day from elsewhere ------------------------------------
  //
  // Bringing a prepared day into a browser that is already in use. Only days
  // with no list of their own are added, so nothing already recorded can be
  // overwritten. Areas and standing commitments are matched by name so they
  // are never duplicated.

  function plansAvailableFrom(state, other) {
    if (!other || !other.plans) return [];
    return Object.keys(other.plans)
      .filter((date) => (other.plans[date] || []).length && !planFor(state, date).length)
      .sort();
  }

  // `onlyDates` limits the merge to particular days, for offering a single
  // day where the user is standing rather than all of them at once.
  function addPlansFrom(state, other, onlyDates) {
    const wanted = onlyDates ? new Set(onlyDates) : null;
    const dates = plansAvailableFrom(state, other).filter((d) => !wanted || wanted.has(d));
    const newStanding = (other && other.standing ? other.standing : [])
      .filter((n) => !state.standing.some((x) => x.title.toLowerCase() === n.title.toLowerCase()));
    if (!dates.length && !newStanding.length) return state;

    const s = clone(state);
    const byName = new Map(s.areas.map((a) => [a.name.toLowerCase(), a.id]));
    const remap = new Map();
    for (const a of (other.areas || [])) {
      const key = a.name.toLowerCase();
      if (!byName.has(key)) {
        const id = uid('a');
        s.areas.push({ id, name: a.name });
        byName.set(key, id);
      }
      remap.set(a.id, byName.get(key));
    }

    for (const n of newStanding) {
      s.standing.push({ id: uid('s'), title: n.title, body: n.body });
    }

    for (const date of dates) {
      s.plans[date] = other.plans[date].map((it) => ({
        id: it.id,
        title: it.title,
        note: it.note,
        areaId: it.areaId && remap.has(it.areaId) ? remap.get(it.areaId) : null,
      }));
    }
    return s;
  }

  // Copy a prepared list onto a different day, with fresh ids so the two days
  // stay independent. Used when a list was filed against the wrong date.
  function copyPlanFrom(state, other, fromDate, toDate) {
    const theirs = other && other.plans ? other.plans[fromDate] : null;
    if (!theirs || !theirs.length) return state;
    const s = clone(state);
    const byName = new Map(s.areas.map((a) => [a.name.toLowerCase(), a.id]));
    const remap = new Map();
    for (const a of (other.areas || [])) {
      const key = a.name.toLowerCase();
      if (!byName.has(key)) {
        const id = uid('a');
        s.areas.push({ id, name: a.name });
        byName.set(key, id);
      }
      remap.set(a.id, byName.get(key));
    }
    s.plans[toDate] = theirs.map((it) => ({
      id: uid('i'),
      title: it.title,
      note: it.note,
      areaId: it.areaId && remap.has(it.areaId) ? remap.get(it.areaId) : null,
    }));
    return s;
  }

  // Dates where both sides hold a list and the two differ. These are the days
  // a revision would change, so they are offered separately and never applied
  // without being asked for.
  function plansDifferingFrom(state, other) {
    if (!other || !other.plans) return [];
    return Object.keys(other.plans).filter((date) => {
      const mine = planFor(state, date);
      const theirs = other.plans[date] || [];
      if (!mine.length || !theirs.length) return false;
      if (mine.length !== theirs.length) return true;
      return mine.some((it, i) => it.title !== theirs[i].title || it.note !== theirs[i].note);
    }).sort();
  }

  // Swap in a revised list for one day. Entries are re-attached by id, then by
  // title; anything left over moves off the list rather than being deleted.
  function replacePlanFrom(state, other, date) {
    const theirs = other && other.plans ? other.plans[date] : null;
    if (!theirs || !theirs.length) return state;

    const s = clone(state);
    const byName = new Map(s.areas.map((a) => [a.name.toLowerCase(), a.id]));
    const remap = new Map();
    for (const a of (other.areas || [])) {
      const key = a.name.toLowerCase();
      if (!byName.has(key)) {
        const id = uid('a');
        s.areas.push({ id, name: a.name });
        byName.set(key, id);
      }
      remap.set(a.id, byName.get(key));
    }

    const oldTitleById = new Map(planFor(s, date).map((it) => [it.id, it.title]));
    s.plans[date] = theirs.map((it) => ({
      id: it.id,
      title: it.title,
      note: it.note,
      areaId: it.areaId && remap.has(it.areaId) ? remap.get(it.areaId) : null,
    }));

    const ids = new Set(s.plans[date].map((it) => it.id));
    const idByTitle = new Map(s.plans[date].map((it) => [it.title, it.id]));
    for (const l of s.logs) {
      if (l.date !== date || !l.itemId || ids.has(l.itemId)) continue;
      const wasCalled = oldTitleById.get(l.itemId);
      l.itemId = wasCalled && idByTitle.has(wasCalled) ? idByTitle.get(wasCalled) : null;
    }
    if (s.reflections[date]) {
      const scores = {};
      for (const id of Object.keys(s.reflections[date].scores)) {
        if (ids.has(id)) scores[id] = s.reflections[date].scores[id];
      }
      s.reflections[date].scores = scores;
    }
    return s;
  }

  // ---- Evening check-in ---------------------------------------------------

  function saveReflection(state, date, fields, now) {
    const s = clone(state);
    // ensureReflection also guarantees orderNotes exists, so saving a
    // check-in can never quietly drop the day's order record.
    const prev = ensureReflection(s, date);
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
      orderNotes: prev.orderNotes,
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

  // ---- Trends -------------------------------------------------------------

  // Where a priority sat, as a share of its list rather than a raw number, so
  // a day of three and a day of fourteen can be compared. The top of any list
  // is 1; the bottom of a long list sits lower than the bottom of a short one.
  function heightOf(position, length) {
    return length > 0 ? (length - position + 1) / length : 0;
  }

  // Reads back over the days: how often something was listed, how high it was
  // put, and how often anything was actually booked against it. The gap
  // between the second and the third is the thing worth seeing.
  function trends(state, today, days) {
    const span = Math.max(1, days || 30);
    const from = shiftDateKey(today, -(span - 1));
    const inRange = (d) => d >= from && d <= today;

    const seen = new Set();
    for (const d of Object.keys(state.plans)) if (inRange(d)) seen.add(d);
    for (const l of state.logs) if (inRange(l.date)) seen.add(l.date);
    for (const d of Object.keys(state.reflections)) if (inRange(d)) seen.add(d);
    const dates = Array.from(seen).sort();

    const areas = new Map();
    const titles = new Map();
    let daysWithList = 0;
    let daysWithEntries = 0;
    let entries = 0;
    let untagged = 0;

    const blank = () => ({
      label: '', days: new Set(), workedDays: new Set(), appearances: 0,
      entries: 0, posSum: 0, heightSum: 0, topThree: 0,
      lastListed: null, lastWorked: null,
    });

    for (const date of dates) {
      const plan = planFor(state, date);
      const logs = logsForDate(state, date);
      if (plan.length) daysWithList++;
      if (logs.length) {
        daysWithEntries++;
        entries += logs.length;
      }

      for (let i = 0; i < plan.length; i++) {
        const it = plan[i];
        const position = i + 1;
        const own = logs.filter((l) => l.itemId === it.id).length;

        const bump = (map, key, label) => {
          if (!map.has(key)) map.set(key, blank());
          const a = map.get(key);
          a.label = label;
          a.days.add(date);
          a.appearances++;
          a.posSum += position;
          a.heightSum += heightOf(position, plan.length);
          if (position <= 3) a.topThree++;
          a.lastListed = date;
          if (own) {
            a.workedDays.add(date);
            a.entries += own;
            a.lastWorked = date;
          }
        };

        if (it.areaId) bump(areas, it.areaId, areaName(state, it.areaId) || 'Untagged');
        else untagged++;
        bump(titles, it.title.trim().toLowerCase(), it.title.trim());
      }
    }

    const shape = (map) => Array.from(map.entries()).map(([key, a]) => ({
      key,
      name: a.label,
      days: a.days.size,
      workedDays: a.workedDays.size,
      appearances: a.appearances,
      entries: a.entries,
      avgPosition: a.posSum / a.appearances,
      avgHeight: a.heightSum / a.appearances,
      topThree: a.topThree,
      lastListed: a.lastListed,
      lastWorked: a.lastWorked,
    }));

    const byHeight = (x, y) => y.avgHeight - x.avgHeight || y.days - x.days
      || x.name.localeCompare(y.name);

    const areaRows = shape(areas).sort(byHeight);
    const titleRows = shape(titles).sort((x, y) => y.days - x.days || byHeight(x, y));

    // Held high but with nothing booked against it. Only meaningful once some
    // days have entries at all, or it would flag everything.
    const gaps = daysWithEntries
      ? areaRows.filter((r) => r.days >= 2 && r.avgHeight >= 0.5 && r.workedDays === 0)
      : [];

    const orderNotes = [];
    for (const date of dates) {
      for (const n of orderNotesFor(state, date)) orderNotes.push({ date, text: n.text, id: n.id });
    }
    orderNotes.reverse();

    return {
      from: dates.length ? dates[0] : from,
      to: today,
      span,
      dates,
      daysWithList,
      daysWithEntries,
      entries,
      untagged,
      streak: streak(state, today),
      areas: areaRows,
      titles: titleRows,
      gaps,
      orderNotes,
    };
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
    plansAvailableFrom,
    addPlansFrom,
    plansDifferingFrom,
    replacePlanFrom,
    copyPlanFrom,
    addStanding,
    updateStanding,
    moveStanding,
    removeStanding,
    orderNotesFor,
    addOrderNote,
    updateOrderNote,
    removeOrderNote,
    describeSkippedAbove,
    saveReflection,
    daySummary,
    untouchedItems,
    inversions,
    history,
    streak,
    heightOf,
    trends,
  };
});
