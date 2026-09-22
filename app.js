/* UI for the priorities tracker. Depends on window.PriorityStore (store.js). */
(function () {
  'use strict';

  const S = window.PriorityStore;
  const STORAGE_KEY = 'priorities-tracker-v1';
  const UI_KEY = 'priorities-tracker-ui';
  const TABS = ['today', 'tonight', 'history', 'lists'];

  // ---- Persistence -------------------------------------------------------

  // Anything saved in this browser wins. Failing that, the bundled starting
  // data in seed.js, so a fresh install opens on real content rather than an
  // empty shell. Failing that, bare categories.
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
  ui.date = S.dateKey(new Date());
  ui.adding = null; // category id whose "what did you do" field is open

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

  function today() {
    return S.dateKey(new Date());
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

  // ---- Today -------------------------------------------------------------

  function renderToday() {
    const date = ui.date;
    const summary = S.daySummary(state, date);
    const inv = S.inversions(state, date);

    const line = summary.activeTiers + ' of ' + state.tiers.length + ' touched';
    const parts = [h('p', { class: 'summary', text: line })];

    if (inv.length) {
      const first = inv[0];
      parts.push(h('p', { class: 'alert', text: first.favored.name + ' got time before ' + first.neglected.name + '.' }));
    }

    const list = h('ol', { class: 'cats' });
    state.tiers.forEach((tier, i) => {
      const items = S.planForTier(state, date, tier.id);
      const entries = S.logsForTier(state, date, tier.id);
      const done = entries.length > 0;

      const body = h('div', { class: 'cat-body' });

      if (items.length) {
        body.appendChild(h('ul', { class: 'items' }, items.map((it) => {
          const hit = S.logsForItem(state, date, it.id).length > 0;
          return h('li', { class: hit ? 'done' : '' },
            h('span', { class: 'box', 'aria-hidden': 'true' }, hit ? '✓' : ''),
            h('span', { class: 'label', text: it.title }));
        })));
      }

      if (entries.length) {
        body.appendChild(h('ul', { class: 'entries' }, entries.map((l) => {
          const item = l.itemId ? items.find((x) => x.id === l.itemId) : null;
          const text = item && l.text ? item.title + ' — ' + l.text : (l.text || (item ? item.title : 'did it'));
          return h('li', {},
            h('span', { class: 'bullet', 'aria-hidden': 'true' }),
            h('span', { class: 'text', text }),
            h('button', { class: 'del', type: 'button', 'aria-label': 'Remove', onclick: () => commit(S.removeLog(state, l.id)) }, '×'));
        })));
      }

      if (ui.adding === tier.id) {
        const input = h('input', { type: 'text', id: 'add-' + tier.id, placeholder: 'What did you do?', 'aria-label': 'What did you do for ' + tier.name, autocomplete: 'off' });
        const save = () => {
          const text = input.value.trim();
          if (!text) { ui.adding = null; render(); return; }
          commit(S.addLog(state, date, tier.id, text));
        };
        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') { e.preventDefault(); save(); }
          if (e.key === 'Escape') { ui.adding = null; render(); }
        });
        body.appendChild(h('div', { class: 'addrow' },
          input,
          h('button', { class: 'btn primary', type: 'button', onclick: save }, 'Save')));
      } else {
        body.appendChild(h('button', {
          class: 'add', type: 'button',
          onclick: () => { ui.adding = tier.id; render(); },
        }, done ? '+ add another' : '+ I did this'));
      }

      list.appendChild(h('li', { class: 'cat ' + (done ? 'done' : '') },
        h('div', { class: 'cat-head' },
          h('span', { class: 'num', text: String(i + 1) }),
          h('h2', { text: tier.name }),
          h('span', { class: 'mark', 'aria-hidden': 'true', text: done ? '✓' : '' })),
        body));
    });

    parts.push(list);
    return h('div', {}, parts);
  }

  // ---- Tonight ------------------------------------------------------------

  function renderTonight() {
    const date = ui.date;
    return h('div', {}, renderPlanner(S.shiftDateKey(date, 1), date), renderCheckin(date));
  }

  function renderPlanner(target, from) {
    const wrap = h('div', { class: 'section' },
      h('h2', { text: 'Priorities for ' + relativeName(target) }),
      h('p', { class: 'lede', text: 'Optional. Add anything specific you want to hit, under the category it belongs to.' }));

    if (S.planFor(state, from).length) {
      wrap.appendChild(h('div', { class: 'actions', style: 'margin-top:12px' },
        h('button', { class: 'btn small', type: 'button', onclick: () => {
          commit(S.seedPlanFromDate(state, target, from));
          toast('Copied ' + relativeName(from) + '’s list');
        } }, 'Copy ' + relativeName(from))));
    }

    state.tiers.forEach((tier, i) => {
      const items = S.planForTier(state, target, tier.id);
      const cat = h('div', { class: 'plan-cat' },
        h('h3', {}, h('span', { class: 'num', text: String(i + 1) }), tier.name));

      items.forEach((it) => {
        const title = h('input', { type: 'text', id: 'plan-' + it.id, value: it.title, 'aria-label': 'Priority' });
        title.addEventListener('change', () => commit(S.updatePlanItem(state, target, it.id, { title: title.value })));
        cat.appendChild(h('div', { class: 'plan-row' },
          title,
          h('button', { class: 'btn icon danger', type: 'button', 'aria-label': 'Remove', onclick: () => commit(S.removePlanItem(state, target, it.id)) }, '×')));
      });

      const add = h('input', { type: 'text', id: 'planadd-' + tier.id, placeholder: 'Add something specific', 'aria-label': 'Add a priority to ' + tier.name });
      const submit = () => {
        if (!add.value.trim()) return;
        commit(S.addPlanItem(state, target, tier.id, add.value, ''));
        const again = document.getElementById('planadd-' + tier.id);
        if (again) again.focus();
      };
      add.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
      cat.appendChild(h('div', { class: 'plan-add' }, add, h('button', { class: 'btn small', type: 'button', onclick: submit }, 'Add')));

      wrap.appendChild(cat);
    });

    return wrap;
  }

  function renderCheckin(date) {
    const summary = S.daySummary(state, date);
    const existing = summary.reflection;
    const draft = {
      tierScores: existing ? { ...existing.tierScores } : {},
      crowdedOut: existing ? existing.crowdedOut : '',
      note: existing ? existing.note : '',
    };

    const recap = h('div', { class: 'recap' }, summary.tiers.map((t) => {
      const lines = tierEntryLines(t.tierId, date);
      return h('div', { class: 'recap-row' },
        h('span', { class: 'name', text: t.name }),
        h('span', { class: 'items-text ' + (lines.length ? '' : 'none'), text: lines.length ? lines.join(' · ') : 'nothing' }));
    }));

    const scoreGrid = h('div', { class: 'score-grid' }, state.tiers.map((tier) => {
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
      return h('div', { class: 'score-row' }, h('span', { class: 'name', text: tier.name }), segs);
    }));

    const crowded = h('textarea', { id: 'crowded', rows: '2' });
    crowded.value = draft.crowdedOut;
    const note = h('textarea', { id: 'note', rows: '3' });
    note.value = draft.note;

    const save = () => {
      commit(S.saveReflection(state, date, { tierScores: draft.tierScores, crowdedOut: crowded.value, note: note.value }));
      toast('Saved');
    };

    return h('div', { class: 'section' },
      h('h2', { text: 'How ' + relativeName(date) + ' went' }),
      recap,
      h('p', { class: 'lede', style: 'margin-top:18px', text: 'Score each one from 1 to 5. Tap again to clear.' }),
      scoreGrid,
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

  function tierEntryLines(tierId, date) {
    const plan = S.planFor(state, date);
    return S.logsForTier(state, date, tierId).map((l) => {
      const it = l.itemId ? plan.find((x) => x.id === l.itemId) : null;
      if (it && l.text) return it.title + ' — ' + l.text;
      return l.text || (it ? it.title : 'did it');
    });
  }

  // ---- History ------------------------------------------------------------

  function renderHistory() {
    const days = S.history(state, today(), 60);
    if (!days.length) {
      return h('div', {}, h('p', { class: 'lede', style: 'margin-top:18px', text: 'Nothing recorded yet.' }));
    }

    const list = h('ul', { class: 'history' }, days.map((d) => {
      const dots = h('span', { class: 'dots' }, d.tiers.map((t) =>
        h('i', { class: 'dot ' + (t.active ? 'on' : ''), title: t.name + ': ' + t.logCount })));
      const rows = d.tiers.map((t) => {
        const lines = tierEntryLines(t.tierId, d.date);
        return h('div', { class: 'recap-row' },
          h('span', { class: 'name' }, t.name, t.score ? ' · ' + t.score + '/5' : ''),
          h('span', { class: 'items-text ' + (lines.length ? '' : 'none'), text: lines.length ? lines.join(' · ') : 'nothing' }));
      });
      const r = d.reflection;
      return h('li', {},
        h('details', { class: 'day' },
          h('summary', {},
            h('span', { class: 'date', text: fmtShort(d.date) }),
            dots,
            h('span', { class: 'meta', text: d.activeTiers + '/' + d.tiers.length })),
          h('div', { class: 'day-body' },
            rows,
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

    wrap.appendChild(h('div', { class: 'section' },
      h('h2', { text: 'Your order' }),
      h('p', { class: 'lede', text: 'Top of the list wins the day. Rename or reorder as your life changes.' })));

    state.tiers.forEach((tier, i) => {
      const nameInput = h('input', { type: 'text', id: 'tier-' + tier.id, value: tier.name, 'aria-label': 'Category name' });
      nameInput.addEventListener('change', () => commit(S.renameTier(state, tier.id, nameInput.value)));
      wrap.appendChild(h('div', { class: 'edit-cat' },
        h('div', { class: 'edit-cat-head' },
          h('span', { class: 'num', text: String(i + 1) }),
          nameInput,
          h('button', { class: 'btn icon', type: 'button', 'aria-label': 'Move up', disabled: i === 0, onclick: () => commit(S.moveTier(state, tier.id, -1)) }, '↑'),
          h('button', { class: 'btn icon', type: 'button', 'aria-label': 'Move down', disabled: i === state.tiers.length - 1, onclick: () => commit(S.moveTier(state, tier.id, 1)) }, '↓'),
          h('button', { class: 'btn icon danger', type: 'button', 'aria-label': 'Delete', onclick: () => {
            if (confirm('Delete "' + tier.name + '" and everything recorded under it?')) commit(S.removeTier(state, tier.id));
          } }, '×'))));
    });

    const newTier = h('input', { type: 'text', id: 'add-tier', placeholder: 'Add a category' });
    const addTier = () => {
      if (!newTier.value.trim()) return;
      commit(S.addTier(state, newTier.value));
    };
    newTier.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addTier(); } });
    wrap.appendChild(h('div', { class: 'addrow', style: 'margin-top:16px' },
      newTier, h('button', { class: 'btn', type: 'button', onclick: addTier }, 'Add')));

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
      h('p', { class: 'lede', text: 'Everything is stored in this browser only. Export now and then.' }),
      h('div', { class: 'data-tools' },
        h('button', { class: 'btn', type: 'button', onclick: exportJson }, 'Export'),
        h('button', { class: 'btn', type: 'button', onclick: () => fileInput.click() }, 'Import'),
        seed && seed.logs.length
          ? h('button', { class: 'btn', type: 'button', onclick: () => {
              if (confirm('Load the ' + seed.logs.length + ' bundled entries? This replaces what is in this browser.')) {
                // Switch tabs before committing: commit re-renders, and the
                // point of loading is to land on the day itself.
                ui.tab = 'today';
                persistUi();
                commit(seed);
                toast('Loaded');
              }
            } }, 'Load starting data')
          : null,
        fileInput,
        h('span', { class: 'status', text: state.logs.length + ' entries stored.' }))));

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

  render();
})();
