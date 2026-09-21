# Order of the Day

A small daily priorities tracker. It exists to answer one question every evening: did the day follow the order you chose, or the order that shouted loudest?

The default ladder is **Faith, Family, Finance, Fitness**, then **School**. School is on the list on purpose, and it is at the bottom on purpose. You can rename, reorder, add, or remove tiers.

## What it does

- **Today** shows the ladder, top tier first. Each priority has a box where you write what you did for it. Logging anything marks it touched. If a lower tier gets attention while a higher one has nothing logged, a notice says so.
- **Evening** recaps the day in ladder order, then asks you to score each tier from 1 to 5, name anything that crowded out something higher, and add a note.
- **History** lists every day with activity, with a dot per tier so you can see the shape of the week at a glance. Days where the order got flipped are flagged.
- **Edit** manages tiers and priorities, and exports or imports your data as JSON.

Everything is stored in the browser you open it in. Nothing leaves your machine. Export from time to time.

## Running it

No build step, no dependencies. Open `index.html` directly, or serve the folder:

```
npm start
```

That runs a static server on port 8080.

## Tests

The state logic in `store.js` is pure and covered by Node's built-in test runner:

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
