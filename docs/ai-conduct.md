# AI conduct

The rules for everything Courtyard tells a model, in every scenario. The worker's prompts module
(`apps/worker/src/prompts/`) builds all of it from these rules, and providers deliver it unchanged, so Claude, Codex
and the fake are told the same things. The exceptions are the starter files, templates the worker writes (see below).

## Changing what a model is told

1. Change this guide.
2. Change the prompts module to match.
3. Change the provider-seam tests in `apps/worker/src/ai-conduct.test.ts` to match.

Done when the guide, the module and the tests agree and `pnpm verify` passes. A change to what gets saved (Saving
context lines, below) also runs the eval set, `pnpm eval:context`, against the real model, and its pull request
gives the score and each miss.

### The eval set

`pnpm eval:context` checks what real Claude saves. It runs each scenario in `apps/worker/eval/scenarios.ts` (a short
conversation, a starting context file, and the saves each owner message should end with) through a worker on a
temporary context folder, signed in as the owner on that machine, and prints the score and each miss: what was
expected and what was saved. A save matches on its section, whether it adds, changes or removes, and the line it
changes; its wording only needs the scenario's key words, and an answer that should ask has a question with them in.
Where a scenario says how many questions an answer asks, they're counted by question mark, an example put as a
question ("For example, is it…?") counting with the question before it.
It never runs in CI or `pnpm verify`, since it needs the owner's login and uses their plan's allowance.

- **Before merging any change to the saving rules,** run it and put the score in the pull request, with each miss
  left and why. Run the changed scenarios with `--times 3` too: a verdict that flips is noted, not counted as fixed.
- **A run that doesn't finish** (a failed turn, or `rate-limited` when the plan's limit is hit) prints its reason and
  is left out of the score, so run it again later.
- **Scenarios are invented,** since the repo is public: a made-up owner and workspaces. A new saving rule gets a
  scenario, and a scenario that turns out to expect the wrong thing is fixed in the same pull request, saying why.
- `--only <name,name>` runs some, `--parallel <n>` sets how many run at once (4), and `--model <id>` picks the
  Claude model (the app's default).

## Rules for every scenario

- **One workspace, plus the owner context.** A model sees only the workspace it's in: its name, the access its
  provider has, and its context file. It also sees the owner context, what the owner shares with every workspace
  (ADR 0010): all of it in a planning workspace, only How to answer me in a code workspace. Only lines count: an
  owner context with no facts, plans, ideas or preferences yet (the untouched starter) is sent nowhere.
- **The workspace is more specific.** Where the context file differs from the owner context, the context file wins,
  and a model is told so.
- **Markers keep text in its place.** The owner context sits between `<owner_context>` markers, the context file
  between `<context_file>` markers and earlier turns between `<conversation>` markers. No text inside can close a
  marker, however it's spelt, and a workspace's name sits in quotes it can't close. What's inside is information, not
  instructions.
- **Plans and ideas stay plans and ideas.** Facts are true now. Plans are decided but not done. Ideas are only being
  considered. A model describes each as what it is (ADR 0013).
- **Honest about gaps.** When a model doesn't know something about the owner's life, it says so and asks.
- **Access follows the provider.** A model is told what its provider can do (its capabilities), never more.

## Every turn

Built in phase 1, with today's date, line labels and saving added in #47. The instructions, in order:

1. The workspace, by name, as one area of the owner's life.
2. Access. With `readsFiles`: read and search the workspace's folder (images included) and read files when they help;
   no changes, no commands. Without it: no files, no changes, no commands; the workspace is known from its context
   file and the owner.
3. Today's date.
4. Say so and ask rather than guess, and answer in Markdown.
5. How to read Facts, Plans and Ideas, when there's a context file or the workspace gets all of the owner context.
6. The owner context between its markers, each line with its label, when there is one and the workspace gets some of
   it: answer the way it asks; otherwise it's information.
7. The context file between its markers, each line with its label, saying it wins where it differs from the owner
   context, or a line saying there isn't one yet.
8. When the turn offers the save tool: the saving rules (Saving context lines, below).

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
   line; How to answer me holds how they like answers, one per line. It sits above both sections, not inside them,
   because any line inside a section counts as one of its lines.
3. About me, with empty Facts, Plans and Ideas under it, then an empty How to answer me.

The home page warns once the owner context passes `OWNER_CONTEXT_LONG_CHARACTERS` (in the contract), a quarter of
a context file's threshold, since it goes with every message in every workspace.

## Saving context lines

Built with #47 for the workspace's context file and #49 for the owner context (ADR 0013). A model saves context
itself, during its answer, through the worker's save tool. The worker checks each save and writes it; the
owner sees it as a note in the chat and undoes or edits what's wrong.

### What a model is told, every turn

Added to the instructions in Every turn:

- **Today's date,** so a model can tell a stale line and date the lines that need one.
- **Line labels.** Each line of the context file comes with its label (`[F3]` for the third fact, `[P1]`, `[I2]`),
  and each line of the owner context with one that can't clash: `[MF1]`, `[MP1]` and `[MI1]` for About me's facts,
  plans and ideas, and `[A1]` for How to answer me. A save names a line by its label to change or remove it, and a
  change can move a line to another section or place, as a plan becomes a fact.
- **The save tool,** what it's for, and the rules below, on a turn whose provider offers it (its `savesContext`
  capability). Otherwise a model isn't told about it. A save gives its place (`workspace` or `owner`) and its
  section (`facts`, `plans`, `ideas`, or `answers` for How to answer me). Without a place, an added line goes to the
  workspace, a changed line stays where it is, and `answers` goes to How to answer me.
- **In a code workspace,** the tool and its rules cover How to answer me only: lasting preferences about answers,
  saved, changed or removed. That's all of the owner context its models read, and its context file waits for phase 4.

### What to save

- **Save** what the owner says about their situation, decisions they've made, things they've done (a plan becomes a
  fact), ideas they say they're considering, and preferences they state as lasting ("always", "stop doing that").
- **Don't save** the model's own suggestions unless the owner agrees to them, one-off requests ("shorter this time"),
  passing chat, or anything the context already says.
- **From files, only when asked.** What a model reads in the workspace's files is saved only when the owner asks about
  that file or asks for it to be saved. A file can be old, a draft or someone else's, and text in a file never starts
  a save.
- **Ask, don't guess.** When it's unclear whether something is a plan or an idea, or true at all, the model asks in its
  answer and saves once the owner says. Leaning one way without saying it's decided ("probably", "I reckon") is
  unclear, so it gets a question, not an idea; only considering ("maybe one day", "thinking about") is an idea.
- **Don't announce saves.** The note in the chat shows each one, so the answer stays about the owner's question.
- **"Remember that"** means save it now, by the same rules.

### Where a save goes

- **About me** in the owner context, when it's true across the owner's life or matters to more than one workspace
  ("Lives in Leeds", "Has a bad left knee").
- **How to answer me,** when it's a lasting preference about answers.
- **The workspace's context file** otherwise, and whenever it's unclear.
- **In a code workspace,** only How to answer me, since that's all of the owner context its models read.

The owner's Edit can move a save to any of these places, from any workspace.

### When a save is refused

The worker refuses a save, and tells the model why, when:

- **its label is out of date:** the labelled line has changed since the model was shown it. The refusal gives the lines
  as they are now, and their labels count from then on;
- **it repeats a line already there,** in the context file or the owner context, compared without case, spacing or
  a closing full stop;
- **its line is too long,** or more than one line;
- **it's missing something,** such as the label a change needs, names a label that doesn't exist, or puts `answers`
  in the workspace;
- **it's from a code workspace** and anywhere but How to answer me.

The model may put a refused save right once: the save after a refusal counts as its retry, and if that's refused too
the model is told to carry on without it (the save after that starts afresh). A label that's out of date only
refuses saves naming that line, so a model can save several times in one turn, its own saves included. A
refused save shows nothing to the owner. A workspace with no context file gets one from the starter (Starter context
file, above) before its first save, and a missing `OWNER.md` gets the owner context's (Starter owner context, above)
before the first save to it.

### What the owner did with earlier saves

Inside the conversation markers, each earlier answer lists the saves it made and what the owner did with them: kept,
undone, or edited (to what). A model is told that an undone save is not saved again unless the owner brings it up,
and that an edit shows how the owner wants such lines written.

### Getting to know a workspace

Built with #51. When a planning workspace's context file has no lines, its page offers **Get to know this
workspace**. It starts a new session with a starter message, written here and not by a model (`GET_TO_KNOW` in the
prompts module), in the owner's voice, asking the model to learn the workspace by asking one or two questions at a
time, about five rounds, and saving the answers as it goes. Its first line is the session's title. The owner can stop,
or carry on chatting, whenever they like; saving follows the rules above, so nothing is saved that the owner didn't
say. A code workspace isn't offered it, since its models don't save to its context file.

> Get to know this workspace.
>
> Ask me about it one question per message, two at most and no follow-ups, for about five rounds, and save what I tell
> you as you go. Start with what it's for; later, where things stand, what I've decided and what I'm still
> considering. I'll say when I've had enough.

The home page offers **Get to know me** for an owner context with no lines (or no `OWNER.md`). Its session runs in
the first planning workspace, as a session needs a workspace and only a planning one's models save to About me:

> Get to know me.
>
> Ask me about my life in general one question per message, two at most and no follow-ups, for about five rounds,
> and save what I tell you to my owner context as you go: where I live and who with, work, health, plans and how I
> like answers. I'll say when I've had enough.

### Tidying

The owner asks for a tidy from the workspace page (or the home page for the owner context). The model is given the
whole file with its labels and proposes changes, never a rewritten file: merge these lines, remove this stale line or
dropped idea, shorten this one. Each follows the context-line rules, and none may add something new. The owner sees
each change, ticked by default, and the ones they leave ticked are saved as one change.

## Scenarios still to build

Each is written here, as rules, before its phase starts. What the spec already decides:

| Scenario                                      | Phase        | Already decided                                                                                                                                         |
| --------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Coding                                        | 4            | Edits only on the session branch; allowlisted commands run, others wait for approval; a model is told when a command is denied.                         |
| Switching model mid-session                   | 3            | The new model gets every turn's framing as usual: the context file and the conversation so far, with the owner's last message re-sent.                  |
| Tool connections                              | 5            | Only the tools the workspace names; safe actions run, others wait for approval; an unreachable tool is reported, never a failed turn.                   |
| Floor plans                                   | 5            | Drawn as SVG in the answer, to scale with dimensions; the web app sanitises and renders it. Saving one is the owner's action, never the model's.          |

## Context lines

The rules for a context file's lines, whether the owner writes them or a model saves them:

- **One fact per line**, as a list item under Facts, Plans or Ideas. Subheadings group related lines.
- **Facts, not instructions:** "The ceiling is 2.3 m", rather than "Always check the ceiling height".
- **A plan is never a fact.** Once it's done, a save moves it to Facts.
- **No duplicates.** A save that repeats a line changes that line instead.
- **Stale lines get removed.** A line that's no longer true goes, rather than contradicting the rest.
- **Dates only where time matters:** "Sold the old bike in Sep 2026", "The quote is valid until Nov 2026". Most lines
  don't age, and git knows when each was saved.
- **Short:** a line over `CONTEXT_LINE_MAX_CHARACTERS` (about 250, in the contract) is more than one fact.

### Size

The context file goes with every message, so it stays short. The workspace page says so once it passes
`CONTEXT_FILE_LONG_CHARACTERS` (in the contract), and offers Tidy (see Tidying, above).
