# The web app may keep a read-only copy

Amends ADR 0001, whose web app stores nothing and shows only a page saying so while the worker is off. A device can now
keep a copy to read offline (#106): the owner turns it on per device in Settings, under Notifications, and it's off
by default. The worker decides what's in it, once, behind one endpoint (`GET /api/offline-copy`, one schema in the
contract): the workspace list, the owner context, each workspace's context file and session list, and the
conversations of each workspace's 5 latest sessions, kept to the owner's messages, the answers and the saves (no tool
activity, no photos). The web app stores it whole in IndexedDB, with the time it's from, and reads it back through its
schema. It's read-only: never changed on the device and never sent back, so the worker stays the only place anything
is decided or kept. Documents, Things and what waits on the owner aren't in it.

The copy is updated when the app opens or comes back into view, then every 15 minutes while it's open (a slow
setting of the shared `useFresh`), and with Update now. When the worker can't be reached and a copy exists, the same
screens show from it, read-only, in place of the "can't reach its worker" page, with a grey line at the foot saying
it's a copy and when it's from. The worker keeps no list of devices holding one.

## Considered options

- **Keep nothing, as ADR 0001 had it.** Rejected: the owner wanted to read their context and recent sessions when the
  worker machine is off or out of reach (a work VPN, #87).
- **Cache the API's answers in the service worker.** Rejected: what's kept would be whatever pages happened to load,
  never wiped in one place, and the copy's contents would be decided by the browser, not the worker.
- **Encrypt the copy on the device.** Rejected: the key would live on the same device. The phone's lock and its
  storage encryption are what protect it; the setting's words say what's stored.
- **Keep every session's conversation.** Rejected: the 5 latest per workspace are what's read offline, and keep the
  copy small.

## Consequences

- **Personal context is on the device's storage while the switch is on.** It's wiped on logging out on that device,
  on any answer saying the device isn't logged in (logged out from another device), or on turning the switch off;
  never on a time limit. A device logged out elsewhere keeps its copy until it next reaches the worker.
- **Offline with an expired login, the device still shows the copy:** it can't hear that it's logged out until it
  reaches the worker. Its own lock screen is the protection then.
- **Nothing can be sent offline.** Sending, saves, Undo and every button that needs the worker wait for it; the
  message box and the frame's Model, Skills and talking go while reading a copy.
