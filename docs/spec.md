# Courtyard

Status: ready-for-agent

Terms are from [`GLOSSARY.md`](../GLOSSARY.md); the decisions behind this spec are in [`adr/`](adr/).

## Problem Statement

I plan physical projects (a home gym, a bike workstation, an office layout, house renovations), run a homelab and build
side projects, and I use AI models for all of it. Four things get in the way:

- My context is trapped in each tool's chat history. Every new chat, or every switch of tool, means re-explaining my
  space, my constraints and my stack.
- When I do re-explain, assistants remember it wrong. One recorded a home gym I was only planning as one I had already
  built, and repeated it back to me as fact.
- I hit my Claude usage limit, switch to another app, and lose my place.
- Per-token API billing gets expensive fast, so anything I build has to run on the subscriptions I already pay for.

There is no single place, reachable from my phone, desk and away from home, where I can move between a renovation plan
and a side project, keep my context true and current, and have a model actually do the coding.

## Solution

Courtyard: a self-hosted app I open on any device. I pick a workspace (one per area of life or project), pick a model,
and talk. Each workspace keeps a short context file split into facts, plans and ideas, so every model starts out
knowing the right things, and it only changes when I tick a model's suggestion. Models can look at the workspace's
files and images. In code workspaces, Claude works on its own branch while I'm away and asks before doing anything
risky; I review and merge from my phone. When Claude's usage limit hits, I carry on in the same session with Codex.
Workspaces can use tools such as my homelab's status server or a design app, but only the workspaces I allow, and
anything that changes things asks me first. It runs on my own machine with my own logins, and the code holds nothing
personal, so anyone can run their own.

## User Stories

### Getting in

1. As the owner, I want to create my login the first time I open Courtyard, so that there is never a default password.
2. As the owner, I want every page and API call to require my login, so that nobody else on my network can start a
   session or change code.
3. As the owner, I want to stay logged in on each of my devices across restarts, so that opening Courtyard is instant.
4. As the owner, I want repeated wrong passwords to be slowed down, so that guessing is impractical.
5. As the owner, I want to log out of a device, so that a lost device can be cut off.
6. As the owner, I want to reach Courtyard at one HTTPS address at home and away, so that every device uses the same
   bookmark.
7. As the owner, I want to install Courtyard on my phone's home screen, so that it opens full screen like an app.
8. As the owner, I want a clear "worker offline" state when the worker machine is off or unreachable, so that I know
   the problem is that machine and not my connection.
9. As the owner, I want Courtyard to recover by itself when the worker comes back, so that I don't have to reload.

### Workspaces and context

10. As the owner, I want a workspace to be a folder in my context folder, so that adding one is creating a directory.
11. As the owner, I want to see all my workspaces and switch between them in one tap, so that moving from a
    renovation plan to a side project is instant.
12. As the owner, I want each workspace to have a context file that every model reads first, so that I never
    re-explain my space, constraints or stack.
13. As the owner, I want the context file split into facts, plans and ideas, so that nothing I'm only planning is
    treated as already true.
14. As the owner, I want to be told when a workspace has no context file, so that I know why a model seems uninformed.
15. As the owner, I want to read a workspace's context file inside Courtyard, so that I can check what models are being
    told.
16. As the owner, I want models to open files and images in the active workspace when they need them, so that I can
    ask about a floor plan or a photo without pasting it.
17. As the owner, I want to add a photo or file to a workspace from my phone, so that a model can see my room or a
    quote.
18. As the owner, I want models confined to the active workspace, so that a question about my garage cannot reach my
    homelab notes or anything else on the machine.
19. As the owner, I want models unable to change a planning workspace's files, so that my notes are never changed
    behind my back.
20. As the owner, I want none of my machine's other AI setup (memories, connectors, global instructions) to leak into a
    workspace, so that each workspace knows only what it should.

### Keeping context true

21. As the owner, I want to say "remember that" or tap Save to context, so that a model suggests changes to the
    context file from the conversation.
22. As the owner, I want each suggestion labelled as a fact, plan or idea, so that a plan can't sneak in as a fact.
23. As the owner, I want to tick the suggestions that are right and drop the rest, so that nothing I haven't approved
    gets in.
24. As the owner, I want to correct a suggestion's wording or section before ticking it, so that a nearly right
    suggestion doesn't have to be dropped.
25. As the owner, I want a suggestion to be able to change or remove an existing line, so that a plan becomes a fact
    once I've done it, and stale lines go.
26. As the owner, I want every applied change committed to the context folder's git repository, so that any change can
    be undone.
27. As the owner, I want those commits pushed to my context folder's remote, so that my context is backed up and
    available to another machine.
28. As the owner, I want to see when a push has failed and have it retried, so that my backup never silently falls
    behind.

### Models

29. As the owner, I want to see which providers are available and why any are not, so that I can fix a missing login.
30. As the owner, I want to use Claude through my subscription login on the worker machine, so that I am not billed per
    token.
31. As the owner, I want to use an API key for Claude instead if I choose, so that Courtyard still works if
    subscription rules change.
32. As the owner, I want Claude to be the default wherever it is available, so that I get the best answers without
    choosing each time.
33. As the owner, I want to pick the model for a session and change it between turns, so that I can use a strong model
    for hard problems and a lighter one for quick questions.
34. As the owner, I want Courtyard never to read, store or log my provider credentials, so that they stay where the
    provider's own tool keeps them.

### Sessions

35. As the owner, I want answers to stream in as they are written, so that I'm not staring at a spinner.
36. As the owner, I want to see what the model is doing (files read, commands run, tools used) as it works, so that I
    can trust the result.
37. As the owner, I want a session to keep running when I lock my phone or close the tab, so that a long task is not
    lost.
38. As the owner, I want to open a session on another device, see everything I missed and follow it live, so that I
    can start at my desk and check from the sofa.
39. As the owner, I want reloading mid-turn to resume the stream with nothing missing or repeated, so that a flaky
    connection costs nothing.
40. As the owner, I want a workspace's past sessions listed newest first, so that I can pick up an old conversation.
41. As the owner, I want my sessions to survive a restart of the worker, so that I don't lose history.
42. As the owner, I want a turn that was running when the worker stopped to show as interrupted, so that I know to
    retry it.
43. As the owner, I want my sessions stored as plain files, so that I can read, back up or delete them without
    Courtyard.
44. As the owner, I want to stop a turn that's going the wrong way, so that it doesn't waste my usage.
45. As the owner, I want text written before a stop to be kept, so that a stopped turn isn't wasted.
46. As the owner, I want a failed turn to say why in plain words and offer a retry, so that I can decide what to do.

### Coding

47. As the owner, I want to mark a workspace as a code workspace and point it at a repository on the worker machine,
    so that a model can work on that codebase.
48. As the owner, I want each coding session to work on its own session branch in its own folder, so that nothing
    reaches my branches until I've reviewed it and my own checkout is never disturbed.
49. As the owner, I want two sessions in one repository not to interfere, so that I can run them side by side.
50. As the owner, I want file edits inside the session branch to apply without asking, so that the model makes
    progress while I'm away.
51. As the owner, I want to list commands (test, lint, typecheck, build) that run without asking, so that the model can
    check its own work.
52. As the owner, I want an allowlisted command to be unable to smuggle in a second command, so that the allowlist
    can't be abused.
53. As the owner, I want any other command to pause for my approval with the exact command shown, so that nothing
    surprising runs on my machine.
54. As the owner, I want to answer an approval with one tap from my phone, so that a paused session isn't stuck until
    I'm at my desk.
55. As the owner, I want an approval answered on one device to disappear on the others, so that I don't answer twice.
56. As the owner, I want a denied command not to run and the model to be told it was denied, so that it can take
    another route.
57. As the owner, I want to see the session branch's diff against the branch it started from, so that I can review the
    work.
58. As the owner, I want to merge or discard a session branch, with discard asking for confirmation, so that the final
    decision is mine.
59. As the owner, I want a merge that would conflict, or would touch uncommitted work in my checkout, to be refused
    with the reason, so that nothing is forced.
60. As the owner, I want a code workspace with a missing or non-git repository path to be unusable with a clear reason,
    so that I can fix the path.
61. As the owner, I want a model that can't code to be refused in a code workspace, so that I don't get a half-working
    session.

### Notifications

62. As the owner, I want a notification when a session needs an approval, so that I don't have to keep checking.
63. As the owner, I want a notification when a long turn finishes or fails, so that I know when to look.
64. As the owner, I want tapping a notification to open that session, so that I'm one tap from answering.
65. As the owner, I want to turn notifications on per device, so that only the devices I choose buzz.

### Overflow

66. As the owner, I want to be told plainly when I've hit a usage limit, with the reset time when known, so that I can
    decide what to do.
67. As the owner, I want to be offered the other available models and continue the same session on one, so that I keep
    working without re-explaining.
68. As the owner, I want the new model to receive the context file and the conversation so far, so that it picks up
    where Claude stopped.
69. As the owner, I want the session to stay on the chosen model until I switch back, so that nothing changes under me.
70. As the owner, I want nothing to switch models automatically, so that I always know which model is answering.
71. As the owner, I want Codex through my ChatGPT plan login, so that overflow is also on a subscription.

### Tools and plans

72. As the owner, I want to give a workspace a tool connection by name, so that a model can use that tool there
    without me copying things in and out.
73. As the owner, I want a tool connection to exist only in the workspaces that name it, so that a garage session can't
    touch my homelab.
74. As the owner, I want a tool connection's safe actions to run without asking and every other action to pause for my
    approval, showing the action and its arguments, so that looking is free and changing is my decision.
75. As the owner, I want tool connections' addresses and credentials in the worker's settings, not in workspaces, so
    that my context folder can be pushed and shared safely.
76. As the owner, I want an unreachable tool connection shown with its reason, without failing the turn, so that I know
    to open the app or start the server.
77. As the owner, I want my homelab's status server as a tool connection in my homelab workspace, so that I can ask
    what's broken without leaving Courtyard.
78. As the owner, I want a design app (Paper) as a tool connection in my side-project workspaces, so that a model can
    draft and edit screens with me.
79. As the owner, I want a model to draw a 2D floor plan to scale in the conversation and redraw it when I ask for a
    change, so that I can decide layouts by looking.
80. As the owner, I want to save a floor plan into the workspace, so that later sessions and models can see it.

### Look and feel

81. As the owner, I want Courtyard to look designed, not like a default template, so that I enjoy opening it.
82. As the owner, I want a layout that fits a narrow phone screen, an unfolded foldable's landscape screen and a
    desktop, so that it's comfortable everywhere I use it.
83. As the owner, I want the app to open fast and switch workspaces instantly, so that it never feels slower than the
    chat apps it replaces.
84. As the owner, I want a long session to stay smooth to scroll and stream into, so that it doesn't slow down as it
    grows.

### Running it

85. As the owner, I want every setting specific to my setup in the worker's settings, so that my copy of the code is
    identical to anyone else's.
86. As the owner, I want a missing or invalid setting to stop the worker with a message naming the setting, so that I
    can fix it quickly.
87. As the owner, I want the web app eventually served from my always-on NAS while the worker stays on my PC, so that
    the page loads even when the PC is off.
88. As the owner, I want a "wake my PC" button when the worker is off, so that I can start it from anywhere.
89. As someone else running their own Courtyard, I want it to work with my own logins and folders and nothing of the
    original owner's, so that I'm not tangled in their setup.
90. As a developer of Courtyard, I want a scripted fake provider, so that I can run and test everything end to end with
    no models and no usage.

## Implementation Decisions

### Shape

- **Two parts and a contract.** A worker (Node, TypeScript, Hono) and a web app (Vite, React, TanStack Router, shadcn
  on Tailwind v4), in one pnpm workspace with a shared contract package of Zod schemas and inferred types. Both sides
  parse at the boundary. See ADR 0001.
- **Same origin.** The web app's static files and the worker's API (under `/api`) share one origin: the worker serves
  the built files at first, and later the owner's reverse proxy serves them and forwards `/api`. In development, Vite
  proxies `/api`. No cross-origin requests and no shared secret.
- **The worker's settings** are environment variables plus one Zod-validated settings file for structured entries
  (tool connections, notification keys path), both outside the repo. The context folder path and the data folder path
  are required (the context folder must exist; the worker creates the data folder); the port
  defaults to 8787; an optional web app folder overrides where the built web app is served from;
  every provider is optional.

### Worker modules

Deep modules, each with a small interface at its root and its implementation private:

- **Config:** reads and validates settings; returns a message naming the bad setting.
- **Auth:** first-run owner creation, a slow password hash on the worker, an HTTP-only session cookie per device,
  logout per device, and slowed responses after wrong passwords.
- **Workspaces:** the catalog of the context folder: id (folder name), display name, mode (planning or code), whether a
  context file exists, the repository path and command allowlist for code workspaces, and the tool connections named.
  An invalid workspace config falls back to a planning workspace with the reason shown.
- **Context:** reads a context file into its Facts, Plans and Ideas sections (tolerating missing sections and text
  above them); asks the session's provider for suggestions as structured output validated with Zod (each suggestion: a
  section, the text, and optionally the existing line it replaces or removes); applies ticked suggestions; commits with
  a message listing them; pushes to the remote, retrying and reporting push failures. Models never write context files.
- **Providers:** the one seam. A provider reports its status (available, with models and capabilities, or unavailable
  with a reason) and runs one turn as a stream of events, returning a failure as a value, never a throw. Capabilities
  (reads files, can code, uses tools) drive the rules, not provider names. Adapters: Claude (Agent SDK), Codex (Codex
  SDK, later) and a scripted fake.
- **Sessions:** create, send a message (starts a turn and returns at once), subscribe from a position, answer an
  approval, stop a turn, get and list. One turn at a time per session. Events are numbered from 1 with no gaps and are
  visible only once written. The model may change between turns.
- **Code** (phase 3): creates the session branch and its worktree in the data folder, matches commands against the
  allowlist exactly (anything able to chain a command is never a match), produces the diff, and merges or discards.
- **Tools** (phase 5): resolves a workspace's tool connection names to MCP server definitions from the settings, and
  classifies each action as safe or needing approval.
- **Notifications** (phase 3): web push with keys generated on first run; stores each device's subscription; sends on
  approval requested and on a long turn finishing or failing. The sender is passed in, so tests can read what was sent.
- **HTTP:** the API mirroring the session interface, plus login, workspaces, context and suggestions, providers and
  notifications; events streamed as server-sent events resuming from the last event id; everything except a health
  check requires the owner's login.

### The Claude adapter

- Runs each turn through the Agent SDK with the worker machine's Claude Code login, or an API key when one is set.
- Isolation, every turn: no setting sources, auto memory disabled, claude.ai connectors disabled, and only the MCP
  servers for the workspace's tool connections. The working directory is the workspace folder (planning) or the
  session branch's worktree (code), and file access outside it is denied.
- Planning workspaces get read-only tools only. Code workspaces get edit and command tools, with every command and
  every unsafe tool action routed through the SDK's permission callback to an approval event.
- The context file is added to the system prompt on every turn.
- A usage-limit error becomes a rate-limited failure carrying the reset time when the SDK gives one.

### Events

Owner message, text delta, activity (file read, command run, tool connection used), approval requested (a command, or a
tool connection action with its arguments), approval answered, model changed, turn completed, turn stopped (by the
owner, recorded apart from failures, with the text written so far kept), and turn failed with a reason: rate limited
(with reset time if known), provider unavailable, interrupted, or unknown.

### Overflow

A rate-limited turn offers the other available providers' models (only ones that can code, in a code workspace).
Choosing one records a model-changed event and re-sends the owner's last message to the new model, with the context
file and the session's conversation so far, because the new provider has neither.

### Floor plans

A model draws a floor plan as SVG in its answer; the web app sanitises and renders it inline, to scale, with
dimensions. Saving one writes it into the workspace as a file, an explicit action by the owner, not a model write.

### Web app

- Routes for login, the workspace list, a workspace (its sessions and context file), and a session.
- An installable PWA with a service worker for web push. It caches the app's own files only, never session data.
- Three layouts from one design: compact single column for a narrow phone screen (where the keyboard takes much of the
  height, so the composer stays compact), and two panes (workspaces beside the session) for an unfolded foldable's
  landscape screen and for desktop.
- Performance: route-level code splitting, a small first load, streamed text appended without re-rendering the whole
  session, and long sessions virtualised.

### Design

Phase 0 happens in Paper before the first screen is built: Claude drafts two or three directions for the key screens
(workspace switcher, session, approval, suggestions) through Paper's MCP, inspired by apps the owner names; the owner
picks and adjusts one; its colours, type and spacing become the shadcn theme's tokens.

## Testing Decisions

- A good test drives behaviour through one of three seams and survives a rewrite of what's behind it. No test imports a
  module's internals.
- **The worker's API, in-process.** The main surface. Requests go to the Hono app object with real temporary folders
  (a context folder that is a real git repository with a real bare remote, a data folder) and the fake provider:
  login and its refusals, the workspace catalog, a whole turn over server-sent events, resume from the last event id,
  persistence across a restart, interrupted turns, stop, busy sessions, approvals, model changes and overflow,
  suggestions applied, committed and pushed, push failures, and (phase 3) session branches, allowlist matching, diff,
  merge and discard against real temporary repositories.
- **The provider seam.** The Claude adapter, and later Codex, tested with its SDK stubbed: the isolation options are
  set on every turn, planning workspaces get read-only tools, permission requests become approval events, usage-limit
  errors become rate-limited failures, and credentials never appear in events. A short manual checklist covers each
  adapter against a real login.
- **The browser, end to end.** Playwright against the built web app and a real worker running the fake provider: log
  in, switch workspaces, send a message and watch it stream, close and reopen mid-turn, answer an approval, tick
  suggestions, and the compact and two-pane layouts. Edge cases stay in the API tests, so these stay few.
- **Observable side effects** go through dependencies passed in: the notification sender and the clock.
- Prior art: homelab-mcp's in-process HTTP tests and Zod-parsed edges, and the session-service tests in an earlier
  scaffold of this idea, kept outside this repo (fake provider plus temporary folders).

## Out of Scope

- Multiple users, roles, shared sessions, or exposure to the public internet.
- A database. Sessions and context are plain files.
- Retrieval over the context folder (embeddings, RAG). The context file plus file access replaces it.
- Models writing context files or planning workspace files directly.
- Automatic model switching or routing.
- Local models and Gemini (ADR 0004). The provider seam leaves room for them.
- Suggestions offered automatically at the end of a session (a likely later addition).
- 3D views and photo mock-ups of rooms. 3D can arrive later as a tool connection.
- Email, calendar and drive tool connections, until the approval flow is proven on the homelab and the design app.
- A container per coding session.
- Embedding other apps' screens.
- An installer for other people beyond the README.

## Further Notes

### Phases

Each phase leaves something usable. Owner-side setup steps are listed with the phase that needs them.

| Phase | Delivers                                                                                                     | Owner setup                                         |
| ----- | ------------------------------------------------------------------------------------------------------------ | --------------------------------------------------- |
| 0     | The design in Paper and the shadcn theme from it                                                             | Install Paper; name apps whose look you like        |
| 1     | Login, workspaces and context files, Claude sessions that stream and outlive the tab, the installable app    | A proxy route and fixed address for the worker     |
| 2     | Suggestions ticked into context files, committed and pushed                                                  | A git repository on the NAS for the context folder |
| 3     | Code workspaces: session branches, the command allowlist, approvals, review and merge; notifications        | None                                                |
| 4     | Codex as a second provider, and overflow                                                                     | A ChatGPT plan                                      |
| 5     | Tool connections (homelab first, then Paper) and floor plans                                                 | Paper running on the worker machine                |
| 6     | The web app served from the NAS, then wake-on-LAN for the worker machine                                    | A wired network connection to the worker machine   |

### A check after phase 2

After phase 2, the owner uses Courtyard for three weeks before phase 3 starts. The question: on most days, did they
open Courtyard rather than the Claude app? If yes, the later phases go ahead one at a time, each when it's wanted, and
phase 3 is weighed against what Claude Code itself offers by then. If no, building stops at phase 2: Courtyard stays
a working hub and a portfolio piece, and the context folder stays useful on its own.

### Ideas for later

- **The context reaches other apps.** The context folder is plain files in git, not locked inside Courtyard. A small
  tool connection could let Claude Code in any repository, or the Claude desktop app with Blender, read a workspace's
  context. Courtyard stays where context is curated, but not the only place it's used.

### Checks before relying on things outside our control

- Re-read Anthropic's guidance on Agent SDK use with a subscription before phase 1 and before phase 3 (ADR 0003).
- Paper's free plan allows 100 MCP calls a week; Pro raises it. Phase 0 may need a month of Pro.
- Wake-on-LAN rarely works over USB Wi-Fi adapters, hence the wired connection in phase 6.
- Node does not trust a private certificate authority by default; the worker needs it added to reach a tool connection
  served with one.
