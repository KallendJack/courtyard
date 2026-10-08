# Courtyard loads skills itself, from a house package and the owner's folders

A skill is a folder of instructions a model loads when it needs them, such as grilling a plan. Claude and Codex each
load skills their own way, from the worker machine's own setup, which ADRs 0003 and 0015 keep out of Courtyard. So
skills follow the open [Agent Skills](https://agentskills.io/specification) format only (a folder with `SKILL.md`, plus
optional `references/`, `assets/` and `scripts/`, and none of Claude's or Codex's own fields), and the worker loads
them itself. Every provider, the fake included, gets the same skills the same way.

- **House skills** are Courtyard's own, in the `@courtyard/skills` package (`packages/skills`). Its `skills.json`
  names each one, the kinds of workspace that get it (planning, code or both), and whether only the owner can start
  it (`"start": "owner"`). `pnpm verify` checks the list and every skill against the standard's validator.
- **Four places, the more specific winning:** the owner's skills for one workspace (`<workspace>/.agents/skills/` in
  the context folder), a code workspace's project skills (`.agents/skills/` in its repo), the owner's skills for every
  workspace (`.agents/skills/` at the top of the context folder), then house skills. A skill of the owner's with a
  house skill's name replaces it, buttons included. A skill that fails the format check is skipped, with the reason
  shown. The owner's skills are never in the data folder, so they're in git and backed up (ADR 0014).
- **Two ways a skill starts.** The owner starts one with a button (Get to know, Grill this plan) or from the message
  box's skill picker, and the worker puts it into the turn itself, so it works the same on every model. Otherwise
  every turn lists each skill's name and description, and the model loads one through Courtyard's "use skill" tool
  when its description fits, as the Claude apps, ChatGPT and Codex do. The same tool hands over one of a skill's own
  files on request, as text, and nothing outside the skill's folder.
- **No shell, no scripts.** A skill with `scripts/` is only offered in a code workspace, and its scripts wait for
  phase 4's shell. House skills with scripts can only be listed for code workspaces.
- **The owner sees** which skill a model loaded (a line in the chat, like a file read), every skill a workspace gets
  and any problem (a Skills section on the workspace page), and the skill they picked (a tag on their message).

## Considered options

- **Claude's and Codex's own skill loading.** Rejected: each reads the worker machine's own folders, which ADRs 0003
  and 0015 keep out, and they'd behave differently from each other and from the fake.
- **The model always chooses,** with buttons sending a message asking for the skill. Rejected: whether a button works
  would depend on the model, it can't be tested with the fake, and Codex couldn't until it has Courtyard's tools.
- **"Suggest it first" for every skill the owner didn't ask for.** Rejected for what other apps do: use it when its
  description fits, with a switch for the ones only the owner starts.
- **House skills in the worker (`apps/worker/skills/`)** or in `.agents/skills/` in this repo. The owner chose a
  package, so house skills have a clear edge and can move to a repo of their own (#88) whole. `.agents/skills/` here
  is for skills for building Courtyard, which coding agents would otherwise be offered.
- **Matt Pocock's grilling for life workspaces.** Rejected: it's written for coding agents (questions in batches,
  sub-agents, no saving). Courtyard writes its own life skills, following `docs/ai-conduct.md` and scored on the eval
  set. Matt's skills go to code workspaces only, unchanged and pinned (#88, #84).

## Consequences

- **No Claude-only extras,** such as a skill choosing its own model or running in a sub-agent.
- **Skills are text a model reads,** so `docs/ai-conduct.md` gets a Skills section, and the eval set checks that the
  right skill loads, that an unrelated question loads none, and that an owner-only skill never loads by itself.
- **Every turn carries the list,** a name and description per skill, so a workspace with many of the owner's skills
  costs more per turn.
- **Codex gets the "use skill" tool the way it gets Courtyard's file and save tools** (#71), so skills are built after
  that.
