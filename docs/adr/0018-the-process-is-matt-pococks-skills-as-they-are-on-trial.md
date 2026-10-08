# The process is Matt Pocock's skills, as they are (on trial)

Status: on trial from 2026-10-08. It becomes the house standard for every code workspace once it has held up and #88
is grilled; until then it can change.

Courtyard's process had grown one ticket at a time: Matt Pocock's skills plus rules of our own around them, some
repeating his, some going against him, and an installed copy three weeks behind his releases. From now on, **how the
repo is worked on is [mattpocock/skills](https://github.com/mattpocock/skills), as it is**, and **what Courtyard is
stays Courtyard's own**.

- **Matt's way wherever he has one,** even where ours was a little different, so there is nothing of ours to keep in
  step with him. His flow: `to-spec` → `to-tickets` → `triage` → `implement` (or `implement-spec` for a spec's tickets,
  helpers in their own worktrees) → `code-review` → `pr`.
- **His files stay his.** `docs/agents/issue-tracker.md`, `triage-labels.md`, `domain.md` and AGENTS.md's Agent skills
  section are what his setup skill writes, word for word; to follow a change of his, run it again.
- **Specs are GitHub issues**, written with `to-spec`. `docs/spec.md` is the original spec, frozen. Order inside a spec
  comes from GitHub's blocked-by links; tickets carry no number of their own.
- **Kept up to date:** his plugin is installed from his own plugin list with auto-update on, not Anthropic's official
  list, which lagged him by three weeks.
- **Ours only where he has no answer and it matters:** milestones as the order of work (`docs/agents/roadmap.md`),
  and Courtyard's content: AGENTS.md's project rules (where code goes, TypeScript, tests, Safety, Paper first), the
  README, the architecture map, `docs/ai-conduct.md`. A PR keeps the README and the map true when it changes what they
  describe.

## Considered options

- **Matt's way, with Courtyard's additions written into his files.** Rejected: re-running his setup to pick up a
  change would wipe or tangle them.
- **Rewriting his rules in our own words.** Rejected: a change of his could no longer be compared with ours, which is
  how a copy falls behind without anyone noticing.
- **Keeping our own versions where they read better** (plain-English PR walkthroughs, a tab per ticket). Rejected by
  the owner: each is something to maintain against his releases.

## Consequences

- **PRs are written with his `pr` skill:** Summary, Evidence, Merge danger. The plain-English walkthrough and
  explain-it-back question are gone.
- **Fewer, bigger PRs** when `implement-spec` runs a spec's tickets together.
- **Issues filed before 2026-10-08** keep their `NN:` titles and `Blocked by:` lines.
- **When Matt changes his flow, we follow by default.** Keeping ours instead needs a reason written here.
