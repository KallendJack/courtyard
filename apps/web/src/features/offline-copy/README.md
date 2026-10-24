# offline-copy

Read offline (#106, ADR 0030): this device's copy, kept to read while the worker can't be reached. The worker's side,
which decides what's in it, is [`offline-copy/`](../../../../worker/src/features/offline-copy/README.md).

**Example:** you turn on Keep a copy to read offline on your phone. Later, on the train with the PC off, you open
Courtyard and read Tuesday's session about the back wall, with "Offline · reading a copy" at the foot.

- **Uses:** IndexedDB (`store.ts`), `packages/ui/layout/kept.tsx`'s `useFresh`, `components/layout/offline.tsx`,
  `sessions/` (its turns, drawn from the copy's events).
- **Used by:** the root route (`routes/__root.tsx`: reads the copy when the worker can't be reached, wipes it when the
  worker says the device isn't logged in), `routes/_app.tsx` (keeps it fresh, wipes it on Log out), the workspace,
  session and Settings pages, which read from it while the device reads its copy.

## Screens

- Settings' Read offline card (`offline-copy-card.tsx`, its own lazy load): the switch, Last updated and Update now.
- A session read offline (`read-session.tsx`), and a code workspace's page read offline (`read-code-home.tsx`); a
  planning workspace's page reads offline itself (`planning-home/`, its `offline`).

## How it works

- `switch.ts`, on the first load, is this device's switch, kept in `localStorage`, off by default; the rest loads only
  once it's on, or once a copy is to be wiped.
- `keep-fresh.tsx` asks for a new copy (`api.ts`) when the app opens and comes back into view, then every 15 minutes:
  a slow setting of the shared `useFresh`. A logged-out answer wipes the copy.
- `store.ts` keeps the copy whole, read-only, and reads it back through the contract's `OfflineCopy` schema, so one
  this app can no longer read counts as none.
- When the worker can't be reached and a copy exists, the root route's context carries it (`reading`) and the loaders
  answer from it instead of the worker; what it doesn't keep says "Not kept offline".
