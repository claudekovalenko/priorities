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
| `test/store.test.js` | Tests for the state logic |

## Data model

```
tiers      ordered categories
template   your usual list, used to seed a day
plans      { "2026-09-21": [ { id, tierId, title, note } ] }   one list per day
logs       { id, date, tierId, itemId | null, text, at }       itemId null = off the list
reflections{ "2026-09-21": { tierScores, crowdedOut, note } }
```
