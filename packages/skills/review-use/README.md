# Review use

A house skill for code workspaces, started by the owner (#606): every couple of weeks, in the Courtyard code
workspace, it reads real use and suggests keep, fix or remove for each user-facing feature merged in the window, so
features nobody uses, or that models misuse, don't pile up (`docs/agents/process.md`, Reviewing use).

- `SKILL.md` is what the model follows: the window, the merged pull requests with a `What's new:` line, the script,
  the review, and filing what the owner ticks (fixes and removals as issues, model mistakes as one context-eval issue).
- `scripts/review-use.ts` reads only `sessions/<session>/session.json` and `events.jsonl` in the data folder, and
  `<workspace>/workspace.json` in the context folder when given it, and prints four sections: Workspaces, What the
  owner said, Signals and Builders. It writes nothing and sends nothing anywhere. Plain Node, so it runs from a
  checkout with nothing installed; the data folder is outside the worktree, so the owner allows each run. Its
  reading is in `scripts/logs.ts` and the builders' timeline in `scripts/builders.ts`.

```sh
node packages/skills/review-use/scripts/review-use.ts --data <data folder> [--context <context folder>] \
  [--since YYYY-MM-DD] [--until YYYY-MM-DD]
```

The window defaults to the 14 days to today. `../review-use.test.ts` runs the script on a temporary data folder.
