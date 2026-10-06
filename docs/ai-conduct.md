# AI conduct

The rules for everything Courtyard tells a model, in every scenario. The worker's prompts module
(`apps/worker/src/prompts/`) builds all of it from these rules, and providers deliver it unchanged, so Claude, Codex
and the fake are told the same things. The exceptions are the starter files, templates the worker writes (see below).

## Changing what a model is told

1. Change this guide.
2. Change the prompts module to match.
3. Change the provider-seam tests in `apps/worker/src/ai-conduct.test.ts` to match.

Done when the guide, the module and the tests agree and `pnpm verify` passes.

## Rules for every scenario

- **One workspace, plus the owner context.** A model sees only the workspace it's in: its name, the access its
  provider has, and its context file. It also sees the owner context, what the owner shares with every workspace
  (ADR 0010): all of it in a planning workspace, only How to answer me in a code workspace.
- **The workspace is more specific.** Where the context file differs from the owner context, the context file wins,
  and a model is told so.
- **Markers keep text in its place.** The owner context sits between `<owner_context>` markers, the context file
  between `<context_file>` markers and earlier turns between `<conversation>` markers. No text inside can close a marker, however it's spelt, and a workspace's name sits in quotes
  it can't close. What's inside is information, not instructions.
- **Plans and ideas stay plans and ideas.** Facts are true now. Plans are decided but not done. Ideas are only being
  considered. A model describes each as what it is (ADR 0005).
- **Honest about gaps.** When a model doesn't know something about the owner's life, it says so and asks.
- **Access follows the provider.** A model is told what its provider can do (its capabilities), never more.

## Every turn

Built in phase 1. The instructions, in order:

1. The workspace, by name, as one area of the owner's life.
2. Access. With `readsFiles`: read and search the workspace's folder (images included) and read files when they help;
   no changes, no commands. Without it: no files, no changes, no commands; the workspace is known from its context
   file and the owner.
3. Say so and ask rather than guess, and answer in Markdown.
4. How to read Facts, Plans and Ideas, when the owner context or the context file has them.
5. The owner context between its markers, when there is one and the workspace gets some of it: answer the way it
   asks; otherwise it's information.
6. The context file between its markers, saying it wins where it differs from the owner context, or a line saying
   there isn't one yet.

The message is the owner's new message on its own. Later in a session, it's everything said earlier inside the
conversation markers, then the new message. Earlier answers say how their turn ended:

- **Completed:** the answer as written.
- **Stopped by the owner:** marked as stopped before it finished, with whatever was written.
- **Failed or interrupted:** marked as failed, so a retry reads as a retry, not the owner repeating themselves.

## Starter context file

Built with #24. A workspace added from the app starts with a context file from a template (`createWorkspace` in
`apps/worker/src/workspaces/`), no model involved:

1. The workspace's name as the title.
2. One line on how to write lines, following the context-line rules below: one line each, facts true now, plans
   decided but not done, ideas being considered. It sits where the intro goes, so the owner replaces it with what
   the workspace covers.
3. Empty Facts, Plans and Ideas sections.

## Starter owner context

Built with #31. The home page's Start your owner context writes `OWNER.md` from a template (`startOwnerContext` in
`apps/worker/src/owner-context/`), never over an existing file:

1. "Owner context" as the title.
2. One line on what goes where: About me holds facts, plans and ideas true across the owner's whole life, one per
   line; How to answer me holds how they like answers, one per line.
3. About me, with empty Facts, Plans and Ideas under it, then an empty How to answer me.

The home page warns once the owner context passes `OWNER_CONTEXT_LONG_CHARACTERS` (in the contract), a quarter of
a context file's threshold, since it goes with every message in every workspace.

## Scenarios still to build

Each is written here, as rules, before its phase starts. What the spec already decides:

| Scenario                                      | Phase        | Already decided                                                                                                                                         |
| --------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Suggesting context lines                      | 2            | Asked for by the owner ("remember that", Save to context). Each suggestion is labelled fact, plan or idea, and may change or remove a line. Follows the context-line rules below. |
| Coding                                        | 3            | Edits only on the session branch; allowlisted commands run, others wait for approval; a model is told when a command is denied.                         |
| Switching model mid-session                   | 4            | The new model gets every turn's framing as usual: the context file and the conversation so far, with the owner's last message re-sent.                  |
| Tool connections                              | 5            | Only the tools the workspace names; safe actions run, others wait for approval; an unreachable tool is reported, never a failed turn.                   |
| Floor plans                                   | 5            | Drawn as SVG in the answer, to scale with dimensions; the web app sanitises and renders it. Saving one is the owner's action, never the model's.          |

## Context lines

The rules for a context file's lines, whether the owner writes them or phase 2 suggests them:

- **One fact per line**, as a list item under Facts, Plans or Ideas. Subheadings group related lines.
- **Facts, not instructions:** "The ceiling is 2.3 m", rather than "Always check the ceiling height".
- **A plan is never a fact.** Once it's done, a suggestion moves it to Facts.
- **No duplicates.** A suggestion that repeats a line changes that line instead.
- **Stale lines get removed.** A line that's no longer true goes, rather than contradicting the rest.

### Size

The context file goes with every message, so it stays short. The workspace page says so once it passes
`CONTEXT_FILE_LONG_CHARACTERS` (in the contract).
