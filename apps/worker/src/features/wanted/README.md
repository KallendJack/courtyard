# wanted

A planning workspace's wanted list (#245): its Things wanted or to replace, each with up to three picks chosen for
value (★ Best value, Cheapest that does the job, Worth stretching for), their prices checked on the web by a short
background turn, and the shops the owner blocked.

**Example:** Mountain biking wants Lights. You tap Find picks: a turn on Claude's errand model (Sonnet at Low)
searches, reads each shop's page and saves three picks, ★ the Magicshine Allty at £55 from Tredz, in the sale from
£72. A week later you open the list, and its prices are checked again, quietly, once that day. You say "not from
Tredz": the session's model blocks Tredz, and the Lights get new picks elsewhere.

- **Uses:** `things/` (the Things, read), `workspaces/` (blocked shops, in `workspace.json`), `context-folder/`
  (Unblock, a change with Undo), `prompts/` (the price check's instructions, message and picks tool), `providers/`
  (each provider's `errand` model), `lib/files.ts`.
- **Used by:** `worker.ts`, `sessions/` (`WantedHooks`: each wanted Thing's ★ pick in a turn's Things, and a shop a
  model blocked); in the web app, `features/wanted/` and the Blocked shops sheet.

## API

- `GET /api/workspaces/:id/wanted`: `WantedList`, each wanted Thing's picks, ★ first, whether its picks are being
  found, and whether prices are being checked. Asking is opening it: prices over a week old are checked again, at
  most once a day per workspace.
- `POST /api/workspaces/:id/wanted/:slug/find`: Find picks, in the background; 202 with the list as it is then, 404
  for a Thing that isn't wanted, 409 when no errand model is on offer.
- `GET /api/workspaces/:id/blocked-shops`: `BlockedShops`.
- `POST /api/workspaces/:id/blocked-shops/unblock`: `ShopUnblock`, a change ("Unblock shop: Tredz") with Undo.

## How it works

- **Picks are Courtyard's own state,** kept in the data folder (`wanted/<workspace>.json`: each Thing's picks by its
  file's name, and the day the last weekly check started), not the context folder: they're found again on the web, so
  they're no change to undo. A Thing's file keeps its name when it's renamed, so its picks stay with it.
- **A price check** is one turn through the provider seam's `runTurn`, outside any session: the first provider whose
  `errand` model is on offer and not at its limit, that searches the web and takes Courtyard's tools, with web
  search (confined as a session's is, ADR 0019), the `save_picks` tool and nothing else
  (docs/ai-conduct.md, The wanted list). It runs in the background, stopped after ten minutes. Each call is checked
  (one pick of each kind, always a best-value one, `https://` pages, no blocked shop, a usual price only for a sale)
  and kept at once, its price checked as of then, so a check cut short keeps what it found.
- **When:** Find picks, for one Thing; opening the list, for the Things with a price over a week old; and a shop
  blocked, for the Things with a pick from it.
- **Blocked shops** are kept in the workspace's `workspace.json` (`blockedShops`), blocked by a session's
  `block_shop` tool and unblocked from the ⋯ menu's Blocked shops, each a change to the context folder.
