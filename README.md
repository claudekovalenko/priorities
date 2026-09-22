# Order of the Day

A daily priorities tracker built around one habit: **each night you set the list of priorities for the next day, and the next day you book what you actually did against that list.** Every day keeps its own list and its own record.

Priorities are filed under categories in a fixed order. The default is **Faith, Family, Finance, Fitness**, then **School**. School is on the list on purpose, and it is last on purpose. Categories can be renamed, reordered, added, or removed.

## The loop

1. **Tonight** — set tomorrow's priorities. Load your usual list, copy today's, or start empty, then edit it to fit tomorrow. Below that, check in on the day that is ending: score each category, name anything that crowded out something higher, add a note.
2. **Today** — write what you just did in one box, then tap the priority it books against. The list below fills in as the day goes.
3. **History** — every day, with the list that was set and what was done against it.
4. **Lists** — your usual list, the one that seeds a new day, plus categories and data export.

## Details worth knowing

- **Each day's list is independent.** Editing tomorrow's list never changes your usual list, and editing your usual list never rewrites a day you already set.
- **Things you did that were not on the list** book under a category instead, and show up separately. Over time that is the clearest signal of what pulls you off plan.
- **If a lower category gets attention while a higher one has nothing booked**, Today says so plainly. That is the whole point of the app.
- **A day with no list** offers to build one from your usual list or from the last day you planned, rather than showing you nothing.
- **Untouched priorities** are listed at check-in time, so the evening review starts from what actually slipped.

Everything is stored in the browser you open it in. Nothing leaves your machine. Export from time to time.

## Installing it on your phone

The app is a PWA, so it installs to your home screen and runs full screen with no browser chrome, offline included. It must be served over HTTPS for this to work. GitHub Pages is enabled on this repo, which serves it at:

```
https://claudekovalenko.github.io/priorities/
```

- **iPhone or iPad (Safari):** open the link, tap Share, then "Add to Home Screen".
- **Android (Chrome):** open the link and accept the install prompt, or use the menu and tap "Install app".
- **Desktop (Chrome or Edge):** open the link and click the install icon in the address bar.

Once installed it opens instantly and works with no signal. Your data lives in that installation, separate from any other browser you opened the app in.

When a new version is deployed, the app notices and offers a Reload button rather than switching under you mid-entry.

## Running it

No build step, no dependencies. Open `index.html` directly, or serve the folder:

```
npm start
```

That runs a static server on port 8080.

## Tests

The state logic in `store.js` is pure and covered by Node's built-in test runner, including migration from the older single-list format:

```
npm test
```

## Layout

| File | Purpose |
| --- | --- |
| `index.html` | Page shell |
| `styles.css` | Theme tokens (light and dark) and layout |
| `store.js` | Pure state functions, no DOM, also loadable in Node |
| `app.js` | Rendering and browser storage |
| `pwa.js` | Install prompt, update prompt, service worker registration |
| `sw.js` | Service worker: offline shell cache |
| `manifest.webmanifest` | App name, icons, colors, standalone display |
| `icons/` | App icons, generated from `icons/icon.svg` |
| `test/store.test.js` | Tests for the state logic |

Every path in the manifest and the service worker is relative, so the app works whether it is served from a domain root or a subdirectory like `/priorities/`.

When you change `styles.css`, `app.js`, or any other shell file, bump `CACHE` in `sw.js` so installed copies pick the change up.

## Data model

```
tiers      ordered categories
template   your usual list, used to seed a day
plans      { "2026-09-21": [ { id, tierId, title, note } ] }   one list per day
logs       { id, date, tierId, itemId | null, text, at }       itemId null = off the list
reflections{ "2026-09-21": { tierScores, crowdedOut, note } }
```
