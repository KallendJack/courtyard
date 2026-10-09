# Courtyard

A self-hosted app for planning projects and writing code with AI models, where each area of the owner's life keeps its
own context so nothing has to be re-explained.

## Language

### Parts of an install

**Courtyard**:
One owner's complete install: a worker and a web app.
_Avoid_: hub, platform, system, dashboard

**Owner**:
The one person a Courtyard belongs to, and the only person who can log in to it.
_Avoid_: user, admin, account

**Device login**:
One device's login to Courtyard, kept in a cookie until that device logs out. Each device has its
own, so logging out on one leaves the others logged in.
_Avoid_: session (that's a conversation), token, account

**Worker**:
The part that does all the work: it holds the context folder, runs sessions, talks to providers and checks the owner's
login.
_Avoid_: backend, server, API, compute node

**Live copy**:
The clone of `main` the everyday Courtyard runs from, separate from any copy it's developed in, and
updated only when the owner chooses (ADR 0011).
_Avoid_: production, prod, deployment, release

**Web app**:
The part the owner opens in a browser. Static files that show things and call the worker; it does no model work and
stores nothing.
_Avoid_: frontend, client, UI server

### Context

**Context folder**:
The git repository on the worker machine that holds every workspace and the owner context. Its backup lives on a git
remote the owner chooses.
_Avoid_: knowledge base, vault, RAG store

**Workspace**:
One folder in the context folder, covering one area of the owner's life or one project.
_Avoid_: project, space, room, context (on its own)

**Context file**:
A workspace's `CONTEXT.md`: its key facts, plans and ideas, which every model reads first.
_Avoid_: system prompt, memory, notes

**Owner context**:
`OWNER.md` at the top of the context folder: what's true across the owner's whole life (About me) and how they like
answers (How to answer me). Every model reads it before the workspace's context file, except that a code workspace's
models read only How to answer me (ADR 0010).
_Avoid_: profile, global context, memory, system prompt, about me (that's one of its sections)

**Fact**:
A line in a context file's Facts section: something true now.
_Avoid_: truth, state

**Plan**:
A line in a context file's Plans section: something decided but not done yet.
_Avoid_: decision, todo, goal

**Idea**:
A line in a context file's Ideas section: something being considered.
_Avoid_: maybe, wish

**Save**:
A model adding, changing or removing one line of a context file or the owner context during a turn, through the
worker. It names its section (fact, plan or idea, or a preference) and is committed at once; the owner undoes or
edits it afterwards (ADR 0013).
_Avoid_: suggestion (that was ADR 0005's tick-first way), memory, update, write

**Place**:
Which file a line is written in: the workspace's context file (`workspace`) or the owner context (`owner`). A save
names its place, and the owner's Edit can move a line from one to the other (ADR 0013).
_Avoid_: target, destination, scope

**Line label**:
The short tag the worker puts before each line when a model reads a context file (`F3`, `P1`, `I2`) or the owner
context (`MF1`, `MP1`, `MI1` for About me, `A1` for How to answer me), so a save can name the line it changes or
removes. Never stored in the file.
_Avoid_: line number, id, index

**Change**:
One committed difference to the context folder: a save, an undo, an edit, a hand edit, a tidy, a workspace added,
renamed or archived in the app, or a fresh start. The worker makes them one at a time.
_Avoid_: commit (that's how it's kept), revision, update

**Recent changes**:
The list of changes to a workspace's context file or the owner context, newest first, each with Undo, on a page of
its own linked from the workspace page (and the home page).
_Avoid_: history, log, activity (that's a model's doing in a session)

**Tidy**:
The owner asking a model for a shorter context file. Unlike a save, it's proposed first: each change it proposes is
ticked by default, and the owner unticks any they don't want.
_Avoid_: compact, clean up, summarise

**Backup**:
The context folder's copy on a git remote the owner chooses, such as a shared folder on a NAS (ADR 0014), pushed
after every change. The home page says when it's behind.
_Avoid_: sync, mirror, remote (on its own)

**Fresh start**:
Clearing everything from trying Courtyard out, so it starts as on its first run: every workspace, the owner context
and every session go; the owner's login, sign-ins and remembered usage limits stay. The context folder's history keeps
the old files, and the sessions move to a dated folder in the data folder. Recent changes begin again after it.
_Avoid_: reset, factory reset, wipe

**Planning workspace**:
A workspace whose files models may read but not change.
_Avoid_: read-only workspace, chat workspace

**Code workspace**:
A workspace tied to a git repository on the worker machine, where a provider that can code may edit files and run
commands.
_Avoid_: dev workspace, repo workspace

### Models

**Provider**:
A source of models the worker can reach on the owner's own subscription, such as Claude or Codex.
_Avoid_: backend, LLM, vendor, engine, model connection

**Model**:
One specific model offered by a provider.

**Effort**:
How much a model thinks before it answers: one of the levels its provider offers for that model, or the model's
default. Chosen beside the model, recorded with each message, and followed by the session until the owner changes it.
_Avoid_: thinking, reasoning, mode, speed

**Codex home**:
The folder in the data folder where Courtyard's Codex keeps its sign-in, and nothing else: separate from any Codex the
owner uses elsewhere on the machine (ADR 0015).
_Avoid_: Codex config, profile, ~/.codex

**Sign-in**:
A provider's own login, for a provider whose sign-in Courtyard handles (Codex's): started from the home page with a
link and a one-time code to finish on any device, and kept in the provider's own home. Courtyard sees only the link
and code. The owner can say Not now to it (ADR 0015).
_Avoid_: device login (that's the owner's login to Courtyard), token, credentials

**Usage limit**:
The point at which a provider stops answering until a reset time, under the owner's subscription. The worker remembers
it until then, and the model picker shows it.
_Avoid_: quota, rate limit (except for the failure reason)

**Skill**:
A folder of instructions a model loads when it needs them, such as grilling a plan, in the open Agent Skills format.
The owner starts one from a button or the skill picker, or a model loads one when its description fits. Courtyard
loads them itself, never a provider's own skills (ADR 0016). Once started or loaded, a skill stays in use for the rest
of its session. Each comes from one of four places, its **source**: the owner's for one workspace (Yours), a code
workspace's project, the owner's for every workspace (Yours, everywhere), or a house skill.
_Avoid_: prompt, plugin, command, agent

**Skill picker**:
The list of a workspace's skills that opens from the message box (a `/` at its start, or the Skill pill), or as a
sheet on a phone. A picked skill sits in the box as a tag and goes with the message.
_Avoid_: slash command, skill menu

**House skill**:
A skill that comes with Courtyard, in the `@courtyard/skills` package. The owner's own skills, and a project's, with
the same name replace it (ADR 0016).
_Avoid_: built-in skill, default skill

**Overflow**:
Continuing a session on another provider's model after a usage limit is hit. The owner chooses it with Carry on, on
the failed turn; it never happens by itself, and the session stays on the new model until the owner switches back.
_Avoid_: fallback, failover

### Sessions

**Session**:
One ongoing conversation in a workspace. It keeps running on the worker whether or not anyone is watching.
_Avoid_: chat, thread, job, conversation

**Turn**:
One message from the owner and everything the model does in response to it.
_Avoid_: request, run, completion

**Event**:
One recorded thing that happened in a session.
_Avoid_: message, chunk, log line

**Suggested reply**:
A short reply a model offers under its question, two or three at a time, which the owner taps to send as their next
message (ADR 0017).
_Avoid_: quick reply, chip, option, tap answer

**Stop**:
The owner ending a running turn early. Whatever the model wrote so far stays, and the turn is
recorded as stopped, apart from failures.
_Avoid_: cancel, abort, interrupt (that's the worker stopping mid-turn)

**Event log**:
The complete, ordered record of a session's events, which is only ever added to.
_Avoid_: history, transcript

**Activity**:
An event saying what a model is doing: a file it read, a skill it loaded (or one of the skill's files), a command it
ran, a tool connection it used.
_Avoid_: tool call, step, trace

**Approval**:
The owner's yes or no to something a model wants to do that could change things: a command outside the command
allowlist, or an action of a tool connection that is not a safe action.
_Avoid_: permission, confirmation, prompt

**Command allowlist**:
The commands a code workspace lets a model run without an approval.
_Avoid_: whitelist, safe commands

**Session branch**:
The git branch, checked out in its own folder (a worktree), that holds everything a session changed in a code
workspace until the owner merges or discards it.
_Avoid_: feature branch, working branch, task branch

**Notification**:
A push message to the owner's devices saying a session needs them or has finished.
_Avoid_: alert, ping

### Tools

**Tool connection**:
An outside tool (an MCP server) that a workspace lets a model use, such as a design app or a homelab.
_Avoid_: integration, plugin, connector, MCP (on its own)

**Safe action**:
An action of a tool connection that only looks at things, and so runs without an approval. The owner's settings decide
which actions are safe, not the tool's author.
_Avoid_: read-only tool, allowed tool
