/*
 * Installability and offline wiring. Kept separate from app.js so the app
 * runs identically when these are unavailable (a file:// open, a sandboxed
 * frame, or a browser without service workers).
 */
(function () {
  'use strict';

  // ---- Deep link from a manifest shortcut: ?tab=tonight ------------------

  try {
    const tab = new URLSearchParams(location.search).get('tab');
    const allowed = ['today', 'tonight', 'history', 'lists'];
    if (tab && allowed.includes(tab)) {
      localStorage.setItem('priorities-tracker-ui', JSON.stringify({ tab }));
      history.replaceState(null, '', location.pathname);
    }
  } catch (e) {
    /* storage or URL unavailable: open on the default tab */
  }

  // ---- A small bar at the bottom for install and update prompts ----------

  function bar(message, actionLabel, onAction) {
    const el = document.createElement('div');
    el.className = 'pwa-bar';
    const text = document.createElement('span');
    text.textContent = message;
    const act = document.createElement('button');
    act.type = 'button';
    act.className = 'btn primary small';
    act.textContent = actionLabel;
    act.addEventListener('click', () => { el.remove(); onAction(); });
    const dismiss = document.createElement('button');
    dismiss.type = 'button';
    dismiss.className = 'pwa-dismiss';
    dismiss.setAttribute('aria-label', 'Dismiss');
    dismiss.textContent = '×';
    dismiss.addEventListener('click', () => el.remove());
    el.append(text, act, dismiss);
    document.body.appendChild(el);
    return el;
  }

  // ---- Install ------------------------------------------------------------

  let installEvent = null;
  const INSTALL_DISMISSED = 'priorities-install-dismissed';

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    installEvent = e;
    let dismissed = false;
    try {
      dismissed = localStorage.getItem(INSTALL_DISMISSED) === '1';
    } catch (err) {
      /* ignore */
    }
    if (dismissed) return;
    const el = bar('Add Order of the Day to your home screen.', 'Install', async () => {
      if (!installEvent) return;
      installEvent.prompt();
      await installEvent.userChoice;
      installEvent = null;
    });
    el.querySelector('.pwa-dismiss').addEventListener('click', () => {
      try {
        localStorage.setItem(INSTALL_DISMISSED, '1');
      } catch (err) {
        /* ignore */
      }
    });
  });

  window.addEventListener('appinstalled', () => {
    installEvent = null;
    try {
      localStorage.setItem(INSTALL_DISMISSED, '1');
    } catch (e) {
      /* ignore */
    }
  });

  // ---- Service worker -----------------------------------------------------

  if (!('serviceWorker' in navigator) || !window.isSecureContext) return;

  window.addEventListener('load', () => {
    // A page with no controller yet is a first install. The worker claiming
    // it is not an update, so it must not trigger a reload.
    const hadController = !!navigator.serviceWorker.controller;

    navigator.serviceWorker.register('./sw.js').then((reg) => {
      // A worker already waiting means an update is ready from a previous visit.
      if (reg.waiting && navigator.serviceWorker.controller) offerUpdate(reg.waiting);

      reg.addEventListener('updatefound', () => {
        const next = reg.installing;
        if (!next) return;
        next.addEventListener('statechange', () => {
          // Only an update, not the very first install.
          if (next.state === 'installed' && navigator.serviceWorker.controller) offerUpdate(next);
        });
      });
    }).catch(() => {
      /* offline support unavailable; the app still works */
    });

    let reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController || reloading) return;
      reloading = true;
      location.reload();
    });
  });

  function offerUpdate(worker) {
    bar('A new version is ready.', 'Reload', () => worker.postMessage('skip-waiting'));
  }
})();
