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
      /* storage unavailable or corrupt: fall through to defaults */
    }
    return S.createDefaultState();
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
  ui.date = S.dateKey(new Date());

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

  function fmtTime(ms) {
    const d = new Date(ms);
    return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }

  const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function fmtDate(key) {
    const [y, m, d] = key.split('-').map(Number);
    return WEEKDAYS[new Date(y, m - 1, d).getDay()] + ' ' + MONTHS[m - 1] + ' ' + d;
  }

  function fmtDateLong(key) {
    return fmtDate(key) + ', ' + key.slice(0, 4);
  }

  function today() {
    return S.dateKey(new Date());
  }

  function relativeName(key) {
    if (key === today()) return 'today';
    if (key === S.shiftDateKey(today(), 1)) return 'tomorrow';
    if (key === S.shiftDateKey(today(), -1)) return 'yesterday';
    return fmtDate(key);
  }

  function tierName(tierId) {
    const t = state.tiers.find((x) => x.id === tierId);
    return t ? t.name : '';
  }

  let toastTimer = null;
  function toast(msg) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2400);
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
  }

  function renderDatebar() {
    const bar = document.getElementById('datebar');
    const parts = [
      h('button', { type: 'button', 'aria-label': 'Previous day', onclick: () => setDate(S.shiftDateKey(ui.date, -1)) }, '‹'),
      h('span', { text: fmtDateLong(ui.date) }),
      h('button', { type: 'button', 'aria-label': 'Next day', onclick: () => setDate(S.shiftDateKey(ui.date, 1)) }, '›'),
    ];
    if (ui.date !== today()) {
      parts.push(h('button', { type: 'button', class: 'today-link', onclick: () => setDate(today()) }, 'today'));
    }
    bar.replaceChildren(...parts);
  }

  function setDate(key) {
    ui.date = key;
    render();
  }

  document.querySelector('.tabs').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-tab]');
    if (!btn) return;
    ui.tab = btn.dataset.tab;
    persistUi();
    render();
  });

  // ---- Today: book what you did against this day's list -------------------

  function renderToday() {
    const date = ui.date;
    if (!S.hasPlan(state, date) || S.planFor(state, date).length === 0) return renderNoPlan(date);

    const summary = S.daySummary(state, date);
    const inv = S.inversions(state, date);

    const strip = h('div', { class: 'strip' },
      h('span', { class: 'pill ' + (summary.done > 0 ? 'done' : '') },
        h('span', { class: 'mono', text: summary.done + '/' + summary.planned }), ' priorities done'),
      h('span', { class: 'pill' }, h('span', { class: 'mono', text: String(summary.logCount) }),
        summary.logCount === 1 ? ' entry' : ' entries'),
      summary.offList > 0
        ? h('span', { class: 'pill warn' }, h('span', { class: 'mono', text: String(summary.offList) }), ' off the list')
        : h('span', { class: 'pill' }, h('span', { class: 'mono', text: String(S.streak(state, today())) }), ' day streak'));

    let notice = null;
    if (inv.length) {
      const first = inv[0];
      notice = h('div', { class: 'notice' },
        h('span', {}, h('strong', { text: first.favored.name }), ' got attention while ',
          h('strong', { text: first.neglected.name }), ' has nothing booked. That is the order flipped. Go back up the list.'));
    } else if (summary.logCount === 0 && date === today()) {
      notice = h('div', { class: 'notice' },
        h('span', {}, 'Nothing booked yet. Start at the top: ', h('strong', { text: summary.tiers[0].name }), '.'));
    }

    const ladder = h('div', { class: 'ladder' });
    state.tiers.forEach((tier, i) => {
      const items = S.planForTier(state, date, tier.id);
      const offList = S.offListLogs(state, date, tier.id);
      if (items.length === 0 && offList.length === 0) return;
      const tierSummary = summary.tiers[i];
      const body = h('div', { class: 'tier-body' });
      for (const it of items) body.appendChild(renderPlanItem(it, date));
      if (offList.length) {
        body.appendChild(h('article', { class: 'prio done off' },
          h('div', { class: 'prio-top' },
            h('div', { class: 'prio-check', 'aria-hidden': 'true' }, '✓'),
            h('div', {}, h('p', { class: 'prio-title', text: 'Not on the list' }),
              h('p', { class: 'prio-note', text: 'Done under ' + tier.name + ', but you had not planned it.' }))),
          renderLogList(offList, date)));
      }
      ladder.appendChild(h('section', { class: 'tier ' + (tierSummary.active ? 'touched' : '') },
        h('div', { class: 'rank', text: String(i + 1) }),
        h('div', {},
          h('div', { class: 'tier-head' },
            h('h2', { text: tier.name }),
            h('span', { class: 'count', text: tierSummary.planned ? tierSummary.done + ' of ' + tierSummary.planned : 'off-list only' })),
          body)));
    });

    return h('div', {}, renderCapture(date), strip, notice, ladder);
  }

  // A day with no list yet: offer to build one rather than showing nothing.
  function renderNoPlan(date) {
    const source = S.lastPlannedDate(state, date, 30);
    const preview = h('ul', { class: 'preview' }, state.template.map((it) =>
      h('li', {}, h('span', { class: 'preview-tier', text: tierName(it.tierId) }), it.title)));

    return h('div', {},
      h('section', { class: 'empty-state' },
        h('h2', { text: 'No list for ' + relativeName(date) }),
        h('p', { class: 'lede', text: 'You set each day’s priorities the night before. This one was never set. You can still build it now.' }),
        h('div', { class: 'actions' },
          state.template.length
            ? h('button', { class: 'btn primary', type: 'button', onclick: () => { commit(S.seedPlanFromTemplate(state, date)); toast('List set from your usual list'); } }, 'Use my usual list')
            : null,
          source
            ? h('button', { class: 'btn', type: 'button', onclick: () => { commit(S.seedPlanFromDate(state, date, source)); toast('Copied the list from ' + fmtDate(source)); } }, 'Copy ' + fmtDate(source))
            : null,
          h('button', { class: 'btn', type: 'button', onclick: () => { commit(S.setPlan(state, date, [])); } }, 'Start empty')),
        state.template.length
          ? h('div', { class: 'preview-wrap' }, h('p', { class: 'preview-label', text: 'Your usual list' }), preview)
          : null));
  }

  // "I did this" first, then book it against a priority on today's list.
  function renderCapture(date) {
    const input = h('input', {
      type: 'text',
      id: 'capture',
      placeholder: date === today() ? 'What did you just do?' : 'What did you do on ' + fmtDate(date) + '?',
      'aria-label': 'What did you do',
      autocomplete: 'off',
    });
    const hint = h('p', { class: 'capture-hint', text: 'Then book it against the priority it belongs to.' });

    const book = (targetId, label) => {
      const text = input.value.trim();
      if (!text) {
        hint.textContent = 'Write what you did first, then pick where it books.';
        input.focus();
        return;
      }
      commit(S.addLog(state, date, targetId, text));
      toast('Booked: ' + label);
      const again = document.getElementById('capture');
      if (again) again.focus();
    };

    const rows = [];
    state.tiers.forEach((tier, i) => {
      const items = S.planForTier(state, date, tier.id);
      if (!items.length) return;
      rows.push(h('div', { class: 'book-row' },
        h('span', { class: 'book-rank', text: String(i + 1) }),
        h('div', { class: 'book-chips' },
          h('span', { class: 'book-tier', text: tier.name }),
          items.map((it) => h('button', { class: 'chip', type: 'button', onclick: () => book(it.id, it.title) }, it.title)))));
    });

    const offChips = h('div', { class: 'book-chips off-chips' }, state.tiers.map((tier) =>
      h('button', { class: 'chip ghost', type: 'button', onclick: () => book(tier.id, tier.name + ', off the list') }, tier.name)));

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const firstChip = document.querySelector('.book-row .chip');
        if (input.value.trim() && firstChip) firstChip.focus();
      }
    });

    return h('section', { class: 'capture' },
      h('label', { class: 'capture-label', for: 'capture', text: 'I did this' }),
      input,
      hint,
      h('div', { class: 'book' }, rows),
      h('details', { class: 'off-list' },
        h('summary', { text: 'It was not on the list' }),
        h('p', { class: 'hint', text: 'Book it under a category instead. It shows up separately so you can see what pulled you off plan.' }),
        offChips));
  }

  function renderPlanItem(item, date) {
    const logs = S.logsForItem(state, date, item.id);
    const done = logs.length > 0;
    return h('article', { class: 'prio ' + (done ? 'done' : '') },
      h('div', { class: 'prio-top' },
        h('div', { class: 'prio-check', 'aria-hidden': 'true' }, done ? '✓' : ''),
        h('div', {},
          h('p', { class: 'prio-title', text: item.title }),
          item.note ? h('p', { class: 'prio-note', text: item.note }) : null)),
      logs.length ? renderLogList(logs, date) : null);
  }

  function renderLogList(logs, date) {
    return h('ul', { class: 'prio-logs' }, logs.map((l) =>
      h('li', {},
        h('span', { class: 'time', text: fmtTime(l.at) }),
        h('span', { class: 'text ' + (l.text ? '' : 'blank'), text: l.text || 'did it' }),
        renderMoveControl(l, date),
        h('button', { class: 'del', type: 'button', 'aria-label': 'Remove entry', onclick: () => commit(S.removeLog(state, l.id)) }, '×'))));
  }

  // Re-book an entry against a different priority on the same day.
  function renderMoveControl(log, date) {
    const sel = h('select', { class: 'move', 'aria-label': 'Move entry', id: 'move-' + log.id });
    sel.appendChild(h('option', { value: '', text: 'move…' }));
    for (const tier of state.tiers) {
      const items = S.planForTier(state, date, tier.id);
      const group = h('optgroup', { label: tier.name });
      for (const it of items) group.appendChild(h('option', { value: it.id, text: it.title }));
      group.appendChild(h('option', { value: tier.id, text: tier.name + ' (off the list)' }));
      sel.appendChild(group);
    }
    sel.addEventListener('change', () => {
      if (sel.value) commit(S.moveLog(state, log.id, sel.value));
    });
    return sel;
  }

  // ---- Tonight: set tomorrow's list, then check in on today ---------------

  function renderTonight() {
    const date = ui.date;
    const next = S.shiftDateKey(date, 1);
    return h('div', {}, renderPlanner(next, date), renderCheckin(date));
  }

  function renderPlanner(target, from) {
    const items = S.planFor(state, target);
    const set = S.hasPlan(state, target);

    const head = h('div', { class: 'section-head' },
      h('h2', { text: 'Priorities for ' + relativeName(target) }),
      h('span', { class: 'count', text: items.length ? items.length + (items.length === 1 ? ' priority' : ' priorities') : 'not set' }));

    const seedActions = h('div', { class: 'actions' },
      state.template.length
        ? h('button', { class: 'btn ' + (set ? '' : 'primary'), type: 'button', onclick: () => {
            if (!set || confirm('Replace the list for ' + relativeName(target) + ' with your usual list?')) {
              commit(S.seedPlanFromTemplate(state, target));
              toast('Loaded your usual list');
            }
          } }, set ? 'Reset to usual list' : 'Start from my usual list')
        : null,
      S.planFor(state, from).length
        ? h('button', { class: 'btn', type: 'button', onclick: () => {
            if (!set || confirm('Replace the list for ' + relativeName(target) + ' with ' + relativeName(from) + '’s?')) {
              commit(S.seedPlanFromDate(state, target, from));
              toast('Copied ' + relativeName(from) + '’s list');
            }
          } }, 'Copy ' + relativeName(from) + '’s list')
        : null);

    const list = h('div', { class: 'plan-list' });
    state.tiers.forEach((tier, i) => {
      const tierItems = items.filter((it) => it.tierId === tier.id);
      const rows = tierItems.map((it, j) => {
        const title = h('input', { type: 'text', id: 'plan-' + it.id, value: it.title, 'aria-label': 'Priority' });
        title.addEventListener('change', () => commit(S.updatePlanItem(state, target, it.id, { title: title.value })));
        return h('div', { class: 'plan-row' },
          h('div', { class: 'fields' }, title, it.note ? h('p', { class: 'prio-note', text: it.note }) : null),
          h('div', { class: 'ctl' },
            h('button', { class: 'btn icon', type: 'button', 'aria-label': 'Move up', disabled: j === 0, onclick: () => commit(S.movePlanItem(state, target, it.id, -1)) }, '↑'),
            h('button', { class: 'btn icon', type: 'button', 'aria-label': 'Move down', disabled: j === tierItems.length - 1, onclick: () => commit(S.movePlanItem(state, target, it.id, 1)) }, '↓'),
            h('button', { class: 'btn icon', type: 'button', 'aria-label': 'Keep for future days', title: 'Add to my usual list', onclick: () => { commit(S.promoteToTemplate(state, target, it.id)); toast('Added to your usual list'); } }, '+'),
            h('button', { class: 'btn icon danger', type: 'button', 'aria-label': 'Remove', onclick: () => commit(S.removePlanItem(state, target, it.id)) }, '×')));
      });

      const add = h('input', { type: 'text', id: 'planadd-' + tier.id, placeholder: 'Add to ' + tier.name });
      const submit = () => {
        if (!add.value.trim()) return;
        commit(S.addPlanItem(state, target, tier.id, add.value, ''));
        const again = document.getElementById('planadd-' + tier.id);
        if (again) again.focus();
      };
      add.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });

      list.appendChild(h('section', { class: 'plan-tier' },
        h('div', { class: 'plan-tier-head' },
          h('span', { class: 'rank small', text: String(i + 1) }),
          h('h3', { text: tier.name })),
        rows,
        h('div', { class: 'addform' }, add, h('button', { class: 'btn small', type: 'button', onclick: submit }, 'Add'))));
    });

    return h('div', { class: 'section' },
      head,
      h('p', { class: 'lede', text: 'Set it now, while today is fresh. Tomorrow you book what you did against this list.' }),
      seedActions,
      list);
  }

  function renderCheckin(date) {
    const summary = S.daySummary(state, date);
    const existing = summary.reflection;
    const draft = {
      tierScores: existing ? { ...existing.tierScores } : {},
      crowdedOut: existing ? existing.crowdedOut : '',
      note: existing ? existing.note : '',
    };

    const recap = h('div', { class: 'recap' });
    summary.tiers.forEach((t) => {
      const lines = tierEntryLines(t.tierId, date);
      recap.appendChild(h('div', { class: 'recap-row' },
        h('span', { class: 'name', text: t.name }),
        h('span', { class: 'items ' + (lines.length ? '' : 'none'), text: lines.length ? lines.join(' · ') : 'nothing booked' })));
    });

    const missed = S.untouchedItems(state, date);
    const missedBlock = missed.length
      ? h('div', { class: 'missed' },
          h('p', { class: 'missed-label', text: missed.length === 1 ? 'One priority went untouched' : missed.length + ' priorities went untouched' }),
          h('ul', {}, missed.map((it) => h('li', {}, h('span', { class: 'preview-tier', text: tierName(it.tierId) }), it.title))))
      : null;

    const scoreGrid = h('div', { class: 'score-grid' });
    for (const tier of state.tiers) {
      const segs = h('div', { class: 'segs', role: 'group', 'aria-label': 'Score for ' + tier.name });
      for (let v = 1; v <= 5; v++) {
        segs.appendChild(h('button', {
          type: 'button',
          'aria-pressed': draft.tierScores[tier.id] === v ? 'true' : 'false',
          onclick: () => {
            draft.tierScores[tier.id] = draft.tierScores[tier.id] === v ? 0 : v;
            for (const b of segs.children) b.setAttribute('aria-pressed', b.textContent === String(draft.tierScores[tier.id]) ? 'true' : 'false');
          },
        }, String(v)));
      }
      scoreGrid.appendChild(h('div', { class: 'score-row' }, h('span', { class: 'name', text: tier.name }), segs));
    }

    const crowded = h('textarea', { id: 'crowded', rows: '2' });
    crowded.value = draft.crowdedOut;
    const note = h('textarea', { id: 'note', rows: '3' });
    note.value = draft.note;

    const save = () => {
      commit(S.saveReflection(state, date, { tierScores: draft.tierScores, crowdedOut: crowded.value, note: note.value }));
      toast('Check-in saved');
    };

    return h('div', { class: 'section' },
      h('div', { class: 'section-head' },
        h('h2', { text: 'How ' + relativeName(date) + ' went' }),
        existing ? h('span', { class: 'saved-note', text: 'saved ' + fmtTime(existing.savedAt) }) : null),
      recap,
      missedBlock,
      h('p', { class: 'lede', text: 'Score each one. 1 means it was ignored, 5 means it got the place it deserves. Tap again to clear.' }),
      scoreGrid,
      h('div', { class: 'field' },
        h('label', { for: 'crowded', text: 'Did anything lower on the list crowd out something higher?' }),
        h('span', { class: 'hint', text: 'Be specific. "School pushed out the workout" is more useful than "yes".' }),
        crowded),
      h('div', { class: 'field' },
        h('label', { for: 'note', text: 'Anything else about the day' }),
        note),
      h('div', { class: 'actions' }, h('button', { class: 'btn primary', type: 'button', onclick: save }, 'Save check-in')));
  }

  // One line per entry: "Priority: what you did", or just what you did when
  // it was booked off the list.
  function tierEntryLines(tierId, date) {
    const plan = S.planFor(state, date);
    return S.logsForTier(state, date, tierId).map((l) => {
      const it = l.itemId ? plan.find((x) => x.id === l.itemId) : null;
      const what = l.text || 'did it';
      return it ? it.title + ': ' + what : what + ' (off the list)';
    });
  }

  // ---- History -----------------------------------------------------------

  function renderHistory() {
    const days = S.history(state, today(), 60);
    const legend = h('div', { class: 'legend' },
      h('span', {}, h('i', { class: 'dot on' }), 'every priority done'),
      h('span', {}, h('i', { class: 'dot part' }), 'something booked'),
      h('span', {}, h('i', { class: 'dot' }), 'nothing'),
      h('span', {}, 'one dot per category, in order'));

    if (!days.length) {
      return h('div', {}, legend, h('p', { class: 'lede', text: 'No days recorded yet. Set a list under Tonight, then book against it tomorrow.' }));
    }

    const list = h('ul', { class: 'history' });
    for (const d of days) {
      const inv = S.inversions(state, d.date);
      const dots = h('span', { class: 'dots' }, d.tiers.map((t) => {
        let cls = 'dot';
        if (t.planned > 0 && t.done === t.planned) cls += ' on';
        else if (t.active) cls += ' part';
        else if (t.planned === 0) cls += ' empty';
        return h('i', { class: cls, title: t.name + ': ' + t.done + ' of ' + t.planned });
      }));
      const rows = d.tiers.map((t) => {
        const lines = tierEntryLines(t.tierId, d.date);
        return h('div', { class: 'recap-row' },
          h('span', { class: 'name' }, t.name, t.score ? h('span', { class: 'avg', text: ' ' + t.score + '/5' }) : null),
          h('span', { class: 'items ' + (lines.length ? '' : 'none'), text: lines.length ? lines.join(' · ') : 'nothing booked' }));
      });
      const r = d.reflection;
      list.appendChild(h('li', {},
        h('details', { class: 'day' },
          h('summary', {},
            h('span', { class: 'date', text: fmtDate(d.date) }),
            dots,
            h('span', { class: 'avg', text: d.planned ? d.done + '/' + d.planned + ' done' : 'no list set' }),
            inv.length ? h('span', { class: 'flag', text: 'order flipped' }) : null,
            d.offList ? h('span', { class: 'flag', text: d.offList + ' off list' }) : null),
          h('div', { class: 'day-body' },
            rows,
            r && r.crowdedOut ? h('div', {}, h('div', { class: 'q', text: 'Crowded out' }), r.crowdedOut) : null,
            r && r.note ? h('div', {}, h('div', { class: 'q', text: 'Note' }), r.note) : null,
            h('div', {}, h('button', { class: 'btn small', type: 'button', onclick: () => { ui.date = d.date; ui.tab = 'today'; persistUi(); render(); } }, 'Open this day'))))));
    }
    return h('div', {}, legend, list);
  }

  // ---- Lists: categories, the usual list, and data ------------------------

  function renderLists() {
    const wrap = h('div', {});

    wrap.appendChild(h('div', { class: 'section' },
      h('h2', { text: 'Your usual list' }),
      h('p', { class: 'lede', text: 'The starting point each night. Load it, then change whatever that day needs. Editing here never changes a day you already set.' })));

    state.tiers.forEach((tier, i) => {
      const nameInput = h('input', { type: 'text', id: 'tier-' + tier.id, value: tier.name, 'aria-label': 'Category name' });
      nameInput.addEventListener('change', () => commit(S.renameTier(state, tier.id, nameInput.value)));

      const items = state.template.filter((it) => it.tierId === tier.id);
      const rows = items.map((it, j) => {
        const title = h('input', { type: 'text', id: 'ut-' + it.id, value: it.title, 'aria-label': 'Priority' });
        title.addEventListener('change', () => commit(S.updateTemplateItem(state, it.id, { title: title.value })));
        const noteIn = h('input', { type: 'text', class: 'note', id: 'un-' + it.id, value: it.note, placeholder: 'Optional note', 'aria-label': 'Note' });
        noteIn.addEventListener('change', () => commit(S.updateTemplateItem(state, it.id, { note: noteIn.value })));
        return h('li', { class: 'edit-prio' },
          h('div', { class: 'fields' }, title, noteIn),
          h('div', { class: 'ctl' },
            h('button', { class: 'btn icon', type: 'button', 'aria-label': 'Move up', disabled: j === 0, onclick: () => commit(S.moveTemplateItem(state, it.id, -1)) }, '↑'),
            h('button', { class: 'btn icon', type: 'button', 'aria-label': 'Move down', disabled: j === items.length - 1, onclick: () => commit(S.moveTemplateItem(state, it.id, 1)) }, '↓'),
            h('button', { class: 'btn icon danger', type: 'button', 'aria-label': 'Remove', onclick: () => commit(S.removeTemplateItem(state, it.id)) }, '×')));
      });

      const addTitle = h('input', { type: 'text', id: 'add-' + tier.id, placeholder: 'New item for ' + tier.name });
      const addNote = h('input', { type: 'text', id: 'addnote-' + tier.id, placeholder: 'Note (optional)' });
      const add = () => {
        if (!addTitle.value.trim()) return;
        commit(S.addTemplateItem(state, tier.id, addTitle.value, addNote.value));
        const again = document.getElementById('add-' + tier.id);
        if (again) again.focus();
      };
      addTitle.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } });
      addNote.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } });

      wrap.appendChild(h('div', { class: 'edit-tier' },
        h('div', { class: 'edit-tier-head' },
          h('span', { class: 'rank', text: String(i + 1) }),
          nameInput,
          h('button', { class: 'btn icon', type: 'button', 'aria-label': 'Move category up', disabled: i === 0, onclick: () => commit(S.moveTier(state, tier.id, -1)) }, '↑'),
          h('button', { class: 'btn icon', type: 'button', 'aria-label': 'Move category down', disabled: i === state.tiers.length - 1, onclick: () => commit(S.moveTier(state, tier.id, 1)) }, '↓'),
          h('button', { class: 'btn icon danger', type: 'button', 'aria-label': 'Delete category', onclick: () => {
            if (confirm('Delete "' + tier.name + '"? Every priority and entry filed under it goes too.')) commit(S.removeTier(state, tier.id));
          } }, '×')),
        h('ul', { class: 'edit-prios' }, rows),
        h('div', { class: 'addform' }, addTitle, addNote, h('button', { class: 'btn', type: 'button', onclick: add }, 'Add'))));
    });

    const newTier = h('input', { type: 'text', id: 'add-tier', placeholder: 'New category, e.g. Friends' });
    const addTier = () => {
      if (!newTier.value.trim()) return;
      commit(S.addTier(state, newTier.value));
    };
    newTier.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addTier(); } });
    wrap.appendChild(h('div', { class: 'addform spaced' }, newTier, h('button', { class: 'btn', type: 'button', onclick: addTier }, 'Add category')));

    const days = Object.keys(state.plans).length;
    const status = h('span', { class: 'status', text: days + (days === 1 ? ' day' : ' days') + ' planned, ' + state.logs.length + ' entries, stored in this browser.' });
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
      h('h2', { text: 'Your data' }),
      h('p', { class: 'lede', text: 'Everything lives in this browser only. Export now and then so a cleared cache does not take your history with it.' }),
      h('div', { class: 'data-tools' },
        h('button', { class: 'btn', type: 'button', onclick: exportJson }, 'Export JSON'),
        h('button', { class: 'btn', type: 'button', onclick: () => fileInput.click() }, 'Import JSON'),
        h('button', { class: 'btn', type: 'button', onclick: copyJson }, 'Copy JSON'),
        fileInput,
        status)));

    return wrap;
  }

  function exportJson() {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = h('a', { href: url, download: 'priorities-' + today() + '.json' });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function copyJson() {
    const text = JSON.stringify(state, null, 2);
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => toast('Copied to clipboard'), () => toast('Copy failed'));
    } else {
      toast('Clipboard not available here');
    }
  }

  render();
})();
