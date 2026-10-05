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

**Web app**:
The part the owner opens in a browser. Static files that show things and call the worker; it does no model work and
stores nothing.
_Avoid_: frontend, client, UI server

### Context

**Context folder**:
The git repository on the worker machine that holds every workspace. Its main copy lives on a git remote the owner
chooses.
_Avoid_: knowledge base, vault, RAG store

**Workspace**:
One folder in the context folder, covering one area of the owner's life or one project.
_Avoid_: project, space, room, context (on its own)

**Context file**:
A workspace's `CONTEXT.md`: its key facts, plans and ideas, which every model reads first.
_Avoid_: system prompt, memory, notes

**Fact**:
A line in a context file's Facts section: something true now.
_Avoid_: truth, state

**Plan**:
A line in a context file's Plans section: something decided but not done yet.
_Avoid_: decision, todo, goal

**Idea**:
A line in a context file's Ideas section: something being considered.
_Avoid_: maybe, wish

**Suggestion**:
A change to a context file that a model proposes when the owner asks, labelled as a fact, plan or idea. It is applied
only if the owner ticks it.
_Avoid_: memory, update, edit

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

**Usage limit**:
The point at which a provider stops answering until a reset time, under the owner's subscription.
_Avoid_: quota, rate limit (except for the failure reason)

**Overflow**:
Continuing a session on another provider's model after a usage limit is hit.
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

**Event log**:
The complete, ordered record of a session's events, which is only ever added to.
_Avoid_: history, transcript

**Activity**:
An event saying what a model is doing: a file it read, a command it ran, a tool connection it used.
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
