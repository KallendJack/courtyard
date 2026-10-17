# offline-copy

The offline copy (#106, ADR 0030): everything a device that keeps one stores to read while the worker can't be
reached, decided once, here.

**Example:** the owner's phone, with Read offline on, asks for its copy as Courtyard opens: the workspaces, the owner
context, each workspace's context file and sessions, and its 5 latest sessions' conversations.

- **Uses:** `workspaces/`, `owner-context/`, `sessions/` (each session's events), `things/` and `documents/` (how many
  each workspace has, as they aren't kept), and the workspace page's detail from `worker.ts`.
- **Used by:** `worker.ts`; in the web app, `features/offline-copy/`.

## API

- `GET /api/offline-copy`: the copy (`OfflineCopy` in the contract).

## How it works

- Each workspace's sessions are listed calm: what waits on the owner (an approval, a new reply, a pull request) isn't
  kept, since none of it can be acted on offline.
- The 5 sessions with the latest activity in each workspace, whatever their state, keep their conversation: only the
  owner's messages, the answers' text, the saves to context and each turn's end (`conversationIn`). Each answer's
  text is joined into as few pieces as it can be, a paragraph break kept where something the model did split it.
- The worker keeps no list of the devices holding a copy.
