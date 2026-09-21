/* UI for the priorities tracker. Depends on window.PriorityStore (store.js). */
(function () {
  'use strict';

  const S = window.PriorityStore;
  const STORAGE_KEY = 'priorities-tracker-v1';
  const UI_KEY = 'priorities-tracker-ui';

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
  const ui = Object.assign({ tab: 'today', date: S.dateKey(new Date()) }, loadUi());
  if (!['today', 'evening', 'history', 'edit'].includes(ui.tab)) ui.tab = 'today';
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
    const dt = new Date(y, m - 1, d);
    return WEEKDAYS[dt.getDay()] + ' ' + MONTHS[m - 1] + ' ' + d + ', ' + y;
  }

  function isToday(key) {
    return key === S.dateKey(new Date());
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
    renderTabs();
    root.replaceChildren();
    if (ui.tab === 'today') root.appendChild(renderToday());
    else if (ui.tab === 'evening') root.appendChild(renderEvening());
    else if (ui.tab === 'history') root.appendChild(renderHistory());
    else root.appendChild(renderEdit());
  }

  function renderDatebar() {
    const bar = document.getElementById('datebar');
    const parts = [
      h('button', { type: 'button', 'aria-label': 'Previous day', onclick: () => setDate(S.shiftDateKey(ui.date, -1)) }, '‹'),
      h('span', { text: fmtDate(ui.date) }),
      h('button', { type: 'button', 'aria-label': 'Next day', onclick: () => setDate(S.shiftDateKey(ui.date, 1)) }, '›'),
    ];
    if (!isToday(ui.date)) {
      parts.push(h('button', { type: 'button', class: 'today-link', onclick: () => setDate(S.dateKey(new Date())) }, 'today'));
    }
    bar.replaceChildren(...parts);
  }

  function setDate(key) {
    ui.date = key;
    render();
  }

  function renderTabs() {
    for (const btn of document.querySelectorAll('.tabs button')) {
      btn.setAttribute('aria-selected', btn.dataset.tab === ui.tab ? 'true' : 'false');
    }
  }

  document.querySelector('.tabs').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-tab]');
    if (!btn) return;
    ui.tab = btn.dataset.tab;
    persistUi();
    render();
  });

  // ---- Today -------------------------------------------------------------

  function renderToday() {
    const date = ui.date;
    const summary = S.daySummary(state, date);
    const inv = S.inversions(state, date);
    const streak = S.streak(state, S.dateKey(new Date()));

    const strip = h(
      'div',
      { class: 'strip' },
      h('span', { class: 'pill ' + (summary.activeTiers > 0 ? 'done' : '') },
        h('span', { class: 'mono', text: summary.activeTiers + '/' + summary.tiers.length }), ' tiers active'),
      h('span', { class: 'pill' }, h('span', { class: 'mono', text: String(summary.logCount) }), summary.logCount === 1 ? ' entry' : ' entries'),
      h('span', { class: 'pill' }, h('span', { class: 'mono', text: String(streak) }), ' day streak')
    );

    let notice = null;
    if (inv.length) {
      const first = inv[0];
      notice = h('div', { class: 'notice' },
        h('span', {}, h('strong', { text: first.favored.name }), ' got attention while ',
          h('strong', { text: first.neglected.name }), ' has nothing booked. That is the order flipped. Go back up the ladder.'));
    } else if (summary.tiers.length > 0 && summary.logCount === 0 && isToday(date)) {
      notice = h('div', { class: 'notice' },
        h('span', {}, 'Nothing booked yet. Start at the top: ', h('strong', { text: summary.tiers[0].name }), '.'));
    }

    const ladder = h('div', { class: 'ladder' });
    state.tiers.forEach((tier, i) => {
      const prios = S.prioritiesForTier(state, tier.id);
      const tierSummary = summary.tiers[i];
      const general = S.generalLogsForTier(state, tier.id, date);
      const body = h('div', { class: 'tier-body' });
      for (const p of prios) body.appendChild(renderPriority(p, date));
      if (general.length) {
        body.appendChild(h('article', { class: 'prio done general' },
          h('div', { class: 'prio-top' },
            h('div', { class: 'prio-check', 'aria-hidden': 'true' }, '✓'),
            h('div', {}, h('p', { class: 'prio-title', text: 'Booked under ' + tier.name }))),
          renderLogList(general)));
      }
      if (prios.length === 0 && general.length === 0) {
        body.appendChild(h('p', { class: 'empty', text: 'Nothing here yet. Book something above, or add priorities under Edit.' }));
      }
      ladder.appendChild(
        h('section', { class: 'tier ' + (tierSummary.active ? 'touched' : '') },
          h('div', { class: 'rank', text: String(i + 1) }),
          h('div', {},
            h('div', { class: 'tier-head' },
              h('h2', { text: tier.name }),
              h('span', { class: 'count', text: tierSummary.logCount === 1 ? '1 entry' : tierSummary.logCount + ' entries' })),
            body))
      );
    });

    return h('div', {}, renderCapture(date), strip, notice, ladder);
  }

  // "I did this" first, then pick where it belongs.
  function renderCapture(date) {
    const input = h('input', {
      type: 'text',
      id: 'capture',
      placeholder: isToday(date) ? 'What did you just do?' : 'What did you do on ' + fmtDate(date) + '?',
      'aria-label': 'What did you do',
      autocomplete: 'off',
    });
    const hint = h('p', { class: 'capture-hint', text: 'Then book it under the place it belongs.' });

    const book = (targetId, label) => {
      const text = input.value.trim();
      if (!text) {
        hint.textContent = 'Write what you did first, then pick where it goes.';
        input.focus();
        return;
      }
      commit(S.addLog(state, targetId, text, date));
      toast('Booked under ' + label);
      const again = document.getElementById('capture');
      if (again) again.focus();
    };

    const rows = state.tiers.map((tier, i) => {
      const prios = S.prioritiesForTier(state, tier.id);
      return h('div', { class: 'book-row' },
        h('span', { class: 'book-rank', text: String(i + 1) }),
        h('div', { class: 'book-chips' },
          h('button', { class: 'chip tier', type: 'button', onclick: () => book(tier.id, tier.name) }, tier.name),
          prios.map((p) => h('button', { class: 'chip', type: 'button', onclick: () => book(p.id, tier.name + ' · ' + p.title) }, p.title))));
    });

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
      h('div', { class: 'book' }, rows));
  }

  function renderLogList(logs) {
    return h('ul', { class: 'prio-logs' }, logs.map((l) =>
      h('li', {},
        h('span', { class: 'time', text: fmtTime(l.at) }),
        h('span', { class: 'text ' + (l.text ? '' : 'blank'), text: l.text || 'did it' }),
        renderMoveControl(l),
        h('button', { class: 'del', type: 'button', 'aria-label': 'Remove entry', onclick: () => commit(S.removeLog(state, l.id)) }, '×'))));
  }

  // A compact select for re-booking an entry somewhere else.
  function renderMoveControl(log) {
    const sel = h('select', { class: 'move', 'aria-label': 'Move entry', id: 'move-' + log.id });
    sel.appendChild(h('option', { value: '', text: 'move…' }));
    for (const tier of state.tiers) {
      const group = h('optgroup', { label: tier.name });
      group.appendChild(h('option', { value: tier.id, text: tier.name + ' (general)' }));
      for (const p of S.prioritiesForTier(state, tier.id)) group.appendChild(h('option', { value: p.id, text: p.title }));
      sel.appendChild(group);
    }
    sel.addEventListener('change', () => {
      if (sel.value) commit(S.moveLog(state, log.id, sel.value));
    });
    return sel;
  }

  function renderPriority(p, date) {
    const logs = S.logsForPriority(state, p.id, date);
    const done = logs.length > 0;
    return h('article', { class: 'prio ' + (done ? 'done' : '') },
      h('div', { class: 'prio-top' },
        h('div', { class: 'prio-check', 'aria-hidden': 'true' }, done ? '✓' : ''),
        h('div', {},
          h('p', { class: 'prio-title', text: p.title }),
          p.note ? h('p', { class: 'prio-note', text: p.note }) : null)),
      logs.length ? renderLogList(logs) : null
    );
  }

  // One line per entry in a tier: "Priority title: what you did", or just
  // what you did when it was booked under the tier itself.
  function tierEntryLines(tierId, date) {
    const byId = new Map(state.priorities.map((p) => [p.id, p]));
    return S.logsForTier(state, tierId, date).map((l) => {
      const p = l.priorityId ? byId.get(l.priorityId) : null;
      const what = l.text || 'did it';
      return p ? p.title + ': ' + what : what;
    });
  }

  // ---- Evening -----------------------------------------------------------

  function renderEvening() {
    const date = ui.date;
    const summary = S.daySummary(state, date);
    const existing = summary.reflection;
    const draft = {
      tierScores: existing ? { ...existing.tierScores } : {},
      crowdedOut: existing ? existing.crowdedOut : '',
      note: existing ? existing.note : '',
    };

    const recap = h('div', { class: 'recap' });
    summary.tiers.forEach((t) => {
      const items = tierEntryLines(t.tierId, date);
      recap.appendChild(h('div', { class: 'recap-row' },
        h('span', { class: 'name', text: t.name }),
        h('span', { class: 'items ' + (items.length ? '' : 'none'), text: items.length ? items.join(' · ') : 'nothing booked' })));
    });

    const scoreGrid = h('div', { class: 'score-grid' });
    for (const tier of state.tiers) {
      const segs = h('div', { class: 'segs', role: 'group', 'aria-label': 'Score for ' + tier.name });
      for (let v = 1; v <= 5; v++) {
        const btn = h('button', {
          type: 'button',
          'aria-pressed': draft.tierScores[tier.id] === v ? 'true' : 'false',
          onclick: () => {
            draft.tierScores[tier.id] = draft.tierScores[tier.id] === v ? 0 : v;
            for (const b of segs.children) b.setAttribute('aria-pressed', b.textContent === String(draft.tierScores[tier.id]) ? 'true' : 'false');
          },
        }, String(v));
        segs.appendChild(btn);
      }
      scoreGrid.appendChild(h('div', { class: 'score-row' }, h('span', { class: 'name', text: tier.name }), segs));
    }

    const crowded = h('textarea', { id: 'crowded', rows: '2' });
    crowded.value = draft.crowdedOut;
    const note = h('textarea', { id: 'note', rows: '3' });
    note.value = draft.note;

    const savedNote = h('span', { class: 'saved-note', text: existing ? 'Saved ' + fmtTime(existing.savedAt) : 'Not saved yet' });

    const save = () => {
      commit(S.saveReflection(state, date, {
        tierScores: draft.tierScores,
        crowdedOut: crowded.value,
        note: note.value,
      }));
      toast('Evening check-in saved');
    };

    return h('div', {},
      h('div', { class: 'section' },
        h('h2', { text: 'What the day looked like' }),
        h('p', { class: 'lede', text: 'Read it in order. The top rows should not be the empty ones.' }),
        recap),
      h('div', { class: 'section' },
        h('h2', { text: 'How did you honor each one?' }),
        h('p', { class: 'lede', text: '1 means it was ignored, 5 means it got the place it deserves. Tap again to clear.' }),
        scoreGrid),
      h('div', { class: 'section' },
        h('div', { class: 'field' },
          h('label', { for: 'crowded', text: 'Did anything lower on the list crowd out something higher?' }),
          h('span', { class: 'hint', text: 'Be specific. "School pushed out the workout" is more useful than "yes".' }),
          crowded),
        h('div', { class: 'field' },
          h('label', { for: 'note', text: 'Anything else about today' }),
          note),
        h('div', { class: 'actions' },
          h('button', { class: 'btn primary', type: 'button', onclick: save }, 'Save check-in'),
          savedNote)));
  }

  // ---- History -----------------------------------------------------------

  function renderHistory() {
    const today = S.dateKey(new Date());
    const days = S.history(state, today, 60);
    const legend = h('div', { class: 'legend' },
      h('span', {}, h('i', { class: 'dot on' }), 'every priority touched'),
      h('span', {}, h('i', { class: 'dot part' }), 'something booked'),
      h('span', {}, h('i', { class: 'dot' }), 'nothing'),
      h('span', {}, 'dots run top of the ladder to bottom'));

    if (!days.length) {
      return h('div', {}, legend, h('p', { class: 'lede', text: 'No days recorded yet. Log something under Today and it shows up here.' }));
    }

    const list = h('ul', { class: 'history' });
    for (const d of days) {
      const inv = S.inversions(state, d.date);
      const dots = h('span', { class: 'dots' }, d.tiers.map((t) => {
        let cls = 'dot';
        if (t.total > 0 && t.touched === t.total) cls += ' on';
        else if (t.active) cls += ' part';
        else if (t.total === 0) cls += ' empty';
        return h('i', { class: cls, title: t.name + ': ' + t.logCount + (t.logCount === 1 ? ' entry' : ' entries') });
      }));
      const bodyRows = d.tiers.map((t) => {
        const items = tierEntryLines(t.tierId, d.date);
        return h('div', { class: 'recap-row' },
          h('span', { class: 'name' }, t.name, t.score ? h('span', { class: 'avg', text: ' ' + t.score + '/5' }) : null),
          h('span', { class: 'items ' + (items.length ? '' : 'none'), text: items.length ? items.join(' · ') : 'nothing booked' }));
      });
      const r = d.reflection;
      list.appendChild(h('li', {},
        h('details', { class: 'day' },
          h('summary', {},
            h('span', { class: 'date', text: d.date }),
            dots,
            h('span', { class: 'avg', text: d.avgScore !== null ? 'avg ' + d.avgScore.toFixed(1) : (d.logCount + ' entries') }),
            inv.length ? h('span', { class: 'flag', text: 'order flipped' }) : null,
            !r ? h('span', { class: 'flag', text: 'no check-in' }) : null),
          h('div', { class: 'day-body' },
            bodyRows,
            r && r.crowdedOut ? h('div', {}, h('div', { class: 'q', text: 'Crowded out' }), r.crowdedOut) : null,
            r && r.note ? h('div', {}, h('div', { class: 'q', text: 'Note' }), r.note) : null,
            h('div', {}, h('button', { class: 'btn small', type: 'button', onclick: () => { ui.date = d.date; ui.tab = 'today'; persistUi(); render(); } }, 'Open this day'))))));
    }
    return h('div', {}, legend, list);
  }

  // ---- Edit --------------------------------------------------------------

  function renderEdit() {
    const wrap = h('div', {});
    wrap.appendChild(h('div', { class: 'section' },
      h('h2', { text: 'The order' }),
      h('p', { class: 'lede', text: 'Top of the list wins the day. Put school where it belongs, not where it shouts from.' })));

    state.tiers.forEach((tier, i) => {
      const nameInput = h('input', { type: 'text', id: 'tier-' + tier.id, value: tier.name, 'aria-label': 'Tier name' });
      nameInput.addEventListener('change', () => commit(S.renameTier(state, tier.id, nameInput.value)));

      const prios = S.prioritiesForTier(state, tier.id);
      const list = h('ul', { class: 'edit-prios' });
      prios.forEach((p, j) => {
        const title = h('input', { type: 'text', id: 'pt-' + p.id, value: p.title, 'aria-label': 'Priority title' });
        title.addEventListener('change', () => commit(S.updatePriority(state, p.id, { title: title.value })));
        const noteIn = h('input', { type: 'text', class: 'note', id: 'pn-' + p.id, value: p.note, placeholder: 'Optional note', 'aria-label': 'Priority note' });
        noteIn.addEventListener('change', () => commit(S.updatePriority(state, p.id, { note: noteIn.value })));
        list.appendChild(h('li', { class: 'edit-prio' },
          h('div', { class: 'fields' }, title, noteIn),
          h('div', { class: 'ctl' },
            h('button', { class: 'btn icon', type: 'button', 'aria-label': 'Move up', disabled: j === 0, onclick: () => commit(S.movePriority(state, p.id, -1)) }, '↑'),
            h('button', { class: 'btn icon', type: 'button', 'aria-label': 'Move down', disabled: j === prios.length - 1, onclick: () => commit(S.movePriority(state, p.id, 1)) }, '↓'),
            h('button', { class: 'btn icon danger', type: 'button', 'aria-label': 'Delete priority', onclick: () => {
              if (confirm('Delete "' + p.title + '"? Entries booked under it stay, filed under ' + tier.name + '.')) commit(S.removePriority(state, p.id));
            } }, '×'))));
      });

      const addTitle = h('input', { type: 'text', id: 'add-' + tier.id, placeholder: 'New priority for ' + tier.name });
      const addNote = h('input', { type: 'text', id: 'addnote-' + tier.id, placeholder: 'Note (optional)' });
      const add = () => {
        if (!addTitle.value.trim()) return;
        commit(S.addPriority(state, tier.id, addTitle.value, addNote.value));
        const again = document.getElementById('add-' + tier.id);
        if (again) again.focus();
      };
      addTitle.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } });
      addNote.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } });

      wrap.appendChild(h('div', { class: 'edit-tier' },
        h('div', { class: 'edit-tier-head' },
          h('span', { class: 'rank', text: String(i + 1) }),
          nameInput,
          h('button', { class: 'btn icon', type: 'button', 'aria-label': 'Move tier up', disabled: i === 0, onclick: () => commit(S.moveTier(state, tier.id, -1)) }, '↑'),
          h('button', { class: 'btn icon', type: 'button', 'aria-label': 'Move tier down', disabled: i === state.tiers.length - 1, onclick: () => commit(S.moveTier(state, tier.id, 1)) }, '↓'),
          h('button', { class: 'btn icon danger', type: 'button', 'aria-label': 'Delete tier', onclick: () => {
            if (confirm('Delete "' + tier.name + '", its priorities, and their history?')) commit(S.removeTier(state, tier.id));
          } }, '×')),
        list,
        h('div', { class: 'addform' }, addTitle, addNote, h('button', { class: 'btn', type: 'button', onclick: add }, 'Add'))));
    });

    const newTier = h('input', { type: 'text', id: 'add-tier', placeholder: 'New tier, e.g. Friends' });
    const addTier = () => {
      if (!newTier.value.trim()) return;
      commit(S.addTier(state, newTier.value));
    };
    newTier.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addTier(); } });
    wrap.appendChild(h('div', { class: 'addform', style: 'margin-bottom:26px' }, newTier, h('button', { class: 'btn', type: 'button', onclick: addTier }, 'Add tier')));

    // Data tools
    const status = h('span', { class: 'status', text: state.logs.length + ' entries, ' + Object.keys(state.reflections).length + ' check-ins stored in this browser.' });
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
    const a = h('a', { href: url, download: 'priorities-' + S.dateKey(new Date()) + '.json' });
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

  // ---- Boot --------------------------------------------------------------

  render();
})();
