# Code workspaces load Matt Pocock's skills as a plugin, from a pinned copy

An exception to ADR 0016 for code workspaces, decided on #88 (2026-10-11) and built with #181. The house process is
Matt Pocock's skills as they are (ADR 0018), and the owner wants to build Courtyard in Courtyard with no setup per
project. His skills chain the way he wrote them ("call the Skill tool with `tdd`"), which only Claude Code's own skill
loading does; Courtyard's use skill tool can't stand in for it. So in a code session, and only there, the Claude
adapter hands Claude Code **Courtyard's pinned copy of his plugin** as a local plugin (`plugins: [{ type: "local",
path }]` in the Agent SDK), with only the skills the workspace can use turned on by name (`mattpocock-skills:tdd`).

- **The pinned copy.** `packages/skills/matt.json` names his release (its version, from his own plugin list,
  github.com/mattpocock/skills, tag `v<version>`), the checksum of the copy Courtyard keeps, and the ones the Skill
  picker lists. The worker fetches that release into the data folder (`matt-skills/<version>/`) when it's missing or
  the pin has moved on, keeps only his `plugin.json`, his licence and the skills `plugin.json` lists (engineering and
  productivity, none of `in-progress/` or `misc/`), and loads it only when its checksum matches. A copy that doesn't,
  or a `plugin.json` that would bring anything but skills (hooks, MCP servers, commands, agents), isn't loaded, and
  the workspace's Skills section says why. The checksum is SHA-256 over each kept file's path and its own SHA-256,
  checked out byte for byte, so it's the same on every machine.
- **Never the machine's plugins.** Claude Code still looks for installed plugins in an empty folder of the turn's own
  (ADR 0022), and the owner's own plugin folders (`CLAUDE_CODE_PLUGIN_DIRS`) are taken out of every turn's
  environment. Planning workspaces never get the copy, and keep ADR 0016's use skill tool, as Codex does.
- **One grilling.** His skills sit between the owner's and the house skills, so his `grilling` replaces Courtyard's in
  a code workspace. While his copy can't be loaded, the house one is still there.
- **Starting one.** The Skill picker lists the ones the owner starts (`picker` in `matt.json`: implement,
  implement-spec, to-spec, to-tickets, triage, code-review, pr, grill-with-docs, wayfinder, prototype, research), and
  a message beginning with a skill's name (`/implement 157`) starts it too, in any workspace; the worker puts it in
  the turn as for every owner-started skill (ADR 0016). The rest Claude loads when they fit, with its Skill tool,
  which the adapter's hook allows only for a skill the turn turned on, reporting each, as it reports each read of a
  skill's own files in the copy.
- **What his skills run.** The command allowlist lets a code session file, edit, comment on and close the
  repository's issues, make and list its labels, and read through `gh api` (GET only), still only through
  Courtyard's GitHub sign-in.
- **His setup, once per repository, without a conversation.** His `setup-matt-pocock-skills` asks questions whose
  answers are fixed in the house process (GitHub, the default triage labels, one glossary and `docs/adr/`). So when a
  code workspace's page opens, Courtyard checks the repository's default branch for what that skill writes
  (`docs/agents/issue-tracker.md`, `triage-labels.md`, `domain.md`, and the Agent skills section in AGENTS.md, or
  CLAUDE.md when there's only that) and its triage labels on GitHub, and offers what's missing as one approval card.
  Allowed, the labels are made through the GitHub sign-in, and the files, written from his templates in the pinned
  copy, go on a branch of their own (`courtyard/matt-setup-…`) with a pull request. Not now isn't asked again.
- **Keeping current (#84).** A weekly workflow on Courtyard's repository compares the pin with his latest release
  and, when it's behind, opens an issue with his CHANGELOG lines and the new `matt.json`. Merging the bump reaches
  every code workspace at the next Update.

## Considered options

- **Courtyard's use skill tool for code workspaces too** (ADR 0016 unchanged). Rejected: his skills call each other
  by Claude Code's Skill tool, his owner-only ones are Claude Code's `disable-model-invocation`, and sub-agents
  (#117) need Claude Code's own loading.
- **The machine's installed plugin** (the owner's own, auto-updating). Rejected: it's the machine's setup, which ADRs
  0003 and 0022 keep out, and the version would change under a session without a PR.
- **A vendored copy in this repository.** Rejected: every release would be a large diff to review, and the copy could
  drift from his. The pin is one line and a checksum.
- **Creating `GLOSSARY.md` and `docs/adr/` in the setup check,** as #181 first said. Not done: his `domain.md` says
  they're created lazily, by `domain-modeling`, and not to suggest them up front (ADR 0018: his way where he has one).
- **A pull request from the weekly check.** GitHub Actions can't open pull requests on this repository (its setting is
  off), and one opened by the workflow's token wouldn't run CI, so it opens an issue for an agent or the owner to
  make the one-line bump.

## Consequences

- **Codex can't use his skills this way.** It can't code yet (ADR 0015); when it can, it needs a route of its own.
- **Starting the worker needs GitHub once per release**, to fetch the copy. Until it can, code workspaces work
  without his skills, and the Skills section says why; a failed fetch is tried again after a while.
- **A turn's Skill tool listing comes from Claude Code,** not Courtyard's framing, so the eval set doesn't score which
  of his skills load; his are his to test.
- **A setup pull request isn't a session.** The owner reviews and merges it on GitHub.
