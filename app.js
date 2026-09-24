/* UI for the priorities tracker. Depends on window.PriorityStore (store.js). */
(function () {
  'use strict';

  const S = window.PriorityStore;
  const STORAGE_KEY = 'priorities-tracker-v1';
  const UI_KEY = 'priorities-tracker-ui';
  const TABS = ['today', 'tonight', 'history', 'lists'];

  // ---- Persistence -------------------------------------------------------

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = S.normalize(JSON.parse(raw));
        if (parsed) return parsed;
      }
    } catch (e) {
      /* storage unavailable or corrupt: fall through */
    }
    return seedState() || S.createDefaultState();
  }

  function seedState() {
    try {
      return window.PRIORITY_SEED ? S.normalize(window.PRIORITY_SEED) : null;
    } catch (e) {
      return null;
    }
  }

  function persist() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      toast('Could not save. Storage is blocked in this browser.');
    }
  }

  function loadUi() {
    try {
      const raw = localStorage.getItem(UI_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) {
      /* ignore */
    }
    return {};
  }

  function persistUi() {
    try {
      localStorage.setItem(UI_KEY, JSON.stringify({ tab: ui.tab }));
    } catch (e) {
      /* ignore */
    }
  }

  // ---- State -------------------------------------------------------------

  let state = loadState();
  const ui = Object.assign({ tab: 'today' }, loadUi());
  if (!TABS.includes(ui.tab)) ui.tab = 'today';
  ui.date = S.dayKeyNow(S.dayStartHour(state));
  ui.adding = null; // priority id (or 'off') whose entry field is open

  function commit(next) {
    if (next === state) return;
    state = next;
    persist();
    render();
  }

  // ---- Helpers -----------------------------------------------------------

  function h(tag, attrs, ...children) {
    const el = document.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (v === null || v === undefined || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k === 'text') el.textContent = v;
        else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
        else if (k === 'hidden') el.hidden = Boolean(v);
        else el.setAttribute(k, v === true ? '' : v);
      }
    }
    for (const c of children.flat()) {
      if (c === null || c === undefined || c === false) continue;
      el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    }
    return el;
  }

  const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
    'August', 'September', 'October', 'November', 'December'];

  function fmtDate(key) {
    const [y, m, d] = key.split('-').map(Number);
    return WEEKDAYS[new Date(y, m - 1, d).getDay()] + ', ' + MONTHS[m - 1] + ' ' + d;
  }

  function fmtShort(key) {
    const [y, m, d] = key.split('-').map(Number);
    return MONTHS[m - 1].slice(0, 3) + ' ' + d;
  }

  // The current day as the user lives it: before the day-start hour, the
  // previous date is still "today", so a list set at 1am lands correctly.
  function today() {
    return S.dayKeyNow(S.dayStartHour(state));
  }

  function relativeName(key) {
    if (key === today()) return 'today';
    if (key === S.shiftDateKey(today(), 1)) return 'tomorrow';
    if (key === S.shiftDateKey(today(), -1)) return 'yesterday';
    return fmtShort(key);
  }

  let toastTimer = null;
  function toast(msg) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
  }

  // ---- Render root -------------------------------------------------------

  const root = document.getElementById('view');

  function render() {
    renderDatebar();
    for (const btn of document.querySelectorAll('.tabs button')) {
      btn.setAttribute('aria-selected', btn.dataset.tab === ui.tab ? 'true' : 'false');
    }
    root.replaceChildren();
    if (ui.tab === 'today') root.appendChild(renderToday());
    else if (ui.tab === 'tonight') root.appendChild(renderTonight());
    else if (ui.tab === 'history') root.appendChild(renderHistory());
    else root.appendChild(renderLists());

    if (ui.adding) {
      const field = document.getElementById('add-' + ui.adding);
      if (field) field.focus();
    }
  }

  function renderDatebar() {
    const bar = document.getElementById('datebar');
    const parts = [
      h('button', { type: 'button', 'aria-label': 'Previous day', onclick: () => setDate(S.shiftDateKey(ui.date, -1)) }, '‹'),
      h('span', { text: fmtDate(ui.date) }),
      h('button', { type: 'button', 'aria-label': 'Next day', onclick: () => setDate(S.shiftDateKey(ui.date, 1)) }, '›'),
    ];
    if (ui.date !== today()) {
      parts.push(h('button', { type: 'button', class: 'today-link', onclick: () => setDate(today()) }, 'today'));
    }
    bar.replaceChildren(...parts);
  }

  function setDate(key) {
    ui.date = key;
    ui.adding = null;
    render();
  }

  document.querySelector('.tabs').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-tab]');
    if (!btn) return;
    ui.tab = btn.dataset.tab;
    ui.adding = null;
    persistUi();
    render();
  });

  // ---- Today --------------------------------------------------------------

  function renderToday() {
    const date = ui.date;
    const summary = S.daySummary(state, date);

    if (!summary.planned && !summary.logCount) return renderNoList(date);

    const parts = [];

    for (const n of state.standing) {
      parts.push(h('div', { class: 'standing' },
        h('span', { class: 'standing-title', text: n.title }),
        n.body ? h('span', { class: 'standing-body', text: n.body }) : null));
    }

    parts.push(h('p', { class: 'summary', text: summary.done + ' of ' + summary.planned + ' done' }));

    const inv = S.inversions(state, date);
    if (inv.length) {
      const first = inv[0];
      parts.push(h('p', { class: 'alert', text: 'Number ' + first.favored.position + ' got time before number ' + first.neglected.position + '.' }));
    }

    // A revised list for this day belongs here too, not only under Lists.
    const seed = seedState();
    if (seed && S.plansDifferingFrom(state, seed).includes(date)) {
      const revised = seed.plans[date];
      parts.push(h('div', { class: 'revision' },
        h('span', { text: 'A revised list is ready for this day: ' + revised.length + ' priorities.' }),
        h('button', { class: 'btn small', type: 'button', onclick: () => {
          if (!confirm('Update this day to the revised list of ' + revised.length + ' priorities? Everything you have written stays, and anything whose priority is gone moves to the bottom.')) return;
          commit(S.replacePlanFrom(state, seed, date));
          toast('List updated');
        } }, 'Update')));
    }

    const list = h('ol', { class: 'cats' });
    summary.items.forEach((entry) => {
      list.appendChild(renderPriority(entry, date));
    });
    parts.push(list);

    // Anything done that was never on the list.
    const off = summary.offList;
    parts.push(h('div', { class: 'offlist' },
      off.length
        ? h('ul', { class: 'entries' }, off.map((l) => h('li', {},
            h('span', { class: 'bullet off', 'aria-hidden': 'true' }),
            h('span', { class: 'text off', text: l.text || 'did it' }),
            summary.items.length ? bookOntoControl(l, summary.items) : null,
            h('button', { class: 'del', type: 'button', 'aria-label': 'Remove', onclick: () => commit(S.removeLog(state, l.id)) }, '×'))))
        : null,
      ui.adding === 'off'
        ? entryField('off', date, null)
        : h('button', { class: 'add', type: 'button', onclick: () => { ui.adding = 'off'; render(); } },
            off.length ? '+ add another off the list' : '+ something not on the list')));

    parts.push(renderOrderNotes(date));

    return h('div', {}, parts);
  }

  // Put an off-list entry onto one of the day's priorities. Needed whenever a
  // list is revised and an entry's priority is gone.
  function bookOntoControl(log, items) {
    const sel = h('select', { class: 'bookonto', 'aria-label': 'Book onto a priority', id: 'onto-' + log.id });
    sel.appendChild(h('option', { value: '', text: 'book onto…' }));
    for (const e of items) {
      sel.appendChild(h('option', { value: e.item.id, text: e.position + '. ' + e.item.title }));
    }
    sel.addEventListener('change', () => {
      if (sel.value) commit(S.moveLog(state, log.id, sel.value));
    });
    return sel;
  }

  // The record of how the day actually ran, kept and editable.
  function renderOrderNotes(date) {
    const notes = S.orderNotesFor(state, date);
    const wrap = h('div', { class: 'ordernotes' },
      h('p', { class: 'ordernotes-label', text: 'How the order went' }));

    if (!notes.length) {
      wrap.appendChild(h('p', { class: 'lede', text: 'Nothing out of order recorded yet.' }));
    }

    for (const n of notes) {
      const field = h('input', { type: 'text', id: 'on-' + n.id, value: n.text, 'aria-label': 'Order note' });
      field.addEventListener('change', () => {
        if (!field.value.trim()) { field.value = n.text; return; }
        commit(S.updateOrderNote(state, date, n.id, field.value));
      });
      wrap.appendChild(h('div', { class: 'ordernote' },
        field,
        h('button', { class: 'btn icon danger', type: 'button', 'aria-label': 'Remove note', onclick: () => commit(S.removeOrderNote(state, date, n.id)) }, '×')));
    }

    if (ui.adding === 'note') {
      const input = h('input', { type: 'text', id: 'add-note', placeholder: 'Something you noticed about the order', 'aria-label': 'Add an order note', autocomplete: 'off' });
      const save = () => {
        const text = input.value.trim();
        if (!text) { ui.adding = null; render(); return; }
        commit(S.addOrderNote(state, date, text, { auto: false }));
      };
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); save(); }
        if (e.key === 'Escape') { ui.adding = null; render(); }
      });
      wrap.appendChild(h('div', { class: 'addrow' }, input, h('button', { class: 'btn primary', type: 'button', onclick: save }, 'Save')));
    } else {
      wrap.appendChild(h('button', { class: 'add', type: 'button', onclick: () => { ui.adding = 'note'; render(); } }, '+ note something about the order'));
    }

    return wrap;
  }

  function renderPriority(entry, date) {
    const it = entry.item;
    const body = h('div', { class: 'cat-body' });

    if (entry.logs.length) {
      body.appendChild(h('ul', { class: 'entries' }, entry.logs.map((l) => h('li', {},
        h('span', { class: 'bullet', 'aria-hidden': 'true' }),
        h('span', { class: 'text', text: l.text || 'did it' }),
        h('button', { class: 'del', type: 'button', 'aria-label': 'Remove', onclick: () => commit(S.removeLog(state, l.id)) }, '×')))));
    }

    if (ui.adding === it.id) {
      body.appendChild(entryField(it.id, date, it.id));
    } else {
      body.appendChild(h('button', {
        class: 'add', type: 'button',
        onclick: () => { ui.adding = it.id; render(); },
      }, entry.done ? '+ add another' : '+ I did this'));
    }

    return h('li', { class: 'cat ' + (entry.done ? 'done' : '') },
      h('div', { class: 'cat-head' },
        h('span', { class: 'num', text: String(entry.position) }),
        h('div', { class: 'title-wrap' },
          h('h2', { text: it.title }),
          it.note ? h('p', { class: 'prio-note', text: it.note }) : null,
          it.areaId ? h('span', { class: 'area', text: S.areaName(state, it.areaId) }) : null),
        h('span', { class: 'mark', 'aria-hidden': 'true', text: entry.done ? '✓' : '' })),
      body);
  }

  function entryField(key, date, itemId) {
    const input = h('input', {
      type: 'text', id: 'add-' + key, placeholder: 'What did you do?',
      'aria-label': 'What did you do', autocomplete: 'off',
    });
    const save = () => {
      const text = input.value.trim();
      if (!text) { ui.adding = null; render(); return; }
      let next = S.addLog(state, date, itemId, text);
      // Write down the order as it actually went. A live warning vanishes the
      // moment the skipped priority gets an entry, so it has to be recorded.
      if (itemId) {
        const observed = S.describeSkippedAbove(next, date, itemId);
        if (observed) next = S.addOrderNote(next, date, observed, { auto: true });
      }
      commit(next);
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); save(); }
      if (e.key === 'Escape') { ui.adding = null; render(); }
    });
    return h('div', { class: 'addrow' }, input, h('button', { class: 'btn primary', type: 'button', onclick: save }, 'Save'));
  }

  function renderNoList(date) {
    const source = S.lastPlannedDate(state, date, 30);
    const seed = seedState();
    // A list prepared for this very day belongs here, where you are standing,
    // not buried in a settings tab.
    const prepared = seed && S.plansAvailableFrom(state, seed).includes(date) ? seed.plans[date] : null;

    const wrap = h('div', { class: 'section' },
      h('h2', { text: 'No list for ' + relativeName(date) }));

    if (prepared) {
      wrap.appendChild(h('p', { class: 'lede', text: 'A list of ' + prepared.length + ' priorities is ready for this day.' }));
      wrap.appendChild(h('ul', { class: 'preview' }, prepared.slice(0, 3).map((it, i) =>
        h('li', { text: (i + 1) + '. ' + it.title }))));
      if (prepared.length > 3) {
        wrap.appendChild(h('p', { class: 'lede', text: 'and ' + (prepared.length - 3) + ' more.' }));
      }
    } else {
      wrap.appendChild(h('p', { class: 'lede', text: 'You set each day’s priorities the night before. Build one now if you want.' }));
    }

    wrap.appendChild(h('div', { class: 'actions', style: 'margin-top:14px' },
      prepared
        ? h('button', { class: 'btn primary', type: 'button', onclick: () => {
            commit(S.addPlansFrom(state, seed, [date]));
            toast('List added');
          } }, 'Use this list')
        : null,
      state.template.length
        ? h('button', { class: 'btn ' + (prepared ? '' : 'primary'), type: 'button', onclick: () => commit(S.seedPlanFromTemplate(state, date)) }, 'Use my usual list')
        : null,
      source
        ? h('button', { class: 'btn', type: 'button', onclick: () => commit(S.seedPlanFromDate(state, date, source)) }, 'Copy ' + fmtShort(source))
        : null,
      h('button', { class: 'btn', type: 'button', onclick: () => { ui.tab = 'tonight'; ui.date = S.shiftDateKey(date, -1); persistUi(); render(); } }, 'Set it now')));

    return wrap;
  }

  // ---- Tonight ------------------------------------------------------------

  function renderTonight() {
    const date = ui.date;
    return h('div', {}, renderPlanner(S.shiftDateKey(date, 1), date), renderCheckin(date));
  }

  function renderPlanner(target, from) {
    const items = S.planFor(state, target);

    const wrap = h('div', { class: 'section' },
      h('h2', { text: 'Priorities for ' + relativeName(target) }),
      h('p', { class: 'lede', text: 'In order. Number one is what wins the day.' }));

    const seedActions = [];
    if (S.planFor(state, from).length) {
      seedActions.push(h('button', { class: 'btn small', type: 'button', onclick: () => {
        if (!items.length || confirm('Replace the list for ' + relativeName(target) + '?')) {
          commit(S.seedPlanFromDate(state, target, from));
          toast('Copied ' + relativeName(from));
        }
      } }, 'Copy ' + relativeName(from)));
    }
    if (state.template.length) {
      seedActions.push(h('button', { class: 'btn small', type: 'button', onclick: () => {
        if (!items.length || confirm('Replace the list for ' + relativeName(target) + '?')) {
          commit(S.seedPlanFromTemplate(state, target));
          toast('Loaded your usual list');
        }
      } }, 'Use usual list'));
    }
    if (seedActions.length) wrap.appendChild(h('div', { class: 'actions', style: 'margin-top:12px' }, seedActions));

    const list = h('ol', { class: 'plan-list' }, items.map((it, i) => {
      const title = h('input', { type: 'text', id: 'plan-' + it.id, value: it.title, 'aria-label': 'Priority ' + (i + 1) });
      title.addEventListener('change', () => commit(S.updatePlanItem(state, target, it.id, { title: title.value })));
      return h('li', { class: 'plan-item' },
        h('span', { class: 'num', text: String(i + 1) }),
        title,
        h('div', { class: 'ctl' },
          h('button', { class: 'btn icon', type: 'button', 'aria-label': 'Move up', disabled: i === 0, onclick: () => commit(S.movePlanItem(state, target, it.id, -1)) }, '↑'),
          h('button', { class: 'btn icon', type: 'button', 'aria-label': 'Move down', disabled: i === items.length - 1, onclick: () => commit(S.movePlanItem(state, target, it.id, 1)) }, '↓'),
          h('button', { class: 'btn icon danger', type: 'button', 'aria-label': 'Remove', onclick: () => commit(S.removePlanItem(state, target, it.id)) }, '×')));
    }));
    wrap.appendChild(list);

    const add = h('input', { type: 'text', id: 'planadd', placeholder: 'Add a priority', 'aria-label': 'Add a priority' });
    const submit = () => {
      if (!add.value.trim()) return;
      commit(S.addPlanItem(state, target, add.value, '', null));
      const again = document.getElementById('planadd');
      if (again) again.focus();
    };
    add.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
    wrap.appendChild(h('div', { class: 'addrow', style: 'margin-top:12px' }, add, h('button', { class: 'btn', type: 'button', onclick: submit }, 'Add')));

    return wrap;
  }

  function renderCheckin(date) {
    const summary = S.daySummary(state, date);
    if (!summary.planned && !summary.logCount) return h('div', {});

    const existing = summary.reflection;
    const draft = {
      scores: existing ? { ...existing.scores } : {},
      crowdedOut: existing ? existing.crowdedOut : '',
      note: existing ? existing.note : '',
    };

    const recap = h('div', { class: 'recap' }, summary.items.map((e) => h('div', { class: 'recap-row' },
      h('span', { class: 'name', text: e.position + '. ' + e.item.title }),
      h('span', { class: 'items-text ' + (e.logs.length ? '' : 'none'), text: e.logs.length ? e.logs.map((l) => l.text || 'did it').join(' · ') : 'nothing' }))));

    const scoreGrid = h('div', { class: 'score-grid' }, summary.items.map((e) => {
      const segs = h('div', { class: 'segs', role: 'group', 'aria-label': 'Score for ' + e.item.title });
      for (let v = 1; v <= 5; v++) {
        segs.appendChild(h('button', {
          type: 'button',
          'aria-pressed': draft.scores[e.item.id] === v ? 'true' : 'false',
          onclick: () => {
            draft.scores[e.item.id] = draft.scores[e.item.id] === v ? 0 : v;
            for (const b of segs.children) b.setAttribute('aria-pressed', b.textContent === String(draft.scores[e.item.id]) ? 'true' : 'false');
          },
        }, String(v)));
      }
      return h('div', { class: 'score-row' }, h('span', { class: 'name', text: e.item.title }), segs);
    }));

    const crowded = h('textarea', { id: 'crowded', rows: '2' });
    crowded.value = draft.crowdedOut;
    const note = h('textarea', { id: 'note', rows: '3' });
    note.value = draft.note;

    const save = () => {
      commit(S.saveReflection(state, date, { scores: draft.scores, crowdedOut: crowded.value, note: note.value }));
      toast('Saved');
    };

    return h('div', { class: 'section' },
      h('h2', { text: 'How ' + relativeName(date) + ' went' }),
      recap,
      summary.planned ? h('p', { class: 'lede', style: 'margin-top:18px', text: 'Score each one from 1 to 5. Tap again to clear.' }) : null,
      summary.planned ? scoreGrid : null,
      h('div', { class: 'field' },
        h('label', { for: 'crowded', text: 'Did anything lower crowd out something higher?' }),
        crowded),
      h('div', { class: 'field' },
        h('label', { for: 'note', text: 'Notes' }),
        note),
      h('div', { class: 'actions', style: 'margin-top:16px' },
        h('button', { class: 'btn primary', type: 'button', onclick: save }, 'Save'),
        existing ? h('span', { class: 'saved-note', text: 'saved' }) : null));
  }

  // ---- History ------------------------------------------------------------

  function renderHistory() {
    const days = S.history(state, today(), 60);
    if (!days.length) {
      return h('div', {}, h('p', { class: 'lede', style: 'margin-top:18px', text: 'Nothing recorded yet.' }));
    }

    const list = h('ul', { class: 'history' }, days.map((d) => {
      const dots = h('span', { class: 'dots' }, d.items.map((e) =>
        h('i', { class: 'dot ' + (e.done ? 'on' : ''), title: e.position + '. ' + e.item.title })));
      const rows = d.items.map((e) => h('div', { class: 'recap-row' },
        h('span', { class: 'name', text: e.position + '. ' + e.item.title + (e.score ? ' · ' + e.score + '/5' : '') }),
        h('span', { class: 'items-text ' + (e.logs.length ? '' : 'none'), text: e.logs.length ? e.logs.map((l) => l.text || 'did it').join(' · ') : 'nothing' })));
      if (d.offList.length) {
        rows.push(h('div', { class: 'recap-row' },
          h('span', { class: 'name', text: 'Off the list' }),
          h('span', { class: 'items-text', text: d.offList.map((l) => l.text || 'did it').join(' · ') })));
      }
      const r = d.reflection;
      return h('li', {},
        h('details', { class: 'day' },
          h('summary', {},
            h('span', { class: 'date', text: fmtShort(d.date) }),
            dots,
            h('span', { class: 'meta', text: d.done + '/' + d.planned })),
          h('div', { class: 'day-body' },
            rows,
            S.orderNotesFor(state, d.date).length
              ? h('div', {}, h('div', { class: 'q', text: 'How the order went' }),
                  h('ul', { class: 'plainlist' }, S.orderNotesFor(state, d.date).map((n) => h('li', { text: n.text }))))
              : null,
            r && r.crowdedOut ? h('div', {}, h('div', { class: 'q', text: 'Crowded out' }), r.crowdedOut) : null,
            r && r.note ? h('div', {}, h('div', { class: 'q', text: 'Notes' }), r.note) : null,
            h('div', { class: 'actions' },
              h('button', { class: 'btn small', type: 'button', onclick: () => { ui.date = d.date; ui.tab = 'today'; persistUi(); render(); } }, 'Open')))));
    }));

    return h('div', {}, list);
  }

  // ---- Lists --------------------------------------------------------------

  function renderLists() {
    const wrap = h('div', {});
    const seed = seedState();
    // Days prepared elsewhere that this browser has no list for. Adding them
    // cannot disturb a day you have already started.
    const available = seed ? S.plansAvailableFrom(state, seed) : [];
    // Days this browser already holds, where the prepared version has since
    // been revised.
    const revised = seed ? S.plansDifferingFrom(state, seed) : [];

    wrap.appendChild(h('div', { class: 'section' },
      h('h2', { text: 'Your usual list' }),
      h('p', { class: 'lede', text: 'The priorities that come back most days. Load it when setting a day, then change what that day needs.' })));

    const list = h('ol', { class: 'plan-list' }, state.template.map((it, i) => {
      const title = h('input', { type: 'text', id: 'ut-' + it.id, value: it.title, 'aria-label': 'Priority' });
      title.addEventListener('change', () => commit(S.updateTemplateItem(state, it.id, { title: title.value })));
      return h('li', { class: 'plan-item' },
        h('span', { class: 'num', text: String(i + 1) }),
        title,
        h('div', { class: 'ctl' },
          h('button', { class: 'btn icon', type: 'button', 'aria-label': 'Move up', disabled: i === 0, onclick: () => commit(S.moveTemplateItem(state, it.id, -1)) }, '↑'),
          h('button', { class: 'btn icon', type: 'button', 'aria-label': 'Move down', disabled: i === state.template.length - 1, onclick: () => commit(S.moveTemplateItem(state, it.id, 1)) }, '↓'),
          h('button', { class: 'btn icon danger', type: 'button', 'aria-label': 'Remove', onclick: () => commit(S.removeTemplateItem(state, it.id)) }, '×')));
    }));
    wrap.appendChild(list);

    const add = h('input', { type: 'text', id: 'usualadd', placeholder: 'Add to the usual list' });
    const submit = () => {
      if (!add.value.trim()) return;
      commit(S.addTemplateItem(state, add.value, '', null));
      const again = document.getElementById('usualadd');
      if (again) again.focus();
    };
    add.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
    wrap.appendChild(h('div', { class: 'addrow', style: 'margin-top:12px' }, add, h('button', { class: 'btn', type: 'button', onclick: submit }, 'Add')));

    const fileInput = h('input', { type: 'file', id: 'import-file', accept: 'application/json', hidden: true });
    fileInput.addEventListener('change', () => {
      const file = fileInput.files && fileInput.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const parsed = S.normalize(JSON.parse(String(reader.result)));
          if (!parsed) throw new Error('bad');
          if (confirm('Replace everything in this browser with the imported file?')) {
            commit(parsed);
            toast('Imported');
          }
        } catch (e) {
          toast('That file is not a valid export.');
        }
        fileInput.value = '';
      };
      reader.readAsText(file);
    });

    wrap.appendChild(h('div', { class: 'section' },
      h('h2', { text: 'Always true' }),
      h('p', { class: 'lede', text: 'Commitments that hold every day. They show at the top of each day without taking a number or pushing a priority down.' })));

    for (const n of state.standing) {
      const title = h('input', { type: 'text', id: 'st-' + n.id, value: n.title, 'aria-label': 'Commitment' });
      title.addEventListener('change', () => commit(S.updateStanding(state, n.id, { title: title.value })));
      const body = h('input', { type: 'text', class: 'note', id: 'sb-' + n.id, value: n.body, placeholder: 'What it means for you', 'aria-label': 'What it means' });
      body.addEventListener('change', () => commit(S.updateStanding(state, n.id, { body: body.value })));
      wrap.appendChild(h('div', { class: 'standing-edit' },
        h('div', { class: 'fields' }, title, body),
        h('button', { class: 'btn icon danger', type: 'button', 'aria-label': 'Remove', onclick: () => commit(S.removeStanding(state, n.id)) }, '×')));
    }

    const stTitle = h('input', { type: 'text', id: 'standingadd', placeholder: 'Add a standing commitment' });
    const stBody = h('input', { type: 'text', id: 'standingaddbody', placeholder: 'What it means (optional)' });
    const addStanding = () => {
      if (!stTitle.value.trim()) return;
      commit(S.addStanding(state, stTitle.value, stBody.value));
    };
    stTitle.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addStanding(); } });
    stBody.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addStanding(); } });
    wrap.appendChild(h('div', { class: 'addrow', style: 'margin-top:12px' },
      stTitle, stBody, h('button', { class: 'btn', type: 'button', onclick: addStanding }, 'Add')));

    const hourInput = h('input', {
      type: 'number', id: 'daystart', min: '0', max: '12',
      value: String(S.dayStartHour(state)), 'aria-label': 'Hour the day rolls over',
    });
    hourInput.addEventListener('change', () => {
      const next = S.setDayStartHour(state, hourInput.value);
      if (next === state) { hourInput.value = String(S.dayStartHour(state)); toast('Pick an hour from 0 to 12.'); return; }
      commit(next);
      toast('The day now rolls over at ' + S.dayStartHour(next) + ':00');
    });
    hourInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); hourInput.blur(); } });

    wrap.appendChild(h('div', { class: 'section' },
      h('h2', { text: 'When the day ends' }),
      h('p', { class: 'lede', text: 'If you write things up after midnight, they should still count for the day you just lived. Anything recorded before this hour belongs to the day before.' }),
      h('div', { class: 'daystart' },
        h('label', { for: 'daystart', text: 'Roll over at' }),
        hourInput,
        h('span', { class: 'status', text: 'o\u2019clock. Set 0 to use midnight.' }))));

    wrap.appendChild(h('div', { class: 'section' },
      h('h2', { text: 'Your data' }),
      h('p', { class: 'lede', text: available.length
        ? 'Everything is stored in this browser only. There ' + (available.length === 1 ? 'is 1 prepared day' : 'are ' + available.length + ' prepared days') + ' to add: ' + available.map(fmtShort).join(', ') + '. Adding leaves every day you have already started untouched.'
        : 'Everything is stored in this browser only. Export now and then.' }),
      h('div', { class: 'data-tools' },
        h('button', { class: 'btn', type: 'button', onclick: exportJson }, 'Export'),
        h('button', { class: 'btn', type: 'button', onclick: () => fileInput.click() }, 'Import'),
        available.length
          ? h('button', { class: 'btn primary', type: 'button', onclick: () => {
              ui.date = available[available.length - 1];
              ui.tab = 'today';
              persistUi();
              commit(S.addPlansFrom(state, seed));
              toast(available.length === 1 ? 'Added 1 day' : 'Added ' + available.length + ' days');
            } }, available.length === 1 ? 'Add 1 prepared day' : 'Add ' + available.length + ' prepared days')
          : null,
        revised.length
          ? h('button', { class: 'btn', type: 'button', onclick: () => {
              if (!confirm('Update the list for ' + revised.map(fmtShort).join(', ') + '? Entries you have already written stay, and any whose priority is gone move to the bottom of the day.')) return;
              let next = state;
              for (const d of revised) next = S.replacePlanFrom(next, seed, d);
              ui.date = revised[revised.length - 1];
              ui.tab = 'today';
              persistUi();
              commit(next);
              toast('List updated');
            } }, revised.length === 1 ? 'Update ' + fmtShort(revised[0]) + '\u2019s list' : 'Update ' + revised.length + ' lists')
          : null,
        seed && seed.logs.length && !state.logs.length
          ? h('button', { class: 'btn', type: 'button', onclick: () => {
              if (confirm('Replace everything in this browser with the bundled data?')) {
                ui.tab = 'today';
                persistUi();
                commit(seed);
                toast('Loaded');
              }
            } }, 'Replace with starting data')
          : null,
        fileInput,
        h('span', { class: 'status', text: state.logs.length + ' entries stored.' }))));

    return wrap;
  }

  function exportJson() {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = h('a', { href: url, download: 'priorities-' + S.dateKey(new Date()) + '.json' });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  render();
})();
