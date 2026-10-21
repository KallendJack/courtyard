# notifications

Settings' notifications toggle for this device (#173). The worker's side is
[`notifications/`](../../../../worker/src/features/notifications/README.md).

**Example:** you turn notifications on for your phone. From then on it buzzes when a session needs you or an answer
is ready.

- **Uses:** `components/forms/switch.tsx`.
- **Used by:** Settings (`routes/_app/settings.tsx`), beside Connections.

## Screens

- The notifications card (`notifications-card.tsx`), its own lazy load, with its calls in `api.ts`.

## How it works

- It subscribes the browser with the worker's key and sends the subscription, sends it again each time the page opens
  (so it follows the device's login), and unsubscribes on off.
- The service worker (`public/sw.js`) shows each one, and opens the session on a tap, or the page it names: one
  about the Lead or its builders (#593) opens the code workspace's Home, a builder's with its row on the Builders
  board in view (`features/builders/`).
- Which ones each workspace sends is its Notify me (#493), picked in the workspace ⋯'s sheet
  (`components/sheets/notify-me-sheet.tsx`) and decided by the worker.
