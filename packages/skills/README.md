# @courtyard/skills

Courtyard's house skills (ADR 0016), a folder each in the Agent Skills format, and the format check every skill passes
before a model gets it (`index.ts`). `skills.json` lists each house skill: the kinds of workspace that get it, whether
only the owner starts it, and its mark in the app. A skill with `scripts/` is listed for code workspaces only, since
planning workspaces have no shell. `matt.json` pins the release of Matt Pocock's skills code workspaces get (ADR 0024).

| Skill | Workspaces | Started by | What it does |
| --- | --- | --- | --- |
| `grilling` | planning, code | owner or model | Questions a plan until it holds up |
| `get-to-know` | planning | owner | Fills a workspace's context file by asking |
| `get-to-know-me` | planning | owner | Fills the owner context by asking |
| `review-use` | code | owner | Reads real use and suggests keep, fix or remove for each recent feature |

`pnpm -C packages/skills exec vitest run` runs the format check on every house skill and Review use's script on a
temporary data folder.
