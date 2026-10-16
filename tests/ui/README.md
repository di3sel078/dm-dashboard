# UI checks (optional, dev-only)

These scripts drive the real `index.html`, `rules.js` and `main.js` in [jsdom](https://github.com/jsdom/jsdom). They are not needed to use the app, and jsdom is not a project dependency. Install it somewhere temporary and point Node at it:

```sh
npm install --prefix /tmp/dm-jsdom jsdom@24.1.3
NODE_PATH=/tmp/dm-jsdom/node_modules node tests/ui/migration.js
NODE_PATH=/tmp/dm-jsdom/node_modules node tests/ui/qa-run.js
```

| Script | What it checks |
| --- | --- |
| `migration.js` | Boots with a v1 save. Confirms v2 is written and v1 is left untouched. Then exercises the Phase 1 rules through the cards. |
| `qa-run.js` | The full `docs/QA.md` checklist: 4 PCs plus a legendary boss and a lair action, 3+ rounds using every feature, a reload mid-fight, an export/import round trip, and a player-view leak check. |

jsdom has no layout engine. Visual checks (breakpoints, compact density) were done separately with screenshots; see `docs/QA.md`.
